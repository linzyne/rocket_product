// 발주확정 양식(서허 "발주서업로드양식" = PO_FOR_CONFIRM(…).xlsx) 보관과 채우기.
//
//  coupangPoForms/{id}       : 받은 양식 파일 그대로 { name, dataUrl, orderNos, at }
//  coupangPoConfirmDraft/{발주번호} : 발주확정 상자에서 고친 확정수량·사유 { qty: {상품이름: n}, reason: {상품이름: 글} }
//
// 새 주문을 받아 올 때 그 파일을 그대로 남겨 두었다가, "발주확정 올리기"를 누르면 그 발주서들의 줄만 모아
// I열(확정수량)과 M열(납품부족사유)을 채운 파일을 만든다. 나머지 칸은 받은 그대로 둔다.
import * as XLSX from 'xlsx';
import { collection, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db, ensureSignedIn } from '../../../utils/firebase';

const FORMS = 'coupangPoForms';
const DRAFTS = 'coupangPoConfirmDraft';
const FORMS_LOCAL = 'coupangPoForms';
const DRAFTS_LOCAL = 'coupangPoConfirmDraft';

// 확정수량을 발주수량보다 줄이면 기본으로 고르는 사유.
export const DEFAULT_REASON = '제조사 생산중단 혹은 공급사 취급중단 - 시장 단종';
export const SHORT_REASONS = [
  '제조사 생산중단 혹은 공급사 취급중단 - 제품 리뉴얼/모델 변경',
  '제조사 생산중단 혹은 공급사 취급중단 - 시장 단종',
  '제조사 생산중단 혹은 공급사 취급중단 - 사업자변경',
  '협력사 재고부족 - 수요예측 오류',
  '협력사 재고부족 - 생산캐파 부족 (설비라인/원자재/인력/휴무… 등등)',
  '협력사 재고부족 - 품질적 이슈 (유해물질 발견 / 유통기한 미달)',
  '협력사 재고부족 - 재고 할당정책',
  '협력사 재고부족 - 수입상품 입고지연 (선적/통관지연)',
  'FC 입고기준 미달로 회송',
  '가격 이슈 (Price) - 매입가 인하 협상 중',
  '가격 이슈 (Price) - 매입가 인상 협상 중',
  '가격 이슈 (Price) - 쿠팡 최저가 매칭',
  '최소발주량 변경 필요 (MOQ)',
  '쿠팡 요청 미납',
  '시즌상품으로 다음 시즌전까지 생산 혹은 취급중단',
  '천재지변/재난과 같은 불가항력적인 사유로 미납',
  '업체 휴무',
  '재무 관련 사유',
  'FC 입고 이슈 - FC 슬롯 예약 불가',
  'FC 입고 이슈 - 밀크런 예약불가',
];

export interface PoForm { id: string; name: string; dataUrl: string; orderNos: string[]; at: number }
export interface PoDraft { no: string; qty: Record<string, number>; reason: Record<string, string> }

const SHEET = '상품목록';
const COL = { no: 0, center: 1, sku: 4, name: 6, ordered: 7, confirmed: 8, reason: 12 };

const readLocal = <T,>(k: string): Record<string, T> => {
  try { return JSON.parse(localStorage.getItem(k) || '') || {}; } catch { return {}; }
};
const writeLocal = (k: string, v: unknown) => {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
};

let forms: Record<string, PoForm> = readLocal<PoForm>(FORMS_LOCAL);
let drafts: Record<string, PoDraft> = readLocal<PoDraft>(DRAFTS_LOCAL);
const CHANGED = 'coupang-po-forms-changed';
const notify = () => window.dispatchEvent(new CustomEvent(CHANGED));

let started = false;
const start = () => {
  if (started || !db) return;
  started = true;
  const firestore = db;
  ensureSignedIn().then(() => {
    onSnapshot(collection(firestore, FORMS), snap => {
      forms = Object.fromEntries(snap.docs.map(d => [d.id, { ...(d.data() as PoForm), id: d.id }]));
      writeLocal(FORMS_LOCAL, forms);
      notify();
    }, err => console.error('발주확정 양식 동기화 실패:', err));
    onSnapshot(collection(firestore, DRAFTS), snap => {
      drafts = Object.fromEntries(snap.docs.map(d => [String(d.data().no || d.id), { qty: {}, reason: {}, ...(d.data() as PoDraft) }]));
      writeLocal(DRAFTS_LOCAL, drafts);
      notify();
    }, err => console.error('발주확정 수량 동기화 실패:', err));
  });
};

export function subscribePoForms(cb: () => void): () => void {
  start();
  window.addEventListener(CHANGED, cb);
  return () => window.removeEventListener(CHANGED, cb);
}
export const readDraft = (no: string): PoDraft => drafts[no] || { no, qty: {}, reason: {} };
// 이 발주서가 든 양식이 있는지(없으면 PO_FOR_CONFIRM 파일을 골라 넣어야 한다).
export const hasForm = (no: string) => Object.values(forms).some(f => (f.orderNos || []).includes(no));

const toDataUrl = (buf: ArrayBuffer) => {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  return `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${btoa(bin)}`;
};
const fromDataUrl = (url: string) => {
  const bin = atob(url.slice(url.indexOf(',') + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
};
const rowsOf = (wb: XLSX.WorkBook): unknown[][] => {
  const ws = wb.Sheets[SHEET] || wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '', raw: true });
};
const isPoForm = (rows: unknown[][]) => {
  const head = (rows[0] || []).map(v => String(v).trim());
  return head[COL.no] === '발주번호' && head[COL.confirmed] === '확정수량' && head[COL.reason] === '납품부족사유';
};

