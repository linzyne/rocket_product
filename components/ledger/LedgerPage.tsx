import React, { useEffect, useMemo, useState } from 'react';
import {
  LedgerEntry, LedgerKind, OUT_CATEGORIES, IN_CATEGORIES, AD_CATEGORY,
  subscribeLedger, saveLedgerEntry, deleteLedgerEntry, subscribeImportVat,
} from '../../data/ledgerStore';
import { HanjungOrder, subscribeHanjung } from '../../data/hanjungStore';
import { ReceiveRow, subscribeReceives, sign } from '../../data/receiveStore';
import { vatOf, VatHalf } from '../../data/ledgerCalc';
import { subscribeShipOuts } from '../coupangOrder/data/shipOutStore';
import type { ShipOut } from '../coupangOrder/data/shipOutStore';
import { expandBoxSplit, parseBoxNo } from '../coupangOrder/utils/dataProcessor';
import { PriceBook, loadPriceBook } from '../../data/coupangPriceStore';
import { orderMoney, buyCashOf } from '../../data/hanjungMoney';

// 장부 = 한중발주를 넓힌 것. 두 칸:
//  ① 전체 손익: 한중발주별 매입가·매출가·차액(한중발주 카드와 같은 숫자) − 판매비용(택배비·광고비 등) − 부가세 = 최종 남은 돈
//  ② 월별 현금 흐름(통장 기준): 들어온 돈(쿠팡 지급일 정산금 + 기타입금 − 지난달 광고비) − 나간 돈(1688 제품비·부대비용 + 택배비 + 직접 적은 비용)
//     1688 제품비는 주문한 날, 부대비용은 도착 기록 날짜. 쿠팡 광고비는 다음 달 정산금에서 빠지므로 나간 돈에 따로 넣지 않는다.

// 쿠팡 창고로 보내는 택배 한 박스 값(원).
const BOX_FEE = 3500;
// 출고 건 하나의 박스 수: 줄의 박스 번호(나눠 담은 줄은 조각마다) 가짓수. 번호가 없는 줄은 한 박스로 친다.
const boxCount = (item: ShipOut) => {
  const nos = new Set<number>();
  for (const l of item.lines) for (const p of expandBoxSplit({ ...l, 쉼먼트: l.쉼먼트 || '' })) nos.add(parseBoxNo(p.쉼먼트) || 0);
  return nos.size;
};

const won = (n: number) => `${Math.round(n).toLocaleString()}원`;
const ymOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const nextMonth = (ym: string) => {
  const [y, mo] = ym.split('-').map(Number);
  return ymOf(new Date(y, mo, 1));
};
const ymLabel = (ym: string) => `${Number(ym.slice(0, 4))}년 ${Number(ym.slice(5, 7))}월`;
const signed = (n: number) => <span className={n >= 0 ? 'text-emerald-600' : 'text-red-500'}>{n < 0 ? '−' : ''}{Math.abs(Math.round(n)).toLocaleString()}원</span>;

const Section: React.FC<{ title: string; note?: string; children: React.ReactNode }> = ({ title, note, children }) => (
  <section className="bg-slate-200/70 rounded-2xl px-4 py-3">
    <h3 className="text-sm font-bold text-sky-700 mb-2">{title}{note && <span className="ml-2 text-xs font-normal text-gray-500">{note}</span>}</h3>
    {children}
  </section>
);

