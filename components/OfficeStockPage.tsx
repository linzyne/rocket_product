import React, { useEffect, useMemo, useState } from 'react';
import { HanjungOrder, subscribeHanjung, inventoryOf, nameKey } from '../data/hanjungStore';
import ProductThumb, { useProductImage } from './hanjung/ProductThumb';

// 사무실 > 사무실재고. 손으로 적지 않고 한중발주에서 자동으로 계산한다.
//   사무실 재고 = 한중발주 여유 중 도착했고(도착 기록) 아직 어느 쿠팡 발주에도 배정 안 된 수량
//   오는 중   = 여유 중 아직 도착 안 한 수량
// 쿠팡 발주에 "재고에서 쓰기"(배정)를 하면 그만큼 줄고, 도착 기록을 저장하면 늘어난다.
// 쿠팡발주확인·쉽먼트생성·발송대기의 "사무실" 칸, 장부의 재고 금액과 같은 숫자다.

const won = (n: number) => `${Math.round(n).toLocaleString()}원`;

const OfficeStockPage: React.FC = () => {
  const [orders, setOrders] = useState<HanjungOrder[]>([]);
  const [search, setSearch] = useState('');
  useEffect(() => subscribeHanjung(setOrders), []);
  const imageOf = useProductImage();

  // 상품별로 모은다(같은 상품이 여러 한중발주에 나뉘어 있으면 합치고, 어느 건의 여유인지는 아래 줄로).
  const rows = useMemo(() => {
    const m = new Map<string, { name: string; arrived: number; incoming: number; value: number; parts: ReturnType<typeof inventoryOf> }>();
    for (const o of [...orders].sort((a, b) => a.createdAt - b.createdAt)) {
      for (const x of inventoryOf(o)) {
        const k = nameKey(x.name);
        const e = m.get(k) || { name: x.name, arrived: 0, incoming: 0, value: 0, parts: [] };
        e.arrived += x.arrived;
        e.incoming += x.incoming;
        e.value += x.value;
        e.parts.push(x);
        m.set(k, e);
      }
    }
    const q = search.trim().toLowerCase();
    return Array.from(m.values())
      .filter(r => !q || r.name.toLowerCase().includes(q))
      .sort((a, b) => b.arrived - a.arrived || a.name.localeCompare(b.name, 'ko'));
  }, [orders, search]);

  const totalArrived = rows.reduce((s, r) => s + r.arrived, 0);
  const totalIncoming = rows.reduce((s, r) => s + r.incoming, 0);
  const totalValue = rows.reduce((s, r) => s + r.value, 0);

  return (
    <div className="p-4 sm:p-6 lg:p-8 text-gray-800">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">사무실재고</h1>
          <p className="text-sm text-gray-500">한중발주로 넉넉히 사 와서 남은 수량이에요. 도착 기록을 저장하면 늘고, 쿠팡 발주에 "재고에서 쓰기"를 하면 줄어요(자동).</p>
        </div>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="상품명 검색"
          className="w-full sm:w-64 px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-white border border-gray-200 rounded-xl p-4"><div className="text-xs text-gray-500">사무실 재고</div><div className="text-xl font-bold text-gray-900 mt-1">{totalArrived.toLocaleString()}개</div></div>
        <div className="bg-white border border-gray-200 rounded-xl p-4"><div className="text-xs text-gray-500">오는 중(여유)</div><div className="text-xl font-bold text-amber-600 mt-1">{totalIncoming.toLocaleString()}개</div></div>
        <div className="bg-white border border-gray-200 rounded-xl p-4"><div className="text-xs text-gray-500">재고 금액(원가)</div><div className="text-xl font-bold text-gray-900 mt-1">{won(totalValue)}</div></div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="text-xs text-gray-500 bg-gray-50">
            <tr>
              <th className="text-left font-medium px-3 py-2">상품</th>
              <th className="text-right font-medium px-3 py-2 w-28">사무실 재고</th>
              <th className="text-right font-medium px-3 py-2 w-24">오는 중</th>
              <th className="text-right font-medium px-3 py-2 w-32">금액(원가)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.name} className="border-t border-gray-100 align-top">
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <ProductThumb url={imageOf(r.name)} />
                    <span>{r.name}</span>
                  </div>
                  {/* 어느 한중발주의 여유인지(오래된 건부터 쓰인다) */}
                  <div className="text-[11px] text-gray-400 mt-1 pl-9">
                    {r.parts.map(p => `${p.code} ${p.arrived}${p.incoming ? `(+${p.incoming})` : ''}개 × ${won(p.unit)}`).join(' · ')}
                  </div>
                </td>
                <td className={`text-right font-mono font-bold px-3 py-2 ${r.arrived > 0 ? 'text-gray-900' : 'text-gray-300'}`}>{r.arrived.toLocaleString()}</td>
                <td className={`text-right font-mono px-3 py-2 ${r.incoming > 0 ? 'text-amber-600' : 'text-gray-300'}`}>{r.incoming ? `+${r.incoming.toLocaleString()}` : '-'}</td>
                <td className="text-right font-mono px-3 py-2">{won(r.value)}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={4} className="text-center text-gray-400 py-10">남은 재고가 없어요.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default OfficeStockPage;
