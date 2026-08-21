
import { Product } from '../types';

// optionFieldName이 이 값이면 "노출속성"을 상품의 내장 색상 필드(color)에 채워 넣으라는 뜻입니다.
// customFieldNames에 실제로 "color"라는 이름을 등록할 일은 거의 없으므로 구분에 안전합니다.
export const OPTION_FIELD_COLOR = 'color';

// 앱에 등록된 견적서 양식 파일. 카테고리와 함께 저장되며, 상품에서 선택해 사용합니다.
export interface QuoteTemplateRegistration {
  id: string;
  category: string;
  fileName: string;
  fileDataUrl: string;
  // 이 견적서 특유의 추가 항목 "이름"만 저장합니다. 값은 상품마다 다르므로
  // 여기서는 값 없이 컬럼 이름만 등록하고, 상품등록에서 이 견적서를 선택하면
  // 해당 이름들이 상품의 customFields에 빈 값으로 추가되어 상품별로 값을 채워 넣습니다.
  customFieldNames: string[];
  // 이 카테고리의 "노출속성"(옵션마다 달라지는 값)이 실제로 어느 항목인지. 내장 색상 필드면
  // OPTION_FIELD_COLOR, customFieldNames 중 하나라면 그 이름 그대로 저장합니다. 1688 옵션을
  // 여러 개 붙여넣을 때 이 항목에 옵션값을 채워 넣는 데 씁니다. 미설정 시 색상으로 취급합니다.
  optionFieldName?: string;
  // 등록 시각(ms). 같은 카테고리로 여러 번 등록했을 때 "중복 정리"에서 가장 최근 것을
  // 가려내는 데 사용합니다. 구버전에서 등록된 항목은 이 값이 없을 수 있습니다.
  createdAt?: number;
}

export const dataUrlToArrayBuffer = (dataUrl: string): ArrayBuffer => {
  const base64 = dataUrl.split(',')[1] || '';
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
};

export interface QuoteTemplateProfile {
  id: string;
  label: string;
  // 헤더가 있는 행 번호
  headerRowNumber: number;
  // 상품 데이터가 시작되는 행 번호
  dataStartRowNumber: number;
  // 헤더 텍스트(정규화됨) -> 값 추출 함수
  mapping: { [normalizedHeader: string]: (p: Product) => any };
  // 헤더 텍스트로 찾을 수 없는 컬럼(예: 헤더 셀이 비어 있는 경우)에 한해, 컬럼 번호를 직접
  // 지정해 값을 넣어야 할 때만 사용합니다. 카테고리가 다른 견적서는 같은 컬럼 번호라도
  // 실제로는 전혀 다른 항목을 가리킬 수 있으므로(예: 10번째 컬럼이 어떤 카테고리에서는
  // "사이즈", 다른 카테고리에서는 "높이"), 가능하면 mapping(헤더 텍스트 매칭)을 우선 사용하고
  // 이 옵션은 정말 헤더로 찾을 수 없는 예외적인 경우에만 씁니다.
  fixedColumnOverrides?: Array<{ col: number; value: (p: Product) => any }>;
  // 채워진 견적서 파일을 다시 업로드했을 때, 헤더 텍스트(정규화됨) -> 셀 값을 상품 필드에 되돌리는 함수.
  // mapping과 달리 combine된 값(예: 상품명+색상)은 여기서 분리해서 넣어야 합니다.
  reverseMapping?: { [normalizedHeader: string]: (value: any, product: Partial<Product>) => void };
  // 헤더 매핑과 무관하게 특정 컬럼 번호의 값을 상품 필드로 되돌려야 하는 경우
  reverseFixedColumnOverrides?: Array<{ col: number; field: keyof Product }>;
  // 병합된 "상품 법적 정보" 영역을 자동 인식해서 채울 텍스트 (없으면 생략)
  legalInfoText?: string;
  legalInfoFillValue?: string;
  // "상품 법적 정보" 영역 안에 있어도, 헤더 텍스트에 이 키워드가 포함된 컬럼은 자동으로
  // legalInfoFillValue를 채우지 않고 일반 필수 항목처럼 취급합니다. (예: "주의사항"이 포함된
  // 컬럼은 상세페이지 참조로 뭉뚱그리지 않고, 상품 행에 입력 칸을 만들어 직접 값을 적게 합니다.)
  legalInfoExceptionKeywords?: string[];
}

