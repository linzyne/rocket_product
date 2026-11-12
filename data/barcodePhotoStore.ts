// 바코드 메뉴에서 사진 없는 상품에 사람이 올린 썸네일. 바코드로 찾는다.
//  barcodePhotos/{바코드} : { barcode, thumb(작은 JPEG data URL), at }
import { collection, doc, setDoc } from 'firebase/firestore';
import { db, ensureSignedIn, onSnapshot } from '../utils/firebase';

const COLLECTION = 'barcodePhotos';
const LOCAL_KEY = 'barcodePhotos';
const CHANGED = 'barcode-photos-changed';
const docId = (bc: string) => bc.trim().replace(/\//g, '∕');

let photos: Record<string, string> = (() => { try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}') || {}; } catch { return {}; } })();
const notify = () => {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(photos)); } catch {}
  window.dispatchEvent(new CustomEvent(CHANGED));
};

let started = false;
export function subscribeBarcodePhotos(cb: (p: Record<string, string>) => void): () => void {
  const send = () => cb({ ...photos });
  send();
  window.addEventListener(CHANGED, send);
  if (!started && db) {
    started = true;
    const firestore = db;
    ensureSignedIn().then(() => onSnapshot(collection(firestore, COLLECTION), snap => {
      const next: Record<string, string> = {};
      snap.docs.forEach(d => {
        const v = d.data();
        if (v.thumb) next[String(v.barcode || d.id)] = String(v.thumb);
      });
      photos = next;
      notify();
    }, err => console.error('바코드 사진 동기화 실패:', err)));
  }
  return () => window.removeEventListener(CHANGED, send);
}

export function setBarcodePhoto(barcode: string, thumb: string) {
  const bc = barcode.trim();
  if (!bc) return;
  photos = { ...photos, [bc]: thumb };
  notify();
  if (!db) return;
  const firestore = db;
  ensureSignedIn().then(() => setDoc(doc(firestore, COLLECTION, docId(bc)), { barcode: bc, thumb, at: Date.now() }))
    .catch(err => console.error('바코드 사진 저장 실패:', err));
}
