import React, { useEffect, useMemo, useState } from 'react';
import ProductQtySummary from '../coupangOrder/components/ProductQtySummary';
import { ShipOut, ShipOutLine, subscribeShipOuts, markShipOuts, shipOutBatch, shipOutDone } from '../coupangOrder/data/shipOutStore';
import { ShipmentBatch, subscribeShipments, allBoxes, waybillForBox, batchForItem } from '../../data/shipmentStore';
import ShipmentWaybillModal from '../coupangOrder/components/ShipmentWaybillModal';
import { useHanjungBadge } from '../coupangOrder/data/useHanjungBadge';
import { useShipmentNoSync } from '../coupangOrder/data/useShipmentNoSync';
import { useReady } from '../coupangOrder/data/readyStore';
import { HanjungOrder, subscribeHanjung, makeHanjungOfficeLookup } from '../../data/hanjungStore';
import { expandBoxSplit, parseBoxNo, parseFile } from '../coupangOrder/utils/dataProcessor';
import { ymdSortKey } from '../coupangOrder/utils/dateUtils';
import { loadBarcodeBook, loadArchiveBarcodes, rememberBarcodes, nameKey } from '../../data/coupangBarcodeStore';
import { writeBarcodeSheet, SheetItem } from '../../utils/barcodeSheet';

// 발주 > 발송대기. 쉽먼트생성에서 "쉽먼트 완료"를 누른 건이 여기로 온다.
// 아직 준비 안 된 상품(입고 기다리는 것 등)이 다 준비될 때까지 기다리는 곳이다.
// 상품 줄마다 "준비됨"을 체크하고, 다 되면 "발송 완료"를 눌러 발송날짜를 고르면 아래 발송 완료 기록으로 내려간다.

// 쉽먼트생성과 같은 기준으로 끝난 건인지 본다(shipOutStore의 shipOutDone).
const batchOf = shipOutBatch;
const isShipDone = (item: ShipOut, batch?: ShipmentBatch) => shipOutDone(item, batch ? [batch] : []);

// 준비 표시는 상품 줄 단위(여러 박스로 나눈 줄도 한 번에 체크).
const readyKey = (l: Pick<ShipOutLine, '발주번호' | '상품이름' | '확정수량'>) => `${l.발주번호}│${l.상품이름}│${l.확정수량}`;

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const dayText = (ymd: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
  if (!m) return ymd || '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return `${Number(m[2])}/${Number(m[3])} (${WEEK[d.getDay()]})`;
};
const today = () => new Date().toLocaleDateString('sv-SE');
const fmtWaybill = (w: string) => {
  const d = String(w || '').replace(/\D/g, '');
  return d.length === 12 ? `${d.slice(0, 4)}-${d.slice(4, 8)}-${d.slice(8)}` : w;
};

const GREEN = '#27ae60';
const ORANGE = '#e67e22';