// 상품마다 달라지지 않고 견적서에 항상 동일하게 들어가는 고정값. 설정 화면(QuoteSettingsModal)에서 편집 가능.
export interface QuoteFixedValues {
  brand: string;
  manufacturer: string;
  dealType: string;
  importStatus: string;
  taxStatus: string;
  barcodeText: string;
  shelfLifeDays: string;
  cautionReason: string;
  kcCertType: string;
  kcCertNumber: string;
  emcCertNumber: string;
  safetyCertNumber: string;
  legalInfoFillValue: string;
  sizeOverride: string;
}

export const DEFAULT_QUOTE_FIXED_VALUES: QuoteFixedValues = {
  brand: '주노엘',
  manufacturer: '주노엘 협력업체',
  dealType: '제조사',
  importStatus: '수입상품',
  taxStatus: '과세',
  barcodeText: '바코드 없음(쿠팡 바코드 생성 요청)',
  shelfLifeDays: '0',
  cautionReason: '해당사항없음',
  kcCertType: '해당사항없음',
  kcCertNumber: '해당사항없음',
  emcCertNumber: '해당사항없음',
  safetyCertNumber: '해당사항없음',
  legalInfoFillValue: '상세페이지 참조',
  sizeOverride: 'one size',
};

export const getQuoteTemplates = (fixedValues: QuoteFixedValues): QuoteTemplateProfile[] => {
  const carRcMapping: QuoteTemplateProfile['mapping'] = {
    '상품명': p => [p.productName, p.color].filter(Boolean).join(', '),
    '상품바코드': () => fixedValues.barcodeText,
    '모델명': p => p.productName,
    '검색태그': p => p.searchKeyword,
    '브랜드': () => fixedValues.brand,
    '색상': p => p.color,
    '수량': p => `${p.quantity || 1}개`,
    '대표이미지파일명': p => p.thumbnailFile,
    '상세이미지파일명': p => p.detailFile,
    '이미지대체텍스트': p => p.productName,
    '공급가': p => Number(p.supplyPrice) || '',
    '쿠팡판매가': p => Number(p.sellingPrice) || '',
    '과세여부': () => fixedValues.taxStatus,
    '제조사': () => fixedValues.manufacturer,
    '거래타입': () => fixedValues.dealType,
    '수입여부': () => fixedValues.importStatus,
    '박스내sku수량': p => p.sku,
    '유통기간*식품의경우소비기간(일수기재)': () => fixedValues.shelfLifeDays,
    '취급주의사유': () => fixedValues.cautionReason,
    '한개단품포장무게': p => p.weight ? Number(p.weight) : '',
    '한개단품포장사이즈': p => p.packageSizeSameAsProduct
      ? [p.sizeWidth, p.sizeHeight, p.sizeDepth].filter(Boolean).join('*')
      : p.packageSize,
    '전기용품및생활용품,어린이(kc)인증마크타입': () => fixedValues.kcCertType,
    '전기용품및생활용품,어린이(kc)인증번호': () => fixedValues.kcCertNumber,
    '방송통신기자재(emc)인증번호': () => fixedValues.emcCertNumber,
    '안전기준적합확인신고번호': () => fixedValues.safetyCertNumber,
    '제품필수표시사항(라벨또는도안이미지)': p => p.labelFile,
    '카테고리': p => p.category,
    '사이즈': () => fixedValues.sizeOverride,
  };

  const carRcReverseMapping: QuoteTemplateProfile['reverseMapping'] = {
    '카테고리': (v, p) => { p.category = String(v ?? '').trim(); },
    '모델명': (v, p) => { p.productName = String(v ?? '').trim(); },
    '검색태그': (v, p) => { p.searchKeyword = String(v ?? '').trim(); },
    '색상': (v, p) => { p.color = String(v ?? '').trim(); },
    '수량': (v, p) => { p.quantity = String(v ?? '').replace(/[^\d.]/g, ''); },
    '대표이미지파일명': (v, p) => { p.thumbnailFile = String(v ?? '').trim(); },
    '상세이미지파일명': (v, p) => { p.detailFile = String(v ?? '').trim(); },
    '공급가': (v, p) => { p.supplyPrice = String(v ?? '').replace(/[^\d.]/g, ''); },
    '쿠팡판매가': (v, p) => { p.sellingPrice = String(v ?? '').replace(/[^\d.]/g, ''); },
    '박스내sku수량': (v, p) => { p.sku = String(v ?? '').trim(); },
    '한개단품포장무게': (v, p) => { p.weight = String(v ?? '').replace(/[^\d.]/g, ''); },
    '한개단품포장사이즈': (v, p) => {
      p.packageSize = String(v ?? '').trim();
      p.packageSizeSameAsProduct = false;
    },
    '제품필수표시사항(라벨또는도안이미지)': (v, p) => { p.labelFile = String(v ?? '').trim(); },
  };

  return [
    {
      id: 'toy-car-rc',
      label: '완구/RC/자동차 계열 (기본)',
      headerRowNumber: 5,
      dataStartRowNumber: 9,
      mapping: carRcMapping,
      reverseMapping: carRcReverseMapping,
      legalInfoText: '상품 법적 정보',
      legalInfoFillValue: fixedValues.legalInfoFillValue,
    },
    // 새 카테고리 견적서 양식을 추가하려면 이 배열에 항목을 추가하면 됩니다.
    // 예:
    // {
    //   id: 'apparel',
    //   label: '의류',
    //   headerRowNumber: 5,
    //   dataStartRowNumber: 9,
    //   mapping: { ... },
    //   fixedColumnOverrides: [ ... ],
    //   legalInfoText: '상품 법적 정보',
    //   legalInfoFillValue: '상세페이지 참조',
    // },
  ];
};

