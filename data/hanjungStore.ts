// 한중발주건. 발주 흐름(쿠팡발주확인 → 한중발주 → 수입입고 → 물류창고입고/정산)을 이 한 건에 모아 추적한다.
//
//  hanjungOrders : 문서 id = 한중발주 고유번호(code).
//    lines    : 이 한중발주로 넘긴 쿠팡 발주 줄들. 같은 상품 여러 줄을 합쳐 1688에 한 번에 주문한다.
//    receipts : 수입입고 기록. 나눠서 도착하면 여러 번 쌓인다. 상품별 수량·단가와 관세사비·배송비·작업비.
//
// Firebase 설정이 없으면 이 기기의 localStorage에만 저장한다.
import { collection, doc, onSnapshot, setDoc, deleteDoc } from 'firebase/firestore';
import { db, ensureSignedIn } from '../utils/firebase';
import { productMatchKey } from './inventoryStore';
import type { OfficeMatch } from './inventoryStore';

export interface HanjungLine {
  key: string;
  발주번호: string;
  물류센터: string;
  상품이름: string;
  확정수량: number;
  입고예정일: string; // YYYYMMDD
  // 예전에 줄마다 적던 1688 주문 수량. 지금은 HanjungOrder.orderQty(상품별)에 적는다. 남아 있으면 기본값 계산에만 쓴다.
  주문수량?: number;
  // 이 한중발주가 맡은 수량(쿠팡 줄 일부만 맡을 때). 없으면 확정수량 전부. 나머지는 다른 한중발주나 발주 대기가 맡는다.
  // 확정수량은 쿠팡 줄을 찾는 열쇠라 그대로 둔다.
  배정?: number;
}

// 이 한중발주가 그 쿠팡 줄에서 맡은 수량.
export const lineAlloc = (l: HanjungLine) => l.배정 ?? l.확정수량;
export const lineQty = (l: HanjungLine) => l.주문수량 ?? lineAlloc(l);

export interface ReceiptItem {
  상품이름: string;
  qty: number;
  unitCost: number; // 1688 구매 단가(원)
}

export interface HanjungReceipt {
  id: string;
  date: string; // YYYY-MM-DD
  items: ReceiptItem[];
  관세사비: number;
  배송비: number;
  작업비: number;
  통관비?: number; // 나중에 더한 칸이라 예전 기록에는 없다.
  memo: string;
  createdAt: number;
}

export interface HanjungOrder {
  code: string;
  createdAt: number;
  memo: string;
  lines: HanjungLine[];
  receipts: HanjungReceipt[];
  // 상품별로 1688에 실제 주문한 수량. 쿠팡 발주보다 넉넉히 사면 남는 만큼이 "여유"가 된다.
  // 없는 상품은 그 상품 줄 수량의 합(넉넉히 사지 않은 것)으로 본다.
  orderQty?: Record<string, number>;
  // 상품별 1688 구매 단가(원). 주문할 때 미리 적어 두고, 도착 기록 때 기본값으로 쓴다.
  unitCost?: Record<string, number>;
  // 주문할 때 미리 적어 둔 부대비용(예상). 도착 기록 때 아직 안 쓴 만큼을 기본값으로 채운다.
  fees?: Partial<Record<FeeKey, number>>;
  // 도착한 만큼 배정 줄을 준비됨으로 자동 체크한 시각. 이 기능이 생기기 전에 도착한 건을 한 번만 맞추려고 둔다.
  autoReadyAt?: number;
}

// 한중발주 부대비용 칸들(주문할 때·도착 기록 때 같은 순서로 보여준다).
export const FEE_KEYS = ['관세사비', '통관비', '배송비', '작업비'] as const;
export type FeeKey = typeof FEE_KEYS[number];
export const receiptFee = (r: HanjungReceipt, k: FeeKey) => Number((r as unknown as Record<string, number>)[k]) || 0;
// 이 한중발주에서 그 비용이 아직 도착 기록에 안 쓰인 만큼(주문 때 적은 값 − 지금까지 도착 기록에 적은 합).
export const remainingFee = (order: HanjungOrder, k: FeeKey) =>
  Math.max(0, (order.fees?.[k] || 0) - order.receipts.reduce((s, r) => s + receiptFee(r, k), 0));

const COLLECTION = 'hanjungOrders';
const LOCAL_KEY = 'hanjungOrders';

// ---- 계산 ----

