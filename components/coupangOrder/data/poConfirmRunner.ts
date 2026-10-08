// 발주확정 올리기: 새발주서 칸의 발주서들로 PO_FOR_CONFIRM 파일을 채워 확장(po-confirm.js)이 서허에 올리게 하고,
// 다 올라가면 그 발주서들을 "확정됨"으로 표시한다. 확정수량을 0으로 한 상품 줄은 발주확인에서 빼고(보낼 게 없으므로),
// 줄인 줄은 수량을 바꾼다.
// 진행 중인 일은 localStorage에 남겨서, 화면을 옮기거나 새로고침해도 결과가 오면 마저 적는다.
import { buildConfirmFile, readDraft, hasForm, savePoForm } from './poFormStore';
import { setConfirmed } from './poConfirmStore';
import { readWork, writeWork } from './orderWorkCloud';
import { markIntentional, linesReady } from './lineStore';

const APP = 'rocket-app-hub';
const EXT = 'rocket-hub-extension';
const JOB_KEY = 'coupangPoConfirmJob';

export interface ConfirmJob { jobId: string; orderNos: string[]; at: number; step: string; status: string; messages?: string[]; updatedAt?: number }

// 확장이 요청을 받았다는 대답(ACK)이 5초 안에 안 오면, 확장이 꺼졌거나 새로고침 전의 옛 버전이다.
let ackTimer: ReturnType<typeof setTimeout> | null = null;
const NO_EXT = '확장 프로그램이 대답하지 않아요. 크롬 주소창에 chrome://extensions 를 열어 "로켓 서허 연동"의 새로고침(↻)을 누르고, 이 화면도 새로고침한 뒤 다시 눌러 주세요.';
const waitAck = () => {
  if (ackTimer) clearTimeout(ackTimer);
  ackTimer = setTimeout(() => {
    ackTimer = null;
    const j = readJob();
    if (j && ['fetching', 'start'].includes(j.step)) setJob({ ...j, step: 'error', status: NO_EXT });
  }, 5000);
};
const gotAck = () => { if (ackTimer) { clearTimeout(ackTimer); ackTimer = null; } };

const readJob = (): ConfirmJob | null => {
  try { return JSON.parse(localStorage.getItem(JOB_KEY) || 'null'); } catch { return null; }
};
const listeners = new Set<(j: ConfirmJob | null) => void>();
const setJob = (j: ConfirmJob | null) => {
  if (j) j = { ...j, updatedAt: Date.now() };
  try {
    if (j) localStorage.setItem(JOB_KEY, JSON.stringify(j));
    else localStorage.removeItem(JOB_KEY);
  } catch {}
  listeners.forEach(l => l(j));
};
export const subscribeConfirmJob = (cb: (j: ConfirmJob | null) => void) => {
  cb(readJob());
  listeners.add(cb);
  return () => { listeners.delete(cb); };
};
export const clearConfirmJob = () => setJob(null);

// 발주확정 올리기. 앱에 양식이 없는 발주서(이 기능 전에 받은 것 등)가 있으면 먼저 서허에서 그 발주서 양식을
// 다시 받아 오고 나서 올린다.
export function startConfirmUpload(orderNos: string[]) {
  const missing = orderNos.filter(no => !hasForm(no));
  if (!missing.length) { upload(orderNos); return; }
  setJob({ jobId: String(Date.now()), orderNos, at: Date.now(), step: 'fetching', status: `서허에서 발주서 ${missing.length}건 양식 받는 중…` });
  window.postMessage({ source: APP, type: 'PO_COLLECT', purpose: 'form', orderNos: missing, lastOrderNo: '' }, window.location.origin);
  waitAck();
}

// 발주확정 파일을 만들어 내려받고(기록용) 서허에 올린다.
function upload(orderNos: string[]) {
  const file = buildConfirmFile(orderNos);
  if (!file) {
    setJob({ jobId: String(Date.now()), orderNos, at: Date.now(), step: 'error', status: '발주확정 양식을 만들지 못했어요(양식을 못 받았어요).' });
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file.blob);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  const jobId = String(Date.now());
  setJob({
    jobId, orderNos: file.orderNos, at: Date.now(), step: 'start',
    status: file.missing.length ? `서허 여는 중… (양식을 못 받은 발주서 ${file.missing.join(', ')}는 빠졌어요)` : '서허 여는 중…',
  });
  window.postMessage({
    source: APP, type: 'PO_CONFIRM_UPLOAD', jobId,
    file: { name: file.name, dataUrl: file.dataUrl }, orderNos: file.orderNos,
  }, window.location.origin);
  waitAck();
}

