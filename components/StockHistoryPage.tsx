import React, { useEffect, useMemo, useState } from 'react';
import { InventoryItem, subscribeInventory, splitProductName, dateKey, officeOn } from '../data/inventoryStore';

// 판매 > 판매량/재고. 재고 > 상품관리에서 날마다 가져온 기록을 월 단위 표(상품 × 날짜)로 보여준다.
// 로켓센터 재고는 수집한 날만 값이 있고, 사무실 재고는 마지막으로 고친 값이 다음 날로 이어진다.
// 판매량(어제 재고 + 오늘 입고 − 오늘 재고)은 입고 수집이 생기면 여기에 붙인다.
type Mode = 'rocket' | 'office' | 'total' | 'diff';
const MODES: Array<[Mode, string]> = [['rocket', '로켓센터'], ['office', '사무실'], ['total', '합계'], ['diff', '전일 대비']];

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

const StockHistoryPage: React.FC = () => {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [month, setMonth] = useState(() => monthKey(new Date()));
  const [mode, setMode] = useState<Mode>('rocket');
  const [search, setSearch] = useState('');

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

  const rows = useMemo(() => {
    const k = search.trim().toLowerCase();
    return items
      .filter(it => it.inLatest !== false || days.some(d => it.stockHistory?.[d] != null))
      .filter(it => !k || it.productName.toLowerCase().includes(k))
      .sort((a, b) => a.productName.localeCompare(b.productName, 'ko'));
  }, [items, search, days]);

  const rocketOn = (it: InventoryItem, day: string) => it.stockHistory?.[day] ?? null;
  // 전일 대비는 바로 앞 날짜에 기록이 있을 때만 계산한다(빠진 날을 건너뛰면 여러 날치가 섞인다).
  const prevDay = (day: string) => {
    const [y, m, d] = day.split('-').map(Number);
    return dateKey(new Date(y, m - 1, d - 1).getTime());
  };
  const cellValue = (it: InventoryItem, day: string): number | null => {
    if (day > today) return null;
    const rocket = rocketOn(it, day);
    if (mode === 'rocket') return rocket;
    const office = officeOn(it, day);
    if (mode === 'office') return office;
    if (mode === 'total') return rocket == null && office == null ? null : (rocket || 0) + (office || 0);
    const prev = rocketOn(it, prevDay(day));
    return rocket == null || prev == null ? null : rocket - prev;
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 text-gray-800">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">판매량/재고</h1>
          <p className="text-sm text-gray-500">상품관리에서 가져온 재고가 날짜별로 쌓여요. 판매량은 입고 수집이 생기면 추가돼요.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => shiftMonth(-1)} className="px-2 py-1 rounded border border-gray-200 bg-white hover:bg-gray-50">‹</button>
          <input type="month" value={month} onChange={e => e.target.value && setMonth(e.target.value)} className="px-2 py-1 border border-gray-200 rounded bg-white text-sm" />
          <button onClick={() => shiftMonth(1)} className="px-2 py-1 rounded border border-gray-200 bg-white hover:bg-gray-50">›</button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
          {MODES.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setMode(id)}
              className={`px-3 py-1 rounded-md text-sm ${mode === id ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="상품명 검색"
          className="w-64 px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
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
            {rows.map(it => {
              const { base, option } = splitProductName(it.productName);
              return (
                <tr key={it.adsId} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="sticky left-0 z-10 bg-white px-3 py-1.5 border-r border-gray-200 max-w-[16rem]">
                    <div className="truncate text-gray-900" title={it.productName}>{base}</div>
                    {option && <div className="truncate text-gray-400">{option}</div>}
                  </td>
                  {days.map(d => {
                    const v = cellValue(it, d);
                    const color = mode === 'diff' && v ? (v < 0 ? 'text-blue-600' : 'text-red-500') : v === 0 ? 'text-red-400' : 'text-gray-700';
                    return (
                      <td key={d} className={`px-1 py-1.5 text-center font-mono ${d === today ? 'bg-blue-50/50' : ''} ${color}`}>
                        {v == null ? <span className="text-gray-200">·</span> : mode === 'diff' && v > 0 ? `+${v}` : v}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {!rows.length && (
              <tr><td colSpan={days.length + 1} className="px-3 py-12 text-center text-gray-400">이 달에 기록된 재고가 없어요.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default StockHistoryPage;
