// 물류창고입고 = 쿠팡 입고(정산) 내역. 서허 "입고상세내역" 표를 "로켓 서허 연동" 확장이 모아 온 것.
// 발주번호로 한중발주의 쿠팡 발주 줄과 짝을 지어, 한중발주별로 얼마나 입고·정산됐는지 계산한다.
//
//  coupangReceives : 문서 id = 구분|발주번호|SKU번호|입고일시 (같은 줄은 덮어씀)
//
// Firebase 설정이 없으면 이 기기의 localStorage에만 저장한다.
import { collection, doc, writeBatch, deleteDoc } from 'firebase/firestore';
import { db, ensureSignedIn, waitAtMost, onSnapshot } from '../utils/firebase';
import { lineAlloc, productSummary } from './hanjungStore';
import type { HanjungOrder, HanjungLine } from './hanjungStore';
import type { ReturnMark } from './returnStore';

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
// 이 한중발주 줄이 쿠팡에 실제로 넣을 수 있는 수량(배정 − 회송).
const lineCap = (l: HanjungLine) => Math.max(0, lineAlloc(l) - (l.회송 || 0));

// marks = 쿠팡발송에서 처리한 회송·분실·미입고 기록. 분실·미입고는 lost로 돌려준다(매출에서 뺄 수량, 재고는 그대로).
export const settlementOf = (order: HanjungOrder, rows: ReceiveRow[], others: HanjungOrder[] = [], marks: ReturnMark[] = []) => {
  const byLine = new Map<HanjungLine, { qty: number; total: number; supply: number; row: ReceiveRow }>();
  const matched: ReceiveRow[] = [];
  for (const r of rows) {
    const line = matchLine(order, r);
    if (!line) continue;
    const k = sign(r);
    const e = byLine.get(line) || { qty: 0, total: 0, supply: 0, row: r };
    e.qty += k * r.qty;
    e.total += k * r.total;
    e.supply += k * r.totalSupply;
    byLine.set(line, e);
    matched.push(r);
  }
  // 같은 쿠팡 줄(발주번호·상품)을 다른 한중발주도 나눠 맡았으면, 입고는 먼저 만든 한중발주부터 채운다.
  // (각자 min(배정, 입고)로 세면 같은 입고가 두 건에 다 잡혀 중복된다)
  // 다른 건의 줄도 matchLine으로 찾아서, 입고 줄을 짝짓는 기준과 똑같이 맞춘다.
  const earlierTake = (row: ReceiveRow) => {
    let sum = 0;
    for (const o of others) {
      if (o.code === order.code || !isEarlier(o, order)) continue;
      const l = matchLine(o, row);
      if (l) sum += lineCap(l);
    }
    return sum;
  };
  let qty = 0;
  let total = 0;
  let supply = 0;
  const byProduct = new Map<string, number>();
  const lines = new Map<string, { qty: number; total: number }>();
  byLine.forEach((e, line) => {
    const take = Math.max(0, Math.min(lineAlloc(line), e.qty - earlierTake(e.row)));
    const ratio = e.qty > 0 ? take / e.qty : 0;
    qty += take;
    total += e.total * ratio;
    supply += e.supply * ratio;
    byProduct.set(line.상품이름, (byProduct.get(line.상품이름) || 0) + take);
    lines.set(line.key, { qty: take, total: Math.round(e.total * ratio) });
  });
  // 분실·미입고: 쿠팡 줄(발주번호·상품)마다 처리한 수량을, 그 줄을 맡은 한중발주들의 "아직 입고 안 된 자리"에
  // 먼저 만든 건부터 나눠 넣는다(입고를 먼저 만든 건부터 채우는 것과 같은 순서).
  const lost = new Map<string, number>();
  const lostSum = new Map<HanjungLine, { n: number; row: ReceiveRow }>();
  for (const m of marks) {
    if (m.kind === 'returned' || !(m.qty > 0)) continue;
    const row = { 발주번호: m.발주번호, skuName: m.상품이름 } as ReceiveRow;
    const line = matchLine(order, row);
    if (!line) continue;
    const e = lostSum.get(line) || { n: 0, row };
    e.n += m.qty;
    lostSum.set(line, e);
  }
  lostSum.forEach(({ n, row }, line) => {
    const received = byLine.get(line)?.qty || 0;
    const group = [order, ...others.filter(o => o.code !== order.code)]
      .map(o => ({ o, l: o === order ? line : matchLine(o, row) }))
      .filter((x): x is { o: HanjungOrder; l: HanjungLine } => !!x.l)
      .sort((a, b) => (isEarlier(a.o, b.o) ? -1 : isEarlier(b.o, a.o) ? 1 : 0));
    let recLeft = received;
    let lostLeft = n;
    for (const g of group) {
      const cap = lineCap(g.l);
      const take = Math.max(0, Math.min(cap, recLeft));
      recLeft -= take;
      const mine = Math.max(0, Math.min(cap - take, lostLeft));
      lostLeft -= mine;
      if (g.o === order) { if (mine > 0) lost.set(line.key, mine); break; }
    }
  });
  return { qty, total: Math.round(total), supply: Math.round(supply), byProduct, byLine: lines, rows: matched, lost };
};