// ---- 이름이 다른 같은 상품 기억하기 ----
// 쿠팡 발주와 한중발주(상품관리에서 고른 이름)의 상품명이 규칙 없이 다를 때가 있다
// ("파우치 필통, 그린" / "파우치형 필통, 그린, 1개"). 사람이 한 번 "같은 상품"이라고 하면
// productAliases/map에 적어 두고, 그 뒤로는 어디서든 같은 상품으로 본다. "다른 상품"이라고 한 쌍도 적어
// 두어 다시 묻지 않는다.
//  aliases : 열쇠(rawKey) → 쿠팡 발주 쪽 이름
//  notSame : "열쇠A│열쇠B" → true
type AliasState = { aliases: Record<string, string>; notSame: Record<string, boolean> };
const ALIAS_COLLECTION = 'productAliases';
const ALIAS_DOC = 'map';
const ALIAS_LOCAL_KEY = 'productAliases';
let aliasState: AliasState = { aliases: {}, notSame: {} };
const aliasListeners = new Set<() => void>();
const readLocalAliases = (): AliasState => {
  try {
    const v = JSON.parse(localStorage.getItem(ALIAS_LOCAL_KEY) || '');
    return { aliases: v.aliases || {}, notSame: v.notSame || {} };
  } catch {
    return { aliases: {}, notSame: {} };
  }
};
// 이 컴퓨터에 남겨 둔 값으로 먼저 시작한다(클라우드 응답이 늦어도 화면을 열자마자 같은 상품으로 보이게).
aliasState = readLocalAliases();
const setAliasState = (next: AliasState) => {
  aliasState = next;
  try { localStorage.setItem(ALIAS_LOCAL_KEY, JSON.stringify(next)); } catch {}
  aliasListeners.forEach(l => l());
};

const rawKey = (name: string) => productMatchKey(name) || String(name || '').trim();
const pairKey = (a: string, b: string) => [rawKey(a), rawKey(b)].sort().join('│');
export const isNotSame = (a: string, b: string) => !!aliasState.notSame[pairKey(a, b)];

// 같은 상품인지 볼 때 쓰는 열쇠. 띄어쓰기·쉼표만 다른 이름("핑크 1개 30cm" / "핑크, 1개, 30cm")은
// 글자만 남겨 맞추고, 사람이 같은 상품이라고 연결한 이름은 연결한 이름의 열쇠로 바꾼다.
export const nameKey = (name: string) => {
  const k = rawKey(name);
  const to = aliasState.aliases[k];
  return to ? rawKey(to) : k;
};

// 사람이 고른 답을 적는다. same이면 from 이름을 to(쿠팡 발주 이름)와 같은 상품으로 본다.
export const rememberSameProduct = async (from: string, to: string, same: boolean) => {
  const next: AliasState = {
    aliases: same ? { ...aliasState.aliases, [rawKey(from)]: to } : aliasState.aliases,
    notSame: same ? aliasState.notSame : { ...aliasState.notSame, [pairKey(from, to)]: true },
  };
  setAliasState(next);
  if (!db) return;
  await ensureSignedIn();
  await setDoc(
    doc(db, ALIAS_COLLECTION, ALIAS_DOC),
    same ? { aliases: { [rawKey(from)]: to } } : { notSame: { [pairKey(from, to)]: true } },
    { merge: true }
  );
};
export const sameName = (a: string, b: string) => nameKey(a) === nameKey(b);

// orderQty에 이미 적힌 같은 상품의 이름(없으면 받은 이름). 같은 상품이 이름만 달리 두 번 적히지 않게 한다.
export const orderQtyName = (orderQty: Record<string, number> | undefined, name: string) =>
  Object.keys(orderQty || {}).find(k => sameName(k, name)) ?? name;

// 주문할 때 적어 둔 그 상품의 단가(없으면 0). 이름이 조금 달라도 같은 상품이면 찾는다.
export const productUnitCost = (order: HanjungOrder, name: string) => {
  const k = Object.keys(order.unitCost || {}).find(x => sameName(x, name));
  return k ? order.unitCost![k] : 0;
};

// 한 상품을 1688에 주문한 수량(적어 둔 값, 없으면 그 상품 줄 수량의 합).
export const productOrderQty = (order: HanjungOrder, name: string) => {
  const k = orderQtyName(order.orderQty, name);
  return order.orderQty?.[k] ?? order.lines.filter(l => sameName(l.상품이름, name)).reduce((s, l) => s + lineQty(l), 0);
};

