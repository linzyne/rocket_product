import React, { useState, useCallback, useEffect, useMemo } from 'react';
import FileUpload from './components/FileUpload';
import OrderTable from './components/OrderTable';
import AddressManager from './components/AddressManager';
import SenderManager from './components/SenderManager';
import {
  parseFile, buildDisplayRows, extractOrderRows, sortOrderRows, totalBoxCount, shipmentCenters,
} from './utils/dataProcessor';
import type { DisplayRow } from './utils/dataProcessor';
import { exportLotteExcel, exportSummaryExcel } from './utils/excelExport';
import { printPanel } from './utils/printUtils';
import type { AddressEntry, SenderInfo } from './types';
import {
  loadLocalAddresses, loadLocalSender, subscribeShippingSettings, saveAddresses, saveSender,
} from './data/shippingSettingsStore';
import { subscribeReservations, addReservations, updateReservationShipment, deleteReservations } from './data/reservationStore';
import type { OrderRow } from './types';
import { dateKeyYMD, normalizeDateValue } from './utils/dateUtils';
import {
  ShipmentBatch, subscribeShipments, saveShipmentBatch, batchId, fillWaybills, allBoxes,
} from '../../data/shipmentStore';
import { InventoryItem, subscribeInventory, makeOfficeLookup } from '../../data/inventoryStore';
import ShipmentWaybillModal from './components/ShipmentWaybillModal';
import ShipmentList from './components/ShipmentList';
import { fillShubForm, dataUrlToBuffer } from './utils/shubForm';

// 화면 한 줄 → 원래 발주 한 건(줄였던 발주번호·물류센터·날짜를 되살림).
const toOrderRow = (r: DisplayRow): OrderRow => ({
  발주번호: r._발주번호,
  물류센터: r._물류센터,
  상품이름: r.상품이름,
  확정수량: r.확정수량,
  입고예정일: r._입고예정일,
  메모: r.메모,
  쉼먼트: r.쉼먼트,
});

// 발송 쪽 작업 중인 목록(메모·롯데 표시 포함)을 이 컴퓨터에 남겨 둔다. 다른 메뉴에 다녀오거나 새로고침해도
// 그대로 다시 뜨고, "새 파일"을 누를 때만 비운다. 날짜는 'YYYYMMDD' 글자로 저장했다가 되살린다.
const WORK_KEY = 'coupangOrderWork';

function loadWork(): { rows: DisplayRow[]; fileName: string } {
  try {
    const saved = JSON.parse(localStorage.getItem(WORK_KEY) || '');
    const rows: OrderRow[] = (saved.rows || []).map((r: OrderRow) => ({ ...r, 입고예정일: normalizeDateValue(r.입고예정일) }));
    return { rows: buildDisplayRows(rows), fileName: saved.fileName || '' };
  } catch {
    return { rows: [], fileName: '' };
  }
}

function saveWork(rows: DisplayRow[], fileName: string) {
  try {
    if (!rows.length) {
      localStorage.removeItem(WORK_KEY);
      return;
    }
    const plain = extractOrderRows(rows).map(r => ({ ...r, 입고예정일: dateKeyYMD(r.입고예정일).replace(/-/g, '') }));
    localStorage.setItem(WORK_KEY, JSON.stringify({ rows: plain, fileName }));
  } catch {}
}

const alertError = (err: unknown) => alert(`예약 저장 실패: ${err instanceof Error ? err.message : String(err)}`);

type Tab = 'shipment' | 'settlement';

