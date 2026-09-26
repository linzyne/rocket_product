import React, { useEffect, useMemo, useState } from 'react';
import { InventoryItem, subscribeInventory, splitProductName, dateKey } from '../data/inventoryStore';
import CollectFromExtension from './CollectFromExtension';
import { useRowOrder, DragHandle } from './useRowOrder';

// 로켓 > 로켓재고·판매량. 둘 다 같은 표(상품 × 날짜)를 모드만 바꿔 쓴다. 확장이 날마다 가져온
// 로켓센터 재고를 월 단위로 보여주고, 수집한 날만 값이 있다.
export type StockMode = 'rocket' | 'sales';

const TITLES: Record<StockMode, { title: string; desc: string }> = {
  rocket: { title: '로켓재고', desc: '확장에서 가져온 로켓센터 재고가 날짜별로 쌓여요.' },
  sales: { title: '판매량', desc: '로켓센터 재고가 직전 수집보다 줄어든 만큼을 판 수량으로 봐요. 입고된 날은 음수(파란색), 수집을 건너뛴 뒤의 칸은 여러 날치가 몰려 점선으로 나와요.' },
};

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

const StockHistoryPage: React.FC<{ mode: StockMode }> = ({ mode }) => {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [month, setMonth] = useState(() => monthKey(new Date()));
  const [search, setSearch] = useState('');
  // 상품 진열 순서. "내 순서"로 두면 끌어서 옮길 수 있고, 로켓재고·판매량이 같은 차례를 쓴다.
  const order = useRowOrder('ads');

  useEffect(() => subscribeInventory(setItems), []);

  const days = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    const count = new Date(y, m, 0).getDate();
    return Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
  }, [month]);
  const today = dateKey(Date.now());

  const shiftMonth = (delta: number) => {
    const [y, m] = month.split('-').map(Number);
    setMonth(monthKey(new Date(y, m - 1 + delta, 1)));
  };

  // 한 상품의 이 달 칸 값과 정렬 기준을 한 번에 구한다.
  // 판매량은 '직전 기록일 재고 − 이 날 재고'다. 수집을 건너뛴 날이 있으면 그 사이 며칠치가
  // 한 칸에 몰리므로, 몇 밤치인지 칸에 얹어 둔다(값 자체는 합계가 맞게 유지된다).
  const rowOf = (it: InventoryItem) => {
    const h = it.stockHistory || {};
    const recorded = Object.keys(h).sort();
    const cells = days.map(day => {
      if (day > today) return { day, v: null as number | null, span: 0 };
      const cur = h[day];
      if (cur == null) return { day, v: null as number | null, span: 0 };
      if (mode === 'rocket') return { day, v: cur, span: 0 };
      const i = recorded.indexOf(day);
      const prev = i > 0 ? recorded[i - 1] : null;
      if (prev == null) return { day, v: null as number | null, span: 0 };
      const span = Math.round((new Date(day).getTime() - new Date(prev).getTime()) / 86400000);
      return { day, v: h[prev] - cur, span };
    });
    // 로켓재고는 이 달 마지막으로 모은 재고, 판매량은 이 달에 판 수량을 다 더한 값이 기준이다.
    let key: number | null = null;
    if (mode === 'rocket') {
      for (let i = cells.length - 1; i >= 0; i--) if (cells[i].v != null) { key = cells[i].v; break; }
    } else {
      for (const c of cells) if (c.v != null) key = (key ?? 0) + c.v;
    }
    return { it, cells, key };
  };

  // 이 달에 숫자가 있는 상품만, 큰 값부터 보여준다.
  const rows = useMemo(() => {
    const k = search.trim().toLowerCase();
    return items
      .filter(it => it.inLatest !== false || days.some(d => it.stockHistory?.[d] != null))
      .filter(it => !k || it.productName.toLowerCase().includes(k))
      .map(rowOf)
      .filter(r => r.key != null)
      .sort((a, b) => b.key! - a.key! || a.it.productName.localeCompare(b.it.productName, 'ko'));
  }, [items, search, days, mode, today]);

  type Row = (typeof rows)[number];
  const sortedRows = order.sort<Row>(rows, (r: Row) => r.it.adsId);
  const visibleKeys = sortedRows.map((r: Row) => r.it.adsId);

  const { title, desc } = TITLES[mode];

  return (
    <div className="p-4 sm:p-6 lg:p-8 text-gray-800">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{title}</h1>
          <p className="text-sm text-gray-500">{desc}</p>
        </div>
        <div className="flex items-center gap-2">
          {mode === 'rocket' && <CollectFromExtension items={items} />}
          <button onClick={() => shiftMonth(-1)} className="px-2 py-1 rounded border border-gray-200 bg-white hover:bg-gray-50">‹</button>
          <input type="month" value={month} onChange={e => e.target.value && setMonth(e.target.value)} className="px-2 py-1 border border-gray-200 rounded bg-white text-sm" />
          <button onClick={() => shiftMonth(1)} className="px-2 py-1 rounded border border-gray-200 bg-white hover:bg-gray-50">›</button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="상품명 검색"
          className="w-64 px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
        <order.Toggle />
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
        <table className="text-xs border-collapse">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="sticky left-0 z-10 bg-gray-50 min-w-[16rem] px-3 py-2 text-left font-medium border-r border-gray-200">상품</th>
              {days.map(d => {
                const dow = new Date(d).getDay();
                return (
                  <th key={d} className={`w-11 px-1 py-2 text-center font-medium ${d === today ? 'bg-blue-50 text-blue-700' : dow === 0 ? 'text-red-400' : dow === 6 ? 'text-blue-400' : ''}`}>
                    {Number(d.slice(8))}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map(({ it, cells }) => {
              const { base, option } = splitProductName(it.productName);
              return (
                <tr
                  key={it.adsId}
                  {...order.rowProps(it.adsId, visibleKeys)}
                  className={`border-t border-gray-100 hover:bg-gray-50 ${order.rowClass(it.adsId)}`}
                >
                  <td className="sticky left-0 z-10 bg-white px-3 py-1.5 border-r border-gray-200 max-w-[16rem]">
                    <div className="flex items-center gap-2">
                      <DragHandle show={order.mine} onUp={() => order.move(it.adsId, -1)} onDown={() => order.move(it.adsId, 1)} />
                      {it.imageUrl
                        ? <img src={it.imageUrl} alt="" className="w-8 h-8 flex-shrink-0 rounded object-cover border border-gray-100" />
                        : <div className="w-8 h-8 flex-shrink-0 rounded bg-gray-100" />}
                      <div className="min-w-0">
                        <div className="truncate text-gray-900" title={it.productName}>{base}</div>
                        {option && <div className="truncate text-gray-400">{option}</div>}
                      </div>
                    </div>
                  </td>
                  {cells.map(({ day: d, v, span }) => {
                    // 판매량은 팔린 날(양수)을 진하게, 입고된 날(음수)을 파랗게 본다.
                    const color = mode === 'sales'
                      ? (v ? (v < 0 ? 'text-blue-600' : 'text-gray-900 font-semibold') : 'text-gray-300')
                      : v === 0 ? 'text-red-400' : 'text-gray-700';
                    return (
                      <td
                        key={d}
                        title={span > 1 ? `${span}일치가 몰린 칸이에요(앞 ${span - 1}일은 수집이 없었어요)` : undefined}
                        className={`px-1 py-1.5 text-center font-mono ${d === today ? 'bg-blue-50/50' : ''} ${color} ${span > 1 ? 'underline decoration-dotted decoration-gray-300 underline-offset-2' : ''}`}
                      >
                        {v == null ? <span className="text-gray-200">·</span> : v}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {!sortedRows.length && (
              <tr><td colSpan={days.length + 1} className="px-3 py-12 text-center text-gray-400">이 달에 기록된 재고가 없어요.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default StockHistoryPage;
