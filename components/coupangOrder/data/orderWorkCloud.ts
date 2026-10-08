// 쿠팡발주확인이 "작업 중"으로 들고 있는 목록(발주확인 단계의 줄들).
// 줄은 lineStore(발주 줄 한 곳 저장소)에 place = 'work'로 들어 있고, 여기서는 그것을 예전 모양
// { rows, fileName, done, seen }으로 읽고 쓴다. 쓸 때는 화면이 본 목록(전)과 고친 목록(후)을 비교해서
// 바뀐 줄만 적는다. 그래서 화면이 묵은 목록을 들고 있어도 그사이 다른 컴퓨터가 넣거나 옮긴 줄을 건드리지 않는다.
//
//  appState/coupangOrderWorkMeta : { fileName, done, seen }  (줄 말고 머리 정보만)
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db, ensureSignedIn } from '../../../utils/firebase';
import {
  Line, LineFields, allLines, linesAt, commit, pickLine, newLine, moved, patched, trashed, fieldsOf, lineKey,
  subscribeLines, whenReady, startLines,
} from './lineStore';

export interface StoredWork {
  rows: Record<string, unknown>[];
  fileName: string;
  done: string[];
  // 발주번호 → 발주서가 처음 들어온 시각(ms). 쿠팡발주확인에서 NEW 표시(24시간)에 쓴다.
  seen: Record<string, number>;
}

// 한 줄을 가리키는 열쇠. 센터·입고예정일은 묶음 적용으로 바뀔 수 있어 빼고 본다.
export const workLineKey = lineKey;

// 칸 이름을 가나다순으로 늘어놓고 글자로 만든다(내용이 같으면 늘 같은 글자).
export const stableStringify = (v: unknown): string => JSON.stringify(v, (_k, val) =>
  val && typeof val === 'object' && !Array.isArray(val)
    ? Object.fromEntries(Object.keys(val).sort().map(k => [k, (val as Record<string, unknown>)[k]]))
    : val);

// ── 머리 정보 ──
const META_LOCAL = 'coupangOrderWorkMeta';
type Meta = Omit<StoredWork, 'rows'>;
const asMeta = (v: Partial<Meta> | undefined): Meta => ({
  fileName: v?.fileName || '',
  done: Array.isArray(v?.done) ? v!.done : [],
  seen: v?.seen && typeof v.seen === 'object' && !Array.isArray(v.seen) ? v.seen : {},
});
let meta: Meta = (() => { try { return asMeta(JSON.parse(localStorage.getItem(META_LOCAL) || '{}')); } catch { return asMeta(undefined); } })();
const CHANGED = 'coupang-work-changed';
const notify = () => window.dispatchEvent(new CustomEvent(CHANGED));

let metaStarted = false;
const startMeta = () => {
  if (metaStarted || !db) return;
  metaStarted = true;
  const firestore = db;
  ensureSignedIn().then(() => onSnapshot(doc(firestore, 'appState', 'coupangOrderWorkMeta'), snap => {
    const next = asMeta(snap.data() as Partial<Meta> | undefined);
    if (stableStringify(next) === stableStringify(meta)) return;
    meta = next;
    try { localStorage.setItem(META_LOCAL, JSON.stringify(meta)); } catch {}
    notify();
  }, err => console.error('발주확인 머리 정보 동기화 실패:', err)));
};
const writeMeta = (next: Meta) => {
  if (stableStringify(next) === stableStringify(meta)) return;
  meta = next;
  try { localStorage.setItem(META_LOCAL, JSON.stringify(meta)); } catch {}
  notify();
  if (!db) return;
  const firestore = db;
  ensureSignedIn().then(() => setDoc(doc(firestore, 'appState', 'coupangOrderWorkMeta'), next))
    .catch(err => console.error('발주확인 머리 정보 저장 실패:', err));
};

// ── 읽기 ──
const ymd = (v: unknown) => Number(String(v ?? '').replace(/\D/g, '').slice(0, 8)) || 99999999;
const byOrder = (a: Record<string, unknown>, b: Record<string, unknown>) =>
  ymd(a.입고예정일) - ymd(b.입고예정일)
  || String(a.물류센터 || '').localeCompare(String(b.물류센터 || ''), 'ko', { numeric: true })
  || String(a.발주번호 || '').localeCompare(String(b.발주번호 || ''), 'ko', { numeric: true })
  || String(a.상품이름 || '').localeCompare(String(b.상품이름 || ''), 'ko', { numeric: true });

// 줄 문서 → 발주확인 저장 모양(입고예정일은 'YYYYMMDD' 글자).
const toRow = (l: Line): Record<string, unknown> => ({
  발주번호: l.발주번호, 물류센터: l.물류센터, 상품이름: l.상품이름, 확정수량: l.확정수량,
  입고예정일: (l.입고예정일 || '').replace(/-/g, ''),
  메모: l.메모 || '', 쉼먼트: l.쉼먼트 || '', 묶음: l.묶음 || '', 묶음센터: l.묶음센터 || '', 묶음일자: l.묶음일자 || '',
  SKU: l.SKU || '',
});

