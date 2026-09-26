// 발주서 수집의 기준 발주번호("마지막 받은 발주번호"). 클라우드(Firestore)에 두어 여러 컴퓨터에서
// 같은 자리를 이어받는다. 이 기기의 localStorage에도 같이 남겨서 처음 뜰 때 바로 보이게 한다.
//
//  appSettings/poCursor : { lastOrderNo, updatedAt }
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db, ensureSignedIn } from '../../../utils/firebase';

const LOCAL_KEY = 'poLastOrderNo';
const DOC_PATH = ['appSettings', 'poCursor'] as const;

export const loadLocalPoCursor = (): string => {
  try {
    return localStorage.getItem(LOCAL_KEY) || '';
  } catch {
    return '';
  }
};

const saveLocal = (no: string) => {
  try {
    if (no) localStorage.setItem(LOCAL_KEY, no);
    else localStorage.removeItem(LOCAL_KEY);
  } catch {}
};

export const subscribePoCursor = (listener: (no: string) => void): (() => void) => {
  if (!db) {
    listener(loadLocalPoCursor());
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
        const data = snap.data() as { lastOrderNo?: string } | undefined;
        if (!data) {
          // 처음 한 번: 이 기기에 있던 값을 클라우드로 올린다.
          const local = loadLocalPoCursor();
          if (local) setPoCursor(local).catch(err => console.error('기준 발주번호 올리기 실패:', err));
          return;
        }
        const no = String(data.lastOrderNo || '');
        saveLocal(no);
        listener(no);
      },
      error => console.error('기준 발주번호 동기화 실패:', error)
    );
  })();
  return () => {
    cancelled = true;
    unsubscribe?.();
  };
};

export const setPoCursor = async (no: string) => {
  saveLocal(no);
  if (!db) return;
  await ensureSignedIn();
  await setDoc(doc(db, ...DOC_PATH), { lastOrderNo: no, updatedAt: Date.now() });
};
