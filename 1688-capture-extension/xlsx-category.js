// 견적서 엑셀(xlsx)에서 "카테고리" 칸의 드롭다운 목록을 읽습니다.
//
// 견적서의 카테고리 칸은 드롭다운이라, 파일에 들어 있는 값 그대로 넣어야 합니다. 그래서 1688
// 창에서 견적서를 받자마자 그 목록을 보여주고 고르게 하려면 여기서 파일을 열어봐야 합니다.
//
// xlsx는 XML 몇 개를 담은 zip입니다. 라이브러리를 들이지 않고, zip 목차를 직접 읽고 크롬이
// 기본으로 주는 DecompressionStream으로 풀어 씁니다(앱은 같은 일을 JSZip으로 합니다).
(() => {
  if (window.__rocketReadCategoryOptions) return;

  const SIG_EOCD = 0x06054b50;
  const SIG_CENTRAL = 0x02014b50;
  const SIG_LOCAL = 0x04034b50;

  const dataUrlToArrayBuffer = (dataUrl) => {
    const base64 = String(dataUrl).split(',')[1] || '';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  };

  // zip 끝의 목차(중앙 디렉터리)를 읽어 "파일 이름 -> 위치" 표를 만듭니다.
  const openZip = (arrayBuffer) => {
    const bytes = new Uint8Array(arrayBuffer);
    const view = new DataView(arrayBuffer);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 22 - 65536; i--) {
      if (view.getUint32(i, true) === SIG_EOCD) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error('zip 파일이 아닙니다.');

    const count = view.getUint16(eocd + 10, true);
    let offset = view.getUint32(eocd + 16, true);
    const decoder = new TextDecoder();
    const entries = new Map();
    for (let i = 0; i < count; i++) {
      if (view.getUint32(offset, true) !== SIG_CENTRAL) break;
      const method = view.getUint16(offset + 10, true);
      const compressedSize = view.getUint32(offset + 20, true);
      const nameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      const localOffset = view.getUint32(offset + 42, true);
      const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
      entries.set(name, { method, compressedSize, localOffset });
      offset += 46 + nameLength + extraLength + commentLength;
    }
    return { bytes, view, entries };
  };

  const readEntryBytes = async (zip, name) => {
    const entry = zip.entries.get(name);
    if (!entry) return null;
    // 실제 데이터는 로컬 헤더 뒤에 있습니다. 이름·extra 길이가 목차와 다를 수 있어 여기서 다시 읽습니다.
    const head = entry.localOffset;
    if (zip.view.getUint32(head, true) !== SIG_LOCAL) return null;
    const nameLength = zip.view.getUint16(head + 26, true);
    const extraLength = zip.view.getUint16(head + 28, true);
    const start = head + 30 + nameLength + extraLength;
    const data = zip.bytes.subarray(start, start + entry.compressedSize);
    if (entry.method === 0) return data;
    if (entry.method !== 8) throw new Error('지원하지 않는 압축 방식입니다.');
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  };

  const readEntryText = async (zip, name) => {
    const bytes = await readEntryBytes(zip, name);
    return bytes ? new TextDecoder().decode(bytes) : null;
  };

  const normalizeHeader = (value) => String(value || '').trim().replace(/\s+/g, '').toLowerCase();
  const colLetterOf = (ref) => (String(ref || '').match(/^([A-Z]+)/) || [, ''])[1];

  const parseXml = (xml) => new DOMParser().parseFromString(xml, 'text/xml');

  // 시트 한 줄의 "컬럼 문자 -> 셀" 맵.
  const cellMapOf = (rowEl) => {
    const map = new Map();
    Array.from(rowEl.childNodes).forEach((cell) => {
      if (cell.nodeType !== 1) return;
      map.set(colLetterOf(cell.getAttribute('r')), cell);
    });
    return map;
  };

  // "시트!$B$2:$B$4" 또는 "'따옴표 있는 시트'!$B$2:$B$4" 형태를 뜯어봅니다.
  const parseRangeRef = (ref) => {
    const match = /^(?:'([^']+)'|([^!]+))!\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/.exec(String(ref || '').trim());
    if (!match) return null;
    return {
      sheetName: match[1] || match[2],
      col: match[3],
      from: parseInt(match[4], 10),
      to: match[6] ? parseInt(match[6], 10) : parseInt(match[4], 10),
    };
  };

  const makeCellTextResolver = (sharedStrings) => (cellEl) => {
    if (!cellEl) return '';
    const type = cellEl.getAttribute('t');
    if (type === 's') {
      const vEl = cellEl.getElementsByTagName('v')[0];
      const index = vEl ? parseInt(vEl.textContent, 10) : NaN;
      return Number.isNaN(index) ? '' : sharedStrings[index] || '';
    }
    if (type === 'inlineStr') {
      const isEl = cellEl.getElementsByTagName('is')[0];
      if (!isEl) return '';
      return Array.from(isEl.getElementsByTagName('t')).map((t) => t.textContent).join('');
    }
    const vEl = cellEl.getElementsByTagName('v')[0];
    return vEl ? vEl.textContent : cellEl.textContent || '';
  };

  // 워크북 안에서 시트 이름(또는 순번)으로 실제 XML 경로를 찾습니다.
  const sheetPathOf = (wbDoc, relsDoc, sheetEl) => {
    const relId = sheetEl.getAttribute('r:id') || sheetEl.getAttribute('id');
    const rel = Array.from(relsDoc.getElementsByTagName('Relationship')).find((r) => r.getAttribute('Id') === relId);
    if (!rel) return null;
    return `xl/${rel.getAttribute('Target').replace(/^\.?\//, '')}`;
  };

  /**
   * 견적서 파일(dataURL)에서 카테고리 드롭다운 값들을 읽어 돌려줍니다.
   * 읽지 못하면 빈 배열 — 그때는 앱에서 고르게 됩니다.
   */
  window.__rocketReadCategoryOptions = async (dataUrl) => {
    let zip = openZip(dataUrlToArrayBuffer(dataUrl));

    // 카테고리를 여러 개 고르면 엑셀이 zip으로 묶여 옵니다. 그 안의 엑셀을 꺼내 씁니다.
    if (!zip.entries.has('[Content_Types].xml')) {
      const inner = Array.from(zip.entries.keys()).find((name) => /\.xlsx?$/i.test(name));
      if (!inner) throw new Error('엑셀 파일을 찾지 못했습니다.');
      const innerBytes = await readEntryBytes(zip, inner);
      zip = openZip(innerBytes.buffer.slice(innerBytes.byteOffset, innerBytes.byteOffset + innerBytes.byteLength));
    }

    const wbDoc = parseXml(await readEntryText(zip, 'xl/workbook.xml'));
    const relsDoc = parseXml(await readEntryText(zip, 'xl/_rels/workbook.xml.rels'));

    const sharedStrings = [];
    const ssXml = await readEntryText(zip, 'xl/sharedStrings.xml');
    if (ssXml) {
      Array.from(parseXml(ssXml).getElementsByTagName('si')).forEach((si) => {
        sharedStrings.push(Array.from(si.getElementsByTagName('t')).map((t) => t.textContent).join(''));
      });
    }
    const resolveCellText = makeCellTextResolver(sharedStrings);

    // 상품 데이터가 들어가는 두 번째 시트.
    const sheetEls = Array.from(wbDoc.getElementsByTagName('sheet'));
    const targetSheetEl = sheetEls[1];
    if (!targetSheetEl) throw new Error('두 번째 시트가 없습니다.');
    const sheetPath = sheetPathOf(wbDoc, relsDoc, targetSheetEl);
    if (!sheetPath) throw new Error('시트 경로를 찾지 못했습니다.');
    const sheetDoc = parseXml(await readEntryText(zip, sheetPath));

    // "카테고리" 헤더가 있는 칸을 찾습니다. 헤더가 몇 번째 줄인지는 양식마다 달라서 훑어 찾습니다.
    let categoryLetter = '';
    for (const rowEl of Array.from(sheetDoc.getElementsByTagName('row'))) {
      if (parseInt(rowEl.getAttribute('r'), 10) > 20) break;
      for (const [letter, cellEl] of cellMapOf(rowEl).entries()) {
        if (normalizeHeader(resolveCellText(cellEl)) === normalizeHeader('카테고리')) {
          categoryLetter = letter;
          break;
        }
      }
      if (categoryLetter) break;
    }
    if (!categoryLetter) return [];

    // 그 칸을 가리키는 데이터 유효성 검사(드롭다운)를 찾습니다.
    const validation = Array.from(sheetDoc.getElementsByTagName('dataValidation')).find((v) => {
      const sqref = v.getAttribute('sqref') || '';
      return sqref.split(/\s+/).some((part) => part.split(':').every((ref) => colLetterOf(ref) === categoryLetter));
    });
    if (!validation) return [];

    const formulaEl = validation.getElementsByTagName('formula1')[0];
    const formula = (formulaEl ? formulaEl.textContent : '').trim();
    if (!formula) return [];

    // 값을 파일 안에 그대로 적어둔 형태: "가,나,다"
    if (formula.startsWith('"')) {
      return formula.replace(/^"|"$/g, '').split(',').map((s) => s.trim()).filter(Boolean);
    }

    // 이름으로 적어둔 형태면 실제 셀 범위로 바꿉니다.
    const definedName = Array.from(wbDoc.getElementsByTagName('definedName')).find((el) => el.getAttribute('name') === formula);
    const range = parseRangeRef(definedName ? definedName.textContent : formula);
    if (!range) return [];

    const listSheetEl = Array.from(wbDoc.getElementsByTagName('sheet')).find((el) => el.getAttribute('name') === range.sheetName);
    if (!listSheetEl) return [];
    const listPath = sheetPathOf(wbDoc, relsDoc, listSheetEl);
    if (!listPath) return [];
    const listDoc = parseXml(await readEntryText(zip, listPath));

    const options = [];
    Array.from(listDoc.getElementsByTagName('row')).forEach((rowEl) => {
      const rowNumber = parseInt(rowEl.getAttribute('r'), 10);
      if (rowNumber < range.from || rowNumber > range.to) return;
      const text = resolveCellText(cellMapOf(rowEl).get(range.col)).trim();
      if (text) options.push(text);
    });
    return options;
  };
})();
