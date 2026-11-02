// 장부: 직접 적는 입금·출금 기록. 정산금(쿠팡 입고상세내역의 지급일)과 수입비용(한중발주 도착 기록)은
// 이미 다른 데이터에 있으니 장부 화면이 거기서 자동으로 가져오고, 여기에는 그 밖의 것만 적는다.
//
//  ledgerEntries   : 문서 id = 기록 id
//  ledgerUnitCosts : 문서 id = SKU번호. 한중발주와 짝이 안 맞는 입고 줄의 개당 원가(직접 적음)
//
// Firebase 설정이 없으면 이 기기의 localStorage에만 저장한다.
import { collection, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { db, ensureSignedIn, onSnapshot } from '../utils/firebase';

export const OUT_CATEGORIES = ['쿠팡 광고비', '쿠팡 차감', '임대료', '마케팅비', '택배비', '포장재', '식대', '통신비', '손실(폐기·분실)', '기타비용'] as const;
// 쿠팡 광고비는 쓴 달의 비용이지만 돈은 다음 달 정산금에서 빠진다(지급일로 보기에서 한 달 미룬다).
export const AD_CATEGORY = '쿠팡 광고비';
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

// ---- 짝 없는 입고 줄의 개당 원가 ----
export interface UnitCost {
  sku: string;
  name: string;
  unit: number; // 개당 원가(원)
  updatedAt: number;
}

const UC_COLLECTION = 'ledgerUnitCosts';
const UC_LOCAL_KEY = 'ledgerUnitCosts';
type UcListener = (map: Record<string, UnitCost>) => void;
const ucLocalListeners = new Set<UcListener>();
const readUcLocal = (): Record<string, UnitCost> => {
  try {
    return JSON.parse(localStorage.getItem(UC_LOCAL_KEY) || '') || {};
  } catch {
    return {};
  }
};

export const subscribeUnitCosts = (listener: UcListener): (() => void) => {
  if (!db) {
    listener(readUcLocal());
    ucLocalListeners.add(listener);
    return () => ucLocalListeners.delete(listener);
  }
  const firestore = db;
  let cancelled = false;
  let unsubscribe: (() => void) | undefined;
  (async () => {
    await ensureSignedIn();
    if (cancelled) return;
    unsubscribe = onSnapshot(
      collection(firestore, UC_COLLECTION),
      snap => listener(Object.fromEntries(snap.docs.map(d => [d.id, d.data() as UnitCost]))),
      error => console.error('개당 원가 동기화 실패:', error)
    );
  })();
  return () => {
    cancelled = true;
    unsubscribe?.();
  };
};

// unit이 0이면 지운다.
export const saveUnitCost = async (sku: string, name: string, unit: number) => {
  const id = sku.replace(/\//g, '_');
  if (!db) {
    const s = readUcLocal();
    if (unit > 0) s[id] = { sku, name, unit, updatedAt: Date.now() };
    else delete s[id];
    localStorage.setItem(UC_LOCAL_KEY, JSON.stringify(s));
    ucLocalListeners.forEach(l => l(s));
    return;
  }
  await ensureSignedIn();
  if (unit > 0) await setDoc(doc(db, UC_COLLECTION, id), { sku, name, unit, updatedAt: Date.now() });
  else await deleteDoc(doc(db, UC_COLLECTION, id));
};
