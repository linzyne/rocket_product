import React, { useEffect, useState } from 'react';
import { loadLocalPoCursor, subscribePoCursor, setPoCursor } from './data/poCursorStore';

// 서허 발주서 목록에서 새 발주서만 골라 업로드 양식을 받아오는 단추(확장 rocket-hub-extension의 po.js).
// 기준 발주번호는 클라우드에 있어서 어느 컴퓨터에서 받아도 이어진다. 그 번호 위로 쌓인 발주서만
// 받고, 직접 고쳐 넣을 수도 있다.
// 기준번호는 양식을 실제로 받았을 때만, 그때 받은 것 중 맨 위 번호로 바뀐다. 받지 못하면 그대로 둬서
// 다음에 다시 새 발주서로 잡힌다. 새 발주서가 없으면 알림으로 알려준다.
const APP_SOURCE = 'rocket-app-hub';
const EXT_SOURCE = 'rocket-hub-extension';
// 확장이 보내준 파일(dataUrl)을 업로드한 것과 같은 File로 바꾼다.
const toFile = (name: string, dataUrl: string) => {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name || '발주서.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
};

// runToken이 바뀌면 단추를 누른 것처럼 시작하고, 끝나면 onFinish로 알린다(수집 화면이 차례로 돌릴 때).
const CollectPurchaseOrders: React.FC<{
  onFile: (file: File) => void;
  style?: React.CSSProperties;
  runToken?: number;
  onFinish?: (ok: boolean, message: string) => void;
}> = ({ onFile, style, runToken, onFinish }) => {
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [lastOrderNo, setLastOrderNo] = useState(loadLocalPoCursor);
  // 다른 컴퓨터에서 받아 기준번호가 바뀌면 여기도 따라 바뀐다(내가 고치는 중이면 건드리지 않는다).
  const editingRef = React.useRef(false);
  const onFileRef = React.useRef(onFile);
  onFileRef.current = onFile;
  // 같은 파일 소식이 두 번 와도 한 번만 반영한다.
  const takenRef = React.useRef('');
  const finishRef = React.useRef(onFinish);
  finishRef.current = onFinish;
  const doneRef = React.useRef((ok: boolean, message: string) => {});
  doneRef.current = (ok, message) => finishRef.current && finishRef.current(ok, message);

  useEffect(() => subscribePoCursor(no => { if (!editingRef.current) setLastOrderNo(no); }), []);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window) return;
      const d = event.data;
      if (!d || d.source !== EXT_SOURCE) return;
      if (d.type === 'PO_COLLECT_ACK' && !d.ok) {
        setRunning(false);
        setStatus('');
        doneRef.current(false, `시작하지 못했어요: ${d.error || ''}`);
        alert(`발주서 가져오기를 시작하지 못했어요: ${d.error || ''}`);
      }
      if (d.type !== 'PO_STATUS') return;
      if (d.status) setStatus(d.status);
      if (d.step === 'empty') {
        setRunning(false);
        setStatus('');
        // 받은 게 없으므로 기준번호는 그대로 둔다.
        doneRef.current(true, '새 발주서가 없어요');
        alert('새로 들어온 발주서가 없어요.');
        return;
      }
      if (d.step === 'error') {
        setRunning(false);
        setStatus('');
        doneRef.current(false, d.status || '');
        alert(`발주서 가져오기 실패: ${d.status || ''}`);
        return;
      }
      if (d.step === 'file' && d.file && d.file.dataUrl) {
        const stamp = `${d.savedAt}|${d.file.name}`;
        if (takenRef.current === stamp) return;
        takenRef.current = stamp;
        setRunning(false);
        setStatus('');
        try {
          onFileRef.current(toFile(d.file.name, d.file.dataUrl));
          if (d.topOrderNo) {
            setLastOrderNo(d.topOrderNo);
            setPoCursor(d.topOrderNo).catch(err => alert(`기준 발주번호 저장 실패: ${err?.message || err}`));
          }
          doneRef.current(true, `발주서 ${d.count || 0}건 받음`);
        } catch (err: any) {
          doneRef.current(false, String(err?.message || err));
          alert(`받은 발주서를 읽지 못했어요: ${err?.message || err}`);
        }
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // 소식이 한참 없으면 단추를 풀어 준다(서허 로그인이 풀린 경우 등).
  useEffect(() => {
    if (!running) return;
    const t = setTimeout(() => {
      setRunning(false);
      setStatus('');
      doneRef.current(false, '끝나지 않았어요(서허 로그인 확인)');
      alert('발주서 가져오기가 끝나지 않았어요. 서허(supplier.coupang.com)에 로그인돼 있는지 확인해 주세요.');
    }, 3 * 60 * 1000);
    return () => clearTimeout(t);
  }, [running, status]);

  // 수집 화면이 차례로 돌릴 때: runToken이 바뀌면 시작한다.
  useEffect(() => {
    if (runToken) start();
  }, [runToken]);

  const start = () => {
    setRunning(true);
    setStatus('서허 여는 중…');
    window.postMessage({ source: APP_SOURCE, type: 'PO_COLLECT', lastOrderNo }, window.location.origin);
  };

  // 사장님이 직접 적은 기준 발주번호. 숫자만 남긴다(비우면 첫 페이지를 통째로 받는다).
  // 다 적고 칸을 벗어날 때 클라우드에 올린다(한 글자마다 올리지 않게).
  const editLast = (value: string) => {
    editingRef.current = true;
    setLastOrderNo(value.replace(/[^\d]/g, ''));
  };
  const commitLast = () => {
    if (!editingRef.current) return;
    editingRef.current = false;
    setPoCursor(lastOrderNo).catch(err => alert(`기준 발주번호 저장 실패: ${err?.message || err}`));
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, ...style }}>
      {status && <span style={{ fontSize: 11, color: '#2563eb' }}>{status}</span>}
      <span style={{ fontSize: 12, color: '#64748b', display: 'flex', alignItems: 'center', gap: 6 }}>
        마지막 받은 발주번호
        <input
          value={lastOrderNo}
          onChange={e => editLast(e.target.value)}
          onBlur={commitLast}
          placeholder="비우면 첫 페이지 전부"
          disabled={running}
          title="이 번호 위로 쌓인 발주서만 받아옵니다. 양식을 받으면 그때 받은 것 중 맨 위 번호로 바뀌고, 다른 컴퓨터에도 같이 반영돼요."
          style={{ width: 130, padding: '5px 8px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12, fontFamily: 'ui-monospace, monospace' }}
        />
      </span>
      <button
        onClick={start}
        disabled={running}
        title="확장이 서허 발주서 목록을 열어, 지난번에 받은 발주서 위쪽만 골라 업로드 양식을 받아옵니다"
        style={{
          padding: '9px 14px', borderRadius: 8, border: '1px solid #2563eb',
          background: running ? '#93b4f5' : '#2563eb', color: '#fff', fontSize: 13, fontWeight: 600,
          cursor: running ? 'default' : 'pointer', whiteSpace: 'nowrap',
        }}
      >
        {running ? '가져오는 중…' : '서허에서 새 발주서 가져오기'}
      </button>
    </div>
  );
};

export default CollectPurchaseOrders;
