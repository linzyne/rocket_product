// 입고예정일·센터 변경 요청. 발주 진행에서 "날짜 바꾸기"를 한 발주서에 "변경 요청 중" 표시를 해 두고,
// 서허에서 승인을 확인한 뒤 "적용"을 누르면 확장이 서허 발주서 목록에 지금 적힌 입고예정일·센터를 읽어 와서
// 앱의 발주서(발주확인·예약·쉽먼트 어디에 있든)에 그대로 적는다. 승인이 안 됐으면(값이 그대로) 표시만 남는다.
//
//  coupangPoDateReq/{발주번호} : { no, at, doneAt?, from?, to? }
//    at만 있으면 변경 요청 중, doneAt이 있으면 날짜 변경 완료(from → to).
import { collection, doc, onSnapshot, setDoc, deleteDoc } from 'firebase/firestore';
import { db, ensureSignedIn } from '../../../utils/firebase';
import { allLines, commit, linesReady } from './lineStore';
import type { Line } from './lineStore';
import { retargetOrders } from './shipOutStore';
import type { ShipOut } from './shipOutStore';

const COLLECTION = 'coupangPoDateReq';
const LOCAL_KEY = 'coupangPoDateReq';
const CHANGED = 'coupang-po-date-req-changed';
const docId = (no: string) => no.trim().replace(/\//g, '∕');

// want: 서허 요청 등록 때 적은 변경 센터·입고예정일(확장이 기억해 넘겨준 값). "적용"은 이 값으로 바꾼다.
export interface DateReq { at: number; doneAt?: number; from?: string; to?: string; want?: { center: string; date: string } }
const asReq = (v: unknown): DateReq => (typeof v === 'number' ? { at: v } : { at: 0, ...(v as DateReq) });
let reqs: Record<string, DateReq> = (() => {
  try { return Object.fromEntries(Object.entries(JSON.parse(localStorage.getItem(LOCAL_KEY) || '') || {}).map(([k, v]) => [k, asReq(v)])); } catch { return {}; }
})();
const notify = () => {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(reqs)); } catch {}
  window.dispatchEvent(new CustomEvent(CHANGED));
};

let started = false;
export function subscribeDateRequests(cb: (r: Record<string, DateReq>) => void): () => void {
  const send = () => cb({ ...reqs });
  send();
  window.addEventListener(CHANGED, send);
  if (!started && db) {
    started = true;
    const firestore = db;
    ensureSignedIn().then(() => onSnapshot(collection(firestore, COLLECTION), snap => {
      reqs = Object.fromEntries(snap.docs.map(d => {
        const v = d.data() as DateReq & { no?: string };
        return [String(v.no || d.id), {
          at: Number(v.at) || 0,
          ...(v.doneAt ? { doneAt: v.doneAt, from: v.from || '', to: v.to || '' } : {}),
          ...(v.want ? { want: v.want } : {}),
        }];
      }));
      notify();
    }, err => console.error('날짜 변경 요청 동기화 실패:', err)));
  }
  return () => window.removeEventListener(CHANGED, send);
}

export function markDateRequested(nos: string[], on: boolean) {
  const list = Array.from(new Set(nos.map(n => n.trim()).filter(Boolean)));
  if (!list.length) return;
  const next = { ...reqs };
  list.forEach(n => { if (on) next[n] = { at: Date.now() }; else delete next[n]; });
  reqs = next;
  notify();
  if (!db) return;
  const firestore = db;
  ensureSignedIn().then(() => Promise.all(list.map(n => on
    ? setDoc(doc(firestore, COLLECTION, docId(n)), { no: n, at: Date.now() })
    : deleteDoc(doc(firestore, COLLECTION, docId(n))))))
    .catch(err => console.error('날짜 변경 요청 저장 실패:', err));
}

export interface ApplyResult {
  changed: { no: string; from: string; to: string }[];
  same: string[];
  missing: string[];
  moved: { before: ShipOut; to: { center: string; date: string } }[];
}

