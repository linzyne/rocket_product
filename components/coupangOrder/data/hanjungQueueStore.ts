// 한중발주 대기(1688에 주문할 상품 줄). 쿠팡발주확인 발송 목록에서 "한중"을 누르면 여기에 쌓인다.
// 예약과는 따로 둔다: 그 줄이 예약·쉽먼트·발송 등 다른 단계로 넘어가도 여기서는 사라지지 않고,
// 한중발주에서 "주문완료"(한중발주 만들기)를 하거나 직접 뺄 때만 빠진다.
//
//  hanjungQueue : 문서 id = 발주번호·상품이름·확정수량으로 만든 키(같은 줄은 한 번만).
//
// Firebase 설정이 없으면 이 기기의 localStorage에만 저장한다.
import { collection, doc, onSnapshot, writeBatch, deleteDoc } from 'firebase/firestore';
import { db, ensureSignedIn, waitAtMost } from '../../../utils/firebase';
import type { OrderRow } from '../types';
import { dateKeyYMD, normalizeDateValue } from '../utils/dateUtils';

const COLLECTION = 'hanjungQueue';
const LOCAL_KEY = 'hanjungQueue';

export interface HanjungQueueItem {
  key: string;
  발주번호: string;
  물류센터: string;
  상품이름: string;
  확정수량: number | '';
  입고예정일: string; // YYYYMMDD
  addedAt: number;
  // 쿠팡 줄 일부만 대기에 둘 때 그 수량(나머지는 한중발주가 맡음). 없으면 확정수량 전부.
  배정?: number;
}

// 대기 줄 하나가 맡은 수량.
export const queueAlloc = (q: HanjungQueueItem) => q.배정 ?? (Number(q.확정수량) || 0);

// 줄(행)을 대기에 넣을 때 쓰는 모양. 배정이 있으면 그 수량만 대기에 둔다.
export type QueueRow = OrderRow & { 배정?: number };

// 날짜·센터는 묶음 적용 등으로 바뀔 수 있어 열쇠에서 뺀다(바뀌어도 같은 줄로 본다).
export const hanjungQueueKey = (r: { 발주번호?: unknown; 상품이름?: unknown; 확정수량?: unknown }) =>
  `${String(r.발주번호 ?? '').trim()}│${String(r.상품이름 ?? '').trim()}│${String(r.확정수량 ?? '').trim()}`.replace(/\//g, '∕');

const toItem = (r: QueueRow, addedAt: number): HanjungQueueItem => ({
  key: hanjungQueueKey(r),
  발주번호: r.발주번호,
  물류센터: r.물류센터,
  상품이름: r.상품이름,
  확정수량: r.확정수량,
  입고예정일: dateKeyYMD(r.입고예정일).replace(/-/g, ''),
  addedAt,
  ...(r.배정 != null && r.배정 !== Number(r.확정수량) ? { 배정: r.배정 } : {}),
});

// 화면에서 쓰기 쉽게 OrderRow 모양으로도 돌려준다.
export const queueItemToRow = (q: HanjungQueueItem): QueueRow => ({
  발주번호: q.발주번호,
  물류센터: q.물류센터,
  상품이름: q.상품이름,
  확정수량: q.확정수량,
  입고예정일: normalizeDateValue(q.입고예정일),
  메모: '',
  쉼먼트: '',
  ...(q.배정 != null ? { 배정: q.배정 } : {}),
});

type Listener = (items: HanjungQueueItem[]) => void;
const localListeners = new Set<Listener>();
const readLocal = (): Record<string, HanjungQueueItem> => {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || '') || {};
  } catch {
    return {};
  }
};
const sortItems = (list: HanjungQueueItem[]) => list.sort((a, b) => a.addedAt - b.addedAt);
const emitLocal = (state: Record<string, HanjungQueueItem>) => {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
  const items = sortItems(Object.values(state));
  localListeners.forEach(l => l(items));
};

