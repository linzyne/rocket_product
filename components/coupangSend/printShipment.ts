// 쉽먼트 출력: 서허에서 그 쉽먼트의 Label·내역서를 받아 PDF 하나로 합쳐 새 탭에 열고, 그 발주서 상품의 바코드 라벨(폼텍 40칸)도
// 새 탭에 연다. 발송대기 화면과 발주 진행(쉽먼트 칸)이 같이 쓴다.
import { ShipOut, markShipOuts } from '../coupangOrder/data/shipOutStore';
import { parseFile } from '../coupangOrder/utils/dataProcessor';
import { loadBarcodeBook, loadArchiveBarcodes, rememberBarcodes, nameKey } from '../../data/coupangBarcodeStore';
import { writeBarcodeSheet, SheetItem } from '../../utils/barcodeSheet';

// 발주서를 출력완료로 표시하거나 푼다.
export const setPrinted = (item: ShipOut, no: string, on: boolean) =>
  markShipOuts([item.id], { printedOrders: on ? Array.from(new Set([...(item.printedOrders || []), no])) : (item.printedOrders || []).filter(x => x !== no) });

// 그 발주서 상품들의 바코드 라벨(폼텍 40칸)을 수량만큼 새 탭에 연다.
// 바코드는 발주서 파일에서 기억해 둔 것 → 로켓제안서 상품목록(이름이 같은 것) → 그래도 없으면 물어서 기억한다.
export const openBarcodes = async (item: ShipOut, orderNo: string, opened?: Window | null) => {
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
// note: 진행 문구를 화면에 보여줄 곳. 다 받으면 출력완료로 표시할지 묻는다.
export const printShipment = (item: ShipOut, orderNo: string, shipmentNo: string, note: (text: string) => void = () => {}) => {
  // 새 탭은 누른 순간에 열어 둔다(파일이 다 온 뒤에 열면 크롬이 팝업으로 막는다).
  const win = window.open('', '_blank');
  // 바코드 라벨 탭도 같이 연다(막히면 🏷 버튼으로).
  const barcodeWin = window.open('', '_blank');
  openBarcodes(item, orderNo, barcodeWin);
  win?.focus();
  win?.document.write('<p style="font:15px sans-serif;padding:32px;color:#555">서허에서 Label·내역서 받는 중…<br><small>다 받으면 이 탭에 합친 PDF가 열려요.</small></p>');
  const requestId = `${shipmentNo}-${Date.now()}`;
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
