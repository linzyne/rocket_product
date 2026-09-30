// 쿠팡발주확인이 "작업 중"으로 들고 있는 목록을 넣어 두는 한 곳.
// 이 목록은 발주확인 화면(orderWorkStore)과 쉽먼트생성 쪽(shipOutStore)이 둘 다 고치기 때문에,
// 저장하는 자리를 여기 하나로 모았다. 그래야 어느 쪽에서 고치든 이 기기와 클라우드가 함께 바뀐다.
//
//  appState/coupangOrderWork : { rows, fileName, done, seen, updatedAt }
//
// localStorage에는 클라우드에서 받아온 것을 그대로 남겨 둔다. 그래야 화면이 뜨자마자 바로 보이고,
// 인터넷이 없거나 Firebase 설정이 없는 환경에서도 이 기기 안에서는 평소처럼 돌아간다.
import { doc, onSnapshot, setDoc, deleteDoc, runTransaction, getDocFromServer } from 'firebase/firestore';
import { db, ensureSignedIn } from '../../../utils/firebase';

export const WORK_KEY = 'coupangOrderWork';
// 출고로 넘어간 줄을 가려내야 해서 그쪽 저장소 이름도 여기 둔다(shipOutStore가 이 상수를 쓴다).
export const SHIPOUT_KEY = 'coupangShipOuts';
// 개발 중 동기화를 시험할 때만 이 기기 localStorage의 'coupangOrderWork.testDoc'에 적은 문서를 쓴다
// (진짜 목록을 건드리지 않고 두 창으로 재현하려고). 평소에는 비어 있어 appState/coupangOrderWork를 쓴다.
const TEST_DOC = (() => { try { return localStorage.getItem('coupangOrderWork.testDoc') || ''; } catch { return ''; } })();
const DOC_PATH = ['appState', TEST_DOC || 'coupangOrderWork'] as const;
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
  // 발주번호 → 발주서가 처음 들어온 시각(ms). 쿠팡발주확인에서 NEW 표시(24시간)에 쓴다.
  seen: Record<string, number>;
}

const EMPTY: StoredWork = { rows: [], fileName: '', done: [], seen: {} };
const asSeen = (v: unknown): Record<string, number> =>
  v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, number> : {};
// 칸 이름을 가나다순으로 늘어놓고 글자로 만든다. 클라우드는 받은 칸의 순서를 제멋대로 바꿔 돌려주는데,
// 그냥 JSON.stringify로 비교하면 내용이 같아도 "바뀌었다"로 보고 다시 올리고, 또 돌아오고… 를 끝없이
// 되풀이해 하루 저장 한도를 다 써 버렸다. 그래서 비교할 때는 늘 이것을 쓴다.
export const stableStringify = (v: unknown): string => JSON.stringify(v, (_k, val) =>
  val && typeof val === 'object' && !Array.isArray(val)
    ? Object.fromEntries(Object.keys(val).sort().map(k => [k, (val as Record<string, unknown>)[k]]))
    : val);
// 줄 순서는 비교하지 않는다(화면이 알아서 발주서 순서로 줄 세운다). 순서만 다른 목록을 "바뀜"으로 보면, 정렬 방식이
// 다른 두 창(옛 코드 등)이 서로 끝없이 다시 저장하며 덮어쓰기를 주고받는다(묶음 적용이 깜빡이다 되돌아간 일).
const stamp = (w: StoredWork) => stableStringify({
  rows: w.rows.map(r => stableStringify(r)).sort(),
  fileName: w.fileName, done: [...(w.done || [])].sort(), seen: w.seen || {},
});

