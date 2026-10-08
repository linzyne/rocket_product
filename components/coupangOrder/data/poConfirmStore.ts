// 발주확정 표시. 서허에 발주확정(확정수량 업로드)을 마친 발주서를 적어 둔다. 발주 진행 화면에서 첫 단계를 끝냈는지 본다.
//
//  coupangPoConfirmed/{발주번호} : { at }
//
// 문서 하나가 발주서 하나라 어느 컴퓨터에서 누르든 그 칸 하나만 바뀌고 모든 컴퓨터에 똑같이 간다.
// Firebase 설정이 없으면 이 기기의 localStorage에만 둔다.
import { collection, doc, onSnapshot, setDoc, deleteDoc } from 'firebase/firestore';
import { db, ensureSignedIn } from '../../../utils/firebase';

const COLLECTION = 'coupangPoConfirmed';
const LOCAL_KEY = 'coupangPoConfirmed';
const CHANGED = 'coupang-po-confirmed-changed';

const readLocal = (): Record<string, number> => {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '') || {}; } catch { return {}; }
};
const docId = (no: string) => no.trim().replace(/\//g, '∕');

export function subscribeConfirmed(cb: (byOrder: Record<string, number>) => void): () => void {
  if (!db) {
    const send = () => cb(readLocal());
    send();
    window.addEventListener(CHANGED, send);
    return () => window.removeEventListener(CHANGED, send);
  }
  const firestore = db;
  let cancelled = false;
  let stop: (() => void) | undefined;
  (async () => {
    await ensureSignedIn();
    if (cancelled) return;
    stop = onSnapshot(
      collection(firestore, COLLECTION),
      snap => cb(Object.fromEntries(snap.docs.map(d => [String(d.data().no || d.id), Number(d.data().at) || 0]))),
      err => console.error('발주확정 표시 동기화 실패:', err),
    );
  })();
  return () => { cancelled = true; stop?.(); };
}

// 발주서들을 확정됨(on) 또는 아직(off)으로 적는다.
export async function setConfirmed(orderNos: string[], on: boolean) {
  const nos = Array.from(new Set(orderNos.map(n => n.trim()).filter(Boolean)));
  if (!nos.length) return;
  if (!db) {
    const s = readLocal();
    nos.forEach(n => { if (on) s[n] = Date.now(); else delete s[n]; });
    localStorage.setItem(LOCAL_KEY, JSON.stringify(s));
    window.dispatchEvent(new CustomEvent(CHANGED));
    return;
  }
  const firestore = db;
  await ensureSignedIn();
  await Promise.all(nos.map(n => on
    ? setDoc(doc(firestore, COLLECTION, docId(n)), { no: n, at: Date.now() })
    : deleteDoc(doc(firestore, COLLECTION, docId(n)))));
}
