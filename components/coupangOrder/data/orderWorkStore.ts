// 발송 쪽 작업 중인 목록(메모·롯데 표시 포함)을 남겨 둔다. 다른 메뉴에 다녀오거나 새로고침해도
// 그대로 다시 뜨고, "전체 비우기"를 누를 때만 비운다. 발주서를 새로 올리면 지우지 않고 아래에
// 이어 붙인다. 날짜는 'YYYYMMDD' 글자로 저장했다가 되살린다.
// 수집 화면에서도 발주서를 받아 여기에 이어 붙이므로 쿠팡발주확인 화면과 따로 두었다.
// 저장은 orderWorkCloud가 맡는다(이 기기 + 클라우드). 그래서 다른 컴퓨터에서도 같은 목록을 본다.
import { parseFile, buildDisplayRows, extractOrderRows, sortOrderRows, pickNewByCount } from '../utils/dataProcessor';
import type { DisplayRow } from '../utils/dataProcessor';
import type { OrderRow } from '../types';
import { dateKeyYMD, normalizeDateValue } from '../utils/dateUtils';
import { allShipOutLines } from './shipOutStore';
import { readWork, writeWork, workLineKey } from './orderWorkCloud';

export { subscribeWork } from './orderWorkCloud';

export function loadWork(): { rows: DisplayRow[]; fileName: string; done: string[] } {
  const saved = readWork();
  const rows: OrderRow[] = saved.rows.map(r => ({ ...(r as unknown as OrderRow), 입고예정일: normalizeDateValue(r.입고예정일) }));
  // 같은 발주서의 같은 상품이 두 번 들어간 줄은 하나만 남긴다(출고에 보냈다 되돌리는 사이에
  // 센터·입고일이 바뀌어 두 줄로 남는 일이 있었다). 먼저 들어온 줄을 살린다.
  const seen = new Set<string>();
  const unique = rows.filter(r => {
    const key = workLineKey(r);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { rows: buildDisplayRows(unique), fileName: saved.fileName, done: saved.done };
}

export const NEW_FOR_MS = 24 * 60 * 60 * 1000;

// newOrderNos: 이번에 새로 들어온 발주번호. 처음 들어온 시각을 적어 두고 24시간 동안 NEW로 보여준다.
// 24시간이 지난 기록은 저장할 때 걷어낸다.
export function saveWork(rows: DisplayRow[], fileName: string, done: string[], newOrderNos: string[] = []) {
  const plain = extractOrderRows(rows).map(r => ({ ...r, 입고예정일: dateKeyYMD(r.입고예정일).replace(/-/g, '') }));
  const now = Date.now();
  const seen = Object.fromEntries(Object.entries(readWork().seen).filter(([, t]) => now - t < NEW_FOR_MS));
  newOrderNos.forEach(no => { if (no && !seen[no]) seen[no] = now; });
  writeWork({ rows: plain, fileName, done, seen });
}

// 지금 NEW로 보여줄 발주번호들(들어온 지 24시간이 안 된 것).
export function newOrderNos(): Set<string> {
  const now = Date.now();
  return new Set(Object.entries(readWork().seen).filter(([, t]) => now - t < NEW_FOR_MS).map(([no]) => no));
}

// 발주서 파일 한 개를 저장된 작업 목록 아래에 이어 붙인다(이미 있는 줄과 예약으로 넘긴 줄은 건너뛴다).
// 쿠팡발주확인 화면을 열지 않고도 받을 수 있게, 수집 화면이 이 함수를 쓴다.
export async function appendOrderFile(file: File, reservations: OrderRow[]): Promise<{ added: number; skipped: number }> {
  const rows = await parseFile(file);
  if (!rows.length) throw new Error('데이터를 찾을 수 없습니다. 헤더가 올바른지 확인해주세요.');
  const work = loadWork();
  const existing = extractOrderRows(work.rows);
  // 발송 목록·예약·쉽먼트(발송 완료 포함)에 이미 있는 줄은 발주번호 + 상품이름의 개수로 맞춰 거른다
  // (날짜·센터·수량은 앱과 서허에서 따로 바뀔 수 있어 보지 않는다).
  const fresh = pickNewByCount(sortOrderRows(rows), [...existing, ...reservations, ...allShipOutLines()]);
  saveWork(buildDisplayRows([...existing, ...fresh]), file.name, work.done, fresh.map(r => r.발주번호));
  return { added: fresh.length, skipped: rows.length - fresh.length };
}
