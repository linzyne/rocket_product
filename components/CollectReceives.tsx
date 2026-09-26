import React, { useEffect, useState } from 'react';
import { ReceiveRow, saveReceives } from '../data/receiveStore';

// 서허 "입고상세내역"을 확장으로 가져오는 단추. 물류 > 물류창고입고와 로켓 > 입고가 같이 쓴다.
// 확장이 서허 화면을 열어 고른 날짜(기본 어제)로 검색하고, 페이지를 끝까지 넘기며 표를 모은 뒤
// 여기로 보내준다(rocket-hub-extension의 background.js·panel.js).
const APP_SOURCE = 'rocket-app-hub';
const EXT_SOURCE = 'rocket-hub-extension';

export type HubReceiveBucket = { items: Record<string, Omit<ReceiveRow, 'importedAt'>>; updatedAt?: number };

export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// 자동 수집의 기본 날짜. 어제 입고가 그날 저녁에 확정되므로 어제로 둔다.
export const yesterday = () => { const d = new Date(); d.setDate(d.getDate() - 1); return ymd(d); };

interface Props {
  // 확장 창에 모여 있는 표(아직 저장 전). 물류창고입고의 "확장에서 가져오기"가 쓴다.
  onBucket?: (bucket: HubReceiveBucket | null) => void;
  onExtReady?: (ready: boolean) => void;
  // 단추 줄 오른쪽에 더 붙일 것.
  children?: React.ReactNode;
  // runToken이 바뀌면 단추를 누른 것처럼 시작하고, 끝나면 onFinish로 알린다(수집 화면이 차례로 돌릴 때).
  runToken?: number;
  onFinish?: (ok: boolean, message: string) => void;
}

