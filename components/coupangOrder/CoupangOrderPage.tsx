import React, { useState, useCallback, useEffect, useMemo } from 'react';
import FileUpload from './components/FileUpload';
import CollectPurchaseOrders from './CollectPurchaseOrders';
import OrderTable from './components/OrderTable';
import {
  parseFile, buildDisplayRows, extractOrderRows, sortOrderRows, boxLabel, pickNewByCount,
} from './utils/dataProcessor';
import type { DisplayRow } from './utils/dataProcessor';
import { exportSummaryExcel } from './utils/excelExport';
import { printPanel } from './utils/printUtils';
import type { AddressEntry } from './types';
import { loadLocalAddresses, subscribeShippingSettings } from './data/shippingSettingsStore';
import { subscribeReservations, addReservations, updateReservationShipment, updateReservations, deleteReservations, reservationKey, setReservationMemo } from './data/reservationStore';
import type { OrderRow } from './types';
import { dateKeyYMD, normalizeDateValue, ymdSortKey } from './utils/dateUtils';
import { InventoryItem, subscribeInventory, makeOfficeLookup } from '../../data/inventoryStore';
import BundlePanel from './components/BundlePanel';
import { addShipOut, allShipOutLines, shipOutLineKeys, subscribeShipOuts, snapshotShipOuts, restoreShipOutsOnly } from './data/shipOutStore';
import { loadWork, saveWork, subscribeWork, newOrderNos } from './data/orderWorkStore';
import { useReady } from './data/readyStore';
import { HanjungQueueItem, subscribeHanjungQueue, addToHanjungQueue, removeFromHanjungQueue, hanjungQueueKey } from './data/hanjungQueueStore';
import { forceUploadWork } from './data/orderWorkCloud';
import { forceUploadShipOuts } from './data/shipOutStore';
import { isFirebaseConfigured, waitAtMost } from '../../utils/firebase';

// 화면 한 줄 → 원래 발주 한 건(줄였던 발주번호·물류센터·날짜를 되살림).
const toOrderRow = (r: DisplayRow): OrderRow => ({
  발주번호: r._발주번호,
  물류센터: r._물류센터,
  상품이름: r.상품이름,
  확정수량: r.확정수량,
  입고예정일: r._입고예정일,
  메모: r.메모,
  쉼먼트: r.쉼먼트,
  묶음: r.묶음 || '',
  SKU: r.SKU || '',
});

// 화면 줄의 id는 목록을 다시 만들 때마다 순번이 새로 매겨진다. 확인 창을 띄운 사이 클라우드 저장·정렬로 목록이
// 다시 만들어지면 같은 id가 다른 줄을 가리킬 수 있어서, 줄을 고칠 때는 id 대신 내용(발주번호·상품·수량·입고예정일)으로 찾는다.
const sameLine = (a: DisplayRow, b: DisplayRow) =>
  !a.isBlank && !b.isBlank && a._발주번호 === b._발주번호 && a.상품이름 === b.상품이름
  && String(a.확정수량) === String(b.확정수량) && dateKeyYMD(a._입고예정일) === dateKeyYMD(b._입고예정일);
// 목록에서 그 줄 하나만 뺀다(똑같은 줄이 둘이면 첫 번째 하나만).
const withoutLine = (rows: DisplayRow[], target: DisplayRow) => {
  const i = rows.findIndex(r => sameLine(r, target));
  return i < 0 ? rows : [...rows.slice(0, i), ...rows.slice(i + 1)];
};

// ── 되돌리기(실행취소) ──
// 일을 하기 직전의 발송 목록·묶음 완료·예약 목록을 통째로 찍어 둔다. 쉽먼트생성으로 보낸 일이면 출고 목록도 같이.
// 화면을 옮겨 다녀와도 남도록 컴포넌트 밖에 둔다(새로고침하면 사라진다).
interface OrderSnap { rows: DisplayRow[]; fileName: string; done: string[]; reservations: OrderRow[]; ship?: string }
interface OrderStep { label: string; snap: OrderSnap }
const history: { undo: OrderStep[]; redo: OrderStep[] } = { undo: [], redo: [] };

const alertError = (err: unknown) => alert(`예약 저장 실패: ${err instanceof Error ? err.message : String(err)}`);


