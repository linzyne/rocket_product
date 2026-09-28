// 쿠팡발주확인이 "작업 중"으로 들고 있는 목록을 넣어 두는 한 곳.
// 이 목록은 발주확인 화면(orderWorkStore)과 쉽먼트생성 쪽(shipOutStore)이 둘 다 고치기 때문에,
// 저장하는 자리를 여기 하나로 모았다. 그래야 어느 쪽에서 고치든 이 기기와 클라우드가 함께 바뀐다.
//
//  appState/coupangOrderWork : { rows, fileName, done, updatedAt }
//
// localStorage에는 클라우드에서 받아온 것을 그대로 남겨 둔다. 그래야 화면이 뜨자마자 바로 보이고,
// 인터넷이 없거나 Firebase 설정이 없는 환경에서도 이 기기 안에서는 평소처럼 돌아간다.
import { doc, onSnapshot, setDoc, deleteDoc } from 'firebase/firestore';
import { db, ensureSignedIn } from '../../../utils/firebase';

export const WORK_KEY = 'coupangOrderWork';
// 출고로 넘어간 줄을 가려내야 해서 그쪽 저장소 이름도 여기 둔다(shipOutStore가 이 상수를 쓴다).
export const SHIPOUT_KEY = 'coupangShipOuts';
const DOC_PATH = ['appState', 'coupangOrderWork'] as const;
// 이 기기에 있던 목록을 클라우드 것과 한 번 합쳤는지. 합치기는 기기마다 딱 한 번만 한다.
const MERGED_KEY = 'coupangOrderWork.merged';
const CHANGED = 'coupang-work-changed';

// 한 줄을 가리키는 열쇠. 센터·입고예정일은 묶음 적용으로 바뀔 수 있어 빼고 본다.
export const workLineKey = (r: { 발주번호?: unknown; 상품이름?: unknown; 확정수량?: unknown }) =>
  `${r.발주번호}│${r.상품이름}│${r.확정수량}`;

export interface StoredWork {
  rows: Record<string, unknown>[];
  fileName: string;
  done: string[];
}

const EMPTY: StoredWork = { rows: [], fileName: '', done: [] };
const stamp = (w: StoredWork) => JSON.stringify(w);

export const readWork = (): StoredWork => {
  try {
    const saved = JSON.parse(localStorage.getItem(WORK_KEY) || '');
    return {
      rows: Array.isArray(saved.rows) ? saved.rows : [],
      fileName: saved.fileName || '',
      done: Array.isArray(saved.done) ? saved.done : [],
    };
  } catch {
    return { ...EMPTY };
  }
};

const writeLocal = (w: StoredWork) => {
  try {
    if (!w.rows.length) localStorage.removeItem(WORK_KEY);
    else localStorage.setItem(WORK_KEY, JSON.stringify(w));
  } catch {}
};

// 같은 창의 다른 화면에도 바로 알린다. 다른 탭은 storage 이벤트가 알려준다.
const notify = () => window.dispatchEvent(new CustomEvent(CHANGED));

// 마지막으로 클라우드와 주고받은 내용. 내가 올린 것이 그대로 되돌아왔을 때 화면을 괜히 다시
// 그리지 않고, 같은 내용을 두 번 올리지도 않으려고 들고 있는다.
let lastSynced = '';
// 클라우드에서 첫 소식을 받아 이 기기 것과 맞춰 보기 전에는 올리지 않는다. 그 전에 올리면
// 켜자마자 다른 기기에서 해 둔 최신 작업을 이 기기의 묵은 목록으로 덮어쓸 수 있다.
let ready = !db;
let pending = false;

const upload = (w: StoredWork) => {
  if (!db) return;
  const firestore = db;
  lastSynced = stamp(w);
  (async () => {
    await ensureSignedIn();
    // 줄이 하나도 안 남으면 문서를 지운다("전체 비우기"가 다른 기기에도 그대로 간다).
    if (!w.rows.length) await deleteDoc(doc(firestore, ...DOC_PATH));
    else await setDoc(doc(firestore, ...DOC_PATH), { ...w, updatedAt: Date.now() });
  })().catch(err => console.error('발주 작업 목록 올리기 실패:', err));
};

// 목록을 고친다. 이 기기에 바로 남기고 클라우드에도 올린다.
export const writeWork = (w: StoredWork) => {
  // 내용이 그대로면 아무 일도 하지 않는다. 화면은 저장할 때마다 이 함수를 부르는데, 여기서
  // 안 멈추면 "저장 → 알림 → 다시 저장"이 끝없이 돈다.
  if (stamp(w) === stamp(readWork())) return;
  writeLocal(w);
  notify();
  if (ready) upload(w);
  else pending = true;
};

