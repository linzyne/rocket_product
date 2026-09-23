import React, { useEffect, useMemo, useState } from 'react';
import {
  HanjungOrder, subscribeHanjung, deleteHanjungOrder, saveHanjungOrder, productSummary, orderTotals,
} from '../../data/hanjungStore';
import { ReceiveRow, subscribeReceives, settlementOf, sign } from '../../data/receiveStore';
import { nextHanjungCode } from '../../data/hanjungStore';
import { subscribeReservations, reservationKey, setReservationMemo } from '../coupangOrder/data/reservationStore';
import type { OrderRow } from '../coupangOrder/types';
import { dateKeyYMD, formatDateDisplay } from '../coupangOrder/utils/dateUtils';

// 발주 > 한중발주. 위쪽 "발주 대기"는 쿠팡발주확인에서 예약으로 넘긴 건 중 아직 1688에 주문하지 않은 것.
// 실제로 주문할 때 골라서 고유번호와 함께 한중발주를 만들고, 아래 목록에서 고유번호별로 추적한다.
// 한 건 = 1688에 한 번에 주문하는 묶음(같은 상품 여러 발주 줄을 합친 것).
// 수입입고(사무실 도착)와 물류창고입고(쿠팡 입고 = 정산)를 건별로 합쳐, 얼마나 정산됐는지 보여준다.
//  정산률 = 쿠팡 입고 수량 ÷ 수입입고 수량, 차익 = 정산 공급가(부가세 제외) − 총원가
export const STATUS_LABEL = {
  ordered: { text: '입고 대기', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  partial: { text: '일부 입고', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  done: { text: '입고 완료', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
} as const;

export const won = (n: number) => `${Math.round(n).toLocaleString()}원`;
const ymdText = (s: string) => (/^\d{8}$/.test(s) ? `${s.slice(4, 6)}/${s.slice(6, 8)}` : s);

// 발주 대기: 예약 중 아직 어느 한중발주에도 들어가지 않은 줄. 체크해서 한중발주 한 건으로 묶는다.
const PendingPanel: React.FC<{ orders: HanjungOrder[] }> = ({ orders }) => {
  const [reservations, setReservations] = useState<OrderRow[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  useEffect(() => subscribeReservations(setReservations), []);

  const pending = useMemo(() => {
    const used = new Set(orders.flatMap(o => o.lines.map(l => l.key)));
    return reservations.filter(r => !used.has(reservationKey(r)));
  }, [reservations, orders]);

  // 체크했던 줄이 다른 곳에서 한중발주로 넘어가면 선택에서 뺀다.
  useEffect(() => {
    const keys = new Set(pending.map(reservationKey));
    setChecked(prev => new Set(Array.from(prev).filter(k => keys.has(k))));
  }, [pending]);

  const selected = pending.filter(r => checked.has(reservationKey(r)));
  // 선택한 줄을 상품별로 합친 수량(1688에 주문할 수량).
  const byProduct = Array.from(
    selected.reduce((m, r) => m.set(r.상품이름, (m.get(r.상품이름) || 0) + (Number(r.확정수량) || 0)), new Map<string, number>())
  );

  const toggle = (k: string) => setChecked(prev => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });
  const allChecked = pending.length > 0 && selected.length === pending.length;

  const create = async () => {
    if (!selected.length) return;
    const input = prompt(`선택한 ${selected.length}건으로 한중발주를 만들어요.\n고유번호를 입력해주세요.`, nextHanjungCode(orders));
    const code = input?.trim();
    if (!code) return;
    if (orders.some(o => o.code === code)) return alert(`고유번호 ${code}는 이미 있어요.`);
    const order: HanjungOrder = {
      code,
      createdAt: Date.now(),
      memo: '',
      lines: selected.map(r => ({
        key: reservationKey(r),
        발주번호: r.발주번호,
        물류센터: r.물류센터,
        상품이름: r.상품이름,
        확정수량: Number(r.확정수량) || 0,
        입고예정일: dateKeyYMD(r.입고예정일).replace(/-/g, ''),
      })),
      receipts: [],
    };
    setSaving(true);
    try {
      await saveHanjungOrder(order);
      await setReservationMemo(selected, `예약 ${code}`);
      setChecked(new Set());
    } catch (err: any) {
      alert(`저장 실패: ${err?.message || err}`);
    } finally {
      setSaving(false);
    }
  };

  if (!pending.length) return null;

  return (
    <div className="bg-white border border-amber-200 rounded-xl mb-5 overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 bg-amber-50 border-b border-amber-100">
        <span className="font-semibold text-amber-800">발주 대기 {pending.length}건</span>
        <span className="text-xs text-amber-700">예약으로 넘긴 건 중 아직 1688에 주문하지 않은 것이에요. 주문할 건을 골라 한중발주를 만드세요.</span>
        <button
          onClick={create}
          disabled={!selected.length || saving}
          className="ml-auto px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:bg-gray-300"
        >
          {saving ? '만드는 중…' : `선택한 ${selected.length}건으로 한중발주 만들기`}
        </button>
      </div>
      <div className="max-h-80 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-gray-500 bg-white sticky top-0">
            <tr>
              <th className="w-10 px-3 py-2">
                <input type="checkbox" checked={allChecked} onChange={() => setChecked(allChecked ? new Set() : new Set(pending.map(reservationKey)))} />
              </th>
              <th className="px-2 py-2 text-left font-medium">발주번호</th>
              <th className="px-2 py-2 text-left font-medium">센터</th>
              <th className="px-2 py-2 text-left font-medium">입고예정일</th>
              <th className="px-2 py-2 text-left font-medium">상품</th>
              <th className="px-3 py-2 text-right font-medium">수량</th>
            </tr>
          </thead>
          <tbody>
            {pending.map(r => {
              const k = reservationKey(r);
              return (
                <tr key={k} className={`border-t border-gray-50 cursor-pointer ${checked.has(k) ? 'bg-blue-50' : 'hover:bg-gray-50'}`} onClick={() => toggle(k)}>
                  <td className="px-3 py-1.5 text-center"><input type="checkbox" checked={checked.has(k)} readOnly /></td>
                  <td className="px-2 py-1.5 font-mono text-gray-500">{r.발주번호}</td>
                  <td className="px-2 py-1.5 text-gray-500">{r.물류센터}</td>
                  <td className="px-2 py-1.5 text-gray-500 whitespace-nowrap">{formatDateDisplay(r.입고예정일)}</td>
                  <td className="px-2 py-1.5">{r.상품이름}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{r.확정수량}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {byProduct.length > 0 && (
        <div className="px-4 py-2 border-t border-gray-100 text-xs text-gray-600">
          주문할 수량: {byProduct.map(([name, q]) => <span key={name} className="mr-3">{name} <b>{q}</b>개</span>)}
        </div>
      )}
    </div>
  );
};

const HanjungOrderPage: React.FC = () => {
  const [orders, setOrders] = useState<HanjungOrder[]>([]);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [receives, setReceives] = useState<ReceiveRow[]>([]);

  useEffect(() => subscribeHanjung(setOrders), []);
  useEffect(() => subscribeReceives(setReceives), []);

  const list = useMemo(() => {
    const k = search.trim().toLowerCase();
    return orders.filter(o =>
      !k || o.code.toLowerCase().includes(k) || o.lines.some(l => l.상품이름.toLowerCase().includes(k) || l.발주번호.includes(k))
    );
  }, [orders, search]);

  const handleDelete = (o: HanjungOrder) => {
    const warn = o.receipts.length ? `\n수입입고 기록 ${o.receipts.length}건도 같이 지워져요.` : '';
    if (!confirm(`한중발주 ${o.code}를 삭제할까요?${warn}\n삭제하면 되돌릴 수 없어요.`)) return;
    // 삭제하면 그 줄들은 다시 "발주 대기"로 돌아가므로, 예약 메모의 고유번호도 지운다.
    const rows = o.lines.map(l => ({ 발주번호: l.발주번호, 상품이름: l.상품이름, 확정수량: l.확정수량, 입고예정일: l.입고예정일 } as OrderRow));
    deleteHanjungOrder(o.code)
      .then(() => setReservationMemo(rows, '예약'))
      .catch(err => alert(`삭제 실패: ${err?.message || err}`));
  };

  const editMemo = (o: HanjungOrder) => {
    const memo = prompt(`${o.code} 메모 (1688 주문번호 등)`, o.memo);
    if (memo == null) return;
    saveHanjungOrder({ ...o, memo }).catch(err => alert(`저장 실패: ${err?.message || err}`));
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 text-gray-800">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">한중발주</h1>
          <p className="text-sm text-gray-500">예약 건을 1688에 주문할 때 한중발주를 만들어요. 도착은 수입입고, 쿠팡 입고는 물류창고입고에서 기록돼요.</p>
        </div>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="고유번호·상품명·발주번호 검색"
          className="w-72 px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
      </div>

      <PendingPanel orders={orders} />

      {!list.length && (
        <div className="bg-white border border-dashed border-gray-200 rounded-xl py-16 text-center text-gray-400 text-sm">
          {orders.length ? '검색 결과가 없어요.' : '아직 한중발주가 없어요. 쿠팡발주확인에서 예약으로 넘긴 뒤, 위 발주 대기에서 골라 만들어 주세요.'}
        </div>
      )}

      <div className="space-y-3">
        {list.map(o => {
          const t = orderTotals(o);
          const st = STATUS_LABEL[t.status];
          const products = productSummary(o);
          const isOpen = open === o.code;
          const settle = settlementOf(o, receives);
          const rate = t.received > 0 ? Math.round((settle.qty / t.received) * 100) : null;
          const profit = settle.supply - t.totalCost;
          return (
            <div key={o.code} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="flex flex-wrap items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50" onClick={() => setOpen(isOpen ? null : o.code)}>
                <span className="font-mono font-bold text-gray-900">{o.code}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full border ${st.cls}`}>{st.text}</span>
                <span className="text-xs text-gray-400">{new Date(o.createdAt).toLocaleDateString('ko-KR')}</span>
                {o.memo && <span className="text-xs text-gray-500 truncate max-w-[16rem]">📝 {o.memo}</span>}
                <span className="ml-auto text-sm text-gray-600 text-right">
                  수입입고 <b>{t.received}</b>/{t.ordered}개
                  {t.totalCost > 0 && <> · 총원가 <b>{won(t.totalCost)}</b></>}
                  <br />
                  <span className="text-xs">
                    쿠팡입고 <b>{settle.qty}</b>개 · 정산 <b>{won(settle.total)}</b>
                    {rate != null && <> · 정산률 <b className={rate >= 100 ? 'text-emerald-600' : 'text-amber-600'}>{rate}%</b></>}
                    {settle.qty > 0 && t.totalCost > 0 && (
                      <> · 차익 <b className={profit >= 0 ? 'text-emerald-600' : 'text-red-500'} title="정산 공급가(부가세 제외) − 총원가">{won(profit)}</b></>
                    )}
                  </span>
                </span>
                <span className="text-gray-300">{isOpen ? '▲' : '▼'}</span>
              </div>

              {isOpen && (
                <div className="border-t border-gray-100 px-4 py-3 space-y-4">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-gray-500">
                      <tr><th className="text-left font-medium py-1">상품</th><th className="w-20 text-right font-medium">발주</th><th className="w-20 text-right font-medium">수입입고</th><th className="w-20 text-right font-medium">남음</th><th className="w-20 text-right font-medium">쿠팡입고</th><th className="w-20 text-right font-medium">미정산</th></tr>
                    </thead>
                    <tbody>
                      {products.map(p => (
                        <tr key={p.상품이름} className="border-t border-gray-50">
                          <td className="py-1.5">{p.상품이름}</td>
                          <td className="text-right font-mono">{p.ordered}</td>
                          <td className="text-right font-mono">{p.received}</td>
                          <td className={`text-right font-mono ${p.ordered - p.received > 0 ? 'text-amber-600' : 'text-gray-300'}`}>{Math.max(0, p.ordered - p.received)}</td>
                          <td className="text-right font-mono">{settle.byProduct.get(p.상품이름) || 0}</td>
                          <td className={`text-right font-mono ${p.received - (settle.byProduct.get(p.상품이름) || 0) > 0 ? 'text-amber-600' : 'text-gray-300'}`}>
                            {Math.max(0, p.received - (settle.byProduct.get(p.상품이름) || 0))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <div>
                    <div className="text-xs font-semibold text-gray-500 mb-1">들어간 쿠팡 발주 {o.lines.length}건</div>
                    <div className="text-xs text-gray-600 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0.5">
                      {o.lines.map(l => (
                        <div key={l.key} className="truncate">
                          <span className="font-mono text-gray-400">{l.발주번호}</span> · {l.물류센터} · {ymdText(l.입고예정일)} · {l.상품이름} <b>{l.확정수량}</b>개
                        </div>
                      ))}
                    </div>
                  </div>

                  {settle.rows.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-gray-500 mb-1">쿠팡 입고(정산) {settle.rows.length}건</div>
                      <div className="text-xs text-gray-600 space-y-0.5">
                        {settle.rows.map(r => (
                          <div key={r.key} className="truncate">
                            <span className="font-mono text-gray-400">{r.date.slice(0, 10)}</span> · <span className="font-mono">{r.발주번호}</span> · {r.skuName} <b>{sign(r) * r.qty}</b>개 · {won(sign(r) * r.total)}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex gap-2 justify-end">
                    <button onClick={() => editMemo(o)} className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50">메모</button>
                    <button onClick={() => handleDelete(o)} className="px-3 py-1.5 text-xs border border-red-200 text-red-600 rounded-lg hover:bg-red-50">삭제</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default HanjungOrderPage;