export const readWork = (): StoredWork => ({
  rows: linesAt('work').sort((a, b) => a.id.localeCompare(b.id)).map(toRow).sort(byOrder),
  ...meta,
});

// ── 쓰기 ──
// base: 화면이 고치기 전에 본 목록. 없으면 지금 목록을 기준으로 본다(읽자마자 고쳐 쓰는 곳).
// 열쇠(발주번호·상품·수량)마다 전과 후의 개수를 비교한다:
//  · 늘었으면 그만큼 줄을 발주확인으로 데려온다(휴지통 → 예약 순으로 찾고, 없으면 새 줄).
//  · 줄었으면 그만큼 발주확인 줄을 휴지통으로(다른 곳으로 이미 옮겨 갔으면 할 일 없음).
//  · 그대로인 줄은 화면이 고친 칸만 적는다.
export function applyWorkRows(baseRows: Record<string, unknown>[], rows: Record<string, unknown>[]) {
  const group = (list: Record<string, unknown>[]) => {
    const m = new Map<string, LineFields[]>();
    list.forEach(r => { const f = fieldsOf(r); const k = lineKey(f); m.set(k, [...(m.get(k) || []), f]); });
    return m;
  };
  const before = group(baseRows);
  const after = group(rows);
  const taken = new Set<string>();
  const out: Line[] = [];
  const workByKey = new Map<string, Line[]>();
  linesAt('work').sort((x, y) => x.id.localeCompare(y.id)).forEach(l => {
    const k = lineKey(l);
    workByKey.set(k, [...(workByKey.get(k) || []), l]);
  });
  // 바뀐 열쇠만 본다(화면은 저장할 때마다 부르므로 대부분 아무것도 안 바뀐다).
  const keys = Array.from(new Set([...before.keys(), ...after.keys()]))
    .filter(k => stableStringify(before.get(k) || []) !== stableStringify(after.get(k) || []));
  for (const k of keys) {
    const b = before.get(k) || [];
    const a = after.get(k) || [];
    const here = workByKey.get(k) || [];
    const same = Math.min(b.length, a.length);
    for (let i = 0; i < same; i++) {
      const l = here[i];
      if (!l) continue;
      const p = patched(l, b[i], a[i]);
      if (p) out.push(p);
      taken.add(l.id);
    }
    // 짝 없이 남은 발주확인 줄: 원래는 화면이 지운 줄들인데, 그보다 많으면 그사이 다른 컴퓨터가 넣은 줄이다.
    // 화면이 같은 줄을 더하려던 거면 그 줄을 그대로 쓴다(같은 줄이 두 번 생기지 않게).
    const pool = here.filter(l => !taken.has(l.id));
    const removeN = b.length - same;
    let adopt = Math.min(Math.max(0, pool.length - removeN), a.length - same);
    for (let i = same; i < a.length; i++) {
      if (adopt > 0) {
        const l = pool.shift()!;
        adopt--;
        taken.add(l.id);
        out.push({ ...l, ...a[i] });
        continue;
      }
      // 쉽먼트에 있는 줄은 끌어오지 않는다(쉽먼트에서 되돌릴 때는 먼저 휴지통으로 빠진다). 묵은 화면이 쉽먼트로 간 줄을
      // 발주확인으로 도로 끌어오는 일을 막으려고.
      const from = pickLine(k, ['trash', 'reserve'], new Set([...taken, ...here.map(l => l.id)]));
      const l = from ? moved(from, 'work', a[i]) : newLine(a[i], 'work', taken);
      taken.add(l.id);
      out.push(l);
    }
    for (let i = 0; i < removeN; i++) {
      const l = pool.pop();
      if (!l) break;
      taken.add(l.id);
      out.push(trashed(l));
    }
  }
  commit(out);
}

export const writeWork = (w: StoredWork, baseRows?: Record<string, unknown>[]) => {
  // 기준은 부른 순간의 목록으로 잡는다(클라우드와 맞추기 전에 불렸으면, 맞춘 뒤에 이 기준으로 차이만 적는다).
  const base = baseRows ?? readWork().rows;
  whenReady(() => {
    applyWorkRows(base, w.rows);
    writeMeta({ fileName: w.fileName, done: w.done || [], seen: w.seen || {} });
  });
};

// 목록이 바뀔 때마다 알려주고, 돌려주는 함수를 부르면 그만 듣는다.
export const subscribeWork = (cb: () => void): (() => void) => {
  startLines();
  startMeta();
  window.addEventListener(CHANGED, cb);
  const stop = subscribeLines(cb);
  return () => {
    window.removeEventListener(CHANGED, cb);
    stop();
  };
};

// 예전에는 컴퓨터끼리 목록이 어긋났을 때 이 컴퓨터 것으로 덮어썼다. 이제 줄마다 따로 저장되어 어긋나지 않으므로
// 할 일이 없다(버튼이 남아 있어도 아무것도 지우지 않게 둔다).
export const forceUploadWork = async () => { void allLines; };

// @ts-ignore
if (import.meta.hot) import.meta.hot.decline();
