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
}

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
if (!db) aliasState = readLocalAliases();
const setAliasState = (next: AliasState) => {
  aliasState = next;
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
  if (!db) {
    localStorage.setItem(ALIAS_LOCAL_KEY, JSON.stringify(next));
    return;
  }
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
export const receiptTotalCost = (r: HanjungReceipt) => receiptGoodsCost(r) + r.관세사비 + r.배송비 + r.작업비;

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

export const removeReceipt = (order: HanjungOrder, receiptId: string) =>
  saveHanjungOrder({ ...order, receipts: order.receipts.filter(r => r.id !== receiptId) });
