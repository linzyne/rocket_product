// 1688 상품(상품번호+옵션) ↔ 한중발주 상품이름 짝. 처음 한 번 고르면 다음부터 미리 골라 둔다.
// 1688 상품명(중국어)과 쿠팡 발주 상품명이 전혀 달라서 이름으로는 짝을 못 찾기 때문에, 고른 짝을 남긴다.
//
//  appSettings/order1688Links : { links: { [item1688Key]: 상품이름 }, updatedAt }
import { doc, setDoc } from 'firebase/firestore';
import { db, ensureSignedIn, onSnapshot } from '../utils/firebase';

export type Order1688Links = Record<string, string>;

const LOCAL_KEY = 'order1688Links';
const DOC_PATH = ['appSettings', 'order1688Links'] as const;

export const loadLocal1688Links = (): Order1688Links => {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || '') || {};
  } catch {
    return {};
  }
};

const saveLocal = (links: Order1688Links) => {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(links));
  } catch {}
};

export const subscribe1688Links = (listener: (links: Order1688Links) => void): (() => void) => {
  listener(loadLocal1688Links());
  if (!db) return () => {};
  const firestore = db;
  let cancelled = false;
  let unsubscribe: (() => void) | undefined;
  (async () => {
    await ensureSignedIn();
    if (cancelled) return;
    unsubscribe = onSnapshot(
      doc(firestore, ...DOC_PATH),
      snap => {
        const data = snap.data() as { links?: Order1688Links } | undefined;
        const links = data?.links || {};
        saveLocal(links);
        listener(links);
      },
      error => console.error('1688 짝 동기화 실패:', error)
    );
  })();
  return () => {
    cancelled = true;
    unsubscribe?.();
  };
};

// 여러 짝을 한 번에 정한다(빈 이름이면 지운다).
export const set1688Links = async (patch: Order1688Links) => {
  const next = { ...loadLocal1688Links() };
  Object.entries(patch).forEach(([k, v]) => {
    if (v) next[k] = v;
    else delete next[k];
  });
  saveLocal(next);
  if (!db) return;
  await ensureSignedIn();
  await setDoc(doc(db, ...DOC_PATH), { links: next, updatedAt: Date.now() });
};
