// 쿠팡발주확인의 예약 목록. "예약 넘기기"로 옮긴 줄을 계속 쌓아 두고, 새 파일을 올리거나 앱을 껐다
// 켜도 지워지지 않는다. 사람이 삭제 버튼을 누를 때만 지워진다.
//
// 줄은 lineStore(발주 줄 한 곳 저장소)에 place = 'reserve'로 들어 있다. 예약으로 넘기기·되돌리기는
// 그 줄의 place 칸만 바꾼다(예전처럼 예약 목록에 새로 만들고 발송 목록에서 지우지 않는다).
import type { OrderRow } from '../types';
import { dateKeyYMD, normalizeDateValue, ymdSortKey } from '../utils/dateUtils';
import { Line, linesAt, commit, pickLine, newLine, moved, trashed, fieldsOf, lineKey, subscribeLines, whenReady, startLines } from './lineStore';

export const reservationKey = (r: Pick<OrderRow, '발주번호' | '상품이름' | '확정수량' | '입고예정일'>) =>
  // 예전 Firestore 문서 id 모양 그대로(화면이 예약 줄을 가려내는 데 쓴다).
  `${r.발주번호}│${r.상품이름}│${r.확정수량}│${dateKeyYMD(r.입고예정일)}`.replace(/\//g, '∕');

const toRow = (l: Line): OrderRow => ({
  발주번호: l.발주번호,
  물류센터: l.물류센터,
  상품이름: l.상품이름,
  확정수량: l.확정수량,
  입고예정일: normalizeDateValue((l.입고예정일 || '').replace(/-/g, '')),
  메모: l.메모 || '',
  쉼먼트: l.쉼먼트 || '',
  묶음: l.묶음 || '',
  묶음센터: l.묶음센터 || '',
  묶음일자: l.묶음일자 || '',
  SKU: l.SKU || '',
});

// 발주서를 읽을 때와 같은 순서: 입고예정일 → 물류센터 → 발주번호 → 상품이름.
const sortRows = (rows: OrderRow[]) =>
  rows.sort((a, b) => {
    const da = ymdSortKey(a.입고예정일);
    const dbk = ymdSortKey(b.입고예정일);
    if (da !== dbk) return da - dbk;
    const kc = a.물류센터.localeCompare(b.물류센터, 'ko', { numeric: true });
    if (kc !== 0) return kc;
    const ko = a.발주번호.localeCompare(b.발주번호, 'ko', { numeric: true });
    if (ko !== 0) return ko;
    return a.상품이름.localeCompare(b.상품이름, 'ko', { numeric: true });
  });

export const readReservations = (): OrderRow[] => sortRows(linesAt('reserve').map(toRow));

type Listener = (rows: OrderRow[]) => void;
export const subscribeReservations = (listener: Listener): (() => void) => {
  startLines();
  let last = '';
  const send = () => {
    const rows = readReservations();
    const stamp = JSON.stringify(rows);
    if (stamp === last) return;
    last = stamp;
    listener(rows);
  };
  send();
  return subscribeLines(send);
};

// 이 화면 줄에 해당하는 예약 줄. 같은 열쇠가 여럿이면 입고예정일이 같은 것을 먼저.
const reserveLineOf = (r: OrderRow, taken: Set<string>): Line | undefined => {
  const k = lineKey(r);
  const day = dateKeyYMD(r.입고예정일);
  const same = linesAt('reserve').filter(l => lineKey(l) === k && !taken.has(l.id));
  return same.find(l => l.입고예정일 === day) || same[0];
};

// 새 예약을 더한다. 이미 예약에 있는 줄(같은 키)은 건드리지 않는다. 발주확인에 있던 줄이면 그 줄을 예약으로 옮긴다.
export const addReservations = async (rows: OrderRow[], existing: OrderRow[]) => {
  const have = new Set(existing.map(reservationKey));
  const fresh = rows.filter(r => !have.has(reservationKey(r)));
  if (!fresh.length) return 0;
  whenReady(() => {
    const taken = new Set<string>();
    const now = Date.now();
    const out: Line[] = [];
    for (const r of fresh) {
      const f = fieldsOf(r as unknown as Record<string, unknown>);
      const from = pickLine(lineKey(f), ['work', 'trash'], taken);
      const l = from ? moved(from, 'reserve', f, { savedAt: now }) : newLine(f, 'reserve', taken, { savedAt: now });
      taken.add(l.id);
      out.push(l);
    }
    commit(out);
  });
  return fresh.length;
};

const patchReserved = (rows: OrderRow[], patch: Partial<Line>) => {
  whenReady(() => {
    const taken = new Set<string>();
    const out: Line[] = [];
    for (const r of rows) {
      const l = reserveLineOf(r, taken);
      if (!l) continue;
      taken.add(l.id);
      out.push({ ...l, ...patch });
    }
    commit(out);
  });
};

export const updateReservationShipment = async (row: OrderRow, 쉼먼트: string) => patchReserved([row], { 쉼먼트 });

// 예약들의 묶음·박스 값을 한꺼번에 바꾼다(예약 목록에서 묶기·풀기·센터/날짜/박스 지정).
export type ReservationPatch = Partial<Pick<Line, '묶음' | '묶음센터' | '묶음일자' | '쉼먼트'>>;
export const updateReservations = async (rows: OrderRow[], patch: ReservationPatch) => patchReserved(rows, patch);

// 예약들의 메모를 바꾼다. 한중발주를 만들면 "예약 H…"처럼 고유번호를 적어 예약 패널에서 보이게 한다.
export const setReservationMemo = async (rows: OrderRow[], 메모: string) => patchReserved(rows, { 메모 });

// 예약에서 뺀다. 이미 다른 곳(발주확인·쉽먼트)으로 옮겨 간 줄이면 할 일이 없다. 아직 예약에 있으면 휴지통으로
// (사람이 지운 거면 화면이 먼저 "일부러 지움"으로 표시해 둔다. 아니면 곧 다른 곳에 들어갈 줄로 본다).
export const deleteReservations = async (rows: OrderRow[]) => {
  whenReady(() => {
    const taken = new Set<string>();
    const out: Line[] = [];
    for (const r of rows) {
      const l = reserveLineOf(r, taken);
      if (!l) continue;
      taken.add(l.id);
      out.push(trashed(l));
    }
    commit(out);
  });
};
