// 발주 줄 지킴이. 줄은 이제 lineStore에 한 문서씩 있고 지우지 않는다(지우기 = 휴지통). 그래서 할 일은 둘뿐이다.
//  · 사람이 일부러 지운 줄을 "지움"으로 표시해 둔다(forgetLines·forgetDropped). 표시 없이 휴지통에 들어간 줄은
//    옮기는 중에 빠진 것으로 보고, 20초 안에 다른 곳에 안 들어가면 lineStore가 발주확인으로 되살린다.
//  · 되살린 기록을 화면 위 알림으로 보여준다(subscribeRestored).
import { linesAt, markIntentional, startLines } from './lineStore';
import type { OrderRow } from '../types';

export { subscribeRestored, clearRestored } from './lineStore';
export type { RestoredNote } from './lineStore';

type Key = { 발주번호?: unknown; 상품이름?: unknown; 확정수량?: unknown };
const k = (l: Key) => `${String(l.발주번호 ?? '').trim()}│${String(l.상품이름 ?? '').trim()}│${String(l.확정수량 ?? '').trim()}`;

// 사람이 일부러 지운 줄(발주확인에서 줄 삭제·전체 비우기, 예약 삭제, 출고 삭제).
export function forgetLines(lines: Key[]) {
  markIntentional(lines);
}

// 되돌리기 전후를 비교해, 되돌리기로 세 곳 어디에서도 없어진 줄을 지운 줄로 친다.
export function forgetDropped(before: Key[], after: Key[]) {
  const still = new Map<string, number>();
  after.forEach(l => still.set(k(l), (still.get(k(l)) || 0) + 1));
  const dropped: Key[] = [];
  for (const l of before) {
    const n = still.get(k(l)) || 0;
    if (n > 0) still.set(k(l), n - 1);
    else dropped.push(l);
  }
  markIntentional(dropped);
}

// 지금 세 곳(발주확인·예약·쉽먼트)에 있는 모든 줄.
export function allPlacedLines(_reservations?: OrderRow[]): Record<string, unknown>[] {
  void _reservations;
  return [...linesAt('work'), ...linesAt('reserve'), ...linesAt('ship')] as unknown as Record<string, unknown>[];
}

// 지금 예약에 있는 줄.
export const placedReservations = (): Record<string, unknown>[] => linesAt('reserve') as unknown as Record<string, unknown>[];

export function startOrderGuard() {
  startLines();
}
