import React, { useEffect, useMemo, useState } from 'react';
import {
  LedgerEntry, UnitCost, subscribeLedger, saveLedgerEntry, subscribeUnitCosts, subscribeImportVat, saveImportVat,
} from '../../data/ledgerStore';
import { HanjungOrder, subscribeHanjung, receiptTotalCost } from '../../data/hanjungStore';
import { ReceiveRow, subscribeReceives } from '../../data/receiveStore';
import {
  VatHalf, halfOf, vatDeadline, vatOf, vatOfAmount, importVatKey, profitOf, incomeTaxOf, BASIC_DEDUCTION,
} from '../../data/ledgerCalc';

// 세금. 장부 데이터로 부가세(반기)와 종합소득세(연)를 대략 계산한다.
//  · 부가세 = 매출세액(쿠팡 입고 정산의 부가세, 입고일 기준) − 매입세액
//      매입세액 = 수입 부가세(한중발주 도착 기록마다 직접 적음) + 세금계산서·카드 받은 출금의 1/11(체크)
//  · 종합소득세 = (연 순익 − 본인 기본공제) × 세율 − 누진공제, 지방소득세 10% 더함. 그 밖의 공제는 안 넣었다.

const won = (n: number) => `${Math.round(n).toLocaleString()}원`;
const thisYm = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const Card: React.FC<{ title: string; value: string; sub?: string; tone?: 'in' | 'out' | 'net' }> = ({ title, value, sub, tone }) => (
  <div className="bg-white border border-gray-200 rounded-xl p-4">
    <div className="text-xs text-gray-500">{title}</div>
    <div className={`text-xl font-bold mt-1 ${tone === 'in' ? 'text-emerald-600' : tone === 'out' ? 'text-red-500' : 'text-gray-900'}`}>{value}</div>
    {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
  </div>
);

// 수입 부가세 칸. 칸을 벗어나면 저장한다.
const VatInput: React.FC<{ k: string; value: number }> = ({ k, value }) => {
  const [v, setV] = useState(value ? String(value) : '');
  useEffect(() => setV(value ? String(value) : ''), [value]);
  const save = () => {
    const amount = Math.round(Number(v.replace(/[^\d.]/g, '')) || 0);
    if (amount === value) return;
    saveImportVat(k, amount).catch(err => alert(`저장 실패: ${err?.message || err}`));
  };
  return (
    <input value={v} onChange={e => setV(e.target.value)} onBlur={save} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      placeholder="수입 부가세" className="w-24 px-2 py-0.5 border border-gray-200 rounded text-right font-mono text-xs" />
  );
};

const TaxPage: React.FC = () => {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [orders, setOrders] = useState<HanjungOrder[]>([]);
  const [receives, setReceives] = useState<ReceiveRow[]>([]);
  const [unitCosts, setUnitCosts] = useState<Record<string, UnitCost>>({});
  const [importVat, setImportVat] = useState<Record<string, number>>({});
  const now = halfOf(thisYm());
  const [year, setYear] = useState(now.year);
  const [half, setHalf] = useState<VatHalf>(now.half);
  useEffect(() => subscribeLedger(setEntries), []);
  useEffect(() => subscribeHanjung(setOrders), []);
  useEffect(() => subscribeReceives(setReceives), []);
  useEffect(() => subscribeUnitCosts(setUnitCosts), []);
  useEffect(() => subscribeImportVat(setImportVat), []);

  const vat = useMemo(() => vatOf(year, half, receives, orders, entries, importVat), [year, half, receives, orders, entries, importVat]);
  const income = useMemo(() => {
    const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
    const byMonth = months.map(ym => ({ ym, ...profitOf(ym, receives, orders, unitCosts, entries) }));
    const profit = byMonth.reduce((s, x) => s + x.profit, 0);
    const unknownRows = byMonth.reduce((s, x) => s + x.unknownRows, 0);
    const taxBase = Math.max(0, profit - BASIC_DEDUCTION);
    return { byMonth, profit, unknownRows, taxBase, ...incomeTaxOf(taxBase) };
  }, [year, receives, orders, unitCosts, entries]);

  const toggleVatOk = (e: LedgerEntry) =>
    saveLedgerEntry({ ...e, vatOk: !e.vatOk }).catch(err => alert(`저장 실패: ${err?.message || err}`));

  const years = Array.from(new Set([now.year, now.year - 1, ...receives.map(r => Number(String(r.date).slice(0, 4))).filter(Boolean)])).sort((a, b) => b - a);
  const missingImport = vat.receipts.filter(x => !x.vat).length;

  return (
    <div className="p-4 sm:p-6 lg:p-8 text-gray-800 space-y-5 max-w-4xl">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">세금</h1>
          <p className="text-sm text-gray-500">장부 데이터로 낼 세금을 미리 계산해요. 실제 신고 금액은 세무사·홈택스에서 확인해 주세요.</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={year} onChange={e => setYear(Number(e.target.value))} className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white">
            {years.map(y => <option key={y} value={y}>{y}년</option>)}
          </select>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
            <button onClick={() => setHalf(1)} className={`px-3 py-1.5 ${half === 1 ? 'bg-blue-600 text-white font-semibold' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>1기(1~6월)</button>
            <button onClick={() => setHalf(2)} className={`px-3 py-1.5 border-l border-gray-200 ${half === 2 ? 'bg-blue-600 text-white font-semibold' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>2기(7~12월)</button>
          </div>
        </div>
      </div>

      {/* 부가세 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card title="매출세액" value={won(vat.salesTax)} sub="쿠팡 입고 정산의 부가세" tone="in" />
        <Card title="매입세액" value={won(vat.buyTax)} sub={`수입 ${won(vat.importTax)} · 비용 ${won(vat.expenseTax)}`} tone="out" />
        <Card title={vat.due >= 0 ? '낼 부가세' : '돌려받을 부가세'} value={won(Math.abs(vat.due))} sub={`신고·납부 ${vatDeadline(year, half)}까지`} tone="net" />
        <Card title={`${year}년 종합소득세(대략)`} value={won(income.tax + income.local)} sub={`${year + 1}-05-31까지 · 지방소득세 포함`} />
      </div>
      {(missingImport > 0 || income.unknownRows > 0) && (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-0.5">
          {missingImport > 0 && <div>수입 부가세를 안 적은 도착 기록이 {missingImport}건 있어요. 적기 전까지 낼 부가세가 실제보다 커요.</div>}
          {income.unknownRows > 0 && <div>{year}년 입고 줄 중 원가 모름이 {income.unknownRows}줄 있어요. 장부에서 개당 원가를 적기 전까지 순익·종합소득세가 실제보다 커요.</div>}
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="font-semibold text-gray-900 mb-2">부가세 {year}년 {half}기 <span className="text-xs font-normal text-gray-400">입고일·도착일·출금일 기준</span></div>

        <div className="text-xs font-semibold text-gray-500 mb-1">달별 매출세액</div>
        <table className="w-full text-sm mb-4">
          <tbody>
            {vat.months.map(ym => {
              const tax = receives.filter(r => String(r.date).startsWith(ym)).reduce((s, r) => s + (/반출/.test(r.구분) ? -1 : 1) * r.totalTax, 0);
              return (
                <tr key={ym} className="border-t border-gray-50">
                  <td className="py-1 font-mono">{ym.slice(5)}월</td>
                  <td className="text-right font-mono">{won(tax)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="text-xs font-semibold text-gray-500 mb-1">수입 부가세 <span className="font-normal text-gray-400">· 한중발주 도착 기록마다 세관에 낸 부가세(수입신고필증·관세사 정산서의 부가가치세)</span></div>
        <table className="w-full text-xs mb-4">
          <tbody>
            {vat.receipts.map(x => (
              <tr key={importVatKey(x.code, x.r.id)} className="border-t border-gray-50">
                <td className="py-1 font-mono text-gray-500">{x.r.date.slice(5)}</td>
                <td className="font-mono">{x.code}</td>
                <td className="text-right font-mono text-gray-400">수입비용 {won(receiptTotalCost(x.r))}</td>
                <td className="text-right pl-2"><VatInput k={importVatKey(x.code, x.r.id)} value={x.vat} /></td>
              </tr>
            ))}
            {!vat.receipts.length && <tr><td className="text-gray-400 py-3 text-center">이 기간에 도착 기록이 없어요.</td></tr>}
          </tbody>
        </table>

        <div className="text-xs font-semibold text-gray-500 mb-1">직접 적은 출금 <span className="font-normal text-gray-400">· 세금계산서·카드 영수증을 받은 것만 체크하면 금액의 1/11을 매입세액으로 빼요</span></div>
        <table className="w-full text-xs">
          <tbody>
            {vat.expenses.map(e => (
              <tr key={e.id} className="border-t border-gray-50">
                <td className="py-1"><input type="checkbox" checked={!!e.vatOk} onChange={() => toggleVatOk(e)} /></td>
                <td className="font-mono text-gray-500">{e.date.slice(5)}</td>
                <td className="text-red-600">{e.category}</td>
                <td className="text-gray-400 truncate max-w-[12rem]">{e.memo}</td>
                <td className="text-right font-mono">{won(e.amount)}</td>
                <td className="text-right font-mono text-gray-400">{e.vatOk ? won(vatOfAmount(e.amount)) : '-'}</td>
              </tr>
            ))}
            {!vat.expenses.length && <tr><td className="text-gray-400 py-3 text-center">이 기간에 직접 적은 출금이 없어요.</td></tr>}
          </tbody>
        </table>
      </div>

      {/* 종합소득세 */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="font-semibold text-gray-900 mb-1">종합소득세 {year}년 <span className="text-xs font-normal text-gray-400">대략 · 다음 해 5월 신고</span></div>
        <div className="text-[11px] text-gray-400 mb-2">장부 입고일 보기의 순익을 1년 더한 값에서 본인 기본공제만 빼고 계산했어요. 다른 공제(부양가족·보험·노란우산 등)는 안 넣었어요.</div>
        <table className="w-full text-sm">
          <tbody>
            {income.byMonth.map(x => (
              <tr key={x.ym} className="border-t border-gray-50">
                <td className="py-1 font-mono">{x.ym.slice(5)}월</td>
                <td className="text-xs text-gray-400">{x.rows ? `입고 ${x.rows}줄${x.unknownRows ? ` · 원가 모름 ${x.unknownRows}` : ''}` : ''}</td>
                <td className={`text-right font-mono ${x.profit < 0 ? 'text-red-500' : ''}`}>{won(x.profit)}</td>
              </tr>
            ))}
            <tr className="border-t border-gray-200"><td className="py-1.5 font-semibold" colSpan={2}>연 순익</td><td className="text-right font-mono font-semibold">{won(income.profit)}</td></tr>
            <tr><td className="py-1 text-gray-500" colSpan={2}>− 본인 기본공제</td><td className="text-right font-mono text-gray-500">{won(BASIC_DEDUCTION)}</td></tr>
            <tr><td className="py-1 text-gray-500" colSpan={2}>과세표준</td><td className="text-right font-mono">{won(income.taxBase)}</td></tr>
            <tr><td className="py-1 text-gray-500" colSpan={2}>소득세 {income.rate ? `(세율 ${Math.round(income.rate * 100)}%, 누진공제 반영)` : ''}</td><td className="text-right font-mono">{won(income.tax)}</td></tr>
            <tr><td className="py-1 text-gray-500" colSpan={2}>지방소득세(10%)</td><td className="text-right font-mono">{won(income.local)}</td></tr>
            <tr className="border-t border-gray-200"><td className="py-1.5 font-semibold" colSpan={2}>합계</td><td className="text-right font-mono font-bold">{won(income.tax + income.local)}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default TaxPage;