// 발주 > 쿠팡발주확인. 쿠팡 발주서(엑셀/CSV)를 올려 발송·예약으로 나누고,
// 발주서정리 엑셀과 롯데택배 업로드 엑셀을 만든다. (원래 '쉽먼트' 앱을 그대로 옮겨온 것)
// 예약 패널은 저장소(data/reservationStore)에 계속 쌓이고, 삭제 버튼을 눌러야만 지워진다.
export default function CoupangOrderPage({ onGoShipOut }: { onGoShipOut?: () => void } = {}) {
  const [initialWork] = useState(loadWork);
  const [leftRows, setLeftRows] = useState<DisplayRow[]>(initialWork.rows);
  const [reservations, setReservations] = useState<OrderRow[]>([]);
  const rightRows = useMemo(() => buildDisplayRows(reservations), [reservations]);
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState(initialWork.fileName);
  const [addresses, setAddresses] = useState<AddressEntry[]>(loadLocalAddresses);
  // 쉽먼트생성으로 만든 택배 묶음(박스 배정 기록). 운송장번호를 여기에 채운다.
  // B단계(서허 양식 받기) 진행 문구와, 받아온 양식 파일.
  // 지금 B·C를 진행 중인 쉽먼트(양식을 직접 골라 채울 때 쓴다).
  // 재고 > 상품관리의 사무실 재고. 발주서 상품이름과 상품명을 맞춰 확정수량 옆에 보여준다.
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const officeQtyOf = useMemo(() => makeOfficeLookup(inventory), [inventory]);
  const [error, setError] = useState('');
  // 발주서를 이어 붙인 결과 같은 알림(오류가 아니어서 따로 둔다).
  const [notice, setNotice] = useState('');
  // 일 다 본 묶음(택배까지 부친 묶음). 체크해 두면 카드 불이 꺼진다.
  const [doneBundles, setDoneBundles] = useState<Set<string>>(() => new Set(initialWork.done));
  // 발송·묶음 패널 접기. 접으면 제목줄만 남고 옆 패널이 넓어진다.
  const [folded, setFolded] = useState<{ send: boolean; bundle: boolean }>({ send: false, bundle: false });
  // 묶기 후보로 체크한 발주서들(발주번호). 묶기는 발주서 단위라서 그 번호의 줄이 통째로 담긴다.
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // 예약 표에서 고른 발주서들(발주번호). 예약은 발주서 통째로 다루고, 줄 id(순번)로 기억하면 다른 컴퓨터에서
  // 예약이 더해지거나 빠질 때 순번이 밀려 엉뚱한 발주서가 골라진 채로 남을 수 있어서 발주번호로 기억한다.
  const [pickedResOrders, setPickedResOrders] = useState<Set<string>>(new Set());
  // 표에 넘기는 값: 고른 발주서의 지금 줄 id들.
  const pickedRes = useMemo(
    () => new Set(rightRows.filter(r => !r.isBlank && pickedResOrders.has(r._발주번호)).map(r => r.id)),
    [rightRows, pickedResOrders],
  );
  const [lastResPick, setLastResPick] = useState('');
  const toggleResLine = useCallback((id: string, checked: boolean) => {
    const row = rightRows.find(r => r.id === id);
    if (!row) return;
    if (checked) setLastResPick(row._발주번호);
    setPickedResOrders(prev => {
      const next = new Set(prev);
      if (checked) next.add(row._발주번호); else next.delete(row._발주번호);
      return next;
    });
  }, [rightRows]);
  // 예약 목록에서 사라진 발주서는 고른 데서 뺀다.
  useEffect(() => {
    setPickedResOrders(prev => {
      const alive = new Set(rightRows.map(r => r._발주번호));
      const next = new Set(Array.from(prev).filter(no => alive.has(no)));
      return next.size === prev.size ? prev : next;
    });
  }, [rightRows]);


  useEffect(() => subscribeReservations(setReservations), []);

  // 한중발주 대기(1688에 주문할 줄). 발송 목록의 "한중" 버튼으로 넣고 뺀다. 예약과 따로라 줄이 어디로 가든 대기에 남는다.
  const [hanjungQueue, setHanjungQueue] = useState<HanjungQueueItem[]>([]);
  useEffect(() => subscribeHanjungQueue(setHanjungQueue), []);
  const hanjungKeys = useMemo(() => new Set(hanjungQueue.map(q => q.key)), [hanjungQueue]);
  // 상품 준비 체크(여기서 체크한 게 쉽먼트생성대기·발송대기까지 그대로 간다).
  const ready = useReady();

  // 되돌리기: 버튼·단축키가 늘 지금 값을 보도록 ref로 들고 있는다.
  const nowRef = React.useRef({ leftRows, fileName, doneBundles, reservations });
  nowRef.current = { leftRows, fileName, doneBundles, reservations };
  const [, setHistTick] = useState(0);
  const takeSnap = (ship: boolean): OrderSnap => {
    const n = nowRef.current;
    return { rows: n.leftRows, fileName: n.fileName, done: Array.from(n.doneBundles), reservations: n.reservations, ship: ship ? snapshotShipOuts().shipOuts : undefined };
  };
  // 목록을 바꾸기 직전에 부른다. 새 일을 하면 다시실행 목록은 비운다. 서른 걸음까지 기억한다.
  const record = useCallback((label: string, ship = false) => {
    history.undo = [...history.undo, { label, snap: takeSnap(ship) }].slice(-30);
    history.redo = [];
    setHistTick(t => t + 1);
  }, []);
  // 스냅샷대로 되돌려 놓는다. 예약은 클라우드에 있어서 지금과 다른 것만 지우고·더하고·고친다.
  const applySnap = (snap: OrderSnap) => {
    const cur = nowRef.current.reservations;
    setLeftRows(snap.rows);
    setFileName(snap.fileName);
    setDoneBundles(new Set(snap.done));
    if (snap.ship !== undefined) restoreShipOutsOnly(snap.ship);
    const want = new Map(snap.reservations.map(r => [reservationKey(r), r]));
    const have = new Map<string, OrderRow>(cur.map(r => [reservationKey(r), r]));
    const jobs: Promise<unknown>[] = [];
    const gone = cur.filter(r => !want.has(reservationKey(r)));
    if (gone.length) jobs.push(deleteReservations(gone));
    const back = snap.reservations.filter(r => !have.has(reservationKey(r)));
    if (back.length) jobs.push(addReservations(back, cur));
    for (const r of snap.reservations) {
      const h = have.get(reservationKey(r));
      if (!h) continue;
      if ((h.메모 || '') !== (r.메모 || '')) jobs.push(setReservationMemo([r], r.메모 || ''));
      if ((h.쉼먼트 || '') !== (r.쉼먼트 || '')) jobs.push(updateReservationShipment(r, r.쉼먼트 || ''));
      if ((h.묶음 || '') !== (r.묶음 || '') || (h.묶음센터 || '') !== (r.묶음센터 || '') || (h.묶음일자 || '') !== (r.묶음일자 || '')) {
        jobs.push(updateReservations([r], { 묶음: r.묶음 || '', 묶음센터: r.묶음센터 || '', 묶음일자: r.묶음일자 || '' }));
      }
    }
    Promise.all(jobs).catch(alertError);
  };
  const undo = () => {
    const last = history.undo.pop();
    if (!last) return;
    history.redo.push({ label: last.label, snap: takeSnap(last.snap.ship !== undefined) });
    applySnap(last.snap);
    setHistTick(t => t + 1);
    setNotice(`되돌렸어요: ${last.label}`);
  };
  const redo = () => {
    const last = history.redo.pop();
    if (!last) return;
    history.undo.push({ label: last.label, snap: takeSnap(last.snap.ship !== undefined) });
    applySnap(last.snap);
    setHistTick(t => t + 1);
    setNotice(`다시 했어요: ${last.label}`);
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
  // 택배주소·보내는사람은 클라우드에 저장돼 있어 다른 컴퓨터에서 고친 것도 바로 반영된다.
  useEffect(() => subscribeInventory(setInventory), []);
  // 택배주소는 묶음 카드에서 센터를 고를 때 쓴다(보내는사람·주소 관리는 쉽먼트생성 화면에 있다).
  useEffect(() => subscribeShippingSettings(({ addresses }) => setAddresses(addresses)), []);
  useEffect(() => saveWork(leftRows, fileName, Array.from(doneBundles)), [leftRows, fileName, doneBundles]);
  // 작업 목록은 클라우드에 있어서 다른 컴퓨터에서 고친 것도 바로 내려온다(쉽먼트생성에서 줄을
  // 되돌려 보낼 때도 이 길로 들어온다).
  useEffect(() => subscribeWork(() => {
    const w = loadWork();
    setLeftRows(w.rows);
    setFileName(w.fileName);
    setDoneBundles(new Set(w.done));
    setNewNos(newOrderNos());
  }), []);
  // 새로 들어온 발주서(24시간 동안 NEW). 시간이 지나면 저절로 꺼지게 1분마다 다시 본다.
  const [newNos, setNewNos] = useState<Set<string>>(newOrderNos);
  useEffect(() => {
    const t = setInterval(() => setNewNos(newOrderNos()), 60 * 1000);
    return () => clearInterval(t);
  }, []);

  const hasFile = leftRows.length > 0;
  const hasData = hasFile || rightRows.length > 0;

  // 발주서를 올리면 지금 목록을 지우지 않고 아래쪽에 이어 붙인다(출고할 때까지 계속 봐야 하므로).
  // 이미 있는 줄(발주번호·상품·수량·입고예정일이 같은 줄)과 예약으로 넘긴 줄은 건너뛴다.
  const handleFile = useCallback(async (file: File) => {
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const rows = await parseFile(file);
      if (rows.length === 0) {
        setError('데이터를 찾을 수 없습니다. 헤더가 올바른지 확인해주세요.');
      } else {
        const existing = extractOrderRows(leftRows);
        // 발송 목록·예약·쉽먼트(발송 완료 포함)에 이미 있는 줄은 발주번호 + 상품이름의 개수로 맞춰 거른다
        // (날짜·센터·수량은 앱과 서허에서 따로 바뀔 수 있어 보지 않는다).
        const fresh = pickNewByCount(sortOrderRows(rows), [...existing, ...reservations, ...allShipOutLines()]);
        if (fresh.length) record('발주서 추가');
        const next = buildDisplayRows([...existing, ...fresh]);
        setLeftRows(next);
        // 새 발주번호를 NEW로 적어 두려고 바로 저장한다.
        saveWork(next, file.name, Array.from(nowRef.current.doneBundles), fresh.map(r => r.발주번호));
        setFileName(file.name);
        const skipped = rows.length - fresh.length;
        setNotice(fresh.length
          ? `${fresh.length}건 추가` + (skipped > 0 ? ` / 중복 ${skipped}건 제외` : '')
          : `추가 0건 / 중복 ${rows.length}건 제외`);
      }
    } catch (e) {
      setError('파일 처리 중 오류가 발생했습니다: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setLoading(false);
    }
  }, [leftRows, reservations]);

  // 발송 쪽에서 "예약"을 누르면 그 줄을 바로 예약 목록으로 넘긴다(발송 목록에서는 곧바로 빼고,
  // 저장에 실패하면 다시 돌려놓는다). 줄 id는 목록을 다시 만들 때마다 바뀌므로 누른 순간의 줄을 잡아 둔다.
  const handleLeftMemoChange = useCallback((id: string, value: string) => {
    const row = leftRows.find(r => r.id === id);
    if (!row) return;
    if (!value.includes('예약') && !value.includes('대기')) {
      setLeftRows(prev => prev.map(r => sameLine(r, row) ? { ...r, 메모: value } : r));
      return;
    }
    record(value.includes('대기') ? '대기로 넘기기' : '예약으로 넘기기');
    const order = { ...toOrderRow(row), 메모: value.includes('대기') ? '대기' : '예약' };
    setLeftRows(prev => buildDisplayRows(extractOrderRows(withoutLine(prev, row))));
    addReservations([order], reservations).catch(err => {
      alertError(err);
      setLeftRows(prev => buildDisplayRows(sortOrderRows([...extractOrderRows(prev), { ...order, 메모: '' }])));
    });
  }, [leftRows, reservations]);

  // 예약/대기는 발주서 통째로만 한다(쿠팡에서 발주서의 상품별로는 예약할 수 없어서). 그 발주서의 줄을 모두 예약 목록으로 넘긴다.
  const handleOrderMemoChange = useCallback((orderNo: string, value: string) => {
    const mine = leftRows.filter(r => !r.isBlank && r._발주번호 === orderNo);
    if (!mine.length) return;
    if (!value.includes('예약') && !value.includes('대기')) {
      setLeftRows(prev => prev.map(r => r._발주번호 === orderNo ? { ...r, 메모: value } : r));
      return;
    }
    const memo = value.includes('대기') ? '대기' : '예약';
    record(`발주 ${orderNo} ${memo}로 넘기기`);
    const orders = mine.map(r => ({ ...toOrderRow(r), 메모: memo }));
    setLeftRows(prev => buildDisplayRows(extractOrderRows(prev.filter(r => r.isBlank || r._발주번호 !== orderNo))));
    addReservations(orders, reservations).catch(err => {
      alertError(err);
      setLeftRows(prev => buildDisplayRows(sortOrderRows([...extractOrderRows(prev), ...orders.map(o => ({ ...o, 메모: '' }))])));
    });
  }, [leftRows, reservations]);

  // 발송 목록에서 상품 줄 하나를 지운다. 되돌리기로 살릴 수 있다.
  const handleDeleteLeftLine = useCallback((id: string) => {
    const row = leftRows.find(r => r.id === id);
    if (!row || row.isBlank) return;
    if (!confirm(`발주 ${row._발주번호}의 "${row.상품이름}" 줄을 발송 목록에서 지울까요?\n(되돌리기로 살릴 수 있어요)`)) return;
    record(`발주 ${row._발주번호} 상품 1줄 삭제`);
    setLeftRows(prev => buildDisplayRows(extractOrderRows(withoutLine(prev, row))));
  }, [leftRows]);

  const handleToggleHanjung = useCallback((id: string) => {
    const row = leftRows.find(r => r.id === id);
    if (!row || row.isBlank) return;
    const order = toOrderRow(row);
    const key = hanjungQueueKey(order);
    if (hanjungKeys.has(key)) {
      if (!confirm(`"${row.상품이름}"을 한중발주 대기에서 뺄까요?`)) return;
      removeFromHanjungQueue([key]).catch(alertError);
      return;
    }
    addToHanjungQueue([order], hanjungQueue).catch(alertError);
    setNotice(`"${row.상품이름}"을 한중발주 대기에 넣었어요.`);
  }, [leftRows, hanjungKeys, hanjungQueue]);

  // 체크한 발주서의 상품 줄을 모두 한중발주 대기에 넣는다(툴바 버튼).
  const handleSelectedToHanjung = useCallback(() => {
    const rows = leftRows.filter(r => !r.isBlank && selected.has(r._발주번호)).map(toOrderRow);
    if (!rows.length) return;
    addToHanjungQueue(rows, hanjungQueue)
      .then(n => setNotice(`한중발주 대기에 ${n}줄 넣었어요${rows.length - n ? ` (이미 있던 ${rows.length - n}줄 제외)` : ''}.`))
      .catch(alertError);
    setSelected(new Set());
  }, [leftRows, selected, hanjungQueue]);

  const handleLeftShipmentChange = useCallback((id: string, value: string) => {
    setLeftRows(prev => prev.map(r => r.id === id ? { ...r, 쉼먼트: value } : r));
  }, []);

  // 마지막으로 체크한 발주서. 그 머리줄 옆에 바로 누를 버튼을 띄운다.
  const [lastPick, setLastPick] = useState('');
  const toggleSelect = useCallback((orderNo: string, checked: boolean) => {
    if (checked) setLastPick(orderNo);
    setSelected(prev => {
      const next = new Set(prev);
      if (checked) next.add(orderNo); else next.delete(orderNo);
      return next;
    });
  }, []);

  // 체크한 줄들을 새 묶음(묶음1, 묶음2…)에 담는다. 줄은 발송 목록에 그대로 남고 묶음 표시만 붙는다.
  // 묶음은 택배 한 상자로 보낼 것들이므로 담자마자 박스1을 같이 지정해 둔다.
  // 예약 목록에서 고른 줄도 같이 묶을 수 있다. 묶은 예약 줄은 예약에서 빠져 발송 목록의 그 묶음으로 들어간다.
  const handleBundle = useCallback(() => {
    const picked = leftRows.filter(r => !r.isBlank && selected.has(r._발주번호));
    const resPicked = rightRows.filter(r => !r.isBlank && pickedRes.has(r.id));
    if (!picked.length && !resPicked.length) return;
    const centers = new Set([...picked, ...resPicked].map(r => (r._물류센터 || '').trim()).filter(Boolean));
    if (centers.size > 1 &&
      !confirm(`물류센터가 ${Array.from(centers).join(', ')}로 섞여 있어요.\n택배는 ${Array.from(centers)[0]}(으)로만 갑니다. 그래도 묶을까요?`)) return;

    // 예약 목록 안의 묶음과 이름이 겹치지 않게 둘 다 본다.
    const used = new Set([...leftRows.map(r => r.묶음), ...reservations.map(r => r.묶음)].filter(Boolean));
    let no = 1;
    while (used.has(`묶음${no}`)) no++;
    const name = `묶음${no}`;
    record(`${name} 만들기`);
    moveIntoBundle(name, boxLabel(1), resPicked);
  }, [leftRows, selected, rightRows, pickedRes, reservations]);

  // 체크한 발송 줄과 고른 예약 줄을 묶음에 넣는다. 예약 줄은 예약 목록에 그대로 두고 묶음 표시만 붙인다.
  const moveIntoBundle = (name: string, box: string, resPicked: DisplayRow[]) => {
    if (selected.size) {
      setLeftRows(prev => prev.map(r => !r.isBlank && selected.has(r._발주번호) ? { ...r, 묶음: name, 쉼먼트: box } : r));
    }
    setSelected(new Set());
    setPickedResOrders(new Set());
    if (resPicked.length) updateReservations(resPicked.map(toOrderRow), { 묶음: name, 쉼먼트: box }).catch(alertError);
  };
  // 이 묶음에 든 예약 줄들.
  const resOf = (bundle: string) => reservations.filter(r => r.묶음 === bundle);

  // 체크한 발주서들을 이미 있는 묶음에 더 담는다. 박스 지정은 그 묶음이 쓰던 값을 따라간다.
  const handleAddToBundle = useCallback((bundle: string) => {
    const picked = leftRows.filter(r => !r.isBlank && selected.has(r._발주번호));
    const resPicked = rightRows.filter(r => !r.isBlank && pickedRes.has(r.id));
    if (!picked.length && !resPicked.length) return;
    const mine = leftRows.filter(r => r.묶음 === bundle);
    const centers = new Set([...mine, ...picked, ...resPicked].map(r => (r._물류센터 || '').trim()).filter(Boolean));
    if (centers.size > 1 &&
      !confirm(`물류센터가 ${Array.from(centers).join(', ')}로 섞여 있어요.\n택배는 ${Array.from(centers)[0]}(으)로만 갑니다. 그래도 담을까요?`)) return;

    const box = mine[0]?.쉼먼트 || boxLabel(1);
    record(`${bundle}에 담기`);
    moveIntoBundle(bundle, box, resPicked);
  }, [leftRows, selected, rightRows, pickedRes]);

  // 묶음이 갈 물류센터를 직접 고른다(발주서 원래 센터는 그대로 두고 택배 주소만 바꾼다).
  const handleBundleCenter = useCallback((bundle: string, center: string) => {
    record(`${bundle} 센터 바꾸기`);
    setLeftRows(prev => prev.map(r => r.묶음 === bundle ? { ...r, 묶음센터: center } : r));
    updateReservations(nowRef.current.reservations.filter(r => r.묶음 === bundle), { 묶음센터: center }).catch(alertError);
  }, []);

  // 묶음의 입고예정일을 직접 고른다('YYYY-MM-DD'). 아직 발주서에는 반영하지 않는다.
  const handleBundleDate = useCallback((bundle: string, ymd: string) => {
    record(`${bundle} 입고예정일 바꾸기`);
    setLeftRows(prev => prev.map(r => r.묶음 === bundle ? { ...r, 묶음일자: ymd } : r));
    updateReservations(nowRef.current.reservations.filter(r => r.묶음 === bundle), { 묶음일자: ymd }).catch(alertError);
  }, []);

  // 묶음에서 고른 센터·입고예정일을 그 묶음의 발주서들에 그대로 덮어쓴다.
  // (쿠팡에서 입고센터·입고일을 바꿔 놓고, 우리 목록도 그 모습으로 맞출 때 쓴다.)
  const handleApplyBundle = useCallback((bundle: string) => {
    const resMine = resOf(bundle);
    const mine = [...leftRows.filter(r => !r.isBlank && r.묶음 === bundle), ...buildDisplayRows(resMine).filter(r => !r.isBlank)];
    if (!mine.length) return;
    const center = (mine.find(r => r.묶음센터)?.묶음센터 || mine[0]._물류센터 || '').trim();
    const days = mine.map(r => dateKeyYMD(r._입고예정일)).filter(d => d && d !== '9999-12-31');
    const baseDay = days.slice().sort((a, b) => ymdSortKey(a) - ymdSortKey(b))[0] || '';
    const ymd = (mine.find(r => r.묶음일자)?.묶음일자 || baseDay).trim();
    const orders = new Set(mine.map(r => r._발주번호));
    if (!confirm(`${bundle}에 담긴 발주 ${orders.size}건을\n\n  물류센터: ${center}\n  입고예정일: ${ymd}\n\n(으)로 바꿀까요? 발송 목록의 원래 내용이 이 값으로 바뀝니다.`)) return;

    record(`${bundle} 묶음 적용`);
    const updated = extractOrderRows(leftRows).map(r => r.묶음 === bundle
      ? { ...r, 물류센터: center, 입고예정일: ymd ? normalizeDateValue(ymd) : r.입고예정일, 묶음센터: '', 묶음일자: '' }
      : r);
    setLeftRows(buildDisplayRows(sortOrderRows(updated)));
    // 예약 줄은 입고예정일이 저장 열쇠에 들어 있어 지우고 새로 넣는다.
    if (resMine.length) {
      const moved = resMine.map(r => ({ ...r, 물류센터: center, 입고예정일: ymd ? normalizeDateValue(ymd) : r.입고예정일, 묶음센터: '', 묶음일자: '' }));
      deleteReservations(resMine).then(() => addReservations(moved, [])).catch(alertError);
    }
  }, [leftRows, reservations]);

  // 묶음을 쉽먼트생성 화면으로 넘긴다. 발주서 줄들과 묶음 정보(센터·입고예정일)가 한 쌍으로 간다.
  const handleShipOut = useCallback((bundle: string) => {
    // 발송 목록 줄과 예약 목록 안에서 묶은 줄을 함께 보낸다.
    const resMine = buildDisplayRows(resOf(bundle)).filter(r => !r.isBlank);
    const mine = [...leftRows.filter(r => !r.isBlank && r.묶음 === bundle), ...resMine];
    if (!mine.length) return;
    const center = (mine.find(r => r.묶음센터)?.묶음센터 || mine[0]._물류센터 || '').trim();
    const days = mine.map(r => dateKeyYMD(r._입고예정일)).filter(d => d && d !== '9999-12-31');
    const baseDay = days.slice().sort((a, b) => ymdSortKey(a) - ymdSortKey(b))[0] || '';
    const date = (mine.find(r => r.묶음일자)?.묶음일자 || baseDay).trim();
    const orders = new Set(mine.map(r => r._발주번호));
    if (!confirm(`${bundle}(발주 ${orders.size}건 · ${center} · ${date})을 쉽먼트생성으로 보낼까요?`)) return;

    record(`${bundle} 쉽먼트생성으로 보내기`, true);
    const item = addShipOut(bundle, center, date, mine.map(toOrderRow));
    // 보낸 줄은 발송 목록에서 뺀다(출고 화면으로 옮겨간 것이므로). 되돌리기는 출고 화면에서 한다.
    const rest = buildDisplayRows(extractOrderRows(leftRows).filter(r => r.묶음 !== bundle));
    const done: string[] = [];
    doneBundles.forEach(b => { if (b !== bundle) done.push(b); });
    setLeftRows(rest);
    setDoneBundles(new Set(done));
    // 바로 다음 줄에서 출고 화면으로 넘어가며 이 화면이 닫히므로, 저장을 미루지 않고 여기서 해 둔다.
    // (저장을 effect에 맡기면 화면이 닫히면서 빠진 줄이 다시 살아난다.)
    saveWork(rest, fileName, done);
    if (resMine.length) deleteReservations(resMine.map(toOrderRow)).catch(alertError);
    setNotice(`${item.id} · ${bundle}(발주 ${orders.size}건)을 쉽먼트생성으로 보냈어요`);
    onGoShipOut?.();
  }, [leftRows, doneBundles, fileName, onGoShipOut, reservations]);

  // 고른 줄들을 묶음 없이 바로 쉽먼트생성으로 보낸다(발송 목록·예약 목록 둘 다 쓴다). 택배는 한 센터로만
  // 가므로 물류센터·입고예정일이 같은 것끼리 출고 건 하나씩 만든다. 박스를 안 정한 줄은 박스1로 둔다.
  // 보냈으면 만든 출고번호들을, 취소했으면 null을 돌려준다.
  const shipRowsOut = (picked: DisplayRow[], what: string): string[] | null => {
    const groups = new Map<string, DisplayRow[]>();
    for (const r of picked) {
      const key = `${(r._물류센터 || '').trim()}|${dateKeyYMD(r._입고예정일)}`;
      groups.set(key, [...(groups.get(key) || []), r]);
    }
    const lines = Array.from(groups.entries()).map(([key, rows]) => {
      const [center, date] = key.split('|');
      return `  ${center} · ${date} · 발주 ${new Set(rows.map(r => r._발주번호)).size}건`;
    });
    if (!confirm(`${what}을(를) 쉽먼트생성으로 보낼까요?\n\n${lines.join('\n')}\n\n(센터·입고예정일이 같은 것끼리 한 건으로 넘어가요)`)) return null;
    record(`${what} 쉽먼트생성으로`, true);
    const made: string[] = [];
    groups.forEach((rows, key) => {
      const [center, date] = key.split('|');
      const orders = Array.from(new Set(rows.map(r => r._발주번호)));
      const name = orders.length === 1 ? orders[0] : `발주 ${orders.length}건`;
      const item = addShipOut(name, center, date, rows.map(r => ({ ...toOrderRow(r), 쉼먼트: r.쉼먼트 || boxLabel(1), 묶음: '' })));
      made.push(item.id);
    });
    return made;
  };

  // 발송 목록에서 체크한 발주서 → 쉽먼트생성.
  const handleDirectShipOut = useCallback(() => {
    const picked = leftRows.filter(r => !r.isBlank && selected.has(r._발주번호));
    if (!picked.length) return;
    const count = new Set(picked.map(r => r._발주번호)).size;
    const made = shipRowsOut(picked, `체크한 발주 ${count}건`);
    if (!made) return;
    const rest = buildDisplayRows(extractOrderRows(leftRows).filter(r => !selected.has(r.발주번호)));
    setLeftRows(rest);
    setSelected(new Set());
    // 바로 쉽먼트생성 화면으로 넘어가며 이 화면이 닫히므로 여기서 저장해 둔다(handleShipOut과 같은 까닭).
    saveWork(rest, fileName, Array.from(doneBundles));
    setNotice(`${made.join(', ')} · 발주 ${count}건을 쉽먼트생성으로 보냈어요`);
    onGoShipOut?.();
  }, [leftRows, selected, doneBundles, fileName, onGoShipOut]);

  // 묶음 완료 표시 켜기/끄기.
  const handleToggleDone = useCallback((bundle: string) => {
    record(`${bundle} 완료 표시`);
    setDoneBundles(prev => {
      const next = new Set(prev);
      if (next.has(bundle)) next.delete(bundle); else next.add(bundle);
      return next;
    });
  }, []);

  // 묶음 하나를 통째로 박스 지정/해제.
  const handleBundleBox = useCallback((bundle: string, value: string) => {
    record(`${bundle} 박스 지정`);
    setLeftRows(prev => prev.map(r => r.묶음 === bundle ? { ...r, 쉼먼트: value } : r));
    updateReservations(nowRef.current.reservations.filter(r => r.묶음 === bundle), { 쉼먼트: value }).catch(alertError);
  }, []);

  // 묶음을 없앤다. 줄은 그대로 두고 묶음 표시와 박스 지정만 뗀다.
  const handleUnbundle = useCallback((bundle: string) => {
    record(`${bundle} 풀기`);
    setLeftRows(prev => prev.map(r => r.묶음 === bundle ? { ...r, 묶음: '', 쉼먼트: '' } : r));
    updateReservations(nowRef.current.reservations.filter(r => r.묶음 === bundle), { 묶음: '', 묶음센터: '', 묶음일자: '', 쉼먼트: '' }).catch(alertError);
    setDoneBundles(prev => {
      if (!prev.has(bundle)) return prev;
      const next = new Set(prev);
      next.delete(bundle);
      return next;
    });
  }, []);

  // 발주서 하나만 묶음에서 뺀다.
  const handleRemoveFromBundle = useCallback((orderNo: string) => {
    record(`발주 ${orderNo} 묶음에서 빼기`);
    setLeftRows(prev => prev.map(r => r._발주번호 === orderNo ? { ...r, 묶음: '', 쉼먼트: '' } : r));
    updateReservations(nowRef.current.reservations.filter(r => r.발주번호 === orderNo && r.묶음), { 묶음: '', 묶음센터: '', 묶음일자: '', 쉼먼트: '' }).catch(alertError);
  }, []);

  const handleRightShipmentChange = useCallback((id: string, value: string) => {
    const row = rightRows.find(r => r.id === id);
    if (row) updateReservationShipment(toOrderRow(row), value).catch(alertError);
  }, [rightRows]);

  // 예약을 지운다. 예약은 발주서 통째로 다루므로 그 발주서의 줄을 모두 지운다(발송 목록으로 돌아가지 않는다).
  // 되돌리기로 살릴 수 있다.
  const handleDeleteReservation = useCallback((id: string) => {
    const row = rightRows.find(r => r.id === id);
    if (!row) return;
    const mine = rightRows.filter(r => !r.isBlank && r._발주번호 === row._발주번호);
    if (!confirm(`발주 ${row._발주번호}의 예약 ${mine.length}줄을 삭제할까요?\n발송 목록으로 돌아가지 않고 지워져요(되돌리기로 살릴 수 있어요).`)) return;
    record(`발주 ${row._발주번호} 예약 삭제`);
    deleteReservations(mine.map(toOrderRow)).catch(alertError);
  }, [rightRows]);

  // 메모에 "예약"을 표시한 줄을 예약 목록으로 넘긴다. 한중발주(1688 주문)는 실제로 주문할 때
  // 한중발주 메뉴의 "발주 대기"에서 골라 고유번호와 함께 만든다. (예전 "한중" 표시도 예약으로 본다.)
  // "대기"로 고른 줄도 예약 목록으로 가지만, 한중발주의 발주 대기에는 뜨지 않는다.
  const isPicked = (r: DisplayRow) => !r.isBlank && (r.메모.includes('예약') || r.메모.includes('한중') || r.메모.includes('대기'));
  const handleReserve = useCallback(() => {
    const pickedRows = leftRows.filter(isPicked);
    if (!pickedRows.length) return;
    const pickedIds = new Set(pickedRows.map(r => r.id));
    record('예약 넘기기');
    addReservations(pickedRows.map(r => ({ ...toOrderRow(r), 메모: r.메모.includes('대기') ? '대기' : '예약' })), reservations)
      .then(() => setLeftRows(buildDisplayRows(extractOrderRows(leftRows.filter(r => !pickedIds.has(r.id))))))
      .catch(alertError);
  }, [leftRows, reservations]);

  // 예약에서 되돌아온 줄을 지금 발송 목록에 남아 있는 같은 발주서 줄에 맞춘다.
  // 예약 기록에는 묶음이 없고 센터·입고예정일도 예약 당시 값이라, 그대로 넣으면 원래 덩어리에서 떨어진다.
  const alignToExisting = useCallback((back: OrderRow[], existing: OrderRow[]): OrderRow[] => {
    const byOrder = new Map<string, OrderRow[]>();
    for (const r of existing) {
      if (!r.발주번호) continue;
      byOrder.set(r.발주번호, [...(byOrder.get(r.발주번호) || []), r]);
    }
    return back.map(r => {
      const mates = byOrder.get(r.발주번호);
      if (!mates || !mates.length) return r;
      const head = mates[0];
      // 박스는 그 발주서 줄이 모두 같은 번호일 때만 따라간다(섞여 있으면 손대지 않는다).
      const box = mates.every(m => (m.쉼먼트 || '') === (head.쉼먼트 || '')) ? (head.쉼먼트 || '') : (r.쉼먼트 || '');
      return {
        ...r,
        물류센터: head.물류센터,
        입고예정일: head.입고예정일,
        묶음: head.묶음 || '',
        묶음센터: head.묶음센터 || '',
        묶음일자: head.묶음일자 || '',
        쉼먼트: box,
      };
    });
  }, []);

  // 예약 목록에서 고른 줄 → 쉽먼트생성. 보낸 줄은 예약에서 지운다.
  const handleReservedShipOut = useCallback(() => {
    const picked = rightRows.filter(r => !r.isBlank && pickedRes.has(r.id));
    if (!picked.length) return;
    const made = shipRowsOut(picked, `고른 예약 ${picked.length}줄`);
    if (!made) return;
    setPickedResOrders(new Set());
    deleteReservations(picked.map(toOrderRow)).catch(alertError);
    setNotice(`${made.join(', ')} · 예약 ${picked.length}줄을 쉽먼트생성으로 보냈어요`);
    onGoShipOut?.();
  }, [rightRows, pickedRes, onGoShipOut]);

  // 고른 예약 줄만 발송 목록의 원래 자리(발주서 순서)로 되돌린다.
  const handleRestorePickedReservations = useCallback(() => {
    const picked = rightRows.filter(r => !r.isBlank && pickedRes.has(r.id));
    if (!picked.length) return;
    const orders = picked.map(toOrderRow);
    if (!confirm(`고른 ${orders.length}줄을 발송 목록으로 되돌릴까요?\n예약 목록에서는 지워져요.`)) return;
    const existing = extractOrderRows(leftRows);
    const back = alignToExisting(orders.map(r => ({ ...r, 메모: '' })), existing);
    const combined = sortOrderRows([...existing, ...back]);
    // 발송 목록에 먼저 넣고 나서 예약을 지운다. 지우기는 화면에서 먼저 사라지고 저장은 늦게 끝날 수
    // 있어서, 저장이 끝난 뒤에 넣으면 그 사이(또는 저장이 안 끝나면 영영) 양쪽 다 없는 상태가 된다.
    record('고른 예약 발송으로 되돌리기');
    setLeftRows(buildDisplayRows(combined));
    setPickedResOrders(new Set());
    setNotice(`예약 ${orders.length}줄을 발송 목록의 원래 자리로 되돌렸어요.`);
    deleteReservations(orders).catch(alertError);
  }, [rightRows, pickedRes, leftRows]);

  // 예약 전체를 발송 패널로 되돌린다. 저장된 예약도 모두 지워지므로 한 번 더 묻는다.
  const handleCancelReservations = useCallback(() => {
    if (reservations.length === 0) return;
    if (!confirm(`저장된 예약 ${reservations.length}건을 모두 발송으로 되돌릴까요?\n예약 목록에서는 삭제돼요.`)) return;
    // 되돌린 줄은 발주서 순서대로 원래 자리에 끼워 넣고, 예약 표시(메모)는 지운다.
    const existing = extractOrderRows(leftRows);
    const combined = sortOrderRows([
      ...existing,
      ...alignToExisting(reservations.map(r => ({ ...r, 메모: '' })), existing),
    ]);
    record('예약 전체 취소');
    // 발송에 먼저 넣고 지운다(위 "고른 줄 발송으로"와 같은 까닭).
    setLeftRows(buildDisplayRows(combined));
    deleteReservations(reservations).catch(alertError);
  }, [leftRows, reservations]);

  // 컴퓨터끼리 목록이 어긋났을 때: 이 컴퓨터의 발송 목록·출고를 클라우드에 그대로 올려 다른 컴퓨터도 같게 만든다.
  const [pushing, setPushing] = useState(false);
  const handleForceUpload = useCallback(async () => {
    if (!confirm('이 컴퓨터의 발송 목록과 쉽먼트생성 출고를 클라우드에 그대로 올릴까요?\n다른 컴퓨터도 이 컴퓨터와 똑같이 바뀌어요(다른 컴퓨터에만 있던 내용은 사라져요).')) return;
    setPushing(true);
    try {
      saveWork(leftRows, fileName, Array.from(doneBundles));
      const done = await waitAtMost(Promise.all([forceUploadWork(), forceUploadShipOuts()]).then(() => true));
      setNotice(done
        ? '이 컴퓨터 목록을 클라우드에 올렸어요. 다른 컴퓨터에도 곧 똑같이 떠요.'
        : '인터넷이 느려 아직 올라가는 중이에요. 연결되면 저절로 마저 올라가요.');
    } catch (err) {
      alert(`올리기 실패: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setPushing(false);
    }
  }, [leftRows, fileName, doneBundles]);

  // 툴바의 "+ 발주서 추가"용 파일 고르기(첫 업로드 화면과 같은 길로 들어간다).
  const pickOrderFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls,.csv';
    input.onchange = () => {
      const f = input.files && input.files[0];
      if (f) handleFile(f);
    };
    input.click();
  };

  // 롯데택배 엑셀을 만들고(내려받기), 원하면 "로켓 서허 연동" 확장이 롯데 ALPS를 작은 팝업 창으로 열어
  // 로그인 → 거래처관리 › 일괄주문접수 → 파일 올리기까지 하고 창을 닫는다. 끝나거나 실패하면 알려준다.
  // 쉽먼트생성(롯데택배 예약 → 운송장 → 서허 양식)은 발주 > 쉽먼트생성 화면으로 옮겼다.
  // 발송 쪽만 비운다. 예약은 저장돼 있어서 그대로 남는다.
  // 발송 쪽을 통째로 비운다. 되돌릴 수 없어서 한 번 더 묻는다(예약은 저장돼 있어 그대로 남는다).
  const handleReset = () => {
    if (leftRows.length && !confirm(`발송 목록 ${leftItemCount}건을 모두 지울까요?\n묶음도 함께 사라져요(되돌리기로 살릴 수 있어요).`)) return;
    record('전체 비우기');
    setLeftRows([]);
    setDoneBundles(new Set());
    setSelected(new Set());
    setFileName('');
    setError('');
  };

  const leftItemCount = leftRows.filter(r => !r.isBlank).length;
  const rightItemCount = rightRows.filter(r => !r.isBlank).length;

  const pendingCount = leftRows.filter(isPicked).length;
  // 택배주소 관리에 등록된 센터 + 지금 발주서에 있는 센터(묶음 센터를 고를 때 쓴다).
  const centerOptions = useMemo(() => Array.from(new Set([
    ...addresses.map(a => (a.key || '').trim()),
    ...leftRows.map(r => (r._물류센터 || '').trim()),
  ].filter(Boolean))).sort((a, b) => a.localeCompare(b, 'ko', { numeric: true })), [addresses, leftRows]);

  const bundledOrderCount = new Set(leftRows.filter(r => !r.isBlank && r.묶음).map(r => r._발주번호)).size;
  const bundleCount = new Set(leftRows.map(r => r.묶음).filter(Boolean)).size;
  // 같은 발주서의 같은 상품이 두 번 들어간 줄(출고에 보냈다 되돌리는 사이에 생길 수 있다).
  const dupCount = useMemo(() => {
    const seen = new Set<string>();
    let dup = 0;
    for (const r of leftRows) {
      if (r.isBlank) continue;
      const key = `${r._발주번호}│${r.상품이름}│${r.확정수량}`;
      if (seen.has(key)) dup++; else seen.add(key);
    }
    return dup;
  }, [leftRows]);

  // 발송 목록에 있는 모든 발주서(발주번호). 전체선택에 쓴다.
  const allOrderNos = useMemo(
    () => Array.from(new Set(leftRows.filter(r => !r.isBlank).map(r => r._발주번호).filter(Boolean))),
    [leftRows],
  );
  const allSelected = allOrderNos.length > 0 && allOrderNos.every(no => selected.has(no));
  const toggleSelectAll = useCallback(() => {
    setSelected(allSelected ? new Set() : new Set(allOrderNos));
  }, [allSelected, allOrderNos]);

  // 발송 목록은 늘 발주서 순서(입고예정일 빠른 순 → 물류센터 → 발주번호 → 상품이름)로 둔다.
  // 새 발주서·되돌린 줄·다른 컴퓨터에서 내려온 목록 모두 순서가 어긋나면 바로 다시 줄 세운다.
  // 순서가 이미 맞으면 건드리지 않아 메모 입력 중 줄 id가 바뀌지 않는다.
  useEffect(() => {
    const rows = extractOrderRows(leftRows);
    const sorted = sortOrderRows([...rows]);
    if (sorted.every((r, i) => r === rows[i])) return;
    setLeftRows(buildDisplayRows(sorted));
  }, [leftRows]);

  // 혹시 순서가 어긋나 보일 때 손으로 한 번 더 줄 세우는 버튼.
  const handleSort = useCallback(() => {
    record('정렬');
    setLeftRows(buildDisplayRows(sortOrderRows(extractOrderRows(leftRows))));
    setNotice('발주서 순서(입고예정일 → 센터 → 발주번호)로 다시 정렬했어요.');
  }, [leftRows]);

  // 이미 쉽먼트생성으로 넘어갔는데 발송 목록에 남아 있는 줄(예전 수집 때 다시 들어온 것들).
  const [shippedKeys, setShippedKeys] = useState<Set<string>>(() => shipOutLineKeys());
  useEffect(() => subscribeShipOuts(() => setShippedKeys(shipOutLineKeys())), []);
  const shippedRows = useMemo(
    () => leftRows.filter(r => !r.isBlank && shippedKeys.has(`${r._발주번호}│${r.상품이름}│${r.확정수량}`)),
    [leftRows, shippedKeys],
  );
  const shippedOrderNos = useMemo(
    () => Array.from(new Set(shippedRows.map(r => r._발주번호))),
    [shippedRows],
  );

  // 그 줄들을 발송 목록에서 걷어낸다(출고 쪽 기록은 그대로 둔다).
  const handleDropShipped = useCallback(() => {
    if (!shippedRows.length) return;
    if (!confirm(`이미 쉽먼트생성으로 넘긴 발주 ${shippedOrderNos.length}건(${shippedRows.length}줄)을 발송 목록에서 지울까요?\n쉽먼트생성 쪽 내용은 그대로 남아요.`)) return;
    const gone = new Set(shippedRows.map(r => r.id));
    record('넘어간 발주 지우기');
    setLeftRows(prev => buildDisplayRows(extractOrderRows(prev.filter(r => !gone.has(r.id)))));
    setNotice(`쉽먼트생성으로 넘어간 발주 ${shippedOrderNos.length}건을 발송 목록에서 지웠어요.`);
  }, [shippedRows, shippedOrderNos]);

  // 중복 줄을 먼저 들어온 것만 남기고 지운다.
  const handleDedupe = useCallback(() => {
    if (!dupCount) return;
    if (!confirm(`똑같이 겹친 줄 ${dupCount}개를 지울까요?\n같은 발주번호·상품·수량인 줄 중 먼저 들어온 하나만 남겨요.`)) return;
    const seen = new Set<string>();
    const kept = extractOrderRows(leftRows).filter(r => {
      const key = `${r.발주번호}│${r.상품이름}│${r.확정수량}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    record('중복 정리');
    setLeftRows(buildDisplayRows(kept));
    setNotice(`겹친 줄 ${dupCount}개를 지웠어요.`);
  }, [leftRows, dupCount]);

  // 체크한 발주서를 통째로 예약 목록으로 넘긴다. 발송 목록에서는 곧바로 빼고, 저장에 실패하면 되돌린다.
  const handleReserveSelected = () => {
    const picked = leftRows.filter(r => !r.isBlank && selected.has(r._발주번호));
    if (!picked.length) return;
    const orderNos = new Set(picked.map(r => r._발주번호));
    const pickedIds = new Set(picked.map(r => r.id));
    record(`발주 ${orderNos.size}건 예약으로 넘기기`);
    const orders = picked.map(r => ({ ...toOrderRow(r), 메모: '예약' }));
    setLeftRows(buildDisplayRows(extractOrderRows(leftRows.filter(r => !pickedIds.has(r.id)))));
    setSelected(new Set());
    addReservations(orders, reservations).catch(err => {
      alertError(err);
      setLeftRows(prev => buildDisplayRows(sortOrderRows([...extractOrderRows(prev), ...orders.map(o => ({ ...o, 메모: '' }))])));
    });
  };

  // 체크한 발주서를 발송 목록에서 지운다(예약·쉽먼트생성 쪽은 그대로). 되돌리기로 살릴 수 있다.
  const handleDeleteSelected = () => {
    const orderNos = new Set(leftRows.filter(r => !r.isBlank && selected.has(r._발주번호)).map(r => r._발주번호));
    if (!orderNos.size) return;
    if (!confirm(`고른 발주 ${orderNos.size}건을 발송 목록에서 지울까요?\n(되돌리기로 살릴 수 있어요)`)) return;
    record(`발주 ${orderNos.size}건 삭제`);
    setLeftRows(buildDisplayRows(extractOrderRows(leftRows).filter(r => !orderNos.has(r.발주번호))));
    setSelected(new Set());
    setNotice(`발주 ${orderNos.size}건을 지웠어요.`);
  };

  // 묶음 카드는 발송 목록과 예약 목록 안의 묶음을 함께 보여준다.
  const bundleRows = useMemo(
    () => (reservations.some(r => r.묶음) ? buildDisplayRows([...extractOrderRows(leftRows), ...reservations.filter(r => r.묶음)]) : leftRows),
    [leftRows, reservations],
  );
  const selectedCount = new Set(leftRows.filter(r => !r.isBlank && selected.has(r._발주번호)).map(r => r._발주번호)).size;

  // 체크하면 그 발주서 머리줄 바로 옆에 버튼을 띄운다(마지막으로 체크한 발주서 자리).
  const leftActionOrder = selected.has(lastPick)
    ? lastPick
    : (leftRows.find(r => !r.isBlank && selected.has(r._발주번호))?._발주번호 || '');
  const leftActions = selectedCount > 0 ? (
    <>
      <span className="rk-count">발주 {selectedCount}건</span>
      <span className="rk-sep" />
      <button onClick={handleDirectShipOut} title="체크한 발주서를 묶음 없이 바로 쉽먼트생성으로 보냅니다(센터·입고예정일이 같은 것끼리 한 건)">
        <span className="rk-dot" style={{ background: '#fb923c' }} />쉽먼트생성
      </button>
      <button onClick={handleSelectedToHanjung} title="체크한 발주서의 상품을 모두 한중발주의 발주 대기로 보냅니다(발송 목록에는 그대로 남아요)">
        <span className="rk-dot" style={{ background: '#60a5fa' }} />한중
      </button>
      <button onClick={handleBundle} title="체크한 발주서로 새 묶음(택배 한 상자)을 만듭니다. 이미 있는 묶음에 더 담을 때는 그 묶음 카드의 +담기를 누르세요.">
        <span className="rk-dot" style={{ background: '#a78bfa' }} />새 묶음
      </button>
      <button onClick={handleReserveSelected} title="체크한 발주서를 통째로 예약 목록으로 넘깁니다">
        <span className="rk-dot" style={{ background: '#60a5fa' }} />예약
      </button>
      <span className="rk-sep" />
      <button className="rk-danger" onClick={handleDeleteSelected} title="체크한 발주서를 발송 목록에서 지웁니다(되돌리기로 살릴 수 있어요)">삭제</button>
      <button className="rk-close" onClick={() => setSelected(new Set())} title="선택 풀기">✕</button>
    </>
  ) : null;
  const resPickedRows = rightRows.filter(r => !r.isBlank && pickedRes.has(r.id));
  const rightActionOrder = (pickedResOrders.has(lastResPick) ? lastResPick : resPickedRows[0]?._발주번호) || '';
  const rightActions = resPickedRows.length > 0 ? (
    <>
      <span className="rk-count">예약 {resPickedRows.length}줄</span>
      <span className="rk-sep" />
      <button onClick={handleReservedShipOut} title="고른 예약 줄을 바로 쉽먼트생성으로 보냅니다(예약 목록에서는 빠져요)">
        <span className="rk-dot" style={{ background: '#fb923c' }} />쉽먼트생성
      </button>
      <button onClick={handleBundle} title="고른 예약 줄로 새 묶음을 만듭니다(예약 목록에 그대로 두고 묶음 표시만 붙어요). 이미 있는 묶음에 넣을 때는 묶음 카드의 +담기를 누르세요.">
        <span className="rk-dot" style={{ background: '#a78bfa' }} />새 묶음
      </button>
      <button onClick={handleRestorePickedReservations} title="고른 상품 줄만 발송 목록의 원래 자리로 되돌립니다">
        <span className="rk-dot" style={{ background: '#4ade80' }} />발송으로
      </button>
      <span className="rk-sep" />
      <button className="rk-close" onClick={() => setPickedResOrders(new Set())} title="선택 풀기">✕</button>
    </>
  ) : null;

  return (
    <div style={{ minHeight: '100vh', background: '#fff', color: '#1a1a1a', fontFamily: "'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif" }}>
      <header style={{
        background: '#fff', borderBottom: '1px solid #f0f0f0',
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        <div style={{ maxWidth: 1600, margin: '0 auto', padding: '0 24px', height: 54, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <span style={{ fontSize: 17, fontWeight: 700, color: '#1a1a1a', letterSpacing: '-0.3px' }}>📦 쿠팡발주확인</span>
            {fileName && (
              <span style={{ fontSize: 11, color: '#999', background: '#f5f5f5', padding: '3px 10px', borderRadius: 20 }}>
                {fileName}
              </span>
            )}
            {/* 방금 한 일 되돌리기 · 다시실행 (⌘Z / ⌘⇧Z) */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button
                onClick={undo}
                disabled={!history.undo.length}
                title={history.undo.length ? `되돌리기: ${history.undo[history.undo.length - 1].label} (⌘Z)` : '되돌릴 일이 없어요'}
                style={stepBtn(history.undo.length > 0)}
              >
                ↶ 되돌리기
              </button>
              <button
                onClick={redo}
                disabled={!history.redo.length}
                title={history.redo.length ? `다시실행: ${history.redo[history.redo.length - 1].label} (⌘⇧Z)` : '다시 할 일이 없어요'}
                style={stepBtn(history.redo.length > 0)}
              >
                ↷ 다시실행
              </button>
            </div>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 1600, margin: '0 auto', padding: '20px 24px' }}>
        <div>
            <div style={{ marginBottom: 14 }}>
              <CollectPurchaseOrders onFile={handleFile} />
            </div>

            {!hasFile && (
              <div style={{ marginBottom: 20 }}>
                <FileUpload onFile={handleFile} loading={loading} />
              </div>
            )}

            {notice && (
              <div style={{ background: '#eff6ff', border: '1px solid #cfe0ff', color: '#1d4ed8', fontSize: 13, padding: '10px 16px', borderRadius: 8, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ flex: 1 }}>{notice}</span>
                <button onClick={() => setNotice('')} style={{ border: 'none', background: 'transparent', color: '#94a3b8', cursor: 'pointer' }}>×</button>
              </div>
            )}

            {shippedRows.length > 0 && (
              <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', color: '#b45309', fontSize: 13, padding: '10px 16px', borderRadius: 8, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ flex: 1 }}>
                  이미 <strong>쉽먼트생성</strong>으로 넘긴 발주 {shippedOrderNos.length}건({shippedRows.length}줄)이 아직 이 목록에 남아 있어요.
                  <span style={{ color: '#9a7b4f', marginLeft: 6 }} title={shippedOrderNos.join(', ')}>
                    {shippedOrderNos.slice(0, 5).join(', ')}{shippedOrderNos.length > 5 ? ` 외 ${shippedOrderNos.length - 5}건` : ''}
                  </span>
                </span>
                <button
                  onClick={handleDropShipped}
                  style={{
                    padding: '5px 12px', fontSize: 12, fontWeight: 700, color: '#fff',
                    background: '#e67e22', border: '1px solid #e67e22', borderRadius: 6, cursor: 'pointer',
                  }}
                >
                  정리하기
                </button>
              </div>
            )}

            {error && (
              <div style={{ background: '#fff0f0', border: '1px solid #ffcccc', color: '#c0392b', fontSize: 13, padding: '10px 16px', borderRadius: 8, marginBottom: 14 }}>
                {error}
              </div>
            )}

            {!hasData && !loading && !error && (
              <div style={{ textAlign: 'center', padding: '16px 0' }}>
                <p style={{ fontSize: 13, color: '#aaa', marginBottom: 10 }}>사용 방법</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 8 }}>
                  {['발송 목록은 입고예정일 빠른 순으로 자동 정렬', '메모에 예약 → 예약 목록 · 한중발주 대기'].map(hint => (
                    <span key={hint} style={{ fontSize: 12, background: '#f5f5f5', color: '#666', padding: '5px 12px', borderRadius: 20 }}>{hint}</span>
                  ))}
                </div>
              </div>
            )}

            {hasData && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    onClick={pickOrderFile}
                    title="발주서를 하나 더 올려 지금 목록 아래에 이어 붙입니다"
                    style={btnStyle('#fff', '#d6c9f5', '#7c3aed')}
                  >
                    + 발주서 추가
                  </button>
                  {hasFile && (
                    <button
                      onClick={handleReset}
                      title="발송 목록을 통째로 비웁니다(예약은 그대로 남아요)"
                      style={btnStyle('#fff', '#e5e5e5', '#999')}
                    >
                      전체 비우기
                    </button>
                  )}
                  <button
                    onClick={handleForceUpload}
                    disabled={pushing || !isFirebaseConfigured}
                    title={isFirebaseConfigured
                      ? '다른 컴퓨터와 목록이 다를 때, 이 컴퓨터 것으로 모두 맞춥니다'
                      : '이 컴퓨터는 클라우드에 연결돼 있지 않아 다른 컴퓨터와 같이 볼 수 없어요'}
                    style={btnStyle('#fff', isFirebaseConfigured ? '#bcd7f5' : '#f5c6c6', isFirebaseConfigured ? '#2563eb' : '#c0392b')}
                  >
                    {!isFirebaseConfigured ? '⚠ 클라우드 연결 안 됨' : pushing ? '올리는 중…' : '☁ 이 컴퓨터 것으로 맞추기'}
                  </button>
                  <span style={{ fontSize: 11, color: '#ccc' }}>
                    발송 {leftItemCount}건 / 묶음 {bundleCount}개(발주 {bundledOrderCount}건) / 예약 {rightItemCount}건
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {pendingCount > 0 && <button
                    onClick={handleReserve}
                    disabled={!pendingCount}
                    title="메모에 &quot;예약&quot;을 누른 줄을 예약 목록으로 옮깁니다. 1688 주문은 한중발주 메뉴의 발주 대기에서 해요."
                    style={{
                      ...btnStyle(
                        pendingCount ? '#27ae60' : '#f5f5f5',
                        pendingCount ? '#27ae60' : '#f5f5f5',
                        pendingCount ? '#fff' : '#bbb'
                      ),
                      cursor: pendingCount ? 'pointer' : 'not-allowed',
                      fontWeight: 600,
                    }}
                  >
                    ▶ 예약 넘기기
                    <span style={{ background: 'rgba(255,255,255,0.25)', padding: '1px 7px', borderRadius: 12, fontSize: 11, marginLeft: 4 }}>
                      {pendingCount}건
                    </span>
                  </button>}

                  <button
                    onClick={() => exportSummaryExcel(leftRows)}
                    title="현재 발송 목록 전체를 엑셀 파일(발주서정리_날짜.xlsx)로 저장합니다."
                    style={btnStyle('#f5f5f5', '#e5e5e5', '#333')}
                  >
                    ↓ 발주서정리 저장
                  </button>

                </div>
              </div>
            )}

            {hasData && (
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '2px 10px', marginTop: -8, marginBottom: 14 }}>
                <span style={{ fontSize: 11, color: '#bbb' }}>발주서 체크 → 새 묶음 만들기 / 이미 있는 묶음의 +담기로 추가</span>
                <span style={{ fontSize: 11, color: '#ddd' }}>·</span>
                <span style={{ fontSize: 11, color: '#bbb' }}>한중 = 한중발주 발주 대기로(발송 목록에는 남음) · 발주번호 누르면 복사</span>
                <span style={{ fontSize: 11, color: '#ddd' }}>·</span>
                <span style={{ fontSize: 11, color: '#bbb' }}>↓ 발주서정리 저장 = 발송 목록 엑셀 저장</span>
                <span style={{ fontSize: 11, color: '#ddd' }}>·</span>
                <span style={{ fontSize: 11, color: '#bbb' }}>↓ 쉽먼트생성 = 센터별 상자 개수만큼 롯데택배 예약</span>
              </div>
            )}

            {hasData && (
              <div style={{
                display: 'grid',
                // 예약 패널은 쓰지 않는다(예전에 넘겨 둔 예약이 남아 있을 때만 보여준다). 묶음 카드는 잘리지 않게 넉넉히.
                gridTemplateColumns: [
                  // 발송 표는 한눈에 들어오게 넓히지 않는다(예전 폭 정도인 560px까지).
                  folded.send ? '34px' : 'minmax(0, 560px)',
                  folded.bundle ? '34px' : '420px',
                  ...(rightRows.length > 0 ? ['minmax(0, 0.9fr)'] : []),
                ].join(' '),
                gap: 20, alignItems: 'start', justifyContent: 'start',
              }}>
                {folded.send ? (
                  <FoldedStrip
                    icon="📤" label="발송" color="#c0392b" count={`${leftItemCount}건`}
                    onOpen={() => setFolded(f => ({ ...f, send: false }))}
                  />
                ) : (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <PanelTitle
                      icon="📤" label="발송" color="#c0392b"
                      folded={folded.send}
                      onToggle={() => setFolded(f => ({ ...f, send: !f.send }))}
                    />
                    {leftItemCount > 0 && <span style={{ fontSize: 11, color: '#aaa' }}>{leftItemCount}건</span>}
                    {allOrderNos.length > 0 && (
                      <label
                        title="발송 목록의 발주서를 모두 고릅니다(묶기용)"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#777', cursor: 'pointer' }}
                      >
                        <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} style={{ cursor: 'pointer', margin: 0 }} />
                        전체선택
                      </label>
                    )}
                    {dupCount > 0 && (
                      <button
                        onClick={handleDedupe}
                        title="같은 발주번호·상품·수량으로 두 번 들어간 줄을 하나만 남깁니다"
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          padding: '3px 9px', fontSize: 11, fontWeight: 700, color: '#fff',
                          background: '#e67e22', border: '1px solid #e67e22', borderRadius: 6, cursor: 'pointer',
                        }}
                      >
                        중복 정리 {dupCount}
                      </button>
                    )}
                    {leftRows.length > 0 && (
                      <button
                        onClick={handleSort}
                        title="입고예정일 → 물류센터 → 발주번호 순으로 목록을 다시 줄 세웁니다"
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          padding: '3px 9px', fontSize: 11, color: '#777',
                          background: '#fff', border: '1px solid #e0e0e0', borderRadius: 6, cursor: 'pointer',
                        }}
                      >
                        ↕ 정렬
                      </button>
                    )}
                    {leftRows.length > 0 && (
                      <button
                        onClick={() => printPanel(leftRows, '발송', '#c0392b')}
                        style={printBtnStyle}
                        title="발송 패널 인쇄"
                      >
                        🖨 인쇄
                      </button>
                    )}
                  </div>
                  {leftRows.length > 0 ? (
                    <OrderTable
                      rows={leftRows}
                      onMemoChange={handleLeftMemoChange}
                      hideMemo
                      onDelete={handleDeleteLeftLine}
                      onToggleHanjung={handleToggleHanjung}
                      isReady={r => ready.isReady({ 발주번호: r._발주번호, 상품이름: r.상품이름, 확정수량: r.확정수량 })}
                      onToggleReady={(r, on) => { ready.setReady([{ 발주번호: r._발주번호, 상품이름: r.상품이름, 확정수량: r.확정수량 }], on).catch(alertError); }}
                      isHanjung={r => hanjungKeys.has(hanjungQueueKey({ 발주번호: r._발주번호, 상품이름: r.상품이름, 확정수량: r.확정수량 }))}
                      onShipmentChange={handleLeftShipmentChange}
                      colorScheme="pink"
                      officeQtyOf={officeQtyOf}
                      selectedOrders={selected}
                      onToggleSelect={toggleSelect}
                      actionOrder={leftActionOrder}
                      actions={leftActions}
                      newOrders={newNos}
                      hideBox
                    />
                  ) : (
                    <div style={{ border: '1px dashed #e8e8e8', borderRadius: 10, padding: '48px 0', textAlign: 'center', color: '#ccc', fontSize: 13 }}>
                      발송 항목 없음
                    </div>
                  )}
                </div>
                )}

                {folded.bundle ? (
                  <FoldedStrip
                    icon="🧺" label="묶음" color="#7c3aed" count={`${bundleCount}묶음`}
                    onOpen={() => setFolded(f => ({ ...f, bundle: false }))}
                  />
                ) : (
                <div style={{ ...STICKY_PANEL, overflowX: 'auto' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <PanelTitle
                      icon="🧺" label="묶음" color="#7c3aed"
                      folded={folded.bundle}
                      onToggle={() => setFolded(f => ({ ...f, bundle: !f.bundle }))}
                    />
                    {bundleCount > 0 && <span style={{ fontSize: 11, color: '#aaa' }}>{bundleCount}묶음 · 발주 {bundledOrderCount}건</span>}
                  </div>
                  <BundlePanel
                    rows={bundleRows}
                    onBoxChange={handleBundleBox}
                    onUnbundle={handleUnbundle}
                    onRemoveOrder={handleRemoveFromBundle}
                    selectedCount={selectedCount + resPickedRows.length}
                    onAddSelected={handleAddToBundle}
                    doneBundles={doneBundles}
                    onToggleDone={handleToggleDone}
                    centerOptions={centerOptions}
                    onCenterChange={handleBundleCenter}
                    onDateChange={handleBundleDate}
                    onApply={handleApplyBundle}
                    onShipOut={handleShipOut}
                  />
                </div>
                )}

                {rightRows.length > 0 && <div style={STICKY_PANEL}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#27ae60', letterSpacing: '-0.2px' }}>📅 예약</span>
                    {rightItemCount > 0 && <span style={{ fontSize: 11, color: '#aaa' }}>{rightItemCount}건</span>}
                    {rightRows.length > 0 && (
                      <button
                        onClick={() => printPanel(rightRows, '예약', '#27ae60')}
                        style={printBtnStyle}
                        title="예약 패널 인쇄"
                      >
                        🖨 인쇄
                      </button>
                    )}
                    {rightRows.length > 0 && (
                      <button
                        onClick={handleCancelReservations}
                        style={{
                          marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4,
                          padding: '4px 10px', fontSize: 11, color: '#999',
                          background: '#fff', border: '1px solid #e0e0e0',
                          borderRadius: 6, cursor: 'pointer',
                        }}
                        title="저장된 예약 전체를 발송 패널로 되돌리고 예약 목록에서 지웁니다"
                      >
                        ↩ 예약 전체 취소
                      </button>
                    )}
                  </div>
                  {rightRows.length > 0 ? (
                    <OrderTable
                      rows={rightRows}
                      onMemoChange={() => {}}
                      onShipmentChange={handleRightShipmentChange}
                      onDelete={handleDeleteReservation}
                      colorScheme="green"
                      readOnly={false}
                      selectedLines={pickedRes}
                      onToggleLine={toggleResLine}
                      lineSelectByOrder
                      actionOrder={rightActionOrder}
                      actions={rightActions}
                      hideBox
                    />
                  ) : (
                    <div style={{
                      border: '1px dashed #b7e0c7', borderRadius: 10,
                      padding: '48px 0', textAlign: 'center', color: '#b0d8c0', fontSize: 13,
                    }}>
                      메모에 <strong style={{ color: '#27ae60' }}>예약</strong> 입력 후<br />
                      <span style={{ fontSize: 12 }}>예약 넘기기를 눌러주세요</span>
                    </div>
                  )}
                </div>}
              </div>
            )}
          </div>
      </main>

    </div>
  );
}

