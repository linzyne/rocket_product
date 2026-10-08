// 발주확정 올리기: 발주확정 상자의 발주서들로 PO_FOR_CONFIRM 파일을 채워 확장(po-confirm.js)이 서허에 올리게 하고,
// 다 올라가면 그 발주서들을 "확정됨"으로 표시한다. 확정수량을 0으로 한 상품 줄은 발주확인에서 빼고(보낼 게 없으므로),
// 줄인 줄은 수량을 바꾼다.
// 진행 중인 일은 localStorage에 남겨서, 화면을 옮기거나 새로고침해도 결과가 오면 마저 적는다.
import { buildConfirmFile, readDraft } from './poFormStore';
import { setConfirmed } from './poConfirmStore';
import { readWork, writeWork } from './orderWorkCloud';
import { markIntentional, linesReady } from './lineStore';

const APP = 'rocket-app-hub';
const EXT = 'rocket-hub-extension';
const JOB_KEY = 'coupangPoConfirmJob';

export interface ConfirmJob { jobId: string; orderNos: string[]; at: number; step: string; status: string; messages?: string[] }

const readJob = (): ConfirmJob | null => {
  try { return JSON.parse(localStorage.getItem(JOB_KEY) || 'null'); } catch { return null; }
};
const listeners = new Set<(j: ConfirmJob | null) => void>();
const setJob = (j: ConfirmJob | null) => {
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

// 발주확정 파일을 만들어 내려받고(기록용) 서허에 올린다. 만든 파일 정보를 돌려준다(양식 없는 발주서 알림용).
export function startConfirmUpload(orderNos: string[]) {
  const file = buildConfirmFile(orderNos);
  if (!file) return null;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file.blob);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  const jobId = String(Date.now());
  setJob({ jobId, orderNos: file.orderNos, at: Date.now(), step: 'start', status: '서허 여는 중…' });
  window.postMessage({
    source: APP, type: 'PO_CONFIRM_UPLOAD', jobId,
    file: { name: file.name, dataUrl: file.dataUrl }, orderNos: file.orderNos,
  }, window.location.origin);
  return file;
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

let started = false;
export function startConfirmRunner() {
  if (started) return;
  started = true;
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window) return;
    const d = event.data;
    if (!d || d.source !== EXT) return;
    const job = readJob();
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
        .then(() => setJob({ ...next, step: 'applied', status: `${next.status} → 발주 ${next.orderNos.length}건을 묶음 상자로 넘겼어요.` }))
        .catch(err => setJob({ ...next, step: 'error', status: `서허에는 올렸는데 앱에 표시하지 못했어요: ${err instanceof Error ? err.message : String(err)}` }));
    }
  });
  // 앱을 새로 열었을 때 그사이 끝난 결과를 받는다.
  window.postMessage({ source: APP, type: 'PO_CONFIRM_GET' }, window.location.origin);
}