// 상품별 주문·배정·입고 수량. 상품 순서는 발주 줄 순서를 따른다.
//  ordered  : 1688에 주문한 수량
//  allocated: 그중 쿠팡 발주 줄에 연결한 수량
//  spare    : 여유(주문 − 배정). 아직 어느 쿠팡 발주에도 안 쓴 수량
export const productSummary = (order: HanjungOrder) => {
  const map = new Map<string, { 상품이름: string; ordered: number; allocated: number; spare: number; received: number; cost: number }>();
  // 이름만 조금 다른 같은 상품은 한 줄로 합친다. 보여주는 이름은 먼저 나온 것(쿠팡 발주 줄 이름).
  const entry = (name: string) => {
    const k = nameKey(name);
    let e = map.get(k);
    if (!e) {
      e = { 상품이름: name, ordered: productOrderQty(order, name), allocated: 0, spare: 0, received: 0, cost: 0 };
      map.set(k, e);
    }
    return e;
  };
  for (const l of order.lines) entry(l.상품이름).allocated += lineAlloc(l);
  Object.keys(order.orderQty || {}).forEach(name => entry(name));
  for (const r of order.receipts) {
    for (const it of r.items) {
      const e = entry(it.상품이름);
      e.received += it.qty;
      e.cost += it.qty * it.unitCost;
    }
  }
  map.forEach(e => { e.spare = Math.max(0, e.ordered - e.allocated); });
  return Array.from(map.values());
};

// 상품 이름 → 한중 여유. arrived: 이미 도착한 여유(= 사무실에 남은 재고), incoming: 아직 오는 중인 여유.
// 도착한 수량은 먼저 배정된 쿠팡 발주 몫으로 치고, 그걸 넘는 만큼을 여유로 본다.
export type HanjungSpare = { arrived: number; incoming: number; byOrder: { code: string; ordered: number; spare: number; arrived: number }[] };
export const makeSpareLookup = (orders: HanjungOrder[]) => {
  const m = new Map<string, HanjungSpare>();
  for (const o of orders) {
    for (const p of productSummary(o)) {
      if (p.spare <= 0) continue;
      const arrived = Math.min(p.spare, Math.max(0, p.received - p.allocated));
      const k = nameKey(p.상품이름);
      const e = m.get(k) || { arrived: 0, incoming: 0, byOrder: [] };
      e.arrived += arrived;
      e.incoming += p.spare - arrived;
      e.byOrder.push({ code: o.code, ordered: p.ordered, spare: p.spare, arrived });
      m.set(k, e);
    }
  }
  return (name: string): HanjungSpare | null => m.get(nameKey(name)) || null;
};

// 쿠팡발주확인·쉽먼트생성·발송대기의 "사무실" 칸. 사무실 재고는 한중으로 넉넉히 사 와서 남은 것뿐이라
// 한중 여유로 계산한다(qty = 도착한 여유, incoming = 오는 중인 여유).
export const makeHanjungOfficeLookup = (orders: HanjungOrder[]) => {
  const spareOf = makeSpareLookup(orders);
  return (name: string): OfficeMatch => {
    const sp = spareOf(name);
    return {
      qty: sp ? sp.arrived : 0,
      incoming: sp ? sp.incoming : 0,
      names: sp ? sp.byOrder.map(b => `${b.code} 여유 ${b.spare}${b.arrived < b.spare ? `(도착 ${b.arrived})` : ''}`) : [],
      exact: true,
    };
  };
};

// 줄을 더하거나 빼기 전에 지금 주문 수량을 적어 둔다. 안 그러면 "줄 수량의 합"인 기본값이 같이 움직여
// 여유를 쓰는 대신 주문 수량이 늘어난 것처럼 보인다. 처음 들어오는 상품이면 그 줄 수량을 주문 수량으로 한다.
export const freezeOrderQty = (order: HanjungOrder, name: string, newLineQty = 0): Record<string, number> => {
  const cur = productOrderQty(order, name);
  return { ...(order.orderQty || {}), [orderQtyName(order.orderQty, name)]: cur > 0 ? cur : newLineQty };
};

export const receiptGoodsCost = (r: HanjungReceipt) => r.items.reduce((s, it) => s + it.qty * it.unitCost, 0);
export const receiptTotalCost = (r: HanjungReceipt) => receiptGoodsCost(r) + FEE_KEYS.reduce((s, k) => s + receiptFee(r, k), 0);

