import React, { useEffect, useMemo, useState } from 'react';
import {
  LedgerEntry, LedgerKind, OUT_CATEGORIES, IN_CATEGORIES, AD_CATEGORY, UnitCost,
  subscribeLedger, saveLedgerEntry, deleteLedgerEntry, subscribeUnitCosts, saveUnitCost,
} from '../../data/ledgerStore';
import { HanjungOrder, subscribeHanjung, orderTotals, receiptTotalCost, inventoryOf, isHoldingOrder, unitLandedCost } from '../../data/hanjungStore';
import { ReceiveRow, subscribeReceives, settlementOf, sign, matchLine } from '../../data/receiveStore';

// 장부. 같은 데이터를 두 날짜로 본다.
//  · 입고일로 보기(이익): 그 달에 쿠팡에 입고된 줄의 정산(공급가) − 그 수량의 원가 − 직접 적은 비용 = 순익.
//      원가 = 한중발주 개당 원가(도착 기록의 총원가를 상품별로 나눈 것) × 입고 수량. 한중발주와 짝이 안 맞는 줄은
//      "원가 모름"으로 모아 보여 주고, SKU마다 개당 원가를 직접 적으면 그 값을 쓴다.
//  · 지급일로 보기(통장): 지급일이 그 달인 정산금(부가세 포함) − 지난달 쿠팡 광고비 + 기타입금,
//      나간 돈 = 수입비용(한중발주 도착 기록 날짜) + 직접 적은 출금(쿠팡 광고비는 정산에서 빠지니 제외).
//      앞으로 받을 돈은 지급일이 오늘 뒤인 줄을 달별로 모은다.
//  · 한중발주 차익: 그 달에 만든 한중발주마다 정산(공급가) + 남은 재고 금액 − 총원가
//  · 재고: 한중발주 여유 중 아직 어느 쿠팡 발주에도 배정 안 된 수량 × 원가

type View = 'profit' | 'cash';