// 접힌 패널. 왼쪽에 세로 막대만 남기고, 누르면 다시 펼쳐진다.
function FoldedStrip({ icon, label, color, count, onOpen }: { icon: string; label: string; color: string; count: string; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      title={`${label} 패널 펼치기`}
      style={{
        position: 'sticky', top: 66,
        width: 34, minHeight: 220, alignSelf: 'start',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start',
        gap: 8, padding: '10px 0',
        background: `${color}0f`, border: `1px solid ${color}33`, borderRadius: 10,
        cursor: 'pointer', color,
      }}
    >
      <span style={{ fontSize: 10, color: '#bbb' }}>▸</span>
      <span style={{ fontSize: 13 }}>{icon}</span>
      <span style={{ writingMode: 'vertical-rl', fontSize: 12, fontWeight: 700, letterSpacing: '1px' }}>{label}</span>
      <span style={{ writingMode: 'vertical-rl', fontSize: 10, color: '#999', fontWeight: 400 }}>{count}</span>
    </button>
  );
}

// 패널 제목. 누르면 그 패널을 접었다 편다(접으면 옆 패널이 넓어진다).
function PanelTitle({ icon, label, color, folded, onToggle }: { icon: string; label: string; color: string; folded: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      title={folded ? `${label} 패널 펼치기` : `${label} 패널 접기`}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: 0, background: 'none', border: 'none', cursor: 'pointer',
        fontSize: 12, fontWeight: 700, color, letterSpacing: '-0.2px',
      }}
    >
      <span style={{ fontSize: 10, color: '#bbb' }}>{folded ? '▸' : '▾'}</span>
      {icon} {label}
    </button>
  );
}

