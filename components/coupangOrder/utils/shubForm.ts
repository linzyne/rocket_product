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

  for (let r = 1; r < rows.length; r++) {
    const po = digits(rows[r][COL_PO]);
    const name = norm(rows[r][COL_NAME]);
    const qty = Number(String(rows[r][COL_QTY]).replace(/,/g, '')) || 0;
    if (!po) continue;

    const sameOrder = entries.filter(e => digits(e.line.발주번호) === po);
    const hit =
      sameOrder.find(e => norm(e.line.상품이름) === name) ||
      sameOrder.find(e => name.includes(norm(e.line.상품이름)) || norm(e.line.상품이름).includes(name)) ||
      sameOrder.find(e => e.line.확정수량 === qty) ||
      (sameOrder.length === 1 ? sameOrder[0] : undefined);

    if (!hit || !hit.waybill) {
      missed.push(`${po} · ${name.slice(0, 20)}`);
      continue;
    }
    const cell = (c: number) => XLSX.utils.encode_cell({ r, c });
    ws[cell(COL_INVOICE)] = { t: 's', v: invNo(hit.waybill) };
    ws[cell(COL_SHIPPED)] = { t: 'n', v: hit.line.확정수량 || qty };
    used.add(hit.waybill);
    filled += 1;
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
    fileName: `쉽먼트양식_${batch.id}.xlsx`,
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