export const normalizeHeader = (s: string | null | undefined): string =>
  s?.toString().trim().replace(/\s+/g, '').toLowerCase() || '';

// 항목 이름만으로 값을 자동으로 정할 수 있는 경우(예: 출시 연도는 항상 올해)를 위한 기본값.
// 자동으로 정할 수 없는 항목은 빈 문자열을 돌려주고, 사용자가 직접 입력하도록 둡니다.
export const getAutoCustomFieldValue = (name: string): string => {
  const key = normalizeHeader(name);
  if (key === normalizeHeader('출시 연도') || key === normalizeHeader('출시년도')) {
    return String(new Date().getFullYear());
  }
  return '';
};

declare var JSZip: any;

// ExcelJS로 통째로 load() → writeBuffer()를 거치면, 원본 파일에 없던 테마 파트가 누락된 채로
// 관계(rels)만 남거나 데이터 유효성 검사 범위가 중복되는 등 라이브러리 자체의 재저장 버그로
// 파일이 손상되어 엑셀이 "복구하시겠습니까?" 경고를 띄우는 문제가 있었습니다.
// 그래서 워크북 전체를 다시 만들지 않고, zip 안의 데이터 시트 XML(xl/worksheets/sheetN.xml)만
// 열어서 해당 셀의 값만 직접 바꿔치기합니다. 나머지 파일(styles.xml, 테마, 열 너비, 드롭다운,
// 병합, 하이퍼링크 등)은 업로드된 원본과 완전히 동일하게 보존되므로 손상 가능성이 없습니다.
const SHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

const colLetterOf = (ref: string): string => ref.match(/^([A-Z]+)/)![1];
const rowNumOf = (ref: string): number => parseInt(ref.match(/(\d+)$/)![1], 10);
const colIndexFromLetter = (letters: string): number => {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
};
const colLetterFromIndex = (n: number): string => {
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
};

const getCellMap = (rowEl: any): Map<string, any> => {
  const m = new Map<string, any>();
  for (const c of Array.from(rowEl.childNodes) as any[]) {
    if (c.nodeType !== 1) continue;
    m.set(colLetterOf(c.getAttribute('r')), c);
  }
  return m;
};

