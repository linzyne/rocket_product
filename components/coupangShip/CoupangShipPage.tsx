import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ProductQtySummary from '../coupangOrder/components/ProductQtySummary';
import { useIsMobile } from '../../utils/useIsMobile';
import { ShipOut, setShipOutDate, subscribeShipOuts, deleteShipOut, restoreShipOut, restoreOrders, updateShipOutLine, markShipOuts, applyShipOutRequest, snapshotShipOuts, restoreShipSnapshot, sameSnapshot } from '../coupangOrder/data/shipOutStore';
import type { ShipSnapshot } from '../coupangOrder/data/shipOutStore';
import { dateKeyYMD } from '../coupangOrder/utils/dateUtils';
import OrderTable, { BoxPicker } from '../coupangOrder/components/OrderTable';
import { buildDisplayRows, parseBoxNo, isBoxSplit, parseBoxSplit, joinBoxSplit, expandBoxSplit } from '../coupangOrder/utils/dataProcessor';
import type { DisplayRow } from '../coupangOrder/utils/dataProcessor';
import { normalizeDateValue, ymdSortKey } from '../coupangOrder/utils/dateUtils';
import { printPanel } from '../coupangOrder/utils/printUtils';
import type { OrderRow, AddressEntry, SenderInfo } from '../coupangOrder/types';
import { shipmentCenters, totalBoxCount } from '../coupangOrder/utils/dataProcessor';
import { exportLotteExcel } from '../coupangOrder/utils/excelExport';
import { fillShubForm, dataUrlToBuffer } from '../coupangOrder/utils/shubForm';
import {
  loadLocalAddresses, loadLocalSender, subscribeShippingSettings, saveAddresses, saveSender,
} from '../coupangOrder/data/shippingSettingsStore';
import {
  ShipmentBatch, subscribeShipments, saveShipmentBatch, deleteShipmentBatch, batchId, fillWaybills, allBoxes, waybillForBox, retargetBatches,
} from '../../data/shipmentStore';
import AddressManager from '../coupangOrder/components/AddressManager';
import SenderManager from '../coupangOrder/components/SenderManager';
import ShipmentWaybillModal from '../coupangOrder/components/ShipmentWaybillModal';
import ShipmentList from '../coupangOrder/components/ShipmentList';
import { useHanjungBadge } from '../coupangOrder/data/useHanjungBadge';
import { useShipmentNoSync } from '../coupangOrder/data/useShipmentNoSync';
import { HanjungQueueItem, subscribeHanjungQueue, addToHanjungQueue, removeFromHanjungQueue, hanjungQueueKey, makePlaceLookup } from '../coupangOrder/data/hanjungQueueStore';
import { HanjungOrder, subscribeHanjung, saveHanjungOrder, freezeOrderQty, makeHanjungOfficeLookup, productSummary, sameName, orderQtyName, nameKey, isNotSame, rememberSameProduct } from '../../data/hanjungStore';
import { reservationKey } from '../coupangOrder/data/reservationStore';
import type { LineHanjung, HanjungChoice, HanjungAction, HanjungLink } from '../coupangOrder/components/OrderTable';
import { nameSimilarity } from '../../data/inventoryStore';
import { useReady } from '../coupangOrder/data/readyStore';

// 발주 > 쉽먼트생성. 쿠팡발주확인의 묶음 패널에서 "쉽먼트"를 누른 건들이 여기로 옮겨 온다.
// 화면 모양은 쿠팡발주확인과 같게: 왼쪽은 발주서 표, 오른쪽은 묶음(출고 건) 카드.
// 묶음 이름은 출고 건마다 겹칠 수 있어서, 표에는 출고번호(S260925-1)를 묶음 값으로 넣어 구분한다.
// 줄 하나를 가리키는 열쇠(박스 순서를 기억할 때 쓴다).
// 입고예정일은 저장본('2026-09-28')과 화면용(Date)이 섞여 있어 항상 'YYYY-MM-DD'로 맞춰 비교한다.
const lineKey = (l: { 발주번호: string; 상품이름: string; 확정수량: number | ''; 입고예정일: Date | string }) =>
  `${l.발주번호}│${l.상품이름}│${l.확정수량}│${dateKeyYMD(l.입고예정일)}`;

// 박스순 정렬용: 여러 박스로 나눈 줄은 첫 조각의 박스 번호로 센다.
const firstBoxNo = (value: string) =>
  (isBoxSplit(value) ? parseBoxSplit(value)[0]?.no : parseBoxNo(value)) ?? 9999;

// 표의 줄 → 원래 발주 줄(준비 체크는 이걸로 찾는다). 여러 박스로 나눈 줄은 원래 수량으로.
const lineOfRow = (row: DisplayRow) => ({
  발주번호: row._발주번호, 상품이름: row.상품이름,
  확정수량: row._조각 !== undefined ? (row._원수량 ?? row.확정수량) : row.확정수량,
});

// 표에서 덩어리 사이를 띄우는 흰 여백. 오른쪽 묶음 카드도 같은 간격을 쓴다.
const CHUNK_GAP = 26;
// 아직 쉽먼트를 안 끝낸 건의 색(끝난 건은 초록).
const PENDING_COLOR = '#6b7280'; // 회색 계열(눈에 덜 띄게)
// 박스 표시는 눈에 덜 띄게 회색(흰 바탕에 회색 테두리).
const PENDING_BOX = '#9ca3af';
// 묶음 카드의 "← 발주확인으로" · "발송대기로 →" 버튼(앞뒤 단계로 보내는 같은 모양).
const stageBtn = (done: boolean): React.CSSProperties => ({
  padding: '2px 8px', fontSize: 11, fontWeight: 700, borderRadius: 5, cursor: 'pointer',
  border: `1px solid ${done ? '#27ae60' : '#d1d5db'}`, background: done ? '#e8f8f0' : '#fff', color: done ? '#27ae60' : '#6b7280',
});

