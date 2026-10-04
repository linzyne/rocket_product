// 수집(발주·입고·재고)마다 마지막으로 끝난 때. 수집 화면 카드에 "마지막 완료"로 보여준다.
//
//  collectStatus/last : { po: { at, message }, receive: {...}, stock: {...} }
//
// 다른 컴퓨터에서 한 수집도 보이게 클라우드에 둔다. Firebase 설정이 없거나 저장이 막히면 이 기기에만 남는다.
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db, ensureSignedIn, waitAtMost } from '../utils/firebase';

export type CollectKind = 'po' | 'receive' | 'stock';
export type CollectDone = { at: number; message: string };
export type CollectStatus = Partial<Record<CollectKind, CollectDone>>;

const LOCAL_KEY = 'collectStatus';
const COLLECTION = 'collectStatus';
const DOC_ID = 'last';

type Listener = (s: CollectStatus) => void;
// 이 기기에서 기록이 바뀌면 다시 그리게 한다.
const localListeners = new Set<() => void>();

const readLocal = (): CollectStatus => {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || '') || {};
  } catch {
    return {};
  }
};

// 두 곳 중 더 나중 것을 고른다(클라우드 저장이 막혀도 이 기기에서 한 것은 보이게).
const newer = (a: CollectStatus, b: CollectStatus): CollectStatus => {
  const out: CollectStatus = { ...a };
  (Object.keys(b) as CollectKind[]).forEach(k => {
    if (b[k] && (!out[k] || (b[k]!.at || 0) > (out[k]!.at || 0))) out[k] = b[k];
  });
  return out;
};

export const subscribeCollectStatus = (listener: Listener): (() => void) => {
  let cloud: CollectStatus = {};
  const emit = () => listener(newer(cloud, readLocal()));
  emit();
  localListeners.add(emit);
  if (!db) return () => localListeners.delete(emit);
  const firestore = db;
  let cancelled = false;
  let unsubscribe: (() => void) | undefined;
  (async () => {
    await ensureSignedIn();
    if (cancelled) return;
    unsubscribe = onSnapshot(
      doc(firestore, COLLECTION, DOC_ID),
      snap => {
        cloud = (snap.data() as CollectStatus) || {};
        emit();
      },
      error => console.error('수집 완료 기록 동기화 실패:', error)
    );
  })();
  return () => {
    cancelled = true;
    localListeners.delete(emit);
    unsubscribe?.();
  };
};

export const markCollected = async (kind: CollectKind, message: string) => {
  const entry: CollectDone = { at: Date.now(), message };
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ ...readLocal(), [kind]: entry }));
  } catch {}
  localListeners.forEach(l => l());
  if (!db) return;
  try {
    await ensureSignedIn();
    await waitAtMost(setDoc(doc(db, COLLECTION, DOC_ID), { [kind]: entry }, { merge: true }));
  } catch (err) {
    console.error('수집 완료 기록 저장 실패:', err);
  }
};
