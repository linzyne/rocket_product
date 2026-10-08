import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import type { OrderRow } from '../types';
import { normalizeDateValue, dateKeyYMD, ymdSortKey } from './dateUtils';
import { rememberBarcodes } from '../../../data/coupangBarcodeStore';

function parseNumber(v: unknown): number {
  if (v === null || v === '') return NaN;
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

function readTableByHeader(rawData: unknown[][]): Record<string, unknown>[] {
  if (rawData.length < 1) return [];
  const headers = (rawData[0] as unknown[]).map(h => String(h ?? '').trim());
  const rows: Record<string, unknown>[] = [];
  for (let i = 1; i < rawData.length; i++) {
    const row = rawData[i] as unknown[];
    if (row.every(v => v === '' || v == null)) continue;
    const obj: Record<string, unknown> = {};
    headers.forEach((h, idx) => { obj[h] = row[idx]; });
    rows.push(obj);
  }
  return rows;
}

export function parseFile(file: File): Promise<OrderRow[]> {
  return new Promise((resolve, reject) => {
    const ext = file.name.split('.').pop()?.toLowerCase();

    if (ext === 'csv') {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        const result = Papa.parse(text, { header: false, skipEmptyLines: false });
        resolve(mapRawToOrderRows(result.data as unknown[][]));
      };
      reader.onerror = reject;
      reader.readAsText(file, 'utf-8');
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: 'array', cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' });
        resolve(mapRawToOrderRows(raw));
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    }
  });
}

function mapRawToOrderRows(rawData: unknown[][]): OrderRow[] {
  const data = readTableByHeader(rawData);
  let rows: OrderRow[] = data.map(r => {
    const orderNo = r['Order number'] ?? r['발주번호'] ?? '';
    const center  = r['FC(RC)'] ?? r['물류센터'] ?? '';
    const pName   = r['Product Name'] ?? r['상품이름'] ?? '';
    const qty     = r['Confirmed Quantity'] ?? r['확정수량'] ?? 0;
    const pDate   = r['Receiving Date'] ?? r['입고예정일'] ?? r['Expected Receiving Date'] ?? '';
    const sku     = r['상품번호'] ?? r['SKU ID'] ?? r['Product ID'] ?? '';

    const parsedQty = parseNumber(qty);
    return {
      발주번호: String(orderNo).trim(),
      물류센터: String(center).trim(),
      상품이름: String(pName).trim(),
      확정수량: Number.isFinite(parsedQty) ? parsedQty : '',
      입고예정일: normalizeDateValue(pDate),
      메모: '',
      쉼먼트: '',
      묶음: '',
      묶음센터: '',
      묶음일자: '',
      SKU: String(sku ?? '').trim(),
    };
  });

  // 발주서의 상품바코드를 기억해 둔다(발송대기에서 바코드 라벨을 뽑을 때 쓴다).
  rememberBarcodes(data.map(r => ({
    sku: String(r['상품번호'] ?? r['SKU ID'] ?? r['Product ID'] ?? ''),
    name: String(r['상품이름'] ?? r['Product Name'] ?? ''),
    barcode: String(r['상품바코드'] ?? r['Barcode'] ?? r['SKU Barcode'] ?? ''),
  }))).catch(err => console.error('바코드 기억 실패:', err));

  rows = rows.filter(x => Number(x.확정수량) > 0);

  return sortOrderRows(rows);
}

// 발주서 순서: 입고예정일 → 물류센터 → 발주번호 → 상품이름. 예약을 되돌릴 때도 이 순서로 다시 끼워 넣는다.
export function sortOrderRows(rows: OrderRow[]): OrderRow[] {
  return rows.sort((a, b) => {
    const da = ymdSortKey(a.입고예정일);
    const db = ymdSortKey(b.입고예정일);
    if (da !== db) return da - db;
    const kc = a.물류센터.localeCompare(b.물류센터, 'ko', { numeric: true });
    if (kc !== 0) return kc;
    const ko = a.발주번호.localeCompare(b.발주번호, 'ko', { numeric: true });
    if (ko !== 0) return ko;
    return a.상품이름.localeCompare(b.상품이름, 'ko', { numeric: true });
  });
}

