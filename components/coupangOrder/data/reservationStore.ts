// 쿠팡발주확인의 예약 목록. "예약 넘기기"로 옮긴 항목을 계속 쌓아 두고, 새 파일을 올리거나 앱을 껐다
// 켜도 지워지지 않는다. 사람이 삭제 버튼을 누를 때만 지워진다.
//
//  coupangReservations : 문서 id = 발주번호·상품이름·확정수량·입고예정일로 만든 키(같은 건은 한 번만 저장).
//
// Firebase 설정이 없으면 이 기기의 localStorage에만 저장한다.
import { collection, doc, onSnapshot, writeBatch, setDoc, deleteDoc, updateDoc } from 'firebase/firestore';
import { db, ensureSignedIn } from '../../../utils/firebase';
import type { OrderRow } from '../types';
import { dateKeyYMD, normalizeDateValue, ymdSortKey } from '../utils/dateUtils';

const COLLECTION = 'coupangReservations';
const LOCAL_KEY = 'coupangReservations';

// 저장 모양. 입고예정일은 날짜 객체를 그대로 못 넣으므로 'YYYYMMDD' 글자로 둔다.
interface StoredReservation {
  key: string;
  발주번호: string;
  물류센터: string;
  상품이름: string;
  확정수량: number | '';
  입고예정일: string;
  메모: string;
  쉼먼트: string;
  savedAt: number;
}

export const reservationKey = (r: Pick<OrderRow, '발주번호' | '상품이름' | '확정수량' | '입고예정일'>) =>
  // Firestore 문서 id에는 '/'를 쓸 수 없어서 바꿔 둔다.
  `${r.발주번호}│${r.상품이름}│${r.확정수량}│${dateKeyYMD(r.입고예정일)}`.replace(/\//g, '∕');

const toStored = (r: OrderRow, savedAt: number): StoredReservation => ({
  key: reservationKey(r),
  발주번호: r.발주번호,
  물류센터: r.물류센터,
  상품이름: r.상품이름,
  확정수량: r.확정수량,
  입고예정일: dateKeyYMD(r.입고예정일).replace(/-/g, ''),
  메모: r.메모,
  쉼먼트: r.쉼먼트,
  savedAt,
});

const fromStored = (s: StoredReservation): OrderRow => ({
  발주번호: s.발주번호,
  물류센터: s.물류센터,
  상품이름: s.상품이름,
  확정수량: s.확정수량,
  입고예정일: normalizeDateValue(s.입고예정일),
  메모: s.메모,
  쉼먼트: s.쉼먼트 || '',
});

// 발주서를 읽을 때와 같은 순서: 입고예정일 → 물류센터 → 발주번호 → 상품이름.
const sortRows = (rows: OrderRow[]) =>
  rows.sort((a, b) => {
    const da = ymdSortKey(a.입고예정일);
    const dbk = ymdSortKey(b.입고예정일);
    if (da !== dbk) return da - dbk;
    const kc = a.물류센터.localeCompare(b.물류센터, 'ko', { numeric: true });
    if (kc !== 0) return kc;
    const ko = a.발주번호.localeCompare(b.발주번호, 'ko', { numeric: true });
    if (ko !== 0) return ko;
    return a.상품이름.localeCompare(b.상품이름, 'ko', { numeric: true });
  });

type Listener = (rows: OrderRow[]) => void;
const localListeners = new Set<Listener>();
const readLocal = (): Record<string, StoredReservation> => {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || '') || {};
  } catch {
    return {};
  }
};
const emitLocal = (state: Record<string, StoredReservation>) => {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
  const rows = sortRows(Object.values(state).map(fromStored));
  localListeners.forEach(l => l(rows));
};

export const subscribeReservations = (listener: Listener): (() => void) => {
  if (!db) {
    listener(sortRows(Object.values(readLocal()).map(fromStored)));
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
      snap => listener(sortRows(snap.docs.map(d => fromStored(d.data() as StoredReservation)))),
      error => console.error('예약 목록 동기화 실패:', error)
    );
  })();
  return () => {
    cancelled = true;
    unsubscribe?.();
  };
};

// 새 예약을 더한다. 이미 저장된 건(같은 키)은 건드리지 않는다.
export const addReservations = async (rows: OrderRow[], existing: OrderRow[]) => {
  const have = new Set(existing.map(reservationKey));
  const now = Date.now();
  const fresh = rows.filter(r => !have.has(reservationKey(r))).map(r => toStored(r, now));
  if (!fresh.length) return 0;
  if (!db) {
    const s = readLocal();
    fresh.forEach(r => { s[r.key] = r; });
    emitLocal(s);
    return fresh.length;
  }
  const firestore = db;
  await ensureSignedIn();
  for (let i = 0; i < fresh.length; i += 450) {
    const batch = writeBatch(firestore);
    fresh.slice(i, i + 450).forEach(r => batch.set(doc(firestore, COLLECTION, r.key), r));
    await batch.commit();
  }
  return fresh.length;
};

export const updateReservationShipment = async (row: OrderRow, 쉼먼트: string) => {
  const key = reservationKey(row);
  if (!db) {
    const s = readLocal();
    if (!s[key]) return;
    s[key] = { ...s[key], 쉼먼트 };
    emitLocal(s);
    return;
  }
  await ensureSignedIn();
  await setDoc(doc(db, COLLECTION, key), { 쉼먼트 }, { merge: true });
};

export const deleteReservations = async (rows: OrderRow[]) => {
  const keys = rows.map(reservationKey);
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
    await batch.commit();
  }
};

// 예약들의 메모를 바꾼다. 한중발주를 만들면 "예약 H…"처럼 고유번호를 적어 예약 패널에서 보이게 한다.
export const setReservationMemo = async (rows: OrderRow[], 메모: string) => {
  const keys = rows.map(reservationKey);
  if (!db) {
    const s = readLocal();
    keys.forEach(k => { if (s[k]) s[k] = { ...s[k], 메모 }; });
    emitLocal(s);
    return;
  }
  const firestore = db;
  await ensureSignedIn();
  // 이미 삭제된 예약이면 새로 만들지 않도록 updateDoc(없으면 실패)을 쓰고, 그 실패는 무시한다.
  await Promise.all(keys.map(k => updateDoc(doc(firestore, COLLECTION, k), { 메모 }).catch(() => {})));
};
