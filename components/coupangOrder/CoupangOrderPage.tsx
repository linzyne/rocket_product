import React, { useState, useCallback, useEffect, useMemo } from 'react';
import FileUpload from './components/FileUpload';
import CollectPurchaseOrders from './CollectPurchaseOrders';
import OrderTable from './components/OrderTable';
import {
  parseFile, buildDisplayRows, extractOrderRows, sortOrderRows, boxLabel,
} from './utils/dataProcessor';
import type { DisplayRow } from './utils/dataProcessor';
import { exportSummaryExcel } from './utils/excelExport';
import { printPanel } from './utils/printUtils';
import type { AddressEntry } from './types';
import { loadLocalAddresses, subscribeShippingSettings } from './data/shippingSettingsStore';
import { subscribeReservations, addReservations, updateReservationShipment, deleteReservations, reservationKey } from './data/reservationStore';
import type { OrderRow } from './types';
import { dateKeyYMD, normalizeDateValue, ymdSortKey } from './utils/dateUtils';
import { InventoryItem, subscribeInventory, makeOfficeLookup } from '../../data/inventoryStore';
import BundlePanel from './components/BundlePanel';
import { addShipOut } from './data/shipOutStore';
import { loadWork, saveWork } from './data/orderWorkStore';

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
});

const alertError = (err: unknown) => alert(`예약 저장 실패: ${err instanceof Error ? err.message : String(err)}`);

type Tab = 'shipment' | 'settlement';

