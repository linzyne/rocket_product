// 쿠팡 발주 상품의 바코드 장부. 발송대기에서 상품 바코드 라벨(폼텍 40칸)을 뽑을 때 쓴다.
// 쿠팡 발주서 파일의 "상품바코드" 열을 올릴 때마다 여기 기억해 두고(상품번호·상품이름 둘 다로),
// 발주서에 없던 건 사람이 한 번 적으면 그 뒤로 계속 쓴다.
//
//  appSettings/coupangBarcodes : { bySku: { [상품번호]: 바코드 }, byName: { [상품이름]: 바코드 }, updatedAt }
import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { db, ensureSignedIn, waitAtMost } from '../utils/firebase';

export type BarcodeBook = { bySku: Record<string, string>; byName: Record<string, string> };

const LOCAL_KEY = 'coupangBarcodes';
const DOC_PATH = ['appSettings', 'coupangBarcodes'] as const;

const loadLocal = (): BarcodeBook => {
  try {
    const v = JSON.parse(localStorage.getItem(LOCAL_KEY) || '');
    return { bySku: v.bySku || {}, byName: v.byName || {} };
  } catch {
    return { bySku: {}, byName: {} };
  }
};
const saveLocal = (book: BarcodeBook) => {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(book));
  } catch {}
};

export const loadBarcodeBook = async (): Promise<BarcodeBook> => {
  const local = loadLocal();
  if (!db) return local;
  try {
    await ensureSignedIn();
    const snap = await waitAtMost(getDoc(doc(db, ...DOC_PATH)), 8000);
    const data = snap?.data() as Partial<BarcodeBook> | undefined;
    if (!data) return local;
    const book = { bySku: { ...local.bySku, ...(data.bySku || {}) }, byName: { ...local.byName, ...(data.byName || {}) } };
    saveLocal(book);
    return book;
  } catch (err) {
    console.error('바코드 장부 읽기 실패:', err);
    return local;
  }
};

// 바코드를 기억한다. 이미 같은 값이면 저장하지 않는다.
export const rememberBarcodes = async (items: { sku?: string; name?: string; barcode: string }[]) => {
  const book = loadLocal();
  const bySku: Record<string, string> = {};
  const byName: Record<string, string> = {};
  for (const it of items) {
    const bc = String(it.barcode || '').trim();
    if (!bc) continue;
    const sku = String(it.sku || '').trim();
    const name = String(it.name || '').trim();
    if (sku && book.bySku[sku] !== bc) bySku[sku] = bc;
    if (name && book.byName[name] !== bc) byName[name] = bc;
  }
  if (!Object.keys(bySku).length && !Object.keys(byName).length) return;
  saveLocal({ bySku: { ...book.bySku, ...bySku }, byName: { ...book.byName, ...byName } });
  if (!db) return;
  await ensureSignedIn();
  // merge로 바뀐 것만 더한다(다른 컴퓨터가 적은 것을 덮지 않게).
  await waitAtMost(setDoc(doc(db, ...DOC_PATH), { bySku, byName, updatedAt: Date.now() }, { merge: true }));
};

// 발주서에 바코드가 없던 예전 줄을 위해, 로켓제안서 상품목록에 저장된 바코드도 찾아본다(이름으로).
const ARCHIVE_COLLECTION = 'rocketProposalArchive';
const LOCAL_ARCHIVE_KEY = 'productArchive';
export type ArchiveBarcode = { name: string; barcode: string };
export const loadArchiveBarcodes = async (): Promise<ArchiveBarcode[]> => {
  const pick = (list: { productName?: string; color?: string; barcode?: string }[]) =>
    list
      .filter(e => String(e.barcode || '').trim())
      .map(e => ({ name: [e.productName, e.color].filter(Boolean).join(', '), barcode: String(e.barcode).trim() }));
  let local: ArchiveBarcode[] = [];
  try {
    local = pick(JSON.parse(localStorage.getItem(LOCAL_ARCHIVE_KEY) || '[]'));
  } catch {}
  if (!db) return local;
  try {
    await ensureSignedIn();
    const snap = await waitAtMost(getDocs(collection(db, ARCHIVE_COLLECTION)), 10000);
    return snap ? [...pick(snap.docs.map(d => d.data())), ...local] : local;
  } catch (err) {
    console.error('상품목록 바코드 읽기 실패:', err);
    return local;
  }
};

// 이름 비교용: 브랜드·띄어쓰기·기호를 빼고 본다.
export const nameKey = (s: string) => String(s || '').replace(/주노엘/g, '').replace(/[\s,.+()\[\]/_-]/g, '').toLowerCase();
