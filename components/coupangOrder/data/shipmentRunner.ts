// 쉽먼트 자동 진행: 택배예약(롯데) → 운송장 받기 → 서허 양식 받기·채우기 → 서허 쉽먼트 일괄등록.
// 예전에는 이 순서가 쉽먼트생성 화면 안에만 있어서, 화면을 옮기거나 중간에 멈추면 어디까지 했는지 아무도 몰랐다
// (택배예약까지만 되고 일괄등록은 안 된 채로 끝난 일). 그래서 화면 밖(이 파일)으로 꺼내고, 단계가 바뀔 때마다
// 쉽먼트 기록(run)에 적는다. 멈추면 그 자리와 까닭이 남고, "이어서 하기"는 그 다음 단계부터 한다.
//
// 확장 소식은 앱의 모든 탭에 똑같이 간다. 두 탭이 함께 다음 단계를 밟으면 서허에 두 번 올라가므로,
// 다음 단계로 넘기는 일은 그 쉽먼트를 시작한(또는 이어서 하기를 누른) 탭만 한다(owned).
// 결과를 적는 일(등록 완료·쉽먼트 번호)은 어느 탭이 해도 같아서 다 한다.
import type { DisplayRow } from '../utils/dataProcessor';
import { shipmentCenters, totalBoxCount } from '../utils/dataProcessor';
import { exportLotteExcel } from '../utils/excelExport';
import { fillShubForm, dataUrlToBuffer } from '../utils/shubForm';
import { dateKeyYMD } from '../utils/dateUtils';
import type { AddressEntry, SenderInfo } from '../types';
import {
  ShipmentBatch, ShipmentRun, ShipmentRunStep, allBoxes, batchId as makeBatchId, fillWaybills,
  saveShipmentBatch, patchShipmentBatch,
} from '../../../data/shipmentStore';
import { ShipOut, markShipOuts, readShipOuts, applyShipmentNos, shipOutUploaded } from './shipOutStore';

const APP = 'rocket-app-hub';
const EXT = 'rocket-hub-extension';

export const STEP_LABEL: Record<ShipmentRunStep, string> = {
  lotte: '택배예약',
  waybill: '운송장',
  form: '서허 양식',
  upload: '서허 일괄등록',
  done: '완료',
};

// ── 이 탭이 몰고 있는 쉽먼트 ──
interface Owned { batch: ShipmentBatch; itemIds: string[]; lotteSavedAt?: number }
const owned = new Map<string, Owned>();

// ── 지금 진행 문구(화면 아래 파란 줄) ──
export interface LiveStatus { batchId: string; text: string; tone: 'info' | 'ok' | 'error'; canPickForm?: boolean }
let live: LiveStatus | null = null;
const liveListeners = new Set<(s: LiveStatus | null) => void>();
const setLive = (s: LiveStatus | null) => { live = s; liveListeners.forEach(l => l(s)); };
export const subscribeLive = (cb: (s: LiveStatus | null) => void) => {
  cb(live);
  liveListeners.add(cb);
  return () => { liveListeners.delete(cb); };
};
export const clearLive = () => setLive(null);

// 운송장을 사람이 넣어야 할 때 쉽먼트생성 화면이 운송장 창을 연다.
const waybillListeners = new Set<(b: ShipmentBatch) => void>();
export const onNeedWaybill = (cb: (b: ShipmentBatch) => void) => {
  waybillListeners.add(cb);
  return () => { waybillListeners.delete(cb); };
};

// 단계를 기록에 적는다(멈춘 자리가 남게).
const mark = (id: string, step: ShipmentRunStep, state: ShipmentRun['state'], message: string) => {
  const run: ShipmentRun = { step, state, message, at: Date.now() };
  const o = owned.get(id);
  if (o) o.batch = { ...o.batch, run };
  patchShipmentBatch(id, { run }).catch(err => console.error('쉽먼트 진행 기록 실패:', err));
  setLive({ batchId: id, text: `${id} · ${STEP_LABEL[step]} · ${message}`, tone: state === 'error' ? 'error' : state === 'done' ? 'ok' : 'info', canPickForm: step === 'form' || step === 'upload' });
};
const fail = (id: string, step: ShipmentRunStep, message: string) => mark(id, step, 'error', message);

const orderNosOf = (batch: ShipmentBatch) =>
  Array.from(new Set(allBoxes(batch).flatMap(b => b.lines.map(l => String(l.발주번호 || '').trim())).filter(Boolean)));

// 이 쉽먼트에 든 출고 건들(시작할 때 받은 것 + 쉽먼트 번호로 이어진 것).
const itemsOf = (id: string): ShipOut[] => {
  const ids = new Set(owned.get(id)?.itemIds || []);
  return readShipOuts().filter(i => ids.has(i.id) || i.batchId === id);
};

