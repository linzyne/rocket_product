// 발송 쪽 작업 중인 목록(메모·롯데 표시 포함)을 이 컴퓨터에 남겨 둔다. 다른 메뉴에 다녀오거나
// 새로고침해도 그대로 다시 뜨고, "전체 비우기"를 누를 때만 비운다. 발주서를 새로 올리면 지우지
// 않고 아래에 이어 붙인다. 날짜는 'YYYYMMDD' 글자로 저장했다가 되살린다.
// 수집 화면에서도 발주서를 받아 여기에 이어 붙이므로 쿠팡발주확인 화면과 따로 두었다.
import { parseFile, buildDisplayRows, extractOrderRows, sortOrderRows } from '../utils/dataProcessor';
import type { DisplayRow } from '../utils/dataProcessor';
import type { OrderRow } from '../types';
import { dateKeyYMD, normalizeDateValue } from '../utils/dateUtils';
import { reservationKey } from './reservationStore';

const WORK_KEY = 'coupangOrderWork';

export function loadWork(): { rows: DisplayRow[]; fileName: string; done: string[] } {
  try {
    const saved = JSON.parse(localStorage.getItem(WORK_KEY) || '');
    const rows: OrderRow[] = (saved.rows || []).map((r: OrderRow) => ({ ...r, 입고예정일: normalizeDateValue(r.입고예정일) }));
    // 같은 발주서의 같은 상품이 두 번 들어간 줄은 하나만 남긴다(출고에 보냈다 되돌리는 사이에
    // 센터·입고일이 바뀌어 두 줄로 남는 일이 있었다). 먼저 들어온 줄을 살린다.
    const seen = new Set<string>();
    const unique = rows.filter(r => {
      const key = `${r.발주번호}│${r.상품이름}│${r.확정수량}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return { rows: buildDisplayRows(unique), fileName: saved.fileName || '', done: saved.done || [] };
  } catch {
    return { rows: [], fileName: '', done: [] };
  }
}

export function saveWork(rows: DisplayRow[], fileName: string, done: string[]) {
  try {
    if (!rows.length) {
      localStorage.removeItem(WORK_KEY);
      return;
    }
    const plain = extractOrderRows(rows).map(r => ({ ...r, 입고예정일: dateKeyYMD(r.입고예정일).replace(/-/g, '') }));
    localStorage.setItem(WORK_KEY, JSON.stringify({ rows: plain, fileName, done }));
  } catch {}
}

// 발주서 파일 한 개를 저장된 작업 목록 아래에 이어 붙인다(이미 있는 줄과 예약으로 넘긴 줄은 건너뛴다).
// 쿠팡발주확인 화면을 열지 않고도 받을 수 있게, 수집 화면이 이 함수를 쓴다.
export async function appendOrderFile(file: File, reservations: OrderRow[]): Promise<{ added: number; skipped: number }> {
  const rows = await parseFile(file);
  if (!rows.length) throw new Error('데이터를 찾을 수 없습니다. 헤더가 올바른지 확인해주세요.');
  const work = loadWork();
  const existing = extractOrderRows(work.rows);
  const seen = new Set([...existing, ...reservations].map(reservationKey));
  const fresh = sortOrderRows(rows).filter(r => !seen.has(reservationKey(r)));
  saveWork(buildDisplayRows([...existing, ...fresh]), file.name, work.done);
  return { added: fresh.length, skipped: rows.length - fresh.length };
}
