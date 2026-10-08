import React, { useEffect, useMemo, useState } from 'react';
import {
  HanjungOrder, HanjungLine, subscribeHanjung, deleteHanjungOrder, saveHanjungOrder, productSummary, orderTotals, productOrderQty, productUnitCost, lineAlloc, sameName, nameKey, ordersNeedingAliasRename,
} from '../../data/hanjungStore';
import { ReceiveRow, subscribeReceives, settlementOf, sign } from '../../data/receiveStore';
import { nextHanjungCode, closeShortOrder, planShortFill, planFill, FillPlan, FillLine } from '../../data/hanjungStore';
import { useReady } from '../coupangOrder/data/readyStore';
import { isLinesReady, startLines } from '../coupangOrder/data/lineStore';
import { lockedLineKeys, subscribeShipOuts } from '../coupangOrder/data/shipOutStore';
import { ShipmentBatch, subscribeShipments } from '../../data/shipmentStore';

// 재배정에서 빼야 하는 줄(발송대기·발송완료)을 가리려고 쉽먼트 기록·출고 목록을 받아 둔다.
const useShipLock = () => {
  const [batches, setBatches] = useState<ShipmentBatch[]>([]);
  const [, setTick] = useState(0);
  useEffect(() => subscribeShipments(setBatches), []);
  useEffect(() => subscribeShipOuts(() => setTick(t => t + 1)), []);
  return batches;
};
import { subscribeReservations, reservationKey, setReservationMemo } from '../coupangOrder/data/reservationStore';
import type { OrderRow } from '../coupangOrder/types';
import {
  HanjungQueueItem, subscribeHanjungQueue, removeFromHanjungQueue, addToHanjungQueue, hanjungQueueKey, queueItemToRow, queueAlloc, returnToHanjungQueue, QueueRow,
} from '../coupangOrder/data/hanjungQueueStore';
import { dateKeyYMD, formatDateDisplay, normalizeDateValue } from '../coupangOrder/utils/dateUtils';
import OrderItemsEditor, { OrderItem, useProductNames, itemsToOrderQty, itemQty, itemsToUnitCost, FeeInputs, FeeDraft, feesToNumbers } from './OrderItemsEditor';
import ProductThumb, { useProductImage } from './ProductThumb';
import { ReceiptForm, ReceiptHistory, markArrivedLinesReady } from './ReceiptForm';

