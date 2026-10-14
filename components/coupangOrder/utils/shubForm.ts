import * as XLSX from 'xlsx';
import { ShipmentBatch, allBoxes } from '../../../data/shipmentStore';

// C단계: 서허에서 받은 "쉽먼트 일괄등록 양식"을 우리 박스 배정대로 채운다.
//
// 양식 생김새(서허가 주는 그대로):
//   · 상품목록 시트  - 1줄은 머리글, 2줄부터 발주건들.
//                     A 발주번호 / G 상품이름 / H 확정수량 / I 송장번호(빈칸) / J 납품수량(빈칸)
//   · 송장번호입력 시트 - A2부터 이번에 쓴 운송장번호를 한 줄에 하나씩.
//   · 입력방법 시트   - 안내문. 건드리지 않는다.
const SHEET_ITEMS = '상품목록';
const SHEET_INVOICE = '송장번호입력';
const COL_PO = 0; // A
const COL_NAME = 6; // G
const COL_QTY = 7; // H
const COL_INVOICE = 8; // I
const COL_SHIPPED = 9; // J

const norm = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
const digits = (s: unknown) => norm(s).replace(/\D/g, '');
// 서허는 송장번호를 하이픈 없이 숫자로만 쓴다(목록에도 261728612714 처럼 나온다).
const invNo = (s: unknown) => digits(s);

export interface FillResult {
  blob: Blob;
  fileName: string;
  filled: number; // 송장번호를 채운 줄 수
  missed: string[]; // 짝을 못 찾은 줄(발주번호 · 상품이름)
  waybills: string[]; // 송장번호입력 시트에 넣은 번호들
}

export const fillShubForm = (arrayBuffer: ArrayBuffer, batch: ShipmentBatch): FillResult => {
  const wb = XLSX.read(arrayBuffer, { type: 'array', cellStyles: true });
  const ws = wb.Sheets[SHEET_ITEMS];
  if (!ws) throw new Error(`양식에 "${SHEET_ITEMS}" 시트가 없어요.`);

  // 박스에 담긴 줄들: 발주번호+상품이름으로 찾을 수 있게 펼쳐 둔다.
  const boxes = allBoxes(batch);
  const entries = boxes.flatMap(b => b.lines.map(l => ({ waybill: b.waybill, line: l })));

  const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '', blankrows: false });
  const used = new Set<string>();
  const missed: string[] = [];
  let filled = 0;
  // 나눈 박스 조각을 붙일 다음 빈 줄(0부터 센 줄 번호).
  let extraRow = rows.length;

  for (let r = 1; r < rows.length; r++) {
    const po = digits(rows[r][COL_PO]);
    const name = norm(rows[r][COL_NAME]);
    const qty = Number(String(rows[r][COL_QTY]).replace(/,/g, '')) || 0;
    if (!po) continue;

    const sameOrder = entries.filter(e => digits(e.line.발주번호) === po);
    if (!sameOrder.length) {
      missed.push(`발주서 ${po} '${name.slice(0, 20)}'은 이번 박스에 없는 발주서예요`);
      continue;
    }
    // 짐작하지 않는다: 상품 이름이 정확히 같은 박스 줄만 쓴다. 단, 이 발주서가 박스 하나(송장 하나)에만 들어 있으면
    // 어느 송장인지 분명하므로 그 송장을 쓴다(수량은 양식의 확정수량 그대로).
    const exact = sameOrder.filter(e => norm(e.line.상품이름) === name);
    const waybillsOfPo = new Set(sameOrder.map(e => invNo(e.waybill)));
    let parts: typeof sameOrder;
    if (exact.length) parts = exact;
    else if (waybillsOfPo.size === 1) parts = [{ waybill: sameOrder[0].waybill, line: { ...sameOrder[0].line, 상품이름: name, 확정수량: qty } }];
    else {
      missed.push(`발주서 ${po} '${name.slice(0, 20)}'이 박스 여러 개에 나뉘어 있는데 상품 이름이 정확히 안 맞아 어느 송장인지 몰라요`);
      continue;
    }
    parts.forEach((part, i) => {
      if (!part.waybill) {
        missed.push(`발주서 ${po} '${name.slice(0, 20)}'의 박스에 송장번호가 없어요`);
        return;
      }
      const at = i === 0 ? r : extraRow++;
      const cell = (c: number) => XLSX.utils.encode_cell({ r: at, c });
      if (i > 0) {
        for (let c = 0; c < COL_INVOICE; c++) {
          const src = ws[XLSX.utils.encode_cell({ r, c })];
          if (src) ws[cell(c)] = { ...src };
        }
      }
      ws[cell(COL_INVOICE)] = { t: 's', v: invNo(part.waybill) };
      ws[cell(COL_SHIPPED)] = { t: 'n', v: parts.length > 1 ? part.line.확정수량 : (part.line.확정수량 || qty) };
      used.add(part.waybill);
      filled += 1;
    });
  }
  // 반대로 우리 박스에는 있는데 양식에 없는 발주서도 빠뜨리면 안 된다(서허에 일부만 등록되는 일).
  const formPos = new Set(rows.slice(1).map(r => digits(r[COL_PO])).filter(Boolean));
  for (const e of entries) {
    const po = digits(e.line.발주번호);
    if (po && !formPos.has(po)) missed.push(`발주서 ${po}가 서허 양식에 없어요(서허 양식에 이 발주서가 없음)`);
  }
  // 복사해 붙인 줄까지 시트 범위를 늘린다.
  if (extraRow > rows.length) {
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
    range.e.r = Math.max(range.e.r, extraRow - 1);
    range.e.c = Math.max(range.e.c, COL_SHIPPED);
    ws['!ref'] = XLSX.utils.encode_range(range);
  }

  // 송장번호입력 시트: 이번에 쓴 운송장번호를 한 줄에 하나씩(중복 없이).
  const inv = wb.Sheets[SHEET_INVOICE];
  const waybills = boxes.map(b => b.waybill).filter(w => w && used.has(w)).map(invNo);
  const uniq = Array.from(new Set(waybills));
  if (inv) {
    uniq.forEach((w, i) => {
      inv[XLSX.utils.encode_cell({ r: i + 1, c: 0 })] = { t: 's', v: w };
    });
  }

  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });
  return {
    blob: new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    // 올릴 때마다 이름이 달라야 서허 일괄등록 내역에서 "방금 올린 파일"을 예전 것과 헷갈리지 않는다.
    fileName: `쉽먼트양식_${batch.id}_${new Date().toTimeString().slice(0, 8).replace(/:/g, '')}.xlsx`,
    filled,
    missed,
    waybills: uniq,
  };
};

// data:...;base64,xxx → ArrayBuffer
export const dataUrlToBuffer = (dataUrl: string): ArrayBuffer => {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
};