// 받은 발주서 파일이 발주확정 양식이면 그대로 남겨 둔다. 양식이 아니면 아무것도 안 한다.
export async function savePoForm(file: File): Promise<boolean> {
  const buf = await file.arrayBuffer();
  let rows: unknown[][];
  try { rows = rowsOf(XLSX.read(buf, { type: 'array' })); } catch { return false; }
  if (!isPoForm(rows)) return false;
  const orderNos = Array.from(new Set(rows.slice(1).map(r => String(r[COL.no] ?? '').trim()).filter(Boolean)));
  if (!orderNos.length) return false;
  const dataUrl = toDataUrl(buf);
  if (dataUrl.length > 900_000) {
    console.warn('발주확정 양식이 너무 커서 클라우드에 못 남겨요:', file.name);
    return false;
  }
  const id = `${Date.now()}-${orderNos[0]}`;
  const form: PoForm = { id, name: file.name, dataUrl, orderNos, at: Date.now() };
  forms = { ...forms, [id]: form };
  writeLocal(FORMS_LOCAL, forms);
  notify();
  if (db) {
    const firestore = db;
    await ensureSignedIn();
    await setDoc(doc(firestore, FORMS, id), form);
  }
  return true;
}

// 발주확정 상자에서 고친 확정수량·사유를 적는다(어느 컴퓨터에서 봐도 같게).
export function setDraftLine(no: string, name: string, qty: number | null, reason?: string) {
  const d = readDraft(no);
  const next: PoDraft = { no, qty: { ...d.qty }, reason: { ...d.reason } };
  if (qty == null) { delete next.qty[name]; delete next.reason[name]; }
  else {
    next.qty[name] = qty;
    if (reason !== undefined) next.reason[name] = reason;
  }
  drafts = { ...drafts, [no]: next };
  writeLocal(DRAFTS_LOCAL, drafts);
  notify();
  if (!db) return;
  const firestore = db;
  ensureSignedIn().then(() => setDoc(doc(firestore, DRAFTS, no.replace(/\//g, '∕')), next))
    .catch(err => console.error('발주확정 수량 저장 실패:', err));
}

export interface ConfirmFile { blob: Blob; name: string; dataUrl: string; orderNos: string[]; missing: string[]; lines: number; shorts: { no: string; name: string; ordered: number; qty: number }[] }

// 고른 발주서들의 줄만 모아 I열(확정수량)·M열(납품부족사유)을 채운 발주확정 파일을 만든다.
// 같은 발주서가 여러 양식에 있으면 가장 최근 양식을 쓴다. 양식이 없는 발주서는 missing으로 돌려준다.
export function buildConfirmFile(orderNos: string[]): ConfirmFile | null {
  const want = new Set(orderNos);
  const latest = new Map<string, PoForm>();
  Object.values(forms).sort((a, b) => a.at - b.at).forEach(f => (f.orderNos || []).forEach(no => { if (want.has(no)) latest.set(no, f); }));
  const missing = orderNos.filter(no => !latest.has(no));
  const used = Array.from(new Set(latest.values()));
  if (!used.length) return null;

  let head: unknown[] = [];
  let hidden: XLSX.WorkSheet | undefined;
  const body: unknown[][] = [];
  const shorts: ConfirmFile['shorts'] = [];
  for (const f of used) {
    const wb = XLSX.read(fromDataUrl(f.dataUrl), { type: 'array' });
    const rows = rowsOf(wb);
    if (!head.length) head = rows[0];
    if (!hidden) hidden = wb.Sheets.hiddenSheet;
    for (const r of rows.slice(1)) {
      const no = String(r[COL.no] ?? '').trim();
      if (!want.has(no) || latest.get(no) !== f) continue;
      const row = [...r];
      while (row.length < head.length) row.push('');
      const name = String(r[COL.name] ?? '').trim();
      const ordered = Number(String(r[COL.ordered] ?? '').replace(/,/g, '')) || 0;
      const d = readDraft(no);
      const qty = d.qty[name] != null ? d.qty[name] : (Number(String(r[COL.confirmed] ?? '').replace(/,/g, '')) || ordered);
      // 받은 양식의 칸 모양(글자)을 그대로 따른다.
      row[COL.confirmed] = typeof r[COL.confirmed] === 'number' ? qty : String(qty);
      row[COL.reason] = qty < ordered ? (d.reason[name] || DEFAULT_REASON) : '';
      if (qty < ordered) shorts.push({ no, name, ordered, qty });
      body.push(row);
    }
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head, ...body]), SHEET);
  if (hidden) {
    XLSX.utils.book_append_sheet(wb, hidden, 'hiddenSheet');
    // 사유 목록 시트는 받은 양식처럼 숨겨 둔다.
    wb.Workbook = { Sheets: [{ name: SHEET }, { name: 'hiddenSheet', Hidden: 1 }] };
  }
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  const done = Array.from(latest.keys());
  const name = `PO_FOR_CONFIRM(${done[0]}${done.length > 1 ? `외${done.length - 1}` : ''}).xlsx`;
  return {
    blob: new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    name, dataUrl: toDataUrl(out), orderNos: done, missing, lines: body.length, shorts,
  };
}