// 견적서 엑셀 파일(zip)에서 상품 데이터가 들어있는 두 번째 시트를 찾아 XML 문서와 행(row) 맵을
// 꺼내옵니다. 실제 채우기(fillQuoteWorkbook)와 필수 항목 사전 검사(findMissingRequiredCells)가
// 이 파싱 로직을 공유합니다.
const loadTemplateSheet = async (
  zip: any
): Promise<{
  doc: any;
  rowMap: Map<number, any>;
  sheetPath: string;
  resolveCellText: (cellEl: any) => string;
}> => {
  const workbookXml: string = await zip.file('xl/workbook.xml').async('string');
  const relsXml: string = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const parser = new DOMParser();
  const wbDoc = parser.parseFromString(workbookXml, 'text/xml');
  const sheetEls = Array.from(wbDoc.getElementsByTagName('sheet'));
  const targetSheetEl = sheetEls[1]; // 두 번째 시트
  if (!targetSheetEl) {
    throw new Error('파일에 두 번째 시트가 존재하지 않습니다.');
  }
  const rId = (targetSheetEl as any).getAttribute('r:id');
  const relsDoc = parser.parseFromString(relsXml, 'text/xml');
  const rel = Array.from(relsDoc.getElementsByTagName('Relationship')).find(
    (r: any) => r.getAttribute('Id') === rId
  ) as any;
  const sheetPath = `xl/${rel.getAttribute('Target').replace(/^\.?\//, '')}`;

  const sheetXml: string = await zip.file(sheetPath).async('string');

  const sharedStringsFile = zip.file('xl/sharedStrings.xml');
  const sharedStrings: string[] = [];
  if (sharedStringsFile) {
    const ssXml: string = await sharedStringsFile.async('string');
    const ssDoc = parser.parseFromString(ssXml, 'text/xml');
    for (const si of Array.from(ssDoc.getElementsByTagName('si'))) {
      const ts = Array.from((si as any).getElementsByTagName('t'));
      sharedStrings.push(ts.map((t: any) => t.textContent).join(''));
    }
  }

  const resolveCellText = (cellEl: any): string => {
    if (!cellEl) return '';
    const type = cellEl.getAttribute('t');
    if (type === 's') {
      const vEl = cellEl.getElementsByTagName('v')[0];
      const idx = vEl ? parseInt(vEl.textContent, 10) : NaN;
      return Number.isNaN(idx) ? '' : sharedStrings[idx] || '';
    }
    if (type === 'inlineStr') {
      const isEl = cellEl.getElementsByTagName('is')[0];
      if (!isEl) return '';
      return Array.from(isEl.getElementsByTagName('t')).map((t: any) => t.textContent).join('');
    }
    const vEl = cellEl.getElementsByTagName('v')[0];
    return vEl ? vEl.textContent : cellEl.textContent || '';
  };

  const doc = parser.parseFromString(sheetXml, 'text/xml');
  const sheetDataEl = doc.getElementsByTagName('sheetData')[0];

  const rowMap = new Map<number, any>();
  for (const rowEl of Array.from(sheetDataEl.childNodes) as any[]) {
    if (rowEl.nodeType !== 1) continue;
    rowMap.set(parseInt(rowEl.getAttribute('r'), 10), rowEl);
  }

  return { doc, rowMap, sheetPath, resolveCellText };
};

// 헤더 행의 텍스트(정규화됨) -> 컬럼 번호 맵을 만듭니다. 파일마다 실제 헤더가 어느 컬럼에 있는지가
// 다르므로, 컬럼 번호를 코드에 고정하지 않고 매번 이 맵을 통해 찾습니다.
// 같은 헤더 텍스트가 두 번 이상 나오는 경우(예: "색상"이 상품 속성 컬럼과, 법적 고시 정보 영역
// 안의 "색상" 컬럼 양쪽에 다시 나오는 경우) 나중 컬럼이 앞 컬럼을 덮어써 값이 엉뚱한 곳에 쓰이는
// 문제가 있었습니다. 처음 나온 컬럼(보통 본문 항목)을 우선하고 이후 중복은 무시합니다.
const buildColIndexMap = (
  headerCells: Map<string, any>,
  resolveCellText: (cellEl: any) => string
): { [key: string]: number } => {
  const colIndexMap: { [key: string]: number } = {};
  for (const [colLetter, cellEl] of headerCells.entries()) {
    const text = resolveCellText(cellEl);
    if (!text) continue;
    const key = normalizeHeader(text);
    if (colIndexMap[key] !== undefined) continue;
    colIndexMap[key] = colIndexFromLetter(colLetter);
  }
  return colIndexMap;
};

