import React, { useEffect, useMemo, useState } from 'react';
import { sameName, nameKey } from '../../data/hanjungStore';
import type { HanjungOrder } from '../../data/hanjungStore';
import { subscribeInventory } from '../../data/inventoryStore';
import { subscribeHanjungQueue } from '../coupangOrder/data/hanjungQueueStore';
import { subscribeReservations } from '../coupangOrder/data/reservationStore';
import { subscribeShipOuts } from '../coupangOrder/data/shipOutStore';
import { readWork } from '../coupangOrder/data/orderWorkCloud';
import ProductThumb from './ProductThumb';

// 한중발주의 품목별 1688 주문 수량을 적는 칸.
// 쿠팡 발주에서 온 품목은 이름이 정해져 있고(need = 쿠팡에 필요한 수량), 직접 더한 품목은 이름을 고른다.
// 이왕 수입하는 김에 다른 품목도 같이 사 두는 경우가 있어서, 쿠팡 발주와 상관없는 품목도 넣을 수 있다.
// 주문 수량은 총수량을 적는다(쿠팡에 필요한 수량보다 많이 적으면 남는 만큼이 여유).
export type OrderItem = { name: string; qty: string; need: number; added: boolean };

// 이름 고르기 목록: 쿠팡 발주·예약·쉽먼트·한중발주·광고 상품에서 본 상품명을 모은다.
// 한중 여유는 쿠팡 발주 상품명과 같은 이름으로 맞추므로, 쿠팡 발주에 나온 이름을 먼저 쓴다.
export function useProductNames(orders: HanjungOrder[]) {
  const [extra, setExtra] = useState<{ queue: string[]; res: string[]; ship: string[]; inv: string[] }>({ queue: [], res: [], ship: [], inv: [] });
  useEffect(() => subscribeHanjungQueue(q => setExtra(e => ({ ...e, queue: q.map(x => x.상품이름) }))), []);
  useEffect(() => subscribeReservations(r => setExtra(e => ({ ...e, res: r.map(x => x.상품이름) }))), []);
  useEffect(() => subscribeShipOuts(list => setExtra(e => ({ ...e, ship: list.flatMap(s => s.lines.map(l => l.상품이름)) }))), []);
  useEffect(() => subscribeInventory(items => setExtra(e => ({ ...e, inv: items.map(i => i.productName) }))), []);
  return useMemo(() => {
    // 쿠팡 발주에 나온 이름을 먼저 쓴다. 상품관리(광고) 이름은 쿠팡 발주와 띄어쓰기·낱말이 조금씩 달라서,
    // 그 이름으로 적으면 나중에 쿠팡 발주와 짝이 안 맞는다. 같은 상품의 쿠팡 발주 이름이 있으면 상품관리 이름은 뺀다.
    const work = readWork().rows.map(r => String((r as { 상품이름?: unknown }).상품이름 || ''));
    const fromCoupang = [...orders.flatMap(o => o.lines.map(l => l.상품이름)), ...extra.queue, ...extra.res, ...extra.ship, ...work];
    const coupang = Array.from(new Set(fromCoupang.map(n => n.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ko'));
    const seen = new Set(coupang.map(nameKey));
    const others = Array.from(new Set([...orders.flatMap(o => Object.keys(o.orderQty || {})), ...extra.inv].map(n => n.trim()).filter(Boolean)))
      .filter(n => !seen.has(nameKey(n)))
      .sort((a, b) => a.localeCompare(b, 'ko'));
    return [...coupang.map(name => ({ name, from: '쿠팡 발주' })), ...others.map(name => ({ name, from: '상품관리' }))];
  }, [orders, extra]);
}

export const itemQty = (it: OrderItem) => Math.max(0, Math.round(Number(it.qty) || 0));

const OrderItemsEditor: React.FC<{
  items: OrderItem[];
  onChange: (items: OrderItem[]) => void;
  names: { name: string; from: string }[];
  listId: string;
  imageOf?: (name: string) => string;
}> = ({ items, onChange, names, listId, imageOf }) => {
  const set = (i: number, patch: Partial<OrderItem>) => onChange(items.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const dup = (name: string, i: number) => !!name.trim() && items.some((it, j) => j !== i && it.name.trim() && sameName(it.name, name));
  return (
    <div className="space-y-1">
      {/* 이름 칸에 글자를 치면 그 글자가 들어간 상품명이 아래로 뜬다(브라우저 기본 목록). */}
      <datalist id={listId}>
        {names.map(n => <option key={n.name} value={n.name} label={n.from} />)}
      </datalist>
      {items.map((it, i) => {
        const q = itemQty(it);
        const short = q < it.need;
        return (
          <div key={i} className="flex items-center gap-2 text-xs text-gray-700">
            {imageOf && <ProductThumb url={it.name.trim() ? imageOf(it.name.trim()) : ''} size={24} />}
            {it.added ? (
              <input
                list={listId}
                value={it.name}
                onChange={e => set(i, { name: e.target.value })}
                placeholder="상품명 입력 → 목록에서 고르기"
                className={`flex-1 min-w-0 px-1.5 py-0.5 border rounded bg-white ${dup(it.name, i) ? 'border-red-400' : 'border-gray-300'}`}
                title={dup(it.name, i) ? '위에 같은 상품이 있어요' : undefined}
              />
            ) : (
              <span className="flex-1 min-w-0 truncate font-semibold" title={it.name}>{it.name}</span>
            )}
            <span className="w-20 text-right text-gray-400 whitespace-nowrap">{it.need > 0 ? `쿠팡 ${it.need}` : '추가 품목'}</span>
            <span>주문</span>
            <input
              type="number"
              min={0}
              value={it.qty}
              onChange={e => set(i, { qty: e.target.value })}
              className={`w-16 px-1.5 py-0.5 border rounded text-right font-mono bg-white ${short ? 'border-red-400' : 'border-gray-300'}`}
            />
            <span className={`w-16 whitespace-nowrap ${short ? 'text-red-500 font-bold' : q > it.need ? 'text-emerald-600 font-bold' : 'text-gray-300'}`}>
              {short ? `부족 ${it.need - q}` : q > it.need ? `여유 ${q - it.need}` : '여유 0'}
            </span>
            {it.added || it.need === 0 ? (
              <button
                onClick={() => onChange(items.filter((_, j) => j !== i))}
                title="이 품목 빼기"
                className="px-1.5 py-0.5 border border-gray-200 text-gray-400 rounded bg-white hover:bg-gray-50"
              >
                ✕
              </button>
            ) : (
              <span className="w-[26px]" />
            )}
          </div>
        );
      })}
      <button
        onClick={() => onChange([...items, { name: '', qty: '', need: 0, added: true }])}
        className="mt-1 px-2 py-0.5 text-xs border border-dashed border-gray-300 text-gray-500 rounded hover:bg-gray-50"
      >
        ＋ 품목 추가
      </button>
    </div>
  );
};

export default OrderItemsEditor;

// 품목 칸 → 한중발주 orderQty. 이름 없는 줄은 버리고, 같은 이름은 합친다.
export const itemsToOrderQty = (items: OrderItem[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const it of items) {
    const name = it.name.trim();
    if (!name) continue;
    // 이름만 조금 다른 같은 상품은 먼저 적힌 이름으로 합친다.
    const k = Object.keys(out).find(x => sameName(x, name)) ?? name;
    out[k] = (out[k] || 0) + itemQty(it);
  }
  return out;
};
