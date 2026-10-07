// 장부: 직접 적는 입금·출금 기록. 정산금(쿠팡 입고상세내역의 지급일)과 수입비용(한중발주 도착 기록)은
// 이미 다른 데이터에 있으니 장부 화면이 거기서 자동으로 가져오고, 여기에는 그 밖의 것만 적는다.
//
//  ledgerEntries : 문서 id = 기록 id
//
// Firebase 설정이 없으면 이 기기의 localStorage에만 저장한다.
import { collection, doc, onSnapshot, setDoc, deleteDoc } from 'firebase/firestore';
import { db, ensureSignedIn } from '../utils/firebase';

export const OUT_CATEGORIES = ['임대료', '마케팅비', '택배비', '식대', '통신비', '기타비용'] as const;
export const IN_CATEGORIES = ['기타입금'] as const;
export type LedgerKind = 'in' | 'out';

export interface LedgerEntry {
  id: string;
  date: string; // YYYY-MM-DD
  kind: LedgerKind;
  category: string;
  amount: number; // 원
  memo: string;
  createdAt: number;
}

const COLLECTION = 'ledgerEntries';
const LOCAL_KEY = 'ledgerEntries';

type Listener = (list: LedgerEntry[]) => void;
const localListeners = new Set<Listener>();
const readLocal = (): Record<string, LedgerEntry> => {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || '') || {};
  } catch {
    return {};
  }
};
const sortList = (list: LedgerEntry[]) => list.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
const writeLocal = (state: Record<string, LedgerEntry>) => {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
  const list = sortList(Object.values(state));
  localListeners.forEach(l => l(list));
};

export const subscribeLedger = (listener: Listener): (() => void) => {
  if (!db) {
    listener(sortList(Object.values(readLocal())));
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
      snap => listener(sortList(snap.docs.map(d => d.data() as LedgerEntry))),
      error => console.error('장부 동기화 실패:', error)
    );
  })();
  return () => {
    cancelled = true;
    unsubscribe?.();
  };
};

export const saveLedgerEntry = async (entry: LedgerEntry) => {
  if (!db) {
    const s = readLocal();
    s[entry.id] = entry;
    writeLocal(s);
    return;
  }
  await ensureSignedIn();
  await setDoc(doc(db, COLLECTION, entry.id), entry);
};

export const deleteLedgerEntry = async (id: string) => {
  if (!db) {
    const s = readLocal();
    delete s[id];
    writeLocal(s);
    return;
  }
  await ensureSignedIn();
  await deleteDoc(doc(db, COLLECTION, id));
};