// 병합된 "상품 법적 정보" 영역이 차지하는 컬럼들을 찾습니다. 그 중에서도 헤더 텍스트에
// legalInfoExceptionKeywords가 포함된 컬럼은 결과에서 제외합니다(자동으로 뭉뚱그려 채우지 않고
// 일반 필수 항목처럼 상품 행에서 직접 입력하게 하기 위함).
const findLegalInfoCols = (
  doc: any,
  rowMap: Map<number, any>,
  dataStartRowNumber: number,
  legalInfoText: string,
  resolveCellText: (cellEl: any) => string,
  headerCells: Map<string, any>,
  exceptionKeywords: string[] = []
): number[] => {
  let legalInfoCols: number[] = [];
  const mergesEl = doc.getElementsByTagName('mergeCells')[0];
  const merges = mergesEl
    ? Array.from(mergesEl.getElementsByTagName('mergeCell')).map((m: any) => m.getAttribute('ref'))
    : [];

  outer: for (const [rowNumber, rowEl] of rowMap.entries()) {
    if (rowNumber >= dataStartRowNumber) continue;
    const cells = getCellMap(rowEl);
    for (const [colLetter, cellEl] of cells.entries()) {
      const text = resolveCellText(cellEl);
      if (text && text.includes(legalInfoText)) {
        const colN = colIndexFromLetter(colLetter);
        let found = false;
        for (const mergeRef of merges as string[]) {
          const [startRef, endRef] = mergeRef.split(':');
          const startCol = colIndexFromLetter(colLetterOf(startRef));
          const startRow = rowNumOf(startRef);
          const endCol = colIndexFromLetter(colLetterOf(endRef));
          const endRow = rowNumOf(endRef);
          if (rowNumber >= startRow && rowNumber <= endRow && colN >= startCol && colN <= endCol) {
            for (let i = startCol; i <= endCol; i++) legalInfoCols.push(i);
            found = true;
            break;
          }
        }
        if (!found) legalInfoCols.push(colN);
        break outer;
      }
    }
  }

  const normalizedExceptionKeywords = exceptionKeywords.map(normalizeHeader);
  const cols = [...new Set(legalInfoCols)];
  if (normalizedExceptionKeywords.length === 0) return cols;
  return cols.filter(col => {
    const headerCellEl = headerCells.get(colLetterFromIndex(col));
    const headerText = headerCellEl ? normalizeHeader(resolveCellText(headerCellEl)) : '';
    return !normalizedExceptionKeywords.some(keyword => headerText.includes(keyword));
  });
};

// 한 상품에 대해, 컬럼 번호 -> 실제로 채워질 값을 계산합니다. 실제로 셀에 쓰는 fillQuoteWorkbook과
// 필수 항목이 비어 있는지 미리 검사하는 findMissingRequiredCells가 동일한 값 계산 로직을 공유해야
// "쓸 때"와 "검사할 때"의 결과가 어긋나지 않습니다.
const computeProductColumnValues = (
  template: QuoteTemplateProfile,
  colIndexMap: { [key: string]: number },
  product: Product
): Map<number, any> => {
  const values = new Map<number, any>();

  // 일반 매핑 처리: 헤더 텍스트로 컬럼을 찾아서 채웁니다.
  for (const appHeader in template.mapping) {
    const colNumber = colIndexMap[normalizeHeader(appHeader)];
    if (colNumber !== undefined) values.set(colNumber, template.mapping[appHeader](product));
  }

  // 헤더로 찾을 수 없는 예외적인 경우에 한해 컬럼 번호를 직접 지정한 값 처리
  (template.fixedColumnOverrides || []).forEach(({ col, value }) => values.set(col, value(product)));

  // 커스텀 컬럼 처리: 컬럼 이름과 업로드 파일의 헤더 텍스트가 일치하면 채움
  Object.entries(product.customFields || {}).forEach(([colName, value]) => {
    if (!value) return;
    const colNumber = colIndexMap[normalizeHeader(colName)];
    if (colNumber !== undefined) values.set(colNumber, value);
  });

  // 재질은 견적서마다 컬럼 이름이 다를 수 있어(예: "재질", "소재/재질", "재질(소재)") 정확히
  // 일치하는 이름으로 등록하지 않고, 헤더 텍스트에 "재질"이 포함된 첫 컬럼을 찾아 채웁니다.
  const materialValue = (product.customFields || {})['재질'];
  if (materialValue) {
    const materialCol = Object.entries(colIndexMap).find(([key]) => key.includes('재질'))?.[1];
    if (materialCol !== undefined) values.set(materialCol, materialValue);
  }

  return values;
};

export interface RequiredFieldGap {
  product: Product;
  missing: string[];
}

