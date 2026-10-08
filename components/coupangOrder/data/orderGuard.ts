// 발주 줄 지킴이. 발주 줄은 발주확인(작업 목록) · 예약 · 쉽먼트생성/발송대기(출고) 세 곳 중 한 곳에 꼭 있어야 한다.
// 옮기는 길이 여러 갈래라 어느 한 군데서 실수하면 줄이 어디에도 없게 된다(실제로 쉽먼트생성대기 → 발주확인으로
// 보낸 줄이 사라졌다). 그래서 옮기는 코드를 믿지 않고, 따로 "본 적 있는 줄" 장부를 두고 지켜본다.
//
//  coupangOrderLedger/{발주번호│상품이름} : 그 줄의 마지막 모습(센터·입고예정일·수량 등).
//
//  · 세 곳 어디든 줄이 보이면 장부에 적는다(새로 들어온 줄도, 고친 줄도).
//  · 사람이 일부러 지운 줄은 forgetLines로 장부에서 뺀다.
//  · 발송 완료된 출고의 줄은 끝난 일이라 장부에서 뺀다(장부가 끝없이 커지지 않게).
//  · 장부에 있는데 세 곳 어디에도 없으면, 30초 뒤 서버에서 한 번 더 확인하고 그래도 없으면
//    발주확인으로 되살리고 화면 위에 알린다.
import { collection, doc, getDocsFromServer, onSnapshot, writeBatch, getDocFromServer } from 'firebase/firestore';
import { db, ensureSignedIn } from '../../../utils/firebase';
import { readWork, readWorkFromServer, subscribeWork, SHIPOUT_KEY } from './orderWorkCloud';
import { subscribeReservations } from './reservationStore';
import { subscribeShipOuts, restoreOrphanLines } from './shipOutStore';
import type { ShipOut } from './shipOutStore';
import type { OrderRow } from '../types';
import { dateKeyYMD } from '../utils/dateUtils';

const COLLECTION = 'coupangOrderLedger';
const RESTORED_KEY = 'coupangOrderGuard.restored';
const CHANGED = 'coupang-guard-restored';
// 줄이 없어진 걸 보고 나서 되살리기 전까지 기다리는 시간. 다른 컴퓨터에서 옮기는 중이면 그 사이에 도착한다.
const GRACE_MS = 30 * 1000;
// 일부러 지운 줄은 이 시간 동안 다시 장부에 적지 않는다(지우기가 저장되는 사이 아직 보일 수 있어서).
const FORGET_MS = 2 * 60 * 1000;

export interface LedgerLine {
  발주번호: string;
  물류센터: string;
  상품이름: string;
  확정수량: number | '';
  입고예정일: string; // 'YYYY-MM-DD'
  SKU?: string;
  seenAt: number;
}

export interface RestoredNote { at: number; lines: { 발주번호: string; 상품이름: string; 확정수량: number | '' }[] }

const key = (l: { 발주번호?: unknown; 상품이름?: unknown }) =>
  `${String(l.발주번호 ?? '').trim()}│${String(l.상품이름 ?? '').trim()}`;
