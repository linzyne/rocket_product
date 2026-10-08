// 발주 줄 한 곳 저장소. 발주서 상품 줄 하나 = 문서 하나이고, 지금 어느 단계에 있는지는 place 칸 하나로 적는다.
//
//  coupangLines/{발주번호│상품이름│확정수량#n} : Line
//    place: 'work'(발주확인) | 'reserve'(예약·대기) | 'ship'(쉽먼트생성·발송대기·발송완료) | 'trash'(지움)
//
// 예전에는 발주확인(문서 하나에 줄 목록 통째로) · 예약 · 쉽먼트(출고 건마다 줄 목록) 세 곳에 줄을 따로 들고 있다가
// "여기서 지우고 저기 더하기"로 옮겼다. 컴퓨터마다 들고 있는 목록이 조금씩 달라서 엇갈리면 줄이 어디에도 없게 됐다.
// 이제 줄은 늘 한 문서이고, 옮기기는 그 문서의 place 칸을 바꾸는 일 하나다. 줄 문서는 지우지 않는다(지우기도
// place = 'trash'). 그래서 어느 컴퓨터가 무엇을 하든 줄이 통째로 사라질 수 없고, 바꾼 줄 하나만 모든 컴퓨터에 간다.
//
// 발주확인·예약·쉽먼트 화면은 예전 모양(목록) 그대로 읽고 쓴다. 각 저장소 파일(orderWorkCloud·reservationStore·
// shipOutStore)이 화면이 준 목록과 지금 줄들을 비교해서 바뀐 줄만 여기에 적는다.
import { collection, doc, getDocFromServer, getDocsFromServer, onSnapshot, runTransaction, setDoc, writeBatch } from 'firebase/firestore';
import { db, ensureSignedIn } from '../../../utils/firebase';
import { dateKeyYMD } from '../utils/dateUtils';

export type Place = 'work' | 'reserve' | 'ship' | 'trash';

export interface Line {
  id: string;
  발주번호: string;
  물류센터: string;
  상품이름: string;
  확정수량: number | '';
  입고예정일: string; // 'YYYY-MM-DD'
  메모: string;
  쉼먼트: string;
  묶음: string;
  묶음센터: string;
  묶음일자: string;
  SKU: string;
  place: Place;
  shipOutId?: string;  // place === 'ship'일 때 담긴 출고 건
  savedAt?: number;    // 예약으로 넘긴 시각
  trashedAt?: number;
  trashedWhy?: 'delete' | 'drop'; // delete: 사람이 지움 / drop: 옮기다 빠짐(곧 다른 곳에 들어가야 함)
  trashedFrom?: Place;
  updatedAt: number;
}

const COLLECTION = 'coupangLines';
const META_PATH = ['appState', 'coupangLinesMeta'] as const;
const CACHE_KEY = 'coupangLines.cache';
const RESTORED_KEY = 'coupangLines.restored';
const CHANGED = 'coupang-lines-changed';
const RESTORED_CHANGED = 'coupang-lines-restored';
// 옮기다 빠진 줄(drop)은 이 시간이 지나도 아무 데도 안 들어가면 발주확인으로 되살린다.
const DROP_GRACE_MS = 20 * 1000;
// 너무 오래된 빠진 줄은 건드리지 않는다(예전 일을 갑자기 되살리지 않게).
const DROP_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
// 사람이 일부러 지운 줄로 치는 시간(지우기 버튼을 누르고 저장되기까지).
const INTENT_MS = 2 * 60 * 1000;

// ── 열쇠 ──
const s = (v: unknown) => String(v ?? '').trim();
// 줄 하나를 가리키는 열쇠. 센터·입고예정일은 묶음 적용·요청등록으로 바뀔 수 있어 뺀다.
export const lineKey = (r: { 발주번호?: unknown; 상품이름?: unknown; 확정수량?: unknown }) =>
  `${s(r.발주번호)}│${s(r.상품이름)}│${s(r.확정수량)}`;