export interface DisplayRow {
  id: string;
  발주번호: string;
  물류센터: string;
  상품이름: string;
  확정수량: number | '';
  입고예정일: Date | string;
  메모: string;
  쉼먼트: string;
  묶음: string;
  묶음센터: string;
  묶음일자: string;
  isBlank: boolean;
  groupKey: string;
  // 원본 전체 값 (abbreviated 되지 않은 값, 데이터 조작용)
  _발주번호: string;
  _물류센터: string;
  _입고예정일: Date | string;
  // 여러 박스로 나눈 줄의 조각이면 몇 번째 조각인지와 나누기 전 수량(쉽먼트생성에서만 쓴다).
  _조각?: number;
  _원수량?: number | '';
  SKU?: string;
}

export function buildDisplayRows(rows: OrderRow[]): DisplayRow[] {
  const display: DisplayRow[] = [];
  let prevCenterDateKey = '';
  let prevOrderNo = '';
  let idx = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const ymd = dateKeyYMD(r.입고예정일);
    const centerDateKey = `${r.물류센터}|${ymd}`;

    if (prevCenterDateKey && centerDateKey !== prevCenterDateKey) {
      display.push({
        id: `blank-${idx++}`,
        발주번호: '', 물류센터: '', 상품이름: '', 확정수량: '',
        입고예정일: '', 메모: '', 쉼먼트: '', 묶음: '', 묶음센터: '', 묶음일자: '',
        isBlank: true, groupKey: '',
        _발주번호: '', _물류센터: '', _입고예정일: '',
      });
    }

    const isFirst = centerDateKey !== prevCenterDateKey;
    display.push({
      id: `row-${idx++}`,
      발주번호: prevOrderNo === r.발주번호 && !isFirst ? '' : r.발주번호,
      물류센터: isFirst ? r.물류센터 : '',
      상품이름: r.상품이름,
      확정수량: r.확정수량,
      입고예정일: isFirst ? r.입고예정일 : '',
      메모: r.메모,
      쉼먼트: r.쉼먼트,
      묶음: r.묶음 || '',
      묶음센터: r.묶음센터 || '',
      묶음일자: r.묶음일자 || '',
      isBlank: false,
      groupKey: centerDateKey,
      _발주번호: r.발주번호,
      _물류센터: r.물류센터,
      _입고예정일: r.입고예정일,
      _조각: r.조각,
      _원수량: r.원수량,
      SKU: r.SKU || '',
    });

    prevCenterDateKey = centerDateKey;
    prevOrderNo = r.발주번호;
  }

  return display;
}

// displayRows → 논리적 OrderRow[] 복원 (abbreviated 값 복구)
export function extractOrderRows(displayRows: DisplayRow[]): OrderRow[] {
  return displayRows
    .filter(r => !r.isBlank)
    .map(r => ({
      발주번호: r._발주번호,
      물류센터: r._물류센터,
      상품이름: r.상품이름,
      확정수량: r.확정수량,
      입고예정일: r._입고예정일,
      메모: r.메모,
      쉼먼트: r.쉼먼트,
      묶음: r.묶음 || '',
      묶음센터: r.묶음센터 || '',
      묶음일자: r.묶음일자 || '',
      SKU: r.SKU || '',
    }));
}

// 메모에 "예약"이 표시된 행만 개별 분리
export function splitByReservation(displayRows: DisplayRow[]): {
  normalRows: OrderRow[];
  reservedRows: OrderRow[];
} {
  const normalRows: OrderRow[] = [];
  const reservedRows: OrderRow[] = [];

  for (const row of displayRows) {
    if (row.isBlank) continue;
    const orderRow: OrderRow = {
      발주번호: row._발주번호,
      물류센터: row._물류센터,
      상품이름: row.상품이름,
      확정수량: row.확정수량,
      입고예정일: row._입고예정일,
      메모: row.메모,
      쉼먼트: row.쉼먼트,
      묶음: row.묶음 || '',
      묶음센터: row.묶음센터 || '',
      묶음일자: row.묶음일자 || '',
      SKU: row.SKU || '',
    };
    if (row.메모.includes('예약') || row.쉼먼트.includes('예약')) {
      reservedRows.push(orderRow);
    } else {
      normalRows.push(orderRow);
    }
  }

  return { normalRows, reservedRows };
}