// 확장이 기억한 "요청 등록 때 적은 변경 센터·날짜"를 적어 둔다(어느 컴퓨터에서든 적용할 수 있게).
export function rememberRequested(data: Record<string, { center?: string; date?: string; at?: number }>) {
  const changed: string[] = [];
  const next = { ...reqs };
  for (const [no, v] of Object.entries(data || {})) {
    const want = { center: String(v.center || '').trim(), date: String(v.date || '').trim() };
    if (!want.center && !want.date) continue;
    const cur = next[no];
    if (cur?.doneAt) continue; // 이미 적용한 건 건드리지 않는다
    if (cur?.want && cur.want.center === want.center && cur.want.date === want.date) continue;
    next[no] = { at: cur?.at || Number(v.at) || Date.now(), want };
    changed.push(no);
  }
  if (!changed.length) return;
  reqs = next;
  notify();
  if (!db) return;
  const firestore = db;
  ensureSignedIn().then(() => Promise.all(changed.map(no => setDoc(doc(firestore, COLLECTION, docId(no)), { no, ...next[no] }))))
    .catch(err => console.error('요청 내용 저장 실패:', err));
}
export const requestedOf = (no: string) => reqs[no]?.want;

// 날짜 변경 완료로 적는다(카드에 작게 "날짜변경완료"를 보여준다).
function markDateDone(done: { no: string; from: string; to: string }[]) {
  if (!done.length) return;
  const next = { ...reqs };
  const now = Date.now();
  done.forEach(d => { next[d.no] = { at: next[d.no]?.at || now, doneAt: now, from: d.from, to: d.to, ...(next[d.no]?.want ? { want: next[d.no].want } : {}) }; });
  reqs = next;
  notify();
  if (!db) return;
  const firestore = db;
  ensureSignedIn().then(() => Promise.all(done.map(d => setDoc(doc(firestore, COLLECTION, docId(d.no)), { no: d.no, ...next[d.no] }))))
    .catch(err => console.error('날짜 변경 완료 저장 실패:', err));
}

// 서허에서 읽어 온 지금 값(발주번호 → 센터·입고예정일 'YYYY-MM-DD')을 앱에 적는다.
export async function applyCurrent(nos: string[], current: Record<string, { center: string; date: string }>): Promise<ApplyResult> {
  await linesReady();
  const res: ApplyResult = { changed: [], same: [], missing: [], moved: [] };
  const byOrder: Record<string, { center: string; date: string }> = {};
  const out: Line[] = [];
  for (const no of nos) {
    const now = current[no];
    if (!now || (!now.center && !now.date)) { res.missing.push(no); continue; }
    const lines = allLines().filter(l => l.발주번호 === no && l.place !== 'trash');
    const first = lines[0];
    const from = first ? `${first.입고예정일} ${first.물류센터}` : '';
    const to = `${now.date || first?.입고예정일 || ''} ${now.center || first?.물류센터 || ''}`;
    if (!lines.some(l => (now.center && l.물류센터 !== now.center) || (now.date && l.입고예정일 !== now.date))) {
      res.same.push(no);
      continue;
    }
    res.changed.push({ no, from, to });
    byOrder[no] = { center: now.center || first?.물류센터 || '', date: now.date || first?.입고예정일 || '' };
    // 발주확인·예약에 있는 줄은 여기서 바로 고친다(쉽먼트 줄은 출고 건과 함께 아래에서).
    lines.filter(l => l.place !== 'ship').forEach(l => out.push({ ...l, 물류센터: byOrder[no].center, 입고예정일: byOrder[no].date, 묶음센터: '', 묶음일자: '' }));
  }
  commit(out);
  if (Object.keys(byOrder).length) res.moved = retargetOrders(byOrder);
  // 바뀐 발주서는 요청이 끝난 것이다(날짜변경완료로 남긴다).
  markDateDone(res.changed);
  return res;
}