// Firestore 문서 id에는 '/'를 못 쓴다.
const docId = (k: string) => k.replace(/\//g, '∕');

const toLedger = (l: Record<string, unknown>): Omit<LedgerLine, 'seenAt'> => ({
  발주번호: String(l.발주번호 ?? '').trim(),
  물류센터: String(l.물류센터 ?? '').trim(),
  상품이름: String(l.상품이름 ?? '').trim(),
  확정수량: (l.확정수량 === '' || l.확정수량 == null ? '' : Number(l.확정수량)) as number | '',
  입고예정일: dateKeyYMD(l.입고예정일 as string),
  SKU: String(l.SKU ?? ''),
});
const sameLine = (a: Omit<LedgerLine, 'seenAt'>, b: Omit<LedgerLine, 'seenAt'>) =>
  a.물류센터 === b.물류센터 && String(a.확정수량) === String(b.확정수량) && a.입고예정일 === b.입고예정일 && (a.SKU || '') === (b.SKU || '');

const readShipOutsLocal = (): ShipOut[] => {
  try {
    const list = JSON.parse(localStorage.getItem(SHIPOUT_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
};

// ── 일부러 지운 줄 ──
const forgotten = new Map<string, number>();

// 사람이 일부러 지운 줄(발주확인에서 줄 삭제·전체 비우기, 예약 삭제, 출고 삭제, 되돌리기로 없어진 줄).
// 장부에서 빼서 "사라졌다"고 되살리지 않게 한다.
export function forgetLines(lines: { 발주번호?: unknown; 상품이름?: unknown }[]) {
  const keys = Array.from(new Set(lines.map(key).filter(k => k !== '│')));
  if (!keys.length) return;
  const now = Date.now();
  keys.forEach(k => { forgotten.set(k, now); ledger.delete(k); missingSince.delete(k); });
  if (!db) return;
  const firestore = db;
  (async () => {
    await ensureSignedIn();
    for (let i = 0; i < keys.length; i += 450) {
      const batch = writeBatch(firestore);
      keys.slice(i, i + 450).forEach(k => batch.delete(doc(firestore, COLLECTION, docId(k))));
      await batch.commit();
    }
  })().catch(err => console.error('발주 장부에서 빼기 실패:', err));
}

// 되돌리기 전후를 비교해, 되돌리기로 세 곳 어디에서도 없어진 줄을 지운 줄로 친다.
export function forgetDropped(before: { 발주번호?: unknown; 상품이름?: unknown }[], after: { 발주번호?: unknown; 상품이름?: unknown }[]) {
  const still = new Set(after.map(key));
  forgetLines(before.filter(l => !still.has(key(l))));
}

// 지금 세 곳에 있는 모든 줄(되돌리기 전후 비교에 쓴다). 예약은 화면이 들고 있는 것을 넘겨받는다.
export function allPlacedLines(reservations: OrderRow[] = lastReservations): Record<string, unknown>[] {
  return [
    ...readWork().rows,
    ...(reservations as unknown as Record<string, unknown>[]),
    ...(readShipOutsLocal().flatMap(s => s.lines) as unknown as Record<string, unknown>[]),
  ];
}

// 지금 예약에 있는 줄(쉽먼트생성 화면의 되돌리기는 예약을 건드리지 않아서 전후 양쪽에 그대로 넣는다).
export const placedReservations = (): Record<string, unknown>[] => lastReservations as unknown as Record<string, unknown>[];

// ── 되살린 기록(화면 위 알림) ──
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
  window.dispatchEvent(new CustomEvent(CHANGED));
}
export function subscribeRestored(cb: (notes: RestoredNote[]) => void): () => void {
  const send = () => cb(readRestored());
  send();
  window.addEventListener(CHANGED, send);
  return () => window.removeEventListener(CHANGED, send);
}
const noteRestored = (lines: LedgerLine[]) => {
  const note: RestoredNote = { at: Date.now(), lines: lines.map(l => ({ 발주번호: l.발주번호, 상품이름: l.상품이름, 확정수량: l.확정수량 })) };
  try { localStorage.setItem(RESTORED_KEY, JSON.stringify([...readRestored(), note].slice(-20))); } catch {}
  window.dispatchEvent(new CustomEvent(CHANGED));
};

// ── 지켜보기 ──
const ledger = new Map<string, LedgerLine>();
let ledgerReady = false;
let lastReservations: OrderRow[] = [];
let reservationsReady = false;
const missingSince = new Map<string, number>();
let checking = false;

// 세 곳에 지금 있는 줄. sent: 발송 완료된 출고의 줄(끝난 일).
const placed = () => {
  const live = new Map<string, Omit<LedgerLine, 'seenAt'>>();
  const sent = new Set<string>();
  readWork().rows.forEach(r => live.set(key(r), toLedger(r)));
  lastReservations.forEach(r => live.set(key(r), toLedger(r as unknown as Record<string, unknown>)));
  for (const s of readShipOutsLocal()) {
    for (const l of s.lines) {
      if (s.sentDate) sent.add(key(l));
      else live.set(key(l), toLedger(l as unknown as Record<string, unknown>));
    }
  }
  return { live, sent };
};

// 보이는 줄을 장부에 적고, 끝난 줄은 장부에서 뺀다.
const record = () => {
  if (!db || !ledgerReady || !reservationsReady) return;
  const firestore = db;
  const { live, sent } = placed();
  const now = Date.now();
  const put: LedgerLine[] = [];
  live.forEach((line, k) => {
    if (!line.발주번호 || !line.상품이름) return;
    const f = forgotten.get(k);
    if (f && now - f < FORGET_MS) return;
    const had = ledger.get(k);
    if (had && sameLine(had, line)) return;
    const next = { ...line, seenAt: now };
    ledger.set(k, next);
    put.push(next);
  });
  const done = Array.from(ledger.keys()).filter(k => sent.has(k) && !live.has(k));
  done.forEach(k => ledger.delete(k));
  if (!put.length && !done.length) return;
  (async () => {
    await ensureSignedIn();
    const ops = [
      ...put.map(l => (b: ReturnType<typeof writeBatch>) => b.set(doc(firestore, COLLECTION, docId(key(l))), l)),
      ...done.map(k => (b: ReturnType<typeof writeBatch>) => b.delete(doc(firestore, COLLECTION, docId(k)))),
    ];
    for (let i = 0; i < ops.length; i += 450) {
      const batch = writeBatch(firestore);
      ops.slice(i, i + 450).forEach(op => op(batch));
      await batch.commit();
    }
  })().catch(err => console.error('발주 장부 적기 실패:', err));
};

// 장부에는 있는데 세 곳 어디에도 없는 줄을 찾는다. 오래 없으면 서버에서 다시 확인하고 되살린다.
const check = async () => {
  if (!db || !ledgerReady || !reservationsReady || checking) return;
  const { live, sent } = placed();
  const now = Date.now();
  const gone = Array.from(ledger.keys()).filter(k => !live.has(k) && !sent.has(k));
  const goneSet = new Set(gone);
  Array.from(missingSince.keys()).forEach(k => { if (!goneSet.has(k)) missingSince.delete(k); });
  gone.forEach(k => { if (!missingSince.has(k)) missingSince.set(k, now); });
  const due = gone.filter(k => now - (missingSince.get(k) || now) >= GRACE_MS);
  if (!due.length) return;

  checking = true;
  try {
    const firestore = db;
    await ensureSignedIn();
    // 캐시 말고 서버의 진짜 값으로 세 곳과 장부를 다시 본다.
    const [work, res, ships] = await Promise.all([
      readWorkFromServer(),
      getDocsFromServer(collection(firestore, 'coupangReservations')),
      getDocsFromServer(collection(firestore, 'coupangShipOuts')),
    ]);
    const there = new Set<string>([
      ...(work?.rows || []).map(key),
      ...res.docs.map(d => key(d.data())),
      ...ships.docs.flatMap(d => ((d.data() as ShipOut).lines || []).map(key)),
    ]);
    // 그사이 이 기기에서 옮긴 줄도 다시 본다.
    placed().live.forEach((_, k) => there.add(k));
    placed().sent.forEach(k => there.add(k));
    const lost: LedgerLine[] = [];
    for (const k of due) {
      missingSince.delete(k);
      if (there.has(k)) continue;
      // 다른 컴퓨터에서 일부러 지운 줄이면 장부에서도 빠져 있다.
      const snap = await getDocFromServer(doc(firestore, COLLECTION, docId(k)));
      if (!snap.exists()) { ledger.delete(k); continue; }
      lost.push(snap.data() as LedgerLine);
    }
    if (!lost.length) return;
    console.warn('[발주 지킴이] 어디에도 없는 발주 줄을 발주확인으로 되살립니다:', lost);
    restoreOrphanLines(lost.map(l => ({
      발주번호: l.발주번호, 물류센터: l.물류센터, 상품이름: l.상품이름,
      확정수량: Number(l.확정수량) || 0, 입고예정일: l.입고예정일, batchId: '',
    })));
    noteRestored(lost);
  } catch (err) {
    console.error('[발주 지킴이] 확인 실패:', err);
  } finally {
    checking = false;
  }
};

let started = false;
// 앱이 켜져 있는 동안 한 번만 건다(어느 화면을 보든 돈다).
export function startOrderGuard() {
  if (started || !db) return;
  started = true;
  const firestore = db;
  const kick = () => { record(); check(); };
  subscribeWork(kick);
  subscribeShipOuts(kick);
  subscribeReservations(rows => { lastReservations = rows; reservationsReady = true; kick(); });
  (async () => {
    await ensureSignedIn();
    onSnapshot(
      collection(firestore, COLLECTION),
      { includeMetadataChanges: true },
      snap => {
        if (snap.metadata.fromCache && !ledgerReady) return;
        // 이 기기가 막 지운 줄은 서버 소식이 늦게 와도 되살리지 않는다.
        const now = Date.now();
        ledger.clear();
        snap.docs.forEach(d => {
          const l = d.data() as LedgerLine;
          const k = key(l);
          const f = forgotten.get(k);
          if (f && now - f < FORGET_MS) return;
          ledger.set(k, l);
        });
        ledgerReady = true;
        kick();
      },
      err => console.error('[발주 지킴이] 장부 동기화 실패:', err),
    );
  })();
  setInterval(kick, 15 * 1000);
}