export default function CoupangSendPage({ onGoShip }: { onGoShip?: () => void } = {}) {
  const [list, setList] = useState<ShipOut[]>([]);
  const hanjungBadge = useHanjungBadge();
  useShipmentNoSync();
  // 쉽먼트 출력 진행 상황(발주번호 → 글). 쉽먼트 번호를 누르면 확장이 서허에서 Label·내역서를 받아 오고,
  // 여기서 두 PDF를 하나로 합쳐 새 탭에 연다(사람은 프린트만 누른다).
  const [printNote, setPrintNote] = useState<Record<string, string>>({});
  const setPrinted = (item: ShipOut, no: string, on: boolean) =>
    markShipOuts([item.id], { printedOrders: on ? Array.from(new Set([...(item.printedOrders || []), no])) : (item.printedOrders || []).filter(x => x !== no) });
  // 그 발주서 상품들의 바코드 라벨(폼텍 40칸)을 수량만큼 새 탭에 연다.
  // 바코드는 발주서 파일에서 기억해 둔 것 → 로켓제안서 상품목록(이름이 같은 것) → 그래도 없으면 물어서 기억한다.
  const openBarcodes = async (item: ShipOut, orderNo: string, opened?: Window | null) => {
    const win = opened === undefined ? window.open('', '_blank') : opened;
    if (!win) { alert('바코드 탭이 팝업으로 막혔어요. 🏷 버튼을 눌러 주세요.'); return; }
    win.document.write('<p style="font:15px sans-serif;padding:32px;color:#555">바코드 라벨 만드는 중…</p>');
    const groups = new Map<string, { sku: string; name: string; qty: number }>();
    for (const l of item.lines.filter(l => String(l.발주번호) === orderNo)) {
      const key = l.SKU || l.상품이름;
      const g = groups.get(key) || { sku: l.SKU || '', name: l.상품이름, qty: 0 };
      g.qty += Number(l.확정수량) || 0;
      groups.set(key, g);
    }
    const title = `바코드 ${item.center} ${orderNo}`;
    const errorPage = (t: string) => { if (!win.closed) win.document.body.innerHTML = `<p style="font:15px sans-serif;padding:32px;color:#c0392b">${t.replace(/</g, '&lt;')}</p>`; };
    const draw = (items: SheetItem[]) => {
      if (win.closed) return;
      if (!items.length) { errorPage('바코드가 있는 상품이 없어요.'); return; }
      try {
        writeBarcodeSheet(win, title, items);
      } catch (err: any) {
        errorPage(`바코드를 그리지 못했어요: ${err?.message || err}`);
      }
    };
    // 장부(발주서에서 기억) → 상품목록(이름이 같은 것 하나) 순서로 찾는다.
    let archive: { name: string; barcode: string }[] | null = null;
    const resolve = async () => {
      const book = await loadBarcodeBook();
      const found: SheetItem[] = [];
      const missing: { sku: string; name: string; qty: number }[] = [];
      for (const g of groups.values()) {
        let bc = (g.sku && book.bySku[g.sku]) || book.byName[g.name] || '';
        if (!bc) {
          archive = archive || await loadArchiveBarcodes();
          const hits = Array.from(new Set(archive.filter(a => nameKey(a.name) === nameKey(g.name)).map(a => a.barcode)));
          if (hits.length === 1) bc = hits[0];
        }
        if (bc) found.push({ name: g.name, barcode: bc, qty: g.qty });
        else missing.push(g);
      }
      return { found, missing };
    };
    const { found, missing } = await resolve();
    if (!missing.length) { draw(found); return; }
    if (win.closed) return;

    // 못 찾은 상품은 바코드 탭 안에서 적게 한다(앱 탭의 입력 창은 뒤에 있어 크롬이 바로 닫아 버린다).
    // 쿠팡 발주서 파일(PO_FOR_CONFIRM…xlsx)을 넣으면 그 안의 상품바코드로 한꺼번에 채운다.
    const esc = (t: string) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    win.document.open();
    win.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title)}</title></head>
