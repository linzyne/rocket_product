// 회송. 쉽먼트로 쿠팡에 보낸 수량보다 쿠팡 입고(물류창고입고)가 적은 줄을 찾아, 회송으로 처리하면 사무실 재고로 되돌린다.
//
//  coupangReturns : 문서 id = 발주번호|상품 열쇠  { 발주번호, 상품이름, qty, kind, at }
//    kind 'returned' = 회송 처리함(그 수량을 한중발주 줄의 회송 칸에 더했다) / 'ignored' = 회송 아님(숨기기)
//
// 보낸 수량 = 쉽먼트 기록의 박스 줄 합(같은 발주를 여러 번 예약했으면 가장 큰 기록 하나).
// 입고 수량 = 그 발주번호의 입고상세내역(반출 제외). 입고 내역이 하나도 없는 발주는 아직 안 들어간 것이라 보지 않는다.
// 정산은 입고 내역으로 계산하므로 이미 빠져 있다. 여기서는 재고만 되돌린다.
import { collection, doc, setDoc } from 'firebase/firestore';
import { db, ensureSignedIn, onSnapshot } from '../utils/firebase';
import { HanjungOrder, saveHanjungOrder, sameName, nameKey, lineAlloc, addHoldingStock } from './hanjungStore';
import { ReceiveRow, norm } from './receiveStore';
import { ShipmentBatch, allBoxes } from './shipmentStore';

export interface ReturnMark {
  id: string;
  발주번호: string;
  상품이름: string;
  qty: number;
  kind: 'returned' | 'ignored';
  at: number;
}

export interface ReturnCandidate {
  id: string;
  발주번호: string;
  상품이름: string;
  center: string;
  shipped: number;
  received: number;
  done: number; // 이미 회송 처리·숨긴 수량
  left: number; // 아직 확인 안 한 차이
  lastIn: string; // 마지막 입고일
  batchId: string;
}

const COLLECTION = 'coupangReturns';
const LOCAL_KEY = 'coupangReturns';
const CHANGED = 'coupang-returns-changed';

export const returnId = (no: string, name: string) => `${no}|${nameKey(name)}`.replace(/\//g, '∕');

const readLocal = (): Record<string, ReturnMark[]> => {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '') || {}; } catch { return {}; }
};

// 문서 하나에 처리 기록 여러 개(나눠서 회송 처리할 수 있어서).
export const subscribeReturns = (listener: (marks: Record<string, ReturnMark[]>) => void): (() => void) => {
  if (!db) {
    const emit = () => listener(readLocal());
    emit();
    window.addEventListener(CHANGED, emit);
    return () => window.removeEventListener(CHANGED, emit);
  }
  const firestore = db;
  let cancelled = false;
  let unsubscribe: (() => void) | undefined;
  (async () => {
    await ensureSignedIn();
    if (cancelled) return;
    unsubscribe = onSnapshot(
      collection(firestore, COLLECTION),
      snap => listener(Object.fromEntries(snap.docs.map(d => [d.id, ((d.data().marks || []) as ReturnMark[])]))),
      error => console.error('회송 기록 동기화 실패:', error)
    );
  })();
  return () => {
    cancelled = true;
    unsubscribe?.();
  };
};

const saveMarks = async (id: string, marks: ReturnMark[]) => {
  if (!db) {
    const s = readLocal();
    s[id] = marks;
    localStorage.setItem(LOCAL_KEY, JSON.stringify(s));
    window.dispatchEvent(new CustomEvent(CHANGED));
    return;
  }
  await ensureSignedIn();
  await setDoc(doc(db, COLLECTION, id), { marks });
};

// 입고 줄이 이 발주의 이 상품 것인지. 발주에 상품이 하나뿐이면 발주번호만 맞으면 된다.
const rowIsFor = (r: ReceiveRow, name: string, single: boolean) => {
  if (single) return true;
  const a = norm(r.skuName);
  const b = norm(name);
  return a === b || (!!a && !!b && (a.includes(b) || b.includes(a)));
};