// 올라간 뒤: 확정 표시, 0개로 한 줄은 빼고, 줄인 줄은 수량을 바꾼다.
async function finish(job: ConfirmJob) {
  await linesReady();
  const want = new Set(job.orderNos);
  const work = readWork();
  const gone: Record<string, unknown>[] = [];
  const rows = work.rows.flatMap(r => {
    const no = String(r.발주번호 ?? '').trim();
    if (!want.has(no)) return [r];
    const d = readDraft(no);
    const name = String(r.상품이름 ?? '').trim();
    if (d.qty[name] == null || d.qty[name] === Number(r.확정수량)) return [r];
    gone.push(r);
    return d.qty[name] > 0 ? [{ ...r, 확정수량: d.qty[name] }] : [];
  });
  // 바꾸거나 뺀 줄은 사람이 일부러 한 일이다(지킴이가 되살리지 않게).
  if (gone.length) {
    markIntentional(gone);
    writeWork({ ...work, rows });
  }
  await setConfirmed(job.orderNos, true);
}

// 3분 넘게 아무 소식이 없으면 멈춘 것으로 본다(서허 창을 닫았거나 확장이 멈춤).
const STALE_MS = 3 * 60 * 1000;
const checkStale = () => {
  const j = readJob();
  if (!j || ['applied', 'error', 'done'].includes(j.step)) return;
  if (Date.now() - (j.updatedAt || j.at) > STALE_MS) {
    setJob({ ...j, step: 'error', status: `3분 넘게 서허에서 소식이 없어요(마지막: ${j.status}). 서허 창을 확인하거나, 닫고 다시 눌러 주세요.` });
  }
};

let started = false;
export function startConfirmRunner() {
  if (started) return;
  started = true;
  checkStale();
  setInterval(checkStale, 20 * 1000);
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window) return;
    const d = event.data;
    if (!d || d.source !== EXT) return;
    if (d.type === 'PO_COLLECT_ACK' || d.type === 'PO_CONFIRM_ACK' || d.type === 'PO_STATUS' || d.type === 'PO_CONFIRM_STATUS') gotAck();
    const job = readJob();
    // 양식 다시 받기(새 주문 수집과 같은 길, purpose = 'form')
    if (job && job.step === 'fetching') {
      if (d.type === 'PO_COLLECT_ACK' && !d.ok) {
        setJob({ ...job, step: 'error', status: `서허에서 양식을 받지 못했어요: ${d.error || ''} ("로켓 서허 연동" 확장을 새로고침해 주세요)` });
        return;
      }
      // 옛 확장은 "이 발주번호들만"을 몰라서 평소 새 주문 수집을 해 버린다(purpose 없이 소식이 온다).
      if (d.type === 'PO_STATUS' && d.purpose !== 'form') {
        setJob({ ...job, step: 'error', status: `확장 프로그램이 옛 버전이에요(양식 대신 새 주문 수집을 했어요). ${NO_EXT}` });
        return;
      }
      if (d.type === 'PO_STATUS' && d.purpose === 'form') {
        if (d.step === 'error' || d.step === 'empty') {
          setJob({ ...job, step: 'error', status: `서허에서 양식을 받지 못했어요: ${d.status || ''}` });
          return;
        }
        if (d.step === 'file' && d.file && d.file.dataUrl) {
          const bin = atob(String(d.file.dataUrl).split(',')[1] || '');
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          savePoForm(new File([bytes], d.file.name || 'PO_FOR_CONFIRM.xlsx'))
            .then(() => upload(job.orderNos))
            .catch(err => setJob({ ...job, step: 'error', status: `받은 양식을 읽지 못했어요: ${err instanceof Error ? err.message : String(err)}` }));
          setJob({ ...job, step: 'fetched', status: '양식을 받았어요. 채워서 올리는 중…' });
          return;
        }
        if (d.status) setJob({ ...job, status: `양식 받는 중 · ${d.status}` });
        return;
      }
    }
    if (!job || d.jobId !== job.jobId) return;
    if (d.type === 'PO_CONFIRM_ACK' && !d.ok) {
      setJob({ ...job, step: 'error', status: `서허 창을 열지 못했어요: ${d.error || ''} ("로켓 서허 연동" 확장을 새로고침해 주세요)` });
      return;
    }
    if (d.type !== 'PO_CONFIRM_STATUS') return;
    if (job.step === 'done' || job.step === 'applied') return;
    const next: ConfirmJob = { ...job, step: d.step, status: d.status || '', messages: d.messages || [] };
    setJob(next);
    if (d.step === 'done') {
      finish(next)
        .then(() => setJob({ ...next, step: 'applied', status: `${next.status} → 발주 ${next.orderNos.length}건을 발주확정 칸으로 넘겼어요.` }))
        .catch(err => setJob({ ...next, step: 'error', status: `서허에는 올렸는데 앱에 표시하지 못했어요: ${err instanceof Error ? err.message : String(err)}` }));
    }
  });
  // 앱을 새로 열었을 때 그사이 끝난 결과를 받는다.
  window.postMessage({ source: APP, type: 'PO_CONFIRM_GET' }, window.location.origin);
}
