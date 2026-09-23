import type { DisplayRow } from './dataProcessor';
import { formatDateDisplay } from './dateUtils';

export function printPanel(rows: DisplayRow[], title: string, colorHex: string) {
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) { alert('팝업이 차단되었습니다. 팝업 허용 후 다시 시도해주세요.'); return; }

  const isGreen = colorHex.startsWith('#27') || colorHex.startsWith('#2e');
  const headerBg = colorHex;
  const headerBorder = isGreen ? '#1e8449' : '#a93226';

  const colWidths = ['11%', '9%', '35%', '7%', '12%', '13%', '13%'];
  const headers = ['발주번호', '물류센터', '상품이름', '확정수량', '입고예정일', '메모', '박스수량'];

  const dataRows = rows.map(row => {
    if (row.isBlank) return `<tr class="blank-row"><td colspan="7"></td></tr>`;
    return `
      <tr>
        <td class="center">${row.발주번호}</td>
        <td class="center">${row.물류센터}</td>
        <td class="left">${row.상품이름}</td>
        <td class="center">${row.확정수량 !== '' ? row.확정수량 : ''}</td>
        <td class="center nowrap">${formatDateDisplay(row.입고예정일)}</td>
        <td class="center">${row.메모}</td>
        <td class="center">${row.쉼먼트}</td>
      </tr>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>
    @page { size: A4 portrait; margin: 12mm 10mm; }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif;
      font-size: 9pt;
      color: #1a1a1a;
      background: #fff;
    }

    .print-title {
      font-size: 12pt;
      font-weight: 700;
      color: ${headerBg};
      margin-bottom: 6mm;
      letter-spacing: -0.3px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }

    col:nth-child(1) { width: ${colWidths[0]}; }
    col:nth-child(2) { width: ${colWidths[1]}; }
    col:nth-child(3) { width: ${colWidths[2]}; }
    col:nth-child(4) { width: ${colWidths[3]}; }
    col:nth-child(5) { width: ${colWidths[4]}; }
    col:nth-child(6) { width: ${colWidths[5]}; }
    col:nth-child(7) { width: ${colWidths[6]}; }

    thead th {
      background: ${headerBg};
      color: #fff;
      font-weight: 600;
      font-size: 8.5pt;
      padding: 4pt 4pt;
      text-align: center;
      border: 1pt solid ${headerBorder};
    }

    tbody td {
      padding: 3.5pt 4pt;
      border: 0.5pt solid #dddddd;
      vertical-align: middle;
      word-break: keep-all;
      line-height: 1.4;
    }

    td.center { text-align: center; }
    td.left   { text-align: left; }
    td.nowrap { white-space: nowrap; }

    tr.blank-row td {
      height: 4pt;
      border: none;
      padding: 0;
    }

    tbody tr:not(.blank-row):nth-child(odd) { background: #fff; }
    tbody tr:not(.blank-row):nth-child(even) { background: #fafafa; }
  </style>
</head>
<body>
  <div class="print-title">${title}</div>
  <table>
    <colgroup>
      ${colWidths.map(() => '<col>').join('')}
    </colgroup>
    <thead>
      <tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr>
    </thead>
    <tbody>${dataRows}</tbody>
  </table>
</body>
</html>`;

  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); win.close(); }, 400);
}
