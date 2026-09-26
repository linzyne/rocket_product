// 로켓 > 로켓재고·판매량·입고 표에서 사장님이 손으로 정한 상품 진열 순서.
// 클라우드(Firestore)에 두어 여러 컴퓨터에서 같다.
//
//  appSettings/productOrder : { ads: string[], sku: string[], updatedAt }
//
// 로켓재고·판매량은 상품관리 상품(adsId)으로, 입고는 서허 SKU번호로 줄을 만들기 때문에 두 벌을 둔다.
// 목록에 없는 상품은 순서를 정하지 않은 것이라 정해진 것들 뒤에 붙는다.
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db, ensureSignedIn } from '../utils/firebase';

export type OrderKind = 'ads' | 'sku';
export type ProductOrder = { ads: string[]; sku: string[] };

const LOCAL_KEY = 'productOrder';
const DOC_PATH = ['appSettings', 'productOrder'] as const;
const EMPTY: ProductOrder = { ads: [], sku: [] };

export const loadLocalOrder = (): ProductOrder => {
  try {
    const saved = JSON.parse(localStorage.getItem(LOCAL_KEY) || '');
    return { ads: saved.ads || [], sku: saved.sku || [] };
  } catch {
    return EMPTY;
  }
};

const saveLocal = (order: ProductOrder) => {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(order));
  } catch {}
};

export const subscribeProductOrder = (listener: (order: ProductOrder) => void): (() => void) => {
  if (!db) {
    listener(loadLocalOrder());
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
        const data = snap.data() as Partial<ProductOrder> | undefined;
        const order: ProductOrder = { ads: data?.ads || [], sku: data?.sku || [] };
        saveLocal(order);
        listener(order);
      },
      error => console.error('상품 순서 동기화 실패:', error)
    );
  })();
  return () => {
    cancelled = true;
    unsubscribe?.();
  };
};

export const setProductOrder = async (kind: OrderKind, keys: string[]) => {
  const next = { ...loadLocalOrder(), [kind]: keys };
  saveLocal(next);
  if (!db) return;
  await ensureSignedIn();
  await setDoc(doc(db, ...DOC_PATH), { [kind]: keys, updatedAt: Date.now() }, { merge: true });
};

// 정해 둔 순서대로 앞에, 나머지는 원래 차례대로 뒤에 붙인다.
export const applyOrder = <T>(rows: T[], keyOf: (row: T) => string, order: string[]): T[] => {
  if (!order.length) return rows;
  const rank = new Map(order.map((k, i) => [k, i]));
  const known: T[] = [];
  const rest: T[] = [];
  for (const row of rows) (rank.has(keyOf(row)) ? known : rest).push(row);
  known.sort((a, b) => rank.get(keyOf(a))! - rank.get(keyOf(b))!);
  return [...known, ...rest];
};