export const subscribeHanjungQueue = (listener: Listener): (() => void) => {
  if (!db) {
    listener(sortItems(Object.values(readLocal())));
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
      snap => listener(sortItems(snap.docs.map(d => d.data() as HanjungQueueItem))),
      error => console.error('한중발주 대기 동기화 실패:', error),
    );
  })();
  return () => {
    cancelled = true;
    unsubscribe?.();
  };
};

// 줄들을 대기에 더한다. 이미 있는 줄은 그대로 둔다(처음 넣은 시각 유지).
export const addToHanjungQueue = async (rows: QueueRow[], existing: HanjungQueueItem[]) => {
  const have = new Set(existing.map(q => q.key));
  const now = Date.now();
  const fresh = rows.filter(r => !have.has(hanjungQueueKey(r))).map(r => toItem(r, now));
  if (!fresh.length) return 0;
  if (!db) {
    const s = readLocal();
    fresh.forEach(q => { s[q.key] = q; });
    emitLocal(s);
    return fresh.length;
  }
  const firestore = db;
  await ensureSignedIn();
  for (let i = 0; i < fresh.length; i += 450) {
    const batch = writeBatch(firestore);
    fresh.slice(i, i + 450).forEach(q => batch.set(doc(firestore, COLLECTION, q.key), q));
    await waitAtMost(batch.commit());
  }
  return fresh.length;
};

// 대기에서 뺀다(열쇠로).
export const removeFromHanjungQueue = async (keys: string[]) => {
  if (!keys.length) return;
  if (!db) {
    const s = readLocal();
    keys.forEach(k => { delete s[k]; });
    emitLocal(s);
    return;
  }
  const firestore = db;
  await ensureSignedIn();
  if (keys.length === 1) {
    await deleteDoc(doc(firestore, COLLECTION, keys[0]));
    return;
  }
  for (let i = 0; i < keys.length; i += 450) {
    const batch = writeBatch(firestore);
    keys.slice(i, i + 450).forEach(k => batch.delete(doc(firestore, COLLECTION, k)));
    await waitAtMost(batch.commit());
  }
};

// 쿠팡 줄 하나가 한중 어디에 몇 개씩 맡겨져 있는지. code가 null이면 발주 대기.
// 한 줄을 여유 있는 한중발주와 발주 대기로 나눠 맡길 수 있어서 여러 곳일 수 있다.
export type HanjungPlace = { code: string | null; qty: number };
export const makePlaceLookup = (
  orders: { code: string; lines: { 발주번호: string; 상품이름: string; 확정수량: number; 배정?: number }[] }[],
  queue: HanjungQueueItem[],
) => {
  const m = new Map<string, HanjungPlace[]>();
  const push = (k: string, p: HanjungPlace) => m.set(k, [...(m.get(k) || []), p]);
  for (const o of orders) for (const l of o.lines) push(hanjungQueueKey(l), { code: o.code, qty: l.배정 ?? l.확정수량 });
  for (const q of queue) push(q.key, { code: null, qty: queueAlloc(q) });
  return (line: { 발주번호?: unknown; 상품이름?: unknown; 확정수량?: unknown }): HanjungPlace[] => m.get(hanjungQueueKey(line)) || [];
};

// 한중발주에서 뺀 줄을 발주 대기로 돌린다. 같은 쿠팡 줄의 나머지가 이미 대기에 있으면 수량을 합친다
// (한 줄을 한중발주와 대기에 나눠 맡긴 경우). 합쳐서 줄 전체가 되면 배정 표시는 뗀다.
export const returnToHanjungQueue = async (rows: QueueRow[], queue: HanjungQueueItem[]) => {
  const have = new Map(queue.map(q => [q.key, q]));
  const merged = rows.map(r => {
    const full = Number(r.확정수량) || 0;
    const add = r.배정 ?? full;
    const cur = have.get(hanjungQueueKey(r));
    const sum = Math.min(full, (cur ? queueAlloc(cur) : 0) + add);
    const { 배정: _drop, ...rest } = r;
    return sum === full ? rest : { ...rest, 배정: sum };
  });
  const keys = merged.map(r => hanjungQueueKey(r)).filter(k => have.has(k));
  if (keys.length) await removeFromHanjungQueue(keys);
  return addToHanjungQueue(merged, []);
};
