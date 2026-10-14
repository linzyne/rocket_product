// 쉽먼트 자동 진행: 택배예약(롯데) → 운송장 받기 → 서허 양식 받기·채우기 → 서허 쉽먼트 일괄등록.
// 예전에는 이 순서가 쉽먼트생성 화면 안에만 있어서, 화면을 옮기거나 중간에 멈추면 어디까지 했는지 아무도 몰랐다
// (택배예약까지만 되고 일괄등록은 안 된 채로 끝난 일). 그래서 화면 밖(이 파일)으로 꺼내고, 단계가 바뀔 때마다
// 쉽먼트 기록(run)에 적는다. 멈추면 그 자리와 까닭이 남고, "이어서 하기"는 그 다음 단계부터 한다.
//
// 확장 소식은 앱의 모든 탭에 똑같이 간다. 두 탭이 함께 다음 단계를 밟으면 서허에 두 번 올라가므로,
// 다음 단계로 넘기는 일은 그 쉽먼트를 시작한(또는 이어서 하기를 누른) 탭만 한다(owned).
// 결과를 적는 일(등록 완료·쉽먼트 번호)은 어느 탭이 해도 같아서 다 한다.
import type { DisplayRow } from '../utils/dataProcessor';
import { shipmentCenters, totalBoxCount, parseBoxNo } from '../utils/dataProcessor';
import { exportLotteExcel } from '../utils/excelExport';
import { fillShubForm, dataUrlToBuffer } from '../utils/shubForm';
import { dateKeyYMD } from '../utils/dateUtils';
import type { AddressEntry, SenderInfo } from '../types';
import {
  ShipmentBatch, ShipmentRun, ShipmentRunStep, allBoxes, batchId as makeBatchId, waybillConfirmed, withOrdNos,
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
// batch: 이번에 진행할 박스만 남긴 기록 / full: 저장된 기록 전체(송장번호를 적을 때는 이걸 고쳐 저장한다.
// 남긴 박스만 저장하면 이미 끝난 센터의 박스가 기록에서 지워진다).
interface Owned { batch: ShipmentBatch; full: ShipmentBatch; itemIds: string[]; lotteSavedAt?: number }
const owned = new Map<string, Owned>();

const digits = (w: string) => String(w || '').replace(/\D/g, '');

// ── 서허 양식 보관 ──
// 한 번 받은 양식은 쉽먼트마다 보관해 두고, 이어서 하기에서 다시 받지 않는다(다운로드가 계속 쌓이던 일).
const FORM_KEY = (id: string) => `shubFormCache:${id}`;
const saveForm = (id: string, buf: ArrayBuffer) => {
  try {
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
    localStorage.setItem(FORM_KEY(id), btoa(bin));
  } catch (err) { /* 보관 못 해도 진행은 된다(다음에 다시 받을 뿐) */ }
};
const loadForm = (id: string): ArrayBuffer | null => {
  try {
    const b64 = localStorage.getItem(FORM_KEY(id));
    return b64 ? dataUrlToBuffer(`data:;base64,${b64}`) : null;
  } catch (err) { return null; }
};
const dropForm = (id: string) => { try { localStorage.removeItem(FORM_KEY(id)); } catch (err) { /* 없음 */ } };

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
// 이어서 하기로 일부 센터만 남겼으면 그 센터의 출고 건만이다(남긴 것만 등록했는데 다른 건까지 끝난 것으로 표시하면 안 된다).
const itemsOf = (id: string): ShipOut[] => {
  const o = owned.get(id);
  if (o) {
    const ids = new Set(o.itemIds);
    return readShipOuts().filter(i => ids.has(i.id));
  }
  return readShipOuts().filter(i => i.batchId === id);
};

// ── 1. 택배예약 ──
// 고른 출고 건들로 롯데 예약 엑셀을 만들고 확장이 ALPS에 올린다. 운송장이 오면 저절로 다음 단계로 간다.
export function startShipment(
  rows: DisplayRow[], itemIds: string[], addresses: AddressEntry[], sender: SenderInfo, batches: ShipmentBatch[],
): ShipmentBatch | null {
  if (!rows.length) return null;
  // 박스 번호가 없는 줄은 택배 예약·쉽먼트 기록에서 조용히 빠진다(그래서 고른 발주서 중 일부만 올라간 일).
  // 하나라도 있으면 시작하지 않는다.
  const noBox = rows.filter(r => !r.isBlank && !parseBoxNo(r.쉼먼트));
  if (noBox.length) {
    alert(`박스를 안 고른 상품이 ${noBox.length}줄 있어서 시작하지 않았어요. 박스를 고른 뒤 다시 눌러 주세요.\n\n${noBox.slice(0, 10).map(r => `${r._발주번호} ${r.상품이름}`).join('\n')}${noBox.length > 10 ? '\n…' : ''}`);
    return null;
  }
  const id = makeBatchId(batches);
  const file = exportLotteExcel(rows, addresses, sender, id);
  if (!file) return null;
  // 무엇이 몇 박스로 예약되는지 보여 주고 묻는다(고른 것과 다르면 여기서 멈출 수 있게).
  const plan = shipmentCenters(rows).flatMap(c => c.boxes.map(b =>
    `  ${c.center} 박스${b.boxNo}: ${Array.from(new Set(b.lines.map(l => l.발주번호))).join(', ')}`));
  const orderCount = new Set(rows.filter(r => !r.isBlank).map(r => r._발주번호)).size;
  if (!confirm(`${file.name}을 내려받았어요.\n\n발주서 ${orderCount}건 · 택배 ${plan.length}박스\n${plan.join('\n')}\n\n택배 예약 → 운송장 → 서허 양식 → 서허 일괄등록까지 이어서 할까요?`)) return null;

  const batch: ShipmentBatch = withOrdNos({
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
  });
  saveShipmentBatch(batch).catch(err => alert(`쉽먼트 기록 저장 실패: ${err instanceof Error ? err.message : String(err)}`));
  markShipOuts(itemIds, { batchId: id });
  owned.set(id, { batch, full: batch, itemIds });
  setLive({ batchId: id, text: `${id} · 택배예약 · 택배사 창 여는 중…`, tone: 'info' });
  window.postMessage({ source: APP, type: 'LOTTE_UPLOAD', file, boxCount: totalBoxCount(rows), batchId: id }, window.location.origin);
  return batch;
}

// 송장번호를 박스에 적는다. 주문번호(ordNo)로 짝을 찾고, 기록 전체(full)를 고쳐 저장한다.
const saveWaybills = (o: Owned, byOrd: Map<string, string>) => {
  const fix = (b: ShipmentBatch): ShipmentBatch => ({
    ...b,
    centers: b.centers.map(c => ({
      ...c,
      boxes: c.boxes.map(x => {
        const w = x.ordNo ? byOrd.get(x.ordNo) : undefined;
        return w ? { ...x, waybill: w, waybillOk: w } : x;
      }),
    })),
  });
  o.batch = fix(o.batch);
  o.full = { ...fix(o.full), status: 'waybilled' };
  saveShipmentBatch(o.full).catch(err => console.error('송장번호 저장 실패:', err));
};

// 롯데에서 송장번호가 왔을 때. 확장은 롯데 목록의 우리 주문번호 줄을 두 번 조회해 같았던 번호만 보낸다.
// 그 번호가 그 박스의 진짜 송장번호다. 박스에 다른 번호가 적혀 있었으면 롯데 번호로 바꾸고 바꿨다고 알린다.
// 박스 하나라도 짝이 안 맞으면 아무것도 넣지 않는다(틀린 번호가 서허에 올라가면 안 된다).
const onWaybills = (o: Owned, list: { waybill: string; receiver: string; ordNo?: string }[]) => {
  const batch = o.batch;
  const boxes = allBoxes(batch);
  const byOrd = new Map<string, string>();
  const recvOf = new Map<string, string>();
  const twice = new Set<string>();
  for (const w of list) {
    const n = digits(w.waybill);
    if (!w.ordNo || n.length !== 12) continue;
    if (byOrd.has(w.ordNo) && byOrd.get(w.ordNo) !== n) twice.add(w.ordNo);
    byOrd.set(w.ordNo, n);
    if (w.receiver) recvOf.set(w.ordNo, String(w.receiver).replace(/\s+/g, ''));
  }
  // 롯데 줄의 받는사람(예약 엑셀에 센터 이름을 넣는다)이 박스 센터와 다르면 남의 박스 번호다(박스 순서가 어긋난 예전 기록 등).
  const centerOk = (b: { center: string; ordNo?: string }) => {
    const r = recvOf.get(b.ordNo || '');
    const c = b.center.replace(/\s+/g, '');
    return !r || !c || r === c || r.includes(c) || c.includes(r);
  };
  const wrongCenter = boxes.filter(b => b.ordNo && byOrd.has(b.ordNo) && !centerOk(b));
  if (wrongCenter.length) {
    fail(batch.id, 'waybill', `롯데 예약의 받는 곳이 박스 센터와 달라서 송장번호를 넣지 않았어요: ${wrongCenter.map(b => `${b.center} 박스 ↔ 롯데 ${b.ordNo}(${recvOf.get(b.ordNo!)})`).join(', ')}. 이 쉽먼트는 롯데에서 직접 확인해 주세요.`);
    return;
  }
  const missing = boxes.filter(b => !b.ordNo || !byOrd.has(b.ordNo) || twice.has(b.ordNo));
  const mineNums = boxes.map(b => byOrd.get(b.ordNo || '') || '');
  if (missing.length || new Set(mineNums).size !== mineNums.length) {
    fail(batch.id, 'waybill', `롯데에서 ${missing.length ? missing.map(b => `${b.center} 박스(${b.ordNo || '주문번호 없음'})`).join(', ') : '박스들'}의 송장번호를 확실히 확인하지 못해서 서허에 올리지 않았어요. "이어서 하기"를 누르면 롯데에서 다시 확인해요.`);
    return;
  }
  const changed = boxes.filter(b => digits(b.waybill) && digits(b.waybill) !== byOrd.get(b.ordNo!));
  saveWaybills(o, byOrd);
  const note = changed.length
    ? ` · 적혀 있던 번호가 롯데와 달라서 바꿨어요: ${changed.map(b => `${b.center} ${digits(b.waybill)} → ${byOrd.get(b.ordNo!)}`).join(', ')}`
    : '';
  mark(batch.id, 'form', 'running', `송장번호 ${boxes.length}건 롯데에서 확인함${note} → 서허 양식 준비 중…`);
  setTimeout(() => requestForm(batch.id), 800);
};

// ── 1-2. 롯데 이어서 하기 ──
// 송장번호가 비었거나 롯데 확인이 안 된 박스가 있으면, 그 박스들의 주문번호만 넘겨 롯데 운송장출력 화면부터 다시 한다
// (예약은 다시 올리지 않는다). 출력해서 번호를 받고, 목록을 두 번 조회해 같은 번호만 돌려받는다.
const requestLotte = (id: string) => {
  const o = owned.get(id);
  if (!o) return;
  const boxes = allBoxes(o.batch);
  const ordNos = boxes.map(b => b.ordNo || '');
  if (ordNos.some(n => !n)) {
    fail(id, 'waybill', '박스의 롯데 주문번호를 몰라서 롯데에서 확인할 수 없어요.');
    return;
  }
  o.lotteSavedAt = undefined;
  mark(id, 'waybill', 'running', `롯데에서 송장번호 받는 중… (${boxes.map(b => b.center).join(', ')})`);
  window.postMessage({ source: APP, type: 'LOTTE_RESUME', batchId: id, ordNos }, window.location.origin);
};

// ── 2. 서허 양식 받기 ──
const requestForm = (id: string, fresh = false) => {
  const o = owned.get(id);
  if (!o) return;
  const batch = o.batch;
  const kept = fresh ? null : loadForm(id);
  if (kept) {
    mark(id, 'form', 'running', '받아 둔 서허 양식으로 채우는 중…');
    fillAndUpload(kept, id, undefined, true);
    return;
  }
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
export function fillAndUpload(buf: ArrayBuffer, id: string, known?: ShipmentBatch, kept = false) {
  // 새로고침 뒤에는 이 탭이 몰던 기록이 없다. 넘겨받은 쉽먼트 기록으로 이어서 할 수 있게 한다.
  if (!owned.get(id) && known) {
    const full = withOrdNos(known);
    owned.set(id, { batch: full, full, itemIds: readShipOuts().filter(i => i.batchId === id && !shipOutUploaded(i)).map(i => i.id) });
  }
  const o = owned.get(id);
  if (!o) { alert('이 쉽먼트 기록을 찾지 못했어요. 카드의 "이어서 하기"를 먼저 눌러 주세요.'); return; }
  const batch = o.batch;
  if (!kept) saveForm(id, buf);
  // 롯데에서 확인한 송장번호가 아니면 절대 양식에 넣지 않는다. 롯데에서 먼저 받아 온 뒤 이 양식으로 이어서 한다.
  if (!allBoxes(batch).every(waybillConfirmed)) {
    requestLotte(id);
    return;
  }
  try {
    const res = fillShubForm(buf, batch);
    // 짝 못 찾은 줄이 있으면 올리지 않는다(빠진 채로 등록되면 안 된다).
    if (res.missed.length) {
      // 받아 둔 양식에 이번 발주서가 없으면(양식을 받은 뒤 발주서가 바뀜) 버리고 새로 받는다.
      if (kept && res.missed.some(m => m.includes('서허 양식에 이 발주서가 없음'))) {
        dropForm(id);
        requestForm(id, true);
        return;
      }
      // 사람이 확인할 수 있게 이때만 채운 양식을 다운로드 폴더에 남긴다.
      const a = document.createElement('a');
      a.href = URL.createObjectURL(res.blob);
      a.download = res.fileName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      fail(id, 'form', `서허 양식에서 이 발주서 ${res.missed.length}줄의 짝을 못 찾아서 올리지 않았어요: ${res.missed.slice(0, 3).join(' / ')}. 채운 양식(${res.fileName})을 다운로드 폴더에 남겼어요.`);
      return;
    }
    markShipOuts(itemsOf(id).map(i => i.id), { formSavedAt: Date.now() });
    upload(res.blob, res.fileName, id);
  } catch (err) {
    dropForm(id);
    fail(id, 'form', `서허 양식을 채우지 못했어요(${err instanceof Error ? err.message : String(err)}). "이어서 하기"를 누르면 양식을 새로 받아요.`);
  }
}

const uploadAck = new Map<string, ReturnType<typeof setTimeout>>();
const clearUploadAck = (id?: string) => {
  const ids = id ? [id] : Array.from(uploadAck.keys());
  ids.forEach(k => { const t = uploadAck.get(k); if (t) clearTimeout(t); uploadAck.delete(k); });
};
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
    // 확장이 10초 안에 아무 대답이 없으면 멈춘 것으로 알린다(예전엔 "올리는 중"에서 말없이 멈췄다).
    uploadAck.set(id, setTimeout(() => {
      uploadAck.delete(id);
      fail(id, 'upload', '확장이 대답하지 않아요. chrome://extensions 에서 "로켓 서허 연동"을 새로고침(↻)하고 앱도 새로고침한 뒤 "이어서 하기"를 눌러 주세요.');
    }, 10000));
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
  const full = withOrdNos(batch);
  // 누른 카드 하나가 아니라 이 쉽먼트에 든 출고 건 중 아직 서허에 안 올린 것을 모두 이어서 한다
  // (센터 두 곳을 같이 예약했는데 카드 하나만 이어서 해서 한 센터가 빠진 일).
  const byId = new Map<string, ShipOut>();
  [...items, ...readShipOuts().filter(i => i.batchId === batch.id)].forEach(i => byId.set(i.id, i));
  const all = Array.from(byId.values());
  const left = all.filter(i => !shipOutUploaded(i));
  if (all.length && !left.length) {
    owned.set(batch.id, { batch: full, full, itemIds: [] });
    mark(batch.id, 'done', 'done', '서허 일괄등록까지 이미 끝난 건이에요.');
    return 'done';
  }
  const mine = new Set(left.flatMap(i => i.lines.map(l => String(l.발주번호 || '').trim())));
  const trimmed: ShipmentBatch = !left.length ? full : {
    ...full,
    centers: full.centers
      .map(c => ({ ...c, boxes: c.boxes.map(b => ({ ...b, lines: b.lines.filter(l => mine.has(String(l.발주번호 || '').trim())) })).filter(b => b.lines.length) }))
      .filter(c => c.boxes.length),
  };
  owned.set(batch.id, { batch: trimmed, full, itemIds: left.map(i => i.id) });
  if (!allBoxes(trimmed).length) {
    fail(batch.id, 'waybill', '이 건의 박스를 쉽먼트 기록에서 찾지 못했어요.');
    return 'need-waybill';
  }
  // 송장번호가 비었거나 롯데에서 확인한 번호가 아니면 롯데에서 받아 온다(사람이 번호를 넣지 않아도 된다).
  if (!allBoxes(trimmed).every(waybillConfirmed)) requestLotte(batch.id);
  else requestForm(batch.id);
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
    if (d.type === 'LOTTE_RESUME_ACK' && !d.ok) {
      const o = Array.from(owned.values()).find(x => x.batch.run?.step === 'waybill' && x.batch.run.state === 'running');
      if (o) fail(o.batch.id, 'waybill', `롯데 창을 열지 못했어요. chrome://extensions 에서 "로켓 서허 연동"을 새로고침(↻)한 뒤 "이어서 하기"를 눌러 주세요. (${d.error || ''})`);
    }
    if (d.type === 'SHUB_FORM_ACK' && !d.ok) {
      const o = Array.from(owned.values()).find(x => x.batch.run?.step === 'form' && x.batch.run.state === 'running');
      if (o) fail(o.batch.id, 'form', `서허 창을 열지 못했어요: ${d.error || ''}`);
    }
    if (d.type === 'SHUB_UPLOAD_ACK') clearUploadAck();
    if (d.type === 'SHUB_UPLOAD_STATUS' && d.batchId) clearUploadAck(d.batchId);
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
      else if (d.step === 'error' || d.step === 'manual') {
        // manual이어도 확장은 롯데 화면을 계속 지켜보다가 번호가 나오면 보내 준다. 여기서는 멈춘 까닭만 카드에 남긴다.
        const step: ShipmentRunStep = o.batch.run?.step === 'waybill' ? 'waybill' : 'lotte';
        const msg = `롯데: ${d.status || '진행이 멈췄어요.'}`;
        if (o.batch.run?.message !== msg) fail(o.batch.id, step, msg);
      } else if (d.status) setLive({ batchId: o.batch.id, text: `${o.batch.id} · 롯데 · ${d.status}`, tone: 'info' });
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
        // 등록한 출고 건만 끝으로 표시한다. 이 탭이 몬 건이 아니면 무엇을 올렸는지 모르니, 발주서별 쉽먼트 번호(위)로만 남긴다.
        const ids = o ? itemsOf(d.batchId).map(i => i.id) : [];
        const fresh = readShipOuts().filter(i => ids.includes(i.id) && !i.uploadedAt).map(i => i.id);
        if (fresh.length) markShipOuts(fresh, { uploadedAt: Date.now() });
        if (o) {
          dropForm(d.batchId);
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
