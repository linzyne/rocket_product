import JsBarcode from 'jsbarcode';

// 상품 바코드 라벨을 폼텍 40칸(A4, 4열×10줄) 용지에 맞춰 새 탭에 그린다. 상품마다 수량만큼 칸을 채운다.
// 새 탭 위쪽 도구줄에서 용지 크기(여백 있는 48.5×25.4 / 꽉 찬 52.5×29.7)·시작 칸·위치 미세조정을 바꿀 수 있고,
// 바꾼 값은 이 컴퓨터에 기억한다. 도구줄은 인쇄되지 않는다.

export type SheetItem = { name: string; barcode: string; qty: number };

const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const validEan13 = (v: string) => {
  if (!/^\d{13}$/.test(v)) return false;
  const d = v.split('').map(Number);
  const sum = d.slice(0, 12).reduce((s, n, i) => s + n * (i % 2 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === d[12];
};

const barcodeSvg = (value: string) => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  JsBarcode(svg, value, {
    format: validEan13(value) ? 'EAN13' : 'CODE128',
    height: 60, width: 2, fontSize: 18, margin: 0, marginLeft: 14, marginRight: 14, textMargin: 1, displayValue: true,
  });
  const w = svg.getAttribute('width')?.replace('px', '') || '200';
  const h = svg.getAttribute('height')?.replace('px', '') || '80';
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.removeAttribute('width');
  svg.removeAttribute('height');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  return svg.outerHTML;
};

export const writeBarcodeSheet = (win: Window, title: string, items: SheetItem[]) => {
  const labels = items.flatMap(it => {
    const svg = barcodeSvg(it.barcode);
    return Array.from({ length: Math.max(0, it.qty) }, () => ({ name: it.name, svg }));
  });
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #e5e7eb; font-family: -apple-system, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; }
  .bar { position: sticky; top: 0; z-index: 9; display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: center; padding: 10px 16px; background: #fff; border-bottom: 1px solid #d1d5db; font-size: 13px; }
  .bar input, .bar select { font-size: 13px; padding: 3px 6px; }
  .bar input[type=number] { width: 64px; }
  .bar button { font-size: 14px; font-weight: 700; padding: 6px 16px; border-radius: 8px; border: 0; background: #2563eb; color: #fff; cursor: pointer; }
  .bar small { color: #6b7280; }
  .page { position: relative; width: 210mm; height: 297mm; margin: 12px auto; background: #fff; overflow: hidden; break-after: page; }
  .page:last-child { break-after: auto; }
  .cell { position: absolute; padding: 1.2mm 1.6mm; display: flex; flex-direction: column; align-items: center; overflow: hidden; }
  .cell.used { outline: 1px dashed #e5e7eb; }
  .name { width: 100%; font-size: 6.5pt; line-height: 1.15; font-weight: 700; text-align: center; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; word-break: keep-all; flex-shrink: 0; }
  .code { flex: 1; width: 100%; min-height: 0; margin-top: 0.6mm; }
  .code svg { width: 100%; height: 100%; display: block; }
  @media print {
    body { background: #fff; }
    .bar { display: none; }
    .page { margin: 0; }
    .cell.used { outline: 0; }
  }
</style></head><body>
<div class="bar">
  <b>${esc(title)}</b>
  <span>라벨 ${labels.length}장</span>
  <label>용지 <select id="preset">
    <option value="m">폼텍 40칸 48.5×25.4mm (여백 있음)</option>
    <option value="f">40칸 52.5×29.7mm (꽉 참)</option>
  </select></label>
  <label>시작 칸 <input id="start" type="number" min="1" max="40" value="1"></label>
  <label>위↓ <input id="dy" type="number" step="0.5" value="0"> mm</label>
  <label>오른쪽→ <input id="dx" type="number" step="0.5" value="0"> mm</label>
  <button onclick="window.print()">🖨 인쇄</button>
  <small>인쇄 창에서 배율 "실제 크기(100%)", 여백 "없음"으로 찍어 주세요.</small>
</div>
<div id="pages"></div>
<script>
  var LABELS = ${JSON.stringify(labels).replace(/</g, '\\u003c')};
  var PRESETS = {
    m: { w: 48.5, h: 25.4, cols: 4, rows: 10, left: 8, top: 21.5, gx: 0, gy: 0 },
    f: { w: 52.5, h: 29.7, cols: 4, rows: 10, left: 0, top: 0, gx: 0, gy: 0 }
  };
  var KEY = 'barcodeSheetLayout';
  var saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) {}
  var $ = function (id) { return document.getElementById(id); };
  $('preset').value = saved.preset || 'm';
  $('dy').value = saved.dy || 0;
  $('dx').value = saved.dx || 0;
  function draw() {
    var p = PRESETS[$('preset').value] || PRESETS.m;
    var per = p.cols * p.rows;
    var start = Math.min(per, Math.max(1, parseInt($('start').value, 10) || 1)) - 1;
    var dx = parseFloat($('dx').value) || 0, dy = parseFloat($('dy').value) || 0;
    try { localStorage.setItem(KEY, JSON.stringify({ preset: $('preset').value, dx: dx, dy: dy })); } catch (e) {}
    var total = start + LABELS.length;
    var pages = Math.max(1, Math.ceil(total / per));
    var out = '';
    for (var pg = 0; pg < pages; pg++) {
      out += '<div class="page">';
      for (var c = 0; c < per; c++) {
        var i = pg * per + c - start;
        if (i < 0 || i >= LABELS.length) continue;
        var col = c % p.cols, row = Math.floor(c / p.cols);
        var x = p.left + dx + col * (p.w + p.gx), y = p.top + dy + row * (p.h + p.gy);
        var l = LABELS[i];
        out += '<div class="cell used" style="left:' + x + 'mm;top:' + y + 'mm;width:' + p.w + 'mm;height:' + p.h + 'mm">'
          + '<div class="name"></div><div class="code">' + l.svg + '</div></div>';
      }
      out += '</div>';
    }
    $('pages').innerHTML = out;
    // 상품이름은 글자로 넣는다(HTML로 섞지 않게). 칸은 LABELS 차례대로 그렸다.
    var names = document.querySelectorAll('.cell .name');
    for (var j = 0; j < names.length; j++) names[j].textContent = LABELS[j].name;
  }
  ['preset', 'start', 'dx', 'dy'].forEach(function (id) { $(id).addEventListener('input', draw); });
  draw();
</script></body></html>`;
  win.document.open();
  win.document.write(html);
  win.document.close();
};