// 묶음·예약 패널은 발송 목록이 길어도 화면에 붙어 따라다닌다(위 머리줄 아래에 고정).
// 내용이 화면보다 길면 그 패널 안에서만 스크롤한다.
const STICKY_PANEL: React.CSSProperties = {
  position: 'sticky',
  top: 66,
  maxHeight: 'calc(100vh - 80px)',
  overflowY: 'auto',
  overflowX: 'hidden',
  paddingRight: 2,
};

// 되돌리기·다시실행 단추(쉽먼트생성 화면과 같은 모양). 할 일이 없으면 흐리게 두고 누를 수 없게 한다.
const stepBtn = (on: boolean): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 10px',
  fontSize: 12, fontWeight: 600,
  color: on ? '#555' : '#c8c8c8',
  background: '#fff',
  border: `1px solid ${on ? '#e0e0e0' : '#f2f2f2'}`,
  borderRadius: 7,
  cursor: on ? 'pointer' : 'default',
});

function btnStyle(bg: string, border: string, color: string): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '7px 14px', fontSize: 13, color,
    background: bg, border: `1px solid ${border}`,
    borderRadius: 8, cursor: 'pointer', fontWeight: 500,
  };
}

const printBtnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '3px 9px', fontSize: 11, color: '#777',
  background: '#fff', border: '1px solid #e0e0e0',
  borderRadius: 6, cursor: 'pointer',
};
