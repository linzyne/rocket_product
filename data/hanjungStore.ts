// 한중발주건. 발주 흐름(쿠팡발주확인 → 한중발주 → 수입입고 → 물류창고입고/정산)을 이 한 건에 모아 추적한다.
//
//  hanjungOrders : 문서 id = 한중발주 고유번호(code).
//    lines    : 이 한중발주로 넘긴 쿠팡 발주 줄들. 같은 상품 여러 줄을 합쳐 1688에 한 번에 주문한다.
//    receipts : 수입입고 기록. 나눠서 도착하면 여러 번 쌓인다. 상품별 수량·단가와 관세사비·배송비·작업비.
//
// Firebase 설정이 없으면 이 기기의 localStorage에만 저장한다.
import { collection, doc, onSnapshot, setDoc, deleteDoc } from 'firebase/firestore';
import { db, ensureSignedIn } from '../utils/firebase';

export interface HanjungLine {
  key: string;
  발주번호: string;
  물류센터: string;
  상품이름: string;
  확정수량: number;
  입고예정일: string; // YYYYMMDD
}

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
}

const COLLECTION = 'hanjungOrders';
const LOCAL_KEY = 'hanjungOrders';

// ---- 계산 ----

// 상품별 발주수량·입고수량. 상품 순서는 발주 줄 순서를 따른다.
export const productSummary = (order: HanjungOrder) => {
  const map = new Map<string, { 상품이름: string; ordered: number; received: number; cost: number }>();
  for (const l of order.lines) {
    const e = map.get(l.상품이름) || { 상품이름: l.상품이름, ordered: 0, received: 0, cost: 0 };
    e.ordered += l.확정수량;
    map.set(l.상품이름, e);
  }
  for (const r of order.receipts) {
    for (const it of r.items) {
      const e = map.get(it.상품이름) || { 상품이름: it.상품이름, ordered: 0, received: 0, cost: 0 };
      e.received += it.qty;
      e.cost += it.qty * it.unitCost;
      map.set(it.상품이름, e);
    }
  }
  return Array.from(map.values());
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
      snap => listener(sortOrders(snap.docs.map(d => d.data() as HanjungOrder))),
      error => console.error('한중발주 동기화 실패:', error)
    );
  })();
  return () => {
    cancelled = true;
    unsubscribe?.();
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
