import React, { useEffect, useMemo, useState } from 'react';
import { ShipOut, subscribeShipOuts, deleteShipOut, restoreShipOut, restoreOrders, updateShipOutLine, markShipOuts } from '../coupangOrder/data/shipOutStore';
import { InventoryItem, subscribeInventory, makeOfficeLookup } from '../../data/inventoryStore';
import { dateKeyYMD } from '../coupangOrder/utils/dateUtils';
import OrderTable from '../coupangOrder/components/OrderTable';
import { buildDisplayRows, parseBoxNo } from '../coupangOrder/utils/dataProcessor';
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
  ShipmentBatch, subscribeShipments, saveShipmentBatch, batchId, fillWaybills, allBoxes,
} from '../../data/shipmentStore';
import AddressManager from '../coupangOrder/components/AddressManager';
import SenderManager from '../coupangOrder/components/SenderManager';
import ShipmentWaybillModal from '../coupangOrder/components/ShipmentWaybillModal';
import ShipmentList from '../coupangOrder/components/ShipmentList';

// 발주 > 쉽먼트생성. 쿠팡발주확인의 묶음 패널에서 "쉽먼트"를 누른 건들이 여기로 옮겨 온다.
// 화면 모양은 쿠팡발주확인과 같게: 왼쪽은 발주서 표, 오른쪽은 묶음(출고 건) 카드.
// 묶음 이름은 출고 건마다 겹칠 수 있어서, 표에는 출고번호(S260925-1)를 묶음 값으로 넣어 구분한다.
// 줄 하나를 가리키는 열쇠(박스 순서를 기억할 때 쓴다).
const lineKey = (l: { 발주번호: string; 상품이름: string; 확정수량: number | ''; 입고예정일: string }) =>
  `${l.발주번호}│${l.상품이름}│${l.확정수량}│${l.입고예정일}`;