// 먼저 만든 건(같은 시각이면 고유번호 순)이 입고를 먼저 받는다.
const isEarlier = (a: HanjungOrder, b: HanjungOrder) => a.createdAt < b.createdAt || (a.createdAt === b.createdAt && a.code < b.code);

// 검산: 쿠팡 줄(발주번호·상품)마다 실제 입고 수량과, 한중발주들이 나눠 센 수량의 합을 맞춰 본다.
//  double  = 여러 건이 센 합이 실제 입고보다 많음(중복 — 계산 잘못)
//  missing = 맡은 건들이 받을 자리가 있는데 덜 셈(계산 잘못)
//  over    = 쿠팡에 배정 합보다 더 들어옴(어느 건에도 안 잡힌 입고 — 배정 확인 필요)
//  orphan  = 어느 한중발주에도 짝이 없는 입고
export type ReceiveIssue = { kind: 'double' | 'missing' | 'over' | 'orphan' | 'overAlloc' | 'soldMore'; 발주번호: string; skuName: string; received: number; counted: number; cap: number; codes: string[] };
export const checkReceives = (orders: HanjungOrder[], rows: ReceiveRow[]): ReceiveIssue[] => {
  const groups = new Map<string, ReceiveRow[]>();
  for (const r of rows) {
    const k = `${r.발주번호}|${norm(r.skuName)}`;
    const g = groups.get(k);
    if (g) g.push(r); else groups.set(k, [r]);
  }
  const settles = new Map(orders.map(o => [o.code, settlementOf(o, rows, orders)]));
  const issues: ReceiveIssue[] = [];
  groups.forEach(g => {
    const r0 = g[0];
    const received = g.reduce((s, r) => s + sign(r) * r.qty, 0);
    let counted = 0;
    let cap = 0;
    const codes: string[] = [];
    for (const o of orders) {
      const l = matchLine(o, r0);
      if (!l) continue;
      codes.push(o.code);
      cap += lineCap(l);
      counted += settles.get(o.code)?.byLine.get(l.key)?.qty || 0;
    }
    const base = { 발주번호: r0.발주번호, skuName: r0.skuName, received, counted, cap, codes };
    if (!codes.length) { if (received > 0) issues.push({ kind: 'orphan', ...base }); return; }
    if (counted > received) issues.push({ kind: 'double', ...base });
    else if (counted < Math.min(received, cap)) issues.push({ kind: 'missing', ...base });
    if (received > cap) issues.push({ kind: 'over', ...base });
  });
  // 쿠팡 줄 하나를 여러 건이 확정수량보다 많이 배정 → 매출이 두 번 잡힌다.
  const alloc = new Map<string, ReceiveIssue>();
  for (const o of orders) for (const l of o.lines) {
    const k = `${l.발주번호}|${norm(l.상품이름)}`;
    const e = alloc.get(k) || { kind: 'overAlloc' as const, 발주번호: l.발주번호, skuName: l.상품이름, received: l.확정수량, counted: 0, cap: 0, codes: [] };
    e.counted += lineAlloc(l);
    e.codes.push(o.code);
    alloc.set(k, e);
  }
  alloc.forEach(e => { if (e.counted > e.received) issues.push(e); });
  // 한 건에서 판(배정) 수량이 산 수량보다 많음 → 매입 없이 매출만 잡힌다.
  for (const o of orders) for (const p of productSummary(o)) {
    const have = Math.max(p.ordered, p.received);
    if (p.allocated > have) issues.push({ kind: 'soldMore', 발주번호: '', skuName: p.상품이름, received: have, counted: p.allocated, cap: have, codes: [o.code] });
  }
  return issues;
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