// 업로드된 견적서 파일의 실제 헤더 행(headerRowNumber) 바로 다음 행에서 "필수"라고 적힌 컬럼을
// 찾아, 각 상품에 대해 그 컬럼에 실제로 채워질 값이 비어 있는지 검사합니다. ("조건부 필수", "선택"
// 등 다른 표시는 검사 대상에서 제외하고, 정확히 "필수"라고 적힌 컬럼만 봅니다.)
// 카테고리마다 등록된 파일의 실제 레이아웃이 다르므로, 필수 컬럼 판정도 코드에 고정하지 않고 매번
// 업로드된 파일 자체에서 읽습니다.
export const findMissingRequiredCells = async (
  sourceArrayBuffer: ArrayBuffer,
  template: QuoteTemplateProfile,
  products: Product[]
): Promise<RequiredFieldGap[]> => {
  const zip = await JSZip.loadAsync(sourceArrayBuffer);
  const { doc, rowMap, resolveCellText } = await loadTemplateSheet(zip);

  const headerRowEl = rowMap.get(template.headerRowNumber);
  const requiredRowEl = rowMap.get(template.headerRowNumber + 1);
  if (!headerRowEl || !requiredRowEl) return [];

  const headerCells = getCellMap(headerRowEl);
  const requiredCells = getCellMap(requiredRowEl);
  const colIndexMap = buildColIndexMap(headerCells, resolveCellText);

  const legalInfoCols = new Set(
    template.legalInfoText
      ? findLegalInfoCols(
          doc,
          rowMap,
          template.dataStartRowNumber,
          template.legalInfoText,
          resolveCellText,
          headerCells,
          template.legalInfoExceptionKeywords
        )
      : []
  );

  const requiredColumns: Array<{ col: number; label: string }> = [];
  for (const [colLetter, cellEl] of requiredCells.entries()) {
    if (resolveCellText(cellEl).trim() !== '필수') continue;
    const col = colIndexFromLetter(colLetter);
    if (legalInfoCols.has(col)) continue; // 법적 정보 칸은 항상 자동으로 채워지므로 제외
    const headerCellEl = headerCells.get(colLetter);
    const label = headerCellEl ? resolveCellText(headerCellEl).trim() : '';
    if (label) requiredColumns.push({ col, label });
  }
  if (requiredColumns.length === 0) return [];

  const results: RequiredFieldGap[] = [];
  products.forEach(product => {
    const values = computeProductColumnValues(template, colIndexMap, product);
    const missing = requiredColumns
      .filter(({ col }) => {
        const v = values.get(col);
        return v === undefined || v === null || String(v).trim() === '';
      })
      .map(({ label }) => label);
    if (missing.length > 0) results.push({ product, missing });
  });

  return results;
};

// 업로드된 견적서 파일에서 "필수"로 표시됐지만 mapping(상품명, 색상 등 내장 항목)으로는 채울 수 없는
// 컬럼을 찾아 상품의 customFields를 정리해줍니다.
// - 해당 이름의 항목이 아직 없으면: 상품등록 화면의 "+" 추가 항목 만들기와 동일하게 항목을 새로
//   만들고, getAutoCustomFieldValue로 자동으로 정할 수 있는 값(예: 출시 연도)이면 바로 채웁니다.
// - 이미 있지만 값이 비어 있으면: 자동으로 정할 수 있는 항목에 한해 값을 채워 넣습니다(예: 이전에
//   빈 값으로 등록해둔 "출시 연도"를 올해 연도로 자동 갱신). 자동으로 정할 수 없는 항목은
//   비워둔 채로 두어 상품 행에서 직접 입력하도록 합니다.
// 이렇게 하면 다른 카테고리 견적서를 등록했을 때, 그 견적서에 필요한 항목을 사람이 일일이
// "추가 항목 이름"으로 등록하지 않아도 상품마다 자동으로 입력 칸이 생깁니다.
export const ensureRequiredCustomFields = async (
  sourceArrayBuffer: ArrayBuffer,
  template: QuoteTemplateProfile,
  products: Product[]
): Promise<Product[]> => {
  const zip = await JSZip.loadAsync(sourceArrayBuffer);
  const { doc, rowMap, resolveCellText } = await loadTemplateSheet(zip);

  const headerRowEl = rowMap.get(template.headerRowNumber);
  const requiredRowEl = rowMap.get(template.headerRowNumber + 1);
  if (!headerRowEl || !requiredRowEl) return products;

  const headerCells = getCellMap(headerRowEl);
  const requiredCells = getCellMap(requiredRowEl);
  const mappingKeys = new Set(Object.keys(template.mapping).map(normalizeHeader));

  const legalInfoCols = new Set(
    template.legalInfoText
      ? findLegalInfoCols(
          doc,
          rowMap,
          template.dataStartRowNumber,
          template.legalInfoText,
          resolveCellText,
          headerCells,
          template.legalInfoExceptionKeywords
        )
      : []
  );

  const unmappedRequiredLabels = new Map<string, string>(); // normalized -> 원래 표시 텍스트
  for (const [colLetter, cellEl] of requiredCells.entries()) {
    if (resolveCellText(cellEl).trim() !== '필수') continue;
    const col = colIndexFromLetter(colLetter);
    if (legalInfoCols.has(col)) continue; // 법적 정보 칸(예외 제외)은 자동으로 채워지므로 제외
    const headerCellEl = headerCells.get(colLetter);
    const label = headerCellEl ? resolveCellText(headerCellEl).trim() : '';
    if (!label) continue;
    const normalized = normalizeHeader(label);
    if (mappingKeys.has(normalized)) continue; // 이미 내장 항목으로 채워지는 컬럼은 제외
    if (!unmappedRequiredLabels.has(normalized)) unmappedRequiredLabels.set(normalized, label);
  }
  if (unmappedRequiredLabels.size === 0) return products;

  return products.map(product => {
    const customFields = product.customFields || {};
    const existingKeyByNormalized = new Map<string, string>();
    Object.keys(customFields).forEach(key => existingKeyByNormalized.set(normalizeHeader(key), key));

    let changed = false;
    const nextCustomFields = { ...customFields };
    unmappedRequiredLabels.forEach((label, normalized) => {
      const existingKey = existingKeyByNormalized.get(normalized);
      if (existingKey === undefined) {
        nextCustomFields[label] = getAutoCustomFieldValue(label);
        changed = true;
      } else if (!nextCustomFields[existingKey].trim()) {
        const autoValue = getAutoCustomFieldValue(existingKey);
        if (autoValue) {
          nextCustomFields[existingKey] = autoValue;
          changed = true;
        }
      }
    });
    return changed ? { ...product, customFields: nextCustomFields } : product;
  });
};

