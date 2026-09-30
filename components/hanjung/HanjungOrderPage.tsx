import React, { useEffect, useMemo, useState } from 'react';
import {
  HanjungOrder, subscribeHanjung, deleteHanjungOrder, saveHanjungOrder, productSummary, orderTotals,
} from '../../data/hanjungStore';
import { ReceiveRow, subscribeReceives, settlementOf, sign } from '../../data/receiveStore';
import { nextHanjungCode } from '../../data/hanjungStore';
import { subscribeReservations, reservationKey, setReservationMemo } from '../coupangOrder/data/reservationStore';
import type { OrderRow } from '../coupangOrder/types';
import {
  HanjungQueueItem, subscribeHanjungQueue, removeFromHanjungQueue, addToHanjungQueue, hanjungQueueKey, queueItemToRow,
} from '../coupangOrder/data/hanjungQueueStore';
import { dateKeyYMD, formatDateDisplay } from '../coupangOrder/utils/dateUtils';

// 발주 > 한중발주. 위쪽 "발주 대기"는 쿠팡발주확인 발송 목록에서 "한중"을 누른 줄(예약과 따로 저장해서, 그 줄이
// 예약·쉽먼트 등 다른 단계로 넘어가도 여기서는 안 사라진다) + 예전 방식으로 예약에 넘겨 둔 줄 중 아직 주문 안 한 것.
// 1688에 주문했으면 골라서 "주문완료"를 누른다 → 고유번호와 함께 한중발주가 되고, 아래 목록에서 고유번호별로 추적한다.
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

// ── 되돌리기(실행취소) ──
// 한중발주 화면에서 하는 일(만들기·삭제·메모)마다 되돌리는 법과 다시 하는 법을 같이 적어 둔다.
// 화면을 옮겨 다녀와도 남도록 컴포넌트 밖에 둔다(새로고침하면 사라진다).
interface Act { label: string; undo: () => Promise<unknown>; redo: () => Promise<unknown> }
const history: { undo: Act[]; redo: Act[] } = { undo: [], redo: [] };
const failed = (err: any) => alert(`되돌리기 실패: ${err?.message || err}`);

