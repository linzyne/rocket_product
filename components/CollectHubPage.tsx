import React, { useEffect, useMemo, useState } from 'react';
import { InventoryItem, subscribeInventory, dateKey } from '../data/inventoryStore';
import { ReceiveRow, subscribeReceives } from '../data/receiveStore';
import CollectFromExtension, { formatTime } from './CollectFromExtension';
import CollectReceives from './CollectReceives';
import CollectPurchaseOrders from './coupangOrder/CollectPurchaseOrders';
import { appendOrderFile } from './coupangOrder/data/orderWorkStore';
import { subscribeReservations } from './coupangOrder/data/reservationStore';
import type { OrderRow } from './coupangOrder/types';

// 매일 > 수집. 날마다 하는 세 가지 수집(발주·입고·재고)을 한 화면에서 한다.
// "오늘 수집 다 하기"를 누르면 발주 → 입고 → 재고 차례로 돈다. 한꺼번에 돌리지 않는 까닭은
// 수집마다 창을 하나씩 열고 파일도 받기 때문이다(겹치면 서로 엉킨다).
//
// 자동 수집: 켜 두면 확장이 그 시각에 이 화면을 열어 깨운다(rocket-hub-extension의 background.js).
// 저절로 도는 동안에는 알림창을 띄우지 않고 카드에만 적는다(아무도 "확인"을 눌러줄 수 없으므로).
const APP_SOURCE = 'rocket-app-hub';
const EXT_SOURCE = 'rocket-hub-extension';
type StepId = 'po' | 'receive' | 'stock';
const STEPS: Array<{ id: StepId; title: string; desc: string }> = [
  { id: 'po', title: '발주', desc: '서허 발주리스트에서 새로 들어온 발주서를 받아 쿠팡발주확인에 쌓아요.' },
  { id: 'receive', title: '입고', desc: '서허 입고상세내역에서 고른 하루치를 받아요(기본 어제).' },
  { id: 'stock', title: '재고', desc: '쿠팡 광고 화면에서 지금 로켓센터 재고를 가져와요.' },
];

type StepState = { state: 'idle' | 'running' | 'ok' | 'fail'; message: string };
const IDLE: StepState = { state: 'idle', message: '' };

