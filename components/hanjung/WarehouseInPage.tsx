import React, { useEffect, useMemo, useState } from 'react';
import { HanjungOrder, subscribeHanjung } from '../../data/hanjungStore';
import { ReceiveRow, subscribeReceives, saveReceives, deleteReceive, deleteReceives, hanjungCodeOf, sign } from '../../data/receiveStore';
import { won } from './HanjungOrderPage';
import CollectReceives, { HubReceiveBucket } from '../CollectReceives';

// 물류 > 물류창고입고. 서허 "입고상세내역"을 확장으로 모아 와서 저장하고, 줄마다 어느 한중발주 건인지 보여준다.
// 여기 쌓인 내역이 쿠팡에서 정산받는 내역이다(한중발주 화면에서 건별 정산률로 합쳐 보여줌).
//
// 수집 단추는 CollectReceives가 맡는다(로켓 > 입고와 같이 쓴다).
const monthOf = (date: string) => date.slice(0, 7);

const WarehouseInPage: React.FC = () => {
  const [rows, setRows] = useState<ReceiveRow[]>([]);
  const [orders, setOrders] = useState<HanjungOrder[]>([]);
  const [bucket, setBucket] = useState<HubReceiveBucket | null>(null);
  const [extReady, setExtReady] = useState(false);
  const [importing, setImporting] = useState(false);
  const [month, setMonth] = useState('');
  const [search, setSearch] = useState('');
  // 잘못 가져온 줄을 골라 지우려고 체크해 둔 것들.
  const [picked, setPicked] = useState<Set<string>>(new Set());

  useEffect(() => subscribeReceives(setRows), []);
  useEffect(() => subscribeHanjung(setOrders), []);

  const pending: Omit<ReceiveRow, 'importedAt'>[] = bucket ? Object.values(bucket.items) : [];
  const saved = useMemo(() => new Set(rows.map(r => r.key)), [rows]);
  const newCount = pending.filter(r => !saved.has(r.key)).length;

  const handleImport = async () => {
    if (!pending.length) return;
    setImporting(true);
    try {
      await saveReceives(pending);
    } catch (err: any) {
      alert(`가져오기 실패: ${err?.message || err}`);
    } finally {
      setImporting(false);
    }
  };

  const toggle = (key: string) => setPicked(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

  const handleDeletePicked = async () => {
    const keys = [...picked];
    if (!keys.length) return;
    if (!confirm(`고른 ${keys.length}줄을 지울까요? 서허에서 다시 가져올 수 있어요.`)) return;
    try {
      await deleteReceives(keys);
      setPicked(new Set());
    } catch (err: any) {
      alert(`삭제 실패: ${err?.message || err}`);
    }
  };

  const months = useMemo(() => Array.from(new Set(rows.map(r => monthOf(r.date)))).sort().reverse(), [rows]);
  useEffect(() => {
    if (!month && months.length) setMonth(months[0]);
  }, [months, month]);

  const list = useMemo(() => {
    const k = search.trim().toLowerCase();
    return rows
      .filter(r => !month || monthOf(r.date) === month)
      .filter(r => !k || r.발주번호.includes(k) || r.skuName.toLowerCase().includes(k) || r.sku.includes(k))
      .map(r => ({ r, code: hanjungCodeOf(orders, r) }));
  }, [rows, orders, month, search]);

  const sum = list.reduce(
    (s, { r, code }) => {
      const k = sign(r);
      s.qty += k * r.qty;
      s.total += k * r.total;
      s.supply += k * r.totalSupply;
      if (code) s.matched += k * r.total;
      return s;
    },
    { qty: 0, total: 0, supply: 0, matched: 0 }
  );

  const handleDelete = (r: ReceiveRow) => {
    if (!confirm(`${r.발주번호} ${r.skuName} 입고 내역을 삭제할까요?`)) return;
    deleteReceive(r.key).catch(err => alert(`삭제 실패: ${err?.message || err}`));
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 text-gray-800">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">물류창고입고</h1>
          <p className="text-sm text-gray-500">쿠팡 입고(정산) 내역이에요. 발주번호로 한중발주와 자동으로 짝을 지어요. 날짜별 입고 수량만 볼 때는 로켓 &gt; 입고가 편해요.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right text-xs text-gray-500">
            {extReady
              ? <>확장에 모인 입고 {pending.length}건{newCount > 0 && <b className="text-blue-600"> (새 {newCount}건)</b>}</>
              : <span className="text-amber-600">"로켓 서허 연동" 확장이 연결되지 않았어요</span>}
            <br />
            <a href="https://supplier.coupang.com/scm/receive/detail" target="_blank" rel="noreferrer" className="text-blue-500 hover:underline">서허 입고상세내역 열기 ↗</a>
          </div>
          <CollectReceives onBucket={setBucket} onExtReady={setExtReady}>
            <button
              onClick={handleImport}
              disabled={importing || !pending.length}
              className="px-3 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-semibold hover:bg-gray-50 disabled:text-gray-300 disabled:border-gray-200"
              title="서허 화면에서 직접 검색해 둔 표를 가져옵니다"
            >
              {importing ? '가져오는 중…' : '확장에서 가져오기'}
            </button>
          </CollectReceives>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <select value={month} onChange={e => setMonth(e.target.value)} className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm bg-white">
          <option value="">전체 기간</option>
          {months.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="발주번호·상품명·SKU 검색"
          className="w-72 px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
        {picked.size > 0 && (
          <button
            onClick={handleDeletePicked}
            className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700"
          >
            고른 {picked.size}줄 삭제
          </button>
        )}
        <div className="ml-auto text-sm text-gray-600">
          {sum.qty.toLocaleString()}개 · 정산 <b className="text-gray-900">{won(sum.total)}</b>
          <span className="text-gray-400"> (공급가 {won(sum.supply)})</span>
          {sum.total !== sum.matched && <span className="text-amber-600"> · 한중발주 없는 건 {won(sum.total - sum.matched)}</span>}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs">
            <tr>
              <th className="w-9 px-2 py-2">
                <input
                  type="checkbox"
                  title="지금 보이는 줄 모두 고르기"
                  checked={list.length > 0 && list.every(({ r }) => picked.has(r.key))}
                  onChange={e => setPicked(prev => {
                    const next = new Set(prev);
                    list.forEach(({ r }) => (e.target.checked ? next.add(r.key) : next.delete(r.key)));
                    return next;
                  })}
                />
              </th>
              <th className="px-3 py-2 text-left font-medium">입고일시</th>
              <th className="px-3 py-2 text-left font-medium">구분</th>
              <th className="px-3 py-2 text-left font-medium">발주번호</th>
              <th className="px-3 py-2 text-left font-medium">상품</th>
              <th className="px-3 py-2 text-left font-medium">센터</th>
              <th className="px-3 py-2 text-right font-medium">수량</th>
              <th className="px-3 py-2 text-right font-medium">정산금액</th>
              <th className="px-3 py-2 text-left font-medium">한중발주</th>
              <th className="w-10"></th>
            </tr>
          </thead>
          <tbody>
            {list.map(({ r, code }) => (
              <tr key={r.key} className={`border-t border-gray-100 ${picked.has(r.key) ? 'bg-red-50' : ''}`}>
                <td className="px-2 py-2">
                  <input type="checkbox" checked={picked.has(r.key)} onChange={() => toggle(r.key)} />
                </td>
                <td className="px-3 py-2 font-mono text-xs text-gray-500 whitespace-nowrap">{r.date}</td>
                <td className={`px-3 py-2 ${sign(r) < 0 ? 'text-red-500' : ''}`}>{r.구분}</td>
                <td className="px-3 py-2 font-mono">{r.발주번호}</td>
                <td className="px-3 py-2">{r.skuName}<div className="text-xs text-gray-400">SKU {r.sku}</div></td>
                <td className="px-3 py-2 text-gray-500">{r.center}</td>
                <td className="px-3 py-2 text-right font-mono">{sign(r) * r.qty}</td>
                <td className="px-3 py-2 text-right font-mono" title={`공급가 ${won(r.totalSupply)} + 세액 ${won(r.totalTax)}`}>{won(sign(r) * r.total)}</td>
                <td className="px-3 py-2">{code ? <span className="font-mono text-blue-600">{code}</span> : <span className="text-xs text-gray-300">없음</span>}</td>
                <td className="px-2">
                  <button onClick={() => handleDelete(r)} title="삭제" className="w-6 h-6 text-red-500 border border-red-200 rounded hover:bg-red-50">×</button>
                </td>
              </tr>
            ))}
            {!list.length && (
              <tr><td colSpan={10} className="px-3 py-12 text-center text-gray-400">
                {rows.length ? '검색 결과가 없어요.' : '아직 입고 내역이 없어요. 서허 입고상세내역에서 기간을 검색한 뒤 "확장에서 가져오기"를 눌러주세요.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default WarehouseInPage;
