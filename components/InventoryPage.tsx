import React, { useEffect, useMemo, useState } from 'react';
import { InventoryItem, subscribeInventory, setOfficeQty, splitProductName, lastTwoStocks } from '../data/inventoryStore';
import { formatTime } from './CollectFromExtension';

// 사무실 > 사무실재고. 쿠팡 광고 화면의 상품마다 사무실 재고(직접 입력)와 로켓센터 재고(광고
// 화면의 재고량)를 한 줄로 보여준다. 로켓센터 값은 "로켓 서허 연동" 확장이 모아온다.
// 같은 상품명(옵션 앞부분)끼리는 한 묶음으로 보여준다.

const OfficeQtyCell: React.FC<{ item: InventoryItem }> = ({ item }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const commit = () => {
    setEditing(false);
    const t = draft.trim();
    const next = t === '' ? null : Math.max(0, parseInt(t, 10) || 0);
    if (next !== (item.officeQty ?? null)) setOfficeQty(item.adsId, next).catch(err => alert(`저장 실패: ${err.message || err}`));
  };
  if (editing) {
    return (
      <input
        type="number"
        min={0}
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onFocus={e => e.target.select()}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
        }}
        className="w-20 px-2 py-1 border border-blue-400 rounded text-right font-mono text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => { setDraft(item.officeQty == null ? '' : String(item.officeQty)); setEditing(true); }}
      className="min-w-[3.5rem] px-2 py-1 rounded text-right font-mono text-sm hover:bg-blue-50 hover:ring-1 hover:ring-blue-200"
      title={item.officeUpdatedAt ? `클릭해서 수정 · 마지막 수정 ${formatTime(item.officeUpdatedAt)}` : '클릭해서 입력'}
    >
      {item.officeQty == null ? <span className="text-gray-300">입력</span> : item.officeQty.toLocaleString()}
    </button>
  );
};

const InventoryPage: React.FC = () => {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => subscribeInventory(setItems), []);

  // 상품명(옵션 앞부분)으로 묶고, 묶음 안에서는 옵션 이름순.
  const groups = useMemo(() => {
    const k = search.trim().toLowerCase();
    const map = new Map<string, InventoryItem[]>();
    items
      .filter(it => !k || it.productName.toLowerCase().includes(k) || it.adsId.includes(k))
      .forEach(it => {
        const { base } = splitProductName(it.productName);
        map.set(base, [...(map.get(base) || []), it]);
      });
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b, 'ko'))
      .map(([base, list]) => ({ base, list: list.sort((a, b) => a.productName.localeCompare(b.productName, 'ko')) }));
  }, [items, search]);

  // 마지막 수집에 없던 상품도 지우지 않고 그대로 보여준다(수집이 중간에 끊겨도 목록이 줄지 않게).
  const missingCount = items.filter(it => it.inLatest === false).length;
  const lastCollectedAt = items.reduce((max, it) => Math.max(max, it.collectedAt || 0), 0);

  return (
    <div className="p-4 sm:p-6 lg:p-8 text-gray-800">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">사무실재고</h1>
          <p className="text-sm text-gray-500">상품 {items.length}개{missingCount > 0 && <> · 이번 수집에 없던 상품 {missingCount}개 포함</>} · 사무실 재고는 숫자를 눌러 고칠 수 있어요</p>
        </div>
        <div className="text-right text-xs text-gray-500">
          마지막 수집 {formatTime(lastCollectedAt || undefined)}
          <div className="text-gray-400">로켓센터 재고는 로켓 &gt; 로켓재고에서 가져와요</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="상품명·ID 검색"
          className="w-72 px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs">
            <tr>
              <th className="w-14 px-3 py-2"></th>
              <th className="px-3 py-2 text-left font-medium">상품</th>
              <th className="w-28 px-3 py-2 text-right font-medium">사무실</th>
              <th className="w-28 px-3 py-2 text-right font-medium">로켓센터</th>
              <th className="w-24 px-3 py-2 text-right font-medium" title="마지막 수집 재고 − 그 전 수집 재고. 입고가 없던 날이면 판매량과 같아요.">전일 대비</th>
              <th className="w-24 px-3 py-2 text-right font-medium">합계</th>
            </tr>
          </thead>
          <tbody>
            {groups.map(({ base, list }) => list.map((item, i) => {
              const { option } = splitProductName(item.productName);
              const rocket = item.soldOut ? 0 : item.stock;
              const total = item.officeQty == null && rocket == null ? null : (item.officeQty || 0) + (rocket || 0);
              const h = lastTwoStocks(item);
              const diff = h.last != null && h.prev != null ? h.last - h.prev : null;
              return (
                <tr key={item.adsId} className={`${i === 0 ? 'border-t border-gray-200' : ''} ${item.inLatest === false ? 'bg-gray-50/60' : ''}`}>
                  <td className="px-3 py-2">
                    {item.imageUrl
                      ? <img src={item.imageUrl} alt="" className="w-10 h-10 rounded object-cover border border-gray-100" />
                      : <div className="w-10 h-10 rounded bg-gray-100" />}
                  </td>
                  <td className="px-3 py-2">
                    {i === 0 && <div className="text-gray-900 font-medium">{base}</div>}
                    <div className="text-xs text-gray-500">
                      {option || (i === 0 ? '' : base)}
                      <span className="text-gray-300"> · ID {item.adsId}{item.adState === 'ad' && ' · 광고중'}</span>
                      {item.inLatest === false && <span className="ml-1.5 px-1.5 py-0.5 rounded bg-gray-100 text-gray-400 text-[11px]" title={`마지막 수집 목록에 없었어요 · 마지막 확인 ${formatTime(item.collectedAt)}`}>지난 수집</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right"><OfficeQtyCell item={item} /></td>
                  <td className="px-3 py-2 text-right font-mono" title={`${formatTime(item.collectedAt)} 기준`}>
                    {item.soldOut ? <span className="text-red-500">품절</span> : item.stock == null ? '-' : item.stock.toLocaleString()}
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-mono text-xs ${diff == null || diff === 0 ? 'text-gray-300' : diff < 0 ? 'text-blue-600' : 'text-red-500'}`}
                    title={diff == null ? '기록이 이틀 이상 쌓이면 보여요' : `${h.prevDay} ${h.prev} → ${h.lastDay} ${h.last}`}
                  >
                    {diff == null ? '-' : diff === 0 ? '0' : diff > 0 ? `▲${diff}` : `▼${-diff}`}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-semibold">{total == null ? '-' : total.toLocaleString()}</td>
                </tr>
              );
            }))}
            {!groups.length && (
              <tr>
                <td colSpan={6} className="px-3 py-12 text-center text-gray-400">
                  {items.length
                    ? '검색 결과가 없어요.'
                    : '아직 상품이 없어요. 쿠팡 광고 상품 대시보드에서 확장으로 모은 뒤 "확장에서 가져오기"를 눌러주세요.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default InventoryPage;