const docIdOf = (key: string, n: number) => `${key}#${n}`.replace(/\//g, '∕');
export const keyOfLine = (l: Line) => lineKey(l);

const qtyOf = (v: unknown): number | '' => {
  if (v === '' || v == null) return '';
  const n = Number(v);
  return Number.isFinite(n) ? n : '';
};

// 화면 쪽 줄(발주확인·예약·출고 모양 아무거나)에서 줄 칸만 뽑는다. 입고예정일은 'YYYY-MM-DD'로 맞춘다.
export const fieldsOf = (r: Record<string, unknown>) => ({
  발주번호: s(r.발주번호),
  물류센터: s(r.물류센터),
  상품이름: s(r.상품이름),
  확정수량: qtyOf(r.확정수량),
  입고예정일: r.입고예정일 ? dateKeyYMD(r.입고예정일 as string) : '',
  메모: String(r.메모 ?? ''),
  쉼먼트: String(r.쉼먼트 ?? ''),
  묶음: String(r.묶음 ?? ''),
  묶음센터: String(r.묶음센터 ?? ''),
  묶음일자: String(r.묶음일자 ?? ''),
  SKU: String(r.SKU ?? ''),
});
export type LineFields = ReturnType<typeof fieldsOf>;
const FIELD_NAMES = Object.keys(fieldsOf({})) as (keyof LineFields)[];

// Firestore는 undefined 칸을 받지 않는다.
const clean = (l: Line): Line => Object.fromEntries(Object.entries(l).filter(([, v]) => v !== undefined)) as unknown as Line;

// ── 이 기기에 들고 있는 줄들 ──
const mirror = new Map<string, Line>();
let ready = !db;
let readyError = '';
const waiting: (() => void)[] = [];

const readCache = () => {
  try {
    const list = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]');
    if (Array.isArray(list)) list.forEach((l: Line) => { if (l && l.id) mirror.set(l.id, l); });
  } catch {}
};
let cacheTimer: ReturnType<typeof setTimeout> | null = null;
const writeCache = () => {
  if (cacheTimer) return;
  cacheTimer = setTimeout(() => {
    cacheTimer = null;
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(Array.from(mirror.values()))); } catch {}
  }, 300);
};
readCache();

const notify = () => window.dispatchEvent(new CustomEvent(CHANGED));

export const allLines = (): Line[] => Array.from(mirror.values());
export const linesAt = (place: Place): Line[] => allLines().filter(l => l.place === place);
export const isLinesReady = () => ready;
export const linesError = () => readyError;

export function subscribeLines(cb: () => void): () => void {
  startLines();
  window.addEventListener(CHANGED, cb);
  return () => window.removeEventListener(CHANGED, cb);
}

// 클라우드와 맞춘 뒤에 할 일. 맞추기 전에 쓰면 이 기기의 묵은 캐시를 기준으로 줄을 옮기게 되므로,
// 그 전에 들어온 쓰기는 맞춘 뒤에 다시 계산해서 한다(화면이 준 "전 → 후" 차이로 계산하므로 다시 해도 같다).
export function whenReady(fn: () => void) {
  if (ready) fn();
  else waiting.push(fn);
}
export const linesReady = (): Promise<void> => new Promise(resolve => { startLines(); whenReady(resolve); });

// ── 쓰기 ──
// 바뀐 줄들을 이 기기에 바로 반영하고 클라우드에 올린다. 줄 문서 하나씩 통째로 쓴다(다른 줄은 건드리지 않는다).
export function commit(changed: Line[]) {
  if (!changed.length) return;
  const now = Date.now();
  const list = changed.map(l => clean({ ...l, updatedAt: now }));
  list.forEach(l => mirror.set(l.id, l));
  writeCache();
  notify();
  if (!db) return;
  const firestore = db;
  const send = () => {
    for (let i = 0; i < list.length; i += 450) {
      const batch = writeBatch(firestore);
      list.slice(i, i + 450).forEach(l => batch.set(doc(firestore, COLLECTION, l.id), l));
      batch.commit().catch(err => {
        console.error('발주 줄 저장 실패:', err);
        alert(`발주 줄 저장에 실패했어요(인터넷 확인). 화면을 새로고침해 주세요.\n${err instanceof Error ? err.message : String(err)}`);
      });
    }
  };
  // 로그인이 끝나 있으면 바로 보낸다(그래야 이 기기에서 쓴 순서대로 클라우드에 간다).
  if (signedIn) send();
  else ensureSignedIn().then(send);
}

// 열쇠가 같은 줄 중에서 하나 고르기. prefer 순서의 자리에서 먼저 찾고, taken에 든 것은 건너뛴다.
export function pickLine(key: string, prefer: Place[], taken: Set<string>): Line | undefined {
  const same = allLines().filter(l => keyOfLine(l) === key && !taken.has(l.id)).sort((a, b) => a.id.localeCompare(b.id));
  for (const p of prefer) {
    // 휴지통에서 꺼낼 때는 방금 빠진 줄을 먼저(오래전에 지운 줄보다).
    const hit = p === 'trash'
      ? same.filter(l => l.place === 'trash').sort((a, b) => (b.trashedAt || 0) - (a.trashedAt || 0))[0]
      : same.find(l => l.place === p);
    if (hit) return hit;
  }
  return undefined;
}