<body style="font:14px -apple-system,'Apple SD Gothic Neo',sans-serif;padding:24px 32px;color:#1e293b;max-width:760px">
<h3 style="margin:0 0 6px">바코드를 못 찾은 상품이 ${missing.length}개 있어요</h3>
<p style="margin:0 0 16px;color:#64748b">쿠팡 발주서 파일을 넣으면 한꺼번에 채워져요. 아니면 바코드를 직접 적어 주세요. 한 번 적으면 기억해요.</p>
<label style="display:inline-block;margin-bottom:16px;padding:8px 14px;border:1px dashed #94a3b8;border-radius:8px;cursor:pointer">📄 쿠팡 발주서 파일 넣기 <input id="po" type="file" accept=".xlsx,.xls,.csv" multiple style="display:none"></label>
<span id="poNote" style="margin-left:8px;color:#64748b"></span>
<table style="border-collapse:collapse;width:100%">${missing.map((g, i) => `
<tr style="border-top:1px solid #e5e7eb"><td style="padding:8px 8px 8px 0">${esc(g.name)}<div style="font-size:12px;color:#94a3b8">${g.sku ? `상품번호 ${esc(g.sku)} · ` : ''}${g.qty}개</div></td>
<td style="width:220px"><input id="bc${i}" placeholder="바코드" style="width:100%;font-size:14px;padding:6px 8px;font-family:monospace"></td></tr>`).join('')}
</table>
<p style="margin-top:16px"><button id="go" style="font-size:15px;font-weight:700;padding:8px 20px;border:0;border-radius:8px;background:#2563eb;color:#fff;cursor:pointer">라벨 만들기</button>
<span style="margin-left:8px;color:#64748b">비워 둔 상품은 빼고 만들어요.</span></p>
${found.length ? `<p style="color:#64748b">바코드를 찾은 상품 ${found.length}개는 같이 들어가요.</p>` : ''}
</body></html>`);
    win.document.close();
    const $ = (id: string) => win.document.getElementById(id) as HTMLInputElement | null;
    $('po')?.addEventListener('change', async () => {
      const files = Array.from($('po')?.files || []);
      const note = $('poNote');
      if (note) note.textContent = '읽는 중…';
      try {
        // 발주서를 읽으면 상품바코드가 장부에 기억된다(dataProcessor). 다시 찾아서 칸을 채운다.
        for (const f of files) await parseFile(f);
        await new Promise(r => setTimeout(r, 300));
        const book = await loadBarcodeBook();
        let n = 0;
        missing.forEach((g, i) => {
          const bc = (g.sku && book.bySku[g.sku]) || book.byName[g.name] || '';
          const input = $(`bc${i}`);
          if (bc && input && !input.value) { input.value = bc; n++; }
        });
        if (note) note.textContent = n ? `${n}개 채웠어요.` : '이 파일에서는 못 찾았어요.';
      } catch (err: any) {
        if (note) note.textContent = `파일을 읽지 못했어요: ${err?.message || err}`;
      }
    });
    $('go')?.addEventListener('click', () => {
      const learned: { sku: string; name: string; barcode: string }[] = [];
      const items = [...found];
      missing.forEach((g, i) => {
        const bc = ($(`bc${i}`)?.value || '').trim();
        if (!bc) return;
        learned.push({ sku: g.sku, name: g.name, barcode: bc });
        items.push({ name: g.name, barcode: bc, qty: g.qty });
      });
      if (learned.length) rememberBarcodes(learned).catch(err => console.error('바코드 기억 실패:', err));
      draw(items);
    });
  };
  const printShipment = (item: ShipOut, orderNo: string, shipmentNo: string) => {
    // 새 탭은 누른 순간에 열어 둔다(파일이 다 온 뒤에 열면 크롬이 팝업으로 막는다).
    const win = window.open('', '_blank');
    // 바코드 라벨 탭도 같이 연다(막히면 🏷 버튼으로).
    const barcodeWin = window.open('', '_blank');
    openBarcodes(item, orderNo, barcodeWin);
    win?.focus();
    win?.document.write('<p style="font:15px sans-serif;padding:32px;color:#555">서허에서 Label·내역서 받는 중…<br><small>다 받으면 이 탭에 합친 PDF가 열려요.</small></p>');
    const requestId = `${shipmentNo}-${Date.now()}`;
    const note = (t: string) => setPrintNote(n => ({ ...n, [orderNo]: t }));
    const fail = (t: string) => {
      note(`❌ ${t}`);
      if (win && !win.closed) win.document.body.innerHTML = `<p style="font:15px sans-serif;padding:32px;color:#c0392b">${t.replace(/</g, '&lt;')}</p>`;
    };
    const onMsg = async (event: MessageEvent) => {
      const d = event.data;
      if (event.source !== window || !d || d.source !== 'rocket-hub-extension' || d.requestId !== requestId) return;
      if (d.type === 'SHUB_PRINT_ACK' && !d.ok) { window.removeEventListener('message', onMsg); fail(`서허를 열지 못했어요: ${d.error || ''}`); return; }
      if (d.type !== 'SHUB_PRINT_STATUS') return;
      if (d.step === 'error') { window.removeEventListener('message', onMsg); fail(d.status || '파일을 받지 못했어요'); return; }
      note(d.status || '');
      if (d.step !== 'files' || !d.files?.label || !d.files?.manifest) return;
      window.removeEventListener('message', onMsg);
      try {
        const { PDFDocument } = await import('pdf-lib');
        const out = await PDFDocument.create();
        for (const f of [d.files.label, d.files.manifest]) {
          const src = await PDFDocument.load(await (await fetch(f.dataUrl)).arrayBuffer());
          (await out.copyPages(src, src.getPageIndices())).forEach(pg => out.addPage(pg));
        }
        const url = URL.createObjectURL(new Blob([await out.save()], { type: 'application/pdf' }));
        if (win && !win.closed) win.location.href = url;
        else window.open(url, '_blank');
        note('✅ 합친 PDF를 새 탭에 열었어요');
        setTimeout(() => {
          if (confirm(`쉽먼트 ${shipmentNo}(발주 ${orderNo})을 출력완료로 표시할까요?`)) setPrinted(item, orderNo, true);
        }, 800);
      } catch (err: any) {
        fail(`PDF를 합치지 못했어요: ${err?.message || err}`);
      }
    };
    window.addEventListener('message', onMsg);
    setTimeout(() => window.removeEventListener('message', onMsg), 5 * 60 * 1000);
    note('서허 여는 중…');
    window.postMessage({ source: 'rocket-app-hub', type: 'SHUB_PRINT', requestId, shipmentNo, orderNo }, window.location.origin);
  };
  // 준비 체크: 쿠팡발주확인부터 쓰는 공통 기록 + 예전에 이 출고 건에 적어 둔 표시.
  const readyStore = useReady();
  const [batches, setBatches] = useState<ShipmentBatch[]>([]);
  // 사무실 칸 = 한중으로 넉넉히 사 둔 여유(도착한 것 + 오는 중인 것).
  const [hanjungOrders, setHanjungOrders] = useState<HanjungOrder[]>([]);
  const [sendPick, setSendPick] = useState<{ item: ShipOut; date: string } | null>(null);
  const [showSent, setShowSent] = useState(true);
  // 운송장번호를 고치는 창(쉽먼트 기록 하나를 연다).
  const [editBatch, setEditBatch] = useState<ShipmentBatch | null>(null);
  const editWaybills = (item: ShipOut) => {
    const b = batchForItem(batches, item);
    if (!b) { alert('이 건의 택배예약(쉽먼트) 기록을 찾지 못했어요. 쉽먼트생성 화면 아래 쉽먼트 기록에서 직접 고쳐 주세요.'); return; }
    setEditBatch(b);
  };

  useEffect(() => subscribeShipOuts(setList), []);
  useEffect(() => subscribeShipments(setBatches), []);
  useEffect(() => subscribeHanjung(setHanjungOrders), []);
  const officeQtyOf = useMemo(() => makeHanjungOfficeLookup(hanjungOrders), [hanjungOrders]);

  // 발송대기: 쉽먼트 완료했고 아직 안 보낸 건. 입고예정일 빠른 순.
  // 발송대기: 입고예정일이 늦은 것부터(빠른 날짜가 아래로).
  const waiting = useMemo(
    () => list
      .filter(i => !i.sentDate && isShipDone(i, batchOf(i, batches)))
      .sort((a, b) => ymdSortKey(b.date) - ymdSortKey(a.date) || a.center.localeCompare(b.center, 'ko', { numeric: true })),
    [list, batches],
  );
  // 발송 완료: 보낸 날 최근 순.
  const sent = useMemo(
    () => list.filter(i => !!i.sentDate).sort((a, b) => (b.sentDate || '').localeCompare(a.sentDate || '') || b.createdAt - a.createdAt),
    [list],
  );

  // 박스 n번의 운송장번호(쉽먼트 기록을 내용으로 확인해서 확실한 것만).
  const waybillOf = (item: ShipOut, no: number) => waybillForBox(batches, item, no);

  // 박스별로 묶은 줄(나눠 담은 줄은 박스마다 조각으로).
  const boxesOf = (item: ShipOut) => {
    const byBox = new Map<number, { line: ShipOutLine; qty: number }[]>();
    for (const l of item.lines) {
      for (const piece of expandBoxSplit({ ...l, 쉼먼트: l.쉼먼트 || '' })) {
        const no = parseBoxNo(piece.쉼먼트) || 0;
        byBox.set(no, [...(byBox.get(no) || []), { line: l, qty: Number(piece.확정수량) || 0 }]);
      }
    }
    return Array.from(byBox.entries()).sort((a, b) => (a[0] || 9999) - (b[0] || 9999));
  };

  const isLineReady = (item: ShipOut, l: ShipOutLine) => readyStore.isReady(l, item.readyKeys);
  const readyCount = (item: ShipOut) => ({ done: item.lines.filter(l => isLineReady(item, l)).length, total: item.lines.length });

  const toggleReady = (item: ShipOut, lines: ShipOutLine[], on: boolean) => {
    readyStore.setReady(lines, on).catch(err => alert(`준비 체크 저장 실패: ${err?.message || err}`));
    // 끌 때는 예전 방식으로 출고 건에 적혀 있던 표시도 지운다.
    if (!on && item.readyKeys?.length) {
      const drop = new Set(lines.map(readyKey));
      const rest = item.readyKeys.filter(k => !drop.has(k));
      if (rest.length !== item.readyKeys.length) markShipOuts([item.id], { readyKeys: rest });
    }
  };

  const backToShip = (item: ShipOut) => {
    if (!confirm(`${item.bundle}(${item.center})의 쉽먼트 완료를 풀고 쉽먼트생성으로 되돌릴까요?`)) return;
    markShipOuts([item.id], { doneAt: undefined, undoneAt: Date.now() });
    onGoShip?.();
  };

  const openSend = (item: ShipOut) => {
    const { done, total } = readyCount(item);
    if (done < total && !confirm(`아직 준비 안 된 상품이 ${total - done}줄 있어요. 그래도 발송 완료로 할까요?`)) return;
    setSendPick({ item, date: today() });
  };
  const saveSend = () => {
    if (!sendPick || !sendPick.date) return;
    markShipOuts([sendPick.item.id], { sentDate: sendPick.date });
    setSendPick(null);
  };
  const unsend = (item: ShipOut) => {
    if (!confirm(`${item.bundle}(${item.center} · ${item.sentDate} 발송)을 발송대기로 되돌릴까요?`)) return;
    markShipOuts([item.id], { sentDate: undefined });
  };


  const btn = (color: string, solid = false): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 4, height: 28, padding: '0 11px',
    fontSize: 12, fontWeight: 700, borderRadius: 7, cursor: 'pointer', whiteSpace: 'nowrap',
    border: `1.5px solid ${solid ? color : `${color}66`}`, background: solid ? color : '#fff', color: solid ? '#fff' : color,
  });



  return (
    <div style={{ minHeight: '100vh', background: '#fff', color: '#1a1a1a', fontFamily: "'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif" }}>
      <header style={{ background: '#fff', borderBottom: '1px solid #f0f0f0', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '6px clamp(12px, 4vw, 24px)', minHeight: 54, boxSizing: 'border-box', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px 12px' }}>
          <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.3px' }}>📦 발송대기/완료</span>
          <span style={{ fontSize: 12, color: '#999' }}>대기 {waiting.length}건 · 발송 완료 {sent.length}건</span>
        </div>
      </header>

      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '20px clamp(10px, 4vw, 24px) 70px' }}>
        <ProductQtySummary lines={waiting.flatMap(i => i.lines.map(l => ({ ...l, ready: isLineReady(i, l) })))} />
        {waiting.length === 0 ? (
          <div style={{ border: '1px dashed #e0e0e0', borderRadius: 10, padding: '60px 0', textAlign: 'center', color: '#bbb', fontSize: 13 }}>
            발송을 기다리는 건이 없어요.<br />
            <span style={{ fontSize: 12 }}>쉽먼트생성에서 <strong>쉽먼트 완료</strong>를 누르면 여기로 와요.</span>
          </div>
        ) : (
          // 카드 목록(격자). 카드 안에서 바로 박스별 상품 준비 체크 · 운송장 · 발송 완료까지 한다.
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(340px, 100%), 1fr))', gap: 16, alignItems: 'start' }}>
            {waiting.map(item => {
              const { done, total } = readyCount(item);
              const allReady = total > 0 && done === total;
              const boxes = boxesOf(item);
              const boxCount = boxes.filter(([no]) => no > 0).length;
              return (
                <div key={item.id} style={{
                  border: `1.5px solid ${allReady ? `${GREEN}88` : '#e5e7eb'}`, borderRadius: 14, overflow: 'hidden',
                  background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
                }}>
                  {/* 머리: 센터 · 입고예정일 · 박스 수, 그 아래 발주서마다 한 줄(발주번호 · 쉽먼트 번호 · 🖨 출력 · 출력됨/미출력). */}
                  <div style={{ padding: '10px 12px', background: allReady ? '#f2fbf6' : '#fafafa', borderBottom: '1px solid #f0f0f0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ padding: '2px 9px', fontSize: 13, fontWeight: 800, borderRadius: 6, color: '#fff', background: '#b04a3e' }}>{item.center}</span>
                      <b style={{ fontSize: 14, color: '#1e293b' }}>{dayText(item.date)}</b>
                      <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 800, color: '#333' }}>📦 {boxCount}박스</span>
                    </div>
                    {Array.from(new Set<string>(item.lines.map(l => String(l.발주번호 || '')))).filter(Boolean).map(no => {
                      const on = (item.printedOrders || []).includes(no);
                      const ship = item.shipmentNos?.[no];
                      return (
                        <div key={no} style={{ marginTop: 6 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                            <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#333' }}>{no}</span>
                            {ship
                              ? <span style={{ fontFamily: 'monospace', color: '#0369a1', fontWeight: 700 }}>· 쉽먼트 {ship}</span>
                              : <span style={{ color: '#bbb' }}>· 쉽먼트 번호 없음</span>}
                            <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              <button
                                onClick={() => ship ? printShipment(item, no, ship) : alert('쉽먼트 번호가 아직 없어요. 서허 쉽먼트 일괄등록 뒤에 생겨요.')}
                                title={ship ? 'Label·내역서를 받아 하나로 합쳐 새 탭에 열어요(거기서 프린트)' : '쉽먼트 번호가 아직 없어요'}
                                style={{ width: 28, height: 24, padding: 0, fontSize: 15, borderRadius: 6, cursor: ship ? 'pointer' : 'not-allowed', border: '1px solid #d1d5db', background: '#fff', opacity: ship ? 1 : 0.4 }}
                              >
                                🖨
                              </button>
                              <button
                                onClick={() => openBarcodes(item, no)}
                                title="이 발주서 상품들의 바코드 라벨(폼텍 40칸)을 수량만큼 새 탭에 열어요"
                                style={{ width: 28, height: 24, padding: 0, fontSize: 14, borderRadius: 6, cursor: 'pointer', border: '1px solid #d1d5db', background: '#fff' }}
                              >
                                🏷
                              </button>
                              <button
                                onClick={() => {
                                  if (on && !confirm(`발주 ${no}을 미출력으로 되돌릴까요?`)) return;
                                  setPrinted(item, no, !on);
                                }}
                                title={on ? '눌러서 미출력으로 되돌려요' : '출력했으면 눌러요'}
                                style={{
                                  padding: '1px 9px', borderRadius: 999, cursor: 'pointer', fontSize: 11, fontWeight: 800,
                                  border: `1px solid ${on ? GREEN : '#f59e0b'}`, background: on ? GREEN : '#fffbeb', color: on ? '#fff' : '#b45309',
                                }}
                              >
                                {on ? '✓ 출력됨' : '미출력'}
                              </button>
                            </span>
                          </div>
                          {printNote[no] && <div style={{ fontSize: 10.5, marginTop: 2, color: printNote[no].startsWith('❌') ? '#c0392b' : '#64748b' }}>{printNote[no]}</div>}
                        </div>
                      );
                    })}
                  </div>

                  {/* 박스별 상품 줄: 체크하면 준비됨. 상품이 많으면 이 안에서만 스크롤해 카드 높이를 맞춘다. */}
                  <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                  {boxes.map(([no, pieces]) => {
                    const wb = no ? waybillOf(item, no) : '';
                    return (
                      <div key={no}>
                        <div style={{ position: 'sticky', top: 0, zIndex: 1, display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px', background: '#fdf5ec', fontSize: 11.5 }}>
                          <span style={{ padding: '0 7px', fontWeight: 800, borderRadius: 8, color: '#fff', background: ORANGE }}>{no ? `박스${no}` : '박스 미지정'}</span>
                          {wb
                            ? <span style={{ fontWeight: 700, color: '#333', fontFamily: 'monospace' }} title="롯데 운송장번호">🚚 {wb}</span>
                            : no > 0 && <span style={{ color: '#bbb' }}>운송장 없음</span>}
                          {no > 0 && (
                            <button onClick={() => editWaybills(item)} style={{ ...btn('#888'), height: 20, padding: '0 7px', fontSize: 10.5 }} title="이 건의 운송장번호를 고칩니다">
                              {wb ? '수정' : '넣기'}
                            </button>
                          )}
                        </div>
                        {pieces.map(({ line, qty }, i) => {
                          const key = readyKey(line);
                          const on = isLineReady(item, line);
                          const office = officeQtyOf(line.상품이름);
                          const need = Number(line.확정수량) || 0;
                          const short = (office.qty || 0) < need;
                          return (
                            <label
                              key={`${key}-${i}`}
                              title={`${line.상품이름} · 발주 ${line.발주번호}`}
                              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px', cursor: 'pointer', borderTop: '1px solid #f5f5f5', background: on ? '#f6fcf8' : '#fff' }}
                            >
                              <input type="checkbox" checked={on} onChange={e => toggleReady(item, [line], e.target.checked)} style={{ width: 15, height: 15, margin: 0, cursor: 'pointer', flexShrink: 0 }} />
                              <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 1.35, color: on ? '#8a9a90' : '#222', textDecoration: on ? 'line-through' : 'none' }}>
                                {line.상품이름.replace(/^주노엘\s*/, '')}
                                {hanjungBadge(line)}
                              </span>
                              <b style={{ fontSize: 12.5, whiteSpace: 'nowrap' }} title={qty !== need ? `전체 ${need}개 중 이 박스` : undefined}>{qty.toLocaleString()}개</b>
                              <span
                                style={{ minWidth: 44, textAlign: 'right', fontSize: 10.5, whiteSpace: 'nowrap', color: !office.qty && !office.incoming ? '#ccc' : short ? '#c0392b' : '#999', fontWeight: short ? 800 : 500 }}
                                title={office.qty || office.incoming ? `사무실 재고(한중 여유) · 도착 ${office.qty}개${office.incoming ? ` · 오는 중 ${office.incoming}개` : ''}\n${office.names.join('\n')}` : '한중으로 넉넉히 사 둔 여유가 없어요'}
                              >
                                사무실 {office.qty || office.incoming ? office.qty : '-'}{office.incoming ? ` +${office.incoming}` : ''}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    );
                  })}
                  </div>

                  {/* 아래: 준비 진행 막대 · 버튼 */}
                  <div style={{ padding: '10px 12px 12px', borderTop: '1px solid #f0f0f0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, height: 7, borderRadius: 999, background: '#eef0f3', overflow: 'hidden' }}>
                        <div style={{ width: `${total ? (done / total) * 100 : 0}%`, height: '100%', borderRadius: 999, background: allReady ? GREEN : ORANGE, transition: 'width .2s' }} />
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 800, color: allReady ? GREEN : ORANGE, whiteSpace: 'nowrap' }}>
                        {allReady ? '✓ 모두 준비됨' : `준비 ${done}/${total}`}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10 }}>
                      <button onClick={() => toggleReady(item, item.lines, !allReady)} style={btn('#555')}>
                        {allReady ? '준비 풀기' : '모두 준비'}
                      </button>
                      <button onClick={() => openSend(item)} style={btn(GREEN, allReady)} title="택배를 보냈으면 누르고 발송날짜를 고르세요">
                        🚚 발송 완료
                      </button>
                      <button onClick={() => backToShip(item)} style={{ ...btn('#999'), marginLeft: 'auto' }} title="쉽먼트 완료를 풀고 쉽먼트생성으로 되돌립니다">
                        ← 쉽먼트생성
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 발송 완료 기록 */}
        {sent.length > 0 && (
          <div style={{ marginTop: 28 }}>
            <button
              onClick={() => setShowSent(v => !v)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: 0, background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700, color: GREEN }}
            >
              <span style={{ fontSize: 10, color: '#bbb' }}>{showSent ? '▾' : '▸'}</span>
              ✓ 발송 완료 {sent.length}건
              <span style={{ marginLeft: 4, fontSize: 11, fontWeight: 500, color: '#aaa' }}>{showSent ? '접기' : '펼치기'}</span>
            </button>
            {showSent && (
              <div style={{ marginTop: 8, border: '1px solid #eee', borderRadius: 10, overflow: 'hidden' }}>
                {sent.map(item => {
                  const nos = boxesOf(item).map(([no]) => no).filter(Boolean);
                  return (
                    <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', borderTop: '1px solid #f4f4f4', fontSize: 12 }}>
                      <b style={{ color: GREEN, minWidth: 70 }}>{dayText(item.sentDate || '')}</b>
                      <span style={{ fontWeight: 700, color: '#333', minWidth: 60 }}>{item.center}</span>
                      <span style={{ color: '#888' }}>입고 {dayText(item.date)}</span>
                      <span style={{ color: '#888' }}>{item.bundle}</span>
                      <span style={{ fontWeight: 700 }}>📦 {nos.length}박스</span>
                      {/* 운송장번호는 옆으로 늘어나지 않게 박스마다 한 줄씩 쌓는다. */}
                      <span style={{ display: 'flex', flexDirection: 'column', gap: 1, fontSize: 11.5, color: '#555', fontFamily: 'monospace' }}>
                        {nos.map(no => (
                          <span key={no}>
                            <span style={{ color: '#aaa', fontFamily: 'inherit' }}>박스{no} </span>
                            {waybillOf(item, no) || <span style={{ color: '#ccc' }}>번호 없음</span>}
                          </span>
                        ))}
                      </span>
                      <button onClick={() => editWaybills(item)} style={{ ...btn('#888'), marginLeft: 'auto', height: 24 }} title="이 건의 운송장번호를 고칩니다">
                        운송장 수정
                      </button>
                      <button onClick={() => unsend(item)} style={{ ...btn('#999'), height: 24 }} title="발송 완료를 풀고 발송대기로 되돌립니다">
                        되돌리기
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>

      {editBatch && <ShipmentWaybillModal batch={editBatch} onClose={() => setEditBatch(null)} />}

      {sendPick && (
        <div
          onClick={() => setSendPick(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div onClick={e => e.stopPropagation()} style={{ width: 300, background: '#fff', borderRadius: 12, padding: 18, boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>발송 완료</div>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 12 }}>{sendPick.item.bundle} · {sendPick.item.center}</div>
            <label style={{ fontSize: 12, fontWeight: 700, color: '#333' }}>
              발송날짜
              <input
                type="date"
                value={sendPick.date}
                autoFocus
                onChange={e => setSendPick(prev => prev && { ...prev, date: e.target.value })}
                onKeyDown={e => { if (e.key === 'Enter') saveSend(); }}
                style={{ display: 'block', width: '100%', marginTop: 6, padding: '7px 10px', fontSize: 14, borderRadius: 8, border: '1px solid #ddd', boxSizing: 'border-box' }}
              />
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button onClick={() => setSendPick(null)} style={{ padding: '6px 14px', fontSize: 13, background: '#f3f3f3', border: 'none', borderRadius: 6, cursor: 'pointer' }}>취소</button>
              <button onClick={saveSend} disabled={!sendPick.date} style={{ padding: '6px 14px', fontSize: 13, fontWeight: 700, color: '#fff', background: GREEN, border: 'none', borderRadius: 6, cursor: 'pointer' }}>
                발송 완료
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