// ── 1. 택배예약 ──
// 고른 출고 건들로 롯데 예약 엑셀을 만들고 확장이 ALPS에 올린다. 운송장이 오면 저절로 다음 단계로 간다.
export function startShipment(
  rows: DisplayRow[], itemIds: string[], addresses: AddressEntry[], sender: SenderInfo, batches: ShipmentBatch[],
): ShipmentBatch | null {
  if (!rows.length) return null;
  const id = makeBatchId(batches);
  const file = exportLotteExcel(rows, addresses, sender, id);
  if (!file) return null;
  if (!confirm(`${file.name}을 내려받았어요.\n택배 예약 → 운송장 → 서허 양식 → 서허 일괄등록까지 이어서 할까요?`)) return null;

  const batch: ShipmentBatch = {
    id,
    createdAt: Date.now(),
    status: 'reserved',
    centers: shipmentCenters(rows).map(c => ({
      center: c.center,
      boxes: c.boxes.map(b => ({
        boxNo: b.boxNo,
        waybill: '',
        lines: b.lines.map(l => ({
          발주번호: l.발주번호,
          상품이름: l.상품이름,
          확정수량: Number(l.확정수량) || 0,
          입고예정일: dateKeyYMD(l.입고예정일).replace(/-/g, ''),
        })),
      })),
    })),
    run: { step: 'lotte', state: 'running', message: '택배사 창 여는 중…', at: Date.now() },
  };
  saveShipmentBatch(batch).catch(err => alert(`쉽먼트 기록 저장 실패: ${err instanceof Error ? err.message : String(err)}`));
  markShipOuts(itemIds, { batchId: id });
  owned.set(id, { batch, itemIds });
  setLive({ batchId: id, text: `${id} · 택배예약 · 택배사 창 여는 중…`, tone: 'info' });
  window.postMessage({ source: APP, type: 'LOTTE_UPLOAD', file, boxCount: totalBoxCount(rows), batchId: id }, window.location.origin);
  return batch;
}

// 롯데에서 운송장이 왔을 때. 주문번호(쉽먼트번호-n)와 확실히 짝지어진 번호만 넣는다(틀리면 안 되므로 추측하지 않는다).
const onWaybills = (o: Owned, list: { waybill: string; receiver: string; ordNo?: string }[]) => {
  const batch = o.batch;
  const digits = (w: string) => String(w || '').replace(/\D/g, '');
  const want = new Set(Array.from({ length: allBoxes(batch).length }, (_, i) => `${batch.id}-${i + 1}`));
  const paired = list.filter(w => w.ordNo && want.has(w.ordNo) && digits(w.waybill).length === 12);
  const clean = paired.length === list.length
    && new Set(paired.map(w => w.ordNo)).size === paired.length
    && new Set(paired.map(w => digits(w.waybill))).size === paired.length;
  if (!clean) {
    fail(batch.id, 'waybill', `운송장번호를 주문번호와 확실히 짝짓지 못해 넣지 않았어요. 롯데 화면에서 확인해 운송장 창에 넣은 뒤 "이어서 하기"를 눌러 주세요. (가져온 값: ${list.map(w => `${w.ordNo || '주문번호 없음'}=${w.waybill}`).join(', ')})`);
    waybillListeners.forEach(l => l(batch));
    return;
  }
  const filled: ShipmentBatch = { ...fillWaybills(batch, paired), status: 'waybilled' };
  o.batch = filled;
  saveShipmentBatch(filled).catch(() => {});
  const boxes = allBoxes(filled);
  if (!(boxes.length && boxes.every(b => b.waybill.trim()))) {
    fail(filled.id, 'waybill', '운송장번호가 다 채워지지 않았어요. 운송장 창에 넣은 뒤 "이어서 하기"를 눌러 주세요.');
    waybillListeners.forEach(l => l(filled));
    return;
  }
  mark(filled.id, 'form', 'running', `운송장 ${boxes.length}건 받음(롯데 목록과 대조 완료) → 서허 양식 받는 중…`);
  setTimeout(() => requestForm(filled.id), 800);
};

// ── 2. 서허 양식 받기 ──
const requestForm = (id: string) => {
  const o = owned.get(id);
  if (!o) return;
  const batch = o.batch;
  mark(id, 'form', 'running', '서허 여는 중…');
  const centers = batch.centers.map(c => c.center.trim()).filter(Boolean);
  const edds = Array.from(new Set(allBoxes(batch).flatMap(b => b.lines.map(l => String(l.입고예정일 || '').trim())).filter(Boolean)))
    .map(d => (/^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d));
  window.postMessage({
    source: APP, type: 'SHUB_FORM', batchId: id,
    boxCount: allBoxes(batch).length, orderNos: orderNosOf(batch),
    center: new Set(centers).size === 1 ? centers[0] : '',
    edd: edds.length === 1 ? edds[0] : '',
  }, window.location.origin);
};