export default function CoupangShipPage({ onGoOrder }: { onGoOrder?: () => void } = {}) {
  const [list, setList] = useState<ShipOut[]>([]);
  const [copied, setCopied] = useState('');
  const [opened, setOpened] = useState<Set<string>>(new Set());
  // 되돌릴 발주서 고르기(발주확인의 묶기 체크 칸과 같은 자리).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // 발주확인 표와 똑같이 보이도록 사무실 재고 칸도 같이 띄운다.
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const officeQtyOf = useMemo(() => makeOfficeLookup(inventory), [inventory]);

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
  useEffect(() => subscribeInventory(setInventory), []);
  useEffect(() => subscribeShipments(setBatches), []);
  useEffect(() => subscribeShippingSettings(({ addresses, sender }) => { setAddresses(addresses); setSender(sender); }), []);

  // 박스 순으로 세운 줄 차례(눌렀을 때 한 번 정해 두고, 그 뒤로는 그대로 둔다).
  const [boxOrder, setBoxOrder] = useState<string[] | null>(null);
  const sortByBox = () => {
    const keys = ordered.flatMap(item => item.lines
      .slice()
      .sort((a, b) => (parseBoxNo(a.쉼먼트 || '') ?? 9999) - (parseBoxNo(b.쉼먼트 || '') ?? 9999))
      .map(lineKey));
    setBoxOrder(keys);
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
      // 자동으로 다 켜졌거나, 사람이 직접 완료로 표시했으면 끝난 것으로 본다.
      done: !!item.doneAt || (!!batch && boxes.length > 0 && waybills === boxes.length && !!item.formSavedAt),
    };
  };

  // 완료한 출고 건의 발주번호들. 왼쪽 발주서 표에서도 같이 불을 꺼 준다.
  const dimmedOrders = useMemo(() => {
    const set = new Set<string>();
    for (const item of list) {
      if (!progressOf(item).done) continue;
      for (const l of item.lines) if (l.발주번호) set.add(String(l.발주번호).trim());
    }
    return set;
  }, [list, batches]);

  // 끝난 건은 아래로 내린다(새로 넘어온 건이 위에 오게). 표도 이 순서를 따라간다.
  const ordered = useMemo(
    () => list.slice().sort((a, b) => Number(progressOf(a).done) - Number(progressOf(b).done)),
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
        묶음: l.묶음 || item.bundle,
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
      }));
    return buildDisplayRows(all);
  }, [ordered, boxOrder]);

  const itemCount = rows.filter(r => !r.isBlank).length;

  const lotteCount = totalBoxCount(rows);

  // 표에서 예약·박스를 누르면 그 줄이 속한 출고 건의 값을 고친다(줄의 묶음 값이 출고번호다).
  const editLine = (id: string, patch: { 메모?: string; 쉼먼트?: string }) => {
    const row = rows.find(r => r.id === id);
    if (!row) return;
    updateShipOutLine(shipIdOf.get(row._발주번호) || '', {
      발주번호: row._발주번호,
      상품이름: row.상품이름,
      확정수량: row.확정수량,
      입고예정일: dateKeyYMD(row._입고예정일),
    }, patch);
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
    restoreOrders(orderNos);
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
      markShipOuts(list.filter(i => i.batchId === batch.id).map(i => i.id), { formSavedAt: Date.now() });
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
    const file = exportLotteExcel(rows, addresses, sender, id);
    if (!file) return;
    if (!confirm(`${file.name}을 내려받았어요.\n롯데택배(ALPS)에 올려서 택배 예약과 운송장 만들기까지 할까요?`)) return;

    // 지금의 박스 배정을 기록해 둔다(나중에 서허 쉽먼트 양식을 채울 때 씀).
    const batch: ShipmentBatch = {
      id,
      createdAt: Date.now(),
      status: 'reserved',
      centers: shipmentCenters(rows).map(c => ({
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
    markShipOuts(list.map(i => i.id), { batchId: id });

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



  // 손으로 완료 표시를 켜고 끈다.
  const toggleDone = (item: ShipOut) => {
    markShipOuts([item.id], { doneAt: item.doneAt ? undefined : Date.now() });
  };

  const remove = (item: ShipOut) => {
    if (!confirm(`${item.id} (${item.bundle} · ${item.center})을 출고 목록에서 지울까요?\n되돌릴 수 없어요.`)) return;
    deleteShipOut(item.id);
  };

  // 출고를 취소하고 쿠팡발주확인(발송 목록)으로 되돌린다. 묶음도 그대로 살아난다.
  const restore = (item: ShipOut) => {
    if (!confirm(`${item.id} (${item.bundle} · ${item.center})을 쿠팡발주확인으로 되돌릴까요?`)) return;
    restoreShipOut(item.id);
    onGoOrder?.();
  };

  return (
    <div style={{ minHeight: '100vh', background: '#fff', color: '#1a1a1a', fontFamily: "'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif" }}>
      <header style={{ background: '#fff', borderBottom: '1px solid #f0f0f0', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ maxWidth: 1600, margin: '0 auto', padding: '0 24px', height: 54, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.3px' }}>🚚 쉽먼트생성</span>
          {list.length > 0 && <span style={{ fontSize: 12, color: '#999' }}>출고 {list.length}건 · 발주 {itemCount}줄</span>}

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={() => setShowSenderManager(true)} style={plainBtn}>📮 보내는사람 설정</button>
            <button onClick={() => setShowAddressManager(true)} style={plainBtn}>🗺️ 택배주소 관리</button>
            <button
              onClick={handleLotte}
              disabled={lotteCount === 0}
              title="물류센터별로 지정한 상자 개수만큼 롯데택배 예약 엑셀을 만들고, 원하면 택배사 사이트에 올려 예약까지 합니다."
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                padding: '7px 14px', fontSize: 13, fontWeight: 600, borderRadius: 8,
                border: `1px solid ${lotteCount > 0 ? '#e67e22' : '#f5f5f5'}`,
                background: lotteCount > 0 ? '#e67e22' : '#f5f5f5',
                color: lotteCount > 0 ? '#fff' : '#bbb',
                cursor: lotteCount > 0 ? 'pointer' : 'not-allowed',
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
      </header>

      <main style={{ maxWidth: 1600, margin: '0 auto', padding: '20px 24px' }}>
        {list.length === 0 ? (
          <div style={{
            border: '1px dashed #e0e0e0', borderRadius: 10,
            padding: '60px 0', textAlign: 'center', color: '#bbb', fontSize: 13,
          }}>
            아직 넘어온 묶음이 없어요.<br />
            <span style={{ fontSize: 12 }}>쿠팡발주확인 → 묶음 카드의 <strong style={{ color: '#7c3aed' }}>쉽먼트</strong> 버튼을 눌러주세요.</span>
          </div>
        ) : (
          /* 쿠팡발주확인과 같은 3단 폭(발주서 / 묶음 / 예약 자리). 예약 자리는 여기선 비워 둔다. */
          <div style={{ display: 'grid', gridTemplateColumns: '1.25fr 0.7fr 1.1fr', gap: 20, alignItems: 'start' }}>
            {/* 왼쪽: 발주서 표(쿠팡발주확인의 발송 패널과 같은 표) */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
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
                      background: '#7c3aed', border: '1px solid #7c3aed', borderRadius: 6, cursor: 'pointer',
                    }}
                  >
                    ← 발주확인으로 {selected.size}건
                  </button>
                )}
              </div>
              <OrderTable
                rows={rows}
                onMemoChange={(id, v) => editLine(id, { 메모: v })}
                onShipmentChange={(id, v) => editLine(id, { 쉼먼트: v })}
                colorScheme="pink"
                officeQtyOf={officeQtyOf}
                selectedOrders={selected}
                onToggleSelect={toggleSelect}
                dimmedOrders={dimmedOrders}
              />
            </div>

            {/* 오른쪽: 묶음(출고 건) 카드 */}
            <div style={{ position: 'sticky', top: 66, maxHeight: 'calc(100vh - 80px)', overflowY: 'auto', overflowX: 'hidden', paddingRight: 2 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#7c3aed', letterSpacing: '-0.2px' }}>🧺 묶음</span>
                <span style={{ fontSize: 11, color: '#aaa' }}>{list.length}건</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {ordered.map(item => {
                  // 카드 안에서 발주번호별로 나눈다(쿠팡발주확인의 묶음 카드와 같은 모양).
                  const orders = new Map<string, typeof item.lines>();
                  for (const line of item.lines) {
                    const key = line.발주번호 || '(번호없음)';
                    orders.set(key, [...(orders.get(key) || []), line]);
                  }
                  const qty = item.lines.reduce((sum, l) => sum + (Number(l.확정수량) || 0), 0);

                  const pr = progressOf(item);

                  return (
                    <div key={item.id} style={{
                      border: '1px solid #d6c9f5', borderLeft: '4px solid #7c3aed',
                      borderRadius: 10, overflow: 'hidden', background: '#fff',
                      opacity: pr.done ? 0.5 : 1, transition: 'opacity 0.15s',
                    }}>
                      <div style={{ padding: '6px 8px', background: '#7c3aed12', borderBottom: '1px solid #7c3aed2e', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
                          <input
                            type="checkbox"
                            checked={orders.size > 0 && Array.from(orders.keys()).every(no => selected.has(no))}
                            onChange={e => {
                              const on = e.target.checked;
                              setSelected(prev => {
                                const next = new Set(prev);
                                for (const no of orders.keys()) { if (on) next.add(no); else next.delete(no); }
                                return next;
                              });
                            }}
                            title="이 묶음의 발주서를 모두 고릅니다"
                            style={{ cursor: 'pointer', margin: 0 }}
                          />
                          <span style={{ fontSize: 12, fontWeight: 800, color: '#7c3aed' }} title={`출고번호 ${item.id} · ${item.bundle}`}>{item.bundle}</span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: '#333', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.center}</span>
                          <span style={{ fontSize: 11, fontWeight: 700, color: '#2c3e50' }}>{item.date.slice(5).replace('-', '/')}</span>
                          <span style={{ marginLeft: 'auto', fontSize: 11, color: '#999' }}>발주 {orders.size} · {qty.toLocaleString()}개</span>
                        </div>

                        {pr.reserved && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 5, flexWrap: 'wrap', fontSize: 11 }}>
                            <span style={{ color: '#666', fontWeight: 700 }}>{item.batchId}</span>
                            <Chip on label="예약" />
                            <Chip on={pr.allWaybilled} label={pr.waybills > 0 ? `운송장 ${pr.waybills}건` : '운송장'} />
                            <Chip on={pr.formSaved} label="양식저장" />
                            {pr.done && <span style={{ color: '#27ae60', fontWeight: 700 }}>쉽먼트 완료</span>}
                          </div>
                        )}

                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 5, flexWrap: 'wrap' }}>
                          <button
                            onClick={() => copyOrderNos(item.id, Array.from(orders.keys()))}
                            title="이 출고 건의 발주번호를 한 줄에 하나씩 복사합니다"
                            style={{
                              padding: '2px 8px', fontSize: 11, borderRadius: 5, cursor: 'pointer',
                              border: copied === item.id ? '1.5px solid #27ae60' : '1px solid #e5e5e5',
                              background: copied === item.id ? '#e8f8f0' : '#fff',
                              color: copied === item.id ? '#27ae60' : '#888',
                              fontWeight: copied === item.id ? 700 : 400,
                            }}
                          >
                            {copied === item.id ? '복사됨 ✓' : '📋 발주번호'}
                          </button>
                          <button
                            onClick={() => restore(item)}
                            title="이 출고를 취소하고 쿠팡발주확인 발송 목록으로 되돌립니다"
                            style={{
                              padding: '2px 8px', fontSize: 11, fontWeight: 700, borderRadius: 5, cursor: 'pointer',
                              border: '1.5px solid #7c3aed', background: '#fff', color: '#7c3aed',
                            }}
                          >
                            ← 발주확인으로
                          </button>
                          <button
                            onClick={() => toggleDone(item)}
                            title={pr.done ? '완료 표시를 풉니다' : '이 건의 쉽먼트 작업이 끝났다고 표시합니다'}
                            style={{
                              marginLeft: 'auto',
                              padding: '2px 10px', fontSize: 11, fontWeight: 700, borderRadius: 5, cursor: 'pointer',
                              border: pr.done ? '1.5px solid #27ae60' : '1px solid #e5e5e5',
                              background: pr.done ? '#e8f8f0' : '#fff',
                              color: pr.done ? '#27ae60' : '#888',
                            }}
                          >
                            {pr.done ? '쉽먼트 완료 ✓' : '쉽먼트 완료'}
                          </button>
                          <button
                            onClick={() => remove(item)}
                            title="이 출고 건을 목록에서 지웁니다"
                            style={{
                              marginLeft: 'auto',
                              padding: '2px 8px', fontSize: 11, color: '#aaa',
                              background: '#fff', border: '1px solid #e5e5e5', borderRadius: 5, cursor: 'pointer',
                            }}
                          >
                            삭제
                          </button>
                        </div>
                      </div>

                      {Array.from(orders.entries()).map(([orderNo, lines]) => {
                        const key = `${item.id}|${orderNo}`;
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

            {/* 예약 자리(쿠팡발주확인과 폭을 맞추기 위해 비워 둔다) */}
            <div />
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

const plainBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
  fontSize: 12, color: '#666', background: 'none',
  border: '1px solid #e5e5e5', borderRadius: 8, cursor: 'pointer',
};
