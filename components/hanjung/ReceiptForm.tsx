import React, { useEffect, useState } from 'react';
import {
  HanjungOrder, HanjungReceipt, addReceipt, removeReceipt,
  productSummary, orderTotals, receiptGoodsCost, receiptTotalCost, productUnitCost, FEE_KEYS, FeeKey, receiptFee, remainingFee, lineAlloc, sameName,
} from '../../data/hanjungStore';
import { setReady } from '../coupangOrder/data/readyStore';

// 도착하면 그 한중발주에 배정된 쿠팡 발주 줄을 준비됨으로 자동 체크한다(발송대기에서는 줄이 그어진다).
// 상품마다 도착한 수량 안에서, 입고예정일이 빠른 줄부터 다 채워지는 줄만 체크한다.
// 다른 곳(대기·다른 한중발주)과 나눠 맡긴 줄은 이 도착만으로 다 갖춰진 게 아니라서 건드리지 않는다.
export const markArrivedLinesReady = async (order: HanjungOrder) => {
  const lines: { 발주번호: string; 상품이름: string; 확정수량: number }[] = [];
  for (const p of productSummary(order)) {
    let left = p.received;
    const mine = order.lines
      .filter(l => sameName(l.상품이름, p.상품이름) && lineAlloc(l) === l.확정수량)
      .sort((a, b) => String(a.입고예정일).localeCompare(String(b.입고예정일)));
    for (const l of mine) {
      if (lineAlloc(l) > left) break;
      left -= lineAlloc(l);
      lines.push({ 발주번호: l.발주번호, 상품이름: l.상품이름, 확정수량: l.확정수량 });
    }
  }
  if (lines.length) await setReady(lines, true);
  return lines.length;
};

// 한중발주 화면이 이 파일을 쓰므로 거꾸로 가져오지 않게 여기서 따로 둔다.
const won = (n: number) => `${Math.round(n).toLocaleString()}원`;

// 수입입고(도착 기록). 1688 물건이 사무실에 도착하면 그 한중발주에 상품별 도착 수량·단가와
// 관세사비·배송비·작업비를 기록한다. 나눠서 도착하면 여러 번 기록하고, 합계는 한중발주에 쌓인다.
// 예전엔 따로 메뉴(수입입고)였는데, 한 사람이 주문부터 도착까지 다 해서 한중발주 화면 안으로 합쳤다.
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

