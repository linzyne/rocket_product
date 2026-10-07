import React, { useEffect, useMemo, useState } from 'react';
import {
  LedgerEntry, LedgerKind, OUT_CATEGORIES, IN_CATEGORIES, subscribeLedger, saveLedgerEntry, deleteLedgerEntry,
} from '../../data/ledgerStore';
import { HanjungOrder, subscribeHanjung, orderTotals, receiptTotalCost, inventoryOf } from '../../data/hanjungStore';
import { ReceiveRow, subscribeReceives, settlementOf, sign } from '../../data/receiveStore';

// 장부(뼈대). 달마다 돈이 들고 난 것과, 한중발주 건별 차익·재고를 한 화면에서 본다.
//  · 입금: 정산금(자동 — 쿠팡 입고상세내역의 지급일 기준) + 기타입금(직접 적음)
//  · 출금: 수입비용(자동 — 한중발주 도착 기록의 날짜 기준) + 임대료·마케팅비·택배비·식대·통신비·기타비용(직접 적음)
//  · 한중발주 차익: 그 달에 만든 한중발주마다 정산(공급가) + 남은 재고 금액 − 총원가
//  · 재고: 한중발주 여유 중 아직 어느 쿠팡 발주에도 배정 안 된 수량 × 원가(그 건의 총원가 ÷ 도착 수량)
// 입금·출금은 실제 돈 기준(부가세 포함), 차익은 공급가(부가세 빼고) 기준이다.