// 발주서를 새로 받을 때 이미 앱에 있는 줄을 거른다. 날짜·센터·수량은 앱(묶음 적용)과 서허(날짜 변경)에서
// 따로 바뀔 수 있어 보지 않고, 발주번호 + 상품이름이 같은 줄을 "개수로" 맞춘다: 파일에 2줄, 앱에 1줄이면 1줄만 넣는다
// (같은 발주에 같은 상품이 여러 줄일 수 있어서). have에는 발송 목록·예약·쉽먼트(발송 완료 포함)의 줄을 모두 넣는다.
export const lineCountKey = (r: { 발주번호?: unknown; 상품이름?: unknown }) =>
  `${String(r.발주번호 ?? '').trim()}│${String(r.상품이름 ?? '').trim()}`;
export function pickNewByCount<T extends { 발주번호: string; 상품이름: string }>(
  incoming: T[],
  have: { 발주번호?: unknown; 상품이름?: unknown }[],
): T[] {
  const count = new Map<string, number>();
  have.forEach(r => { const k = lineCountKey(r); count.set(k, (count.get(k) || 0) + 1); });
  return incoming.filter(r => {
    const k = lineCountKey(r);
    const n = count.get(k) || 0;
    if (n > 0) { count.set(k, n - 1); return false; }
    return true;
  });
}

// 박스수량 칸의 값: "박스3" = 이 상품이 3번 상자에 들어간다는 뜻. 여러 상품이 같은 상자에 들어가면 같은 번호를
// 적는다. 예전 방식("롯데", "롯데2" = 상자 2개)으로 적어둔 값도 번호로 읽어준다.
export function parseBoxNo(value: string): number | null {
  const m = /^(?:박스|롯데)\s*(\d+)?\s*번?$/.exec(String(value || '').trim());
  if (!m) return null;
  return m[1] ? Math.max(1, Number(m[1])) : 1;
}

export const boxLabel = (no: number) => `박스${no}`;

// 한 상품을 여러 박스에 나눠 담을 때 박스 칸 값: "박스3:6/박스4:6" = 3번 박스에 6개, 4번 박스에 6개.
export type BoxPiece = { no: number; qty: number };
export const isBoxSplit = (value: string) => String(value || '').includes(':');
export function parseBoxSplit(value: string): BoxPiece[] {
  return String(value || '').split('/').map(part => {
    const [box, qty] = part.split(':');
    return { no: parseBoxNo(box) || 0, qty: Number(qty) || 0 };
  }).filter(p => p.no && p.qty > 0);
}
// 같은 박스 조각은 합치고, 조각이 하나만 남으면 보통 값("박스3")으로 돌린다.
export function joinBoxSplit(pieces: BoxPiece[]): string {
  const merged: BoxPiece[] = [];
  for (const p of pieces) {
    if (!p.no || p.qty <= 0) continue;
    const same = merged.find(m => m.no === p.no);
    if (same) same.qty += p.qty; else merged.push({ ...p });
  }
  if (!merged.length) return '';
  if (merged.length === 1) return boxLabel(merged[0].no);
  return merged.map(p => `${boxLabel(p.no)}:${p.qty}`).join('/');
}
// 나눈 값을 조각 줄로 펼친다. 안 나눈 줄은 그대로 한 줄.
export function expandBoxSplit<T extends { 쉼먼트: string; 확정수량: number | '' }>(row: T): (T & { 조각?: number; 원수량?: number | '' })[] {
  if (!isBoxSplit(row.쉼먼트)) return [row];
  const pieces = parseBoxSplit(row.쉼먼트);
  if (!pieces.length) return [{ ...row, 쉼먼트: '' }];
  return pieces.map((p, i) => ({ ...row, 쉼먼트: boxLabel(p.no), 확정수량: p.qty, 조각: i, 원수량: row.확정수량 }));
}

