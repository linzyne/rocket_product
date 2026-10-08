// 쿠팡발주확인의 묶음을 "출고"로 넘겨 두는 곳(발주 > 쉽먼트생성 화면에서 본다).
// 한 건 = 묶음 하나 + 그 묶음에 담긴 발주서 줄들.
//
//  coupangShipOuts/{출고번호} : ShipOut 한 건 그대로.
//
// 클라우드(Firestore)에 두어 다른 컴퓨터에서도 같은 목록을 본다. 이 기기의 localStorage에도
// 같이 남겨서 화면이 뜨자마자 바로 보이고, Firebase 설정이 없어도 이 기기 안에서는 돌아간다.
import { collection, deleteDoc, doc, getDocs, onSnapshot, setDoc } from 'firebase/firestore';
import { db, ensureSignedIn } from '../../../utils/firebase';
import type { OrderRow } from '../types';
import { dateKeyYMD, ymdSortKey } from '../utils/dateUtils';
import { isBoxSplit, parseBoxSplit, boxLabel } from '../utils/dataProcessor';
import { allBoxes } from '../../../data/shipmentStore';
import type { ShipmentBatch } from '../../../data/shipmentStore';
import { SHIPOUT_KEY, readWork, writeWork, workLineKey as lineKey, stableStringify } from './orderWorkCloud';

const KEY = SHIPOUT_KEY;
const COLLECTION = 'coupangShipOuts';
// 이 기기에 있던 출고를 클라우드 것과 한 번 합쳤는지. 합치기는 기기마다 딱 한 번만 한다.
const MERGED_KEY = 'coupangShipOuts.merged';

export interface ShipOutLine {
  발주번호: string;
  물류센터: string;
  상품이름: string;
  확정수량: number | '';
  입고예정일: string; // 'YYYY-MM-DD'
  메모?: string;
  쉼먼트?: string;
  묶음?: string;
  // 쿠팡 상품번호(SKU ID). 예전 줄에는 없다.
  SKU?: string;
}

export interface ShipOut {
  id: string;        // 출고 번호(예: S260925-1)
  bundle: string;    // 묶음 이름(묶음1 …)
  center: string;    // 택배가 가는 물류센터
  date: string;      // 입고예정일 'YYYY-MM-DD'
  createdAt: number;
  // 이 건이 들어간 쉽먼트(롯데 예약 묶음)의 번호. 쉽먼트생성을 누르면 붙는다.
  batchId?: string;
  // 서허 쉽먼트 양식을 채워 내려받은 시각(ms).
  formSavedAt?: number;
  // 사람이 직접 "쉽먼트 완료"로 표시한 시각(ms). 자동 표시가 안 잡히는 건을 손으로 끝낼 때 쓴다.
  doneAt?: number;
  // 완료를 다시 푼 시각(ms). 자동으로 완료로 잡히는 건이라도 이 값이 있으면 다시 할 일로 본다.
  undoneAt?: number;
  // 택배를 실제로 보낸 날('YYYY-MM-DD'). 발송대기에서 "발송 완료"를 누를 때 고른다. 있으면 발송 끝난 건.
  sentDate?: string;
  // 발송대기에서 "준비됨"으로 체크한 상품 줄들(발주번호│상품이름│확정수량).
  readyKeys?: string[];
  // 쿠팡에 센터·입고예정일 변경을 요청해 둔 상태(요청등록중). 승인을 누르면 이 값으로 바뀐다.
  request?: { center: string; date: string };
  // 발송대기에서 "출력완료"로 표시한 발주서(발주번호)들. 발주서를 종이로 뽑았는지 챙긴다.
  printedOrders?: string[];
  // 서허 쉽먼트 일괄등록으로 생긴 쉽먼트 번호(발주번호 → 쉽먼트 번호). 확장이 내역 조회·택배 쉽먼트 화면에서 찾아 준다.
  shipmentNos?: Record<string, string>;
  lines: ShipOutLine[];
}

// 새 것이 위로 오게(발주확인에서 넘긴 차례 그대로).
const sortList = (list: ShipOut[]) =>
  list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0) || b.id.localeCompare(a.id, 'ko', { numeric: true }));