// 발주 대기: 한중 대기 줄 + 예전 예약 줄 중 아직 어느 한중발주에도 들어가지 않은 줄. 체크해서 한중발주 한 건으로 묶는다.
// 줄을 가리키는 열쇠는 발주번호·상품이름·수량(hanjungQueueKey). 날짜·센터는 바뀔 수 있어 뺀다.
type PendingRow = OrderRow & { qkey: string; fromQueue: boolean };
const PendingPanel: React.FC<{ orders: HanjungOrder[]; onRecord: (act: Act) => void }> = ({ orders, onRecord }) => {
  const [reservations, setReservations] = useState<OrderRow[]>([]);
  const [queue, setQueue] = useState<HanjungQueueItem[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  useEffect(() => subscribeReservations(setReservations), []);
  useEffect(() => subscribeHanjungQueue(setQueue), []);

  const pending: PendingRow[] = useMemo(() => {
    const used = new Set(orders.flatMap(o => o.lines.map(l => hanjungQueueKey(l))));
    const out: PendingRow[] = [];
    const seen = new Set<string>();
    for (const q of queue) {
      if (used.has(q.key) || seen.has(q.key)) continue;
      seen.add(q.key);
      out.push({ ...queueItemToRow(q), qkey: q.key, fromQueue: true });
    }
    // 예전 방식: 예약으로 넘긴 줄(대기 제외) 중 아직 주문 안 한 것.
    for (const r of reservations) {
      const k = hanjungQueueKey(r);
      if (used.has(k) || seen.has(k) || (r.메모 || '').includes('대기') || /H\d{6}-\d+/.test(r.메모 || '')) continue;
      seen.add(k);
      out.push({ ...r, qkey: k, fromQueue: false });
    }
    return out;
  }, [reservations, queue, orders]);

  // 체크했던 줄이 다른 곳에서 한중발주로 넘어가면 선택에서 뺀다.
  useEffect(() => {
    const keys = new Set<string>(pending.map(r => r.qkey));
    setChecked(prev => new Set(Array.from(prev).filter((k: string) => keys.has(k))));
  }, [pending]);

  // 같은 상품끼리 묶는다(처음 나온 순서대로). 머리줄에 합산 수량을 보여주고, 그 아래에 발주 줄을 둔다.
  const groups = useMemo(() => {
    const m = new Map<string, PendingRow[]>();
    for (const r of pending) m.set(r.상품이름, [...(m.get(r.상품이름) || []), r]);
    return Array.from(m, ([name, rows]) => ({
      name, rows, qty: rows.reduce((s, r) => s + (Number(r.확정수량) || 0), 0),
    }));
  }, [pending]);

  const selected = pending.filter(r => checked.has(r.qkey));
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
  // 상품 머리줄 체크: 그 상품의 발주 줄을 모두 고르거나 모두 뺀다.
  const toggleGroup = (rows: PendingRow[]) => setChecked(prev => {
    const keys = rows.map(r => r.qkey);
    const on = keys.every(k => prev.has(k));
    const next = new Set(prev);
    keys.forEach(k => (on ? next.delete(k) : next.add(k)));
    return next;
  });

  const create = async () => {
    if (!selected.length) return;
    const input = prompt(`1688에 주문한 ${selected.length}건을 주문완료로 해요(한중발주가 만들어져요).\n고유번호를 입력해주세요.`, nextHanjungCode(orders));
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
    // 한중 대기에서 온 줄은 대기에서 빼고, 예전 예약 줄은 예약 메모에 고유번호를 적는다.
    const fromQueue = selected.filter(r => r.fromQueue);
    const fromRes = selected.filter(r => !r.fromQueue);
    const queued = queue.filter(q => fromQueue.some(r => r.qkey === q.key));
    setSaving(true);
    try {
      await saveHanjungOrder(order);
      if (fromQueue.length) await removeFromHanjungQueue(fromQueue.map(r => r.qkey));
      if (fromRes.length) await setReservationMemo(fromRes, `예약 ${code}`);
      setChecked(new Set());
      // 되돌리면 한중발주를 지우고, 대기 줄은 다시 넣고, 예약 메모는 만들기 전 값으로 돌린다.
      const before = fromRes.map(r => ({ row: r, memo: r.메모 || '예약' }));
      onRecord({
        label: `${code} 주문완료`,
        undo: () => deleteHanjungOrder(code)
          .then(() => addToHanjungQueue(queued.map(queueItemToRow), []))
          .then(() => Promise.all(before.map(b => setReservationMemo([b.row], b.memo)))),
        redo: () => saveHanjungOrder(order)
          .then(() => removeFromHanjungQueue(queued.map(q => q.key)))
          .then(() => setReservationMemo(fromRes, `예약 ${code}`)),
      });
    } catch (err: any) {
      alert(`저장 실패: ${err?.message || err}`);
    } finally {
      setSaving(false);
    }
  };

  // 주문하지 않을 줄을 대기에서 뺀다(한중 대기에서 온 줄만. 예전 예약 줄은 예약 목록에서 다룬다).
  const removeSelected = async () => {
    const rows = selected.filter(r => r.fromQueue);
    if (!rows.length) return;
    if (!confirm(`고른 ${rows.length}줄을 발주 대기에서 뺄까요?`)) return;
    const items = queue.filter(q => rows.some(r => r.qkey === q.key));
    try {
      await removeFromHanjungQueue(rows.map(r => r.qkey));
      setChecked(new Set());
      onRecord({
        label: `발주 대기 ${rows.length}줄 빼기`,
        undo: () => addToHanjungQueue(items.map(queueItemToRow), []),
        redo: () => removeFromHanjungQueue(items.map(q => q.key)),
      });
    } catch (err: any) {
      alert(`저장 실패: ${err?.message || err}`);
    }
  };

  if (!pending.length) return null;

  return (
    <div className="bg-white border border-amber-200 rounded-xl mb-5 overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 bg-amber-50 border-b border-amber-100">
        <span className="font-semibold text-amber-800">발주 대기 {pending.length}건</span>
        <span className="text-xs text-amber-700">쿠팡발주확인에서 "한중"을 누른 줄이에요. 1688에 주문했으면 골라서 주문완료를 누르세요.</span>
        <button
          onClick={removeSelected}
          disabled={!selected.some(r => r.fromQueue) || saving}
          className="ml-auto px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-500 text-sm hover:bg-gray-50 disabled:opacity-40"
          title="고른 줄을 발주 대기에서 뺍니다(주문 안 할 때)"
        >
          선택 빼기
        </button>
        <button
          onClick={create}
          disabled={!selected.length || saving}
          className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:bg-gray-300"
        >
          {saving ? '저장 중…' : `선택한 ${selected.length}건 주문완료`}
        </button>
      </div>
      <table className="w-full text-sm">
        <thead className="text-xs text-gray-500">
          <tr className="border-b border-gray-100">
            <th className="w-10 px-3 py-2">
              <input type="checkbox" checked={allChecked} onChange={() => setChecked(allChecked ? new Set() : new Set(pending.map(r => r.qkey)))} />
            </th>
            {/* 상품명 칸은 글자 길이만큼만 차지하고(발주번호 앞 빈 칸이 남는 폭을 가져감), 수량은 바로 옆 칸에 세로로 맞춘다. 발주번호는 맨 오른쪽. */}
            <th className="px-2 py-2 text-left font-medium whitespace-nowrap">상품 · 입고예정일</th>
            <th className="px-3 py-2 text-right font-medium whitespace-nowrap">수량</th>
            <th className="w-full" />
            <th className="px-4 py-2 text-right font-medium whitespace-nowrap">발주번호</th>
          </tr>
        </thead>
        <tbody>
          {groups.map(g => {
            const keys = g.rows.map(r => r.qkey);
            const on = keys.every(k => checked.has(k));
            const some = !on && keys.some(k => checked.has(k));
            return (
              <React.Fragment key={g.name}>
                <tr
                  className={`border-t border-gray-100 cursor-pointer ${on ? 'bg-blue-50' : 'bg-gray-50/60 hover:bg-gray-100'}`}
                  onClick={() => toggleGroup(g.rows)}
                >
                  <td className="px-3 py-2 text-center">
                    <input type="checkbox" checked={on} ref={el => { if (el) el.indeterminate = some; }} readOnly />
                  </td>
                  <td className="px-2 py-2 font-semibold text-gray-800 whitespace-nowrap">{g.name}</td>
                  <td className="px-3 py-2 text-right font-mono font-bold text-gray-900 whitespace-nowrap">{g.qty}개</td>
                  <td />
                  <td className="px-4 py-2 text-right text-xs text-gray-400 whitespace-nowrap">{g.rows.length > 1 ? `발주 ${g.rows.length}건` : ''}</td>
                </tr>
                {g.rows.length > 1 && g.rows.map(r => {
                  const k = r.qkey;
                  return (
                    <tr key={k} className={`cursor-pointer text-xs text-gray-500 ${checked.has(k) ? 'bg-blue-50/60' : 'hover:bg-gray-50'}`} onClick={() => toggle(k)}>
                      <td className="px-3 py-1 text-center"><input type="checkbox" checked={checked.has(k)} readOnly /></td>
                      <td className="px-2 py-1 whitespace-nowrap">{formatDateDisplay(r.입고예정일)}</td>
                      <td className="px-3 py-1 text-right font-mono whitespace-nowrap">{r.확정수량}개</td>
                      <td />
                      <td className="px-4 py-1 text-right font-mono whitespace-nowrap">{r.발주번호}</td>
                    </tr>
                  );
                })}
                {g.rows.length === 1 && (
                  <tr className="text-xs text-gray-500 cursor-pointer" onClick={() => toggle(keys[0])}>
                    <td />
                    <td className="px-2 py-1 whitespace-nowrap">{formatDateDisplay(g.rows[0].입고예정일)}</td>
                    <td />
                    <td />
                    <td className="px-4 py-1 text-right font-mono whitespace-nowrap">{g.rows[0].발주번호}</td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
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

  const ordersRef = React.useRef(orders);
  ordersRef.current = orders;
  const [, setHistTick] = useState(0);
  const record = (act: Act) => {
    history.undo = [...history.undo, act].slice(-30);
    history.redo = [];
    setHistTick(t => t + 1);
  };
  const undo = () => {
    const last = history.undo.pop();
    if (!last) return;
    history.redo.push(last);
    setHistTick(t => t + 1);
    last.undo().catch(failed);
  };
  const redo = () => {
    const last = history.redo.pop();
    if (!last) return;
    history.undo.push(last);
    setHistTick(t => t + 1);
    last.redo().catch(failed);
  };
  // ⌘Z / ⌘⇧Z(윈도는 Ctrl)로도 되돌리고 다시 한다. 글자를 치는 중일 때는 건드리지 않는다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable) return;
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  useEffect(() => subscribeReceives(setReceives), []);

  const list = useMemo(() => {
    const k = search.trim().toLowerCase();
    return orders.filter(o =>
      !k || o.code.toLowerCase().includes(k) || o.lines.some(l => l.상품이름.toLowerCase().includes(k) || l.발주번호.includes(k))
    );
  }, [orders, search]);

  const handleDelete = (o: HanjungOrder) => {
    const warn = o.receipts.length ? `\n수입입고 기록 ${o.receipts.length}건도 같이 지워져요.` : '';
    if (!confirm(`한중발주 ${o.code}를 삭제할까요?${warn}`)) return;
    // 삭제하면 그 줄들은 다시 "발주 대기"로 돌아가므로, 예약 메모의 고유번호도 지운다.
    const rows = o.lines.map(l => ({ 발주번호: l.발주번호, 상품이름: l.상품이름, 확정수량: l.확정수량, 입고예정일: l.입고예정일 } as OrderRow));
    deleteHanjungOrder(o.code)
      .then(() => setReservationMemo(rows, '예약'))
      .catch(err => alert(`삭제 실패: ${err?.message || err}`));
    record({
      label: `${o.code} 삭제`,
      undo: () => saveHanjungOrder(o).then(() => setReservationMemo(rows, `예약 ${o.code}`)),
      redo: () => deleteHanjungOrder(o.code).then(() => setReservationMemo(rows, '예약')),
    });
  };

  const editMemo = (o: HanjungOrder) => {
    const memo = prompt(`${o.code} 메모 (1688 주문번호 등)`, o.memo);
    if (memo == null) return;
    saveHanjungOrder({ ...o, memo }).catch(err => alert(`저장 실패: ${err?.message || err}`));
    // 되돌릴 때는 그사이 붙은 수입입고 기록을 지우지 않게 지금 저장된 건에서 메모만 바꾼다.
    const setMemo = (m: string) => {
      const cur = ordersRef.current.find(x => x.code === o.code);
      return cur ? saveHanjungOrder({ ...cur, memo: m }) : Promise.resolve();
    };
    record({ label: `${o.code} 메모`, undo: () => setMemo(o.memo), redo: () => setMemo(memo) });
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 text-gray-800">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-gray-900">한중발주</h1>
            {/* 방금 한 일 되돌리기 · 다시실행 (⌘Z / ⌘⇧Z) */}
            <button
              onClick={undo}
              disabled={!history.undo.length}
              title={history.undo.length ? `되돌리기: ${history.undo[history.undo.length - 1].label} (⌘Z)` : '되돌릴 일이 없어요'}
              className="px-2.5 py-1 text-xs font-semibold rounded-md border bg-white text-gray-600 border-gray-200 hover:bg-gray-50 disabled:text-gray-300 disabled:border-gray-100 disabled:hover:bg-white"
            >
              ↶ 되돌리기
            </button>
            <button
              onClick={redo}
              disabled={!history.redo.length}
              title={history.redo.length ? `다시실행: ${history.redo[history.redo.length - 1].label} (⌘⇧Z)` : '다시 할 일이 없어요'}
              className="px-2.5 py-1 text-xs font-semibold rounded-md border bg-white text-gray-600 border-gray-200 hover:bg-gray-50 disabled:text-gray-300 disabled:border-gray-100 disabled:hover:bg-white"
            >
              ↷ 다시실행
            </button>
          </div>
          <p className="text-sm text-gray-500">예약 건을 1688에 주문할 때 한중발주를 만들어요. 도착은 수입입고, 쿠팡 입고는 물류창고입고에서 기록돼요.</p>
        </div>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="고유번호·상품명·발주번호 검색"
          className="w-72 px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
      </div>

      <PendingPanel orders={orders} onRecord={record} />

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