// ── 3. 양식 채우기 → 4. 서허 일괄등록 ──
// 자동으로 받아온 양식이든, 사람이 고른 파일이든 같은 길.
export function fillAndUpload(buf: ArrayBuffer, id: string) {
  const o = owned.get(id);
  if (!o) return;
  const batch = o.batch;
  try {
    const res = fillShubForm(buf, batch);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(res.blob);
    a.download = res.fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    markShipOuts(itemsOf(id).map(i => i.id), { formSavedAt: Date.now() });
    // 짝 못 찾은 줄이 있으면 올리지 않는다(빠진 채로 등록되면 안 된다).
    if (res.missed.length) {
      fail(id, 'form', `양식에 짝 못 찾은 줄이 ${res.missed.length}개 있어서 서허에 올리지 않았어요: ${res.missed.slice(0, 3).join(' / ')}. 저장된 파일(${res.fileName})을 확인해 주세요.`);
      return;
    }
    upload(res.blob, res.fileName, id);
  } catch (err) {
    fail(id, 'form', `양식을 채우지 못했어요: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// 택배사 롯데택배 · 발송일 = 입고예정일 하루 전 · 23:55. 입고예정일이 여럿이면 가장 이른 날.
const upload = (blob: Blob, fileName: string, id: string) => {
  const o = owned.get(id);
  if (!o) return;
  const batch = o.batch;
  const edds = allBoxes(batch).flatMap(b => b.lines.map(l => String(l.입고예정일 || '').replace(/[^0-9]/g, ''))).filter(d => d.length === 8).sort();
  if (!edds.length) {
    fail(id, 'upload', '입고예정일을 몰라서 서허에 올리지 못했어요.');
    return;
  }
  const e = edds[0];
  const day = new Date(Number(e.slice(0, 4)), Number(e.slice(4, 6)) - 1, Number(e.slice(6, 8)) - 1);
  const shipDate = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  const reader = new FileReader();
  reader.onload = () => {
    mark(id, 'upload', 'running', `서허에 올리는 중… (발송일 ${shipDate} 23:55)`);
    window.postMessage({
      source: APP, type: 'SHUB_UPLOAD', batchId: id,
      file: { name: fileName, dataUrl: reader.result as string }, shipDate, shipTime: '23:55', carrier: '롯데택배',
      orderNos: orderNosOf(batch),
    }, window.location.origin);
  };
  reader.readAsDataURL(blob);
};

// ── 이어서 하기 ──
// 멈춘 쉽먼트를 다음 단계부터 다시 한다. 이미 된 단계(특히 택배예약·서허 등록)는 두 번 하지 않는다.
// items: 이 쉽먼트로 이어서 할 출고 건(예전 기록은 다른 건 발주가 섞여 있어서, 그 건 발주만 남겨 쓴다).
export function resumeShipment(batch: ShipmentBatch, items: ShipOut[]): 'done' | 'need-waybill' | 'started' {
  const mine = new Set(items.flatMap(i => i.lines.map(l => String(l.발주번호 || '').trim())));
  const trimmed: ShipmentBatch = !items.length ? batch : {
    ...batch,
    centers: batch.centers
      .map(c => ({ ...c, boxes: c.boxes.map(b => ({ ...b, lines: b.lines.filter(l => mine.has(String(l.발주번호 || '').trim())) })).filter(b => b.lines.length) }))
      .filter(c => c.boxes.length),
  };
  owned.set(batch.id, { batch: trimmed, itemIds: items.map(i => i.id) });
  if (items.length && items.every(shipOutUploaded)) {
    mark(batch.id, 'done', 'done', '서허 일괄등록까지 이미 끝난 건이에요.');
    return 'done';
  }
  const boxes = allBoxes(trimmed);
  if (!boxes.length) {
    fail(batch.id, 'waybill', '이 건의 박스를 쉽먼트 기록에서 찾지 못했어요.');
    return 'need-waybill';
  }
  if (!boxes.every(b => (b.waybill || '').trim())) {
    fail(batch.id, 'waybill', '운송장번호가 비어 있어요. 운송장 창에 넣은 뒤 "이어서 하기"를 눌러 주세요.');
    waybillListeners.forEach(l => l(batch));
    return 'need-waybill';
  }
  requestForm(batch.id);
  return 'started';
}

// ── 확장 소식 받기(앱이 켜질 때 한 번) ──
let started = false;
export function startShipmentRunner() {
  if (started) return;
  started = true;
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window) return;
    const d = event.data;
    if (!d || d.source !== EXT) return;

    // 확장이 일을 받지 못함
    if (d.type === 'LOTTE_UPLOAD_ACK' && !d.ok) {
      const o = Array.from(owned.values()).find(x => x.batch.run?.step === 'lotte' && x.batch.run.state === 'running');
      if (o) fail(o.batch.id, 'lotte', `택배사 창을 열지 못했어요: ${d.error || ''} ("로켓 서허 연동" 확장이 켜져 있는지 확인해 주세요)`);
    }
    if (d.type === 'SHUB_FORM_ACK' && !d.ok) {
      const o = Array.from(owned.values()).find(x => x.batch.run?.step === 'form' && x.batch.run.state === 'running');
      if (o) fail(o.batch.id, 'form', `서허 창을 열지 못했어요: ${d.error || ''}`);
    }
    if (d.type === 'SHUB_UPLOAD_ACK' && !d.ok) {
      const o = Array.from(owned.values()).find(x => x.batch.run?.step === 'upload' && x.batch.run.state === 'running');
      if (o) fail(o.batch.id, 'upload', `서허 업로드를 시작하지 못했어요: ${d.error || ''}`);
    }

    // 롯데: 운송장이 오면 다음 단계로. 예전 확장은 batchId를 안 보내서, 그때는 이 탭이 몰던 택배예약 건으로 본다.
    if (d.type === 'LOTTE_STATUS') {
      const o = d.batchId ? owned.get(d.batchId)
        : Array.from(owned.values()).find(x => x.batch.run?.step === 'lotte' && x.batch.run.state === 'running');
      if (!o) return;
      if (!o.lotteSavedAt) o.lotteSavedAt = d.savedAt;
      if (d.savedAt !== o.lotteSavedAt) return;
      if (d.waybills && d.waybills.length) onWaybills(o, d.waybills);
      else if (d.step === 'error') {
        fail(o.batch.id, 'lotte', `택배사 자동 진행이 멈췄어요: ${d.status || ''}`);
        waybillListeners.forEach(l => l(o.batch));
      } else if (d.status) setLive({ batchId: o.batch.id, text: `${o.batch.id} · 택배예약 · ${d.status}`, tone: 'info' });
    }

    // 서허 양식: 파일이 오면 채워서 올린다.
    if (d.type === 'SHUB_STATUS' && d.batchId) {
      const o = owned.get(d.batchId);
      if (!o || o.batch.run?.step !== 'form' || o.batch.run.state !== 'running') return;
      if (d.file && d.file.dataUrl) fillAndUpload(dataUrlToBuffer(d.file.dataUrl), d.batchId);
      else if (d.step === 'manual' || d.step === 'error') fail(d.batchId, 'form', `${d.status || '서허에서 양식을 받지 못했어요.'} 받은 양식이 있으면 "양식 직접 고르기"로 넣어 주세요.`);
      else if (d.status) setLive({ batchId: d.batchId, text: `${d.batchId} · 서허 양식 · ${d.status}`, tone: 'info', canPickForm: true });
    }

    // 서허 일괄등록: 결과 적기는 어느 탭이든 한다(같은 값을 적으므로 겹쳐도 괜찮다).
    if (d.type === 'SHUB_UPLOAD_STATUS' && d.batchId) {
      if (d.byOrder && typeof d.byOrder === 'object') applyShipmentNos(d.byOrder as Record<string, string>);
      const o = owned.get(d.batchId);
      const msgs = (d.messages || []).length ? ` · 서허: ${(d.messages as string[]).join(' / ')}` : '';
      if (d.step === 'done') {
        const ids = o ? itemsOf(d.batchId).map(i => i.id) : readShipOuts().filter(i => i.batchId === d.batchId).map(i => i.id);
        const fresh = readShipOuts().filter(i => ids.includes(i.id) && !i.uploadedAt).map(i => i.id);
        if (fresh.length) markShipOuts(fresh, { uploadedAt: Date.now() });
        if (o) {
          mark(d.batchId, 'done', 'done', `✅ 서허 일괄등록 끝 — 발송대기로 넘어가요. ${d.status || ''}`);
          owned.delete(d.batchId);
        }
      } else if (o && d.step === 'error') {
        fail(d.batchId, 'upload', `${d.status || '서허 일괄등록이 멈췄어요.'}${msgs}`);
      } else if (o && d.status) {
        setLive({ batchId: d.batchId, text: `${d.batchId} · 서허 일괄등록 · ${d.status}${msgs}`, tone: 'info' });
      }
    }
  });
  // 앱을 새로 열었을 때 그사이 끝난 서허 등록 결과를 받아 둔다.
  window.postMessage({ source: APP, type: 'SHUB_UPLOAD_GET' }, window.location.origin);
}