// Firestore는 값이 undefined인 칸을 받지 않는다(완료를 풀 때 doneAt을 지우는 식으로 쓴다).
const clean = <T extends object>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
const cleanShipOut = (s: ShipOut): ShipOut => ({ ...clean(s), lines: s.lines.map(l => clean(l)) });

function read(): ShipOut[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeLocal(list: ShipOut[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {}
  // 같은 창의 다른 화면(쿠팡발주확인)에도 바로 알린다. 다른 탭은 storage 이벤트가 알려준다.
  window.dispatchEvent(new CustomEvent('coupang-shipouts-changed'));
}

// 마지막으로 클라우드에 올린 모양(출고번호 → 내용). 바뀐 건만 올리고, 없어진 건만 지우려고 둔다.
let lastPushed = new Map<string, string>();
// 클라우드에서 첫 소식을 받기 전에는 올리지 않는다. 그 전에 올리면 다른 기기에서 해 둔 작업을
// 이 기기의 묵은 목록으로 덮어쓸 수 있다.
let ready = !db;
let pending = false;

const syncToCloud = (list: ShipOut[]) => {
  if (!db) return;
  const firestore = db;
  const next = new Map(list.map(s => [s.id, stableStringify(cleanShipOut(s))]));
  const changed = [...next].filter(([id, json]) => lastPushed.get(id) !== json);
  const gone = [...lastPushed.keys()].filter(id => !next.has(id));
  lastPushed = next;
  if (!changed.length && !gone.length) return;
  (async () => {
    await ensureSignedIn();
    await Promise.all([
      ...changed.map(([id, json]) => setDoc(doc(firestore, COLLECTION, id), JSON.parse(json))),
      ...gone.map(id => deleteDoc(doc(firestore, COLLECTION, id))),
    ]);
  })().catch(err => console.error('출고 목록 올리기 실패:', err));
};

function write(list: ShipOut[]) {
  const sorted = sortList([...list]);
  writeLocal(sorted);
  if (ready) syncToCloud(sorted);
  else pending = true;
}

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
        collection(firestore, COLLECTION),
        // 이 기기 캐시에서 온 묵은 소식은 거르고 서버 소식으로 맞춘다(orderWorkCloud와 같은 까닭).
        { includeMetadataChanges: true },
        snap => {
          if (first && snap.metadata.fromCache) return;
          if (snap.metadata.fromCache && !snap.metadata.hasPendingWrites) return;
          const server = sortList(snap.docs.map(d => d.data() as ShipOut));
          if (first) {
            first = false;
            ready = true;
            // 처음 한 번은 이 기기에만 있던 출고를 잃지 않게 합친다. 그 뒤로는 클라우드가 늘 옳다
            // (다른 기기에서 지운 출고가 되살아나지 않게).
            const have = new Set(server.map(s => s.id));
            const mine = localStorage.getItem(MERGED_KEY) === '1' ? [] : read().filter(s => !have.has(s.id));
            try {
              localStorage.setItem(MERGED_KEY, '1');
            } catch {}
            const merged = sortList([...server, ...mine]);
            lastPushed = new Map(server.map(s => [s.id, stableStringify(cleanShipOut(s))]));
            writeLocal(merged);
            if (mine.length || pending) syncToCloud(merged);
            pending = false;
            return;
          }
          lastPushed = new Map(server.map(s => [s.id, stableStringify(cleanShipOut(s))]));
          // 내가 올린 것이 그대로 되돌아온 것이면 화면을 다시 그리지 않는다.
          if (stableStringify(server) === stableStringify(read())) return;
          writeLocal(server);
        },
        error => {
          // 못 받아와도 이 기기에 있는 목록으로 계속 일할 수 있게 열어 둔다.
          ready = true;
          console.error('출고 목록 동기화 실패(이 기기에 저장된 것을 씁니다):', error);
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

// 목록이 바뀔 때마다 알려준다. 돌려주는 함수를 부르면 그만 듣는다.
export function subscribeShipOuts(cb: (list: ShipOut[]) => void): () => void {
  const send = () => cb(read());
  send();
  window.addEventListener('coupang-shipouts-changed', send);
  window.addEventListener('storage', send);
  const stop = startSync();
  return () => {
    window.removeEventListener('coupang-shipouts-changed', send);
    window.removeEventListener('storage', send);
    stop();
  };
}

// 오늘 날짜 + 순번으로 출고 번호를 만든다(S260925-1).
function nextId(list: ShipOut[]): string {
  const now = new Date();
  const ymd = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const prefix = `S${ymd}-`;
  let no = 1;
  const used = new Set(list.map(s => s.id));
  while (used.has(`${prefix}${no}`)) no++;
  return `${prefix}${no}`;
}

// 묶음 하나를 출고로 넘긴다. 넘긴 건을 돌려준다.
export function addShipOut(bundle: string, center: string, date: string, rows: OrderRow[]): ShipOut {
  const list = read();
  const item: ShipOut = {
    id: nextId(list),
    bundle,
    center,
    date,
    createdAt: Date.now(),
    lines: rows.map(r => ({
      발주번호: r.발주번호,
      물류센터: r.물류센터,
      상품이름: r.상품이름,
      확정수량: r.확정수량,
      입고예정일: dateKeyYMD(r.입고예정일),
      메모: r.메모 || '',
      쉼먼트: r.쉼먼트 || '',
      묶음: r.묶음 || '',
      SKU: r.SKU || '',
    })),
  };
  write([item, ...list]);
  // 출고는 "이동"이다. 발주확인 저장소에서 그 줄들을 바로 뺀다(그 화면이 저장하기 전에 닫혀도
  // 확실히 빠지도록 여기서 직접 지운다).
  removeFromWork(item.lines);
  return item;
}

// 발주확인(발송 목록) 저장소에서 이 줄들을 지운다.
function removeFromWork(lines: ShipOutLine[]) {
  const work = readWork();
  const gone = new Set(lines.map(lineKey));
  writeWork({ ...work, rows: work.rows.filter(r => !gone.has(lineKey(r))) });
}

// 출고 건의 줄 하나를 고친다(예약 표시·박스 번호). 발주확인 표와 같은 버튼을 그대로 쓰기 위한 것.
export function updateShipOutLine(
  shipId: string,
  match: { 발주번호: string; 상품이름: string; 확정수량: number | ''; 입고예정일: string },
  patch: Partial<Pick<ShipOutLine, '메모' | '쉼먼트'>>,
) {
  const list = read();
  const item = list.find(s => s.id === shipId);
  if (!item) return;
  const line = item.lines.find(l =>
    l.발주번호 === match.발주번호 && l.상품이름 === match.상품이름 &&
    String(l.확정수량) === String(match.확정수량) && l.입고예정일 === match.입고예정일);
  if (!line) return;
  Object.assign(line, patch);
  write(list);
}

// 출고 건의 단계: 쉽먼트생성(할 일) → 발송대기(쉽먼트 완료, 아직 안 보냄) → 발송 완료(발송날짜 있음).
// 쉽먼트 완료는 사람이 켠 표시가 우선이고, 없으면 예약·운송장·서허 양식이 다 끝났는지로 본다(쉽먼트생성과 같은 기준).
export function shipOutBatch(item: ShipOut, batches: ShipmentBatch[]): ShipmentBatch | undefined {
  const mine = new Set(item.lines.map(l => String(l.발주번호 || '').trim()).filter(Boolean));
  return batches.find(b => b.id === item.batchId)
    || batches
      .filter(b => allBoxes(b).some(box => box.lines.some(l => mine.has(String(l.발주번호 || '').trim()))))
      .sort((a, b) => b.createdAt - a.createdAt)[0];
}
export function shipOutDone(item: ShipOut, batches: ShipmentBatch[]): boolean {
  if (item.doneAt) return true;
  if (item.undoneAt) return false;
  const batch = shipOutBatch(item, batches);
  const boxes = batch ? allBoxes(batch) : [];
  return boxes.length > 0 && boxes.every(b => (b.waybill || '').trim()) && !!item.formSavedAt;
}
export type ShipStage = 'ship' | 'waiting' | 'sent';
export function shipOutStage(item: ShipOut, batches: ShipmentBatch[]): ShipStage {
  if (item.sentDate) return 'sent';
  return shipOutDone(item, batches) ? 'waiting' : 'ship';
}

// 출고 건의 입고예정일을 바꾼다(건과 그 안의 줄 모두). 묶음에서 날짜를 잘못 골랐을 때 쿠팡 날짜로 맞춘다.
export function setShipOutDate(id: string, date: string) {
  const list = read();
  const item = list.find(s => s.id === id);
  if (!item) return;
  item.date = date;
  item.lines = item.lines.map(l => ({ ...l, 입고예정일: date }));
  write(list);
}

// 요청등록중에 적어 둔 센터·입고예정일을 실제 값으로 옮기고 요청은 지운다.
export function applyShipOutRequest(id: string) {
  const list = read();
  const item = list.find(s => s.id === id);
  if (!item?.request) return;
  const { center, date } = item.request;
  if (center) item.center = center;
  if (date) item.date = date;
  item.lines = item.lines.map(l => ({ ...l, ...(center ? { 물류센터: center } : {}), ...(date ? { 입고예정일: date } : {}) }));
  item.request = undefined;
  write(list);
}

// 출고 건들에 진행 표시를 붙인다(쉽먼트 번호·양식 저장 시각).
export function markShipOuts(ids: string[], patch: Partial<Pick<ShipOut, 'batchId' | 'formSavedAt' | 'doneAt' | 'undoneAt' | 'sentDate' | 'readyKeys' | 'request' | 'printedOrders' | 'shipmentNos'>>) {
  const want = new Set(ids);
  const list = read();
  let touched = false;
  for (const item of list) {
    if (!want.has(item.id)) continue;
    Object.assign(item, patch);
    touched = true;
  }
  if (touched) write(list);
}

export function deleteShipOut(id: string) {
  write(read().filter(s => s.id !== id));
}

// 출고 줄들을 쿠팡발주확인(발송 목록) 저장소에 되돌려 넣는다. 그 화면이 떠 있지 않아도 되도록
// 저장소에 바로 써 넣는다. 이미 있는 줄은 건너뛴다.
function pushBackToWork(lines: ShipOutLine[], fallbackBundle: string) {
  const work = readWork();
  const rows = work.rows;
  const seen = new Set(rows.map(lineKey));

  // 발주확인 쪽 저장 모양에 맞춘다(입고예정일은 'YYYYMMDD' 글자).
  const back = lines
    .map(l => ({
      발주번호: l.발주번호,
      물류센터: l.물류센터,
      상품이름: l.상품이름,
      확정수량: l.확정수량,
      입고예정일: l.입고예정일.replace(/-/g, ''),
      메모: l.메모 || '',
      // 여러 박스로 나눈 값("박스3:6/박스4:6")은 발주확인에서 못 읽으므로 첫 박스로 돌린다.
      쉼먼트: isBoxSplit(l.쉼먼트 || '') ? (parseBoxSplit(l.쉼먼트 || '').map(p => boxLabel(p.no))[0] || '') : (l.쉼먼트 || ''),
      묶음: l.묶음 || fallbackBundle,
      묶음센터: '',
      묶음일자: '',
      SKU: l.SKU || '',
    }))
    .filter(r => !seen.has(lineKey(r)));

  // 되돌린 줄은 맨 아래가 아니라 원래 자리(입고예정일 → 물류센터 → 발주번호 → 상품이름 순)에 끼워 넣는다.
  const merged = [...rows, ...back].sort((a, b) => {
    const da = ymdSortKey(a.입고예정일 as string);
    const db = ymdSortKey(b.입고예정일 as string);
    if (da !== db) return da - db;
    const kc = String(a.물류센터 || '').localeCompare(String(b.물류센터 || ''), 'ko', { numeric: true });
    if (kc !== 0) return kc;
    const ko = String(a.발주번호 || '').localeCompare(String(b.발주번호 || ''), 'ko', { numeric: true });
    if (ko !== 0) return ko;
    return String(a.상품이름 || '').localeCompare(String(b.상품이름 || ''), 'ko', { numeric: true });
  });

  writeWork({ ...work, rows: merged });
  return back.length;
}

// 출고 한 건을 통째로 발주확인으로 되돌린다.
export function restoreShipOut(id: string): boolean {
  const item = read().find(s => s.id === id);
  if (!item) return false;
  // 출고 목록에서 먼저 빼야 발주확인 저장이 이 줄들을 "이미 넘어간 줄"로 걸러내지 않는다.
  write(read().filter(s => s.id !== id));
  pushBackToWork(item.lines, item.bundle);
  return true;
}

// 고른 발주서(발주번호)만 발주확인으로 되돌린다. 줄이 하나도 안 남은 출고 건은 목록에서 사라진다.
export function restoreOrders(orderNos: string[]): number {
  const want = new Set(orderNos);
  const list = read();
  const next: ShipOut[] = [];
  const backs: { lines: ShipOutLine[]; bundle: string }[] = [];
  for (const item of list) {
    const back = item.lines.filter(l => want.has(l.발주번호));
    const stay = item.lines.filter(l => !want.has(l.발주번호));
    if (back.length) {
      backs.push({ lines: back, bundle: item.bundle });
      if (stay.length) next.push({ ...item, lines: stay });
    } else {
      next.push(item);
    }
  }
  // 출고 목록에서 먼저 빼야 발주확인 저장이 이 줄들을 "이미 넘어간 줄"로 걸러내지 않는다.
  write(next);
  return backs.reduce((n, b) => n + pushBackToWork(b.lines, b.bundle), 0);
}

// 쉽먼트 기록에는 있는데 발주확인·쉽먼트생성·발송대기·발송 완료 어디에도 없는 줄(사라진 발주 찾기).
// 쉽먼트 기록은 출고 건을 되돌리거나 지워도 남아 있어서, 거기서 발주번호·상품·수량·센터·입고예정일을 되찾는다.
// 여러 박스로 나눈 줄은 합치고, 같은 줄이 여러 기록에 있으면 나중 기록을 쓴다.
export type OrphanLine = { 발주번호: string; 물류센터: string; 상품이름: string; 확정수량: number; 입고예정일: string; batchId: string };
export function findOrphanLines(batches: ShipmentBatch[]): OrphanLine[] {
  const have = new Set([
    ...readWork().rows.map(r => `${String(r.발주번호 ?? '').trim()}│${String(r.상품이름 ?? '').trim()}`),
    ...read().flatMap(s => s.lines.map(l => `${String(l.발주번호).trim()}│${String(l.상품이름).trim()}`)),
  ]);
  const found = new Map<string, OrphanLine>();
  for (const b of [...batches].sort((x, y) => (x.createdAt || 0) - (y.createdAt || 0))) {
    const mine = new Map<string, OrphanLine>();
    for (const box of allBoxes(b)) {
      for (const l of box.lines) {
        const k = `${String(l.발주번호).trim()}│${String(l.상품이름).trim()}`;
        if (have.has(k)) continue;
        const was = mine.get(k);
        if (was) was.확정수량 += Number(l.확정수량) || 0;
        else mine.set(k, { 발주번호: String(l.발주번호).trim(), 물류센터: box.center, 상품이름: String(l.상품이름).trim(), 확정수량: Number(l.확정수량) || 0, 입고예정일: dateKeyYMD(l.입고예정일), batchId: b.id });
      }
    }
    mine.forEach((v, k) => found.set(k, v));
  }
  return Array.from(found.values()).sort((a, b) => ymdSortKey(b.입고예정일) - ymdSortKey(a.입고예정일) || a.물류센터.localeCompare(b.물류센터, 'ko', { numeric: true }) || a.발주번호.localeCompare(b.발주번호));
}

// 찾은 줄을 발주확인으로 되살린다(묶음 없이).
export function restoreOrphanLines(lines: OrphanLine[]): number {
  return pushBackToWork(lines.map(l => ({ 발주번호: l.발주번호, 물류센터: l.물류센터, 상품이름: l.상품이름, 확정수량: l.확정수량, 입고예정일: l.입고예정일 })), '');
}

// 쉽먼트생성·발송대기·발송 완료에 있는 모든 줄(발주서를 새로 받을 때 이미 있는 줄을 세는 데 쓴다).
export function allShipOutLines(): ShipOutLine[] {
  return read().flatMap(s => s.lines);
}

// 이미 쉽먼트생성으로 넘어간 줄들의 열쇠. 발주서를 다시 받아올 때 이 줄들이 발주확인에
// 되살아나지 않게 거르는 데 쓴다. 센터·입고예정일은 묶음 적용으로 바뀔 수 있어 열쇠에서 뺀다.
export function shipOutLineKeys(): Set<string> {
  return new Set(read().flatMap(s => s.lines.map(lineKey)));
}

// ── 되돌리기(실행취소)용 ──
// 쉽먼트생성 화면에서 한 일은 이 파일의 출고 목록과, 되돌리기로 넘어가는 발주확인 작업 목록만 건드린다.
// 그래서 그 둘을 통째로 찍어 두었다가 그대로 써넣으면 방금 한 일이 없던 일이 된다.
export interface ShipSnapshot {
  shipOuts: string;
  work: string;
}

export function snapshotShipOuts(): ShipSnapshot {
  return {
    shipOuts: stableStringify(read()),
    work: stableStringify(readWork()),
  };
}

export function restoreShipSnapshot(snap: ShipSnapshot) {
  try {
    write(JSON.parse(snap.shipOuts));
    writeWork(JSON.parse(snap.work));
  } catch {}
}

// 출고 목록만 스냅샷 값으로 되돌린다(쿠팡발주확인의 되돌리기가 쓴다. 작업 목록은 그 화면이 따로 되돌린다).
export function restoreShipOutsOnly(json: string) {
  try { write(JSON.parse(json)); } catch {}
}

// 두 스냅샷이 같은지(바뀐 게 없으면 되돌리기 목록에 쌓지 않는다).
export const sameSnapshot = (a: ShipSnapshot, b: ShipSnapshot) =>
  a.shipOuts === b.shipOuts && a.work === b.work;

// 이 기기의 출고 목록을 클라우드에 그대로 덮어쓴다(클라우드에만 있는 출고는 지운다). 컴퓨터끼리
// 어긋났을 때 이 컴퓨터 것으로 맞추는 데 쓴다. 다 올라가야 끝난다.
export async function forceUploadShipOuts() {
  if (!db) throw new Error('이 컴퓨터는 클라우드에 연결돼 있지 않아요(.env.local의 Firebase 설정이 없음).');
  const firestore = db;
  await ensureSignedIn();
  const list = read();
  const mine = new Set(list.map(s => s.id));
  const server = await getDocs(collection(firestore, COLLECTION));
  lastPushed = new Map(list.map(s => [s.id, stableStringify(cleanShipOut(s))]));
  ready = true;
  pending = false;
  await Promise.all([
    ...list.map(s => setDoc(doc(firestore, COLLECTION, s.id), cleanShipOut(s))),
    ...server.docs.filter(d => !mine.has(d.id)).map(d => deleteDoc(d.ref)),
  ]);
}

// 클라우드 구독·올리기 상태를 모듈에 들고 있어서, 개발 중 이 파일만 바뀌면 옛것과 새것 두 벌이 같이 돌며
// 목록을 번갈아 덮어쓴다(지운 줄이 사라졌다 생겼다 함). 바뀌면 페이지를 통째로 새로 불러오게 한다.
// @ts-ignore
if (import.meta.hot) import.meta.hot.decline();

// 발주번호별 쉽먼트 번호를 그 발주서가 든 출고 건마다 적는다(쉽먼트생성대기·발송대기 어디에 있든).
// 이미 같은 값이면 쓰지 않는다(앱을 열 때마다 다시 받아 와도 괜찮게).
export function applyShipmentNos(byOrder: Record<string, string>) {
  const found = Object.entries(byOrder).filter(([, ship]) => ship);
  if (!found.length) return 0;
  const list = read();
  let changed = 0;
  for (const item of list) {
    const mine = new Set(item.lines.map(l => String(l.발주번호 || '').trim()));
    const next = { ...(item.shipmentNos || {}) };
    let touched = false;
    for (const [no, ship] of found) {
      if (mine.has(no) && next[no] !== ship) { next[no] = ship; touched = true; }
    }
    if (touched) { item.shipmentNos = next; changed += 1; }
  }
  if (changed) write(list);
  return changed;
}
