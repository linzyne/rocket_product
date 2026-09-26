import React, { useEffect, useMemo, useState } from 'react';
import { InventoryItem, subscribeInventory, splitProductName, dateKey } from '../data/inventoryStore';
import { ReceiveRow, subscribeReceives, sign, norm } from '../data/receiveStore';
import CollectReceives from './CollectReceives';

// 로켓 > 입고. 물류창고입고에 쌓인 쿠팡 입고 내역을 상품 × 날짜 표로 보여준다.
// 서허 입고 내역은 같은 상품이라도 물류센터마다 줄이 쪼개져 있어서, 여기서는 SKU번호로 묶어
// 하루치를 한 칸에 합산한다(반출은 빼서 더한다). 센터별 내역은 칸에 마우스를 올리면 보인다.
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

const ReceiveHistoryPage: React.FC = () => {
  const [rows, setRows] = useState<ReceiveRow[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [month, setMonth] = useState(() => monthKey(new Date()));
  const [search, setSearch] = useState('');

  useEffect(() => subscribeReceives(setRows), []);
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

  // 입고 SKU명으로 상품관리 상품을 찾아 썸네일을 보여준다. 이름이 서로 달라 못 찾는 것도 있어,
  // 찾은 것만 사진을 달고 나머지는 SKU명 그대로 둔다.
  const findItem = useMemo(() => {
    const byName = new Map<string, InventoryItem>();
    items.forEach(it => byName.set(norm(it.productName), it));
    return (skuName: string) => {
      const n = norm(skuName);
      const exact = byName.get(n);
      if (exact) return exact;
      for (const [k, it] of byName) if (k && (k.includes(n) || n.includes(k))) return it;
      return null;
    };
  }, [items]);

  // SKU번호로 묶고, 날짜별로 수량을 합산한다.
  const groups = useMemo(() => {
    const map = new Map<string, { sku: string; skuName: string; byDay: Map<string, number>; detail: Map<string, string[]>; total: number }>();
    for (const r of rows) {
      const day = String(r.date || '').slice(0, 10);
      if (day.slice(0, 7) !== month) continue;
      const key = r.sku || r.skuName;
      if (!key) continue;
      const g = map.get(key) || { sku: r.sku, skuName: r.skuName, byDay: new Map(), detail: new Map(), total: 0 };
      const qty = sign(r) * r.qty;
      g.byDay.set(day, (g.byDay.get(day) || 0) + qty);
      g.detail.set(day, [...(g.detail.get(day) || []), `${r.center || '센터 미상'} ${qty > 0 ? '+' : ''}${qty}`]);
      g.total += qty;
      if (!g.skuName) g.skuName = r.skuName;
      map.set(key, g);
    }
    const k = search.trim().toLowerCase();
    return Array.from(map.values())
      .filter(g => !k || g.skuName.toLowerCase().includes(k) || g.sku.includes(k))
      .sort((a, b) => b.total - a.total || a.skuName.localeCompare(b.skuName, 'ko'));
  }, [rows, month, search]);

  const monthTotal = groups.reduce((s, g) => s + g.total, 0);
  // 이름으로 상품관리 상품을 찾은 개수. 이름이 서로 달라 못 찾은 것이 많으면 여기서 바로 보인다.
  const matchedCount = groups.filter(g => findItem(g.skuName)).length;

  return (
    <div className="p-4 sm:p-6 lg:p-8 text-gray-800">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">입고</h1>
          <p className="text-sm text-gray-500">센터별로 쪼개진 입고 줄을 상품 하나로 합쳐 날짜별로 보여줘요. 단가·정산 금액과 줄 삭제는 물류 &gt; 물류창고입고에서 해요.</p>
        </div>
        <div className="flex items-center gap-2">
          <CollectReceives />
          <button onClick={() => shiftMonth(-1)} className="px-2 py-1 rounded border border-gray-200 bg-white hover:bg-gray-50">‹</button>
          <input type="month" value={month} onChange={e => e.target.value && setMonth(e.target.value)} className="px-2 py-1 border border-gray-200 rounded bg-white text-sm" />
          <button onClick={() => shiftMonth(1)} className="px-2 py-1 rounded border border-gray-200 bg-white hover:bg-gray-50">›</button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="상품명·SKU 검색"
          className="w-64 px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
        <span className="text-sm text-gray-500">
          상품 {groups.length}개 · 이 달 입고 {monthTotal.toLocaleString()}개
          {groups.length > 0 && <span className="text-gray-400"> · 상품관리와 이름이 맞은 건 {matchedCount}개</span>}
        </span>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
        <table className="text-xs border-collapse">
          <thead className="bg-gray-50 text-gray-500">
            <tr>
              <th className="sticky left-0 z-10 bg-gray-50 min-w-[16rem] px-3 py-2 text-left font-medium border-r border-gray-200">상품</th>
              <th className="w-14 px-1 py-2 text-center font-medium border-r border-gray-200">합계</th>
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
            {groups.map(g => {
              const it = findItem(g.skuName);
              const { base, option } = splitProductName(it ? it.productName : g.skuName);
              return (
                <tr key={g.sku || g.skuName} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="sticky left-0 z-10 bg-white px-3 py-1.5 border-r border-gray-200 max-w-[16rem]">
                    <div className="flex items-center gap-2">
                      {it?.imageUrl
                        ? <img src={it.imageUrl} alt="" className="w-8 h-8 flex-shrink-0 rounded object-cover border border-gray-100" />
                        : <div className="w-8 h-8 flex-shrink-0 rounded bg-gray-100" />}
                      <div className="min-w-0">
                        <div className="truncate text-gray-900" title={`${g.skuName}${g.sku ? ` · SKU ${g.sku}` : ''}`}>{base}</div>
                        {option && <div className="truncate text-gray-400">{option}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-1 py-1.5 text-center font-mono font-semibold text-gray-900 border-r border-gray-200">{g.total}</td>
                  {days.map(d => {
                    const v = g.byDay.get(d);
                    return (
                      <td
                        key={d}
                        title={v != null ? g.detail.get(d)!.join(' · ') : undefined}
                        className={`px-1 py-1.5 text-center font-mono ${d === today ? 'bg-blue-50/50' : ''} ${v == null ? '' : v < 0 ? 'text-blue-600' : 'text-gray-900 font-semibold'}`}
                      >
                        {v == null ? <span className="text-gray-200">·</span> : v}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {!groups.length && (
              <tr><td colSpan={days.length + 2} className="px-3 py-12 text-center text-gray-400">이 달에 입고된 내역이 없어요.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ReceiveHistoryPage;
