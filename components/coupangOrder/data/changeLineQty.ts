// 발주확정·쉽먼트 단계에서 상품 줄의 확정수량 고치기(서허 요청등록에서 수량을 줄였을 때 앱도 맞춘다).
//
// 줄은 발주번호│상품이름│확정수량을 열쇠로 여러 곳에서 찾는다. 수량만 바꾸면 그 열쇠로 붙어 있던 표시가 떨어지므로
// 같이 새 열쇠로 옮긴다.
//  · 줄 문서(coupangLines): 확정수량만 바꾼다(문서 id는 그대로. 줄은 칸 값으로 찾는다).
//  · 준비됨 ✓(lineReady): 켜져 있었으면 새 열쇠로 켜고 옛 열쇠는 끈다.
//  · 한중발주 배정·1688 주문하기(장바구니): 새 수량 안에서 앞에서부터 맡긴 수량을 줄여 옮긴다.
//    1688에 산 수량은 그대로 둔다(줄인 만큼 여유로 돌아간다).
import { allLines, commit, keyOfLine, lineKey, Line } from './lineStore';
import { setReady } from './readyStore';
import { HanjungQueueItem, addToHanjungQueue, removeFromHanjungQueue, hanjungQueueKey, queueAlloc, queueItemToRow } from './hanjungQueueStore';
import { HanjungOrder, saveHanjungOrder, freezeOrderQty } from '../../../data/hanjungStore';

type Key = { 발주번호: string; 상품이름: string; 확정수량: number | '' };

export async function changeLineQty(
  target: Key,
  newQty: number,
  opts: { shipOutId?: string; wasReady: boolean; hjOrders: HanjungOrder[]; hjQueue: HanjungQueueItem[] },
) {
  const oldKey = lineKey(target);
  const next: Key = { ...target, 확정수량: newQty };
  if (String(target.확정수량) === String(newQty)) return;

  // 1) 줄 문서. 쉽먼트 줄이면 그 출고 건의 줄을, 아니면 발주확인·예약 줄 하나를 고친다.
  const same = allLines().filter(l => keyOfLine(l) === oldKey && l.place !== 'trash').sort((a, b) => a.id.localeCompare(b.id));
  const line: Line | undefined = opts.shipOutId
    ? same.find(l => l.place === 'ship' && l.shipOutId === opts.shipOutId)
    : same.find(l => l.place === 'work' || l.place === 'reserve');
  if (!line) throw new Error('고칠 줄을 찾지 못했어요. 화면을 새로고침해 주세요.');
  commit([{ ...line, 확정수량: newQty }]);

  // 2) 준비됨 표시.
  if (opts.wasReady) {
    await setReady([next], true);
    await setReady([target], false);
  }

  // 3) 한중발주 배정 → 장바구니 순으로 새 수량만큼만 남긴다.
  const hk = hanjungQueueKey(target);
  let left = newQty;
  for (const o of opts.hjOrders) {
    const mine = o.lines.filter(l => hanjungQueueKey(l) === hk);
    if (!mine.length) continue;
    const names = Array.from(new Set(mine.map(l => l.상품이름)));
    let orderQty = o.orderQty;
    // 1688에 산 수량을 지금 값으로 못박아 둔다(줄 수량을 줄여도 산 수량은 그대로).
    for (const name of names) orderQty = freezeOrderQty({ ...o, orderQty }, name);
    const lines = o.lines.flatMap(l => {
      if (hanjungQueueKey(l) !== hk) return [l];
      const alloc = Math.min(l.배정 ?? (Number(l.확정수량) || 0), left);
      left -= alloc;
      if (alloc <= 0) return [];
      const { 배정: _drop, ...rest } = l;
      void _drop;
      // key는 발주번호│상품이름│확정수량│입고예정일 모양이라 수량 칸만 바꾼다.
      const parts = String(l.key || '').split('│');
      if (parts.length >= 3) parts[2] = String(newQty);
      const moved = { ...rest, 확정수량: newQty, key: parts.join('│') };
      return [alloc === newQty ? moved : { ...moved, 배정: alloc }];
    });
    await saveHanjungOrder({ ...o, orderQty, lines });
  }
  const queued = opts.hjQueue.filter(q => q.key === hk);
  if (queued.length) {
    await removeFromHanjungQueue(queued.map(q => q.key));
    const q = queued[0];
    const alloc = Math.min(queued.reduce((n, x) => n + queueAlloc(x), 0), left);
    if (alloc > 0) {
      const { 배정: _drop, ...row } = queueItemToRow(q);
      void _drop;
      await addToHanjungQueue([{ ...row, 확정수량: newQty, ...(alloc === newQty ? {} : { 배정: alloc }) }], opts.hjQueue.filter(x => x.key !== hk));
    }
  }
}
