import React, { useEffect, useMemo, useState } from 'react';
import { HanjungQueueItem, subscribeHanjungQueue, hanjungQueueKey } from './hanjungQueueStore';
import { HanjungOrder, subscribeHanjung } from '../../../data/hanjungStore';

// 상품 줄이 한중발주 어디에 있는지 작은 뱃지로 보여준다.
//  · 한중발주 대기(1688 주문 전) → "한중 대기"
//  · 이미 주문한 한중발주에 들어 있음 → "한중 H260923-01"
// 줄은 발주번호·상품이름·수량으로 찾는다(hanjungQueueKey).
export function useHanjungBadge() {
  const [queue, setQueue] = useState<HanjungQueueItem[]>([]);
  const [orders, setOrders] = useState<HanjungOrder[]>([]);
  useEffect(() => subscribeHanjungQueue(setQueue), []);
  useEffect(() => subscribeHanjung(setOrders), []);
  const byKey = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of orders) for (const l of o.lines) m.set(hanjungQueueKey(l), o.code);
    return m;
  }, [orders]);
  const queued = useMemo(() => new Set(queue.map(q => q.key)), [queue]);

  return (line: { 발주번호: string; 상품이름: string; 확정수량: number | '' }): React.ReactNode => {
    const k = hanjungQueueKey(line);
    const code = byKey.get(k);
    if (code) {
      return (
        <span title={`1688 주문함 · 한중발주 ${code}`} style={badge('#2563eb', true)}>한중 {code}</span>
      );
    }
    if (queued.has(k)) {
      return <span title="한중발주 발주 대기(1688 주문 전)" style={badge('#2563eb', false)}>한중 대기</span>;
    }
    return null;
  };
}

const badge = (color: string, solid: boolean): React.CSSProperties => ({
  display: 'inline-block', marginLeft: 6, padding: '0 6px', fontSize: 10.5, fontWeight: 800, lineHeight: '16px',
  borderRadius: 999, whiteSpace: 'nowrap', verticalAlign: 'middle',
  color: solid ? '#fff' : color, background: solid ? color : `${color}14`, border: `1px solid ${solid ? color : `${color}55`}`,
});
