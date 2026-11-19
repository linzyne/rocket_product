// 물류창고입고 = 쿠팡 입고(정산) 내역. 서허 "입고상세내역" 표를 "로켓 서허 연동" 확장이 모아 온 것.
// 발주번호로 한중발주의 쿠팡 발주 줄과 짝을 지어, 한중발주별로 얼마나 입고·정산됐는지 계산한다.
//
//  coupangReceives : 문서 id = 구분|발주번호|SKU번호|입고일시 (같은 줄은 덮어씀)
//
// Firebase 설정이 없으면 이 기기의 localStorage에만 저장한다.
import { collection, doc, writeBatch, deleteDoc } from 'firebase/firestore';
import { db, ensureSignedIn, waitAtMost, onSnapshot } from '../utils/firebase';
import { lineAlloc } from './hanjungStore';
import type { HanjungOrder, HanjungLine } from './hanjungStore';

export interface ReceiveRow {
  key: string;
  구분: string; // 발주 / 반출
  발주번호: string;
  sku: string;
  skuName: string;
  date: string; // 입고/반출일자 (예: 2026-09-22 11:55:13)
  center: string;
  qty: number;
  unitPrice: number; // 단가(부가세 포함)
  supply: number;
  tax: number;
  total: number; // 총 단가 = 수량 × 단가 (부가세 포함)
  totalSupply: number; // 총 공급가액 (부가세 제외)
  totalTax: number;
  invoiceNo: string;
  payDate: string;
  importedAt: number;
}

const COLLECTION = 'coupangReceives';
const LOCAL_KEY = 'coupangReceives';

// 반출(반품)은 수량·금액을 빼서 계산한다.
export const sign = (r: ReceiveRow) => (/반출/.test(r.구분) ? -1 : 1);

export const norm = (s: string) => s.toLowerCase().replace(/[\s,.\-_()[\]/·]+/g, '');

// 한중발주의 쿠팡 발주 줄 중 이 입고 줄과 맞는 것. 발주번호가 같고 상품명도 맞아야 한다.
// (한 발주서에 다른 상품이 같이 있으면, 이 건이 그 발주서의 한 상품만 맡았어도 다른 상품 입고가 섞이지 않게)
export const matchLine = (order: HanjungOrder, r: ReceiveRow) => {
  const same = order.lines.filter(l => l.발주번호 === r.발주번호);
  if (!same.length) return null;
  const n = norm(r.skuName);
  if (!n) return same.length === 1 ? same[0] : null;
  return same.find(l => norm(l.상품이름) === n) || same.find(l => n.includes(norm(l.상품이름)) || norm(l.상품이름).includes(n)) || null;
};

// 입고 줄 → 그 줄이 속한 한중발주 고유번호.
export const hanjungCodeOf = (orders: HanjungOrder[], r: ReceiveRow) => {
  for (const o of orders) if (matchLine(o, r)) return o.code;
  return null;
};

// 한중발주 하나의 쿠팡 입고·정산 합계와 상품별 입고 수량.
// 발주 줄 하나를 한중발주 여러 건이 나눠 맡을 수 있어서, 줄마다 이 건이 맡은 수량(배정)까지만 센다(금액은 그 비율만큼).
// total = 부가세 포함(쿠팡 발주금액과 같은 기준), supply = 부가세 제외. byLine = 발주 줄 key별 이 건 몫의 입고 수량·금액.
export const settlementOf = (order: HanjungOrder, rows: ReceiveRow[], others: HanjungOrder[] = []) => {
  const byLine = new Map<HanjungLine, { qty: number; total: number; supply: number }>();
  const matched: ReceiveRow[] = [];
  for (const r of rows) {
    const line = matchLine(order, r);
    if (!line) continue;
    const k = sign(r);
    const e = byLine.get(line) || { qty: 0, total: 0, supply: 0 };
    e.qty += k * r.qty;
    e.total += k * r.total;
    e.supply += k * r.totalSupply;
    byLine.set(line, e);
    matched.push(r);
  }
  let qty = 0;
  let total = 0;
  let supply = 0;
  const byProduct = new Map<string, number>();
  const lines = new Map<string, { qty: number; total: number }>();
  // 같은 쿠팡 줄(발주번호·상품)을 다른 한중발주도 나눠 맡았으면, 입고는 먼저 만든 한중발주부터 채운다.
  // (각자 min(배정, 입고)로 세면 같은 입고가 두 건에 다 잡혀 중복된다)
  const earlierTake = (line: HanjungLine) => {
    let sum = 0;
    for (const o of others) {
      if (o.code === order.code || o.createdAt >= order.createdAt) continue;
      for (const l of o.lines) {
        if (l.발주번호 !== line.발주번호 || norm(l.상품이름) !== norm(line.상품이름)) continue;
        sum += lineAlloc(l);
      }
    }
    return sum;
  };
  byLine.forEach((e, line) => {
    const take = Math.max(0, Math.min(lineAlloc(line), e.qty - earlierTake(line)));
    const ratio = e.qty > 0 ? take / e.qty : 0;
    qty += take;
    total += e.total * ratio;
    supply += e.supply * ratio;
    byProduct.set(line.상품이름, (byProduct.get(line.상품이름) || 0) + take);
    lines.set(line.key, { qty: take, total: Math.round(e.total * ratio) });
  });
  return { qty, total: Math.round(total), supply: Math.round(supply), byProduct, byLine: lines, rows: matched };
};

