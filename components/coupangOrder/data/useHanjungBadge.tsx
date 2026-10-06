import React, { useEffect, useMemo, useState } from 'react';
import { HanjungQueueItem, subscribeHanjungQueue, makePlaceLookup } from './hanjungQueueStore';
import { HanjungOrder, subscribeHanjung, productSummary, nameKey } from '../../../data/hanjungStore';

// 한중 뱃지 색. 준비됨과 같은 초록.
const HANJUNG_COLOR = '#27ae60';
// 준비됨(초록 바탕)과 나란히 있어도 구분되게 한중은 흰 바탕에 초록 테두리.
const hanjungStyle = (): React.CSSProperties => ({ ...badge(HANJUNG_COLOR, false), background: '#fff', border: `1px solid ${HANJUNG_COLOR}` });

// 상품 줄이 한중발주 어디에 있는지 작은 뱃지로 보여준다.
//  · 한중발주 대기(1688 주문 전) → "한중 대기"
//  · 이미 주문한 한중발주에 들어 있음 → "한중 H260923-01 · 입고중/일부입고/준비됨"
//  · 한 줄을 여러 곳에 나눠 맡겼으면 곳마다 뱃지를 달고 수량을 붙인다 → "한중 H… ×1" "한중 대기 ×2"
// 줄은 발주번호·상품이름·수량으로 찾는다(hanjungQueueKey).
export function useHanjungBadge() {
  const [queue, setQueue] = useState<HanjungQueueItem[]>([]);
  const [orders, setOrders] = useState<HanjungOrder[]>([]);
  useEffect(() => subscribeHanjungQueue(setQueue), []);
  useEffect(() => subscribeHanjung(setOrders), []);
  const placesOf = useMemo(() => makePlaceLookup(orders, queue), [orders, queue]);
  // 한중발주 안에서 그 상품이 얼마나 들어왔는지(수입입고) → 입고중 / 일부입고 / 준비됨.
  const statusOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of orders) {
      for (const p of productSummary(o)) {
        m.set(`${o.code}│${nameKey(p.상품이름)}`, p.received <= 0 ? '입고중' : p.received < p.ordered ? `일부입고 ${p.received}/${p.ordered}` : '준비됨');
      }
    }
    return (code: string, name: string) => m.get(`${code}│${nameKey(name)}`) || '입고중';
  }, [orders]);

  // ready: 그 줄이 준비됨이면 한중 뱃지를 준비됨처럼 초록 바탕으로 보여준다(준비됨 뱃지를 따로 두지 않는다).
  return (line: { 발주번호: string; 상품이름: string; 확정수량: number | '' }, ready = false): React.ReactNode => {
    const places = placesOf(line);
    if (!places.length) return null;
    const full = Number(line.확정수량) || 0;
    const split = places.length > 1 || places[0].qty !== full;
    const style = ready ? badge(HANJUNG_COLOR, true) : hanjungStyle();
    // 단계: 한중 대기(1688 주문 전) → 입고중(주문함, 아직 안 옴) → 일부입고 → 준비됨(다 도착)
    return places.map((p, i) => {
      const status = p.code ? statusOf(p.code, String(line.상품이름).trim()) : '';
      return (
        <span
          key={`${p.code || 'queue'}-${i}`}
          title={p.code ? `1688 주문함 · 한중발주 ${p.code} · ${status} · 이 줄 ${p.qty}개` : `한중발주 발주 대기(1688 주문 전) · ${p.qty}개`}
          style={style}
        >
          {p.code ? `한중 ${p.code} · ${status}` : '한중 대기'}{split ? ` ×${p.qty}` : ''}
        </span>
      );
    });
  };
}

// 상품 줄 상태 뱃지 모양(준비됨·한중이 같은 모양으로 보이게 OrderTable도 같이 쓴다).
export const badge = (color: string, solid: boolean): React.CSSProperties => ({
  display: 'inline-block', marginLeft: 6, padding: '0 6px', fontSize: 10.5, fontWeight: 800, lineHeight: '16px',
  borderRadius: 999, whiteSpace: 'nowrap', verticalAlign: 'middle',
  color: solid ? '#fff' : color, background: solid ? color : `${color}14`, border: `1px solid ${solid ? color : `${color}55`}`,
});