export const orderTotals = (order: HanjungOrder) => {
  const products = productSummary(order);
  const ordered = products.reduce((s, p) => s + p.ordered, 0);
  const received = products.reduce((s, p) => s + p.received, 0);
  const totalCost = order.receipts.reduce((s, r) => s + receiptTotalCost(r), 0);
  const status: 'ordered' | 'partial' | 'done' = received <= 0 ? 'ordered' : received < ordered ? 'partial' : 'done';
  return { ordered, received, totalCost, status };
};

// 오늘 날짜 기준 새 고유번호. 예: H260923-01, 같은 날 두 번째면 -02.
export const nextHanjungCode = (orders: HanjungOrder[], now = new Date()) => {
  const ymd = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const prefix = `H${ymd}-`;
  const used = orders.filter(o => o.code.startsWith(prefix)).map(o => Number(o.code.slice(prefix.length)) || 0);
  return `${prefix}${String((used.length ? Math.max(...used) : 0) + 1).padStart(2, '0')}`;
};

// ---- 저장소 ----

type Listener = (orders: HanjungOrder[]) => void;
const localListeners = new Set<Listener>();
const readLocal = (): Record<string, HanjungOrder> => {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || '') || {};
  } catch {
    return {};
  }
};
const sortOrders = (orders: HanjungOrder[]) => orders.sort((a, b) => b.createdAt - a.createdAt);
const writeLocal = (state: Record<string, HanjungOrder>) => {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
  const list = sortOrders(Object.values(state));
  localListeners.forEach(l => l(list));
};

export const subscribeHanjung = (listener: Listener): (() => void) => {
  if (!db) {
    listener(sortOrders(Object.values(readLocal())));
    localListeners.add(listener);
    const again = () => listener(sortOrders(Object.values(readLocal())));
    aliasListeners.add(again);
    return () => { localListeners.delete(listener); aliasListeners.delete(again); };
  }
  const firestore = db;
  let cancelled = false;
  let unsubscribe: (() => void) | undefined;
  let unsubAlias: (() => void) | undefined;
  // 같은 상품 연결이 바뀌면 계산을 다시 하도록 한중발주 목록을 새로 한 번 더 보낸다.
  let last: HanjungOrder[] = [];
  const reemit = () => listener([...last]);
  aliasListeners.add(reemit);
  (async () => {
    await ensureSignedIn();
    if (cancelled) return;
    unsubscribe = onSnapshot(
      collection(firestore, COLLECTION),
      snap => { last = sortOrders(snap.docs.map(d => d.data() as HanjungOrder)); listener(last); },
      error => console.error('한중발주 동기화 실패:', error)
    );
    unsubAlias = onSnapshot(
      doc(firestore, ALIAS_COLLECTION, ALIAS_DOC),
      snap => {
        // 캐시에 아직 없어서 빈 응답이 오면 무시한다(이걸로 지우면 잠깐 다른 상품처럼 갈라져 보인다).
        const fromCache = snap.metadata.fromCache;
        if (!snap.exists() && fromCache) return;
        const v = (snap.data() || {}) as Partial<AliasState>;
        setAliasState({ aliases: v.aliases || {}, notSame: v.notSame || {} });
      },
      error => console.error('같은 상품 연결 동기화 실패:', error)
    );
  })();
  return () => {
    cancelled = true;
    aliasListeners.delete(reemit);
    unsubscribe?.();
    unsubAlias?.();
  };
};

