// 쿠팡 발주 매입가 장부. 한중발주의 연결된 쿠팡 발주 줄에 발주금액(매입가 × 확정수량)을 보여줄 때 쓴다.
// 쿠팡 발주서 파일의 "매입가" 열을 올릴 때마다 여기 기억해 둔다(발주번호+상품이름, 상품이름 둘 다로).
//
//  appSettings/coupangPrices : { byPo: { [발주번호│상품이름]: 매입가 }, byName: { [상품이름]: 매입가 }, updatedAt }
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, ensureSignedIn, waitAtMost } from '../utils/firebase';

export type PriceBook = { byPo: Record<string, number>; byName: Record<string, number> };

const LOCAL_KEY = 'coupangPrices';
const DOC_PATH = ['appSettings', 'coupangPrices'] as const;
const poKey = (po: string, name: string) => `${String(po).trim()}│${String(name).trim()}`;

const loadLocal = (): PriceBook => {
  try {
    const v = JSON.parse(localStorage.getItem(LOCAL_KEY) || '');
    return { byPo: v.byPo || {}, byName: v.byName || {} };
  } catch {
    return { byPo: {}, byName: {} };
  }
};
const saveLocal = (book: PriceBook) => {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(book));
  } catch {}
};

export const loadPriceBook = async (): Promise<PriceBook> => {
  const local = loadLocal();
  if (!db) return local;
  try {
    await ensureSignedIn();
    const snap = await waitAtMost(getDoc(doc(db, ...DOC_PATH)), 8000);
    const data = snap?.data() as Partial<PriceBook> | undefined;
    if (!data) return local;
    const book = { byPo: { ...local.byPo, ...(data.byPo || {}) }, byName: { ...local.byName, ...(data.byName || {}) } };
    saveLocal(book);
    return book;
  } catch (err) {
    console.error('매입가 장부 읽기 실패:', err);
    return local;
  }
};

// 이 발주 줄의 매입가(1개). 그 발주서에서 읽은 값이 먼저, 없으면 같은 상품의 최근 매입가.
export const priceOf = (book: PriceBook, po: string, name: string): number | undefined =>
  book.byPo[poKey(po, name)] ?? book.byName[String(name).trim()];

// 매입가를 기억한다. 이미 같은 값이면 저장하지 않는다.
export const rememberPrices = async (items: { po: string; name: string; price: number }[]) => {
  const book = loadLocal();
  const byPo: Record<string, number> = {};
  const byName: Record<string, number> = {};
  for (const it of items) {
    const price = Number(it.price);
    const name = String(it.name || '').trim();
    if (!(price > 0) || !name) continue;
    const k = poKey(it.po, name);
    if (String(it.po || '').trim() && book.byPo[k] !== price) byPo[k] = price;
    if (book.byName[name] !== price) byName[name] = price;
  }
  if (!Object.keys(byPo).length && !Object.keys(byName).length) return;
  saveLocal({ byPo: { ...book.byPo, ...byPo }, byName: { ...book.byName, ...byName } });
  if (!db) return;
  await ensureSignedIn();
  // merge로 바뀐 것만 더한다(다른 컴퓨터가 적은 것을 덮지 않게).
  await waitAtMost(setDoc(doc(db, ...DOC_PATH), { byPo, byName, updatedAt: Date.now() }, { merge: true }));
};
