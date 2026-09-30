// 상품 준비 체크. 쿠팡발주확인 발송 목록에서부터 체크하고, 그 줄이 쉽먼트생성대기·발송대기로 넘어가도
// 같은 체크가 그대로 보인다(줄이 어느 단계에 있든 발주번호·상품이름·수량으로 찾는다).
//
//  lineReady : 문서 id = 발주번호·상품이름·확정수량으로 만든 키. 문서가 있으면 준비됨.
//
// 예전에는 발송대기에서만 출고 건 안(ShipOut.readyKeys)에 적었다. 그 표시도 준비됨으로 같이 본다.
// Firebase 설정이 없으면 이 기기의 localStorage에만 저장한다.
import { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, writeBatch } from 'firebase/firestore';
import { db, ensureSignedIn, waitAtMost } from '../../../utils/firebase';

const COLLECTION = 'lineReady';
const LOCAL_KEY = 'lineReady';

type Line = { 발주번호?: unknown; 상품이름?: unknown; 확정수량?: unknown };
// 발송대기에서 쓰던 열쇠(발주번호│상품이름│확정수량)와 같다. 문서 id에 '/'는 못 써서 바꾼다.
export const readyKey = (l: Line) => `${String(l.발주번호 ?? '').trim()}│${String(l.상품이름 ?? '').trim()}│${String(l.확정수량 ?? '').trim()}`;
const docId = (k: string) => k.replace(/\//g, '∕');

type Listener = (keys: Set<string>) => void;
const localListeners = new Set<Listener>();
const readLocal = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

export const subscribeReady = (listener: Listener): (() => void) => {
  if (!db) {
    listener(new Set(readLocal()));
    localListeners.add(listener);
    return () => localListeners.delete(listener);
  }
  const firestore = db;
  let cancelled = false;
  let unsubscribe: (() => void) | undefined;
  (async () => {
    await ensureSignedIn();
    if (cancelled) return;
    unsubscribe = onSnapshot(
      collection(firestore, COLLECTION),
      snap => listener(new Set(snap.docs.map(d => String((d.data() as { key?: string }).key || '')).filter(Boolean))),
      error => console.error('준비 체크 동기화 실패:', error),
    );
  })();
  return () => {
    cancelled = true;
    unsubscribe?.();
  };
};

export const setReady = async (lines: Line[], on: boolean) => {
  const keys = Array.from(new Set(lines.map(readyKey)));
  if (!keys.length) return;
  if (!db) {
    const s = new Set(readLocal());
    keys.forEach(k => (on ? s.add(k) : s.delete(k)));
    localStorage.setItem(LOCAL_KEY, JSON.stringify(Array.from(s)));
    localListeners.forEach(l => l(new Set(s)));
    return;
  }
  const firestore = db;
  await ensureSignedIn();
  for (let i = 0; i < keys.length; i += 450) {
    const batch = writeBatch(firestore);
    keys.slice(i, i + 450).forEach(k => {
      const ref = doc(firestore, COLLECTION, docId(k));
      if (on) batch.set(ref, { key: k, at: Date.now() });
      else batch.delete(ref);
    });
    await waitAtMost(batch.commit());
  }
};

// 화면에서 쓰는 도우미: 준비됐는지 보고(예전 출고 건 표시 포함), 켜고 끈다.
export function useReady() {
  const [keys, setKeys] = useState<Set<string>>(new Set());
  useEffect(() => subscribeReady(setKeys), []);
  return useMemo(() => ({
    isReady: (l: Line, legacy?: string[]) => keys.has(readyKey(l)) || !!legacy?.includes(readyKey(l)),
    setReady,
  }), [keys]);
}