// Firestore 문서 id에는 '/'를 쓸 수 없다.
const docId = (code: string) => code.replace(/\//g, '∕');

export const saveHanjungOrder = async (order: HanjungOrder) => {
  if (!db) {
    const s = readLocal();
    s[order.code] = order;
    writeLocal(s);
    return;
  }
  await ensureSignedIn();
  await setDoc(doc(db, COLLECTION, docId(order.code)), order);
};

export const deleteHanjungOrder = async (code: string) => {
  if (!db) {
    const s = readLocal();
    delete s[code];
    writeLocal(s);
    return;
  }
  await ensureSignedIn();
  await deleteDoc(doc(db, COLLECTION, docId(code)));
};

export const addReceipt = (order: HanjungOrder, receipt: HanjungReceipt) =>
  saveHanjungOrder({ ...order, receipts: [...order.receipts, receipt] });

// 도착 기록을 지운다. 그 기록에 적은 금액(단가)·부대비용은 주문 쪽에 아직 없으면 옮겨 남긴다
// (단가만 적으려다 도착으로 저장해서 지우는 경우, 금액까지 날아가지 않게).
export const removeReceipt = (order: HanjungOrder, receiptId: string) => {
  const r = order.receipts.find(x => x.id === receiptId);
  const unitCost = { ...(order.unitCost || {}) };
  const fees = { ...(order.fees || {}) };
  if (r) {
    for (const it of r.items) {
      if (it.unitCost > 0 && !productUnitCost(order, it.상품이름)) unitCost[it.상품이름] = it.unitCost;
    }
    for (const k of FEE_KEYS) {
      const v = receiptFee(r, k);
      if (v > 0 && !fees[k]) fees[k] = v;
    }
  }
  return saveHanjungOrder({
    ...order,
    receipts: order.receipts.filter(x => x.id !== receiptId),
    ...(Object.keys(unitCost).length ? { unitCost } : {}),
    ...(Object.keys(fees).length ? { fees } : {}),
  });
};

// 같은 상품으로 연결한 이름이 한중발주에 예전 이름으로 남아 있으면 쿠팡 발주 이름으로 바꾼 한중발주들을 돌려준다
// (주문 수량·단가·도착 기록의 품목 이름). 기억(별칭)에만 기대면 그걸 못 받은 순간 두 상품처럼 갈라져 보여서,
// 데이터 자체를 맞춰 둔다. 바꿀 게 없으면 빈 배열.
export const ordersNeedingAliasRename = (orders: HanjungOrder[]): HanjungOrder[] => {
  const target = (name: string) => aliasState.aliases[rawKey(name)];
  const out: HanjungOrder[] = [];
  for (const o of orders) {
    let changed = false;
    const renameMap = <T,>(m: Record<string, T> | undefined, merge: (a: T, b: T) => T) => {
      if (!m) return m;
      const next: Record<string, T> = {};
      for (const [k, v] of Object.entries(m)) {
        const to = target(k);
        const key = to && to !== k ? to : k;
        if (key !== k) changed = true;
        next[key] = next[key] != null ? merge(next[key], v) : v;
      }
      return next;
    };
    const orderQty = renameMap(o.orderQty, (a, b) => a + b);
    const unitCost = renameMap(o.unitCost, (a) => a);
    const receipts = o.receipts.map(r => ({
      ...r,
      items: r.items.map(it => {
        const to = target(it.상품이름);
        if (to && to !== it.상품이름) { changed = true; return { ...it, 상품이름: to }; }
        return it;
      }),
    }));
    if (changed) out.push({ ...o, ...(orderQty ? { orderQty } : {}), ...(unitCost ? { unitCost } : {}), receipts });
  }
  return out;
};

// 상품 하나의 개당 원가(부대비용 포함). 상품마다 값이 달라서 건 전체를 수량으로 나누지 않고,
//  그 상품 상품금액 + 부대비용 × (그 상품 금액 ÷ 그 건 상품금액 합)  을 그 상품 도착 수량으로 나눈다.
// 아직 도착 전이면 주문할 때 적은 금액(개당) 기준(부대비용 없이).
export const unitLandedCost = (o: HanjungOrder, name: string) => {
  const p = productSummary(o).find(x => x.상품이름 === name);
  if (p && p.received > 0 && p.cost > 0) {
    const goodsAll = productSummary(o).reduce((s, x) => s + x.cost, 0);
    const fees = orderTotals(o).totalCost - goodsAll;
    const share = goodsAll > 0 ? fees * (p.cost / goodsAll) : 0;
    return (p.cost + share) / p.received;
  }
  return productUnitCost(o, name);
};

// 아직 배정 안 된 여유 = 재고. 도착한 것과 오는 중인 것을 나눈다.
export const inventoryOf = (o: HanjungOrder) =>
  productSummary(o)
    .filter(p => p.spare > 0)
    .map(p => {
      const arrived = Math.min(p.spare, Math.max(0, p.received - p.allocated));
      const unit = unitLandedCost(o, p.상품이름);
      return { code: o.code, name: p.상품이름, spare: p.spare, arrived, incoming: p.spare - arrived, unit, value: p.spare * unit };
    });


// ---- 도착 안 한 것 정리 ----
// 1688에서 일부만 오고 나머지는 다음 한중발주로 새로 주문할 때: 이 한중발주는 도착한 만큼으로 마무리한다.
//  · 상품마다 주문 수량을 도착한 수량으로 줄인다(더 오지 않으니 오는 중인 여유도 없다).
//  · 쿠팡 줄 배정이 도착한 수량보다 많으면, 그 넘는 만큼을 이 건에서 떼어 돌려준다(입고예정일이 늦은 줄부터 뗀다).
//    돌려준 줄은 한중발주 대기로 보내면, 다음 한중발주를 대기에서 만들 때 그대로 따라간다.
export interface ShortRelease { 상품이름: string; ordered: number; received: number; released: { line: HanjungLine; qty: number }[] }
export const closeShortOrder = (order: HanjungOrder): { order: HanjungOrder; releases: ShortRelease[] } => {
  const releases: ShortRelease[] = [];
  let lines = [...order.lines];
  let orderQty = { ...(order.orderQty || {}) };
  for (const p of productSummary(order)) {
    if (p.received >= p.ordered) continue;
    const rel: ShortRelease = { 상품이름: p.상품이름, ordered: p.ordered, received: p.received, released: [] };
    let over = Math.max(0, p.allocated - p.received);
    const mine = lines
      .filter(l => nameKey(l.상품이름) === nameKey(p.상품이름))
      .sort((a, b) => String(b.입고예정일).localeCompare(String(a.입고예정일)));
    for (const l of mine) {
      if (over <= 0) break;
      const alloc = lineAlloc(l);
      const take = Math.min(alloc, over);
      over -= take;
      rel.released.push({ line: l, qty: take });
      lines = take >= alloc
        ? lines.filter(x => x !== l)
        : lines.map(x => (x === l ? { ...x, 배정: alloc - take } : x));
    }
    orderQty = { ...orderQty, [orderQtyName(orderQty, p.상품이름)]: p.received };
    releases.push(rel);
  }
  return { order: { ...order, lines, orderQty }, releases };
};

// ---- 남은 것 정리 뒤 모자란 줄 채우기 ----
// closeShortOrder로 떼어 낸 쿠팡 줄(released)을 발주 대기로 보내기 전에:
//  1) 사무실 여유(다른 한중발주에 도착했고 아무 데도 배정 안 된 것)로 먼저 채운다. 입고예정일 빠른 줄부터.
//  2) (swap = true일 때) 그래도 모자라면, 같은 상품을 맡은 다른 한중발주(도착했든 오는 중이든)에서 입고예정일이 더 늦은
//     쿠팡 줄의 배정을 가져온다(급한 발주가 그 물건을 먼저 받게). 그 늦은 줄은 가져간 만큼 발주 대기로 간다.
//     이미 도착분이 있는 줄을 먼저, 그다음 늦은 날짜부터. 발송완료된 줄(skipKeys)은 건드리지 않는다.
// 채우고 남은 것은 발주 대기(queue)로.
// 준비됨: 한중발주마다 "입고예정일 빠른 줄부터 도착분을 채운다"(도착 기록 때와 같은 규칙)로 바뀌기 전후를 비교해
//  새로 다 채워진 줄은 켜고(readyOn), 더는 다 채워지지 않는 줄은 끈다(readyOff). 배정을 내준 줄도 끈다.
// 저장하지 않고 계산만 한다(화면이 확인을 받고 저장한다).
export type FillLine = { 발주번호: string; 물류센터: string; 상품이름: string; 확정수량: number; 입고예정일: string };
export interface FillPlan {
  orders: HanjungOrder[];                                    // 바뀐 다른 한중발주들
  queue: (FillLine & { qty: number })[];                     // 발주 대기로 보낼 줄과 수량
  readyOn: FillLine[];
  readyOff: FillLine[];
  spareFills: { line: FillLine; code: string; qty: number }[];
  swaps: { to: FillLine; from: FillLine; code: string; qty: number; arrived: boolean }[];
  notes: string[];                                           // 다 못 채운 줄과 그 까닭
}
const sameLineKey = (a: { 발주번호: string; 상품이름: string; 확정수량: number }, b: { 발주번호: string; 상품이름: string; 확정수량: number }) =>
  a.발주번호 === b.발주번호 && a.상품이름.trim() === b.상품이름.trim() && Number(a.확정수량) === Number(b.확정수량);
const lineKeyOf = (l: { 발주번호: string; 상품이름: string; 확정수량: number }) => `${l.발주번호}│${l.상품이름.trim()}│${l.확정수량}`;
const toFill = (l: HanjungLine): FillLine => ({ 발주번호: l.발주번호, 물류센터: l.물류센터, 상품이름: l.상품이름, 확정수량: l.확정수량, 입고예정일: l.입고예정일 });
// 그 한중발주에서 줄마다 도착분: 상품마다 입고예정일 빠른 줄부터 도착 수량을 나눠 준다.
const arrivedOf = (order: HanjungOrder): Map<HanjungLine, number> => {
  const m = new Map<HanjungLine, number>();
  for (const p of productSummary(order)) {
    let left = p.received;
    order.lines
      .filter(l => sameName(l.상품이름, p.상품이름))
      .sort((a, b) => String(a.입고예정일).localeCompare(String(b.입고예정일)))
      .forEach(l => { const got = Math.min(lineAlloc(l), Math.max(0, left)); left -= got; m.set(l, got); });
  }
  return m;
};
// 도착분으로 다 채워진 줄(그 한중발주가 통째로 맡은 줄만. 도착 기록 때 준비됨을 켜는 규칙과 같다).
export const arrivedLineKeys = (order: HanjungOrder): Map<string, FillLine> => {
  const out = new Map<string, FillLine>();
  arrivedOf(order).forEach((got, l) => { if (lineAlloc(l) === l.확정수량 && got >= l.확정수량) out.set(lineKeyOf(l), toFill(l)); });
  return out;
};
// 그 한중발주에 쿠팡 줄 몫을 더한다(같은 줄이 이미 있으면 배정만 늘린다). 주문 수량은 그대로 둔다.
const addAlloc = (order: HanjungOrder, line: FillLine, qty: number, key: string): HanjungOrder => {
  const orderQty = freezeOrderQty(order, line.상품이름);
  const has = order.lines.find(l => sameLineKey(l, line));
  if (has) {
    const next = lineAlloc(has) + qty;
    return { ...order, orderQty, lines: order.lines.map(l => (l === has ? (next >= l.확정수량 ? (({ 배정: _x, ...rest }) => rest)(l) as HanjungLine : { ...l, 배정: next }) : l)) };
  }
  return { ...order, orderQty, lines: [...order.lines, { key, ...line, ...(qty !== line.확정수량 ? { 배정: qty } : {}) }] };
};
export const planShortFill = (
  original: HanjungOrder,
  closing: HanjungOrder,
  releases: ShortRelease[],
  others: HanjungOrder[],
  opts: { swap: boolean; skipKeys: Set<string>; keyOf: (l: FillLine) => string },
): FillPlan => planFill(
  releases.flatMap(r => r.released.map(({ line, qty }) => ({ line: toFill(line), need: qty }))),
  others.filter(o => o.code !== closing.code),
  opts,
  { before: original, after: closing },
);

// 모자란 쿠팡 줄들(needs: 줄과 채울 수량)을 사무실 여유 → 더 늦은 발주의 배정 순으로 채운다. 남은 것은 queue.
// 발주 대기에 있는 줄을 늦은 발주와 바꿀 때도 이걸 쓴다. extra: 같이 바뀐 한중발주(남은 것 정리로 닫는 건)의 전후.
export const planFill = (
  needsIn: { line: FillLine; need: number }[],
  others: HanjungOrder[],
  opts: { swap: boolean; skipKeys: Set<string>; keyOf: (l: FillLine) => string },
  extra?: { before: HanjungOrder; after: HanjungOrder },
): FillPlan => {
  const plan: FillPlan = { orders: [], queue: [], readyOn: [], readyOff: [], spareFills: [], swaps: [], notes: [] };
  const before = new Map(others.map(o => [o.code, o]));
  const work = new Map(before);
  const needs = needsIn.map(n => ({ ...n })).sort((a, b) => a.line.입고예정일.localeCompare(b.line.입고예정일));
  const touched = new Set<string>();
  const lostLines: FillLine[] = [];
  for (const n of needs) {
    // 1) 사무실 여유
    for (const o of [...work.values()].sort((a, b) => a.createdAt - b.createdAt)) {
      if (n.need <= 0) break;
      const p = productSummary(o).find(x => sameName(x.상품이름, n.line.상품이름));
      const inOffice = p ? Math.min(p.spare, Math.max(0, p.received - p.allocated)) : 0;
      if (inOffice <= 0) continue;
      const take = Math.min(inOffice, n.need);
      work.set(o.code, addAlloc(o, n.line, take, opts.keyOf(n.line)));
      touched.add(o.code);
      plan.spareFills.push({ line: n.line, code: o.code, qty: take });
      n.need -= take;
    }
    // 2) 더 늦은 쿠팡 줄에서 가져오기
    let later = 0, shipped = 0, same = 0;
    if (opts.swap && n.need > 0) {
      for (;;) {
        if (n.need <= 0) break;
        const cands: { code: string; l: HanjungLine; got: number }[] = [];
        later = 0; shipped = 0; same = 0;
        for (const o of work.values()) {
          const got = arrivedOf(o);
          for (const l of o.lines) {
            if (!sameName(l.상품이름, n.line.상품이름) || sameLineKey(l, n.line)) continue;
            same++;
            if (String(l.입고예정일) <= n.line.입고예정일) continue;
            later++;
            if (opts.skipKeys.has(lineKeyOf(l))) { shipped++; continue; }
            cands.push({ code: o.code, l, got: got.get(l) || 0 });
          }
        }
        // 도착분이 있는 줄 먼저, 그다음 입고예정일이 가장 늦은 줄부터.
        cands.sort((a, b) => Number(b.got > 0) - Number(a.got > 0) || String(b.l.입고예정일).localeCompare(String(a.l.입고예정일)));
        const c = cands[0];
        if (!c) break;
        const o = work.get(c.code)!;
        const take = Math.min(lineAlloc(c.l), n.need);
        if (take <= 0) break;
        const left = lineAlloc(c.l) - take;
        let next: HanjungOrder = {
          ...o, orderQty: freezeOrderQty(o, c.l.상품이름),
          lines: left > 0 ? o.lines.map(x => (x === c.l ? { ...x, 배정: left } : x)) : o.lines.filter(x => x !== c.l),
        };
        next = addAlloc(next, n.line, take, opts.keyOf(n.line));
        work.set(c.code, next);
        touched.add(c.code);
        const from = toFill(c.l);
        plan.swaps.push({ to: n.line, from, code: c.code, qty: take, arrived: c.got > 0 });
        plan.queue.push({ ...from, qty: take });
        lostLines.push(from);
        n.need -= take;
      }
    }
    if (n.need > 0) {
      plan.queue.push({ ...n.line, qty: n.need });
      const why = !opts.swap ? ''
        : !same ? '같은 상품을 맡은 다른 한중발주가 없어요'
        : !later ? '같은 상품을 맡은 발주가 모두 입고예정일이 같거나 더 빨라요'
        : shipped >= later ? `더 늦은 발주 ${later}건이 이미 발송완료됐어요`
        : '';
      plan.notes.push(`${n.line.발주번호} ${n.line.상품이름} ${n.need}개 → 발주 대기${why ? ` (${why})` : ''}`);
    }
  }
  plan.orders = [...touched].map(c => work.get(c)!);
  // 같은 쿠팡 줄이 대기로 여러 번 가면 한 번으로 합친다(따로 보내면 나중 것이 앞의 것을 덮어쓴다).
  const merged = new Map<string, FillLine & { qty: number }>();
  for (const q of plan.queue) {
    const k = lineKeyOf(q);
    const was = merged.get(k);
    merged.set(k, was ? { ...was, qty: Math.min(q.확정수량, was.qty + q.qty) } : { ...q });
  }
  plan.queue = [...merged.values()];
  // 준비됨: 바뀐 한중발주(닫는 건 포함)에서 도착분으로 다 채워진 줄을 전후 비교.
  const pre = new Map<string, FillLine>();
  const post = new Map<string, FillLine>();
  if (extra) {
    arrivedLineKeys(extra.before).forEach((v, k) => pre.set(k, v));
    arrivedLineKeys(extra.after).forEach((v, k) => post.set(k, v));
  }
  for (const c of touched) {
    arrivedLineKeys(before.get(c)!).forEach((v, k) => pre.set(k, v));
    arrivedLineKeys(work.get(c)!).forEach((v, k) => post.set(k, v));
  }
  post.forEach((v, k) => { if (!pre.has(k)) plan.readyOn.push(v); });
  pre.forEach((v, k) => { if (!post.has(k)) plan.readyOff.push(v); });
  // 배정을 내준 줄은 더 이상 다 갖춰진 게 아니다.
  for (const l of lostLines) if (!plan.readyOff.some(x => sameLineKey(x, l))) plan.readyOff.push(l);
  return plan;
};