export default function CoupangShipPage({ onGoOrder }: { onGoOrder?: () => void } = {}) {
  const isMobile = useIsMobile();
  const [list, setList] = useState<ShipOut[]>([]);
  const hanjungBadge = useHanjungBadge();
  useShipmentNoSync();
  // 상품 줄 체크 메뉴의 "한중발주": 한중발주의 발주 대기에 담는다(같은 상품은 거기서 수량이 합쳐진다).
  const [hanjungQueue, setHanjungQueue] = useState<HanjungQueueItem[]>([]);
  const [hanjungOrders, setHanjungOrders] = useState<HanjungOrder[]>([]);
  useEffect(() => subscribeHanjungQueue(setHanjungQueue), []);
  useEffect(() => subscribeHanjung(setHanjungOrders), []);
  // 사무실 칸 = 한중으로 넉넉히 사 둔 여유(도착한 것 + 오는 중인 것).
  const officeQtyOf = useMemo(() => makeHanjungOfficeLookup(hanjungOrders), [hanjungOrders]);
  const queuedKeys = useMemo(() => new Set(hanjungQueue.map(q => q.key)), [hanjungQueue]);
  const placesOf = useMemo(() => makePlaceLookup(hanjungOrders, hanjungQueue), [hanjungOrders, hanjungQueue]);
  // 박스로 나눈 조각도 원래 한 줄로 본다(나누기 전 수량).
  const hanjungLineOf = (row: DisplayRow) => ({
    발주번호: row._발주번호, 물류센터: row._물류센터, 상품이름: row.상품이름,
    확정수량: row._조각 !== undefined ? (row._원수량 ?? row.확정수량) : row.확정수량,
    입고예정일: row._입고예정일, 메모: '', 쉼먼트: '',
  });
  // 체크 메뉴에 보일 것: 이 줄이 한중 어디에 몇 개 있는지 + 고를 수 있는 한중발주(이 상품의 주문·여유).
  //  · 이 상품이 있는 건: 여유가 남았거나, 아직 입고 전이거나(더 주문할 수 있음), 이 줄이 이미 들어 있는 건
  //  · 이 상품이 없는 건: 아직 입고 전인 건만(1688에 추가 주문해 넣는 경우)
  const hanjungOf = (row: DisplayRow): LineHanjung => {
    const line = hanjungLineOf(row);
    const places = placesOf(line);
    const choices: HanjungChoice[] = [];
    for (const o of hanjungOrders) {
      const p = productSummary(o).find(x => sameName(x.상품이름, line.상품이름));
      const placed = places.some(pl => pl.code === o.code);
      if (p && (p.spare > 0 || !o.receipts.length || placed)) {
        choices.push({ code: o.code, has: true, ordered: p.ordered, spare: p.spare, arrived: p.received > 0 });
      } else if (!p && !o.receipts.length) {
        choices.push({ code: o.code, has: false, ordered: 0, spare: 0, arrived: false });
      }
    }
    // 이름이 다르게 적힌 같은 상품 후보: 여유가 있고 쿠팡 발주 줄이 안 붙은 품목(직접 더한 품목), 비슷한 이름 순.
    const links: HanjungLink[] = [];
    for (const o of hanjungOrders) {
      for (const p of productSummary(o)) {
        if (p.spare <= 0 || p.allocated > 0 || sameName(p.상품이름, line.상품이름)) continue;
        links.push({ code: o.code, name: p.상품이름, ordered: p.ordered, spare: p.spare, arrived: p.received > 0 });
      }
    }
    links.sort((a, b) => nameSimilarity(b.name, line.상품이름) - nameSimilarity(a.name, line.상품이름));
    return { need: Number(line.확정수량) || 0, places, choices, links };
  };
  // 체크 메뉴에서 고른 대로 한중에 맡긴다. 먼저 이 줄을 있던 곳(한중발주·대기)에서 모두 떼고 새로 붙인다.
  // 줄을 떼도 1688에 산 수량(주문 수량)은 그대로라 그만큼 여유로 돌아간다.
  const setLineHanjung = async (row: DisplayRow, action: HanjungAction) => {
    const line = hanjungLineOf(row);
    const k = hanjungQueueKey(line);
    const name = line.상품이름;
    const need = Number(line.확정수량) || 0;
    const same = (l: { 발주번호: string; 상품이름: string; 확정수량: number }) => hanjungQueueKey(l) === k;
    try {
      // 1) 있던 한중발주에서 떼기
      const changed = new Map<string, HanjungOrder>();
      for (const o of hanjungOrders) {
        if (!o.lines.some(same)) continue;
        const lines = o.lines.filter(l => !same(l));
        const orderQty = freezeOrderQty(o, name);
        // 1688에서 안 샀으면 뗀 수량만큼 주문 수량도 줄인다(0이 되고 그 상품 줄도 없으면 품목에서 뺀다).
        // 같은 건에 다시 붙이는 경우(여유가 모자라 나누기 등)는 줄이지 않는다.
        const reattach = action.type === 'order' && action.code === o.code;
        if (action.release === 'shrink' && !reattach) {
          const freed = o.lines.filter(same).reduce((sum, l) => sum + (l.배정 ?? l.확정수량), 0);
          const qk = orderQtyName(orderQty, name);
          const left = Math.max(0, (orderQty[qk] || 0) - freed);
          if (left > 0 || lines.some(l => sameName(l.상품이름, name))) orderQty[qk] = left;
          else delete orderQty[qk];
        }
        changed.set(o.code, { ...o, orderQty, lines });
      }
      // 2) 고른 한중발주에 붙이기
      let toQueue = 0;
      if (action.type === 'queue') toQueue = need;
      if (action.type === 'order') {
        let base = changed.get(action.code) || hanjungOrders.find(o => o.code === action.code);
        if (!base) return;
        // 이름이 다르게 적힌 같은 상품에 연결: 그 품목 이름을 이 쿠팡 발주 상품 이름으로 바꾼다(수량은 그대로).
        if (action.linkFrom && base.orderQty && base.orderQty[action.linkFrom] != null) {
          const { [action.linkFrom]: q, ...rest } = base.orderQty;
          const k = orderQtyName(rest, name);
          base = { ...base, orderQty: { ...rest, [k]: (rest[k] || 0) + q } };
          // 수입입고에 적힌 이름도 같이 바꿔야 도착 수량이 맞는다.
          base = { ...base, receipts: base.receipts.map(r => ({ ...r, items: r.items.map(it => (it.상품이름 === action.linkFrom ? { ...it, 상품이름: name } : it)) })) };
        }
        if (action.linkFrom) {
          changed.set(base.code, base);
          // 다음부터는 묻지 않게 같은 상품이라고 기억해 둔다.
          rememberSameProduct(action.linkFrom, name, true).catch(() => undefined);
        }
        const p = productSummary(base).find(x => sameName(x.상품이름, name));
        const spare = p ? p.spare : 0;
        let orderQty = freezeOrderQty(base, name, need);
        let alloc = need;
        if (p && spare < need) {
          if (action.mode === 'split') {
            alloc = spare;
            toQueue = need - spare;
          } else if (action.mode === 'grow') {
            orderQty = { ...orderQty, [orderQtyName(orderQty, name)]: p.ordered + (need - spare) };
          }
        }
        if (alloc > 0) {
          changed.set(base.code, {
            ...base,
            orderQty,
            lines: [...base.lines, {
              key: reservationKey(line),
              발주번호: line.발주번호,
              물류센터: line.물류센터,
              상품이름: name,
              확정수량: need,
              입고예정일: dateKeyYMD(line.입고예정일).replace(/-/g, ''),
              ...(alloc !== need ? { 배정: alloc } : {}),
            }],
          });
        }
      }
      // 떼고 나서 품목이 하나도 안 남는 한중발주가 있으면 확인한다.
      const emptied = Array.from(changed.values()).filter(o => !o.lines.length && !Object.keys(o.orderQty || {}).length).map(o => o.code);
      if (emptied.length && !confirm(`${emptied.join(', ')}에 남는 품목이 없어요. 빈 한중발주가 돼요(한중발주 페이지에서 지울 수 있어요). 그래도 할까요?`)) return;
      for (const o of changed.values()) await saveHanjungOrder(o);
      // 3) 발주 대기: 있던 것은 지우고, 대기로 보낼 수량이 있으면 그만큼 다시 넣는다.
      if (queuedKeys.has(k)) await removeFromHanjungQueue([k]);
      if (toQueue > 0) await addToHanjungQueue([{ ...line, ...(toQueue !== need ? { 배정: toQueue } : {}) }], []);
    } catch (err: any) {
      alert(`한중발주 저장 실패: ${err?.message || err}`);
    }
  };
  const ready = useReady();
  // 준비 체크 한 줄: 쿠팡발주확인부터 쓰는 공통 기록 + 예전에 이 출고 건에 적어 둔 표시.
  const lineReady = (item: ShipOut | undefined, l: { 발주번호: string; 상품이름: string; 확정수량: number | '' }) =>
    ready.isReady(l, item?.readyKeys);
  const toggleLineReady = (item: ShipOut | undefined, l: { 발주번호: string; 상품이름: string; 확정수량: number | '' }, on: boolean) => {
    ready.setReady([l], on).catch(err => alert(`준비 체크 저장 실패: ${err instanceof Error ? err.message : String(err)}`));
    // 끌 때는 예전 방식으로 출고 건에 적혀 있던 표시도 지운다(안 그러면 계속 준비됨으로 보인다).
    if (!on && item?.readyKeys?.length) {
      const k = `${l.발주번호}│${l.상품이름}│${l.확정수량}`;
      if (item.readyKeys.includes(k)) markShipOuts([item.id], { readyKeys: item.readyKeys.filter(x => x !== k) });
    }
  };
  const [copied, setCopied] = useState('');
  const [opened, setOpened] = useState<Set<string>>(new Set());
  // 쉽먼트 완료한 건은 접어 두고, 펼친 것만 여기 적어 둔다.
  const [openDone, setOpenDone] = useState<Set<string>>(new Set());
  const toggleDoneOpen = (id: string) =>
    setOpenDone(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  // 되돌릴 발주서 고르기(발주확인의 묶기 체크 칸과 같은 자리).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // 발주확인 표와 똑같이 보이도록 사무실 재고 칸도 같이 띄운다.

  // 쉽먼트생성(롯데택배 예약 → 운송장 → 서허 양식)에 쓰는 것들. 예전에는 쿠팡발주확인에 있었지만
  // 출고 단계에서 하는 일이라 이 화면으로 옮겼다.
  const [addresses, setAddresses] = useState<AddressEntry[]>(loadLocalAddresses);
  const [sender, setSender] = useState<SenderInfo>(loadLocalSender);
  const [showAddressManager, setShowAddressManager] = useState(false);
  const [showSenderManager, setShowSenderManager] = useState(false);
  const [batches, setBatches] = useState<ShipmentBatch[]>([]);
  const [shubStatus, setShubStatus] = useState<string | null>(null);
  const [shubForm, setShubForm] = useState<{ batchId: string; name: string; dataUrl: string } | null>(null);
  const [shubBatch, setShubBatch] = useState<ShipmentBatch | null>(null);
  const [waybillBatch, setWaybillBatch] = useState<ShipmentBatch | null>(null);

  useEffect(() => subscribeShipOuts(setList), []);
  useEffect(() => subscribeShipments(setBatches), []);
  useEffect(() => subscribeShippingSettings(({ addresses, sender }) => { setAddresses(addresses); setSender(sender); }), []);

  // 박스 순으로 세운 줄 차례(눌렀을 때 한 번 정해 두고, 그 뒤로는 그대로 둔다).
  const [boxOrder, setBoxOrder] = useState<string[] | null>(null);

  // 방금 한 일을 되돌리고 다시 할 수 있게, 일을 하기 직전·직후의 상태를 통째로 찍어 쌓아 둔다.
  interface Step { label: string; before: ShipSnapshot; after: ShipSnapshot; boxBefore: string[] | null; boxAfter: string[] | null }
  const [undoStack, setUndoStack] = useState<Step[]>([]);
  const [redoStack, setRedoStack] = useState<Step[]>([]);

  // 목록을 바꾸는 일은 모두 이 함수를 거친다(그래야 되돌릴 수 있다).
  const step = (label: string, run: () => void | false, boxAfter?: string[] | null) => {
    const before = snapshotShipOuts();
    const boxBefore = boxOrder;
    if (run() === false) return;
    const after = snapshotShipOuts();
    const boxNext = boxAfter === undefined ? boxBefore : boxAfter;
    if (sameSnapshot(before, after) && boxBefore === boxNext) return;
    // 스무 걸음까지만 기억한다.
    setUndoStack(prev => [...prev, { label, before, after, boxBefore, boxAfter: boxNext }].slice(-20));
    setRedoStack([]);
  };

  const undo = () => {
    setUndoStack(prev => {
      const last = prev[prev.length - 1];
      if (!last) return prev;
      restoreShipSnapshot(last.before);
      setBoxOrder(last.boxBefore);
      setRedoStack(r => [...r, last]);
      return prev.slice(0, -1);
    });
  };

  const redo = () => {
    setRedoStack(prev => {
      const last = prev[prev.length - 1];
      if (!last) return prev;
      restoreShipSnapshot(last.after);
      setBoxOrder(last.boxAfter);
      setUndoStack(u => [...u, last]);
      return prev.slice(0, -1);
    });
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

  const sortByBox = () => {
    const keys = ordered.flatMap(item => item.lines
      .slice()
      .sort((a, b) => firstBoxNo(a.쉼먼트 || '') - firstBoxNo(b.쉼먼트 || ''))
      .map(lineKey));
    step('박스순 정렬', () => setBoxOrder(keys), keys);
  };

  // 줄이 어느 출고 건에 속하는지 찾는 지도(발주번호 → 출고번호). 표에서 값을 고칠 때 쓴다.
  const shipIdOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of list) for (const l of item.lines) if (!map.has(l.발주번호)) map.set(l.발주번호, item.id);
    return map;
  }, [list]);

  // 출고 건의 진행 상태: 롯데 예약 → 운송장 → 서허 양식 저장.
  const progressOf = (item: ShipOut) => {
    // 쉽먼트 번호가 붙어 있으면 그걸 쓰고, 예전에 만든 건이라 없으면 발주번호가 겹치는
    // 가장 최근 쉽먼트를 찾아 이어 준다.
    const mineOrders = new Set(item.lines.map(l => String(l.발주번호 || '').trim()).filter(Boolean));
    const batch = batches.find(b => b.id === item.batchId)
      || batches
        .filter(b => allBoxes(b).some(box => box.lines.some(l => mineOrders.has(String(l.발주번호 || '').trim()))))
        .sort((a, b) => b.createdAt - a.createdAt)[0];
    const boxes = batch ? allBoxes(batch) : [];
    const waybills = boxes.filter(b => (b.waybill || '').trim()).length;
    return {
      batch,
      reserved: !!batch,
      waybills,
      allWaybilled: boxes.length > 0 && waybills === boxes.length,
      formSaved: !!item.formSavedAt,
      // 사람이 직접 켠 완료가 가장 우선이고, 직접 풀었으면 다시 할 일로 본다.
      // 둘 다 없으면 예약·운송장·양식이 다 끝났는지로 판단한다.
      done: item.doneAt ? true
        : item.undoneAt ? false
        : (!!batch && boxes.length > 0 && waybills === boxes.length && !!item.formSavedAt),
    };
  };

  // 완료한 출고 건의 발주번호들. 왼쪽 발주서 표에도 같은 완료 표시를 찍어 준다.
  const doneOrders = useMemo(() => {
    const set = new Set<string>();
    for (const item of list) {
      if (!progressOf(item).done) continue;
      for (const l of item.lines) if (l.발주번호) set.add(String(l.발주번호).trim());
    }
    return set;
  }, [list, batches]);

  // 쉽먼트 완료한 건은 발송대기 메뉴로 넘어가므로 여기에는 아직 할 건만 둔다. 표도 이 순서를 따라간다.
  // 입고예정일 빠른 순, 같으면 센터 → 먼저 넘어온 순.
  const ordered = useMemo(
    () => list.filter(i => !progressOf(i).done).sort((a, b) =>
      ymdSortKey(a.date) - ymdSortKey(b.date)
      || a.center.localeCompare(b.center, 'ko', { numeric: true })
      || (a.createdAt || 0) - (b.createdAt || 0)),
    [list, batches],
  );
  // 택배 예약 건수 = 물류센터별로 지정된 상자 개수의 합.
  const rows: DisplayRow[] = useMemo(() => {
    // 표도 오른쪽 묶음 카드와 같은 순서로 쌓는다: 새로 넘어온 건이 위, 끝낸 건이 아래.
    // 한 건 안에서는 발주서 순서(입고예정일 → 물류센터 → 발주번호)대로 줄을 세운다.
    const all: OrderRow[] = ordered.flatMap(item => item.lines
      .map(l => ({
        발주번호: l.발주번호,
        물류센터: l.물류센터,
        상품이름: l.상품이름,
        확정수량: l.확정수량,
        입고예정일: normalizeDateValue(l.입고예정일),
        메모: l.메모 || '',
        쉼먼트: l.쉼먼트 || '',
        // 상자·센터가 출고 건끼리 섞이지 않게 묶음 값은 출고번호로 둔다(화면에는 묶음 이름으로 보여준다).
        묶음: item.id,
        // 택배가 갈 센터는 출고 건에 정해 둔 센터다. 줄마다 원래 센터가 남아 있을 수 있어(묶음 적용 전에
        // 넘어온 줄) 첫 줄 센터를 쓰면 날짜·정렬에 따라 엉뚱한 센터로 보이고 그쪽으로 예약된다.
        묶음센터: item.center,
      }))
      .sort((a, b) => {
        // 박스 순으로 세워 둔 적이 있으면 그때 정한 자리를 지킨다. 박스 번호를 고치는 동안
        // 줄이 곧바로 움직이면 2번에서 3번으로 올릴 수가 없어서, 자동으로는 다시 세우지 않는다.
        if (boxOrder) {
          const ia = boxOrder.indexOf(lineKey(a));
          const ib = boxOrder.indexOf(lineKey(b));
          if (ia !== ib) return (ia < 0 ? 9999 : ia) - (ib < 0 ? 9999 : ib);
        }
        const d = ymdSortKey(a.입고예정일) - ymdSortKey(b.입고예정일);
        if (d) return d;
        const c = a.물류센터.localeCompare(b.물류센터, 'ko', { numeric: true });
        if (c) return c;
        return a.발주번호.localeCompare(b.발주번호, 'ko', { numeric: true });
      })
      // 여러 박스로 나눈 줄은 박스마다 조각 줄로 펼친다(택배 예약·쉽먼트 기록도 조각 단위로 센다).
      .flatMap(expandBoxSplit));
    return buildDisplayRows(all);
  }, [ordered, boxOrder]);

  const itemCount = rows.filter(r => !r.isBlank).length;
  // ---- 이름이 다른 같은 상품 찾아 알려주기 ----
  // 쿠팡 발주 상품명과 한중발주 품목 이름이 규칙 없이 다를 때가 있어(상품관리 이름으로 적은 경우),
  // 한중에 아직 안 맡긴 쉽먼트 줄마다 "비슷한데 연결 안 된" 한중 품목을 찾아 위에 알린다.
  // 사람이 같은 상품 / 다른 상품을 고르면 기억해서 다시 묻지 않는다.
  const LINK_SIMILAR = 0.7;
  const linkChecks = useMemo(() => {
    const items: { code: string; name: string; spare: number }[] = [];
    for (const o of hanjungOrders) {
      for (const p of productSummary(o)) if (p.spare > 0 && p.allocated === 0) items.push({ code: o.code, name: p.상품이름, spare: p.spare });
    }
    const out: { line: string; code: string; item: string; spare: number }[] = [];
    const seenLine = new Set<string>();
    for (const r of rows) {
      if (r.isBlank) continue;
      const name = r.상품이름;
      const k = nameKey(name);
      if (seenLine.has(k)) continue;
      seenLine.add(k);
      // 이미 같은 이름(또는 연결된 이름)의 한중 품목이 있으면 묻지 않는다.
      if (hanjungOrders.some(o => productSummary(o).some(p => nameKey(p.상품이름) === k))) continue;
      const best = items
        .filter(it => nameKey(it.name) !== k && !isNotSame(name, it.name))
        .map(it => ({ it, score: nameSimilarity(name, it.name) }))
        .filter(x => x.score >= LINK_SIMILAR)
        .sort((a, b) => b.score - a.score)[0];
      if (best) out.push({ line: name, code: best.it.code, item: best.it.name, spare: best.it.spare });
    }
    return out;
  }, [rows, hanjungOrders]);
  const linkCheckNames = useMemo(() => new Set(linkChecks.map(c => nameKey(c.line))), [linkChecks]);
  const [linkOpen, setLinkOpen] = useState(true);
  const answerLink = (c: { line: string; item: string }, same: boolean) =>
    rememberSameProduct(c.item, c.line, same).catch(err => alert(`저장 실패: ${err?.message || err}`));



  // 오른쪽 묶음 카드는 표에서 제 덩어리가 지나가는 동안만 따라붙게 한다.
  // 카드마다 짝이 되는 덩어리 머리줄의 실제 위치를 재서 그 자리에 바로 놓는다(높이를 차례로 쌓으면
  // 조금씩 어긋난 게 아래로 갈수록 커진다). 카드가 제 덩어리보다 길면 다음 카드를 그만큼 아래로 민다.
  const tableRef = useRef<HTMLDivElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);
  const [cardPos, setCardPos] = useState<{ at: Record<string, { top: number; height: number }>; total: number }>({ at: {}, total: 0 });
  // 카드가 제 덩어리보다 길면 표의 덩어리 아래 여백을 그만큼 늘린다(다음 덩어리와 다음 카드가 같은 높이에서 시작하게).
  const [chunkPad, setChunkPad] = useState<Record<string, number>>({});
  const padRef = useRef<Record<string, number>>({});
  useLayoutEffect(() => {
    const el = tableRef.current;
    const box = cardsRef.current;
    if (!el || !box) return;
    const measure = () => {
      const base = box.getBoundingClientRect().top;
      const heads = Array.from(el.querySelectorAll('[data-chunk]')) as HTMLElement[];
      const tableBottom = el.getBoundingClientRect().bottom - base;
      const want: Record<string, { top: number; h: number }> = {};
      heads.forEach((head, i) => {
        const top = head.getBoundingClientRect().top - base;
        const end = i + 1 < heads.length ? heads[i + 1].getBoundingClientRect().top - base : tableBottom;
        const key = head.dataset.chunk;
        if (key) want[key] = { top, h: end - top };
      });
      const at: Record<string, { top: number; height: number }> = {};
      const pads: Record<string, number> = {};
      let prevEnd = -CHUNK_GAP;
      for (const card of Array.from(box.querySelectorAll('[data-card]')) as HTMLElement[]) {
        const key = card.dataset.card || '';
        const w = want[key];
        const cardH = card.offsetHeight;
        // 늘려 둔 여백을 빼고 본 덩어리 원래 높이로 모자란 만큼을 잰다(안 그러면 늘렸다 줄였다 되풀이한다).
        const natural = w ? w.h - (padRef.current[key] || 0) - CHUNK_GAP : 0;
        const short = Math.max(0, Math.ceil(cardH - natural));
        if (short > 0) pads[key] = short;
        const top = Math.round(Math.max(w ? w.top : 0, prevEnd + CHUNK_GAP));
        const height = Math.round(Math.max(w ? w.h - CHUNK_GAP : 0, cardH));
        at[key] = { top, height };
        prevEnd = top + height;
      }
      if (JSON.stringify(pads) !== JSON.stringify(padRef.current)) {
        padRef.current = pads;
        setChunkPad(pads);
      }
      const total = Math.round(Math.max(tableBottom, prevEnd));
      setCardPos(prev => (stableKey(prev) === stableKey({ at, total }) ? prev : { at, total }));
    };
    const stableKey = (v: { at: Record<string, { top: number; height: number }>; total: number }) =>
      JSON.stringify([v.total, Object.entries(v.at).sort()]);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    box.querySelectorAll('[data-card]').forEach(c => ro.observe(c));
    return () => ro.disconnect();
  }, [rows, ordered, opened, openDone]);

  // 출고 건 하나의 줄만 표 모양으로 만든다(쉽먼트생성을 그 건에만 걸 때 쓴다).
  const rowsOf = (items: ShipOut[]): DisplayRow[] => buildDisplayRows(items.flatMap(item => item.lines.flatMap(l => expandBoxSplit({
    발주번호: l.발주번호,
    물류센터: l.물류센터,
    상품이름: l.상품이름,
    확정수량: l.확정수량,
    입고예정일: normalizeDateValue(l.입고예정일),
    메모: l.메모 || '',
    쉼먼트: l.쉼먼트 || '',
    묶음: item.id,
    묶음센터: item.center,
  }))));

  // 출고 건 색: 목록에 놓인 차례대로 준다(표의 세로줄·배경과 카드가 같은 색을 쓰게).
  // 색은 두 가지만: 아직 할 건은 보라(박스·택배예약은 주황), 끝난 건은 초록(완료 색은 표·카드가 따로 칠한다).
  const colorOf = (_id: string) => PENDING_COLOR;

  // 아직 쉽먼트를 안 만든(= 완료 표시가 없는) 출고 건들. 위쪽 쉽먼트생성 버튼은 이것만 대상으로 한다.
  const pendingItems = list.filter(i => !progressOf(i).done);
  const pendingIds = pendingItems.map(i => i.id);
  const pendingRows = rowsOf(pendingItems);

  // 위쪽 택배예약 버튼은 체크한 출고 건(발주서를 하나라도 체크한 건)만 대상으로 한다.
  const pickedItems = pendingItems.filter(i => i.lines.some(l => selected.has(l.발주번호)));
  const pickedRows = rowsOf(pickedItems);
  const lotteCount = totalBoxCount(pickedRows);

  // 표에서 예약·박스를 누르면 그 줄이 속한 출고 건의 값을 고친다(줄의 묶음 값이 출고번호다).
  // 나눈 줄의 조각이면 원래 줄을 찾아서, 박스 칸은 그 조각의 박스만 바꾼다.
  const lineMatch = (row: DisplayRow) => ({
    발주번호: row._발주번호,
    상품이름: row.상품이름,
    확정수량: row._조각 !== undefined ? (row._원수량 ?? row.확정수량) : row.확정수량,
    입고예정일: dateKeyYMD(row._입고예정일),
  });
  const lineOf = (row: DisplayRow) => list
    .find(i => i.id === shipIdOf.get(row._발주번호))?.lines
    .find(l => l.발주번호 === row._발주번호 && l.상품이름 === row.상품이름
      && String(l.확정수량) === String(lineMatch(row).확정수량) && l.입고예정일 === lineMatch(row).입고예정일);

  const editLine = (id: string, patch: { 메모?: string; 쉼먼트?: string }) => {
    const row = rows.find(r => r.id === id);
    if (!row) return;
    let next = patch;
    if (patch.쉼먼트 !== undefined && row._조각 !== undefined) {
      const pieces = parseBoxSplit(lineOf(row)?.쉼먼트 || '');
      const me = pieces[row._조각];
      if (!me) return;
      const no = parseBoxNo(patch.쉼먼트);
      if (no) me.no = no;
      else {
        // 박스를 빼면 그 조각 수량은 옆 조각에 얹는다.
        const mate = pieces[row._조각 - 1] || pieces[row._조각 + 1];
        if (mate) mate.qty += me.qty;
        pieces.splice(row._조각, 1);
      }
      next = { 쉼먼트: joinBoxSplit(pieces) };
    }
    step(patch.쉼먼트 !== undefined ? '박스 지정' : '예약 표시', () => {
      updateShipOutLine(shipIdOf.get(row._발주번호) || '', lineMatch(row), next);
    });
  };

  // 한 상품을 박스 여러 개에 나눠 담는다. 창에서 박스 번호를 고르고 박스마다 수량을 직접 넣는다.
  const [splitting, setSplitting] = useState<{ row: DisplayRow; total: number; pieces: { no: number; qty: string }[] } | null>(null);
  const splitLine = (id: string) => {
    const row = rows.find(r => r.id === id);
    if (!row) return;
    const total = Number(row._조각 !== undefined ? row._원수량 : row.확정수량) || 0;
    const now = row._조각 !== undefined
      ? parseBoxSplit(lineOf(row)?.쉼먼트 || '')
      : [{ no: parseBoxNo(row.쉼먼트) || 1, qty: total }];
    // 새로 담을 박스 칸을 하나 붙여 둔다(이 묶음에서 아직 안 쓴 다음 번호).
    const used = rows.filter(r => !r.isBlank && r.묶음 === row.묶음).map(r => parseBoxNo(r.쉼먼트) || 0);
    const nextNo = Math.min(9, Math.max(0, ...used, ...now.map(p => p.no)) + 1);
    setSplitting({
      row, total,
      pieces: [...now.map(p => ({ no: p.no, qty: String(p.qty) })), { no: nextNo, qty: '' }],
    });
  };
  const saveSplit = () => {
    if (!splitting) return;
    const { row, total } = splitting;
    const pieces = splitting.pieces
      .map(p => ({ no: p.no, qty: Math.floor(Number(p.qty) || 0) }))
      .filter(p => p.qty > 0);
    const sum = pieces.reduce((n, p) => n + p.qty, 0);
    if (sum !== total) { alert(`박스별 수량 합계(${sum}개)가 전체 수량(${total}개)과 같아야 해요.`); return; }
    step('박스 나누기', () => {
      updateShipOutLine(shipIdOf.get(row._발주번호) || '', lineMatch(row), { 쉼먼트: joinBoxSplit(pieces) });
    });
    setSplitting(null);
  };

  const toggleSelect = (orderNo: string, checked: boolean) =>
    setSelected(prev => {
      const next = new Set(prev);
      if (checked) next.add(orderNo); else next.delete(orderNo);
      return next;
    });

  // 체크한 발주서만 발주확인으로 되돌린다(줄이 다 빠진 출고 건은 목록에서 사라진다).
  const restoreSelected = () => {
    const orderNos: string[] = Array.from(selected);
    if (!orderNos.length) return;
    if (!confirm(`발주 ${orderNos.length}건을 쿠팡발주확인으로 되돌릴까요?`)) return;
    step(`발주 ${orderNos.length}건 발주확인으로`, () => { restoreOrders(orderNos); });
    setSelected(new Set());
    onGoOrder?.();
  };

  const toggle = (key: string) =>
    setOpened(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  // 발주번호만 한 줄에 하나씩 복사한다(쿠팡·서허 검색창에 그대로 붙여 넣는다).
  const copyOrderNos = async (id: string, orderNos: string[]) => {
    const text = orderNos.join('\n');
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(id);
    setTimeout(() => setCopied(prev => (prev === id ? '' : prev)), 1500);
  };

  const handleAddressUpdate = (updated: AddressEntry[]) => {
    setAddresses(updated);
    saveAddresses(updated).catch(err => alert(`택배주소 저장 실패: ${err instanceof Error ? err.message : String(err)}`));
  };

  const handleSenderUpdate = (updated: SenderInfo) => {
    setSender(updated);
    saveSender(updated).catch(err => alert(`보내는사람 저장 실패: ${err instanceof Error ? err.message : String(err)}`));
  };

  // B단계: 서허(서플라이어허브)에서 이 쉽먼트의 일괄등록 양식을 받아온다.
  // 확장이 서허 창을 열어 양식을 내려받고, 받은 파일을 앱으로 넘겨준다(C단계에서 채운다).
  const handleShubForm = (batch: ShipmentBatch) => {
    setShubBatch(batch);
    setShubStatus(`${batch.id} · 서허 여는 중…`);
    const onMsg = (event: MessageEvent) => {
      const d = event.data;
      if (event.source !== window || !d || d.source !== 'rocket-hub-extension') return;
      if (d.type === 'SHUB_FORM_ACK' && !d.ok) {
        window.removeEventListener('message', onMsg);
        setShubStatus(null);
        alert(`서허 창을 열지 못했어요: ${d.error || ''}`);
      }
      if (d.type === 'SHUB_STATUS') {
        setShubStatus(`${batch.id} · ${d.status || ''}`);
        if (d.file && d.file.dataUrl) {
          window.removeEventListener('message', onMsg);
          setShubForm({ batchId: batch.id, name: d.file.name, dataUrl: d.file.dataUrl });
          // C단계: 받은 양식을 이 쉽먼트의 박스 배정대로 채워서 바로 저장한다.
          fillAndSave(dataUrlToBuffer(d.file.dataUrl), batch);
        }
      }
    };
    window.addEventListener('message', onMsg);
    setTimeout(() => window.removeEventListener('message', onMsg), 10 * 60 * 1000);
    // 양식 다운로드 팝업에서 이 쉽먼트에 해당하는 발주건만 골라야 해서 발주번호를 같이 보낸다.
    const orderNos = Array.from(
      new Set(allBoxes(batch).flatMap(b => b.lines.map(l => String(l.발주번호 || '').trim())).filter(Boolean))
    );
    // 서허 팝업 목록을 좁히는 데 쓴다(물류센터·입고예정일이 하나뿐일 때만 보낸다).
    const centers = batch.centers.map(c => c.center.trim()).filter(Boolean);
    // 저장본은 'YYYYMMDD'라 서허 화면에서 쓰는 'YYYY-MM-DD'로 바꾼다.
    const edds = Array.from(new Set(allBoxes(batch).flatMap(b => b.lines.map(l => String(l.입고예정일 || '').trim())).filter(Boolean)))
      .map(d => (/^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d));
    window.postMessage(
      {
        source: 'rocket-app-hub', type: 'SHUB_FORM', batchId: batch.id,
        boxCount: allBoxes(batch).length, orderNos,
        center: new Set(centers).size === 1 ? centers[0] : '',
        edd: edds.length === 1 ? edds[0] : '',
      },
      window.location.origin
    );
  };

  // 양식을 채워서 저장한다(자동으로 받아온 파일이든, 직접 고른 파일이든 같은 길).
  const fillAndSave = (buf: ArrayBuffer, batch: ShipmentBatch) => {
    try {
      const res = fillShubForm(buf, batch);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(res.blob);
      a.download = res.fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      markShipOuts(list.filter(i => i.batchId === batch.id).map(i => i.id), { formSavedAt: Date.now() });
      setShubStatus(
        `${batch.id} · ✅ 양식 채워서 저장했어요 — ${res.fileName} (상품 ${res.filled}줄, 송장 ${res.waybills.length}개)` +
          (res.missed.length ? ` · 짝 못 찾은 줄 ${res.missed.length}개: ${res.missed.slice(0, 3).join(' / ')}` : '')
      );
      // 짝 못 찾은 줄이 있으면 올리지 않는다(빠진 채로 등록되면 안 된다). 사람이 확인하고 직접 올린다.
      if (res.missed.length) {
        alert(`양식에 짝 못 찾은 줄이 ${res.missed.length}개 있어서 서허에 자동으로 올리지 않았어요.\n저장된 파일을 확인한 뒤 직접 올려 주세요.`);
        return;
      }
      uploadToShub(res.blob, res.fileName, batch);
    } catch (err) {
      setShubStatus(`${batch.id} · 양식을 채우지 못했어요: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // 채운 양식을 서허 쉽먼트 일괄등록에 올린다(확장 shub-upload.js). 사람이 하던 순서 그대로:
  // 택배사 롯데택배 · 발송일 = 입고예정일 하루 전 · 시간 23:55 · 업로드 파일 → "쉽먼트 일괄등록".
  // 입고예정일이 여럿이면 가장 이른 날 기준으로 한다.
  const uploadToShub = (blob: Blob, fileName: string, batch: ShipmentBatch) => {
    const edds = allBoxes(batch).flatMap(b => b.lines.map(l => String(l.입고예정일 || '').replace(/[^0-9]/g, ''))).filter(d => d.length === 8).sort();
    if (!edds.length) {
      setShubStatus(`${batch.id} · 입고예정일을 몰라서 서허에 올리지 못했어요. 저장된 파일을 직접 올려 주세요.`);
      return;
    }
    const e = edds[0];
    const day = new Date(Number(e.slice(0, 4)), Number(e.slice(4, 6)) - 1, Number(e.slice(6, 8)) - 1);
    const shipDate = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    const reader = new FileReader();
    reader.onload = () => {
      const onMsg = (event: MessageEvent) => {
        const d = event.data;
        if (event.source !== window || !d || d.source !== 'rocket-hub-extension') return;
        if (d.type === 'SHUB_UPLOAD_ACK' && !d.ok) {
          window.removeEventListener('message', onMsg);
          setShubStatus(`${batch.id} · 서허 업로드를 시작하지 못했어요: ${d.error || ''}`);
        }
        if (d.type === 'SHUB_UPLOAD_STATUS' && d.batchId === batch.id) {
          const msgs = (d.messages || []).length ? ` · 서허: ${(d.messages as string[]).join(' / ')}` : '';
          setShubStatus(`${batch.id} · 서허 업로드 · ${d.status || ''}${msgs}`);
          if (d.step === 'done' || d.step === 'error') window.removeEventListener('message', onMsg);
        }
      };
      window.addEventListener('message', onMsg);
      setTimeout(() => window.removeEventListener('message', onMsg), 10 * 60 * 1000);
      setShubStatus(`${batch.id} · 서허에 올리는 중… (발송일 ${shipDate} 23:55)`);
      window.postMessage({
        source: 'rocket-app-hub', type: 'SHUB_UPLOAD', batchId: batch.id,
        file: { name: fileName, dataUrl: reader.result as string }, shipDate, shipTime: '23:55', carrier: '롯데택배',
        // 등록 뒤 발주서마다 쉽먼트 번호를 찾아 적으려고 이 쉽먼트의 발주번호들을 같이 보낸다.
        orderNos: Array.from(new Set(allBoxes(batch).flatMap(b => b.lines.map(l => String(l.발주번호 || '').trim())).filter(Boolean))),
      }, window.location.origin);
    };
    reader.readAsDataURL(blob);
  };

  // 확장이 파일을 못 가져왔을 때, 다운로드 폴더의 양식을 직접 골라 채운다.
  const pickFormFile = (batch: ShipmentBatch) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls';
    input.onchange = async () => {
      const f = input.files && input.files[0];
      if (!f) return;
      fillAndSave(await f.arrayBuffer(), batch);
    };
    input.click();
  };

  // 받은 양식을 그대로 저장해 두는 버튼(C단계를 만들기 전까지 확인용).
  const saveShubForm = () => {
    if (!shubForm) return;
    const a = document.createElement('a');
    a.href = shubForm.dataUrl;
    a.download = shubForm.name || '쉽먼트양식.xlsx';
    a.click();
  };

  // 고른 출고 건들만 쉽먼트로 만든다. 이미 끝낸 건이 딸려 들어가면 택배를 두 번 예약하게 되므로
  // 대상 줄을 받아서 그것만 쓴다.
  const handleLotte = (targetRows: DisplayRow[] = pendingRows, targetIds: string[] = pendingIds) => {
    if (!targetRows.length) return;
    // 쉽먼트 번호를 먼저 정해서 엑셀의 주문번호에 붙인다(롯데 목록에서 이번 건만 골라내는 표식).
    const id = batchId(batches);
    const file = exportLotteExcel(targetRows, addresses, sender, id);
    if (!file) return;
    if (!confirm(`${file.name}을 내려받았어요.\n롯데택배(ALPS)에 올려서 택배 예약과 운송장 만들기까지 할까요?`)) return;

    // 지금의 박스 배정을 기록해 둔다(나중에 서허 쉽먼트 양식을 채울 때 씀).
    const batch: ShipmentBatch = {
      id,
      createdAt: Date.now(),
      status: 'reserved',
      centers: shipmentCenters(targetRows).map(c => ({
        center: c.center,
        boxes: c.boxes.map(b => ({
          boxNo: b.boxNo,
          waybill: '',
          lines: b.lines.map(l => ({
            발주번호: l.발주번호,
            상품이름: l.상품이름,
            확정수량: Number(l.확정수량) || 0,
            입고예정일: dateKeyYMD(l.입고예정일).replace(/-/g, ''),
          })),
        })),
      })),
    };
    saveShipmentBatch(batch).catch(err => alert(`쉽먼트 기록 저장 실패: ${err instanceof Error ? err.message : String(err)}`));
    // 지금 화면에 있는 출고 건들이 이 쉽먼트에 들어갔다고 표시해 둔다(카드에 진행 상태로 보여준다).
    markShipOuts(targetIds, { batchId: id });

    let savedAt = 0;
    const done = () => window.removeEventListener('message', onMsg);
    const onMsg = (event: MessageEvent) => {
      const d = event.data;
      if (event.source !== window || !d || d.source !== 'rocket-hub-extension') return;
      if (d.type === 'LOTTE_UPLOAD_ACK' && !d.ok) {
        done();
        alert(`택배사 창을 열지 못했어요: ${d.error || ''}\n"로켓 서허 연동" 확장이 켜져 있는지 확인해 주세요.`);
      }
      if (d.type === 'LOTTE_STATUS') {
        if (!savedAt) savedAt = d.savedAt;
        if (d.savedAt !== savedAt) return;
        // 운송장번호까지 모아 왔으면 박스에 채워 넣고 확인 창을 띄운다.
        if (d.waybills && d.waybills.length) {
          done();
          // 운송장번호는 절대 틀리면 안 된다. 롯데 목록의 주문번호(이 쉽먼트번호-1, -2 …)와 짝지어 온 번호만
          // 박스에 넣는다. 주문번호가 없거나 겹치면 추측(센터 순서로 채우기)하지 않고 빈칸으로 두고 직접 넣게 한다.
          const list = d.waybills as { waybill: string; receiver: string; ordNo?: string }[];
          const digits = (w: string) => String(w || '').replace(/\D/g, '');
          const want = new Set(Array.from({ length: allBoxes(batch).length }, (_, i) => `${batch.id}-${i + 1}`));
          const paired = list.filter(w => w.ordNo && want.has(w.ordNo) && digits(w.waybill).length === 12);
          const clean = paired.length === list.length
            && new Set(paired.map(w => w.ordNo)).size === paired.length
            && new Set(paired.map(w => digits(w.waybill))).size === paired.length;
          if (!clean) {
            setWaybillBatch(batch);
            alert(`가져온 운송장번호를 주문번호와 확실히 짝짓지 못해 넣지 않았어요.\n롯데 화면에서 확인해 직접 넣어 주세요.\n\n가져온 값: ${list.map(w => `${w.ordNo || '(주문번호 없음)'}=${w.waybill}`).join(', ')}`);
            return;
          }
          const filled = { ...fillWaybills(batch, paired), status: 'waybilled' as const };
          saveShipmentBatch(filled).catch(() => {});
          const boxes = allBoxes(filled);
          if (!(boxes.length && boxes.every(b => b.waybill.trim()))) {
            setWaybillBatch(filled);
            return;
          }
          // 확장이 롯데 목록을 주문번호마다 다시 조회해 대조까지 마친 번호만 여기로 온다.
          setShubStatus(`${filled.id} · 운송장 ${boxes.length}건(롯데 목록과 대조 완료) → 서허 양식 받는 중…`);
          setTimeout(() => handleShubForm(filled), 800);
        } else if (d.step === 'error') {
          done();
          setWaybillBatch(batch);
          alert(`자동 진행이 중간에 멈췄어요.\n${d.status || ''}\n운송장번호는 창에서 직접 넣어주세요.`);
        }
      }
    };
    window.addEventListener('message', onMsg);
    setTimeout(done, 10 * 60 * 1000);
    // boxCount: 방금 예약한 박스(=택배 건) 수. 운송장 목록에서 맨 아래 이 개수만큼만 체크해 출력한다.
    window.postMessage({ source: 'rocket-app-hub', type: 'LOTTE_UPLOAD', file, boxCount: totalBoxCount(targetRows), batchId: batch.id }, window.location.origin);
  };



  // 이 출고 건의 발주건만 담은 쉽먼트로 서허 양식을 받는다. 예전에 센터가 섞여 기록된 배치라도
  // 이 건에 속한 줄만 골라 보내므로, 남의 발주건을 서허에서 찾지 않는다.
  const shubForItem = (item: ShipOut) => {
    const batch = progressOf(item).batch;
    if (!batch) return;
    const mine = new Set(item.lines.map(l => String(l.발주번호 || '').trim()));
    const trimmed: ShipmentBatch = {
      ...batch,
      centers: batch.centers
        .map(c => ({
          ...c,
          boxes: c.boxes
            .map(b => ({ ...b, lines: b.lines.filter(l => mine.has(String(l.발주번호 || '').trim())) }))
            .filter(b => b.lines.length),
        }))
        .filter(c => c.boxes.length),
    };
    if (!allBoxes(trimmed).length) {
      alert('이 건에 해당하는 박스를 쉽먼트 기록에서 찾지 못했어요.');
      return;
    }
    handleShubForm(trimmed);
  };

  // 쉽먼트 완료를 누르면 그 건은 발송대기(아직 준비 안 된 상품이 다 준비될 때까지 기다리는 곳)로 넘어간다.
  // 발송날짜는 발송대기에서 "발송 완료"를 누를 때 고른다. 완료를 푸는 것도 발송대기에서 한다.
  const toggleDone = (item: ShipOut) => {
    if (progressOf(item).done) {
      step('완료 풀기', () => { markShipOuts([item.id], { doneAt: undefined, undoneAt: Date.now() }); });
      return;
    }
    if (!confirm(`${item.bundle}(${item.center} · ${item.date})을 발송대기로 보낼까요?`)) return;
    step('발송대기로', () => { markShipOuts([item.id], { doneAt: Date.now(), undoneAt: undefined }); });
    setShubStatus(`${item.bundle}(${item.center})을 발송대기로 넘겼어요.`);
  };
  // 입고예정일 바꾸기. 쉽먼트 기록(서허 양식 받을 때 날짜로 목록을 좁힌다)의 이 건 발주 날짜도 같이 맞춘다.
  const [datePick, setDatePick] = useState<{ item: ShipOut; date: string } | null>(null);
  const saveDatePick = () => {
    if (!datePick || !datePick.date) return;
    const { item, date } = datePick;
    step('입고예정일 바꾸기', () => { setShipOutDate(item.id, date); });
    syncBatch(item, { date });
    setDatePick(null);
  };
  const syncBatch = (item: ShipOut, to: { center?: string; date?: string }) => {
    for (const next of retargetBatches(batches, item, to, progressOf(item).batch))
      saveShipmentBatch(next).catch(err => alert(`쉽먼트 기록 저장 실패: ${err instanceof Error ? err.message : String(err)}`));
  };

  // 요청등록중: 쿠팡에 센터·입고예정일 변경을 요청해 둔 건. 고른 값은 머리줄에 보여주고, 승인을 누르면 실제로 바뀐다.
  const [reqPick, setReqPick] = useState<{ item: ShipOut; center: string; date: string } | null>(null);
  const saveReqPick = () => {
    if (!reqPick || !reqPick.center.trim() || !reqPick.date) return;
    const { item, center, date } = reqPick;
    step('요청등록', () => { markShipOuts([item.id], { request: { center: center.trim(), date } }); });
    setReqPick(null);
  };
  // 쿠팡이 요청을 승인하면: 창에 적힌 센터·입고예정일로 실제로 바꾸고 요청등록중을 끈다.
  // 쉽먼트 기록(운송장·서허 양식)도 새 센터·날짜로 옮긴다.
  const approveReq = () => {
    if (!reqPick || !reqPick.center.trim() || !reqPick.date) return;
    const { item, date } = reqPick;
    const center = reqPick.center.trim();
    if (!confirm(`${item.bundle}을 ${center} · ${date}(으)로 바꿀까요?\n(지금 ${item.center} · ${item.date})`)) return;
    step('요청 승인', () => {
      markShipOuts([item.id], { request: { center, date } });
      applyShipOutRequest(item.id);
    });
    syncBatch(item, { center, date });
    setReqPick(null);
  };
  const clearReq = (item: ShipOut) => {
    step('요청등록 취소', () => { markShipOuts([item.id], { request: undefined }); });
    setReqPick(null);
  };

  // 이 출고 건의 n번 박스 운송장번호. 쉽먼트 기록에서 박스 번호가 같고 이 건의 발주가 든 박스를 찾는다
  // (예전 기록은 여러 건을 한 쉽먼트로 묶어 박스 번호가 겹칠 수 있어서 발주번호로 한 번 더 맞춘다).
  // 이 출고 건의 n번 박스 운송장번호(쉽먼트 기록을 내용으로 확인해서 확실한 것만).
  const waybillOf = (item: ShipOut, no: number) => waybillForBox(batches, item, no);

  // 운송장번호가 하나도 없는 쉽먼트 기록 지우기.
  const removeBatches = (targets: ShipmentBatch[]) => {
    if (!targets.length) return;
    const names = targets.map(b => b.id);
    if (!confirm(`운송장번호가 없는 쉽먼트 기록 ${names.length}건을 지울까요?\n${names.slice(0, 10).join(', ')}${names.length > 10 ? ' …' : ''}`)) return;
    Promise.all(targets.map(b => deleteShipmentBatch(b.id)))
      .catch(err => alert(`쉽먼트 기록 지우기 실패: ${err instanceof Error ? err.message : String(err)}`));
  };

  const boxCountOf = (item: ShipOut) => totalBoxCount(rowsOf([item]));

  const remove = (item: ShipOut) => {
    if (!confirm(`${item.id} (${item.bundle} · ${item.center})을 출고 목록에서 지울까요?`)) return;
    step(`${item.bundle} 삭제`, () => { deleteShipOut(item.id); });
  };

  // 출고를 취소하고 쿠팡발주확인(발송 목록)으로 되돌린다. 묶음도 그대로 살아난다.
  const restore = (item: ShipOut) => {
    if (!confirm(`${item.id} (${item.bundle} · ${item.center})을 쿠팡발주확인으로 되돌릴까요?`)) return;
    step(`${item.bundle} 발주확인으로`, () => { restoreShipOut(item.id); });
    onGoOrder?.();
  };

  return (
    <div style={{ minHeight: '100vh', background: '#fff', color: '#1a1a1a', fontFamily: "'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif" }}>
      <header style={{ background: '#fff', borderBottom: '1px solid #f0f0f0', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ maxWidth: 1600, margin: '0 auto', padding: isMobile ? '6px 12px' : '0 24px', minHeight: 54, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: isMobile ? 8 : 12 }}>
          <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.3px' }}>🚚 쉽먼트생성대기</span>
          {ordered.length > 0 && <span style={{ fontSize: 12, color: '#999' }}>출고 {ordered.length}건 · 발주 {itemCount}줄</span>}

          {/* 방금 한 일 되돌리기 · 다시실행 (⌘Z / ⌘⇧Z) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button
              onClick={undo}
              disabled={undoStack.length === 0}
              title={undoStack.length ? `되돌리기: ${undoStack[undoStack.length - 1].label} (⌘Z)` : '되돌릴 일이 없어요'}
              style={stepBtn(undoStack.length > 0)}
            >
              ↶ 되돌리기
            </button>
            <button
              onClick={redo}
              disabled={redoStack.length === 0}
              title={redoStack.length ? `다시실행: ${redoStack[redoStack.length - 1].label} (⌘⇧Z)` : '다시 할 일이 없어요'}
              style={stepBtn(redoStack.length > 0)}
            >
              ↷ 다시실행
            </button>
          </div>

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <button onClick={() => setShowSenderManager(true)} style={plainBtn}>📮 보내는사람 설정</button>
            <button onClick={() => setShowAddressManager(true)} style={plainBtn}>🗺️ 택배주소 관리</button>
            <button
              onClick={() => handleLotte(pickedRows, pickedItems.map(i => i.id))}
              disabled={lotteCount === 0}
              title={lotteCount > 0
                ? `체크한 출고 건 ${pickedItems.length}개만 모아 롯데택배 예약 엑셀을 만들고, 원하면 택배사 사이트에 올려 예약까지 합니다.`
                : '예약할 출고 건을 표에서 체크하세요.'}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '7px 14px', fontSize: 13, fontWeight: 600, borderRadius: 8,
                border: `1px solid ${lotteCount > 0 ? '#e67e22' : '#f5f5f5'}`,
                background: lotteCount > 0 ? '#e67e22' : '#f5f5f5',
                color: lotteCount > 0 ? '#fff' : '#bbb',
                cursor: lotteCount > 0 ? 'pointer' : 'not-allowed',
              }}
            >
              ↓ 택배예약
              {lotteCount > 0 && (
                <span style={{ background: 'rgba(255,255,255,0.25)', padding: '1px 7px', borderRadius: 12, fontSize: 11, marginLeft: 4 }}>
                  {lotteCount}박스
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 1600, margin: '0 auto', padding: isMobile ? '12px 10px 70px' : '20px 24px' }}>
        <ProductQtySummary lines={rows.filter(r => !r.isBlank).map(r => ({ 상품이름: r.상품이름, 확정수량: r.확정수량, ready: lineReady(list.find(i => i.id === r.묶음), lineOfRow(r)) }))} />
        {/* 이름이 다른 같은 상품일 수 있는 쌍. 사람이 한 번 답하면 기억해서 다시 안 묻는다. */}
        {linkChecks.length > 0 && (
          <div style={{ margin: '0 0 14px', border: '1.5px solid #f59e0b', background: '#fffbeb', borderRadius: 10, padding: '10px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }} onClick={() => setLinkOpen(o => !o)}>
              <span style={{ fontSize: 13, fontWeight: 800, color: '#b45309' }}>⚠ 한중 품목 연결 확인 {linkChecks.length}건</span>
              <span style={{ fontSize: 12, color: '#92400e' }}>쿠팡 발주 상품명과 한중발주 품목 이름이 달라요. 같은 상품인지 골라 주세요(한 번만 고르면 기억해요).</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: '#b45309' }}>{linkOpen ? '접기 ▲' : '펼치기 ▼'}</span>
            </div>
            {linkOpen && (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {linkChecks.map(c => (
                  <div key={`${c.line}│${c.item}`} style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#fff', border: '1px solid #fde68a', borderRadius: 8, padding: '6px 10px', fontSize: 12.5 }}>
                    {/* 이름 앞 꼬리표 칸 폭을 같게 해서 두 상품명이 세로로 줄 맞춰 보이게 한다. */}
                    <div style={{ flex: 1, minWidth: 0, lineHeight: 1.6, display: 'grid', gridTemplateColumns: '150px minmax(0, 1fr)', columnGap: 10, alignItems: 'baseline' }}>
                      <span style={{ color: '#999', fontSize: 11, whiteSpace: 'nowrap' }}>쿠팡 발주</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.line}>{c.line}</span>
                      <span style={{ color: '#999', fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={`한중 ${c.code} · 여유 ${c.spare}`}>한중 {c.code} · 여유 {c.spare}</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.item}>{c.item}</span>
                    </div>
                    <button onClick={() => answerLink(c, true)} style={{ padding: '4px 10px', fontSize: 12, fontWeight: 800, borderRadius: 6, cursor: 'pointer', border: '1.5px solid #27ae60', background: '#27ae60', color: '#fff', whiteSpace: 'nowrap' }}>같은 상품</button>
                    <button onClick={() => answerLink(c, false)} style={{ padding: '4px 10px', fontSize: 12, fontWeight: 700, borderRadius: 6, cursor: 'pointer', border: '1px solid #d1d5db', background: '#fff', color: '#6b7280', whiteSpace: 'nowrap' }}>다른 상품</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {ordered.length === 0 ? (
          <div style={{
            border: '1px dashed #e0e0e0', borderRadius: 10,
            padding: '60px 0', textAlign: 'center', color: '#bbb', fontSize: 13,
          }}>
            쉽먼트를 만들 건이 없어요.<br />
            <span style={{ fontSize: 12 }}>쿠팡발주확인에서 발주서를 체크하고 <strong style={{ color: '#e67e22' }}>쉽먼트생성</strong>을 눌러주세요. 쉽먼트 완료한 건은 <strong>발송대기</strong> 메뉴에 있어요.</span>
          </div>
        ) : (
          /* 쿠팡발주확인과 같은 3단 폭(발주서 / 묶음 / 예약 자리). 예약 자리는 여기선 비워 둔다. */
          // 휴대폰에서는 발주서 표만 화면 폭에 꽉 차게(묶음 카드는 숨김).
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : '1.75fr 0.7fr 0.6fr', gap: 20, alignItems: 'start' }}>
            {/* 왼쪽: 발주서 표(쿠팡발주확인의 발송 패널과 같은 표) */}
            {/* PC에서는 표 폭만큼 칸이 늘어나야 잘리지 않는다(minWidth 0은 휴대폰에서만). */}
            <div style={{ minWidth: isMobile ? 0 : undefined }}>
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#c0392b', letterSpacing: '-0.2px' }}>📤 발주서</span>
                <span style={{ fontSize: 11, color: '#aaa' }}>{itemCount}건</span>
                <button
                  onClick={() => printPanel(rows, '출고', '#c0392b')}
                  title="출고 발주서 인쇄"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '3px 9px', fontSize: 11, color: '#777',
                    background: '#fff', border: '1px solid #e0e0e0', borderRadius: 6, cursor: 'pointer',
                  }}
                >
                  🖨 인쇄
                </button>
                <button
                  onClick={sortByBox}
                  title="지금 지정한 박스 번호 순(1번 → 2번 → …)으로 줄을 다시 세웁니다"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '3px 9px', fontSize: 11, color: '#777',
                    background: '#fff', border: '1px solid #e0e0e0', borderRadius: 6, cursor: 'pointer',
                  }}
                >
                  ↕ 박스순
                </button>
                {selected.size > 0 && (
                  <button
                    onClick={restoreSelected}
                    title="체크한 발주서를 쿠팡발주확인 발송 목록으로 되돌립니다"
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      padding: '3px 10px', fontSize: 11, fontWeight: 700, color: '#fff',
                      background: PENDING_COLOR, border: `1px solid ${PENDING_COLOR}`, borderRadius: 6, cursor: 'pointer',
                    }}
                  >
                    ← 발주확인으로 {selected.size}건
                  </button>
                )}
              </div>
              <div ref={tableRef}>
              <OrderTable
                rows={rows}
                onMemoChange={(id, v) => editLine(id, { 메모: v })}
                onShipmentChange={(id, v) => editLine(id, { 쉼먼트: v })}
                onSplitLine={splitLine}
                colorScheme="pink"
                selectedOrders={selected}
                onToggleSelect={toggleSelect}
                doneOrders={doneOrders}
                onSortByBox={sortByBox}
                bundleLabel={(key) => list.find(i => i.id === key)?.bundle || key}
                bundleColorOf={colorOf}
                layout="box"
                officeQtyOf={officeQtyOf}
                monoBoxes={PENDING_BOX}
                isChunkCollapsed={id => !openDone.has(id)}
                chunkPad={isMobile ? undefined : chunkPad}
                lineBadge={row => (
                  <>
                    {linkCheckNames.has(nameKey(row.상품이름)) && (
                      <span title="한중발주에 이름이 다른 같은 상품이 있을 수 있어요. 위 '한중 품목 연결 확인'에서 골라 주세요." style={{ display: 'inline-block', marginLeft: 6, padding: '0 6px', fontSize: 10.5, fontWeight: 800, lineHeight: '16px', borderRadius: 999, whiteSpace: 'nowrap', verticalAlign: 'middle', color: '#b45309', background: '#fffbeb', border: '1px solid #f59e0b' }}>⚠ 연결 확인</span>
                    )}
                    {hanjungBadge({ 발주번호: row._발주번호, 상품이름: row.상품이름, 확정수량: row._조각 !== undefined ? (row._원수량 ?? row.확정수량) : row.확정수량 }, lineReady(list.find(i => i.id === row.묶음), lineOfRow(row)))}
                  </>
                )}
                isReady={row => lineReady(list.find(i => i.id === row.묶음), lineOfRow(row))}
                onToggleReady={(row, on) => toggleLineReady(list.find(i => i.id === row.묶음), lineOfRow(row), on)}
                hanjungOf={hanjungOf}
                onLineHanjung={setLineHanjung}
                boxWaybill={(id, no) => {
                  const item = list.find(i => i.id === id);
                  return item ? waybillOf(item, no) : '';
                }}
                onEditChunkDate={id => {
                  const item = list.find(i => i.id === id);
                  if (item) setDatePick({ item, date: item.date });
                }}
                onToggleChunk={toggleDoneOpen}
                chunkExtra={id => {
                  const item = list.find(i => i.id === id);
                  if (!item) return null;
                  const req = item.request;
                  return (
                    <span
                      onClick={() => setReqPick({ item, center: req?.center || item.center, date: req?.date || item.date })}
                      title={req ? '눌러서 요청한 센터·입고예정일을 고치거나, 승인됐으면 승인을 눌러 바꾸기' : '쿠팡에 센터·입고예정일 변경을 요청했으면 눌러서 적어 두세요'}
                      style={req ? {
                        // 요청 중인 건은 멀리서도 보이게: 빨간 바탕에 흰 글씨, 점이 깜빡인다.
                        display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                        padding: '3px 10px', fontSize: 13, fontWeight: 800, borderRadius: 6, lineHeight: 1.4,
                        border: '1.5px solid #dc2626', background: '#dc2626', color: '#fff',
                        boxShadow: '0 0 0 3px #fecaca',
                      } : {
                        display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer',
                        padding: '1px 8px', fontSize: 11, fontWeight: 800, borderRadius: 5, lineHeight: 1.5,
                        border: '1.5px solid #e5e5e5', background: '#fff', color: '#bbb',
                      }}
                    >
                      {req ? (
                        <>
                          <style>{'@keyframes reqBlink{0%,100%{opacity:1}50%{opacity:.25}}'}</style>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#fff', animation: 'reqBlink 1.2s ease-in-out infinite' }} />
                          요청등록중
                          <span style={{ background: '#fff', color: '#dc2626', padding: '0 7px', borderRadius: 4 }}>→ {req.center} · {req.date.slice(5).replace('-', '/')}</span>
                        </>
                      ) : '○ 요청등록중'}
                    </span>
                  );
                }}
              />
              </div>
            </div>

            {/* 오른쪽: 묶음(출고 건) 카드 */}
            {/* overflow를 주면 안쪽 sticky가 죽는다(스크롤 상자가 새로 생겨서). 그래서 넘침 처리는 카드 쪽에서 한다. */}
            {!isMobile && <div style={{ paddingRight: 2 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: PENDING_COLOR, letterSpacing: '-0.2px' }}>🧺 묶음</span>
                <span style={{ fontSize: 11, color: '#aaa' }}>{ordered.length}건</span>
              </div>

              <div ref={cardsRef} style={{ position: 'relative', height: cardPos.total || undefined }}>
                {ordered.map(item => {
                  // 카드 안에서 발주번호별로 나눈다(쿠팡발주확인의 묶음 카드와 같은 모양).
                  const orders = new Map<string, typeof item.lines>();
                  for (const line of item.lines) {
                    const key = line.발주번호 || '(번호없음)';
                    orders.set(key, [...(orders.get(key) || []), line]);
                  }
                  // 박스별로 다시 묶는다(박스 → 발주번호). 나눠 담은 줄은 박스마다 조각으로 들어간다.
                  const byBox = new Map<number, Map<string, typeof item.lines>>();
                  for (const line of item.lines.flatMap(l => expandBoxSplit({ ...l, 쉼먼트: l.쉼먼트 || '' }))) {
                    const no = parseBoxNo(line.쉼먼트) || 0;
                    const box = byBox.get(no) || new Map<string, typeof item.lines>();
                    const key = line.발주번호 || '(번호없음)';
                    box.set(key, [...(box.get(key) || []), line]);
                    byBox.set(no, box);
                  }
                  const boxList = Array.from(byBox.entries()).sort((a, b) => (a[0] || 9999) - (b[0] || 9999));

                  const pr = progressOf(item);

                  const color = PENDING_COLOR;
                  const folded = pr.done && !openDone.has(item.id);

                  return (
                    // 바깥 자리는 표에서 이 덩어리가 차지하는 높이만큼. 그 안에서만 카드가 따라 내려온다.
                    // 자리(바깥)는 표에서 이 덩어리 머리줄과 같은 높이에서 시작해 덩어리 끝까지. 카드는 그 안에서만 따라온다.
                    <div key={item.id} style={{
                      position: 'absolute', left: 0, right: 0,
                      top: cardPos.at[item.id]?.top ?? 0,
                      height: cardPos.at[item.id]?.height,
                    }}>
                    <div data-card={item.id} style={{ position: 'sticky', top: 66, overflow: 'visible' }}>
                    <div style={{
                      // 끝난 건도 내용을 그대로 읽어야 하니 흐리게 하지 않고, 테두리·바탕만 초록으로 물들인다.
                      border: pr.done ? '1px solid #27ae6055' : `1px solid ${color}40`,
                      borderLeft: pr.done ? '4px solid #27ae60' : `4px solid ${color}`,
                      borderRadius: 10, overflow: 'hidden',
                      background: pr.done ? '#f2fbf6' : '#fff',
                      transition: 'background 0.15s',
                    }}>
                      <div style={{
                        // 접힌 카드는 표의 접힌 덩어리 머리줄과 높이를 맞춘다.
                        padding: folded ? '5px 8px' : '6px 8px', whiteSpace: 'nowrap',
                        background: pr.done ? '#e3f6ec' : `${color}1c`,
                        borderBottom: folded ? 'none' : pr.done ? '1px solid #27ae6033' : `1px solid ${color}2e`,
                      }}>
                        {/* 센터·날짜·발주 수·수량, 체크 칸과 접기는 왼쪽 표 머리줄에 있어 카드에는 진행 상태만 둔다. */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
                          <span style={{ fontSize: 12, fontWeight: 800, color }} title={`출고번호 ${item.id} · ${item.center} · ${item.date}`}>{item.bundle}</span>
                          {/* 거의 안 쓰는 삭제는 작은 휴지통으로 번호 옆에 둔다. */}
                          <button
                            onClick={() => remove(item)}
                            title={'이 출고 건을 지워요. 발주 줄도 쿠팡발주확인으로 돌아가지 않고 같이 사라져요.\n쿠팡이 발주를 취소했거나 실수로 두 번 만든 건일 때만 쓰세요.\n발주확인으로 되돌리려면 "← 발주확인으로"를 누르세요. (지워도 ↶ 되돌리기로 살릴 수 있어요)'}
                            style={{
                              padding: '0 3px', fontSize: 13, lineHeight: 1, opacity: 0.4,
                              background: 'transparent', border: 'none', cursor: 'pointer',
                            }}
                            onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                            onMouseLeave={e => (e.currentTarget.style.opacity = '0.4')}
                          >
                            🗑
                          </button>
                          {(() => {
                            const doneN = item.lines.filter(l => lineReady(item, l)).length;
                            const all = item.lines.length > 0 && doneN === item.lines.length;
                            return (
                              <span title="준비됨으로 체크한 상품 줄 수" style={{
                                padding: '1px 8px', fontSize: 11, fontWeight: 800, borderRadius: 999,
                                // 준비 중은 한중 뱃지처럼 흰 바탕에 초록 테두리, 다 끝나면 초록 바탕.
                                color: all ? '#fff' : '#27ae60', background: all ? '#27ae60' : '#fff', border: '1px solid #27ae60',
                              }}>
                                {all ? '✓ 준비 끝' : `준비 ${doneN}/${item.lines.length}`}
                              </span>
                            );
                          })()}
                          <span style={{
                            marginLeft: 'auto', padding: '1px 10px', fontSize: 15, fontWeight: 900, color: '#333',
                            background: '#fff', border: '1.5px solid #d5d5d5', borderRadius: 12, lineHeight: 1.3,
                          }} title="이 건의 택배 박스 수">
                            📦 {boxCountOf(item)}박스
                          </span>
                        </div>

                        {!folded && pr.reserved && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 5, flexWrap: 'wrap', fontSize: 11 }}>
                            <span style={{ color: '#666', fontWeight: 700 }}>{item.batchId}</span>
                            <Chip on label="예약" />
                            <Chip on={pr.allWaybilled} label={pr.waybills > 0 ? `운송장 ${pr.waybills}건` : '운송장'} />
                            <Chip on={pr.formSaved} label="양식저장" />
                          </div>
                        )}

                        {/* 앞뒤 단계로 보내기: 왼쪽은 발주확인으로 되돌리기, 오른쪽은 발송대기로 넘기기(같은 모양). 가운데는 쉽먼트업로드. */}
                        {!folded && (<>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 5, flexWrap: 'wrap' }}>
                          <button
                            onClick={() => restore(item)}
                            title="이 출고를 취소하고 쿠팡발주확인 발송 목록으로 되돌립니다"
                            style={stageBtn(false)}
                          >
                            ← 발주확인으로
                          </button>
                          {pr.reserved && !pr.done && (
                            <button
                              onClick={() => shubForItem(item)}
                              title="이 건의 발주건만으로 서허 쉽먼트 양식을 받아 채웁니다"
                              style={{
                                padding: '2px 8px', fontSize: 11, fontWeight: 700, borderRadius: 5, cursor: 'pointer',
                                border: '1.5px solid #e67e22', background: '#fff', color: '#e67e22',
                              }}
                            >
                              쉽먼트업로드
                            </button>
                          )}
                          <button
                            onClick={() => toggleDone(item)}
                            title={pr.done ? '발송대기로 보낸 것을 풀고 다시 할 수 있게 합니다' : '쉽먼트를 다 만들었으면 눌러서 발송대기로 보냅니다'}
                            style={{ ...stageBtn(pr.done), marginLeft: 'auto' }}
                          >
                            {pr.done ? '발송대기 ✓' : '발송대기로 →'}
                          </button>
                        </div>

                        </>)}
                      </div>

                      {!folded && boxList.map(([boxNo, orders]) => {
                        const bc = pr.done ? '#27ae60' : PENDING_BOX;
                        const boxQty = Array.from(orders.values()).flat().reduce((s, l) => s + (Number(l.확정수량) || 0), 0);
                        return (
                          <div key={boxNo}>
                            <div style={{
                              display: 'flex', alignItems: 'center', gap: 6, padding: '3px 8px',
                              background: `${bc}12`, borderTop: `1px solid ${bc}33`, borderLeft: `3px solid ${bc}`, fontSize: 11,
                            }}>
                              <span style={{ padding: '0 7px', fontWeight: 800, borderRadius: 8, color: bc, background: '#fff', border: `1.5px solid ${bc}` }}>
                                📦 {boxNo ? `박스${boxNo}` : '박스 미지정'}
                              </span>
                              {!!boxNo && !!waybillOf(item, boxNo) && (
                                <span style={{ fontWeight: 800, color: '#333', fontFamily: 'monospace' }} title="이 박스의 롯데 운송장번호">🚚 {waybillOf(item, boxNo)}</span>
                              )}
                              <span style={{ marginLeft: 'auto', color: '#888', fontWeight: 700 }}>발주 {orders.size} · {boxQty.toLocaleString()}개</span>
                            </div>
                            {Array.from(orders.entries()).map(([orderNo, lines]) => {
                              const key = `${item.id}|${boxNo}|${orderNo}`;
                              const open = opened.has(key);
                              const sum = lines.reduce((s, l) => s + (Number(l.확정수량) || 0), 0);
                              return (
                                <div key={key} style={{ borderTop: '1px solid #f3f3f3' }}>
                                  <div
                                    onClick={() => toggle(key)}
                                    title="눌러서 상품 목록 보기"
                                    style={{
                                      display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px',
                                      cursor: 'pointer', whiteSpace: 'nowrap', fontSize: 11,
                                    }}
                                  >
                                    <span style={{ width: 8, color: '#ccc', fontSize: 9 }}>{open ? '▾' : '▸'}</span>
                                    <span style={{ fontWeight: 700, color: '#333' }}>{orderNo}</span>
                                    <span style={{ color: '#aaa' }}>{lines[0].입고예정일.slice(5).replace('-', '/')}</span>
                                    {item.shipmentNos?.[orderNo] && (
                                      <span title="서허 쉽먼트 번호" style={{ padding: '0 6px', borderRadius: 999, fontWeight: 800, color: '#0369a1', background: '#f0f9ff', border: '1px solid #7dd3fc' }}>
                                        쉽먼트 {item.shipmentNos[orderNo]}
                                      </span>
                                    )}
                                    <span style={{ marginLeft: 'auto', color: '#bbb' }}>{lines.length}품목</span>
                                    <span style={{ fontWeight: 700, color: '#333', minWidth: 36, textAlign: 'right' }}>{sum.toLocaleString()}개</span>
                                  </div>
                                  {open && (
                                    <div style={{ padding: '2px 8px 6px 26px', background: '#fcfcfd' }}>
                                      {lines.map((line, i) => (
                                        <div key={`${line.상품이름}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '1px 0', fontSize: 11 }}>
                                          <span title={line.상품이름} style={{ flex: 1, color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {line.상품이름}
                                          </span>
                                          <span style={{ color: '#333', fontWeight: 700, minWidth: 28, textAlign: 'right' }}>
                                            {line.확정수량 !== '' ? line.확정수량 : ''}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                            );
                          })}
                          </div>
                        );
                      })}
                    </div>
                    </div>
                    </div>
                  );
                })}
              </div>
            </div>}

            {/* 예약 자리(쿠팡발주확인과 폭을 맞추기 위해 비워 둔다) */}
            {!isMobile && <div />}
          </div>
        )}

        {shubStatus && (
          <div style={{ marginTop: 18, padding: '8px 12px', background: '#eff6ff', color: '#1d4ed8', borderRadius: 8, fontSize: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ flex: 1 }}>{shubStatus}</span>
            {shubBatch && (
              <button onClick={() => pickFormFile(shubBatch)} style={{ padding: '4px 10px', border: 'none', borderRadius: 6, background: '#2980b9', color: '#fff', fontSize: 12, cursor: 'pointer' }} title="다운로드 폴더에 받아진 양식 파일을 직접 골라 채웁니다">
                양식 직접 고르기
              </button>
            )}
            {shubForm && (
              <button onClick={saveShubForm} style={{ padding: '4px 10px', border: 'none', borderRadius: 6, background: '#95a5a6', color: '#fff', fontSize: 12, cursor: 'pointer' }} title="서허에서 받은 원본(빈 양식)">
                빈 양식 저장
              </button>
            )}
            <button onClick={() => setShubStatus(null)} style={{ border: 'none', background: 'transparent', color: '#94a3b8', cursor: 'pointer' }}>×</button>
          </div>
        )}

        <ShipmentList
          batches={batches}
          onWaybills={setWaybillBatch}
          onShubForm={handleShubForm}
          onDelete={removeBatches}
        />
      </main>

      {showAddressManager && (
        <AddressManager
          addresses={addresses}
          onUpdate={handleAddressUpdate}
          onClose={() => setShowAddressManager(false)}
        />
      )}

      {showSenderManager && (
        <SenderManager
          sender={sender}
          onUpdate={handleSenderUpdate}
          onClose={() => setShowSenderManager(false)}
        />
      )}

      {datePick && (
        <div
          onClick={() => setDatePick(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div onClick={e => e.stopPropagation()} style={{ width: 300, background: '#fff', borderRadius: 12, padding: 18, boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>입고예정일 바꾸기</div>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 12 }}>
              {datePick.item.bundle} · {datePick.item.center} · 발주 {new Set(datePick.item.lines.map(l => l.발주번호)).size}건
              <br />서허(쿠팡)에 나오는 입고예정일과 같게 맞춰 주세요.
            </div>
            <input
              type="date"
              value={datePick.date}
              autoFocus
              onChange={e => setDatePick(prev => prev && { ...prev, date: e.target.value })}
              onKeyDown={e => { if (e.key === 'Enter') saveDatePick(); }}
              style={{ display: 'block', width: '100%', padding: '7px 10px', fontSize: 14, borderRadius: 8, border: '1px solid #ddd', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button onClick={() => setDatePick(null)} style={{ padding: '6px 14px', fontSize: 13, background: '#f3f3f3', border: 'none', borderRadius: 6, cursor: 'pointer' }}>취소</button>
              <button
                onClick={saveDatePick}
                disabled={!datePick.date}
                style={{ padding: '6px 14px', fontSize: 13, fontWeight: 700, color: '#fff', background: '#2980b9', border: 'none', borderRadius: 6, cursor: 'pointer' }}
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}

      {reqPick && (
        <div
          onClick={() => setReqPick(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div onClick={e => e.stopPropagation()} style={{ width: 320, background: '#fff', borderRadius: 12, padding: 18, boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>요청등록중</div>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 12 }}>
              {reqPick.item.bundle} · 지금 {reqPick.item.center} · {reqPick.item.date}
              <br />쿠팡에 요청한 센터·입고예정일을 골라 저장하세요. 승인되면 <b>승인</b>을 눌러 이 값으로 바꿔요.
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#555', marginBottom: 4 }}>센터</div>
            <input
              list="req-centers"
              value={reqPick.center}
              autoFocus
              onChange={e => setReqPick(prev => prev && { ...prev, center: e.target.value })}
              onKeyDown={e => { if (e.key === 'Enter') saveReqPick(); }}
              style={{ display: 'block', width: '100%', padding: '7px 10px', fontSize: 14, borderRadius: 8, border: '1px solid #ddd', boxSizing: 'border-box', marginBottom: 10 }}
            />
            <datalist id="req-centers">
              {Array.from(new Set([...addresses.map(a => a.key), ...list.map(i => i.center)].map(c => c.trim()).filter(Boolean)))
                .sort((a, b) => a.localeCompare(b, 'ko', { numeric: true }))
                .map(c => <option key={c} value={c} />)}
            </datalist>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#555', marginBottom: 4 }}>입고예정일</div>
            <input
              type="date"
              value={reqPick.date}
              onChange={e => setReqPick(prev => prev && { ...prev, date: e.target.value })}
              onKeyDown={e => { if (e.key === 'Enter') saveReqPick(); }}
              style={{ display: 'block', width: '100%', padding: '7px 10px', fontSize: 14, borderRadius: 8, border: '1px solid #ddd', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16 }}>
              {reqPick.item.request && (
                <button onClick={() => clearReq(reqPick.item)} style={{ padding: '6px 10px', fontSize: 12, color: '#dc2626', background: '#fff', border: '1px solid #f5c2c2', borderRadius: 6, cursor: 'pointer' }}>
                  요청 끄기
                </button>
              )}
              {reqPick.item.request && (
                <button
                  onClick={approveReq}
                  disabled={!reqPick.center.trim() || !reqPick.date}
                  title="쿠팡이 요청을 승인했으면 눌러서 센터·입고예정일을 이 값으로 바꿉니다"
                  style={{ padding: '6px 12px', fontSize: 13, fontWeight: 700, color: '#fff', background: '#27ae60', border: 'none', borderRadius: 6, cursor: 'pointer' }}
                >
                  ✓ 승인
                </button>
              )}
              <button onClick={() => setReqPick(null)} style={{ marginLeft: 'auto', padding: '6px 14px', fontSize: 13, background: '#f3f3f3', border: 'none', borderRadius: 6, cursor: 'pointer' }}>취소</button>
              <button
                onClick={saveReqPick}
                disabled={!reqPick.center.trim() || !reqPick.date}
                style={{ padding: '6px 14px', fontSize: 13, fontWeight: 700, color: '#fff', background: '#dc2626', border: 'none', borderRadius: 6, cursor: 'pointer' }}
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}

      {splitting && (() => {
        const sum = splitting.pieces.reduce((n, p) => n + (Math.floor(Number(p.qty) || 0)), 0);
        const left = splitting.total - sum;
        // 이 묶음에 있는 박스 + 창에서 고른 박스까지만 목록에 보여준다.
        const boxMax = Math.max(0, ...rows.filter(r => !r.isBlank && r.묶음 === splitting.row.묶음).map(r => parseBoxNo(r.쉼먼트) || 0), ...splitting.pieces.map(p => p.no));
        const setPiece = (i: number, patch: Partial<{ no: number; qty: string }>) =>
          setSplitting(prev => prev && { ...prev, pieces: prev.pieces.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
        return (
          <div
            onClick={() => setSplitting(null)}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <div onClick={e => e.stopPropagation()} style={{ width: 380, background: '#fff', borderRadius: 12, padding: 18, boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
              <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>박스 나누기</div>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 12 }}>
                {splitting.row.상품이름} · 전체 <b>{splitting.total}개</b>
              </div>
              {splitting.pieces.map((p, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <BoxPicker
                    value={`박스${p.no}`}
                    maxNo={boxMax}
                    allowNone={false}
                    onChange={v => setPiece(i, { no: parseBoxNo(v) || p.no })}
                  />
                  <input
                    type="number"
                    min={0}
                    value={p.qty}
                    placeholder="수량"
                    autoFocus={i === splitting.pieces.length - 1}
                    onChange={e => setPiece(i, { qty: e.target.value })}
                    onKeyDown={e => { if (e.key === 'Enter') saveSplit(); }}
                    style={{ width: 90, padding: '5px 8px', fontSize: 13, borderRadius: 6, border: '1px solid #ddd', textAlign: 'right' }}
                  />
                  <span style={{ fontSize: 12, color: '#888' }}>개</span>
                  <button
                    onClick={() => setSplitting(prev => prev && { ...prev, pieces: prev.pieces.filter((_, j) => j !== i) })}
                    disabled={splitting.pieces.length <= 1}
                    title="이 박스 줄 빼기"
                    style={{ marginLeft: 'auto', padding: '2px 8px', fontSize: 12, color: '#c0392b', background: '#fff', border: '1px solid #f0c4c0', borderRadius: 5, cursor: 'pointer' }}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                onClick={() => setSplitting(prev => prev && {
                  ...prev,
                  pieces: [...prev.pieces, { no: Math.min(9, Math.max(0, ...prev.pieces.map(p => p.no)) + 1), qty: left > 0 ? String(left) : '' }],
                })}
                style={{ padding: '4px 10px', fontSize: 12, color: '#2980b9', background: '#fff', border: '1px dashed #2980b9', borderRadius: 6, cursor: 'pointer' }}
              >
                + 박스 추가
              </button>
              <div style={{ marginTop: 12, fontSize: 12, fontWeight: 700, color: left === 0 ? '#27ae60' : '#c0392b' }}>
                합계 {sum}개 / {splitting.total}개{left > 0 ? ` · ${left}개 남음` : left < 0 ? ` · ${-left}개 넘침` : ' ✓'}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
                <button onClick={() => setSplitting(null)} style={{ padding: '6px 14px', fontSize: 13, background: '#f3f3f3', border: 'none', borderRadius: 6, cursor: 'pointer' }}>취소</button>
                <button
                  onClick={saveSplit}
                  disabled={left !== 0}
                  style={{ padding: '6px 14px', fontSize: 13, fontWeight: 700, color: '#fff', background: left === 0 ? '#2980b9' : '#a9c6dc', border: 'none', borderRadius: 6, cursor: left === 0 ? 'pointer' : 'default' }}
                >
                  저장
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {waybillBatch && (
        <ShipmentWaybillModal batch={waybillBatch} onClose={() => setWaybillBatch(null)} />
      )}
    </div>
  );
}

// 진행 상태 칩. 켜지면 초록, 아직이면 회색.
function Chip({ on, label }: { on: boolean; label: string }) {
  return (
    <span style={{
      padding: '1px 7px', borderRadius: 10, fontSize: 10, fontWeight: 700,
      color: on ? '#27ae60' : '#aaa',
      background: on ? '#e8f8f0' : '#f4f4f5',
      border: `1px solid ${on ? '#b7e0c7' : '#e8e8e8'}`,
    }}>
      {on ? '✓ ' : ''}{label}
    </span>
  );
}

// 되돌리기·다시실행 단추. 할 일이 없으면 흐리게 두고 누를 수 없게 한다.
const stepBtn = (on: boolean): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px',
  fontSize: 12, fontWeight: 600,
  color: on ? '#555' : '#c8c8c8',
  background: '#fff',
  border: `1px solid ${on ? '#e0e0e0' : '#f2f2f2'}`,
  borderRadius: 7,
  cursor: on ? 'pointer' : 'default',
});

const plainBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
  fontSize: 12, color: '#666', background: 'none',
  border: '1px solid #e5e5e5', borderRadius: 8, cursor: 'pointer',
};
