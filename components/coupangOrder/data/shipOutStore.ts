// 쿠팡발주확인의 묶음을 "출고"로 넘겨 두는 곳(발주 > 쉽먼트생성 화면에서 본다).
// 한 건 = 묶음 하나 + 그 묶음에 담긴 발주서 줄들. 이 컴퓨터의 localStorage에만 저장한다.
import type { OrderRow } from '../types';
import { dateKeyYMD, ymdSortKey } from '../utils/dateUtils';

const KEY = 'coupangShipOuts';
// 쿠팡발주확인이 작업 중인 목록을 담아 두는 곳(그 화면의 localStorage 키와 같아야 한다).
const WORK_KEY = 'coupangOrderWork';

// 한 줄을 가리키는 열쇠. 센터·입고예정일은 묶음 적용으로 바뀔 수 있어 빼고 본다.
const lineKey = (r: { 발주번호?: unknown; 상품이름?: unknown; 확정수량?: unknown }) =>
  `${r.발주번호}│${r.상품이름}│${r.확정수량}`;

export interface ShipOutLine {
  발주번호: string;
  물류센터: string;
  상품이름: string;
  확정수량: number | '';
  입고예정일: string; // 'YYYY-MM-DD'
  메모?: string;
  쉼먼트?: string;
  묶음?: string;
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
  lines: ShipOutLine[];
}

function read(): ShipOut[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function write(list: ShipOut[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {}
  // 같은 창의 다른 화면(쉽먼트생성)에도 바로 알린다. 다른 탭은 storage 이벤트가 알려준다.
  window.dispatchEvent(new CustomEvent('coupang-shipouts-changed'));
}

// 목록이 바뀔 때마다 알려준다. 돌려주는 함수를 부르면 그만 듣는다.
export function subscribeShipOuts(cb: (list: ShipOut[]) => void): () => void {
  const send = () => cb(read());
  send();
  window.addEventListener('coupang-shipouts-changed', send);
  window.addEventListener('storage', send);
  return () => {
    window.removeEventListener('coupang-shipouts-changed', send);
    window.removeEventListener('storage', send);
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
  try {
    const work = JSON.parse(localStorage.getItem(WORK_KEY) || '');
    const rows = Array.isArray(work.rows) ? work.rows : [];
    const gone = new Set(lines.map(lineKey));
    const kept = rows.filter((r: Record<string, unknown>) => !gone.has(lineKey(r)));
    localStorage.setItem(WORK_KEY, JSON.stringify({ ...work, rows: kept }));
  } catch {}
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

// 출고 건들에 진행 표시를 붙인다(쉽먼트 번호·양식 저장 시각).
export function markShipOuts(ids: string[], patch: Partial<Pick<ShipOut, 'batchId' | 'formSavedAt' | 'doneAt' | 'undoneAt'>>) {
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
// localStorage에 바로 써 넣는다. 이미 있는 줄은 건너뛴다.
function pushBackToWork(lines: ShipOutLine[], fallbackBundle: string) {
  let work: { rows: Record<string, unknown>[]; fileName?: string; done?: string[] };
  try {
    work = JSON.parse(localStorage.getItem(WORK_KEY) || '{"rows":[]}');
  } catch {
    work = { rows: [] };
  }
  const rows = Array.isArray(work.rows) ? work.rows : [];
  const keyOf = lineKey;
  const seen = new Set(rows.map(keyOf));

  // 발주확인 쪽 저장 모양에 맞춘다(입고예정일은 'YYYYMMDD' 글자).
  const back = lines
    .map(l => ({
      발주번호: l.발주번호,
      물류센터: l.물류센터,
      상품이름: l.상품이름,
      확정수량: l.확정수량,
      입고예정일: l.입고예정일.replace(/-/g, ''),
      메모: l.메모 || '',
      쉼먼트: l.쉼먼트 || '',
      묶음: l.묶음 || fallbackBundle,
      묶음센터: '',
      묶음일자: '',
    }))
    .filter(r => !seen.has(keyOf(r)));

  // 되돌린 줄은 맨 아래가 아니라 원래 자리(입고예정일 → 물류센터 → 발주번호 → 상품이름 순)에 끼워 넣는다.
  const merged = [...rows, ...back].sort((a, b) => {
    const da = ymdSortKey(a.입고예정일);
    const db = ymdSortKey(b.입고예정일);
    if (da !== db) return da - db;
    const kc = String(a.물류센터 || '').localeCompare(String(b.물류센터 || ''), 'ko', { numeric: true });
    if (kc !== 0) return kc;
    const ko = String(a.발주번호 || '').localeCompare(String(b.발주번호 || ''), 'ko', { numeric: true });
    if (ko !== 0) return ko;
    return String(a.상품이름 || '').localeCompare(String(b.상품이름 || ''), 'ko', { numeric: true });
  });

  try {
    localStorage.setItem(WORK_KEY, JSON.stringify({
      rows: merged,
      fileName: work.fileName || '',
      done: work.done || [],
    }));
  } catch {}
  return back.length;
}

// 출고 한 건을 통째로 발주확인으로 되돌린다.
export function restoreShipOut(id: string): boolean {
  const item = read().find(s => s.id === id);
  if (!item) return false;
  pushBackToWork(item.lines, item.bundle);
  write(read().filter(s => s.id !== id));
  return true;
}

// 고른 발주서(발주번호)만 발주확인으로 되돌린다. 줄이 하나도 안 남은 출고 건은 목록에서 사라진다.
export function restoreOrders(orderNos: string[]): number {
  const want = new Set(orderNos);
  const list = read();
  let moved = 0;
  const next: ShipOut[] = [];
  for (const item of list) {
    const back = item.lines.filter(l => want.has(l.발주번호));
    const stay = item.lines.filter(l => !want.has(l.발주번호));
    if (back.length) {
      moved += pushBackToWork(back, item.bundle);
      if (stay.length) next.push({ ...item, lines: stay });
    } else {
      next.push(item);
    }
  }
  write(next);
  return moved;
}