// 업로드/등록된 견적서 엑셀 파일(원본 바이트)의 두 번째 시트에 상품 데이터를 직접 채워 넣고,
// 수정된 파일 바이트를 돌려줍니다. 전체 상품 일괄 채우기와 상품별 개별 채우기 양쪽에서 재사용됩니다.
export const fillQuoteWorkbook = async (
  sourceArrayBuffer: ArrayBuffer,
  template: QuoteTemplateProfile,
  products: Product[]
): Promise<ArrayBuffer> => {
  const zip = await JSZip.loadAsync(sourceArrayBuffer);
  const { doc, rowMap, sheetPath, resolveCellText } = await loadTemplateSheet(zip);

  const HEADER_ROW_NUMBER = template.headerRowNumber;
  const DATA_START_ROW_NUMBER = template.dataStartRowNumber;

  const headerRowEl = rowMap.get(HEADER_ROW_NUMBER);
  if (!headerRowEl) {
    throw new Error(`파일의 ${HEADER_ROW_NUMBER}행에서 헤더를 찾을 수 없습니다.`);
  }
  const headerCells = getCellMap(headerRowEl);
  const colIndexMap = buildColIndexMap(headerCells, resolveCellText);

  const legalInfoCols = template.legalInfoText
    ? findLegalInfoCols(
        doc,
        rowMap,
        DATA_START_ROW_NUMBER,
        template.legalInfoText,
        resolveCellText,
        headerCells,
        template.legalInfoExceptionKeywords
      )
    : [];

  // 셀의 기존 스타일(s=)은 그대로 두고 값(또는 인라인 문자열)만 갈아 끼웁니다.
  const setCellValue = (cellEl: any, value: any) => {
    while (cellEl.firstChild) cellEl.removeChild(cellEl.firstChild);
    if (value === undefined || value === null || value === '') {
      cellEl.removeAttribute('t');
      return;
    }
    if (typeof value === 'number') {
      cellEl.removeAttribute('t');
      const v = doc.createElementNS(SHEET_NS, 'v');
      v.textContent = String(value);
      cellEl.appendChild(v);
    } else {
      cellEl.setAttribute('t', 'inlineStr');
      const is = doc.createElementNS(SHEET_NS, 'is');
      const t = doc.createElementNS(SHEET_NS, 't');
      // macOS는 한글을 자모 분리(NFD)로 다루는 경우가 많아(파일명 읽기, 일부 복사/붙여넣기 등),
      // 상품 값이 NFD로 들어와 있으면 브라우저 화면에서는 자동으로 정상 조합되어 보이지만 Excel은
      // 자모를 조합해서 그려주지 않아 낱개 자모로 깨져 보인다. 셀에 쓰기 직전 NFC로 정규화해서
      // 원인이 무엇이든 파일에는 항상 정상 조합된 한글이 들어가게 한다.
      t.textContent = String(value).normalize('NFC');
      is.appendChild(t);
      cellEl.appendChild(is);
    }
  };

  products.forEach((product, index) => {
    const targetRowNumber = DATA_START_ROW_NUMBER + index;
    const rowEl = rowMap.get(targetRowNumber);
    if (!rowEl) return; // 템플릿이 미리 정의해 둔 행 범위를 벗어나면 채우지 않습니다.
    const cellMap = getCellMap(rowEl);

    const setByCol = (colNumber: number, value: any) => {
      const cellEl = cellMap.get(colLetterFromIndex(colNumber));
      if (cellEl) setCellValue(cellEl, value);
    };

    computeProductColumnValues(template, colIndexMap, product).forEach((value, col) => setByCol(col, value));

    // 법적 정보 채우기
    legalInfoCols.forEach(colIdx => setByCol(colIdx, template.legalInfoFillValue ?? ''));
  });

  const newSheetXml = new XMLSerializer().serializeToString(doc);
  zip.file(sheetPath, newSheetXml);

  // compression을 지정하지 않으면 JSZip이 원본의 압축 방식과 무관하게 전부 무압축(STORE)으로
  // 다시 묶어서 파일 용량이 몇 배로 부풀어 오릅니다(예: 200KB → 1.7MB). 원본과 동일하게
  // DEFLATE로 압축해 용량을 정상 수준으로 되돌립니다.
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
};