// 발주 > 쿠팡발주확인. 쿠팡 발주서(엑셀/CSV)를 올려 발송·예약으로 나누고,
// 발주서정리 엑셀과 롯데택배 업로드 엑셀을 만든다. (원래 '쉽먼트' 앱을 그대로 옮겨온 것)
// 예약 패널은 저장소(data/reservationStore)에 계속 쌓이고, 삭제 버튼을 눌러야만 지워진다.
export default function CoupangOrderPage() {
  const [activeTab, setActiveTab] = useState<Tab>('shipment');
  const [initialWork] = useState(loadWork);
  const [leftRows, setLeftRows] = useState<DisplayRow[]>(initialWork.rows);
  const [reservations, setReservations] = useState<OrderRow[]>([]);
  const rightRows = useMemo(() => buildDisplayRows(reservations), [reservations]);
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState(initialWork.fileName);
  const [addresses, setAddresses] = useState<AddressEntry[]>(loadLocalAddresses);
  const [showAddressManager, setShowAddressManager] = useState(false);
  const [sender, setSender] = useState<SenderInfo>(loadLocalSender);
  const [showSenderManager, setShowSenderManager] = useState(false);
  // 쉽먼트생성으로 만든 택배 묶음(박스 배정 기록). 운송장번호를 여기에 채운다.
  const [batches, setBatches] = useState<ShipmentBatch[]>([]);
  // B단계(서허 양식 받기) 진행 문구와, 받아온 양식 파일.
  const [shubStatus, setShubStatus] = useState<string | null>(null);
  const [shubForm, setShubForm] = useState<{ batchId: string; name: string; dataUrl: string } | null>(null);
  // 지금 B·C를 진행 중인 쉽먼트(양식을 직접 골라 채울 때 쓴다).
  const [shubBatch, setShubBatch] = useState<ShipmentBatch | null>(null);
  const [waybillBatch, setWaybillBatch] = useState<ShipmentBatch | null>(null);
  // 재고 > 상품관리의 사무실 재고. 발주서 상품이름과 상품명을 맞춰 확정수량 옆에 보여준다.
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const officeQtyOf = useMemo(() => makeOfficeLookup(inventory), [inventory]);
  const [error, setError] = useState('');

  useEffect(() => subscribeReservations(setReservations), []);
  // 택배주소·보내는사람은 클라우드에 저장돼 있어 다른 컴퓨터에서 고친 것도 바로 반영된다.
  useEffect(() => subscribeShipments(setBatches), []);
  useEffect(() => subscribeInventory(setInventory), []);
  useEffect(() => subscribeShippingSettings(({ addresses, sender }) => { setAddresses(addresses); setSender(sender); }), []);
  useEffect(() => saveWork(leftRows, fileName), [leftRows, fileName]);

  const hasFile = leftRows.length > 0;
  const hasData = hasFile || rightRows.length > 0;

  const handleFile = useCallback(async (file: File) => {
    setLoading(true);
    setError('');
    try {
      const rows = await parseFile(file);
      if (rows.length === 0) {
        setError('데이터를 찾을 수 없습니다. 헤더가 올바른지 확인해주세요.');
      } else {
        setLeftRows(buildDisplayRows(rows));
        setFileName(file.name);
      }
    } catch (e) {
      setError('파일 처리 중 오류가 발생했습니다: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setLoading(false);
    }
  }, []);

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

  const handleAddressUpdate = (updated: AddressEntry[]) => {
    setAddresses(updated);
    saveAddresses(updated).catch(err => alert(`택배주소 저장 실패: ${err instanceof Error ? err.message : String(err)}`));
  };

  const handleSenderUpdate = (updated: SenderInfo) => {
    setSender(updated);
    saveSender(updated).catch(err => alert(`보내는사람 저장 실패: ${err instanceof Error ? err.message : String(err)}`));
  };

  // 롯데택배 엑셀을 만들고(내려받기), 원하면 "로켓 서허 연동" 확장이 롯데 ALPS를 작은 팝업 창으로 열어
  // 로그인 → 거래처관리 › 일괄주문접수 → 파일 올리기까지 하고 창을 닫는다. 끝나거나 실패하면 알려준다.
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
    window.postMessage(
      { source: 'rocket-app-hub', type: 'SHUB_FORM', batchId: batch.id, boxCount: allBoxes(batch).length, orderNos },
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
      setShubStatus(
        `${batch.id} · ✅ 양식 채워서 저장했어요 — ${res.fileName} (상품 ${res.filled}줄, 송장 ${res.waybills.length}개)` +
          (res.missed.length ? ` · 짝 못 찾은 줄 ${res.missed.length}개: ${res.missed.slice(0, 3).join(' / ')}` : '')
      );
    } catch (err) {
      setShubStatus(`${batch.id} · 양식을 채우지 못했어요: ${err instanceof Error ? err.message : String(err)}`);
    }
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

  const handleLotte = () => {
    // 쉽먼트 번호를 먼저 정해서 엑셀의 주문번호에 붙인다(롯데 목록에서 이번 건만 골라내는 표식).
    const id = batchId(batches);
    const file = exportLotteExcel(allRows, addresses, sender, id);
    if (!file) return;
    if (!confirm(`${file.name}을 내려받았어요.\n롯데택배(ALPS)에 올려서 택배 예약과 운송장 만들기까지 할까요?`)) return;

    // 지금의 박스 배정을 기록해 둔다(나중에 서허 쉽먼트 양식을 채울 때 씀).
    const batch: ShipmentBatch = {
      id,
      createdAt: Date.now(),
      status: 'reserved',
      centers: shipmentCenters(allRows).map(c => ({
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
          const filled = { ...fillWaybills(batch, d.waybills), status: 'waybilled' as const };
          saveShipmentBatch(filled).catch(() => {});
          // 번호는 이미 저장됐다. 박스가 다 채워졌으면 확인 창 없이 바로 B·C(서허 양식)로 넘어간다.
          // 빠진 게 있을 때만 확인 창을 띄워 직접 넣게 한다.
          const boxes = allBoxes(filled);
          if (boxes.length && boxes.every(b => b.waybill.trim())) {
            setShubStatus(`${filled.id} · 운송장 ${boxes.length}건 저장 완료 → 서허 양식 받는 중…`);
            setTimeout(() => handleShubForm(filled), 800);
          } else {
            setWaybillBatch(filled);
          }
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
    window.postMessage({ source: 'rocket-app-hub', type: 'LOTTE_UPLOAD', file, boxCount: lotteCount, batchId: batch.id }, window.location.origin);
  };

  // 발송 쪽만 비운다. 예약은 저장돼 있어서 그대로 남는다.
  const handleReset = () => {
    setLeftRows([]);
    setFileName('');
    setError('');
  };

  const allRows = [...leftRows, ...rightRows];
  // 택배 예약 건수 = 물류센터별로 지정된 상자 개수의 합.
  const lotteCount = totalBoxCount(allRows);

  const leftItemCount = leftRows.filter(r => !r.isBlank).length;
  const rightItemCount = rightRows.filter(r => !r.isBlank).length;

  const pendingCount = leftRows.filter(isPicked).length;

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
          {activeTab === 'shipment' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                onClick={() => setShowSenderManager(true)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
                  fontSize: 12, color: '#666', background: 'none',
                  border: '1px solid #e5e5e5', borderRadius: 8, cursor: 'pointer',
                }}
              >
                📮 보내는사람 설정
              </button>
              <button
                onClick={() => setShowAddressManager(true)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
                  fontSize: 12, color: '#666', background: 'none',
                  border: '1px solid #e5e5e5', borderRadius: 8, cursor: 'pointer',
                }}
              >
                🗺️ 택배주소 관리
              </button>
            </div>
          )}
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
            {!hasFile && (
              <div style={{ marginBottom: 20 }}>
                <FileUpload onFile={handleFile} loading={loading} />
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
                  {hasFile && (
                    <button onClick={handleReset} style={btnStyle('#fff', '#e5e5e5', '#555')}>
                      ↩ 새 파일
                    </button>
                  )}
                  <span style={{ fontSize: 11, color: '#ccc' }}>
                    발송 {leftItemCount}건 / 예약 {rightItemCount}건
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

                  <button
                    onClick={handleLotte}
                    disabled={lotteCount === 0}
                    title="물류센터별로 지정한 상자 개수만큼 롯데택배 예약 엑셀을 만들고, 원하면 택배사 사이트에 올려 예약까지 합니다."
                    style={{
                      ...btnStyle(
                        lotteCount > 0 ? '#e67e22' : '#f5f5f5',
                        lotteCount > 0 ? '#e67e22' : '#f5f5f5',
                        lotteCount > 0 ? '#fff' : '#bbb'
                      ),
                      cursor: lotteCount > 0 ? 'pointer' : 'not-allowed',
                      fontWeight: 600,
                    }}
                  >
                    ↓ 쉽먼트생성
                    {lotteCount > 0 && (
                      <span style={{ background: 'rgba(255,255,255,0.25)', padding: '1px 7px', borderRadius: 12, fontSize: 11, marginLeft: 4 }}>
                        {lotteCount}박스
                      </span>
                    )}
                  </button>
                </div>
              </div>
            )}

            {hasData && (
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '2px 10px', marginTop: -8, marginBottom: 14 }}>
                <span style={{ fontSize: 11, color: '#bbb' }}>예약 버튼 = 누르면 바로 예약 목록으로 이동 (한중발주 메뉴의 발주 대기에 뜸)</span>
                <span style={{ fontSize: 11, color: '#ddd' }}>·</span>
                <span style={{ fontSize: 11, color: '#bbb' }}>↓ 발주서정리 저장 = 발송 목록 엑셀 저장</span>
                <span style={{ fontSize: 11, color: '#ddd' }}>·</span>
                <span style={{ fontSize: 11, color: '#bbb' }}>↓ 쉽먼트생성 = 센터별 상자 개수만큼 롯데택배 예약</span>
              </div>
            )}

            {hasData && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#c0392b', letterSpacing: '-0.2px' }}>📤 발송</span>
                    {leftItemCount > 0 && <span style={{ fontSize: 11, color: '#aaa' }}>{leftItemCount}건</span>}
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
                    />
                  ) : (
                    <div style={{ border: '1px dashed #e8e8e8', borderRadius: 10, padding: '48px 0', textAlign: 'center', color: '#ccc', fontSize: 13 }}>
                      발송 항목 없음
                    </div>
                  )}
                </div>

                <div>
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
            />
          </div>
        )}
      </main>

      {showAddressManager && (
        <AddressManager
          addresses={addresses}
          onUpdate={handleAddressUpdate}
          onClose={() => setShowAddressManager(false)}
        />
      )}

      {waybillBatch && (
        <ShipmentWaybillModal batch={waybillBatch} onClose={() => setWaybillBatch(null)} />
      )}

      {showSenderManager && (
        <SenderManager
          sender={sender}
          onUpdate={handleSenderUpdate}
          onClose={() => setShowSenderManager(false)}
        />
      )}
    </div>
  );
}

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