const LedgerPage: React.FC = () => {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [orders, setOrders] = useState<HanjungOrder[]>([]);
  const [receives, setReceives] = useState<ReceiveRow[]>([]);
  const [ships, setShips] = useState<ShipOut[]>([]);
  const [importVat, setImportVat] = useState<Record<string, number>>({});
  const [prices, setPrices] = useState<PriceBook>({ byPo: {}, byName: {} });
  useEffect(() => subscribeLedger(setEntries), []);
  useEffect(() => subscribeHanjung(setOrders), []);
  useEffect(() => subscribeReceives(setReceives), []);
  useEffect(() => subscribeShipOuts(list => setShips(list.filter(i => i.sentDate))), []);
  useEffect(() => subscribeImportVat(setImportVat), []);
  useEffect(() => { loadPriceBook().then(setPrices); }, []);

  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setOpen(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

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

  // ① 전체 손익
  const total = useMemo(() => {
    const rows = [...orders].sort((a, b) => b.createdAt - a.createdAt).map(o => ({ o, ...orderMoney(o, receives, prices, orders) }));
    const profitSum = rows.reduce((n, r) => n + (r.profit ?? 0), 0);
    const boxes = ships.reduce((n, i) => n + boxCount(i), 0);
    const shipFee = boxes * BOX_FEE;
    const outByCat = OUT_CATEGORIES.map(c => ({ c, v: entries.filter(e => e.kind === 'out' && e.category === c).reduce((n, e) => n + e.amount, 0) + (c === '택배비' ? shipFee : 0) }));
    const otherIn = entries.filter(e => e.kind === 'in').reduce((n, e) => n + e.amount, 0);
    const sellCost = outByCat.reduce((n, x) => n + x.v, 0);
    // 부가세: 자료가 있는 반기마다 (매출 부가세 − 매입 부가세)를 더한다.
    const dates = [...receives.map(r => r.date), ...orders.flatMap(o => o.receipts.map(r => r.date)), ...entries.map(e => e.date)].filter(Boolean).map(d => String(d).slice(0, 7));
    const halves = Array.from(new Set(dates.map(ym => `${ym.slice(0, 4)}-${Number(ym.slice(5, 7)) <= 6 ? 1 : 2}`))).sort();
    const vatList = halves.map(h => ({ h, due: vatOf(Number(h.slice(0, 4)), Number(h.slice(5)) as VatHalf, receives, orders, entries, importVat).due }));
    const vat = vatList.reduce((n, x) => n + x.due, 0);
    return { rows, profitSum, boxes, shipFee, outByCat, otherIn, sellCost, vatList, vat, final: profitSum + otherIn - sellCost - vat };
  }, [orders, receives, prices, ships, entries, importVat]);

  // ② 월별 현금 흐름
  const months = useMemo(() => {
    type Item = { date: string; label: string; amount: number };
    const map = new Map<string, { ins: Item[]; outs: Item[] }>();
    const at = (ym: string) => { let m = map.get(ym); if (!m) map.set(ym, m = { ins: [], outs: [] }); return m; };
    // 들어온 돈: 쿠팡 정산금(지급일, 부가세 포함). 같은 날 지급분은 한 줄로.
    const payByDay = new Map<string, { amount: number; rows: number }>();
    for (const r of receives) {
      const pd = String(r.payDate || '').slice(0, 10);
      if (!pd) continue;
      const x = payByDay.get(pd) || { amount: 0, rows: 0 };
      x.amount += sign(r) * r.total;
      x.rows += 1;
      payByDay.set(pd, x);
    }
    for (const [d, x] of payByDay) at(d.slice(0, 7)).ins.push({ date: d, label: `쿠팡 정산 ${x.rows}줄`, amount: x.amount });
    for (const e of entries) {
      if (e.kind === 'in') at(e.date.slice(0, 7)).ins.push({ date: e.date, label: `${e.category}${e.memo ? ` · ${e.memo}` : ''}`, amount: e.amount });
      // 쿠팡 광고비는 다음 달 정산금에서 빠진다
      else if (e.category === AD_CATEGORY) { const ym = nextMonth(e.date.slice(0, 7)); at(ym).ins.push({ date: `${ym}-01`, label: `지난달 쿠팡 광고비 (${e.date.slice(5)})`, amount: -e.amount }); }
      else at(e.date.slice(0, 7)).outs.push({ date: e.date, label: `${e.category}${e.memo ? ` · ${e.memo}` : ''}`, amount: e.amount });
    }
    // 나간 돈: 1688 제품비·부대비용
    for (const o of orders) for (const x of buyCashOf(o)) at(x.date.slice(0, 7)).outs.push(x);
    // 택배비(자동): 발송완료한 달, 박스 수 × BOX_FEE
    const boxByMonth = new Map<string, number>();
    for (const i of ships) { const ym = String(i.sentDate).slice(0, 7); boxByMonth.set(ym, (boxByMonth.get(ym) || 0) + boxCount(i)); }
    for (const [ym, n] of boxByMonth) at(ym).outs.push({ date: `${ym}-31`, label: `택배비 자동 · ${n}박스 × ${BOX_FEE.toLocaleString()}원`, amount: n * BOX_FEE });
    const t = today().slice(0, 7);
    return [...map.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([ym, m]) => {
        const inSum = m.ins.reduce((n, x) => n + x.amount, 0);
        const outSum = m.outs.reduce((n, x) => n + x.amount, 0);
        const byDate = (a: Item, b: Item) => a.date.localeCompare(b.date);
        return { ym, future: ym > t, ins: m.ins.sort(byDate), outs: m.outs.sort(byDate), inSum, outSum, net: inSum - outSum };
      });
  }, [receives, entries, orders, ships]);

  const num = 'px-3 text-right font-mono whitespace-nowrap';

  return (
    <div className="p-4 sm:p-6 lg:p-8 text-gray-800 max-w-[900px] space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">장부</h1>
        <p className="text-sm text-gray-500">한중발주 차액에서 판매비용·부가세를 빼면 최종 남은 돈. 아래는 달마다 통장에 들어오고 나간 돈이에요.</p>
      </div>

      {/* ① 전체 손익 */}
      <Section title="전체 손익" note="한중발주 카드와 같은 숫자 · 부가세 포함">
        <table className="text-sm w-full">
          <thead className="text-xs text-gray-500">
            <tr>
              <th className="text-left font-medium py-1">한중발주</th>
              <th className="text-right font-medium px-3">매입가</th>
              <th className="text-right font-medium px-3">매출가</th>
              <th className="text-right font-medium px-3">차액</th>
            </tr>
          </thead>
          <tbody>
            {total.rows.map(({ o, rev, buy, profit }) => (
              <tr key={o.code} className="border-t border-white/80">
                <td className="py-1.5 font-mono font-semibold text-gray-900">{o.code}</td>
                <td className={`${num} text-gray-700`}>{buy.total ? won(buy.total) : <span className="text-gray-400">-</span>}</td>
                <td className={`${num} text-gray-700`}>{rev.total ? won(rev.total) : <span className="text-gray-400">-</span>}</td>
                <td className={`${num} font-semibold`}>{profit == null ? <span className="text-gray-400" title="매입가나 매출가가 없어 차액을 못 셈">-</span> : signed(profit)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-gray-400 font-bold">
              <td className="py-1.5">한중발주 차액 합계</td><td /><td />
              <td className={num}>{signed(total.profitSum)}</td>
            </tr>
            {total.otherIn > 0 && (
              <tr className="text-gray-700">
                <td className="py-1">기타입금</td><td /><td />
                <td className={num}>+{won(total.otherIn)}</td>
              </tr>
            )}
            <tr className="text-gray-700">
              <td className="py-1">판매비용 <span className="text-xs text-gray-500">{total.outByCat.filter(x => x.v).map(x => `${x.c} ${won(x.v)}`).join(' · ') || '아래에서 적어요'}</span></td><td /><td />
              <td className={num}>−{won(total.sellCost)}</td>
            </tr>
            <tr className="text-gray-700">
              <td className="py-1">부가세 <span className="text-xs text-gray-500" title={total.vatList.map(x => `${x.h.replace('-', '년 ')}기 ${won(x.due)}`).join('\n')}>매출 부가세 − 매입 부가세 · <a href="#/tax" className="text-blue-600 hover:underline">세금 보기</a></span></td><td /><td />
              <td className={num}>{total.vat >= 0 ? '−' : '+'}{won(Math.abs(total.vat))}</td>
            </tr>
            <tr className="border-t-2 border-gray-400 font-bold text-base">
              <td className="py-2">최종 남은 돈</td><td /><td />
              <td className={num}>{signed(total.final)}</td>
            </tr>
          </tfoot>
        </table>
      </Section>

      {/* 판매비용 적기: 늘 펼쳐 둔다. 항목 버튼 하나 누르고 금액 적고 엔터. 날짜는 오늘이 기본. */}
      <Section title="판매비용 적기" note="항목 누르고 → 금액 → 엔터">
        <div className="flex flex-wrap gap-1.5 mb-2">
          {[...OUT_CATEGORIES, ...IN_CATEGORIES].map(c => {
            const on = form.category === c;
            const isIn = (IN_CATEGORIES as readonly string[]).includes(c);
            return (
              <button key={c} onClick={() => setForm(f => ({ ...f, category: c, kind: isIn ? 'in' : 'out' }))}
                className={`px-2.5 py-1 rounded-full text-xs border ${on ? (isIn ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-sky-600 border-sky-600 text-white') : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'}`}>
                {c}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <input value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') add(); }}
            placeholder={`${form.category} 금액(원)`} className="w-36 px-2 py-1.5 border border-gray-300 rounded-lg text-right font-mono bg-white" />
          <input value={form.memo} onChange={e => setForm(f => ({ ...f, memo: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') add(); }} placeholder="메모(없어도 돼요)" className="flex-1 min-w-[8rem] px-2 py-1.5 border border-gray-300 rounded-lg bg-white" />
          <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} className="px-2 py-1.5 border border-gray-300 rounded-lg bg-white text-gray-600" />
          <button onClick={add} className="px-3 py-1.5 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700">적기</button>
        </div>
        <div className="text-[11px] text-gray-500 mt-1">택배비는 발송완료 박스 수로 자동으로 들어가요(박스당 {BOX_FEE.toLocaleString()}원). 쿠팡 광고비는 쓴 날로 적으면 통장에선 다음 달 정산금에서 빠져요.</div>
        {entries.length > 0 && (
          <div className="mt-2 bg-white rounded-xl px-3 py-1 max-h-56 overflow-y-auto">
            {[...entries].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt).map(e => (
              <div key={e.id} className="flex items-center gap-3 border-t border-gray-50 first:border-t-0 py-1 text-xs">
                <span className="font-mono text-gray-500">{e.date}</span>
                <span className={e.kind === 'in' ? 'text-emerald-700' : 'text-gray-700'}>{e.category}</span>
                <span className="text-gray-400 truncate flex-1">{e.memo}</span>
                <b className="font-mono">{e.kind === 'in' ? '+' : '−'}{won(e.amount)}</b>
                <button onClick={() => remove(e)} title="지우기" className="w-5 h-5 text-red-500 border border-red-200 rounded hover:bg-red-50">×</button>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ② 월별 현금 흐름 */}
      <Section title="월별 현금 흐름" note="통장 기준 · 누르면 내역">
        <table className="text-sm w-full">
          <thead className="text-xs text-gray-500">
            <tr>
              <th className="text-left font-medium py-1">월</th>
              <th className="text-right font-medium px-3">들어온 돈</th>
              <th className="text-right font-medium px-3">나간 돈</th>
              <th className="text-right font-medium px-3">남은 돈</th>
            </tr>
          </thead>
          <tbody>
            {months.map(m => (
              <React.Fragment key={m.ym}>
                <tr className="border-t border-white/80 cursor-pointer hover:bg-white/60" onClick={() => toggle(m.ym)}>
                  <td className="py-1.5 font-semibold text-gray-900"><span className="text-gray-500 w-3 inline-block font-normal">{open.has(m.ym) ? '▾' : '▸'}</span> {ymLabel(m.ym)}{m.future && <span className="ml-1.5 text-xs font-normal text-amber-600">들어올 예정</span>}</td>
                  <td className={`${num} text-gray-700`}>{m.inSum ? won(m.inSum) : '-'}</td>
                  <td className={`${num} text-gray-700`}>{m.outSum ? won(m.outSum) : '-'}</td>
                  <td className={`${num} font-semibold`}>{signed(m.net)}</td>
                </tr>
                {open.has(m.ym) && (
                  <tr><td colSpan={4} className="pb-2">
                    <div className="ml-4 mt-1 bg-white rounded-xl px-3 py-2 grid grid-cols-2 gap-4 text-xs">
                      {([['들어온 돈', m.ins, 'text-emerald-700'], ['나간 돈', m.outs, 'text-gray-700']] as const).map(([title, list, cls]) => (
                        <div key={title}>
                          <div className={`font-semibold mb-1 ${cls}`}>{title}</div>
                          {!list.length && <div className="text-gray-400">없음</div>}
                          {list.map((x, i) => (
                            <div key={i} className="flex gap-2 py-0.5 border-t border-gray-50">
                              <span className="font-mono text-gray-400">{x.date.slice(5)}</span>
                              <span className="flex-1 truncate" title={x.label}>{x.label}</span>
                              <span className="font-mono">{won(x.amount)}</span>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </td></tr>
                )}
              </React.Fragment>
            ))}
            {!months.length && <tr><td colSpan={4} className="py-3 text-center text-xs text-gray-400">아직 기록이 없어요.</td></tr>}
          </tbody>
        </table>
      </Section>
    </div>
  );
};

export default LedgerPage;