// 발주 > 한중발주. 위쪽 "발주 대기"는 쿠팡발주확인 발송 목록에서 "한중"을 누른 줄(예약과 따로 저장해서, 그 줄이
// 예약·쉽먼트 등 다른 단계로 넘어가도 여기서는 안 사라진다) + 예전 방식으로 예약에 넘겨 둔 줄 중 아직 주문 안 한 것.
// 1688에 주문했으면 골라서 "주문완료"를 누른다 → 고유번호와 함께 한중발주가 되고, 아래 목록에서 고유번호별로 추적한다.
// 한 건 = 1688에 한 번에 주문하는 묶음(같은 상품 여러 발주 줄을 합친 것).
// 수입입고(사무실 도착)와 물류창고입고(쿠팡 입고 = 정산)를 건별로 합쳐, 얼마나 정산됐는지 보여준다.
//  정산률 = 쿠팡 입고 수량 ÷ 수입입고 수량, 차익 = 정산 공급가(부가세 제외) − 총원가
// 한 건의 단계: 1688 주문 → 사무실 도착 → 쿠팡 입고(정산). 목록 탭도 이 단계로 나눈다.
type Stage = 'ordered' | 'partial' | 'arrived' | 'settled';
const STAGE_LABEL: Record<Stage, { text: string; cls: string }> = {
  ordered: { text: '도착 전', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  partial: { text: '일부 도착', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  arrived: { text: '쿠팡입고 대기', cls: 'bg-violet-50 text-violet-700 border-violet-200' },
  settled: { text: '완료', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
};
// 다 도착했고 배정(쿠팡 몫)만큼 쿠팡에 입고됐으면 완료. 배정 없는 건(여유만 산 건)은 도착하면 완료.
const stageOf = (o: HanjungOrder, settleQty: number): Stage => {
  const t = orderTotals(o);
  if (t.status !== 'done') return t.status;
  const allocated = productSummary(o).reduce((s, p) => s + p.allocated, 0);
  return settleQty >= allocated ? 'settled' : 'arrived';
};
const TABS: { id: 'arriving' | 'arrived' | 'settled' | 'all'; text: string; has: (st: Stage) => boolean }[] = [
  { id: 'arriving', text: '도착 전', has: st => st === 'ordered' || st === 'partial' },
  { id: 'arrived', text: '쿠팡입고 대기', has: st => st === 'arrived' },
  { id: 'settled', text: '완료', has: st => st === 'settled' },
  { id: 'all', text: '전체', has: () => true },
];
// 머리줄의 단계 칸: "도착 80/120"처럼 한 것/할 것. 다 되면 초록, 일부면 주황.
const Step: React.FC<{ label: string; done: number; total: number }> = ({ label, done, total }) => {
  const cls = total > 0 && done >= total ? 'bg-emerald-50 text-emerald-700' : done > 0 ? 'bg-amber-50 text-amber-700' : 'bg-gray-50 text-gray-400';
  return <span className={`px-1.5 py-0.5 rounded whitespace-nowrap ${cls}`}>{label} <b className="font-mono">{done}</b><span className="opacity-60">/{total}</span></span>;
};

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
// need: 이 대기 줄이 주문해야 하는 수량(쿠팡 줄 일부만 대기에 있으면 그 수량). 확정수량은 줄을 찾는 열쇠라 그대로 둔다.
type PendingRow = OrderRow & { qkey: string; fromQueue: boolean; need: number };
const PendingPanel: React.FC<{ orders: HanjungOrder[]; onRecord: (act: Act) => void }> = ({ orders, onRecord }) => {
  const [reservations, setReservations] = useState<OrderRow[]>([]);
  const [queue, setQueue] = useState<HanjungQueueItem[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  // 이번 1688 주문의 품목별 총수량. 쿠팡 발주에서 온 품목은 qtyDraft(안 고치면 필요 수량),
  // 직접 더한 품목(쿠팡 발주와 상관없이 같이 사는 것)은 extras.
  const [qtyDraft, setQtyDraft] = useState<Record<string, string>>({});
  // 품목별 단가(원). 비워 두면 같은 상품의 지난 주문 단가를 미리 채운다.
  const [costDraft, setCostDraft] = useState<Record<string, string>>({});
  // 이번 주문의 부대비용(예상). 도착 기록 때 기본값이 된다.
  const [feeDraft, setFeeDraft] = useState<FeeDraft>({});
  const [extras, setExtras] = useState<OrderItem[]>([]);
  // 새 고유번호. 비워 두면 오늘 날짜로 다음 번호(H…)를 쓴다.
  const [codeDraft, setCodeDraft] = useState('');
  const names = useProductNames(orders);
  const imageOf = useProductImage();
  // 같은 상품을 예전에 주문할 때 적은 단가(가장 최근 한중발주). 새 주문 단가 칸의 기본값.
  const lastCost = (name: string) => {
    for (const o of orders) {
      const c = productUnitCost(o, name);
      if (c) return String(c);
    }
    return '';
  };
  useEffect(() => subscribeReservations(setReservations), []);
  useEffect(() => subscribeHanjungQueue(setQueue), []);

  const pending: PendingRow[] = useMemo(() => {
    const used = new Set(orders.flatMap(o => o.lines.map(l => hanjungQueueKey(l))));
    const out: PendingRow[] = [];
    const seen = new Set<string>();
    for (const q of queue) {
      // 일부만 대기에 둔 줄(배정 있음)은 나머지가 한중발주에 있어도 대기로 보인다.
      if ((used.has(q.key) && q.배정 == null) || seen.has(q.key)) continue;
      seen.add(q.key);
      out.push({ ...queueItemToRow(q), qkey: q.key, fromQueue: true, need: queueAlloc(q) });
    }
    // 예전 방식: 예약으로 넘긴 줄(대기 제외) 중 아직 주문 안 한 것.
    for (const r of reservations) {
      const k = hanjungQueueKey(r);
      if (used.has(k) || seen.has(k) || (r.메모 || '').includes('대기') || /H\d{6}-\d+/.test(r.메모 || '')) continue;
      seen.add(k);
      out.push({ ...r, qkey: k, fromQueue: false, need: Number(r.확정수량) || 0 });
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
      name, rows, qty: rows.reduce((s, r) => s + r.need, 0),
    }));
  }, [pending]);

  const selected = pending.filter(r => checked.has(r.qkey));
  // 선택한 줄을 상품별로 합친 수량(1688에 주문할 수량).
  const byProduct = Array.from(
    selected.reduce((m, r) => m.set(r.상품이름, (m.get(r.상품이름) || 0) + r.need), new Map<string, number>())
  );
  const items: OrderItem[] = [
    ...byProduct.map(([name, need]) => {
      const qty = qtyDraft[name] ?? String(need);
      // 금액을 안 적었으면 지난 주문 단가 × 이번 수량으로 미리 채운다.
      const last = Number(lastCost(name)) || 0;
      return { name, need, qty, added: false, cost: costDraft[name] ?? (last ? String(Math.round(last * (Number(qty) || 0))) : '') };
    }),
    ...extras,
  ];
  const setItems = (next: OrderItem[]) => {
    const d: Record<string, string> = { ...qtyDraft };
    const c: Record<string, string> = { ...costDraft };
    next.filter(it => !it.added).forEach(it => { d[it.name] = it.qty; c[it.name] = it.cost ?? ''; });
    setQtyDraft(d);
    setCostDraft(c);
    setExtras(next.filter(it => it.added));
  };
  const extraCount = extras.filter(it => it.name.trim() && itemQty(it) > 0).length;

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
    if (!selected.length && !extraCount) return;
    const short = items.filter(it => !it.added && itemQty(it) < it.need);
    if (short.length) return alert(`주문 수량이 쿠팡에 필요한 수량보다 적어요:\n${short.map(it => `${it.name} (필요 ${it.need})`).join('\n')}\n\n덜 샀으면 그 발주 줄은 체크를 풀고 대기에 남겨 두세요.`);
    const code = (codeDraft.trim() || nextHanjungCode(orders));
    if (/[\/]/.test(code)) return alert('고유번호에는 / 를 쓸 수 없어요.');
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
        ...(r.need !== (Number(r.확정수량) || 0) ? { 배정: r.need } : {}),
      })),
      receipts: [],
      orderQty: itemsToOrderQty(items.filter(it => it.added ? itemQty(it) > 0 : true)),
      unitCost: itemsToUnitCost(items),
      fees: feesToNumbers(feeDraft),
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
      setQtyDraft({});
      setCostDraft({});
      setFeeDraft({});
      setExtras([]);
      setCodeDraft('');
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
  // 늦은 발주와 바꾸기: 발주 대기에 있는(=물건이 없는) 급한 쿠팡 줄이, 같은 상품을 맡은 한중발주에서 입고예정일이 더 늦은
  // 쿠팡 줄의 배정을 가져온다(사무실 여유가 있으면 그것부터). 늦은 줄은 그만큼 대신 발주 대기로 온다.
  // 발송완료된 줄은 건드리지 않는다(쉽먼트·발송대기 줄은 날짜가 늦으면 옮긴다). 고른 줄이 있으면 그 줄만, 없으면 대기 줄 전부.
  const ready = useReady();
  const shipBatches = useShipLock();
  useEffect(() => { startLines(); }, []);
  const fillFromLater = async () => {
    if (!isLinesReady()) { alert('발주 목록을 아직 받는 중이에요. 잠시 뒤 다시 눌러 주세요.'); return; }
    const src = (selected.some(r => r.fromQueue) ? selected : pending).filter(r => r.fromQueue && r.need > 0);
    if (!src.length) return;
    const needs = src.map(r => ({
      line: { 발주번호: r.발주번호, 물류센터: r.물류센터, 상품이름: r.상품이름, 확정수량: Number(r.확정수량) || 0, 입고예정일: dateKeyYMD(r.입고예정일).replace(/-/g, '') } as FillLine,
      need: r.need,
    }));
    const skipKeys = lockedLineKeys(shipBatches);
    const keyOf = (l: FillLine) => reservationKey({ 발주번호: l.발주번호, 상품이름: l.상품이름, 확정수량: l.확정수량, 입고예정일: normalizeDateValue(l.입고예정일) } as OrderRow);
    const plan: FillPlan = planFill(needs, orders, { swap: true, skipKeys, keyOf });
    const day = (d: string) => `${Number(d.slice(4, 6))}/${Number(d.slice(6, 8))}`;
    if (!plan.spareFills.length && !plan.swaps.length) {
      alert(`바꿀 수 있는 게 없어요.\n\n${plan.notes.map(n => `· ${n}`).join('\n')}`);
      return;
    }
    const spare = plan.spareFills.map(f => `· ${day(f.line.입고예정일)} 발주 ${f.line.발주번호} ${f.line.상품이름} ${f.qty}개 ← ${f.arrived ? '도착한' : '오는 중인'} 여유(${f.code})`);
    const sw = plan.swaps.map(x => `· ${x.to.상품이름} ${x.qty}개: ${day(x.from.입고예정일)} 발주 ${x.from.발주번호} → ${day(x.to.입고예정일)} 발주 ${x.to.발주번호} (${x.code} · ${x.arrived ? '도착분' : '오는 중'})`);
    if (!confirm(
      `대기 줄을 채울까요?` +
      (spare.length ? `\n\n여유분으로 채워요:\n${spare.join('\n')}` : '') +
      (sw.length ? `\n\n자리 바꾸기(급한 발주가 물건을 받고, 늦은 발주는 다음 주문으로):\n${sw.join('\n')}` : '') +
      (plan.notes.length ? `\n\n그래도 대기에 남는 것:\n${plan.notes.map(n => `· ${n}`).join('\n')}` : '') +
      `\n\n(발송완료된 발주는 건드리지 않아요. 쉽먼트·발송대기에 있는 늦은 발주는 옮겨요.)`,
    )) return;
    const needKeys = needs.map(n => hanjungQueueKey(n.line));
    const rows: QueueRow[] = plan.queue.map(q => ({
      발주번호: q.발주번호, 물류센터: q.물류센터, 상품이름: q.상품이름, 확정수량: q.확정수량,
      입고예정일: normalizeDateValue(q.입고예정일), 메모: '', 쉼먼트: '',
      ...(q.qty !== q.확정수량 ? { 배정: q.qty } : {}),
    }));
    const allKeys = Array.from(new Set([...needKeys, ...rows.map(r => hanjungQueueKey(r))]));
    const beforeQueue = queue.filter(q => allKeys.includes(q.key));
    const beforeOrders = plan.orders.map(x => orders.find(y => y.code === x.code)!).filter(Boolean);
    const rk = (l: FillLine) => ({ 발주번호: l.발주번호, 상품이름: l.상품이름, 확정수량: l.확정수량 });
    const wasOn = plan.readyOff.filter(l => ready.isReady(rk(l)));
    const wasOff = plan.readyOn.filter(l => !ready.isReady(rk(l)));
    setSaving(true);
    const run = async () => {
      for (const x of plan.orders) await saveHanjungOrder(x);
      // 채운 대기 줄은 빼고, 남은 수량과 대신 온 늦은 줄을 다시 넣는다(같은 줄은 합친다).
      await removeFromHanjungQueue(needKeys);
      const rest = queue.filter(q => !needKeys.includes(q.key));
      if (rows.length) await returnToHanjungQueue(rows, rest);
      if (plan.readyOff.length) await ready.setReady(plan.readyOff.map(rk), false);
      if (plan.readyOn.length) await ready.setReady(plan.readyOn.map(rk), true);
    };
    try {
      await run();
      setChecked(new Set());
    } catch (err: any) {
      alert(`바꾸기 실패: ${err?.message || err}`);
      setSaving(false);
      return;
    } finally {
      setSaving(false);
    }
    onRecord({
      label: '대기 줄 채우기',
      undo: async () => {
        for (const x of beforeOrders) await saveHanjungOrder(x);
        await removeFromHanjungQueue(allKeys);
        if (beforeQueue.length) await addToHanjungQueue(beforeQueue.map(queueItemToRow), []);
        if (wasOn.length) await ready.setReady(wasOn.map(rk), true);
        if (wasOff.length) await ready.setReady(wasOff.map(rk), false);
      },
      redo: run,
    });
  };

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


  // 줄을 고르거나 품목을 더했을 때만 이번 1688 주문 입력칸을 보여준다.
  const composing = selected.length > 0 || extras.length > 0;

  return (
    <div className="bg-white border border-amber-200 rounded-xl mb-5 overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 bg-amber-50 border-b border-amber-100">
        <span className="font-semibold text-amber-800">① 발주 대기 {groups.length ? `${groups.length}개 상품 · ${pending.length}줄` : '없음'}</span>
        <span className="text-xs text-amber-700">1688에 주문할 줄을 골라요</span>
        {pending.some(r => r.fromQueue) && (
          <button
            onClick={fillFromLater}
            disabled={saving}
            className={`${selected.some(r => r.fromQueue) ? '' : 'ml-auto '}px-3 py-1 rounded-lg border border-amber-300 bg-white text-amber-800 text-xs font-semibold hover:bg-amber-50 disabled:opacity-40`}
            title="대기 줄을 여유분(도착·오는 중)으로 채우고, 모자라면 늦은 발주와 자리를 바꿔요. 고른 줄이 있으면 그 줄만."
          >
            {selected.some(r => r.fromQueue) ? '고른 줄 ' : ''}대기 줄 채우기
          </button>
        )}
        {selected.some(r => r.fromQueue) && (
          <button
            onClick={removeSelected}
            disabled={saving}
            className="ml-auto px-3 py-1 rounded-lg border border-gray-200 bg-white text-gray-500 text-xs hover:bg-gray-50 disabled:opacity-40"
            title="고른 줄을 발주 대기에서 뺍니다(주문 안 할 때)"
          >
            고른 줄 대기에서 빼기
          </button>
        )}
      </div>
      {pending.length > 0 && (
      <div className="overflow-x-auto">
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
                  <td className="px-2 py-2 font-semibold text-gray-800 whitespace-nowrap">
                    <span className="inline-flex items-center gap-2"><ProductThumb url={imageOf(g.name)} />{g.name}</span>
                  </td>
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
                      <td className="px-3 py-1 text-right font-mono whitespace-nowrap">{r.need}개</td>
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
      </div>
      )}
      {composing ? (
        // ② 이번 1688 주문: 고른 쿠팡 발주 품목 + 같이 사는 다른 품목. 품목마다 총 주문 수량을 적고, 아래에서 주문완료.
        <div className="px-4 py-3 border-t border-blue-100 bg-blue-50/40">
          <div className="text-sm font-semibold text-blue-900 mb-1.5">
            ② 이번 1688 주문 <span className="text-xs font-normal text-gray-500">· 실제로 주문한 총수량을 적어요(필요보다 많으면 남는 만큼이 여유)</span>
          </div>
          <OrderItemsEditor items={items} onChange={setItems} names={names} listId="hanjung-pending-names" imageOf={imageOf} />
          <div className="mt-2 pt-2 border-t border-blue-100">
            <div className="text-xs font-semibold text-gray-600 mb-1">부대비용 <span className="font-normal text-gray-400">· 알면 적어 두세요(도착 기록 때 채워져요)</span></div>
            <FeeInputs value={feeDraft} onChange={setFeeDraft} />
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 mt-3 pt-3 border-t border-blue-100">
            <label className="flex items-center gap-2 text-xs text-gray-600">
              고유번호
              <input
                value={codeDraft}
                onChange={e => setCodeDraft(e.target.value)}
                placeholder={nextHanjungCode(orders)}
                className="w-32 px-2 py-1 border border-gray-300 rounded font-mono text-sm bg-white"
              />
            </label>
            <button
              onClick={create}
              disabled={(!selected.length && !extraCount) || saving}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:bg-gray-300"
            >
              {saving ? '저장 중…' : `③ 주문완료 (발주 ${selected.length}줄${extraCount ? ` + 추가 ${extraCount}` : ''})`}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 border-t border-gray-100 text-xs text-gray-400">
          {pending.length ? '줄을 고르면 여기서 1688 주문 수량·금액을 적고 주문완료해요.' : '쿠팡발주확인 발송 목록에서 "한중"을 누르면 여기에 와요.'}
          <button
            onClick={() => setExtras([{ name: '', qty: '', need: 0, added: true, cost: '' }])}
            className="ml-auto px-2 py-0.5 border border-dashed border-gray-300 text-gray-500 rounded hover:bg-gray-50"
          >
            ＋ 쿠팡 발주 없이 품목만 주문
          </button>
        </div>
      )}
    </div>
  );
};