// 묶음으로 담은 줄은 발주번호·입고예정일이 달라도 한 상자로 본다. 묶음이 걸친 물류센터는
// 묶음 카드에서 고른 센터(묶음센터)로, 안 골랐으면 그 묶음의 첫 줄 센터로 맞춘다(택배는 한 곳으로만 가므로).
export function bundleCenters(displayRows: DisplayRow[]): Map<string, string> {
  const out = new Map<string, string>();
  const chosen = new Map<string, string>();
  for (const row of displayRows) {
    if (row.isBlank || !row.묶음) continue;
    if (row.묶음센터 && !chosen.has(row.묶음)) chosen.set(row.묶음, row.묶음센터.trim());
    if (!out.has(row.묶음)) out.set(row.묶음, (row._물류센터 || row.물류센터).trim());
  }
  chosen.forEach((center, bundle) => out.set(bundle, center));
  return out;
}

// 한 상자를 가리키는 키: 묶음에 담았으면 묶음 이름, 아니면 센터+입고예정일 묶음(groupKey).
export const boxGroupKey = (row: DisplayRow) => (row.묶음 ? `묶음:${row.묶음}` : row.groupKey);

// 물류센터별 상자 개수. 물류센터가 빈칸인 줄은 바로 위 줄과 같은 센터다(buildDisplayRows가 _물류센터에
// 원래 값을 넣어 둔다). 같은 센터라도 입고예정일 묶음이 다르면 다른 상자로 센다.
export function boxesByCenter(displayRows: DisplayRow[]): Map<string, number> {
  const seen = new Map<string, Set<string>>();
  const bundleCenter = bundleCenters(displayRows);
  for (const row of displayRows) {
    if (row.isBlank) continue;
    const center = (row.묶음 ? bundleCenter.get(row.묶음) : '') || (row._물류센터 || row.물류센터).trim();
    const no = parseBoxNo(row.쉼먼트);
    if (!center || !no) continue;
    const set = seen.get(center) || new Set<string>();
    set.add(`${boxGroupKey(row)}|${no}`);
    seen.set(center, set);
  }
  const out = new Map<string, number>();
  seen.forEach((set, center) => out.set(center, set.size));
  return out;
}

export const totalBoxCount = (displayRows: DisplayRow[]) =>
  Array.from(boxesByCenter(displayRows).values()).reduce((s, n) => s + n, 0);

// 택배 예약 묶음(쉽먼트) 기록용: 센터 → 박스 → 그 박스에 담은 상품들.
// 물류센터가 빈 줄은 위 줄과 같은 센터(_물류센터에 원래 값이 들어 있음).
export function shipmentCenters(displayRows: DisplayRow[]) {
  const centers = new Map<string, Map<string, { boxNo: number; lines: OrderRow[] }>>();
  const bundleCenter = bundleCenters(displayRows);
  for (const row of displayRows) {
    if (row.isBlank) continue;
    const center = (row.묶음 ? bundleCenter.get(row.묶음) : '') || (row._물류센터 || row.물류센터).trim();
    const no = parseBoxNo(row.쉼먼트);
    if (!center || !no) continue;
    const boxes = centers.get(center) || new Map();
    const key = `${boxGroupKey(row)}|${no}`;
    const box = boxes.get(key) || { boxNo: no, lines: [] as OrderRow[] };
    box.lines.push({
      발주번호: row._발주번호,
      물류센터: center,
      상품이름: row.상품이름,
      확정수량: row.확정수량,
      입고예정일: row._입고예정일,
      메모: row.메모,
      쉼먼트: row.쉼먼트,
    });
    boxes.set(key, box);
    centers.set(center, boxes);
  }
  return Array.from(centers.entries()).map(([center, boxes]) => ({
    center,
    boxes: Array.from(boxes.values()).sort((a, b) => a.boxNo - b.boxNo),
  }));
}