// 새 줄 문서. 같은 열쇠의 줄이 이미 있으면 번호(#2, #3 …)를 늘린다. 두 컴퓨터가 같은 발주서를 동시에 받아도
// 같은 번호가 되어 한 줄로 합쳐진다.
export function newLine(fields: LineFields, place: Place, taken: Set<string>, extra: Partial<Line> = {}): Line {
  const key = lineKey(fields);
  let n = 1;
  while (mirror.has(docIdOf(key, n)) || taken.has(docIdOf(key, n))) n++;
  return { id: docIdOf(key, n), ...fields, place, updatedAt: Date.now(), ...extra };
}

// 줄을 다른 자리로 옮긴 모양(휴지통 표시는 지운다).
export function moved(l: Line, place: Place, fields: Partial<LineFields>, extra: Partial<Line> = {}): Line {
  const { trashedAt, trashedWhy, trashedFrom, shipOutId, savedAt, ...rest } = l;
  void trashedAt; void trashedWhy; void trashedFrom; void shipOutId; void savedAt;
  return { ...rest, ...fields, place, ...extra } as Line;
}

// 바뀐 칸만 덮어쓴 모양(그 사이 다른 컴퓨터가 고친 다른 칸은 살린다).
export function patched(l: Line, before: LineFields, after: LineFields): Line | null {
  const diff: Partial<LineFields> = {};
  for (const k of FIELD_NAMES) if (before[k] !== after[k]) (diff as Record<string, unknown>)[k] = after[k];
  return Object.keys(diff).length ? { ...l, ...diff } : null;
}

// ── 지우기 ──
// 사람이 일부러 지운 줄(줄 삭제·전체 비우기·예약 삭제·출고 삭제·되돌리기로 없어진 줄). 곧 휴지통에 들어갈 때
// "지움"으로 적어서 되살리지 않는다. 표시가 없이 휴지통에 들어간 줄은 "옮기다 빠짐"으로 보고 되살린다.
const intents = new Map<string, number>();
export function markIntentional(rows: { 발주번호?: unknown; 상품이름?: unknown; 확정수량?: unknown }[]) {
  const now = Date.now();
  rows.forEach(r => intents.set(lineKey(r), now));
}
export function trashed(l: Line): Line {
  const at = intents.get(keyOfLine(l));
  const why = at && Date.now() - at < INTENT_MS ? 'delete' : 'drop';
  return { ...l, place: 'trash', trashedAt: Date.now(), trashedWhy: why, trashedFrom: l.place };
}