const won = (n: number) => `${Math.round(n).toLocaleString()}원`;
const ymOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const thisMonth = () => ymOf(new Date());
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const ymOfMs = (ms: number) => ymOf(new Date(ms));
const prevMonth = (ym: string) => {
  const [y, mo] = ym.split('-').map(Number);
  return ymOf(new Date(y, mo - 2, 1));
};
const ucId = (sku: string) => sku.replace(/\//g, '_');

const Card: React.FC<{ title: string; value: string; sub?: string; tone?: 'in' | 'out' | 'net' }> = ({ title, value, sub, tone }) => (
  <div className="bg-white border border-gray-200 rounded-xl p-4">
    <div className="text-xs text-gray-500">{title}</div>
    <div className={`text-xl font-bold mt-1 ${tone === 'in' ? 'text-emerald-600' : tone === 'out' ? 'text-red-500' : 'text-gray-900'}`}>{value}</div>
    {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
  </div>
);

const Row: React.FC<{ label: React.ReactNode; note?: string; value: number; tone: 'in' | 'out'; minus?: boolean }> = ({ label, note, value, tone, minus }) => (
  <tr className="border-b border-gray-100">
    <td className={`py-1.5 ${tone === 'in' ? 'text-emerald-700' : 'text-red-600'}`}>{label} {note && <span className="text-[11px] text-gray-400">{note}</span>}</td>
    <td className="text-right font-mono">{minus && value ? '−' : ''}{won(value)}</td>
  </tr>
);

// 짝 없는 줄의 개당 원가 칸. 칸을 벗어나면 저장한다.
const UnitCostInput: React.FC<{ sku: string; name: string; value: number }> = ({ sku, name, value }) => {
  const [v, setV] = useState(value ? String(value) : '');
  useEffect(() => setV(value ? String(value) : ''), [value]);
  const save = () => {
    const unit = Math.round(Number(v.replace(/[^\d.]/g, '')) || 0);
    if (unit === value) return;
    saveUnitCost(sku, name, unit).catch(err => alert(`저장 실패: ${err?.message || err}`));
  };
  return (
    <input value={v} onChange={e => setV(e.target.value)} onBlur={save} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      placeholder="개당 원가" className="w-24 px-2 py-0.5 border border-gray-200 rounded text-right font-mono text-xs" />
  );
};

const LedgerPage: React.FC = () => {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [orders, setOrders] = useState<HanjungOrder[]>([]);
  const [receives, setReceives] = useState<ReceiveRow[]>([]);
  const [unitCosts, setUnitCosts] = useState<Record<string, UnitCost>>({});
  const [month, setMonth] = useState(thisMonth());
  const [view, setView] = useState<View>('profit');
  useEffect(() => subscribeLedger(setEntries), []);
  useEffect(() => subscribeHanjung(setOrders), []);
  useEffect(() => subscribeReceives(setReceives), []);
  useEffect(() => subscribeUnitCosts(setUnitCosts), []);

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

  // 입고 줄 하나의 원가: 한중발주와 짝이 맞으면 그 건의 개당 원가, 아니면 직접 적은 개당 원가.
  const costOf = (r: ReceiveRow) => {
    for (const o of orders) {
      const line = matchLine(o, r);
      if (!line) continue;
      const unit = unitLandedCost(o, line.상품이름);
      if (unit > 0) return { code: o.code, unit, manual: false };
      const m = unitCosts[ucId(r.sku)];
      return { code: o.code, unit: m?.unit || 0, manual: !!m };
    }
    const m = unitCosts[ucId(r.sku)];
    return { code: null as string | null, unit: m?.unit || 0, manual: !!m };
  };

  const m = useMemo(() => {
    const mine = entries.filter(e => e.date.startsWith(month));
    const sumBy = (kind: LedgerKind, cat?: string) => mine.filter(e => e.kind === kind && (!cat || e.category === cat)).reduce((s, e) => s + e.amount, 0);
    const otherIn = sumBy('in');

    // ---- 입고일로 보기(이익) ----
    const inRows = receives
      .filter(r => String(r.date || '').startsWith(month))
      .map(r => ({ r, ...costOf(r) }))
      .sort((a, b) => b.r.date.localeCompare(a.r.date));
    const sales = inRows.reduce((s, x) => s + sign(x.r) * x.r.total, 0);
    const salesSupply = inRows.reduce((s, x) => s + sign(x.r) * x.r.totalSupply, 0);
    const cogs = inRows.reduce((s, x) => s + sign(x.r) * x.r.qty * x.unit, 0);
    const unknownMap = new Map<string, { sku: string; name: string; code: string | null; qty: number; total: number; rows: number }>();
    for (const x of inRows) {
      if (x.unit > 0) continue;
      const u = unknownMap.get(x.r.sku) || { sku: x.r.sku, name: x.r.skuName, code: x.code, qty: 0, total: 0, rows: 0 };
      u.qty += sign(x.r) * x.r.qty;
      u.total += sign(x.r) * x.r.total;
      u.rows += 1;
      unknownMap.set(x.r.sku, u);
    }
    const unknown = [...unknownMap.values()];
    const manualIn = inRows.filter(x => x.manual).length;
    const expense = sumBy('out');
    const profit = salesSupply + otherIn - cogs - expense;

    // ---- 지급일로 보기(통장) ----
    const paid = receives.filter(r => String(r.payDate || '').startsWith(month));
    const settleTotal = paid.reduce((s, r) => s + sign(r) * r.total, 0);
    const prev = prevMonth(month);
    const adPrev = entries.filter(e => e.kind === 'out' && e.category === AD_CATEGORY && e.date.startsWith(prev)).reduce((s, e) => s + e.amount, 0);
    // 보유재고(원래 있던 재고를 넣은 것)는 이 달에 산 게 아니라 뺀다.
    const importRows = orders.filter(o => !isHoldingOrder(o)).flatMap(o => o.receipts.filter(r => r.date.startsWith(month)).map(r => ({ code: o.code, r })));
    const importCost = importRows.reduce((s, x) => s + receiptTotalCost(x.r), 0);
    const cashOut = mine.filter(e => e.kind === 'out' && e.category !== AD_CATEGORY).reduce((s, e) => s + e.amount, 0);
    const cashIn = settleTotal - adPrev + otherIn;
    const cashOutTotal = importCost + cashOut;
    // 앞으로 받을 돈: 지급일이 오늘 뒤인 줄을 달별로
    const t = today();
    const upcoming = new Map<string, { total: number; rows: number }>();
    for (const r of receives) {
      const pd = String(r.payDate || '').slice(0, 10);
      if (!pd || pd <= t) continue;
      const k = pd.slice(0, 7);
      const u = upcoming.get(k) || { total: 0, rows: 0 };
      u.total += sign(r) * r.total;
      u.rows += 1;
      upcoming.set(k, u);
    }
    const upcomingList = [...upcoming.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const upcomingTotal = upcomingList.reduce((s, [, u]) => s + u.total, 0);

    // 한중발주 차익: 이 달에 만든 건
    const hanjung = orders
      .filter(o => ymOfMs(o.createdAt) === month)
      .map(o => {
        const tt = orderTotals(o);
        const settle = settlementOf(o, receives);
        const stock = inventoryOf(o).reduce((s, x) => s + x.value, 0);
        return { o, cost: tt.totalCost, supply: settle.supply, stock, profit: settle.supply + stock - tt.totalCost };
      });
    return {
      mine, sumBy, otherIn,
      inRows, sales, salesSupply, cogs, unknown, manualIn, expense, profit,
      paid, settleTotal, prev, adPrev, importRows, importCost, cashOut, cashIn, cashOutTotal, upcomingList, upcomingTotal,
      hanjung,
    };
  }, [month, receives, orders, entries, unitCosts]);

  // 재고는 달과 상관없이 지금 남아 있는 것 전부.
  const stock = useMemo(() => orders.flatMap(inventoryOf), [orders]);
  const stockValue = stock.reduce((s, x) => s + x.value, 0);

  const cats = form.kind === 'out' ? OUT_CATEGORIES : IN_CATEGORIES;
  const profitView = view === 'profit';

  // 직접 적기(두 보기 공통)
  const manualBox = (
    <div className="mt-4 pt-3 border-t border-gray-100">
      <div className="text-xs font-semibold text-gray-500 mb-1">직접 적기</div>
      <div className="text-[11px] text-gray-400 mb-2">쿠팡 광고비는 쓴 날로 적어 주세요. 이익에선 그 달 비용, 통장에선 다음 달 정산금에서 빠져요.</div>
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
  );

  return (
    <div className="p-4 sm:p-6 lg:p-8 text-gray-800 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">장부</h1>
          <p className="text-sm text-gray-500">
            {profitView
              ? '이 달에 쿠팡에 입고된 것으로 번 돈이에요. 정산금은 부가세 뺀 공급가로 계산해요.'
              : '이 달 통장에 들어오고 나가는 돈이에요. 정산금은 지급일 기준, 부가세 포함이에요.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
            <button onClick={() => setView('profit')} className={`px-3 py-1.5 ${profitView ? 'bg-blue-600 text-white font-semibold' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>입고일로 보기</button>
            <button onClick={() => setView('cash')} className={`px-3 py-1.5 border-l border-gray-200 ${!profitView ? 'bg-blue-600 text-white font-semibold' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>지급일로 보기</button>
          </div>
          <input type="month" value={month} onChange={e => setMonth(e.target.value || thisMonth())} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white" />
        </div>
      </div>

      {/* 이 달 요약 */}
      {profitView ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card title="쿠팡 입고 정산(공급가)" value={won(m.salesSupply)} sub={`부가세 포함 ${won(m.sales)} · ${m.inRows.length}줄`} tone="in" />
          <Card title="입고된 수량의 원가" value={won(m.cogs)} sub={m.unknown.length ? `원가 모름 ${m.unknown.length}종 — 아래에서 적어 주세요` : '모든 줄 원가 있음'} tone="out" />
          <Card title="비용(직접 적은 것)" value={won(m.expense)} sub={m.otherIn ? `기타입금 +${won(m.otherIn)}` : undefined} tone="out" />
          <Card title="이 달 순익" value={won(m.profit)} sub={m.unknown.length ? '원가 모름 줄이 있어 실제보다 커요' : '정산(공급가) + 기타입금 − 원가 − 비용'} tone="net" />
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card title="들어오는 돈" value={won(m.cashIn)} sub={`정산 ${won(m.settleTotal)}${m.adPrev ? ` − 광고비 ${won(m.adPrev)}` : ''}${m.otherIn ? ` + 기타 ${won(m.otherIn)}` : ''}`} tone="in" />
          <Card title="나가는 돈" value={won(m.cashOutTotal)} sub={`수입비용 ${won(m.importCost)} · 그 밖 ${won(m.cashOut)}`} tone="out" />
          <Card title="이 달 돈 흐름" value={won(m.cashIn - m.cashOutTotal)} tone="net" />
          <Card title="앞으로 받을 돈" value={won(m.upcomingTotal)} sub="지급일이 오늘 뒤인 정산금" />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        {profitView ? (
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="font-semibold text-gray-900 mb-2">이 달 이익 <span className="text-xs font-normal text-gray-400">입고일 기준</span></div>
            <table className="w-full text-sm">
              <tbody>
                <Row label="쿠팡 입고 정산" note={`공급가 · ${m.inRows.length}줄`} value={m.salesSupply} tone="in" />
                <Row label="기타입금" value={m.otherIn} tone="in" />
                <Row label="원가" note={`입고 수량 × 개당 원가${m.manualIn ? ` · 직접 적은 원가 ${m.manualIn}줄` : ''}`} value={m.cogs} tone="out" minus />
                {OUT_CATEGORIES.map(c => <Row key={c} label={c} value={m.sumBy('out', c)} tone="out" minus />)}
                <tr><td className="py-2 font-semibold">순익</td><td className={`text-right font-mono font-bold ${m.profit >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{won(m.profit)}</td></tr>
              </tbody>
            </table>

            {/* 원가 모름 */}
            {m.unknown.length > 0 && (
              <div className="mt-4 pt-3 border-t border-gray-100">
                <div className="text-xs font-semibold text-amber-700 mb-1">원가 모름 {m.unknown.length}종</div>
                <div className="text-[11px] text-gray-400 mb-2">한중발주와 짝이 안 맞거나(앱 쓰기 전 발주·한중발주 없이 산 것·상품명이 다른 것) 원가가 아직 없는 상품이에요. 개당 원가를 적으면 원가에 들어가요.</div>
                <table className="w-full text-xs">
                  <tbody>
                    {m.unknown.map(u => (
                      <tr key={u.sku} className="border-t border-gray-50">
                        <td className="py-1 truncate max-w-[14rem]" title={u.name}>{u.name}</td>
                        <td className="font-mono text-gray-400">{u.code || '짝 없음'}</td>
                        <td className="text-right font-mono">{u.qty}개</td>
                        <td className="text-right font-mono text-gray-400">{won(u.total)}</td>
                        <td className="text-right pl-2"><UnitCostInput sku={u.sku} name={u.name} value={unitCosts[ucId(u.sku)]?.unit || 0} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* 입고 줄 */}
            <div className="mt-4 pt-3 border-t border-gray-100">
              <div className="text-xs font-semibold text-gray-500 mb-1">이 달 입고 줄 <span className="font-normal text-gray-400">· 정산은 부가세 포함, 지급일에 통장에 들어와요</span></div>
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="text-gray-400 sticky top-0 bg-white">
                    <tr><th className="text-left font-medium py-1">입고일</th><th className="text-left font-medium">상품</th><th className="text-right font-medium">수량</th><th className="text-right font-medium">정산</th><th className="text-right font-medium">원가</th><th className="text-right font-medium">지급일</th></tr>
                  </thead>
                  <tbody>
                    {m.inRows.map(x => (
                      <tr key={x.r.key} className={`border-t border-gray-50 ${sign(x.r) < 0 ? 'text-red-500' : ''}`}>
                        <td className="py-1 font-mono text-gray-500">{x.r.date.slice(5, 10)}</td>
                        <td className="truncate max-w-[12rem]" title={`${x.r.skuName}${x.code ? ` · ${x.code}` : ''}`}>{sign(x.r) < 0 && '[반출] '}{x.r.skuName}</td>
                        <td className="text-right font-mono">{x.r.qty}</td>
                        <td className="text-right font-mono">{won(x.r.total)}</td>
                        <td className={`text-right font-mono ${x.unit ? '' : 'text-amber-600'}`}>{x.unit ? won(x.r.qty * x.unit) : '모름'}</td>
                        <td className="text-right font-mono text-gray-500">{String(x.r.payDate || '').slice(5, 10) || '-'}</td>
                      </tr>
                    ))}
                    {!m.inRows.length && <tr><td colSpan={6} className="text-gray-400 py-3 text-center">이 달에 입고된 줄이 없어요.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>

            {manualBox}
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="font-semibold text-gray-900 mb-2">통장 입금 · 출금 <span className="text-xs font-normal text-gray-400">지급일·실제 날짜 기준</span></div>
            <table className="w-full text-sm">
              <tbody>
                <Row label="쿠팡 정산금" note={`지급일 기준 ${m.paid.length}줄 · 부가세 포함`} value={m.settleTotal} tone="in" />
                <Row label="쿠팡 광고비 차감" note={`${m.prev.slice(5)}월에 쓴 광고비`} value={m.adPrev} tone="out" minus />
                <Row label="기타입금" value={m.otherIn} tone="in" />
                <Row label="수입비용" note={`자동 · 한중발주 도착 기록 ${m.importRows.length}건`} value={m.importCost} tone="out" minus />
                {OUT_CATEGORIES.filter(c => c !== AD_CATEGORY).map(c => <Row key={c} label={c} value={m.sumBy('out', c)} tone="out" minus />)}
                <tr><td className="py-2 font-semibold">돈 흐름</td><td className={`text-right font-mono font-bold ${m.cashIn - m.cashOutTotal >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{won(m.cashIn - m.cashOutTotal)}</td></tr>
              </tbody>
            </table>

            {/* 앞으로 받을 돈 */}
            <div className="mt-4 pt-3 border-t border-gray-100">
              <div className="text-xs font-semibold text-gray-500 mb-1">앞으로 받을 돈 <span className="font-normal text-gray-400">· 입고됐지만 지급일이 아직 안 온 정산금(부가세 포함)</span></div>
              <table className="w-full text-sm">
                <tbody>
                  {m.upcomingList.map(([ym, u]) => (
                    <tr key={ym} className="border-t border-gray-50">
                      <td className="py-1 font-mono">{ym.replace('-', '년 ')}월</td>
                      <td className="text-xs text-gray-400">{u.rows}줄</td>
                      <td className="text-right font-mono">{won(u.total)}</td>
                    </tr>
                  ))}
                  {!m.upcomingList.length && <tr><td className="text-xs text-gray-400 py-3 text-center">받을 돈이 없어요.</td></tr>}
                </tbody>
              </table>
            </div>

            {manualBox}
          </div>
        )}

        {/* 한중발주 차익 */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="font-semibold text-gray-900">한중발주 차익 <span className="text-xs font-normal text-gray-400">이 달에 만든 건 · 공급가 기준</span></div>
          <div className="text-[11px] text-gray-400 mb-2">한중발주 한 건으로 번 돈이에요. 차익 = 쿠팡 정산(공급가) + 남은 재고(원가로 계산) − 총원가. 남은 재고는 원가로 쳐서 손익 0으로 보니, 결국 입고된 것에서 번 돈이에요. 재고가 다 팔리면 최종 차익이 돼요.</div>
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
            <div className="text-xs font-semibold text-gray-500 mb-1">지금 재고(한중 여유) {won(stockValue)} <span className="font-normal text-gray-400">· 비용이 아니라 가진 물건의 값 · 아직 어느 쿠팡 발주에도 배정 안 된 수량 × 개당 원가</span></div>
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
