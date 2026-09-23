import * as XLSX from 'xlsx';
import type { DisplayRow } from './dataProcessor';
import { boxesByCenter } from './dataProcessor';
import type { AddressEntry, LotteRow, SenderInfo } from '../types';
import { formatDateDisplay } from './dateUtils';

// 셀을 텍스트 타입으로 강제 설정 (전화번호/우편번호 앞자리 0 보존)
function forceTextCols(ws: XLSX.WorkSheet, rowCount: number, colIndexes: number[]) {
  for (let r = 1; r <= rowCount; r++) {
    for (const c of colIndexes) {
      const addr = XLSX.utils.encode_cell({ r, c });
      if (ws[addr]) {
        ws[addr].t = 's';
        ws[addr].v = String(ws[addr].v ?? '');
        delete ws[addr].w;
      }
    }
  }
}

// 완전일치 우선, 없으면 저장된 키와 물류센터명이 서로 포함 관계면 매칭
// 예: 저장 리스트 "로켓 대구3" ↔ 물류센터 "대구3"
function findAddressEntry(
  addresses: AddressEntry[],
  addrMap: Map<string, AddressEntry>,
  center: string
): AddressEntry {
  const exact = addrMap.get(center);
  if (exact) return exact;

  const partial = addresses.find(a => {
    const key = a.key.trim();
    return key.includes(center) || center.includes(key);
  });

  return partial ?? { phone: '', zip: '', addr1: '', addr2: '', key: center };
}

// 롯데택배 업로드 엑셀을 내려받고, 같은 파일을 돌려준다(확장이 택배사 사이트에 올릴 때 씀). 만들 게 없으면 null.
// batchId를 주면 주문번호를 "S260923-01-1"처럼 붙여, 나중에 롯데 목록에서 이번에 올린 건만 골라낼 수 있다.
export function exportLotteExcel(
  displayRows: DisplayRow[],
  addresses: AddressEntry[],
  sender: SenderInfo,
  batchId?: string
): { name: string; dataUrl: string } | null {
  const addrMap = new Map<string, AddressEntry>();
  addresses.forEach(a => addrMap.set(a.key.trim(), a));

  // 물류센터별 상자 개수만큼 택배 예약 줄을 만든다(상자 하나 = 예약 한 건).
  const toWrite: LotteRow[] = [];
  let nextNo = 1;

  for (const [center, boxes] of boxesByCenter(displayRows)) {
    const info = findAddressEntry(addresses, addrMap, center);
    const fullAddr = info.addr2 ? `${info.addr1} ${info.addr2}` : info.addr1;
    for (let i = 0; i < boxes; i++) {
      toWrite.push({
        주문번호: batchId ? `${batchId}-${nextNo++}` : nextNo++,
        받는사람: center,
        전화번호1: info.phone,
        우편번호: info.zip,
        주소: fullAddr,
        상품명1: center,
      });
    }
  }

  if (toWrite.length === 0) {
    alert('택배 예약할 상자가 없습니다.\n박스수량 칸에서 상자 번호(박스1, 박스2…)를 지정하세요.');
    return null;
  }

  // 롯데택배 양식 헤더 (A~O, 15열)
  const headers = [
    '주문번호',          // A
    '보내는사람(지정)',   // B
    '전화번호1(지정)',    // C
    '전화번호2(지정)',    // D
    '우편번호(지정)',     // E
    '주소(지정)',         // F
    '받는사람',           // G
    '전화번호1',          // H
    '전화번호2',          // I
    '우편번호',           // J
    '주소',               // K
    '상품명1',            // L
    '상품상세1',          // M
    '수량(A타입)',        // N
    '배송메시지',         // O
  ];
  const ws_data: unknown[][] = [headers];

  for (const r of toWrite) {
    const row = new Array(15).fill('');
    row[0]  = r.주문번호;   // A: 주문번호
    row[1]  = sender.name;   // B: 보내는사람(지정)
    row[2]  = sender.phone1; // C: 전화번호1(지정)
    row[3]  = sender.phone2; // D: 전화번호2(지정)
    row[4]  = sender.zip;    // E: 우편번호(지정)
    row[5]  = sender.addr;   // F: 주소(지정)
    row[6]  = r.받는사람;   // G: 받는사람
    row[7]  = r.전화번호1;  // H: 전화번호1
    row[9]  = r.우편번호;   // J: 우편번호
    row[10] = r.주소;        // K: 주소
    row[11] = r.상품명1;    // L: 상품명1
    ws_data.push(row);
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(ws_data);

  // 전화번호(C=2,D=3,H=7), 우편번호(E=4,J=9) 앞자리 0 보존
  forceTextCols(ws, toWrite.length, [2, 3, 4, 7, 9]);

  XLSX.utils.book_append_sheet(wb, ws, '롯데택배');
  const name = `롯데택배_${formatToday()}.xlsx`;
  XLSX.writeFile(wb, name);
  const base64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
  return { name, dataUrl: `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${base64}` };
}

export function exportSummaryExcel(displayRows: DisplayRow[]): void {
  const headers = ['발주번호', '물류센터', '상품이름', '확정수량', '입고예정일', '메모', '박스수량'];
  const ws_data: unknown[][] = [headers];

  for (const row of displayRows) {
    if (row.isBlank) {
      ws_data.push(['', '', '', '', '', '', '']);
      continue;
    }
    ws_data.push([
      row._발주번호 || row.발주번호,
      row._물류센터 || row.물류센터,
      row.상품이름,
      row.확정수량,
      formatDateDisplay(row.입고예정일),
      row.메모,
      row.쉼먼트,
    ]);
  }

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(ws_data);
  XLSX.utils.book_append_sheet(wb, ws, '발주서정리');
  XLSX.writeFile(wb, `발주서정리_${formatToday()}.xlsx`);
}

function formatToday(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}
