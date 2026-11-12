// 바코드 메뉴에서 사람이 적은 것. 바코드로 찾는다.
//  - 사진 없는 상품에 올린 썸네일(thumb)
//  - 상품목록·쿠팡 장부에 없는 상품을 바코드 메뉴에서 직접 만든 것(name이 있으면 그 상품도 목록에 보임)
//  - 바코드 메뉴에서 고친 상품명(title, 어느 상품이든 이게 있으면 이 이름으로 보이고 찍힘)
//  barcodePhotos/{바코드} : { barcode, name?, title?, thumb?(작은 JPEG data URL), at }
import { collection, doc, setDoc } from 'firebase/firestore';
import { db, ensureSignedIn, onSnapshot } from '../utils/firebase';

export type BarcodeExtra = { barcode: string; name?: string; title?: string; thumb?: string; at?: number };

const COLLECTION = 'barcodePhotos';
const LOCAL_KEY = 'barcodePhotos';
const CHANGED = 'barcode-photos-changed';
const docId = (bc: string) => bc.trim().replace(/\//g, '∕');

// 예전에는 { 바코드: 사진 } 이었다.
const fromLocal = (): Record<string, BarcodeExtra> => {
  try {
    const raw = JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}') || {};
    const out: Record<string, BarcodeExtra> = {};
    Object.entries(raw).forEach(([bc, v]) => { out[bc] = typeof v === 'string' ? { barcode: bc, thumb: v } : (v as BarcodeExtra); });
    return out;
  } catch {
    return {};
  }
};

let extras: Record<string, BarcodeExtra> = fromLocal();
const notify = () => {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(extras)); } catch {}
  window.dispatchEvent(new CustomEvent(CHANGED));
};

let started = false;
export function subscribeBarcodeExtras(cb: (p: Record<string, BarcodeExtra>) => void): () => void {
  const send = () => cb({ ...extras });
  send();
  window.addEventListener(CHANGED, send);
  if (!started && db) {
    started = true;
    const firestore = db;
    ensureSignedIn().then(() => onSnapshot(collection(firestore, COLLECTION), snap => {
      const next: Record<string, BarcodeExtra> = {};
      snap.docs.forEach(d => {
        const v = d.data();
        const bc = String(v.barcode || d.id);
        next[bc] = { barcode: bc, name: v.name ? String(v.name) : undefined, title: v.title ? String(v.title) : undefined, thumb: v.thumb ? String(v.thumb) : undefined, at: v.at };
      });
      extras = next;
      notify();
    }, err => console.error('바코드 사진 동기화 실패:', err)));
  }
  return () => window.removeEventListener(CHANGED, send);
}

const save = (barcode: string, patch: Partial<BarcodeExtra>) => {
  const bc = barcode.trim();
  if (!bc) return;
  const at = Date.now();
  extras = { ...extras, [bc]: { ...extras[bc], ...patch, barcode: bc, at } };
  notify();
  if (!db) return;
  const firestore = db;
  // merge로 사진·이름 중 바꾼 것만 더한다.
  ensureSignedIn().then(() => setDoc(doc(firestore, COLLECTION, docId(bc)), { ...patch, barcode: bc, at }, { merge: true }))
    .catch(err => console.error('바코드 저장 실패:', err));
};

export const setBarcodePhoto = (barcode: string, thumb: string) => save(barcode, { thumb });

// 바코드 메뉴에서 직접 만든 상품.
export const addBarcodeItem = (barcode: string, name: string) => save(barcode, { name: name.trim() });

// 바코드 메뉴에서 상품명 고치기.
export const setBarcodeTitle = (barcode: string, title: string) => save(barcode, { title: title.trim() });