export const findReturnCandidates = (
  batches: ShipmentBatch[],
  receives: ReceiveRow[],
  marks: Record<string, ReturnMark[]>,
): ReturnCandidate[] => {
  // 보낸 수량: 기록마다 발주·상품별로 합치고, 기록끼리는 큰 쪽을 쓴다(다시 예약한 기록이 겹칠 수 있어서).
  const shipped = new Map<string, { 발주번호: string; 상품이름: string; center: string; qty: number; batchId: string }>();
  for (const b of batches) {
    const mine = new Map<string, { 발주번호: string; 상품이름: string; center: string; qty: number }>();
    for (const box of allBoxes(b)) {
      for (const l of box.lines) {
        const no = String(l.발주번호 || '').trim();
        if (!no) continue;
        const k = returnId(no, l.상품이름);
        const e = mine.get(k) || { 발주번호: no, 상품이름: l.상품이름, center: box.center, qty: 0 };
        e.qty += Number(l.확정수량) || 0;
        mine.set(k, e);
      }
    }
    mine.forEach((e, k) => {
      const prev = shipped.get(k);
      if (!prev || e.qty > prev.qty) shipped.set(k, { ...e, batchId: b.id });
    });
  }

  const byOrder = new Map<string, ReceiveRow[]>();
  for (const r of receives) {
    if (/반출/.test(r.구분)) continue;
    const no = String(r.발주번호 || '').trim();
    byOrder.set(no, [...(byOrder.get(no) || []), r]);
  }
  const productsPerOrder = new Map<string, number>();
  shipped.forEach(e => productsPerOrder.set(e.발주번호, (productsPerOrder.get(e.발주번호) || 0) + 1));

  const out: ReturnCandidate[] = [];
  shipped.forEach((e, id) => {
    const rows = byOrder.get(e.발주번호);
    if (!rows?.length) return;
    const mine = rows.filter(r => rowIsFor(r, e.상품이름, productsPerOrder.get(e.발주번호) === 1));
    const received = mine.reduce((s, r) => s + (Number(r.qty) || 0), 0);
    const done = (marks[id] || []).reduce((s, m) => s + m.qty, 0);
    const left = e.qty - received - done;
    if (left <= 0) return;
    const lastIn = (mine.length ? mine : rows).map(r => r.date).sort().pop() || '';
    out.push({ id, 발주번호: e.발주번호, 상품이름: e.상품이름, center: e.center, shipped: e.qty, received, done, left, lastIn, batchId: e.batchId });
  });
  return out.sort((a, b) => b.lastIn.localeCompare(a.lastIn) || a.발주번호.localeCompare(b.발주번호));
};

// 회송 처리: 이 발주·상품을 맡은 한중발주 줄의 회송 칸에 수량을 더한다(배정한 만큼까지, 오래된 건부터).
// 맡은 한중발주 줄이 없거나 모자라면 남은 만큼은 "0) 보유재고"에 원가 0으로 넣는다.
// 돌려주는 값: 한중발주에 넣은 곳들과 보유재고로 넣은 수량.
export const markReturned = async (orders: HanjungOrder[], c: ReturnCandidate, qty: number, marks: ReturnMark[]) => {
  let left = Math.floor(qty);
  if (left <= 0) return { codes: [] as string[], holding: 0 };
  const codes: string[] = [];
  const sorted = [...orders].sort((a, b) => a.createdAt - b.createdAt);
  for (const o of sorted) {
    if (left <= 0) break;
    const same = o.lines.filter(l => l.발주번호 === c.발주번호);
    const targets = same.length === 1 && !same.some(l => sameName(l.상품이름, c.상품이름))
      ? same
      : same.filter(l => sameName(l.상품이름, c.상품이름));
    if (!targets.length) continue;
    let changed = false;
    const lines = o.lines.map(l => {
      if (left <= 0 || !targets.includes(l)) return l;
      const room = lineAlloc(l) - (l.회송 || 0);
      const take = Math.min(room, left);
      if (take <= 0) return l;
      left -= take;
      changed = true;
      return { ...l, 회송: (l.회송 || 0) + take };
    });
    if (changed) {
      await saveHanjungOrder({ ...o, lines });
      codes.push(o.code);
    }
  }
  const holding = left;
  if (holding > 0) await addHoldingStock(orders, c.상품이름, holding, 0);
  await saveMarks(c.id, [...marks, { id: c.id, 발주번호: c.발주번호, 상품이름: c.상품이름, qty: Math.floor(qty), kind: 'returned', at: Date.now() }]);
  return { codes, holding };
};

// 회송 아님(입고가 늦게 잡히는 것 말고, 분실 등으로 재고에 안 돌아온 것): 재고는 두고 목록에서만 뺀다.
export const markIgnored = (c: ReturnCandidate, marks: ReturnMark[]) =>
  saveMarks(c.id, [...marks, { id: c.id, 발주번호: c.발주번호, 상품이름: c.상품이름, qty: c.left, kind: 'ignored', at: Date.now() }]);