export const ReceiptForm: React.FC<{ order: HanjungOrder; onDone?: () => void }> = ({ order, onDone }) => {
  const products = productSummary(order);
  const [date, setDate] = useState(today());
  const [qty, setQty] = useState<Record<string, string>>({});
  // 품목별 이번 도착분 총금액(원). 단가로 나누지 않고 총금액을 적는다(저장할 때 ÷ 수량으로 단가를 구한다).
  const [cost, setCost] = useState<Record<string, string>>({});
  const emptyFees = (): Record<FeeKey, string> => ({ 관세사비: '', 통관비: '', 배송비: '', 작업비: '' });
  const [fees, setFees] = useState<Record<FeeKey, string>>(emptyFees());
  const [memo, setMemo] = useState('');
  const [saving, setSaving] = useState(false);

  // 다른 한중발주를 고르면 남은 수량과 지난 단가로 다시 채운다.
  useEffect(() => {
    const q: Record<string, string> = {};
    const c: Record<string, string> = {};
    productSummary(order).forEach(p => {
      q[p.상품이름] = String(Math.max(0, p.ordered - p.received));
      // 주문할 때 적은 금액(개당)을 먼저, 없으면 지난 도착 기록의 개당 금액 × 이번 도착 수량으로 채운다.
      const unit = productUnitCost(order, p.상품이름) || Number(lastUnitCost(order, p.상품이름)) || 0;
      const left = Math.max(0, p.ordered - p.received);
      c[p.상품이름] = unit && left ? String(Math.round(unit * left)) : '';
    });
    setQty(q);
    setCost(c);
    // 주문할 때 적어 둔 비용 중 아직 도착 기록에 안 쓴 만큼을 미리 채운다(나눠 오면 첫 도착에 다 들어가고 다음엔 0).
    const f = emptyFees();
    FEE_KEYS.forEach(k => { const left = remainingFee(order, k); if (left) f[k] = String(left); });
    setFees(f);
    setMemo('');
    setDate(today());
  }, [order.code, order.receipts.length]);

  const items = products
    .map(p => {
      const q = num(qty[p.상품이름] || '');
      return { 상품이름: p.상품이름, qty: q, unitCost: q > 0 ? num(cost[p.상품이름] || '') / q : 0 };
    })
    .filter(it => it.qty > 0);
  const draft: HanjungReceipt = {
    id: '', date, items, memo, createdAt: 0,
    관세사비: num(fees.관세사비), 통관비: num(fees.통관비), 배송비: num(fees.배송비), 작업비: num(fees.작업비),
  };

  const save = async () => {
    if (!items.length) return alert('도착한 수량을 한 개 이상 적어주세요.');
    // 도착 기록은 "물건이 사무실에 왔다"는 기록이다. 단가만 적으려다 저장해서 다 도착한 걸로 되는 일이 없게 한 번 묻는다.
    const totalQty = items.reduce((sum, it) => sum + it.qty, 0);
    if (!confirm(`${date}에 ${items.length}개 품목 ${totalQty.toLocaleString()}개가 사무실에 도착했다고 기록할까요?\n\n(금액만 고치려면 취소하고 머리줄의 "수정"에서 하세요)`)) return;
    const over = items.filter(it => {
      const p = products.find(x => x.상품이름 === it.상품이름);
      return p && p.received + it.qty > p.ordered;
    });
    if (over.length && !confirm(`발주보다 많이 입고돼요:\n${over.map(o => `· ${o.상품이름}`).join('\n')}\n그래도 저장할까요?`)) return;
    setSaving(true);
    try {
      const receipt = { ...draft, id: `r${Date.now()}`, createdAt: Date.now() };
      await addReceipt({ ...order, autoReadyAt: Date.now() }, receipt);
      // 도착한 만큼 배정된 쿠팡 발주 줄을 준비됨으로 체크한다.
      const n = await markArrivedLinesReady({ ...order, receipts: [...order.receipts, receipt] }).catch(() => 0);
      if (n) alert(`도착 기록을 저장했어요. 배정된 쿠팡 발주 ${n}줄을 준비됨으로 체크했어요.`);
      onDone?.();
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
        <div>
          <div className="font-semibold text-gray-900">📦 도착 기록하기</div>
          <div className="text-[11px] text-gray-400">물건이 사무실에 왔을 때만 적어요. 금액만 고치려면 머리줄의 "수정"에서 하세요.</div>
        </div>
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
            <th className="w-32 text-right font-medium">금액(원)</th>
            <th className="w-24 text-right font-medium">개당</th>
          </tr>
        </thead>
        <tbody>
          {products.map(p => (
            <tr key={p.상품이름} className="border-t border-gray-50">
              <td className="py-1.5 pr-2">{p.상품이름}</td>
              <td className="text-right font-mono text-gray-500">{p.ordered}/{p.received}</td>
              <td className="text-right"><input value={qty[p.상품이름] ?? ''} onChange={e => setQty({ ...qty, [p.상품이름]: e.target.value })} onFocus={e => e.target.select()} className={`${input} w-20`} /></td>
              <td className="text-right"><input value={cost[p.상품이름] ?? ''} onChange={e => setCost({ ...cost, [p.상품이름]: e.target.value })} onFocus={e => e.target.select()} placeholder="총금액" className={`${input} w-28`} /></td>
              <td className="text-right font-mono text-gray-400">{num(qty[p.상품이름] || '') > 0 && num(cost[p.상품이름] || '') > 0 ? won(num(cost[p.상품이름] || '') / num(qty[p.상품이름] || '')) : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center gap-3 mb-3 text-sm">
        {FEE_KEYS.map(k => (
          <label key={k} className="flex items-center gap-1.5 text-gray-600">
            {k}
            <input value={fees[k]} onChange={e => setFees({ ...fees, [k]: e.target.value })} onFocus={e => e.target.select()} placeholder="0" className={`${input} w-24`} />
          </label>
        ))}
        <input value={memo} onChange={e => setMemo(e.target.value)} placeholder="메모" className="flex-1 min-w-[8rem] px-2 py-1 border border-gray-200 rounded text-sm" />
      </div>
      <div className="flex items-center justify-end gap-4">
        <div className="text-sm text-gray-600">
          상품원가 {won(receiptGoodsCost(draft))} + 비용 {won(FEE_KEYS.reduce((sum, k) => sum + receiptFee(draft, k), 0))} = <b className="text-gray-900">{won(receiptTotalCost(draft))}</b>
        </div>
        <button onClick={save} disabled={saving} className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:bg-gray-300">
          {saving ? '저장 중…' : '도착 저장'}
        </button>
      </div>
    </div>
  );
};

// 이 한중발주의 도착(수입입고) 기록 목록. 잘못 적은 건 지울 수 있다.
export const ReceiptHistory: React.FC<{ order: HanjungOrder }> = ({ order }) => {
  const handleRemove = (r: HanjungReceipt) => {
    if (!confirm(`${r.date} 도착 기록을 삭제할까요?\n(적어 둔 금액·부대비용은 주문 금액으로 남겨 둬요)`)) return;
    removeReceipt(order, r.id).catch(err => alert(`삭제 실패: ${err?.message || err}`));
  };
  if (!order.receipts.length) return null;
  // 도착 한 번마다 작은 표: 상품 · 수량 · 금액, 아래에 부대비용과 합계.
  return (
    <div className="space-y-3">
      {order.receipts.slice().reverse().map(r => (
        <div key={r.id} className="text-xs">
          <div className="flex items-center gap-3 mb-1">
            <span className="font-mono font-semibold text-gray-700">{r.date}</span>
            <span className="text-gray-400">{r.items.reduce((s, it) => s + it.qty, 0)}개 도착</span>
            {r.memo && <span className="text-gray-400">📝 {r.memo}</span>}
            <b className="ml-auto font-mono">{won(receiptTotalCost(r))}</b>
            <button onClick={() => handleRemove(r)} title="이 도착 기록 삭제" className="w-5 h-5 text-red-500 border border-red-200 rounded hover:bg-red-50">×</button>
          </div>
          <table className="w-full">
            <tbody>
              {r.items.map(it => (
                <tr key={it.상품이름} className="border-t border-gray-50">
                  <td className="py-0.5 text-gray-700 truncate max-w-[24rem]" title={it.상품이름}>{it.상품이름}</td>
                  <td className="text-right font-mono w-14">{it.qty}개</td>
                  <td className="text-right font-mono w-24">{won(it.qty * it.unitCost)}</td>
                </tr>
              ))}
              {FEE_KEYS.filter(k => receiptFee(r, k)).map(k => (
                <tr key={k} className="border-t border-gray-50 text-gray-500">
                  <td className="py-0.5">{k}</td>
                  <td />
                  <td className="text-right font-mono">{won(receiptFee(r, k))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
};