// 클라우드에서 처음 받아왔을 때: 이 기기에만 있던 줄을 잃지 않게 한 번 합친다.
// 합치고 나면 그 뒤로는 클라우드가 늘 옳다(다른 기기에서 지운 줄이 되살아나지 않게).
const mergeFirst = (server: StoredWork | null): StoredWork => {
  const local = readWork();
  if (!server) return local;
  let merged = server;
  if (localStorage.getItem(MERGED_KEY) !== '1') {
    const have = new Set(server.rows.map(workLineKey));
    // 이미 출고(쉽먼트생성)로 넘긴 줄은 도로 올리지 않는다. 안 그러면 발주확인에 되살아난다.
    let shipped = new Set<string>();
    try {
      const list = JSON.parse(localStorage.getItem(SHIPOUT_KEY) || '[]');
      if (Array.isArray(list)) {
        shipped = new Set(list.flatMap((s: { lines?: Record<string, unknown>[] }) => (s.lines || []).map(workLineKey)));
      }
    } catch {}
    const mine = local.rows.filter(r => !have.has(workLineKey(r)) && !shipped.has(workLineKey(r)));
    merged = {
      rows: [...server.rows, ...mine],
      fileName: server.fileName || local.fileName,
      done: Array.from(new Set([...server.done, ...local.done])),
    };
  }
  try {
    localStorage.setItem(MERGED_KEY, '1');
  } catch {}
  return merged;
};

// 클라우드와 이어 둔다. 목록이 바뀔 때마다 알려주고, 돌려주는 함수를 부르면 그만 듣는다.
export const subscribeWork = (cb: () => void): (() => void) => {
  window.addEventListener(CHANGED, cb);
  window.addEventListener('storage', cb);
  const stop = startSync();
  return () => {
    window.removeEventListener(CHANGED, cb);
    window.removeEventListener('storage', cb);
    stop();
  };
};

// 클라우드 구독은 화면이 몇 개든 하나만 걸어 둔다.
let watchers = 0;
let unwatch: (() => void) | undefined;
let cancelled = false;

const startSync = (): (() => void) => {
  watchers++;
  if (watchers === 1 && db) {
    const firestore = db;
    cancelled = false;
    (async () => {
      await ensureSignedIn();
      if (cancelled) return;
      let first = true;
      unwatch = onSnapshot(
        doc(firestore, ...DOC_PATH),
        // 이 기기 캐시에서 먼저 오는 소식과 서버에서 오는 소식을 구분해야 해서 메타데이터도 받는다.
        { includeMetadataChanges: true },
        snap => {
          // 첫 맞춰보기는 서버에서 온 소식으로만 한다. 이 기기 캐시(어제 받아둔 묵은 목록)로 맞추면
          // 그 묵은 목록을 클라우드에 도로 올려, 다른 컴퓨터에서 해 둔 최신 작업을 덮어쓴다.
          if (first && snap.metadata.fromCache) return;
          // 내가 올리는 중인 것이 되돌아온 것은 아래 lastSynced가 걸러 주지만, 캐시에서 온 묵은 소식은
          // 여기서 거른다(서버 것이 곧 따라온다).
          if (snap.metadata.fromCache && !snap.metadata.hasPendingWrites) return;
          const data = snap.data() as StoredWork | undefined;
          const server: StoredWork | null = data
            ? { rows: data.rows || [], fileName: data.fileName || '', done: data.done || [] }
            : null;
          if (first) {
            first = false;
            const merged = mergeFirst(server);
            ready = true;
            const changed = stamp(merged) !== stamp(server || EMPTY);
            if (changed || pending) upload(merged);
            else lastSynced = stamp(merged);
            pending = false;
            writeLocal(merged);
            notify();
            return;
          }
          const next = server || { ...EMPTY };
          // 내가 올린 것이 되돌아온 것이면 그냥 둔다.
          if (stamp(next) === lastSynced || stamp(next) === stamp(readWork())) return;
          lastSynced = stamp(next);
          writeLocal(next);
          notify();
        },
        error => {
          // 못 받아와도 이 기기에 있는 목록으로 계속 일할 수 있게 열어 둔다.
          ready = true;
          console.error('발주 작업 목록 동기화 실패(이 기기에 저장된 것을 씁니다):', error);
        }
      );
    })();
  }
  return () => {
    watchers--;
    if (watchers === 0) {
      cancelled = true;
      unwatch?.();
      unwatch = undefined;
    }
  };
};

// 이 기기에 있는 목록을 클라우드에 그대로 덮어쓴다. 컴퓨터끼리 목록이 어긋났을 때 "이 컴퓨터 것이 맞다"며
// 맞추는 데 쓴다. 다른 컴퓨터는 이 소식을 받아 같은 목록으로 바뀐다. 다 올라가야 끝난다.
export const forceUploadWork = async () => {
  if (!db) throw new Error('이 컴퓨터는 클라우드에 연결돼 있지 않아요(.env.local의 Firebase 설정이 없음).');
  const w = readWork();
  lastSynced = stamp(w);
  ready = true;
  pending = false;
  await ensureSignedIn();
  if (!w.rows.length) await deleteDoc(doc(db, ...DOC_PATH));
  else await setDoc(doc(db, ...DOC_PATH), { ...w, updatedAt: Date.now() });
};