export const readWork = (): StoredWork => {
  try {
    const saved = JSON.parse(localStorage.getItem(WORK_KEY) || '');
    return {
      rows: Array.isArray(saved.rows) ? saved.rows : [],
      fileName: saved.fileName || '',
      done: Array.isArray(saved.done) ? saved.done : [],
      seen: asSeen(saved.seen),
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

// 이 기기가 마지막으로 클라우드와 맞춘 목록. 올릴 때 "이것과 비교해 내가 바꾼 것"만 골라
// 클라우드의 지금 목록에 얹는다. 통째로 덮어쓰면, 오래 켜 둔 창이 저장하는 순간 그사이 다른
// 컴퓨터에서 지우거나 쉽먼트로 넘긴 줄이 되살아난다(실제로 발주 6건이 두 화면에 동시에 떴다).
let base: StoredWork | null = null;

// 같은 줄이 두 번 들어 있을 수도 있어 몇 번째인지까지 붙여 열쇠로 쓴다.
const keyed = (rows: Record<string, unknown>[]) => {
  const count = new Map<string, number>();
  return rows.map(r => {
    const k = workLineKey(r);
    const n = (count.get(k) || 0) + 1;
    count.set(k, n);
    return [`${k}#${n}`, r] as const;
  });
};

const ymd = (v: unknown) => Number(String(v ?? '').replace(/\D/g, '').slice(0, 8)) || 99999999;
const byOrder = (a: Record<string, unknown>, b: Record<string, unknown>) =>
  ymd(a.입고예정일) - ymd(b.입고예정일)
  || String(a.물류센터 || '').localeCompare(String(b.물류센터 || ''), 'ko', { numeric: true })
  || String(a.발주번호 || '').localeCompare(String(b.발주번호 || ''), 'ko', { numeric: true });

// 세 목록 합치기: 기준(base)에서 내가 바꾼 것(mine)을 클라우드의 지금 목록(server)에 얹는다.
//  · 내가 지운 줄은 지우고, 내가 더한 줄은 더한다.
//  · 다른 컴퓨터가 지운 줄은 내가 들고 있어도 되살리지 않고, 다른 컴퓨터가 더한 줄은 살린다.
//  · 같은 줄을 양쪽이 고쳤으면 내가 고친 칸이 이긴다(안 고친 줄은 클라우드 값을 따른다).
export const mergeWork = (b: StoredWork, mine: StoredWork, server: StoredWork): StoredWork => {
  if (stamp(server) === stamp(b)) return mine;
  const bm = new Map(keyed(b.rows));
  const sm = new Map(keyed(server.rows));
  const same = (x: unknown, y: unknown) => stableStringify(x) === stableStringify(y);
  const rows: Record<string, unknown>[] = [];
  const taken = new Set<string>();
  for (const [k, r] of keyed(mine.rows)) {
    const was = bm.get(k);
    const now = sm.get(k);
    if (!was) { rows.push(r); taken.add(k); continue; }       // 내가 더한 줄
    if (!now) continue;                                          // 다른 컴퓨터가 지운 줄
    rows.push(same(r, was) ? now : r);                           // 내가 안 고쳤으면 클라우드 값
    taken.add(k);
  }
  // 다른 컴퓨터가 새로 더한 줄(기준에도 내 목록에도 없던 줄).
  const added = keyed(server.rows).filter(([k]) => !taken.has(k) && !bm.has(k)).map(([, r]) => r);
  const merged = added.length ? [...rows, ...added].sort(byOrder) : rows;

  const bd = new Set(b.done), md = new Set(mine.done);
  const done = Array.from(new Set([
    ...server.done.filter(d => md.has(d) || !bd.has(d)),       // 내가 푼 것은 빼고
    ...mine.done.filter(d => !bd.has(d)),                       // 내가 새로 한 것은 더한다
  ]));
  return {
    rows: merged,
    fileName: mine.fileName !== b.fileName ? mine.fileName : server.fileName,
    done,
    seen: { ...server.seen, ...mine.seen },
  };
};

const parseServer = (data: StoredWork | undefined): StoredWork | null =>
  data ? { rows: data.rows || [], fileName: data.fileName || '', done: data.done || [], seen: asSeen(data.seen) } : null;

// 올리기는 한 번에 하나씩 차례로 한다(앞의 것이 끝나야 기준이 맞는다).
let queue: Promise<void> = Promise.resolve();
let uploading = 0;
// 올리는 동안 건너뛴 클라우드 소식이 있었는지. 다 올리고 나서 클라우드를 한 번 더 읽어 맞춘다.
let missed = false;

const upload = (w: StoredWork) => {
  if (!db) return;
  const firestore = db;
  lastSynced = stamp(w);
  uploading++;
  queue = queue.then(async () => {
    await ensureSignedIn();
    const ref = doc(firestore, ...DOC_PATH);
    const mine = readWork();
    const merged = await runTransaction(firestore, async tx => {
      const server = parseServer((await tx.get(ref)).data() as StoredWork | undefined) || { ...EMPTY };
      const result = dropShipped(base ? mergeWork(base, mine, server) : mine);
      // 줄이 하나도 안 남으면 문서를 지운다("전체 비우기"가 다른 기기에도 그대로 간다).
      if (!result.rows.length) tx.delete(ref);
      else tx.set(ref, { ...result, updatedAt: Date.now() });
      return result;
    });
    base = merged;
    lastSynced = stamp(merged);
    // 다른 컴퓨터가 바꾼 것이 섞였으면 이 기기 목록도 합친 것으로 바꾼다.
    // 단, 올리는 사이에 이 기기에서 또 고쳤으면(예: ×를 연달아 누름) 그걸 덮어쓰면 안 된다.
    // 그때는 그사이 고친 것(mine → 지금)을 합친 결과 위에 다시 얹는다. 다음 올리기가 이걸 올린다.
    const now = readWork();
    const next = stamp(now) === stamp(mine) ? merged : mergeWork(mine, now, merged);
    if (stamp(next) !== stamp(now)) {
      writeLocal(next);
      notify();
    }
  }).catch(err => console.error('발주 작업 목록 올리기 실패:', err))
    .finally(() => {
      uploading--;
      if (uploading || !missed) return;
      missed = false;
      getDocFromServer(doc(firestore, ...DOC_PATH)).then(snap => {
        if (uploading) { missed = true; return; }
        const next = parseServer(snap.data() as StoredWork | undefined) || { ...EMPTY };
        if (stamp(next) === stamp(readWork())) { base = next; return; }
        base = next;
        lastSynced = stamp(next);
        writeLocal(next);
        notify();
      }).catch(() => {});
    });
};

// 이미 쉽먼트생성으로 넘어간 줄의 열쇠(이 기기에 받아 둔 출고 목록 기준).
const shippedKeys = (): Set<string> => {
  try {
    const list = JSON.parse(localStorage.getItem(SHIPOUT_KEY) || '[]');
    if (Array.isArray(list)) {
      return new Set(list.flatMap((s: { lines?: Record<string, unknown>[] }) => (s.lines || []).map(workLineKey)));
    }
  } catch {}
  return new Set();
};

// 목록을 고친다. 이 기기에 바로 남기고 클라우드에도 올린다.
// 쉽먼트생성에 있는 줄은 발주확인 목록에 절대 저장하지 않는다. 어느 컴퓨터든 넘기기 전의 묵은
// 목록을 들고 있다가 저장하면 넘어간 발주가 발주확인에 되살아나서(두 곳에 동시에 보임) 여기서 막는다.
const dropShipped = (w: StoredWork): StoredWork => {
  const shipped = shippedKeys();
  const rows = w.rows.filter(r => !shipped.has(workLineKey(r)));
  return rows.length === w.rows.length ? w : { ...w, rows };
};

export const writeWork = (w: StoredWork) => {
  const clean = dropShipped(w);
  if (clean !== w) {
    w = clean;
    // 화면이 묵은 줄을 들고 있으니 저장본으로 다시 그리게 알린다.
    setTimeout(notify, 0);
  }
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
    const shipped = shippedKeys();
    const mine = local.rows.filter(r => !have.has(workLineKey(r)) && !shipped.has(workLineKey(r)));
    merged = {
      rows: [...server.rows, ...mine],
      fileName: server.fileName || local.fileName,
      done: Array.from(new Set([...server.done, ...local.done])),
      seen: { ...local.seen, ...server.seen },
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
let started = false;
let unwatch: (() => void) | undefined;
let cancelled = false;

const startSync = (): (() => void) => {
  watchers++;
  if (!started && db) {
    started = true;
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
          const server = parseServer(snap.data() as StoredWork | undefined);
          if (first) {
            first = false;
            // 합치기 전 클라우드 모양이 첫 올리기의 기준이다(여기에 이 기기 것을 얹는다).
            base = server || { ...EMPTY };
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
          if (stamp(next) === lastSynced) return;
          if (stamp(next) === stamp(readWork())) { base = next; return; }
          // 이 기기에서 아직 올리는 중인 게 있으면 덮어쓰지 않는다. 올리기가 이 소식까지 합쳐서
          // 이 기기 목록을 맞춰 준다(여기서 덮으면 방금 고친 것이 사라진다).
          if (uploading > 0) { missed = true; return; }
          base = next;
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
  // 보는 화면이 없어져도 클라우드 연결은 끊지 않는다. 끊었다 다시 이으면 첫 소식(아직 방금 고친 게 안 올라간
  // 클라우드 목록)으로 이 기기 목록을 덮어써서, 방금 한 일이 사라졌다(쉽먼트생성대기 → 발주확인으로 되돌린 줄이 없어짐).
  return () => {
    watchers--;
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
  base = w;
};

// 클라우드 구독·올리기 상태를 모듈에 들고 있어서, 개발 중 이 파일만 바뀌면 옛것과 새것 두 벌이 같이 돌며
// 목록을 번갈아 덮어쓴다(지운 줄이 사라졌다 생겼다 함). 바뀌면 페이지를 통째로 새로 불러오게 한다.
// @ts-ignore
if (import.meta.hot) import.meta.hot.decline();