const CollectReceives: React.FC<Props> = ({ onBucket, onExtReady, children, runToken, onFinish }) => {
  const [autoDay, setAutoDay] = useState(yesterday);
  const [autoRequestedAt, setAutoRequestedAt] = useState<number | null>(null);
  const [autoStatus, setAutoStatus] = useState('');
  const autoRef = React.useRef<number | null>(null);
  autoRef.current = autoRequestedAt;
  // 아래 메시지 처리기는 한 번만 붙으므로, 고른 날짜는 ref로 본다.
  const autoDayRef = React.useRef(autoDay);
  autoDayRef.current = autoDay;
  const cbRef = React.useRef({ onBucket, onExtReady });
  cbRef.current = { onBucket, onExtReady };
  const finishRef = React.useRef(onFinish);
  finishRef.current = onFinish;
  const doneRef = React.useRef((ok: boolean, message: string) => {});
  doneRef.current = (ok, message) => finishRef.current && finishRef.current(ok, message);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window) return;
      const d = event.data;
      if (!d || d.source !== EXT_SOURCE) return;
      if (d.type === 'HUB_READY') {
        cbRef.current.onExtReady?.(true);
        window.postMessage({ source: APP_SOURCE, type: 'HUB_REQUEST' }, window.location.origin);
      }
      if (d.type === 'HUB_DATA') {
        cbRef.current.onExtReady?.(true);
        cbRef.current.onBucket?.((d.data && d.data.receiveDetail) || null);
      }
      if (d.type === 'RECEIVE_COLLECT_ACK') {
        if (!d.ok) { setAutoRequestedAt(null); setAutoStatus(''); doneRef.current(false, `시작하지 못했어요: ${d.error || ''}`); alert(`자동 수집을 시작하지 못했어요: ${d.error || ''}`); }
        else setAutoRequestedAt(d.requestedAt);
      }
      if (d.type === 'RECEIVE_AUTO' && d.run && autoRef.current && d.run.requestedAt === autoRef.current) {
        const run = d.run;
        if (run.error) {
          setAutoRequestedAt(null);
          setAutoStatus('');
          doneRef.current(false, run.error);
          alert(`자동 수집 실패: ${run.error}`);
        } else if (run.done && d.data) {
          const all: Omit<ReceiveRow, 'importedAt'>[] = Object.values((d.data.receiveDetail && d.data.receiveDetail.items) || {});
          // 확장이 고른 날짜로 검색했지만, 혹시 다른 날 줄이 섞이면 저장하지 않는다.
          const items = run.day ? all.filter(r => String(r.date || '').startsWith(run.day)) : all;
          const dropped = all.length - items.length;
          setAutoRequestedAt(null);
          setAutoStatus('저장하는 중…');
          saveReceives(items)
            .then(n => {
              const text = n
                ? `${run.day || autoDayRef.current} ${n}건 저장 완료${dropped ? ` (다른 날 ${dropped}건은 건너뜀)` : ''}`
                : `${run.day || autoDayRef.current} 입고된 내역이 없어요`;
              setAutoStatus(n ? `✅ ${text}` : text);
              doneRef.current(true, text);
            })
            .catch(err => { setAutoStatus(''); doneRef.current(false, String(err?.message || err)); alert(`가져오기 실패: ${err?.message || err}`); });
        } else {
          setAutoStatus(`서허에서 ${run.day || autoDayRef.current} 입고 내역 모으는 중…`);
        }
      }
    };
    // 서허 창에서 모으고 돌아왔을 때도 최신 값을 다시 받는다.
    const ask = () => window.postMessage({ source: APP_SOURCE, type: 'HUB_REQUEST' }, window.location.origin);
    window.addEventListener('message', onMessage);
    window.addEventListener('focus', ask);
    ask();
    return () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('focus', ask);
    };
  }, []);

  // 서허 로그인이 풀려 있으면 수집이 시작되지 못하므로, 너무 오래 걸리면 알려준다.
  useEffect(() => {
    if (autoRequestedAt == null) return;
    const t = setTimeout(() => {
      setAutoRequestedAt(null);
      setAutoStatus('');
      doneRef.current(false, '끝나지 않았어요(서허 로그인 확인)');
      alert('자동 수집이 끝나지 않았어요. 서허(supplier.coupang.com)에 로그인돼 있는지 확인해 주세요.');
    }, 3 * 60 * 1000);
    return () => clearTimeout(t);
  }, [autoRequestedAt]);

  const startAuto = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(autoDay)) { alert('가져올 날짜를 골라 주세요.'); return; }
    setAutoStatus(`서허 입고상세내역 여는 중… (${autoDay})`);
    setAutoRequestedAt(-1); // 확장이 요청 시각을 알려주기 전까지 버튼을 잠근다
    window.postMessage({ source: APP_SOURCE, type: 'RECEIVE_COLLECT', day: autoDay }, window.location.origin);
  };

  // 수집 화면이 차례로 돌릴 때: runToken이 바뀌면 시작한다.
  useEffect(() => {
    if (runToken) startAuto();
  }, [runToken]);

  return (
    <div className="flex items-center justify-end gap-3">
      {autoStatus && <div className="text-right text-xs text-blue-600">{autoStatus}</div>}
      <div className="flex items-center gap-1">
        <input
          type="date"
          value={autoDay}
          max={ymd(new Date())}
          onChange={e => setAutoDay(e.target.value)}
          disabled={autoRequestedAt != null}
          className="px-2 py-2 border border-gray-200 rounded-lg text-sm bg-white disabled:text-gray-400"
          title="가져올 입고 날짜"
        />
        <button
          onClick={() => setAutoDay(yesterday())}
          disabled={autoRequestedAt != null}
          className="px-2 py-2 rounded-lg border border-gray-200 text-gray-600 text-xs hover:bg-gray-50 disabled:text-gray-300"
          title="어제 날짜로 되돌리기"
        >
          어제
        </button>
      </div>
      <button
        onClick={startAuto}
        disabled={autoRequestedAt != null}
        className="px-3.5 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:bg-gray-300 whitespace-nowrap"
        title="확장이 서허 입고상세내역을 열어 고른 날짜로 검색해 모아 옵니다"
      >
        {autoRequestedAt != null ? '가져오는 중…' : '자동으로 가져오기'}
      </button>
      {children}
    </div>
  );
};

export default CollectReceives;
