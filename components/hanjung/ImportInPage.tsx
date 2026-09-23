import React, { useEffect, useMemo, useState } from 'react';
import {
  HanjungOrder, HanjungReceipt, subscribeHanjung, addReceipt, removeReceipt,
  productSummary, orderTotals, receiptGoodsCost, receiptTotalCost,
} from '../../data/hanjungStore';
import { STATUS_LABEL, won } from './HanjungOrderPage';

// 물류 > 수입입고. 1688 물건이 사무실에 도착하면 한중발주 고유번호를 골라 상품별 도착 수량·단가와
// 관세사비·배송비·작업비를 기록한다. 나눠서 도착하면 여러 번 기록하고, 합계는 한중발주에 쌓인다.
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const num = (s: string) => Math.max(0, Number(String(s).replace(/[^\d.]/g, '')) || 0);

// 같은 상품의 지난 입고 단가를 기본값으로 쓴다(매번 다시 적지 않게).
const lastUnitCost = (order: HanjungOrder, name: string) => {
  for (let i = order.receipts.length - 1; i >= 0; i--) {
    const it = order.receipts[i].items.find(x => x.상품이름 === name);
    if (it && it.unitCost) return String(it.unitCost);
  }
  return '';
};

const ReceiptForm: React.FC<{ order: HanjungOrder }> = ({ order }) => {
  const products = productSummary(order);
  const [date, setDate] = useState(today());
  const [qty, setQty] = useState<Record<string, string>>({});
  const [cost, setCost] = useState<Record<string, string>>({});
  const [fees, setFees] = useState({ 관세사비: '', 배송비: '', 작업비: '' });
  const [memo, setMemo] = useState('');
  const [saving, setSaving] = useState(false);

  // 다른 한중발주를 고르면 남은 수량과 지난 단가로 다시 채운다.
  useEffect(() => {
    const q: Record<string, string> = {};
    const c: Record<string, string> = {};
    productSummary(order).forEach(p => {
      q[p.상품이름] = String(Math.max(0, p.ordered - p.received));
      c[p.상품이름] = lastUnitCost(order, p.상품이름);
    });
    setQty(q);
    setCost(c);
    setFees({ 관세사비: '', 배송비: '', 작업비: '' });
    setMemo('');
    setDate(today());
  }, [order.code, order.receipts.length]);

  const items = products
    .map(p => ({ 상품이름: p.상품이름, qty: num(qty[p.상품이름] || ''), unitCost: num(cost[p.상품이름] || '') }))
    .filter(it => it.qty > 0);
  const draft: HanjungReceipt = {
    id: '', date, items, memo, createdAt: 0,
    관세사비: num(fees.관세사비), 배송비: num(fees.배송비), 작업비: num(fees.작업비),
  };

  const save = async () => {
    if (!items.length) return alert('도착한 수량을 한 개 이상 적어주세요.');
    const over = items.filter(it => {
      const p = products.find(x => x.상품이름 === it.상품이름);
      return p && p.received + it.qty > p.ordered;
    });
    if (over.length && !confirm(`발주보다 많이 입고돼요:\n${over.map(o => `· ${o.상품이름}`).join('\n')}\n그래도 저장할까요?`)) return;
    setSaving(true);
    try {
      await addReceipt(order, { ...draft, id: `r${Date.now()}`, createdAt: Date.now() });
    } catch (err: any) {
      alert(`저장 실패: ${err?.message || err}`);
    } finally {
      setSaving(false);
    }
  };

  const input = 'px-2 py-1 border border-gray-200 rounded text-right font-mono text-sm focus:outline-none focus:ring-1 focus:ring-blue-400';

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="font-semibold text-gray-900">입고 기록하기</div>
        <label className="text-sm text-gray-500 flex items-center gap-2">
          도착일 <input type="date" value={date} onChange={e => setDate(e.target.value)} className="px-2 py-1 border border-gray-200 rounded text-sm" />
        </label>
      </div>
      <table className="w-full text-sm mb-3">
        <thead className="text-xs text-gray-500">
          <tr>
            <th className="text-left font-medium py-1">상품</th>
            <th className="w-24 text-right font-medium">발주/기입고</th>
            <th className="w-24 text-right font-medium">이번 도착</th>
            <th className="w-28 text-right font-medium">단가(원)</th>
            <th className="w-28 text-right font-medium">금액</th>
          </tr>
        </thead>
        <tbody>
          {products.map(p => (
            <tr key={p.상품이름} className="border-t border-gray-50">
              <td className="py-1.5 pr-2">{p.상품이름}</td>
              <td className="text-right font-mono text-gray-500">{p.ordered}/{p.received}</td>
              <td className="text-right"><input value={qty[p.상품이름] ?? ''} onChange={e => setQty({ ...qty, [p.상품이름]: e.target.value })} onFocus={e => e.target.select()} className={`${input} w-20`} /></td>
              <td className="text-right"><input value={cost[p.상품이름] ?? ''} onChange={e => setCost({ ...cost, [p.상품이름]: e.target.value })} onFocus={e => e.target.select()} placeholder="0" className={`${input} w-24`} /></td>
              <td className="text-right font-mono text-gray-600">{won(num(qty[p.상품이름] || '') * num(cost[p.상품이름] || ''))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center gap-3 mb-3 text-sm">
        {(['관세사비', '배송비', '작업비'] as const).map(k => (
          <label key={k} className="flex items-center gap-1.5 text-gray-600">
            {k}
            <input value={fees[k]} onChange={e => setFees({ ...fees, [k]: e.target.value })} onFocus={e => e.target.select()} placeholder="0" className={`${input} w-24`} />
          </label>
        ))}
        <input value={memo} onChange={e => setMemo(e.target.value)} placeholder="메모" className="flex-1 min-w-[8rem] px-2 py-1 border border-gray-200 rounded text-sm" />
      </div>
      <div className="flex items-center justify-end gap-4">
        <div className="text-sm text-gray-600">
          상품원가 {won(receiptGoodsCost(draft))} + 비용 {won(draft.관세사비 + draft.배송비 + draft.작업비)} = <b className="text-gray-900">{won(receiptTotalCost(draft))}</b>
        </div>
        <button onClick={save} disabled={saving} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:bg-gray-300">
          {saving ? '저장 중…' : '입고 저장'}
        </button>
      </div>
    </div>
  );
};

const ImportInPage: React.FC = () => {
  const [orders, setOrders] = useState<HanjungOrder[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showDone, setShowDone] = useState(false);

  useEffect(() => subscribeHanjung(setOrders), []);

  const list = useMemo(() => {
    const k = search.trim().toLowerCase();
    return orders
      .filter(o => showDone || orderTotals(o).status !== 'done' || o.code === selected)
      .filter(o => !k || o.code.toLowerCase().includes(k) || o.lines.some(l => l.상품이름.toLowerCase().includes(k)));
  }, [orders, search, showDone, selected]);

  const order = orders.find(o => o.code === selected) || null;

  const handleRemove = (o: HanjungOrder, r: HanjungReceipt) => {
    if (!confirm(`${r.date} 입고 기록을 삭제할까요?`)) return;
    removeReceipt(o, r.id).catch(err => alert(`삭제 실패: ${err?.message || err}`));
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 text-gray-800">
      <div className="mb-4">
        <h1 className="text-xl font-bold text-gray-900">수입입고</h1>
        <p className="text-sm text-gray-500">사무실에 도착한 1688 물건을 한중발주 고유번호에 맞춰 기록해요. 나눠서 오면 도착할 때마다 기록하면 돼요.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[18rem_1fr] gap-4 items-start">
        <div className="bg-white border border-gray-200 rounded-xl p-2">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="고유번호·상품명 검색"
            className="w-full px-2 py-1.5 border border-gray-200 rounded text-sm mb-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          <label className="flex items-center gap-1.5 text-xs text-gray-500 px-1 mb-1">
            <input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} /> 입고 완료된 건도 보기
          </label>
          <div className="max-h-[70vh] overflow-y-auto">
            {list.map(o => {
              const t = orderTotals(o);
              const st = STATUS_LABEL[t.status];
              return (
                <button
                  key={o.code}
                  onClick={() => setSelected(o.code)}
                  className={`w-full text-left px-2 py-2 rounded-lg ${selected === o.code ? 'bg-blue-50 ring-1 ring-blue-200' : 'hover:bg-gray-50'}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-semibold text-sm">{o.code}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${st.cls}`}>{st.text}</span>
                    <span className="ml-auto text-xs font-mono text-gray-500">{t.received}/{t.ordered}</span>
                  </div>
                  <div className="text-xs text-gray-400 truncate">{Array.from(new Set(o.lines.map(l => l.상품이름))).join(', ')}</div>
                </button>
              );
            })}
            {!list.length && <div className="px-2 py-6 text-center text-xs text-gray-400">입고할 한중발주가 없어요.</div>}
          </div>
        </div>

        {order ? (
          <div className="space-y-4">
            <ReceiptForm order={order} />
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="font-semibold text-gray-900">{order.code} 입고 기록</div>
                <div className="text-sm text-gray-600">총원가 <b className="text-gray-900">{won(orderTotals(order).totalCost)}</b></div>
              </div>
              {!order.receipts.length && <div className="text-sm text-gray-400 py-4 text-center">아직 입고 기록이 없어요.</div>}
              {order.receipts.slice().reverse().map(r => (
                <div key={r.id} className="border-t border-gray-100 py-2 text-sm">
                  <div className="flex items-center gap-3">
                    <span className="font-mono">{r.date}</span>
                    <span className="text-gray-500">{r.items.reduce((s, it) => s + it.qty, 0)}개</span>
                    <span className="text-gray-500">상품 {won(receiptGoodsCost(r))} · 관세사 {won(r.관세사비)} · 배송 {won(r.배송비)} · 작업 {won(r.작업비)}</span>
                    <b className="ml-auto">{won(receiptTotalCost(r))}</b>
                    <button onClick={() => handleRemove(order, r)} title="이 입고 기록 삭제" className="w-6 h-6 text-red-500 border border-red-200 rounded hover:bg-red-50">×</button>
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {r.items.map(it => `${it.상품이름} ${it.qty}개×${it.unitCost.toLocaleString()}`).join(' · ')}{r.memo && ` · 📝 ${r.memo}`}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="bg-white border border-dashed border-gray-200 rounded-xl py-16 text-center text-gray-400 text-sm">
            왼쪽에서 한중발주 고유번호를 골라주세요.
          </div>
        )}
      </div>
    </div>
  );
};

export default ImportInPage;