const HanjungOrderPage: React.FC = () => {
  const [orders, setOrders] = useState<HanjungOrder[]>([]);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<typeof TABS[number]['id']>('arriving');
  const [open, setOpen] = useState<string | null>(null);
  // 입고대기 수정 중인 건(새 고유번호·고친 줄들). 저장해야 반영된다.
  // items: 품목별 총 주문 수량(need는 그릴 때 남은 쿠팡 줄로 다시 센다).
  const [edit, setEdit] = useState<{ code: string; newCode: string; lines: HanjungLine[]; items: OrderItem[]; fees: FeeDraft } | null>(null);
  const productNames = useProductNames(orders);
  // 도착(수입입고)을 적고 있는 건. 머리줄의 "📦 도착 기록"을 누르면 펼쳐서 입력 칸을 띄운다.
  const [receiving, setReceiving] = useState<string | null>(null);
  // 펼친 건 안에서 더 펼친 칸(쿠팡 발주 목록·도착 기록·쿠팡 입고). 기본은 접어서 상품표만 보이게 한다.
  const [folds, setFolds] = useState<Set<string>>(new Set());
  const foldOpen = (k: string) => folds.has(k);
  const toggleFold = (k: string) => setFolds(prev => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });
  const foldHead = (k: string, title: string, summary: string) => (
    <button
      onClick={() => toggleFold(k)}
      className="w-full flex items-center gap-2 text-left text-xs py-1.5 px-2 rounded-lg hover:bg-gray-50"
    >
      <span className="text-gray-400 w-3">{foldOpen(k) ? '▾' : '▸'}</span>
      <span className="font-semibold text-gray-600">{title}</span>
      <span className="text-gray-400">{summary}</span>
    </button>
  );
  const imageOf = useProductImage();

  const [receives, setReceives] = useState<ReceiveRow[]>([]);

  useEffect(() => subscribeHanjung(setOrders), []);

  const ordersRef = React.useRef(orders);
  ordersRef.current = orders;
  // 자동 준비됨 체크가 생기기 전에 도착한 한중발주: 도착한 만큼 배정 줄을 한 번만 준비됨으로 체크한다.
  // (그 뒤로는 도착 기록을 저장할 때 체크한다. 사람이 일부러 푼 체크를 매번 다시 켜지 않게 한 번만.)
  useEffect(() => {
    orders
      .filter(o => o.receipts.length && !o.autoReadyAt)
      .forEach(o => {
        markArrivedLinesReady(o)
          .then(() => saveHanjungOrder({ ...o, autoReadyAt: Date.now() }))
          .catch(err => console.error('도착 준비됨 체크 실패:', err));
      });
  }, [orders]);

  // 같은 상품으로 연결해 둔 이름이 한중발주에 예전 이름으로 남아 있으면 쿠팡 발주 이름으로 맞춰 저장한다.
  useEffect(() => {
    const fix = ordersNeedingAliasRename(orders);
    fix.forEach(o => saveHanjungOrder(o).catch(err => console.error('같은 상품 이름 맞추기 실패:', err)));
  }, [orders]);
  // 뺀 줄을 대기로 돌릴 때 같은 줄의 나머지가 이미 대기에 있는지 보려고 대기도 지켜본다.
  const queueRef = React.useRef<HanjungQueueItem[]>([]);
  useEffect(() => subscribeHanjungQueue(q => { queueRef.current = q; }), []);
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

  const stages = useMemo(() => new Map(orders.map(o => [o.code, stageOf(o, settlementOf(o, receives).qty)])), [orders, receives]);
  const tabCount = (id: typeof tab) => orders.filter(o => TABS.find(t => t.id === id)!.has(stages.get(o.code)!)).length;
  // 검색하면 탭과 상관없이 전체에서 찾는다.
  const list = useMemo(() => {
    const k = search.trim().toLowerCase();
    const inTab = TABS.find(t => t.id === tab)!.has;
    return orders.filter(o => k
      ? o.code.toLowerCase().includes(k) || o.lines.some(l => l.상품이름.toLowerCase().includes(k) || l.발주번호.includes(k))
      : inTab(stages.get(o.code)!)
    );
  }, [orders, search, tab, stages]);

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

  // 도착 안 한 것 정리: 일부만 오고 나머지는 다음 한중발주로 새로 주문할 때. 이 건은 도착한 만큼으로 마무리하고,
  // 도착 못 한 만큼의 쿠팡 줄 배정은
  //  1) 사무실 여유(다른 한중발주에 도착해 남은 것)로 먼저 채우고(자동),
  //  2) 그래도 모자라면 같은 상품이 다 도착한 한중발주의 더 늦은 쿠팡 줄 배정을 가져올지 묻고(그 늦은 줄이 대신 대기로),
  //  3) 남은 것은 발주 대기로 돌린다(다음 한중발주를 대기에서 만들면 그대로 따라간다).
  // 쉽먼트로 넘어간 줄은 건드리지 않는다. 준비됨은 실제 물건으로 다 채워진 줄만 켜고, 배정을 내준 줄은 끈다.
  const ready = useReady();
  const shipBatches = useShipLock();
  useEffect(() => { startLines(); }, []);
  const handleCloseShort = async (o: HanjungOrder) => {
    const { order: closed, releases } = closeShortOrder(o);
    if (!releases.length) return;
    // 쉽먼트(출고)로 넘어간 쿠팡 줄. 목록을 아직 못 받았으면 가져오기는 하지 않는다(묵은 목록으로 옮기면 안 되므로).
    const canSwap = isLinesReady();
    const skipKeys = lockedLineKeys(shipBatches);
    const keyOf = (l: FillLine) => reservationKey({ 발주번호: l.발주번호, 상품이름: l.상품이름, 확정수량: l.확정수량, 입고예정일: normalizeDateValue(l.입고예정일) } as OrderRow);
    const opts = { skipKeys, keyOf };
    const base = planShortFill(o, closed, releases, orders, { ...opts, swap: false });
    const withSwap = canSwap ? planShortFill(o, closed, releases, orders, { ...opts, swap: true }) : base;
    const day = (d: string) => `${Number(d.slice(4, 6))}/${Number(d.slice(6, 8))}`;

    const lines = releases.map(r => {
      const back = r.released.reduce((n, x) => n + x.qty, 0);
      return `· ${r.상품이름}: 도착 ${r.received}/${r.ordered}${back ? ` → 못 받은 쿠팡 배정 ${back}개` : ''}`;
    });
    const spare = base.spareFills.map(f => `· ${day(f.line.입고예정일)} 발주 ${f.line.발주번호} ${f.line.상품이름} ${f.qty}개 ← ${f.arrived ? '도착한' : '오는 중인'} 여유(${f.code})`);
    const left = base.queue.map(q => `· ${day(q.입고예정일)} 발주 ${q.발주번호} ${q.상품이름} ${q.qty}개`);
    if (!confirm(
      `${o.code}를 도착한 만큼으로 마무리할까요?\n\n${lines.join('\n')}` +
      (spare.length ? `\n\n여유분으로 채워요:\n${spare.join('\n')}` : '') +
      (left.length ? `\n\n발주 대기로 가요(다음 한중발주로 주문):\n${left.join('\n')}` : '') +
      (!canSwap ? '\n\n⚠ 발주 목록을 아직 다 못 받아서 늦은 발주에서 옮기기는 이번엔 안 해요. 잠시 뒤 다시 눌러 주세요.'
        : !withSwap.swaps.length && withSwap.notes.length ? `\n\n늦은 발주에서 옮길 수 있는 게 없어요:\n${withSwap.notes.map(n => `· ${n}`).join('\n')}` : ''),
    )) return;

    let plan: FillPlan = base;
    if (withSwap.swaps.length) {
      const sw = withSwap.swaps.map(x => `· ${x.to.상품이름} ${x.qty}개: ${day(x.from.입고예정일)} 발주 ${x.from.발주번호} → ${day(x.to.입고예정일)} 발주 ${x.to.발주번호} (${x.code} · ${x.arrived ? '도착분' : '오는 중'})`);
      if (confirm(
        `자리를 바꿀까요?\n급한 발주가 물건을 받고, 늦은 발주는 다음 주문으로 가요.\n\n${sw.join('\n')}` +
        (withSwap.notes.length ? `\n\n그래도 대기로 가는 것:\n${withSwap.notes.map(n => `· ${n}`).join('\n')}` : '') +
        `\n\n(발송완료된 발주는 건드리지 않아요. 취소를 누르면 옮기지 않고 앞 내용대로만 해요.)`,
      )) plan = withSwap;
    }

    const toRow = (q: FillLine & { qty: number }): QueueRow => ({
      발주번호: q.발주번호, 물류센터: q.물류센터, 상품이름: q.상품이름, 확정수량: q.확정수량,
      입고예정일: normalizeDateValue(q.입고예정일), 메모: '', 쉼먼트: '',
      ...(q.qty !== q.확정수량 ? { 배정: q.qty } : {}),
    });
    const rows = plan.queue.map(toRow);
    const keys = rows.map(r => hanjungQueueKey(r));
    const beforeQueue = queueRef.current.filter(q => keys.includes(q.key));
    const beforeOrders = plan.orders.map(x => orders.find(y => y.code === x.code)!).filter(Boolean);
    const rk = (l: FillLine) => ({ 발주번호: l.발주번호, 상품이름: l.상품이름, 확정수량: l.확정수량 });
    // 되돌릴 때 원래대로 돌리려고, 바꾸기 전 준비됨 상태를 적어 둔다.
    const wasOn = plan.readyOff.filter(l => ready.isReady(rk(l)));
    const wasOff = plan.readyOn.filter(l => !ready.isReady(rk(l)));
    const run = async () => {
      await saveHanjungOrder(closed);
      for (const x of plan.orders) await saveHanjungOrder(x);
      if (rows.length) await returnToHanjungQueue(rows, queueRef.current);
      if (plan.readyOff.length) await ready.setReady(plan.readyOff.map(rk), false);
      if (plan.readyOn.length) await ready.setReady(plan.readyOn.map(rk), true);
    };
    try {
      await run();
    } catch (err: any) {
      alert(`정리 실패: ${err?.message || err}`);
      return;
    }
    record({
      label: `${o.code} 도착 안 한 것 정리`,
      undo: async () => {
        await saveHanjungOrder(o);
        for (const x of beforeOrders) await saveHanjungOrder(x);
        if (keys.length) await removeFromHanjungQueue(keys);
        if (beforeQueue.length) await addToHanjungQueue(beforeQueue.map(queueItemToRow), []);
        if (wasOn.length) await ready.setReady(wasOn.map(rk), true);
        if (wasOff.length) await ready.setReady(wasOff.map(rk), false);
      },
      redo: run,
    });
  };

  // 입고 대기(아직 수입입고 기록이 없는 건)를 취소한다: 한중발주를 지우고 그 줄들을 다시 "발주 대기"로 돌린다.
  const handleCancel = async (o: HanjungOrder) => {
    if (o.receipts.length) return;
    if (!confirm(`한중발주 ${o.code}의 주문을 취소할까요?\n상품 ${o.lines.length}줄이 다시 발주 대기로 돌아가요.`)) return;
    const rows: QueueRow[] = o.lines.map(l => ({
      발주번호: l.발주번호, 물류센터: l.물류센터, 상품이름: l.상품이름, 확정수량: l.확정수량,
      입고예정일: normalizeDateValue(l.입고예정일), 메모: '', 쉼먼트: '',
      ...(l.배정 != null ? { 배정: l.배정 } : {}),
    }));
    const keys = rows.map(r => hanjungQueueKey(r));
    // 되돌릴 때 대기를 원래대로 돌리려고, 취소 전 대기 줄(같은 줄의 나머지)을 기억해 둔다.
    const before = queueRef.current.filter(q => keys.includes(q.key));
    const cancel = () => deleteHanjungOrder(o.code)
      .then(() => returnToHanjungQueue(rows, queueRef.current))
      .then(() => setReservationMemo(rows, '예약'));
    try {
      await cancel();
    } catch (err: any) {
      alert(`취소 실패: ${err?.message || err}`);
      return;
    }
    record({
      label: `${o.code} 주문 취소`,
      undo: () => saveHanjungOrder(o)
        .then(() => removeFromHanjungQueue(keys))
        .then(() => (before.length ? addToHanjungQueue(before.map(queueItemToRow), []) : 0))
        .then(() => setReservationMemo(rows, `예약 ${o.code}`)),
      redo: cancel,
    });
  };

  // 수정 중인 품목에 쿠팡 필요 수량(남은 연결 줄의 합)을 채운다. 연결 줄이 있는 품목은 이름을 못 바꾼다.
  const editItems = (e: { lines: HanjungLine[]; items: OrderItem[] }): OrderItem[] => {
    const needOf = (n: string) => n.trim() ? e.lines.filter(l => sameName(l.상품이름, n)).reduce((sum, l) => sum + lineAlloc(l), 0) : 0;
    const listed = new Set(e.items.map(it => nameKey(it.name)));
    // 연결 줄은 있는데 품목 칸에 없는 상품(옛 데이터)도 보이게 한다.
    const missing = Array.from(new Set(e.lines.map(l => l.상품이름))).filter(n => !listed.has(nameKey(n)))
      .map(n => ({ name: n, qty: String(needOf(n)), need: 0, added: false }));
    return [...e.items, ...missing].map(it => {
      const need = needOf(it.name);
      return { ...it, need, added: need > 0 ? false : it.added || true };
    });
  };

  // 고유번호(발주번호)만 바꾸기. 상태와 상관없이(도착·정산된 건도) 번호를 누르면 바꿀 수 있다.
  // 문서 id가 번호라 새 번호로 저장하고 옛 번호는 지운다. 예약 메모("예약 H…")도 따라 바꾼다.
  const renameCode = async (o: HanjungOrder) => {
    const input = prompt(`${o.code}의 새 번호`, o.code);
    const code = input?.trim();
    if (!code || code === o.code) return;
    if (/[\/]/.test(code)) return alert('번호에는 / 를 쓸 수 없어요.');
    if (ordersRef.current.some(x => x.code === code)) return alert(`번호 ${code}는 이미 있어요.`);
    const rows = o.lines.map(l => ({ 발주번호: l.발주번호, 상품이름: l.상품이름, 확정수량: l.확정수량, 입고예정일: l.입고예정일 } as OrderRow));
    const move = async (from: string, to: string) => {
      const cur = ordersRef.current.find(x => x.code === from) || { ...o, code: from };
      await saveHanjungOrder({ ...cur, code: to });
      await deleteHanjungOrder(from);
      await setReservationMemo(rows, `예약 ${to}`);
    };
    try {
      await move(o.code, code);
    } catch (err: any) {
      alert(`저장 실패: ${err?.message || err}`);
      return;
    }
    if (open === o.code) setOpen(code);
    record({ label: `${o.code} → ${code}`, undo: () => move(code, o.code), redo: () => move(o.code, code) });
  };

  const startEdit = (o: HanjungOrder) => {
    setOpen(o.code);
    const names = productSummary(o).map(p => p.상품이름);
    setEdit({
      code: o.code, newCode: o.code, lines: o.lines.map(l => ({ ...l })),
      items: names.map(n => ({ name: n, qty: String(productOrderQty(o, n)), need: 0, added: false, cost: productUnitCost(o, n) ? String(Math.round(productUnitCost(o, n) * productOrderQty(o, n))) : '' })),
      fees: Object.fromEntries(Object.entries(o.fees || {}).map(([k, v]) => [k, String(v)])) as FeeDraft,
    });
  };

  // 입고대기 수정 저장: 고유번호(H…)를 바꾸고, 상품별 주문 수량을 적고, 뺀 줄은 다시 "발주 대기"로 돌린다.
  // 줄을 빼도 1688에 산 수량(주문 수량)은 그대로라 그만큼 여유가 늘어난다. 안 샀으면 주문 수량도 줄이면 된다.
  // 고유번호가 문서 id라 번호가 바뀌면 새 번호로 저장하고 옛 번호는 지운다. 예약 메모("예약 H…")도 따라 바꾼다.
  const saveEdit = async (o: HanjungOrder) => {
    if (!edit || edit.code !== o.code) return;
    // 쿠팡 발주 줄도, 주문 품목도 하나도 안 남으면 그 건을 취소하는 것과 같다(추가 품목만 있는 건은 그대로 저장).
    if (!edit.lines.length && !editItems(edit).some(it => it.name.trim() && itemQty(it) > 0)) {
      setEdit(null);
      return handleCancel(o);
    }
    const code = edit.newCode.trim();
    if (!code) return alert('고유번호를 적어 주세요.');
    if (/[\/]/.test(code)) return alert('고유번호에는 / 를 쓸 수 없어요.');
    if (code !== o.code && ordersRef.current.some(x => x.code === code)) return alert(`고유번호 ${code}는 이미 있어요.`);

    const kept = new Set(edit.lines.map(l => l.key));
    const toRow = (l: HanjungLine): QueueRow => ({
      발주번호: l.발주번호, 물류센터: l.물류센터, 상품이름: l.상품이름, 확정수량: l.확정수량,
      입고예정일: normalizeDateValue(l.입고예정일), 메모: '', 쉼먼트: '',
      ...(l.배정 != null ? { 배정: l.배정 } : {}),
    });
    const removedKeys = o.lines.filter(l => !kept.has(l.key)).map(l => hanjungQueueKey(l));
    const queueBefore = queueRef.current.filter(q => removedKeys.includes(q.key));
    const removedRows = o.lines.filter(l => !kept.has(l.key)).map(toRow);
    const keptRows = edit.lines.map(toRow);
    // 줄마다 적던 예전 주문수량은 상품별 orderQty로 옮겼으니 뺀다.
    const lines = edit.lines.map(({ 주문수량, ...rest }) => rest);
    const items = editItems(edit);
    const short = items.filter(it => itemQty(it) < it.need);
    if (short.length) return alert(`주문 수량이 연결된 쿠팡 발주 수량보다 적어요:\n${short.map(it => `${it.name} (쿠팡 ${it.need})`).join('\n')}`);
    const orderQty = itemsToOrderQty(items.filter(it => itemQty(it) > 0 || it.need > 0));
    const unitCost = itemsToUnitCost(items);
    const fees = feesToNumbers(edit.fees);

    // from 번호로 저장된 건을 to 번호·ls 줄로 바꾼다. 그사이 붙은 수입입고 기록은 지금 저장된 것을 쓴다.
    const put = async (from: string, to: string, ls: HanjungLine[], qty: Record<string, number> | undefined, cost: Record<string, number> | undefined, fee: HanjungOrder['fees'] | undefined) => {
      const cur = ordersRef.current.find(x => x.code === from) || o;
      const { orderQty: _old, unitCost: _oldCost, fees: _oldFees, ...base } = cur;
      await saveHanjungOrder({ ...base, code: to, lines: ls, ...(qty ? { orderQty: qty } : {}), ...(cost && Object.keys(cost).length ? { unitCost: cost } : {}), ...(fee && Object.keys(fee).length ? { fees: fee } : {}) });
      if (from !== to) await deleteHanjungOrder(from);
    };
    const apply = async () => {
      await put(o.code, code, lines, orderQty, unitCost, fees);
      if (code !== o.code) await setReservationMemo(keptRows, `예약 ${code}`);
      if (removedRows.length) {
        await returnToHanjungQueue(removedRows, queueRef.current);
        await setReservationMemo(removedRows, '예약');
      }
    };
    try {
      await apply();
    } catch (err: any) {
      alert(`저장 실패: ${err?.message || err}`);
      return;
    }
    setEdit(null);
    if (open === o.code) setOpen(code);
    record({
      label: `${o.code} 수정`,
      undo: async () => {
        await put(code, o.code, o.lines, o.orderQty, o.unitCost, o.fees);
        await setReservationMemo([...keptRows, ...removedRows], `예약 ${o.code}`);
        if (removedRows.length) await removeFromHanjungQueue(removedKeys);
        if (queueBefore.length) await addToHanjungQueue(queueBefore.map(queueItemToRow), []);
      },
      redo: apply,
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
    // 가로로 길면 눈을 많이 움직여야 해서 화면 폭을 줄인다(왼쪽 정렬).
    <div className="p-4 sm:p-6 lg:p-8 text-gray-800 max-w-[1000px]">
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
          <p className="text-sm text-gray-500">① 줄 고르기 → ② 1688 주문 적기 → ③ 주문완료 → 물건이 오면 📦 도착 기록. 쿠팡 입고(정산)는 자동으로 모아져요.</p>
        </div>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="고유번호·상품명·발주번호 검색"
          className="w-full sm:w-72 px-3 py-1.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
      </div>

      <PendingPanel orders={orders} onRecord={record} />

      {!search.trim() && (
        <div className="flex gap-1 mb-3 border-b border-gray-200">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-2 text-sm -mb-px border-b-2 ${tab === t.id ? 'border-blue-600 text-blue-700 font-semibold' : 'border-transparent text-gray-500 hover:text-gray-800'}`}
            >
              {t.text} <span className="text-xs text-gray-400">{tabCount(t.id)}</span>
            </button>
          ))}
        </div>
      )}

      {!list.length && (
        <div className="bg-white border border-dashed border-gray-200 rounded-xl py-16 text-center text-gray-400 text-sm">
          {search.trim() ? '검색 결과가 없어요.' : orders.length ? '이 단계의 한중발주가 없어요.' : '아직 한중발주가 없어요. 위 발주 대기에서 골라 주문완료하면 여기에 생겨요.'}
        </div>
      )}

      <div className="space-y-3">
        {list.map(o => {
          const t = orderTotals(o);
          const st = STAGE_LABEL[stages.get(o.code) || 'ordered'];
          const products = productSummary(o);
          const isOpen = open === o.code;
          const settle = settlementOf(o, receives);
          const allocated = products.reduce((sum, p) => sum + p.allocated, 0);
          const rate = t.received > 0 ? Math.round((settle.qty / t.received) * 100) : null;
          const profit = settle.supply - t.totalCost;
          // 입고상세내역의 지급일 = 정산예정일.
          const payDays = Array.from(new Set(settle.rows.map(r => String(r.payDate || '').slice(0, 10)).filter(Boolean))).sort();
          return (
            <div key={o.code} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              {/* 머리줄: 번호 · 사진 · 단계(주문 → 도착 → 쿠팡) · 지금 할 일 하나 · 차익. 나머지 버튼과 숫자는 펼치면 보인다. */}
              <div className="flex flex-wrap items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50" onClick={() => setOpen(isOpen ? null : o.code)}>
                <div className="w-28 flex-shrink-0">
                  <button
                    onClick={e => { e.stopPropagation(); renameCode(o); }}
                    title={`${o.code} · 눌러서 번호 바꾸기`}
                    className="group block max-w-full font-mono font-bold text-gray-900 truncate text-left hover:text-blue-600"
                  >
                    {o.code}<span className="ml-1 text-xs text-gray-300 group-hover:text-blue-400">✎</span>
                  </button>
                  <div className="text-[11px] text-gray-400 truncate" title={o.memo || undefined}>
                    {new Date(o.createdAt).toLocaleDateString('ko-KR')}{o.memo && <> · 📝 {o.memo}</>}
                  </div>
                </div>
                {/* 품목 사진(앞에서 5개까지) */}
                <span className="inline-flex items-center gap-1 w-[176px] flex-shrink-0">
                  {products.slice(0, 5).map(p => <ProductThumb key={p.상품이름} url={imageOf(p.상품이름)} size={30} title={`${p.상품이름} · 주문 ${p.ordered}개`} />)}
                  {products.length > 5 && <span className="text-xs text-gray-400">+{products.length - 5}</span>}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded-full border whitespace-nowrap ${st.cls}`}>{st.text}</span>
                <span className="flex items-center gap-1 text-xs">
                  <Step label="도착" done={t.received} total={t.ordered} />
                  {allocated > 0 && <><span className="text-gray-300">›</span><Step label="쿠팡" done={settle.qty} total={allocated} /></>}
                </span>
                {t.status !== 'done' && (
                  <button
                    onClick={e => { e.stopPropagation(); setOpen(o.code); setReceiving(receiving === o.code ? null : o.code); }}
                    title="1688 물건이 사무실에 도착했으면 수량·금액·비용을 적어요(나눠서 오면 올 때마다)"
                    className={`text-xs px-2.5 py-1 rounded-lg font-semibold border ${receiving === o.code ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-emerald-300 text-emerald-700 bg-white hover:bg-emerald-50'}`}
                  >
                    📦 도착 기록
                  </button>
                )}
                {t.status === 'partial' && (
                  <button
                    onClick={e => { e.stopPropagation(); handleCloseShort(o); }}
                    title="나머지는 더 오지 않고 다음 한중발주로 새로 주문할 때: 이 건을 도착한 만큼으로 마무리하고, 도착 못 한 쿠팡 배정은 발주 대기로 돌려요"
                    className="text-xs px-2.5 py-1 rounded-lg font-semibold border border-gray-300 text-gray-600 bg-white hover:bg-gray-50"
                  >
                    남은 것 정리
                  </button>
                )}
                <span className="ml-auto text-sm text-right whitespace-nowrap">
                  {settle.qty > 0 && t.totalCost > 0
                    ? <>차익 <b className={profit >= 0 ? 'text-emerald-600' : 'text-red-500'} title="정산 공급가(부가세 제외) − 총원가">{won(profit)}</b></>
                    : t.totalCost > 0 ? <span className="text-gray-500">원가 <b>{won(t.totalCost)}</b></span> : null}
                </span>
                <span className="text-gray-300">{isOpen ? '▲' : '▼'}</span>
              </div>

              {isOpen && (
                <div className="border-t border-gray-100 px-4 py-3 space-y-4">
                  {receiving === o.code && <ReceiptForm order={o} onDone={() => setReceiving(null)} />}
                  {/* 이 건의 돈: 원가 → 정산 → 차익 */}
                  {(t.totalCost > 0 || settle.qty > 0) && (
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
                      {t.totalCost > 0 && <span>총원가 <b>{won(t.totalCost)}</b></span>}
                      {settle.qty > 0 && <span>쿠팡입고 <b>{settle.qty}</b>개 · 정산 <b>{won(settle.total)}</b></span>}
                      {payDays.length > 0 && <span title={`정산예정일(입고상세내역의 지급일): ${payDays.join(', ')}`}>정산예정 <b>{payDays.slice(0, 2).map(d => d.slice(5).replace('-', '/')).join(', ')}{payDays.length > 2 ? ' 외' : ''}</b></span>}
                      {rate != null && <span>정산률 <b className={rate >= 100 ? 'text-emerald-600' : 'text-amber-600'}>{rate}%</b></span>}
                      {settle.qty > 0 && t.totalCost > 0 && <span>차익 <b className={profit >= 0 ? 'text-emerald-600' : 'text-red-500'} title="정산 공급가(부가세 제외) − 총원가">{won(profit)}</b></span>}
                    </div>
                  )}
                  <div className="overflow-x-auto">
                  {/* 상품마다 일의 단계대로 세 칸: 주문(쿠팡 몫·여유) → 사무실 도착 → 쿠팡 입고(정산). 숫자는 "한 것 / 할 것"과 막대로. */}
                  <table className="text-[15px]">
                    <thead className="text-sm text-gray-500">
                      <tr>
                        <th className="text-left font-medium py-1 pr-3">상품</th>
                        <th className="w-28 text-left font-medium pl-3" title="1688에 주문한 수량. 배정 = 쿠팡 발주에 연결한 수량, 여유 = 남는 것(다음 발주에 씀)">주문</th>
                        <th className="w-28 text-left font-medium pl-3" title="사무실에 도착한 수량 / 주문 수량">사무실 도착</th>
                        <th className="w-28 text-left font-medium pl-3" title="쿠팡 물류센터에 입고(정산)된 수량 / 배정 수량">쿠팡 입고</th>
                      </tr>
                    </thead>
                    <tbody>
                      {products.map(p => {
                        const coupangIn = settle.byProduct.get(p.상품이름) || 0;
                        const bar = (done: number, total: number) => {
                          const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
                          const color = total > 0 && done >= total ? 'bg-emerald-500' : done > 0 ? 'bg-amber-400' : 'bg-gray-200';
                          return (
                            <div className="pl-3">
                              <div className="font-mono text-sm"><b className={total > 0 && done >= total ? 'text-emerald-600' : done > 0 ? 'text-amber-600' : 'text-gray-400'}>{done}</b><span className="text-gray-400"> / {total}</span></div>
                              <div className="h-1 mt-0.5 rounded-full bg-gray-100 overflow-hidden w-16"><div className={`h-full ${color}`} style={{ width: `${pct}%` }} /></div>
                            </div>
                          );
                        };
                        return (
                          <tr key={p.상품이름} className="border-t border-gray-100">
                            <td className="py-1.5 pr-3"><span className="inline-flex items-center gap-2 max-w-[22rem]"><ProductThumb url={imageOf(p.상품이름)} size={26} /><span className="truncate" title={p.상품이름}>{p.상품이름.replace(/^주노엘\s*/, '')}</span></span></td>
                            <td className="pl-3">
                              <div className="font-mono font-bold text-gray-900 text-sm whitespace-nowrap">{p.ordered}{productUnitCost(o, p.상품이름) > 0 && <span className="ml-1.5 text-[11px] font-normal text-gray-400">· {Math.round(productUnitCost(o, p.상품이름) * p.ordered).toLocaleString()}원</span>}</div>
                              <div className="text-xs text-gray-400 whitespace-nowrap">배정 {p.allocated}{p.spare > 0 && <> · <span className="text-emerald-600 font-semibold">여유 {p.spare}</span></>}</div>
                            </td>
                            <td>{bar(p.received, p.ordered)}</td>
                            <td>{p.allocated > 0 ? bar(coupangIn, p.allocated) : <span className="pl-3 text-xs text-gray-300">배정 없음</span>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  </div>

                  <div className="border-t border-gray-100 pt-1 space-y-0.5">
                    {edit?.code !== o.code && foldHead(`${o.code}|lines`, `쿠팡 발주 ${o.lines.length}건`, Array.from(new Set(o.lines.map(l => l.물류센터))).slice(0, 4).join(' · '))}
                    {edit?.code === o.code ? (
                      <div className="border border-blue-200 bg-blue-50/40 rounded-lg p-2 space-y-1">
                        {/* 번호는 머리줄의 번호(✎)를 눌러 바꾼다. */}
                        <div className="text-xs font-semibold text-gray-500 pt-1">1688 주문 품목 · 총수량</div>
                        <OrderItemsEditor
                          items={editItems(edit)}
                          onChange={next => setEdit(cur => cur && { ...cur, items: next })}
                          names={productNames}
                          imageOf={imageOf}
                          listId={`hanjung-edit-names-${o.code}`}
                        />
                        <div className="text-xs font-semibold text-gray-500 pt-2">부대비용(예상)</div>
                        <FeeInputs value={edit.fees} onChange={f => setEdit(cur => cur && { ...cur, fees: f })} />
                        <div className="text-xs font-semibold text-gray-500 pt-2">연결된 쿠팡 발주</div>
                        {edit.lines.map((l, i) => (
                          <div key={l.key} className="flex items-center gap-2 text-xs text-gray-600">
                            <span className="truncate flex-1">
                              <span className="font-mono text-gray-400">{l.발주번호}</span> · {l.물류센터} · {ymdText(l.입고예정일)} · {l.상품이름}
                            </span>
                            <span className="font-mono">{lineAlloc(l)}개{lineAlloc(l) !== l.확정수량 && <span className="text-gray-400"> /{l.확정수량}</span>}</span>
                            <button
                              onClick={() => setEdit(cur => cur && { ...cur, lines: cur.lines.filter((_, j) => j !== i) })}
                              title="이 줄을 빼요(저장하면 발주 대기로 돌아가요)"
                              className="px-1.5 py-0.5 border border-red-200 text-red-500 rounded bg-white hover:bg-red-50"
                            >
                              빼기
                            </button>
                          </div>
                        ))}
                        {edit.lines.length < o.lines.length && (
                          <div className="text-xs text-amber-700">뺀 줄 {o.lines.length - edit.lines.length}개는 저장하면 발주 대기로 돌아가요. 1688에서 안 샀으면 위 주문 수량도 줄여 주세요.</div>
                        )}
                        <div className="flex gap-2 justify-end pt-1">
                          <button onClick={() => setEdit(null)} className="px-3 py-1 text-xs border border-gray-200 rounded-lg bg-white hover:bg-gray-50">취소</button>
                          <button onClick={() => saveEdit(o)} className="px-3 py-1 text-xs rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700">저장</button>
                        </div>
                      </div>
                    ) : foldOpen(`${o.code}|lines`) && (
                      <div className="pl-7 pb-1 overflow-x-auto">
                        {/* 쿠팡 발주 줄: 발주번호 · 센터 · 입고예정일 · 상품 · 배정 수량을 칸 맞춰서. 같은 발주번호끼리 붙여 둔다. */}
                        <table className="w-full text-xs">
                          <thead className="text-gray-400">
                            <tr><th className="text-left font-medium py-1 w-24">발주번호</th><th className="text-left font-medium w-24">센터</th><th className="text-left font-medium w-20">입고예정</th><th className="text-left font-medium">상품</th><th className="text-right font-medium w-20">배정</th></tr>
                          </thead>
                          <tbody>
                            {[...o.lines].sort((a, b) => a.발주번호.localeCompare(b.발주번호)).map(l => (
                              <tr key={l.key} className="border-t border-gray-50">
                                <td className="py-1 font-mono text-gray-500">{l.발주번호}</td>
                                <td className="text-gray-600">{l.물류센터}</td>
                                <td className="text-gray-500">{ymdText(l.입고예정일)}</td>
                                <td className="text-gray-700 truncate max-w-[22rem]" title={l.상품이름}>{l.상품이름}</td>
                                <td className="text-right font-mono"><b>{lineAlloc(l)}</b>{lineAlloc(l) !== l.확정수량 && <span className="text-gray-400">/{l.확정수량}</span>}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* 도착한 상품 종류 수(건)와 개수 */}
                  {o.receipts.length > 0 && foldHead(`${o.code}|receipts`,
                    `도착 ${new Set(o.receipts.flatMap(r => r.items.filter(it => (Number(it.qty) || 0) > 0).map(it => it.상품이름))).size}건 · ${o.receipts.reduce((n, r) => n + r.items.reduce((m, it) => m + (Number(it.qty) || 0), 0), 0)}개`,
                    `총원가 ${won(t.totalCost)}`)}
                  {foldOpen(`${o.code}|receipts`) && <div className="pl-7"><ReceiptHistory order={o} /></div>}

                  {settle.rows.length > 0 && foldHead(`${o.code}|settle`, `쿠팡 입고 ${settle.rows.length}건`, `정산 ${won(settle.total)}`)}
                  {settle.rows.length > 0 && foldOpen(`${o.code}|settle`) && (
                    <div className="pl-7 overflow-x-auto">
                      {/* 쿠팡 입고(정산) 줄: 입고일 · 발주번호 · 상품 · 수량 · 정산 금액 · 지급일 */}
                      <table className="w-full text-xs">
                        <thead className="text-gray-400">
                          <tr><th className="text-left font-medium py-1 w-24">입고일</th><th className="text-left font-medium w-24">발주번호</th><th className="text-left font-medium">상품</th><th className="text-right font-medium w-14">수량</th><th className="text-right font-medium w-24">정산</th><th className="text-right font-medium w-24">지급일</th></tr>
                        </thead>
                        <tbody>
                          {settle.rows.map(r => (
                            <tr key={r.key} className="border-t border-gray-50">
                              <td className="py-1 font-mono text-gray-500">{r.date.slice(0, 10)}</td>
                              <td className="font-mono text-gray-500">{r.발주번호}</td>
                              <td className="text-gray-700 truncate max-w-[22rem]" title={r.skuName}>{r.skuName}</td>
                              <td className="text-right font-mono">{sign(r) * r.qty}</td>
                              <td className="text-right font-mono">{won(sign(r) * r.total)}</td>
                              <td className="text-right font-mono text-gray-500">{String(r.payDate || '').slice(0, 10) || '-'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* 수정 중에는 숨긴다(품목 빼기 ✕와 헷갈려 한중발주 전체를 지우는 일이 없게). */}
                  {edit?.code !== o.code && (
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => editMemo(o)} className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg hover:bg-gray-50">메모</button>
                      {!o.receipts.length && (
                        <button
                          onClick={() => startEdit(o)}
                          title="주문 수량·금액을 고치거나 상품 줄을 빼요(뺀 줄은 발주 대기로 돌아가요)"
                          className="px-3 py-1.5 text-xs border border-blue-200 text-blue-600 rounded-lg hover:bg-blue-50"
                        >
                          수정
                        </button>
                      )}
                      {/* 도착 전이면 "주문 취소"(줄을 발주 대기로 돌림), 도착 기록이 있으면 "삭제". */}
                      {!o.receipts.length ? (
                        <button onClick={() => handleCancel(o)} title="1688 주문을 취소했으면 누르세요. 이 건을 지우고 상품 줄을 다시 발주 대기로 돌립니다." className="px-3 py-1.5 text-xs border border-red-200 text-red-600 rounded-lg hover:bg-red-50">주문 취소</button>
                      ) : (
                        <button onClick={() => handleDelete(o)} title="이 한중발주 건 전체를 지워요" className="px-3 py-1.5 text-xs border border-red-200 text-red-600 rounded-lg hover:bg-red-50">한중발주 삭제</button>
                      )}
                    </div>
                  )}
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