type Listener = (rows: ReceiveRow[]) => void;
const localListeners = new Set<Listener>();
const readLocal = (): Record<string, ReceiveRow> => {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || '') || {};
  } catch {
    return {};
  }
};
const sortRows = (rows: ReceiveRow[]) => rows.sort((a, b) => b.date.localeCompare(a.date) || a.발주번호.localeCompare(b.발주번호));
const writeLocal = (state: Record<string, ReceiveRow>) => {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
  const list = sortRows(Object.values(state));
  localListeners.forEach(l => l(list));
};

export const subscribeReceives = (listener: Listener): (() => void) => {
  if (!db) {
    listener(sortRows(Object.values(readLocal())));
    localListeners.add(listener);
    return () => localListeners.delete(listener);
  }
  const firestore = db;
  let cancelled = false;
  let unsubscribe: (() => void) | undefined;
  (async () => {
    await ensureSignedIn();
    if (cancelled) return;
    unsubscribe = onSnapshot(
      collection(firestore, COLLECTION),
      snap => listener(sortRows(snap.docs.map(d => d.data() as ReceiveRow))),
      error => console.error('입고 내역 동기화 실패:', error)
    );
  })();
  return () => {
    cancelled = true;
    unsubscribe?.();
  };
};

const docId = (key: string) => key.replace(/\//g, '∕');

export const saveReceives = async (rows: Omit<ReceiveRow, 'importedAt'>[]) => {
  const now = Date.now();
  const list = rows.map(r => ({ ...r, importedAt: now }));
  if (!list.length) return 0;
  if (!db) {
    const s = readLocal();
    list.forEach(r => { s[r.key] = r; });
    writeLocal(s);
    return list.length;
  }
  const firestore = db;
  await ensureSignedIn();
  for (let i = 0; i < list.length; i += 450) {
    const batch = writeBatch(firestore);
    list.slice(i, i + 450).forEach(r => batch.set(doc(firestore, COLLECTION, docId(r.key)), r));
    await waitAtMost(batch.commit());
  }
  return list.length;
};

// 여러 줄 한 번에 지우기(잘못 가져온 날짜를 골라 지울 때).
export const deleteReceives = async (keys: string[]) => {
  if (!keys.length) return 0;
  if (!db) {
    const s = readLocal();
    keys.forEach(k => { delete s[k]; });
    writeLocal(s);
    return keys.length;
  }
  const firestore = db;
  await ensureSignedIn();
  for (let i = 0; i < keys.length; i += 450) {
    const batch = writeBatch(firestore);
    keys.slice(i, i + 450).forEach(k => batch.delete(doc(firestore, COLLECTION, docId(k))));
    await waitAtMost(batch.commit());
  }
  return keys.length;
};

export const deleteReceive = async (key: string) => {
  if (!db) {
    const s = readLocal();
    delete s[key];
    writeLocal(s);
    return;
  }
  await ensureSignedIn();
  await deleteDoc(doc(db, COLLECTION, docId(key)));
};