// 발주 > 쿠팡발주확인. 쿠팡 발주서(엑셀/CSV)를 올려 발송·예약으로 나누고,
// 발주서정리 엑셀과 롯데택배 업로드 엑셀을 만든다. (원래 '쉽먼트' 앱을 그대로 옮겨온 것)
// 예약 패널은 저장소(data/reservationStore)에 계속 쌓이고, 삭제 버튼을 눌러야만 지워진다.
export default function CoupangOrderPage({ onGoShipOut }: { onGoShipOut?: () => void } = {}) {
  const [activeTab, setActiveTab] = useState<Tab>('shipment');
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

  useEffect(() => subscribeReservations(setReservations), []);
  // 택배주소·보내는사람은 클라우드에 저장돼 있어 다른 컴퓨터에서 고친 것도 바로 반영된다.
  useEffect(() => subscribeInventory(setInventory), []);
  // 택배주소는 묶음 카드에서 센터를 고를 때 쓴다(보내는사람·주소 관리는 쉽먼트생성 화면에 있다).
  useEffect(() => subscribeShippingSettings(({ addresses }) => setAddresses(addresses)), []);
  useEffect(() => saveWork(leftRows, fileName, Array.from(doneBundles)), [leftRows, fileName, doneBundles]);

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
        const seen = new Set([...existing, ...reservations].map(reservationKey));
        const fresh = sortOrderRows(rows).filter(r => !seen.has(reservationKey(r)));
        setLeftRows(buildDisplayRows([...existing, ...fresh]));
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
    if (!value.includes('예약')) {
      setLeftRows(prev => prev.map(r => r.id === id ? { ...r, 메모: value } : r));
      return;
    }
    const order = { ...toOrderRow(row), 메모: '예약' };
    setLeftRows(prev => buildDisplayRows(extractOrderRows(prev.filter(r => r.id !== id))));
    addReservations([order], reservations).catch(err => {
      alertError(err);
      setLeftRows(prev => buildDisplayRows(sortOrderRows([...extractOrderRows(prev), { ...order, 메모: '' }])));
    });
  }, [leftRows, reservations]);

  const handleLeftShipmentChange = useCallback((id: string, value: string) => {
    setLeftRows(prev => prev.map(r => r.id === id ? { ...r, 쉼먼트: value } : r));
  }, []);

  const toggleSelect = useCallback((orderNo: string, checked: boolean) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (checked) next.add(orderNo); else next.delete(orderNo);
      return next;
    });
  }, []);

  // 체크한 줄들을 새 묶음(묶음1, 묶음2…)에 담는다. 줄은 발송 목록에 그대로 남고 묶음 표시만 붙는다.
  // 묶음은 택배 한 상자로 보낼 것들이므로 담자마자 박스1을 같이 지정해 둔다.
  const handleBundle = useCallback(() => {
    const picked = leftRows.filter(r => !r.isBlank && selected.has(r._발주번호));
    if (!picked.length) return;
    const centers = new Set(picked.map(r => (r._물류센터 || '').trim()).filter(Boolean));
    if (centers.size > 1 &&
      !confirm(`물류센터가 ${Array.from(centers).join(', ')}로 섞여 있어요.\n택배는 ${Array.from(centers)[0]}(으)로만 갑니다. 그래도 묶을까요?`)) return;

    const used = new Set(leftRows.map(r => r.묶음).filter(Boolean));
    let no = 1;
    while (used.has(`묶음${no}`)) no++;
    const name = `묶음${no}`;
    setLeftRows(prev => prev.map(r => !r.isBlank && selected.has(r._발주번호) ? { ...r, 묶음: name, 쉼먼트: boxLabel(1) } : r));
    setSelected(new Set());
  }, [leftRows, selected]);

  // 체크한 발주서들을 이미 있는 묶음에 더 담는다. 박스 지정은 그 묶음이 쓰던 값을 따라간다.
  const handleAddToBundle = useCallback((bundle: string) => {
    const picked = leftRows.filter(r => !r.isBlank && selected.has(r._발주번호));
    if (!picked.length) return;
    const mine = leftRows.filter(r => r.묶음 === bundle);
    const centers = new Set([...mine, ...picked].map(r => (r._물류센터 || '').trim()).filter(Boolean));
    if (centers.size > 1 &&
      !confirm(`물류센터가 ${Array.from(centers).join(', ')}로 섞여 있어요.\n택배는 ${Array.from(centers)[0]}(으)로만 갑니다. 그래도 담을까요?`)) return;

    const box = mine[0]?.쉼먼트 || boxLabel(1);
    setLeftRows(prev => prev.map(r => !r.isBlank && selected.has(r._발주번호) ? { ...r, 묶음: bundle, 쉼먼트: box } : r));
    setSelected(new Set());
  }, [leftRows, selected]);

  // 묶음이 갈 물류센터를 직접 고른다(발주서 원래 센터는 그대로 두고 택배 주소만 바꾼다).
  const handleBundleCenter = useCallback((bundle: string, center: string) => {
    setLeftRows(prev => prev.map(r => r.묶음 === bundle ? { ...r, 묶음센터: center } : r));
  }, []);

  // 묶음의 입고예정일을 직접 고른다('YYYY-MM-DD'). 아직 발주서에는 반영하지 않는다.
  const handleBundleDate = useCallback((bundle: string, ymd: string) => {
    setLeftRows(prev => prev.map(r => r.묶음 === bundle ? { ...r, 묶음일자: ymd } : r));
  }, []);

  // 묶음에서 고른 센터·입고예정일을 그 묶음의 발주서들에 그대로 덮어쓴다.
  // (쿠팡에서 입고센터·입고일을 바꿔 놓고, 우리 목록도 그 모습으로 맞출 때 쓴다.)
  const handleApplyBundle = useCallback((bundle: string) => {
    const mine = leftRows.filter(r => !r.isBlank && r.묶음 === bundle);
    if (!mine.length) return;
    const center = (mine.find(r => r.묶음센터)?.묶음센터 || mine[0]._물류센터 || '').trim();
    const days = mine.map(r => dateKeyYMD(r._입고예정일)).filter(d => d && d !== '9999-12-31');
    const baseDay = days.slice().sort((a, b) => ymdSortKey(a) - ymdSortKey(b))[0] || '';
    const ymd = (mine.find(r => r.묶음일자)?.묶음일자 || baseDay).trim();
    const orders = new Set(mine.map(r => r._발주번호));
    if (!confirm(`${bundle}에 담긴 발주 ${orders.size}건을\n\n  물류센터: ${center}\n  입고예정일: ${ymd}\n\n(으)로 바꿀까요? 발송 목록의 원래 내용이 이 값으로 바뀝니다.`)) return;

    const updated = extractOrderRows(leftRows).map(r => r.묶음 === bundle
      ? { ...r, 물류센터: center, 입고예정일: ymd ? normalizeDateValue(ymd) : r.입고예정일, 묶음센터: '', 묶음일자: '' }
      : r);
    setLeftRows(buildDisplayRows(sortOrderRows(updated)));
  }, [leftRows]);

  // 묶음을 쉽먼트생성 화면으로 넘긴다. 발주서 줄들과 묶음 정보(센터·입고예정일)가 한 쌍으로 간다.
  const handleShipOut = useCallback((bundle: string) => {
    const mine = leftRows.filter(r => !r.isBlank && r.묶음 === bundle);
    if (!mine.length) return;
    const center = (mine.find(r => r.묶음센터)?.묶음센터 || mine[0]._물류센터 || '').trim();
    const days = mine.map(r => dateKeyYMD(r._입고예정일)).filter(d => d && d !== '9999-12-31');
    const baseDay = days.slice().sort((a, b) => ymdSortKey(a) - ymdSortKey(b))[0] || '';
    const date = (mine.find(r => r.묶음일자)?.묶음일자 || baseDay).trim();
    const orders = new Set(mine.map(r => r._발주번호));
    if (!confirm(`${bundle}(발주 ${orders.size}건 · ${center} · ${date})을 쉽먼트생성으로 보낼까요?`)) return;

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
    setNotice(`${item.id} · ${bundle}(발주 ${orders.size}건)을 쉽먼트생성으로 보냈어요`);
    onGoShipOut?.();
  }, [leftRows, doneBundles, fileName, onGoShipOut]);

  // 묶음 완료 표시 켜기/끄기.
  const handleToggleDone = useCallback((bundle: string) => {
    setDoneBundles(prev => {
      const next = new Set(prev);
      if (next.has(bundle)) next.delete(bundle); else next.add(bundle);
      return next;
    });
  }, []);

  // 묶음 하나를 통째로 박스 지정/해제.
  const handleBundleBox = useCallback((bundle: string, value: string) => {
    setLeftRows(prev => prev.map(r => r.묶음 === bundle ? { ...r, 쉼먼트: value } : r));
  }, []);

  // 묶음을 없앤다. 줄은 그대로 두고 묶음 표시와 박스 지정만 뗀다.
  const handleUnbundle = useCallback((bundle: string) => {
    setLeftRows(prev => prev.map(r => r.묶음 === bundle ? { ...r, 묶음: '', 쉼먼트: '' } : r));
    setDoneBundles(prev => {
      if (!prev.has(bundle)) return prev;
      const next = new Set(prev);
      next.delete(bundle);
      return next;
    });
  }, []);

  // 발주서 하나만 묶음에서 뺀다.
  const handleRemoveFromBundle = useCallback((orderNo: string) => {
    setLeftRows(prev => prev.map(r => r._발주번호 === orderNo ? { ...r, 묶음: '', 쉼먼트: '' } : r));
  }, []);

  const handleRightShipmentChange = useCallback((id: string, value: string) => {
    const row = rightRows.find(r => r.id === id);
    if (row) updateReservationShipment(toOrderRow(row), value).catch(alertError);
  }, [rightRows]);

  const handleDeleteReservation = useCallback((id: string) => {
    const row = rightRows.find(r => r.id === id);
    if (!row) return;
    if (!confirm(`"${row.상품이름}" 예약을 삭제할까요?\n삭제하면 되돌릴 수 없어요.`)) return;
    deleteReservations([toOrderRow(row)]).catch(alertError);
  }, [rightRows]);

  // 메모에 "예약"을 표시한 줄을 예약 목록으로 넘긴다. 한중발주(1688 주문)는 실제로 주문할 때
  // 한중발주 메뉴의 "발주 대기"에서 골라 고유번호와 함께 만든다. (예전 "한중" 표시도 예약으로 본다.)
  const isPicked = (r: DisplayRow) => !r.isBlank && (r.메모.includes('예약') || r.메모.includes('한중'));
  const handleReserve = useCallback(() => {
    const pickedRows = leftRows.filter(isPicked);
    if (!pickedRows.length) return;
    const pickedIds = new Set(pickedRows.map(r => r.id));
    addReservations(pickedRows.map(r => ({ ...toOrderRow(r), 메모: '예약' })), reservations)
      .then(() => setLeftRows(buildDisplayRows(extractOrderRows(leftRows.filter(r => !pickedIds.has(r.id))))))
      .catch(alertError);
  }, [leftRows, reservations]);

  // 예약 전체를 발송 패널로 되돌린다. 저장된 예약도 모두 지워지므로 한 번 더 묻는다.
  const handleCancelReservations = useCallback(() => {
    if (reservations.length === 0) return;
    if (!confirm(`저장된 예약 ${reservations.length}건을 모두 발송으로 되돌릴까요?\n예약 목록에서는 삭제돼요.`)) return;
    // 되돌린 줄은 발주서 순서대로 원래 자리에 끼워 넣고, 예약 표시(메모)는 지운다.
    const combined = sortOrderRows([...extractOrderRows(leftRows), ...reservations.map(r => ({ ...r, 메모: '' }))]);
    deleteReservations(reservations)
      .then(() => setLeftRows(buildDisplayRows(combined)))
      .catch(alertError);
  }, [leftRows, reservations]);

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
    if (leftRows.length && !confirm(`발송 목록 ${leftItemCount}건을 모두 지울까요?\n묶음도 함께 사라지고 되돌릴 수 없어요.`)) return;
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

  // 발주서 머리줄의 "전체예약 · 전체박스": 그 발주서의 상품 줄 전부에 한 번에 적용한다.
  // 예약은 한 줄씩 넘기던 길(handleLeftMemoChange)을 그대로 쓴다.
  const handleBulkOrder = useCallback((orderNo: string, patch: { 메모?: string; 쉼먼트?: string }) => {
    const lines = leftRows.filter(r => !r.isBlank && r._발주번호 === orderNo);
    if (!lines.length) return;
    if (patch.메모 !== undefined) {
      if (!confirm(`발주 ${orderNo}의 상품 ${lines.length}줄을 모두 예약으로 넘길까요?`)) return;
      const orders = lines.map(r => ({ ...toOrderRow(r), 메모: '예약' }));
      const ids = new Set(lines.map(r => r.id));
      setLeftRows(prev => buildDisplayRows(extractOrderRows(prev.filter(r => !ids.has(r.id)))));
      addReservations(orders, reservations).catch(err => {
        alertError(err);
        setLeftRows(prev => buildDisplayRows(sortOrderRows([...extractOrderRows(prev), ...orders.map(o => ({ ...o, 메모: '' }))])));
      });
      return;
    }
    if (patch.쉼먼트 !== undefined) {
      // 이미 다 지정돼 있으면 한 번 더 누를 때 해제한다.
      const already = lines.every(r => r.쉼먼트 === patch.쉼먼트);
      setLeftRows(prev => prev.map(r => r._발주번호 === orderNo ? { ...r, 쉼먼트: already ? '' : patch.쉼먼트! } : r));
    }
  }, [leftRows, reservations]);

  // 발송 목록에 있는 모든 발주서(발주번호). 전체선택에 쓴다.
  const allOrderNos = useMemo(
    () => Array.from(new Set(leftRows.filter(r => !r.isBlank).map(r => r._발주번호).filter(Boolean))),
    [leftRows],
  );
  const allSelected = allOrderNos.length > 0 && allOrderNos.every(no => selected.has(no));
  const toggleSelectAll = useCallback(() => {
    setSelected(allSelected ? new Set() : new Set(allOrderNos));
  }, [allSelected, allOrderNos]);

  // 지금 목록을 발주서 순서(입고예정일 → 물류센터 → 발주번호 → 상품이름)로 다시 줄 세운다.
  // 새 발주서는 아래에 쌓이고 출고에서 되돌린 줄도 자리를 찾아가지만, 이미 섞여 버린 목록은 이걸로 정리한다.
  const handleSort = useCallback(() => {
    setLeftRows(buildDisplayRows(sortOrderRows(extractOrderRows(leftRows))));
    setNotice('발주서 순서(입고예정일 → 센터 → 발주번호)로 다시 정렬했어요.');
  }, [leftRows]);

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
    setLeftRows(buildDisplayRows(kept));
    setNotice(`겹친 줄 ${dupCount}개를 지웠어요.`);
  }, [leftRows, dupCount]);

  const selectedCount = new Set(leftRows.filter(r => !r.isBlank && selected.has(r._발주번호)).map(r => r._발주번호)).size;

  return (
    <div style={{ minHeight: '100vh', background: '#fff', color: '#1a1a1a', fontFamily: "'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif" }}>
      <header style={{
        background: '#fff', borderBottom: '1px solid #f0f0f0',
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        <div style={{ maxWidth: 1600, margin: '0 auto', padding: '0 24px', height: 54, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <span style={{ fontSize: 17, fontWeight: 700, color: '#1a1a1a', letterSpacing: '-0.3px' }}>📦 쿠팡발주확인</span>
            <nav style={{ display: 'flex', gap: 2 }}>
              {(['shipment', 'settlement'] as Tab[]).map(id => (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  style={{
                    padding: '5px 16px', fontSize: 13,
                    fontWeight: activeTab === id ? 600 : 400,
                    color: activeTab === id ? '#1a1a1a' : '#999',
                    background: 'none', border: 'none', cursor: 'pointer',
                    borderBottom: activeTab === id ? '2px solid #1a1a1a' : '2px solid transparent',
                    transition: 'all 0.15s',
                  }}
                >
                  {id === 'shipment' ? '쉽먼트' : '정산'}
                </button>
              ))}
            </nav>
            {activeTab === 'shipment' && fileName && (
              <span style={{ fontSize: 11, color: '#999', background: '#f5f5f5', padding: '3px 10px', borderRadius: 20 }}>
                {fileName}
              </span>
            )}
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 1600, margin: '0 auto', padding: '20px 24px' }}>
        {activeTab === 'settlement' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 300, gap: 12 }}>
            <span style={{ fontSize: 32 }}>🧾</span>
            <p style={{ fontSize: 15, color: '#aaa', margin: 0 }}>정산 기능 준비 중입니다</p>
          </div>
        )}

        {activeTab === 'shipment' && (
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

            {error && (
              <div style={{ background: '#fff0f0', border: '1px solid #ffcccc', color: '#c0392b', fontSize: 13, padding: '10px 16px', borderRadius: 8, marginBottom: 14 }}>
                {error}
              </div>
            )}

            {!hasData && !loading && !error && (
              <div style={{ textAlign: 'center', padding: '16px 0' }}>
                <p style={{ fontSize: 13, color: '#aaa', marginBottom: 10 }}>박스수량 열 입력 예시</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 8 }}>
                  {['같은 상자에 담는 상품은 같은 박스 번호', '센터별 마지막 박스 번호 = 택배 예약 건수', '메모에 예약 → 예약 목록 · 한중발주 대기'].map(hint => (
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
                  <span style={{ fontSize: 11, color: '#ccc' }}>
                    발송 {leftItemCount}건 / 묶음 {bundleCount}개(발주 {bundledOrderCount}건) / 예약 {rightItemCount}건
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {selectedCount > 0 && <button
                    onClick={handleBundle}
                    title="체크한 발주서들로 새 묶음(택배 한 상자)을 만듭니다. 이미 있는 묶음에 더 담을 때는 그 묶음 카드의 +담기를 누르세요."
                    style={{ ...btnStyle('#7c3aed', '#7c3aed', '#fff'), fontWeight: 600 }}
                  >
                    ▶ 새 묶음
                    <span style={{ background: 'rgba(255,255,255,0.25)', padding: '1px 7px', borderRadius: 12, fontSize: 11, marginLeft: 4 }}>
                      발주 {selectedCount}건
                    </span>
                  </button>}

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
                <span style={{ fontSize: 11, color: '#bbb' }}>예약 버튼 = 누르면 바로 예약 목록으로 이동 (한중발주 메뉴의 발주 대기에 뜸)</span>
                <span style={{ fontSize: 11, color: '#ddd' }}>·</span>
                <span style={{ fontSize: 11, color: '#bbb' }}>↓ 발주서정리 저장 = 발송 목록 엑셀 저장</span>
                <span style={{ fontSize: 11, color: '#ddd' }}>·</span>
                <span style={{ fontSize: 11, color: '#bbb' }}>↓ 쉽먼트생성 = 센터별 상자 개수만큼 롯데택배 예약</span>
              </div>
            )}

            {hasData && (
              <div style={{
                display: 'grid',
                gridTemplateColumns: [
                  folded.send ? '34px' : '1.25fr',
                  folded.bundle ? '34px' : '0.7fr',
                  '1.1fr',
                ].join(' '),
                gap: 20, alignItems: 'start',
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
                      onShipmentChange={handleLeftShipmentChange}
                      colorScheme="pink"
                      officeQtyOf={officeQtyOf}
                      selectedOrders={selected}
                      onToggleSelect={toggleSelect}
                      onBulkOrder={handleBulkOrder}
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
                <div style={STICKY_PANEL}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <PanelTitle
                      icon="🧺" label="묶음" color="#7c3aed"
                      folded={folded.bundle}
                      onToggle={() => setFolded(f => ({ ...f, bundle: !f.bundle }))}
                    />
                    {bundleCount > 0 && <span style={{ fontSize: 11, color: '#aaa' }}>{bundleCount}묶음 · 발주 {bundledOrderCount}건</span>}
                  </div>
                  <BundlePanel
                    rows={leftRows}
                    onBoxChange={handleBundleBox}
                    onUnbundle={handleUnbundle}
                    onRemoveOrder={handleRemoveFromBundle}
                    selectedCount={selectedCount}
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

                <div style={STICKY_PANEL}>
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
                </div>
              </div>
            )}
          </div>
        )}
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