// fillQuoteWorkbook으로 채워져 다운로드된 견적서 파일을 다시 업로드했을 때, 그 안의 값을
// 상품 필드로 되돌려 읽어옵니다. 한 파일 = 상품 한 건(dataStartRowNumber 행)을 가정합니다.
export const parseQuoteWorkbookToProduct = (
  workbook: any,
  template: QuoteTemplateProfile,
  customFieldNames: string[] = []
): Partial<Product> => {
  const worksheet = workbook.worksheets[1]; // 두 번째 시트 (인덱스 1)
  if (!worksheet) {
    throw new Error('파일에 두 번째 시트가 존재하지 않습니다.');
  }

  const headerRow = worksheet.getRow(template.headerRowNumber);
  if (!headerRow.values || (Array.isArray(headerRow.values) && headerRow.values.length <= 1)) {
    throw new Error(`파일의 ${template.headerRowNumber}행에서 헤더를 찾을 수 없습니다.`);
  }

  // 같은 헤더 텍스트가 두 번 이상 나오면(예: 법적 고시 정보 영역의 중복 "색상" 컬럼) 처음 나온
  // 컬럼을 우선합니다. fillQuoteWorkbook이 값을 쓸 때와 동일한 컬럼에서 읽어와야 합니다.
  const colIndexMap: { [key: string]: number } = {};
  headerRow.eachCell({ includeEmpty: true }, (cell: any, colNumber: number) => {
    const headerText = cell.text;
    if (!headerText) return;
    const key = normalizeHeader(headerText);
    if (colIndexMap[key] !== undefined) return;
    colIndexMap[key] = colNumber;
  });

  const dataRow = worksheet.getRow(template.dataStartRowNumber);
  const result: Partial<Product> = {};

  Object.entries(template.reverseMapping || {}).forEach(([header, apply]) => {
    const colNumber = colIndexMap[normalizeHeader(header)];
    if (colNumber === undefined) return;
    const text = dataRow.getCell(colNumber).text;
    if (!text) return;
    apply(text, result);
  });

  (template.reverseFixedColumnOverrides || []).forEach(({ col, field }) => {
    const text = dataRow.getCell(col).text;
    if (!text) return;
    (result as any)[field] = text.trim();
  });

  const customFields: { [key: string]: string } = {};
  customFieldNames.forEach(name => {
    const colNumber = colIndexMap[normalizeHeader(name)];
    if (colNumber === undefined) return;
    const text = dataRow.getCell(colNumber).text;
    if (!text) return;
    customFields[name] = text.trim();
  });
  if (Object.keys(customFields).length > 0) {
    result.customFields = customFields;
  }

  return result;
};
