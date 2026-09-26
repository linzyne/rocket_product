// 서허 입고의 SKU번호 ↔ 상품관리 상품(adsId) 짝. 한 번 정해 두면 계속 쓴다.
// 입고 SKU명과 상품관리 상품명이 서로 달라 이름만으로는 짝을 못 찾는 게 많아서, 손으로 정한 짝을
// 여기에 남긴다. 판매량(어제 재고 + 그 사이 입고 − 오늘 재고)을 낼 때 이 짝으로 입고를 붙인다.
//
//  appSettings/skuLinks : { links: { [sku]: adsId }, updatedAt }
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db, ensureSignedIn } from '../utils/firebase';

export type SkuLinks = Record<string, string>;

const LOCAL_KEY = 'skuLinks';
const DOC_PATH = ['appSettings', 'skuLinks'] as const;

export const loadLocalSkuLinks = (): SkuLinks => {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || '') || {};
  } catch {
    return {};
  }
};

const saveLocal = (links: SkuLinks) => {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(links));
  } catch {}
};

export const subscribeSkuLinks = (listener: (links: SkuLinks) => void): (() => void) => {
  if (!db) {
    listener(loadLocalSkuLinks());
    return () => {};
  }
  const firestore = db;
  let cancelled = false;
  let unsubscribe: (() => void) | undefined;
  (async () => {
    await ensureSignedIn();
    if (cancelled) return;
    unsubscribe = onSnapshot(
      doc(firestore, ...DOC_PATH),
      snap => {
        const data = snap.data() as { links?: SkuLinks } | undefined;
        const links = data?.links || {};
        saveLocal(links);
        listener(links);
      },
      error => console.error('SKU 짝 동기화 실패:', error)
    );
  })();
  return () => {
    cancelled = true;
    unsubscribe?.();
  };
};

// 짝 하나를 정하거나(adsId), 지운다(빈 값).
export const setSkuLink = async (sku: string, adsId: string) => {
  const next = { ...loadLocalSkuLinks() };
  if (adsId) next[sku] = adsId;
  else delete next[sku];
  saveLocal(next);
  if (!db) return;
  await ensureSignedIn();
  await setDoc(doc(db, ...DOC_PATH), { links: next, updatedAt: Date.now() });
};
