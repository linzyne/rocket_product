// 발주서마다 사람이 쓰는 체크 표시(인쇄 아이콘 옆 작은 체크칸). 뜻은 사람이 정한다. 켜 두면 그대로 남는다.
//  coupangPoMark/{발주번호} : { no, at }   (문서가 있으면 체크됨)
import { collection, doc, onSnapshot, setDoc, deleteDoc } from 'firebase/firestore';
import { db, ensureSignedIn } from '../../../utils/firebase';

const COLLECTION = 'coupangPoMark';
const LOCAL_KEY = 'coupangPoMark';
const CHANGED = 'coupang-po-mark-changed';
const docId = (no: string) => no.trim().replace(/\//g, '∕');

let marks: Set<string> = (() => { try { return new Set(JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]')); } catch { return new Set<string>(); } })();
const notify = () => {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(Array.from(marks))); } catch {}
  window.dispatchEvent(new CustomEvent(CHANGED));
};

let started = false;
export function subscribeMarks(cb: (m: Set<string>) => void): () => void {
  const send = () => cb(new Set(marks));
  send();
  window.addEventListener(CHANGED, send);
  if (!started && db) {
    started = true;
    const firestore = db;
    ensureSignedIn().then(() => onSnapshot(collection(firestore, COLLECTION), snap => {
      marks = new Set(snap.docs.map(d => String(d.data().no || d.id)));
      notify();
    }, err => console.error('발주서 체크 동기화 실패:', err)));
  }
  return () => window.removeEventListener(CHANGED, send);
}

export function setMark(no: string, on: boolean) {
  const n = no.trim();
  if (!n) return;
  const next = new Set(marks);
  if (on) next.add(n); else next.delete(n);
  marks = next;
  notify();
  if (!db) return;
  const firestore = db;
  ensureSignedIn().then(() => (on
    ? setDoc(doc(firestore, COLLECTION, docId(n)), { no: n, at: Date.now() })
    : deleteDoc(doc(firestore, COLLECTION, docId(n)))))
    .catch(err => console.error('발주서 체크 저장 실패:', err));
}
