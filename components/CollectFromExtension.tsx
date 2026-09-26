import React, { useEffect, useState } from 'react';
import { InventoryItem, importHubData } from '../data/inventoryStore';

// "로켓 서허 연동" 확장(rocket-hub-extension)에서 로켓센터 재고를 가져오는 단추.
// 로켓 > 로켓재고에서만 쓴다(수집은 한 곳에서만 하도록).
const APP_SOURCE = 'rocket-app-hub';
const EXT_SOURCE = 'rocket-hub-extension';

export const formatTime = (ms?: number) => (ms ? new Date(ms).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-');

// 확장이 적어둔 수집 자취를 다운로드 폴더에 파일로 저장한다. 수집이 안 될 때 이 파일만 넘기면
// 어디서 어긋났는지(어떤 주소로 몇 개를 받았는지까지) 다 들어 있어 따로 설명하지 않아도 된다.
const saveCollectLog = (log: unknown): string => {
  const d = new Date();
  const p2 = (n: number) => String(n).padStart(2, '0');
  const name = `로켓수집로그_${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.json`;
  const body = log ?? { note: '확장에 남은 수집 로그가 없습니다. 확장을 새로고침한 뒤 다시 수집해 주세요.' };
  const url = URL.createObjectURL(new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return name;
};

// runToken이 바뀌면 단추를 누른 것처럼 수집을 시작하고, 끝나면 onFinish로 알린다(수집 화면이 차례로 돌릴 때 쓴다).
const CollectFromExtension: React.FC<{ items: InventoryItem[]; runToken?: number; onFinish?: (ok: boolean, message: string) => void }> = ({ items, runToken, onFinish }) => {
  const [extReady, setExtReady] = useState(false);
  // 자동 수집: 확장이 광고 화면을 열어 모든 페이지를 모은 뒤 끝나면 바로 가져온다.
  const [autoRequestedAt, setAutoRequestedAt] = useState<number | null>(null);
  const [autoStatus, setAutoStatus] = useState('');
  // 확장에서 진행 소식이 올 때마다 올라간다(기다리는 시간을 다시 센다).
  const [autoTick, setAutoTick] = useState(0);
  const itemsRef = React.useRef<InventoryItem[]>([]);
  itemsRef.current = items;
  const autoRef = React.useRef<number | null>(null);
  autoRef.current = autoRequestedAt;
  // 로그를 달라고 한 까닭: 'fail'은 실패, 'warn'은 일부만 가져온 경우(둘 다 저절로 저장한다),
  // 'manual'은 사장님이 "수집 로그 저장"을 누른 것.
  const logAskRef = React.useRef<'fail' | 'warn' | 'manual' | null>(null);
  const failTextRef = React.useRef('');
  const finishRef = React.useRef(onFinish);
  finishRef.current = onFinish;
  const done = (ok: boolean, message: string) => finishRef.current && finishRef.current(ok, message);
  const doneRef = React.useRef(done);
  doneRef.current = done;

  // 확장 연결 확인과 자동 수집 진행 상황.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window) return;
      const d = event.data;
      if (!d || d.source !== EXT_SOURCE) return;
      if (d.type === 'HUB_READY') {
        setExtReady(true);
        window.postMessage({ source: APP_SOURCE, type: 'HUB_REQUEST' }, window.location.origin);
      }
      if (d.type === 'HUB_DATA') setExtReady(true);
      if (d.type === 'HUB_LOG') {
        const why = logAskRef.current;
        logAskRef.current = null;
        if (!why) return;
        const name = saveCollectLog(d.log);
        if (why === 'fail' || why === 'warn') {
          const head = why === 'fail' ? `자동 수집 실패: ${failTextRef.current}` : `일부만 가져왔어요: ${failTextRef.current}`;
          alert(`${head}\n\n무엇이 어긋났는지 적힌 로그를 다운로드 폴더에 저장했어요.\n${name}\n이 파일만 넘겨주시면 됩니다.`);
        } else {
          alert(`수집 로그를 다운로드 폴더에 저장했어요.\n${name}`);
        }
      }
      if (d.type === 'HUB_COLLECT_ACK') {
        if (!d.ok) { setAutoRequestedAt(null); setAutoStatus(''); doneRef.current(false, `시작하지 못했어요: ${d.error || ''}`); alert(`자동 수집을 시작하지 못했어요: ${d.error || ''}`); }
        else setAutoRequestedAt(d.requestedAt);
      }
      if (d.type === 'HUB_AUTO' && d.run && autoRef.current && d.run.requestedAt === autoRef.current) {
        const run = d.run;
        if (run.error) {
          setAutoRequestedAt(null);
          setAutoStatus(`❌ ${run.error}`);
          doneRef.current(false, run.error);
          // 실패한 까닭이 담긴 로그를 바로 파일로 받아 둔다(알림은 파일을 저장한 뒤 띄운다).
          failTextRef.current = run.error;
          logAskRef.current = 'fail';
          window.postMessage({ source: APP_SOURCE, type: 'HUB_LOG_REQUEST' }, window.location.origin);
        } else if (run.done && d.data) {
          setAutoRequestedAt(null);
          setAutoStatus('가져오는 중…');
          importHubData(d.data, itemsRef.current)
            .then(n => {
              setAutoStatus(run.warn ? `⚠️ ${n}개 반영 · ${run.warn}` : `✅ ${n}개 반영 완료`);
              doneRef.current(true, run.warn ? `${n}개 반영 · ${run.warn}` : `${n}개 반영 완료`);
              // 모자라게 가져온 경우에도 까닭이 담긴 로그를 바로 파일로 받아 둔다.
              if (run.warn) {
                failTextRef.current = run.warn;
                logAskRef.current = 'warn';
                window.postMessage({ source: APP_SOURCE, type: 'HUB_LOG_REQUEST' }, window.location.origin);
              }
            })
            .catch(err => { setAutoStatus(''); doneRef.current(false, String(err?.message || err)); alert(`가져오기 실패: ${err?.message || err}`); });
        } else {
          setAutoStatus(run.status || (run.step === 'noad' ? '광고하지 않는 상품 모으는 중…' : '광고 중인 상품 모으는 중…'));
          setAutoTick(t => t + 1);
        }
      }
    };
    window.addEventListener('message', onMessage);
    window.postMessage({ source: APP_SOURCE, type: 'HUB_REQUEST' }, window.location.origin);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // 로그인이 풀려 있으면 광고 화면에서 수집이 시작되지 못하므로, 소식이 한참 없으면 알려준다.
  // 상품이 많으면 오래 걸리기 때문에, 진행 소식이 올 때마다 시간을 다시 센다.
  useEffect(() => {
    if (autoRequestedAt == null) return;
    const t = setTimeout(() => {
      setAutoRequestedAt(null);
      setAutoStatus('');
      doneRef.current(false, '소식이 끊겼어요(로그인 확인)');
      alert('자동 수집 소식이 끊겼어요. 쿠팡 광고 사이트(advertising.coupang.com)에 로그인돼 있는지 확인해 주세요.');
    }, 3 * 60 * 1000);
    return () => clearTimeout(t);
  }, [autoRequestedAt, autoTick]);

  const lastCollectedAt = items.reduce((max, it) => Math.max(max, it.collectedAt || 0), 0);

  const saveLog = () => {
    logAskRef.current = 'manual';
    window.postMessage({ source: APP_SOURCE, type: 'HUB_LOG_REQUEST' }, window.location.origin);
  };

  const startAutoCollect = () => {
    setAutoStatus('광고 화면 여는 중…');
    setAutoRequestedAt(-1); // 확장이 요청 시각을 알려주기 전까지 버튼을 잠근다
    window.postMessage({ source: APP_SOURCE, type: 'HUB_COLLECT' }, window.location.origin);
  };

  // 수집 화면이 차례로 돌릴 때: runToken이 바뀌면 시작한다.
  useEffect(() => {
    if (!runToken) return;
    if (!extReady) { done(false, '확장이 연결되지 않았어요'); return; }
    startAutoCollect();
  }, [runToken]);

  return (
    <div className="flex items-center justify-end gap-3">
      <div className="text-right text-xs text-gray-500">
        {extReady
          ? <>마지막 수집 {formatTime(lastCollectedAt || undefined)}</>
          : <span className="text-amber-600">"로켓 서허 연동" 확장이 연결되지 않았어요</span>}
      </div>
      <div className="flex flex-col items-end gap-1">
        <button
          onClick={startAutoCollect}
          disabled={!extReady || autoRequestedAt != null}
          className="px-3.5 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:bg-gray-300 whitespace-nowrap"
          title="확장이 쿠팡 광고 화면을 열어 모든 페이지를 모은 뒤 바로 반영해요"
        >
          {autoRequestedAt != null ? '수집 중…' : '확장에서 가져오기'}
        </button>
        {autoStatus && <span className="text-xs text-blue-600">{autoStatus}</span>}
        <button
          onClick={saveLog}
          disabled={!extReady}
          className="text-xs text-gray-500 underline hover:text-gray-700 disabled:text-gray-300 disabled:no-underline"
          title="마지막 수집에서 확장이 적어둔 자취를 파일로 저장해요. 수집이 잘 안 될 때 이 파일을 넘겨주세요"
        >
          수집 로그 저장
        </button>
      </div>
    </div>
  );
};

export default CollectFromExtension;