const won = (n: number) => `${Math.round(n).toLocaleString()}원`;
const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const ymOfMs = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const Card: React.FC<{ title: string; value: string; sub?: string; tone?: 'in' | 'out' | 'net' }> = ({ title, value, sub, tone }) => (
  <div className="bg-white border border-gray-200 rounded-xl p-4">
    <div className="text-xs text-gray-500">{title}</div>
    <div className={`text-xl font-bold mt-1 ${tone === 'in' ? 'text-emerald-600' : tone === 'out' ? 'text-red-500' : 'text-gray-900'}`}>{value}</div>
    {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
  </div>
);

const LedgerPage: React.FC = () => {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [orders, setOrders] = useState<HanjungOrder[]>([]);
  const [receives, setReceives] = useState<ReceiveRow[]>([]);
  const [month, setMonth] = useState(thisMonth());
  useEffect(() => subscribeLedger(setEntries), []);
  useEffect(() => subscribeHanjung(setOrders), []);
  useEffect(() => subscribeReceives(setReceives), []);

  // 직접 적는 칸
  const [form, setForm] = useState<{ date: string; kind: LedgerKind; category: string; amount: string; memo: string }>({
    date: today(), kind: 'out', category: OUT_CATEGORIES[0], amount: '', memo: '',
  });
  const add = async () => {
    const amount = Math.round(Number(String(form.amount).replace(/[^\d.]/g, '')) || 0);
    if (!amount) return alert('금액을 적어 주세요.');
    try {
      await saveLedgerEntry({ id: `L${Date.now()}`, date: form.date, kind: form.kind, category: form.category, amount, memo: form.memo.trim(), createdAt: Date.now() });
      setForm(f => ({ ...f, amount: '', memo: '' }));
    } catch (err: any) {
      alert(`저장 실패: ${err?.message || err}`);
    }
  };
  const remove = (e: LedgerEntry) => {
    if (!confirm(`${e.date} ${e.category} ${won(e.amount)}을 지울까요?`)) return;
    deleteLedgerEntry(e.id).catch(err => alert(`삭제 실패: ${err?.message || err}`));
  };

  const m = useMemo(() => {
    // 입금: 정산금(지급일이 이 달인 쿠팡 입고 줄, 반출은 뺌)
    const paid = receives.filter(r => String(r.payDate || '').startsWith(month));
    const settleTotal = paid.reduce((s, r) => s + sign(r) * r.total, 0);
    const settleSupply = paid.reduce((s, r) => s + sign(r) * r.totalSupply, 0);
    // 출금: 수입비용(도착 기록 날짜가 이 달)
    const importRows = orders.flatMap(o => o.receipts.filter(r => r.date.startsWith(month)).map(r => ({ code: o.code, r })));
    const importCost = importRows.reduce((s, x) => s + receiptTotalCost(x.r), 0);
    const mine = entries.filter(e => e.date.startsWith(month));
    const sumBy = (kind: LedgerKind, cat?: string) => mine.filter(e => e.kind === kind && (!cat || e.category === cat)).reduce((s, e) => s + e.amount, 0);
    const otherIn = sumBy('in');
    const manualOut = sumBy('out');
    const totalIn = settleTotal + otherIn;
    const totalOut = importCost + manualOut;
    // 한중발주 차익: 이 달에 만든 건
    const hanjung = orders
      .filter(o => ymOfMs(o.createdAt) === month)
      .map(o => {
        const t = orderTotals(o);
        const settle = settlementOf(o, receives);
        const stock = inventoryOf(o).reduce((s, x) => s + x.value, 0);
        return { o, cost: t.totalCost, supply: settle.supply, stock, profit: settle.supply + stock - t.totalCost };
      });
    return { paid, settleTotal, settleSupply, importRows, importCost, mine, sumBy, otherIn, manualOut, totalIn, totalOut, hanjung };
  }, [month, receives, orders, entries]);

  // 재고는 달과 상관없이 지금 남아 있는 것 전부.
  const stock = useMemo(() => orders.flatMap(inventoryOf), [orders]);
  const stockValue = stock.reduce((s, x) => s + x.value, 0);

  const cats = form.kind === 'out' ? OUT_CATEGORIES : IN_CATEGORIES;

  return (
    <div className="p-4 sm:p-6 lg:p-8 text-gray-800 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">장부</h1>
          <p className="text-sm text-gray-500">정산금·수입비용은 자동으로 들어와요. 그 밖의 입금·출금만 아래에 적어 주세요.</p>
        </div>
        <input type="month" value={month} onChange={e => setMonth(e.target.value || thisMonth())} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white" />
      </div>

      {/* 이 달 요약 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card title="입금" value={won(m.totalIn)} sub={`정산금 ${won(m.settleTotal)} · 기타 ${won(m.otherIn)}`} tone="in" />
        <Card title="출금" value={won(m.totalOut)} sub={`수입비용 ${won(m.importCost)} · 그 밖 ${won(m.manualOut)}`} tone="out" />
        <Card title="이 달 돈 흐름(입금 − 출금)" value={won(m.totalIn - m.totalOut)} tone="net" />
        <Card title="지금 재고 금액(한중 여유)" value={won(stockValue)} sub={`${stock.reduce((s, x) => s + x.spare, 0).toLocaleString()}개 · 원가 기준`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        {/* 입금·출금 내역 */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="font-semibold text-gray-900 mb-2">입금 · 출금</div>
          <table className="w-full text-sm">
            <tbody>
              <tr className="border-b border-gray-100"><td className="py-1.5 text-emerald-700">정산금 <span className="text-[11px] text-gray-400">자동 · 지급일 기준 {m.paid.length}줄 · 공급가 {won(m.settleSupply)}</span></td><td className="text-right font-mono">{won(m.settleTotal)}</td></tr>
              <tr className="border-b border-gray-100"><td className="py-1.5 text-emerald-700">기타입금</td><td className="text-right font-mono">{won(m.otherIn)}</td></tr>
              <tr className="border-b border-gray-100"><td className="py-1.5 text-red-600">수입비용 <span className="text-[11px] text-gray-400">자동 · 한중발주 도착 기록 {m.importRows.length}건</span></td><td className="text-right font-mono">{won(m.importCost)}</td></tr>
              {OUT_CATEGORIES.map(c => (
                <tr key={c} className="border-b border-gray-100"><td className="py-1.5 text-red-600">{c}</td><td className="text-right font-mono">{won(m.sumBy('out', c))}</td></tr>
              ))}
            </tbody>
          </table>

          {/* 직접 적기 */}
          <div className="mt-4 pt-3 border-t border-gray-100">
            <div className="text-xs font-semibold text-gray-500 mb-2">직접 적기</div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} className="px-2 py-1 border border-gray-200 rounded" />
              <select
                value={form.kind}
                onChange={e => {
                  const kind = e.target.value as LedgerKind;
                  setForm(f => ({ ...f, kind, category: (kind === 'out' ? OUT_CATEGORIES : IN_CATEGORIES)[0] }));
                }}
                className="px-2 py-1 border border-gray-200 rounded"
              >
                <option value="out">출금</option>
                <option value="in">입금</option>
              </select>
              <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className="px-2 py-1 border border-gray-200 rounded">
                {cats.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <input value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="금액(원)" className="w-28 px-2 py-1 border border-gray-200 rounded text-right font-mono" />
              <input value={form.memo} onChange={e => setForm(f => ({ ...f, memo: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') add(); }} placeholder="메모" className="flex-1 min-w-[8rem] px-2 py-1 border border-gray-200 rounded" />
              <button onClick={add} className="px-3 py-1 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700">적기</button>
            </div>
            <div className="mt-3 max-h-64 overflow-y-auto">
              {!m.mine.length && <div className="text-xs text-gray-400 py-3 text-center">이 달에 직접 적은 기록이 없어요.</div>}
              {m.mine.map(e => (
                <div key={e.id} className="flex items-center gap-3 border-t border-gray-50 py-1.5 text-sm">
                  <span className="font-mono text-gray-500">{e.date.slice(5)}</span>
                  <span className={e.kind === 'in' ? 'text-emerald-700' : 'text-red-600'}>{e.category}</span>
                  <span className="text-gray-400 truncate flex-1">{e.memo}</span>
                  <b className="font-mono">{e.kind === 'in' ? '+' : '−'}{won(e.amount)}</b>
                  <button onClick={() => remove(e)} title="지우기" className="w-5 h-5 text-red-500 border border-red-200 rounded text-xs hover:bg-red-50">×</button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 한중발주 차익 */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="font-semibold text-gray-900">한중발주 차익 <span className="text-xs font-normal text-gray-400">이 달에 만든 건 · 공급가 기준</span></div>
          <div className="text-[11px] text-gray-400 mb-2">차익 = 쿠팡 정산(공급가) + 남은 재고 금액 − 총원가. 재고가 팔리면 재고 금액이 정산으로 바뀌어요.</div>
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-500">
              <tr><th className="text-left font-medium py-1">고유번호</th><th className="text-right font-medium">총원가</th><th className="text-right font-medium">정산</th><th className="text-right font-medium">재고</th><th className="text-right font-medium">차익</th></tr>
            </thead>
            <tbody>
              {m.hanjung.map(h => (
                <tr key={h.o.code} className="border-t border-gray-50">
                  <td className="py-1.5 font-mono">{h.o.code}</td>
                  <td className="text-right font-mono">{won(h.cost)}</td>
                  <td className="text-right font-mono">{won(h.supply)}</td>
                  <td className="text-right font-mono text-gray-500">{won(h.stock)}</td>
                  <td className={`text-right font-mono font-bold ${h.profit >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{won(h.profit)}</td>
                </tr>
              ))}
              {!m.hanjung.length && <tr><td colSpan={5} className="text-xs text-gray-400 py-3 text-center">이 달에 만든 한중발주가 없어요.</td></tr>}
            </tbody>
          </table>

          {/* 지금 재고 */}
          <div className="mt-4 pt-3 border-t border-gray-100">
            <div className="text-xs font-semibold text-gray-500 mb-1">지금 재고(한중 여유) <span className="font-normal text-gray-400">· 아직 어느 쿠팡 발주에도 배정 안 된 수량 × 개당 원가</span></div>
            <table className="w-full text-xs">
              <tbody>
                {stock.map(x => (
                  <tr key={`${x.code}|${x.name}`} className="border-t border-gray-50">
                    <td className="py-1 truncate max-w-[16rem]" title={x.name}>{x.name}</td>
                    <td className="font-mono text-gray-400">{x.code}</td>
                    <td className="text-right font-mono">{x.spare}개{x.incoming > 0 && <span className="text-amber-600"> (오는 중 {x.incoming})</span>}</td>
                    <td className="text-right font-mono text-gray-400">× {won(x.unit)}</td>
                    <td className="text-right font-mono font-semibold">{won(x.value)}</td>
                  </tr>
                ))}
                {!stock.length && <tr><td className="text-gray-400 py-3 text-center">남은 재고가 없어요.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LedgerPage;