const CollectHubPage: React.FC = () => {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [receives, setReceives] = useState<ReceiveRow[]>([]);
  const [reservations, setReservations] = useState<OrderRow[]>([]);
  const [status, setStatus] = useState<Record<StepId, StepState>>({ po: IDLE, receive: IDLE, stock: IDLE });
  // 값이 바뀌면 그 수집이 시작된다(0이면 가만히 있는다).
  const [token, setToken] = useState<Record<StepId, number>>({ po: 0, receive: 0, stock: 0 });
  // 차례로 돌리는 중인지. 끝나면 다음 단계를 이어서 시작한다.
  const [chain, setChain] = useState<StepId[]>([]);
  // 자동 수집 설정(확장이 가지고 있다. 컴퓨터마다 따로다).
  const [auto, setAuto] = useState<{ on: boolean; time: string } | null>(null);
  const [autoNote, setAutoNote] = useState('');
  // 저절로 도는 중에는 알림창을 막고 여기에 모은다. 다 끝나면 quietRestore로 되살린다.
  const quietRef = React.useRef(false);
  const quietRestoreRef = React.useRef<null | (() => void)>(null);

  useEffect(() => subscribeInventory(setItems), []);
  useEffect(() => subscribeReceives(setReceives), []);
  useEffect(() => subscribeReservations(setReservations), []);

  const today = dateKey(Date.now());
  const lastCollectedAt = items.reduce((max, it) => Math.max(max, it.collectedAt || 0), 0);
  // 오늘 이미 한 수집. 두 번 해도 덮어쓰기라 탈은 없지만, 했는지 한눈에 보이게 표시한다.
  const stockToday = items.some(it => it.stockHistory?.[today] != null);
  const receiveDays = useMemo(() => new Set(receives.map(r => String(r.date || '').slice(0, 10))), [receives]);
  const yesterday = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return dateKey(d.getTime());
  }, []);

  // 확장에서 설정을 받아 오고, 그 시각이 되면 오는 신호(AUTO_COLLECT_NOW)를 듣는다.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window) return;
      const d = event.data;
      if (!d || d.source !== EXT_SOURCE) return;
      if (d.type === 'HUB_READY') window.postMessage({ source: APP_SOURCE, type: 'AUTO_COLLECT_GET' }, window.location.origin);
      if (d.type === 'AUTO_COLLECT_CONFIG') {
        setAuto({ on: !!(d.config && d.config.on), time: (d.config && d.config.time) || '09:00' });
      }
      if (d.type === 'AUTO_COLLECT_NOW') {
        window.postMessage({ source: APP_SOURCE, type: 'AUTO_COLLECT_TAKEN' }, window.location.origin);
        runAllRef.current(true);
      }
    };
    window.addEventListener('message', onMessage);
    window.postMessage({ source: APP_SOURCE, type: 'AUTO_COLLECT_GET' }, window.location.origin);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const saveAuto = (next: { on: boolean; time: string }) => {
    setAuto(next);
    setAutoNote('');
    window.postMessage({ source: APP_SOURCE, type: 'AUTO_COLLECT_SET', on: next.on, time: next.time }, window.location.origin);
  };

  const start = (id: StepId) => {
    setStatus(s => ({ ...s, [id]: { state: 'running', message: '' } }));
    setToken(t => ({ ...t, [id]: t[id] + 1 }));
  };

  const finish = (id: StepId) => (ok: boolean, message: string) => {
    setStatus(s => ({ ...s, [id]: { state: ok ? 'ok' : 'fail', message } }));
    // 차례로 돌리는 중이면 다음 것을 잇는다(실패해도 멈추지 않고 나머지를 한다).
    setChain(rest => {
      if (!rest.length || rest[0] !== id) return rest;
      const next = rest.slice(1);
      if (next.length) setTimeout(() => start(next[0]), 800);
      else if (quietRestoreRef.current) { quietRestoreRef.current(); quietRestoreRef.current = null; }
      return next;
    });
  };

  const runAll = (auto = false) => {
    const order: StepId[] = ['po', 'receive', 'stock'];
    setStatus({ po: IDLE, receive: IDLE, stock: IDLE });
    setChain(order);
    if (auto) {
      setAutoNote(`${new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}에 저절로 시작했어요`);
      // 저절로 도는 동안에는 알림창을 막는다(눌러줄 사람이 없어 수집이 거기서 멈춘다).
      if (!quietRef.current) {
        quietRef.current = true;
        const realAlert = window.alert;
        window.alert = (msg?: any) => setAutoNote(prev => `${prev}\n· ${String(msg)}`.trim());
        const restore = () => { window.alert = realAlert; quietRef.current = false; };
        quietRestoreRef.current = restore;
        // 어떤 까닭으로 끝나지 못해도 알림창은 되살린다.
        setTimeout(() => { if (quietRef.current) restore(); }, 15 * 60 * 1000);
      }
    }
    start(order[0]);
  };
  const runAllRef = React.useRef(runAll);
  runAllRef.current = runAll;

  const running = (Object.values(status) as StepState[]).some(s => s.state === 'running');

  const handleOrderFile = async (file: File) => {
    try {
      const { added, skipped } = await appendOrderFile(file, reservations);
      setStatus(s => ({ ...s, po: { state: 'ok', message: `${added}건 추가${skipped ? ` · 중복 ${skipped}건 제외` : ''}` } }));
    } catch (err: any) {
      setStatus(s => ({ ...s, po: { state: 'fail', message: String(err?.message || err) } }));
      alert(`발주서를 읽지 못했어요: ${err?.message || err}`);
    }
  };

  const badge = (id: StepId) => {
    const s = status[id];
    if (s.state === 'running') return <span className="text-xs text-blue-600">수집 중…</span>;
    if (s.state === 'ok') return <span className="text-xs text-emerald-600">✅ {s.message}</span>;
    if (s.state === 'fail') return <span className="text-xs text-red-500">❌ {s.message}</span>;
    return null;
  };

  // 오늘 했는지 한 줄 안내.
  const doneHint = (id: StepId) => {
    if (id === 'stock') return stockToday ? `오늘 수집함 · 마지막 ${formatTime(lastCollectedAt || undefined)}` : '오늘 아직 안 했어요';
    if (id === 'receive') return receiveDays.has(yesterday) ? `어제(${yesterday}) 받아 뒀어요` : `어제(${yesterday}) 아직 안 받았어요`;
    return '누르면 기준 발주번호 위쪽만 받아와요';
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 text-gray-800">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">수집</h1>
          <p className="text-sm text-gray-500">날마다 하는 세 가지를 여기서 다 해요. 서허와 쿠팡 광고 사이트에 로그인돼 있어야 해요.</p>
        </div>
        <button
          onClick={() => runAll()}
          disabled={running}
          className="px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 disabled:bg-gray-300"
          title="발주 → 입고 → 재고 차례로 다 가져옵니다"
        >
          {running ? '수집 중…' : '오늘 수집 다 하기'}
        </button>
      </div>

      <div className="space-y-3">
        {STEPS.map((step, i) => (
          <div key={step.id} className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-gray-100 text-gray-500 text-xs flex items-center justify-center font-semibold">{i + 1}</span>
                  <span className="font-semibold text-gray-900">{step.title}</span>
                  {badge(step.id)}
                </div>
                <p className="text-sm text-gray-500 mt-1.5">{step.desc}</p>
                <p className="text-xs text-gray-400 mt-0.5">{doneHint(step.id)}</p>
              </div>
              <div className="flex-shrink-0 flex items-center justify-end">
                {step.id === 'po' && (
                  <CollectPurchaseOrders onFile={handleOrderFile} runToken={token.po} onFinish={finish('po')} />
                )}
                {step.id === 'receive' && (
                  <CollectReceives runToken={token.receive} onFinish={finish('receive')} />
                )}
                {step.id === 'stock' && (
                  <CollectFromExtension items={items} runToken={token.stock} onFinish={finish('stock')} />
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 bg-white border border-gray-200 rounded-xl p-4">
        <label className="flex flex-wrap items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={!!auto?.on}
            disabled={!auto}
            onChange={e => auto && saveAuto({ ...auto, on: e.target.checked })}
            className="w-4 h-4"
          />
          매일
          <input
            type="time"
            value={auto?.time || '09:00'}
            disabled={!auto}
            onChange={e => auto && e.target.value && saveAuto({ ...auto, time: e.target.value })}
            className="px-2 py-1 border border-gray-200 rounded text-sm"
          />
          에 저절로 수집하기
          {!auto && <span className="text-xs text-amber-600">확장이 연결되지 않았어요</span>}
        </label>
        <p className="text-xs text-gray-400 mt-2">
          크롬이 켜져 있어야 해요. 그 시각이 되면 확장이 이 화면을 열어 수집을 시작합니다. 컴퓨터가 꺼져 있었으면
          다음에 크롬을 켰을 때 그날 몫을 한 번 합니다(하루 한 번).
        </p>
        {autoNote && <pre className="text-xs text-gray-500 mt-2 whitespace-pre-wrap font-sans">{autoNote}</pre>}
      </div>

      <p className="text-xs text-gray-400 mt-4">
        수집마다 창이 하나씩 열렸다 닫혀요. 다 끝날 때까지 그 창을 닫지 마세요. 하나가 실패해도 나머지는 이어서 합니다.
      </p>
    </div>
  );
};

export default CollectHubPage;