// ── 빠진 줄 되살리기 ──
export interface RestoredNote { at: number; lines: { 발주번호: string; 상품이름: string; 확정수량: number | '' }[] }
export function readRestored(): RestoredNote[] {
  try {
    const list = JSON.parse(localStorage.getItem(RESTORED_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}
export function clearRestored() {
  try { localStorage.removeItem(RESTORED_KEY); } catch {}
  window.dispatchEvent(new CustomEvent(RESTORED_CHANGED));
}
export function subscribeRestored(cb: (notes: RestoredNote[]) => void): () => void {
  const send = () => cb(readRestored());
  send();
  window.addEventListener(RESTORED_CHANGED, send);
  return () => window.removeEventListener(RESTORED_CHANGED, send);
}

export const rescueDropped = () => {
  if (!ready) return;
  const now = Date.now();
  const lost = linesAt('trash').filter(l => l.trashedWhy === 'drop'
    && now - (l.trashedAt || 0) >= DROP_GRACE_MS && now - (l.trashedAt || 0) < DROP_MAX_AGE_MS);
  if (!lost.length) return;
  console.warn('[발주 줄] 옮기다 빠진 줄을 발주확인으로 되살립니다:', lost);
  // 쉽먼트에서 빠진 줄은 묶음 이름을 지운다(발주확인의 묶음과 섞이지 않게).
  commit(lost.map(l => moved(l, 'work', l.trashedFrom === 'ship' ? { 묶음: '', 묶음센터: '', 묶음일자: '' } : {})));
  const note: RestoredNote = { at: now, lines: lost.map(l => ({ 발주번호: l.발주번호, 상품이름: l.상품이름, 확정수량: l.확정수량 })) };
  try { localStorage.setItem(RESTORED_KEY, JSON.stringify([...readRestored(), note].slice(-20))); } catch {}
  window.dispatchEvent(new CustomEvent(RESTORED_CHANGED));
};

// ── 예전 저장소에서 한 번 옮겨 오기 ──
// 발주확인(appState/coupangOrderWork) · 예약(coupangReservations) · 출고(coupangShipOuts의 lines)에 있던 줄을
// 줄 문서로 만든다. 예전 것은 지우지 않고 그대로 두고, 통째로 coupangBackup에도 남긴다.
// 여러 컴퓨터가 동시에 켜져도 한 대만 하도록 meta 문서에 먼저 표시한다(중간에 멈췄으면 2분 뒤 다른 컴퓨터가 다시 한다).
export interface OldData {
  work: Record<string, unknown>[];
  reservations: Record<string, unknown>[];
  shipOuts: { id: string; lines?: Record<string, unknown>[] }[];
}
export function linesFromOld(old: OldData): Line[] {
  const out = new Map<string, Line>();
  const taken = new Set<string>();
  const add = (fields: LineFields, place: Place, extra: Partial<Line> = {}) => {
    if (!fields.발주번호 && !fields.상품이름) return;
    const key = lineKey(fields);
    let n = 1;
    while (taken.has(docIdOf(key, n))) n++;
    const id = docIdOf(key, n);
    taken.add(id);
    out.set(id, { id, ...fields, place, updatedAt: Date.now(), ...extra });
  };
  // 같은 줄이 여러 곳에 있으면(예전 버그) 쉽먼트 → 예약 → 발주확인 순으로 하나만 살린다.
  const seen = new Map<string, number>();
  for (const s0 of old.shipOuts) {
    for (const l of s0.lines || []) {
      const f = fieldsOf(l);
      seen.set(lineKey(f), (seen.get(lineKey(f)) || 0) + 1);
      add(f, 'ship', { shipOutId: s0.id });
    }
  }
  const already = new Map(seen);
  const skipIfShipped = (f: LineFields) => {
    const k = lineKey(f);
    const left = already.get(k) || 0;
    if (left > 0) { already.set(k, left - 1); return true; }
    return false;
  };
  for (const r of old.reservations) {
    const f = fieldsOf(r);
    if (skipIfShipped(f)) continue;
    add(f, 'reserve', { savedAt: Number(r.savedAt) || Date.now() });
  }
  const reserved = new Map<string, number>();
  old.reservations.forEach(r => { const k = lineKey(fieldsOf(r)); reserved.set(k, (reserved.get(k) || 0) + 1); });
  for (const r of old.work) {
    const f = fieldsOf(r);
    if (skipIfShipped(f)) continue;
    const k = lineKey(f);
    const left = reserved.get(k) || 0;
    if (left > 0) { reserved.set(k, left - 1); continue; }
    add(f, 'work');
  }
  return Array.from(out.values());
}

const backupJson = async (firestore: NonNullable<typeof db>, name: string, value: unknown) => {
  const text = JSON.stringify(value);
  const CHUNK = 700000;
  const at = Date.now();
  for (let i = 0, part = 0; i < text.length || part === 0; i += CHUNK, part++) {
    await setDoc(doc(firestore, 'coupangBackup', `${name}-${at}-${part}`), { name, at, part, text: text.slice(i, i + CHUNK) });
  }
};

const migrate = async (firestore: NonNullable<typeof db>) => {
  const metaRef = doc(firestore, ...META_PATH);
  const claimed = await runTransaction(firestore, async tx => {
    const m = (await tx.get(metaRef)).data() as { migratedAt?: number; doneAt?: number } | undefined;
    if (m?.doneAt) return false;
    if (m?.migratedAt && Date.now() - m.migratedAt < 2 * 60 * 1000) return false;
    tx.set(metaRef, { migratedAt: Date.now() }, { merge: true });
    return true;
  });
  if (!claimed) return;
  const [workSnap, resSnap, shipSnap] = await Promise.all([
    getDocFromServer(doc(firestore, 'appState', 'coupangOrderWork')),
    getDocsFromServer(collection(firestore, 'coupangReservations')),
    getDocsFromServer(collection(firestore, 'coupangShipOuts')),
  ]);
  const work = (workSnap.data() || {}) as { rows?: Record<string, unknown>[]; fileName?: string; done?: string[]; seen?: Record<string, number> };
  const old: OldData = {
    work: work.rows || [],
    reservations: resSnap.docs.map(d => d.data()),
    shipOuts: shipSnap.docs.map(d => ({ ...(d.data() as { lines?: Record<string, unknown>[] }), id: d.id })),
  };
  await backupJson(firestore, 'coupangOrderWork', workSnap.data() || null);
  await backupJson(firestore, 'coupangReservations', old.reservations);
  await backupJson(firestore, 'coupangShipOuts', old.shipOuts);
  const lines = linesFromOld(old);
  for (let i = 0; i < lines.length; i += 450) {
    const batch = writeBatch(firestore);
    lines.slice(i, i + 450).forEach(l => batch.set(doc(firestore, COLLECTION, l.id), clean(l)));
    await batch.commit();
  }
  // 발주확인 머리 정보(파일 이름·완료 묶음·NEW 표시)도 옮긴다.
  await setDoc(doc(firestore, 'appState', 'coupangOrderWorkMeta'), { fileName: work.fileName || '', done: work.done || [], seen: work.seen || {} }, { merge: true });
  await setDoc(metaRef, { doneAt: Date.now(), lines: lines.length }, { merge: true });
  console.info(`[발주 줄] 예전 저장소에서 ${lines.length}줄을 옮겼어요.`);
};

// Firebase가 없는 컴퓨터: 이 기기 localStorage의 예전 목록에서 한 번 옮긴다.
const migrateLocal = () => {
  if (localStorage.getItem('coupangLines.migrated') === '1') return;
  const json = (k: string, fallback: unknown) => { try { return JSON.parse(localStorage.getItem(k) || '') ?? fallback; } catch { return fallback; } };
  const work = json('coupangOrderWork', {}) as { rows?: Record<string, unknown>[] };
  const res = json('coupangReservations', {}) as Record<string, Record<string, unknown>>;
  const ships = json('coupangShipOuts', []) as { id: string; lines?: Record<string, unknown>[] }[];
  const lines = linesFromOld({ work: work.rows || [], reservations: Object.values(res), shipOuts: Array.isArray(ships) ? ships : [] });
  lines.forEach(l => mirror.set(l.id, l));
  writeCache();
  localStorage.setItem('coupangLines.migrated', '1');
};

// ── 시작 ──
let started = false;
let signedIn = false;
export function startLines() {
  if (started) return;
  started = true;
  if (!db) {
    migrateLocal();
    ready = true;
    notify();
    setInterval(rescueDropped, 10 * 1000);
    return;
  }
  const firestore = db;
  (async () => {
    await ensureSignedIn();
    signedIn = true;
    try {
      await migrate(firestore);
    } catch (err) {
      console.error('[발주 줄] 옮겨 오기 실패:', err);
    }
    // 옮겨 오기가 끝났는지(다른 컴퓨터가 하는 중일 수도 있다) 보고 나서 줄을 받는다.
    onSnapshot(doc(firestore, ...META_PATH), snap => {
      const m = snap.data() as { doneAt?: number; migratedAt?: number } | undefined;
      if (!m?.doneAt) {
        // 다른 컴퓨터가 하다가 멈췄으면 이어서 한다.
        if (!m?.migratedAt || Date.now() - m.migratedAt > 2 * 60 * 1000) migrate(firestore).catch(err => console.error(err));
        return;
      }
      if (linesWatching) return;
      linesWatching = true;
      onSnapshot(
        collection(firestore, COLLECTION),
        { includeMetadataChanges: true },
        snap2 => {
          // 처음은 서버에서 온 소식으로만 맞춘다(묵은 캐시를 기준으로 줄을 옮기지 않게).
          if (!ready && snap2.metadata.fromCache) return;
          mirror.clear();
          snap2.docs.forEach(d => mirror.set(d.id, d.data() as Line));
          writeCache();
          if (!ready) {
            ready = true;
            readyError = '';
            waiting.splice(0).forEach(fn => { try { fn(); } catch (err) { console.error(err); } });
          }
          notify();
        },
        err => {
          readyError = `발주 줄을 클라우드에서 받지 못했어요: ${err.message}`;
          console.error('[발주 줄] 동기화 실패:', err);
          notify();
        },
      );
    });
  })();
  setInterval(rescueDropped, 10 * 1000);
}
let linesWatching = false;

// 클라우드 구독 상태를 모듈에 들고 있어서, 개발 중 이 파일이 바뀌면 페이지를 통째로 새로 불러오게 한다.
// @ts-ignore
if (import.meta.hot) import.meta.hot.decline();
