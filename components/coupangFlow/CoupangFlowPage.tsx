import React, { useEffect, useMemo, useState } from 'react';
import { readWork, subscribeWork } from '../coupangOrder/data/orderWorkCloud';
import { subscribeReservations } from '../coupangOrder/data/reservationStore';
import { ShipOut, subscribeShipOuts, shipOutStage, shipOutBatch } from '../coupangOrder/data/shipOutStore';
import { ShipmentBatch, subscribeShipments } from '../../data/shipmentStore';
import { subscribeConfirmed, setConfirmed } from '../coupangOrder/data/poConfirmStore';
import { resumeShipment, onNeedWaybill, STEP_LABEL } from '../coupangOrder/data/shipmentRunner';
import ShipmentWaybillModal from '../coupangOrder/components/ShipmentWaybillModal';
import type { OrderRow } from '../coupangOrder/types';
import { dateKeyYMD, ymdSortKey } from '../coupangOrder/utils/dateUtils';
import type { AppMenuId } from '../AppSidebar';
import CollectPurchaseOrders from '../coupangOrder/CollectPurchaseOrders';
import { appendOrderFile } from '../coupangOrder/data/orderWorkStore';
import { printShipment, setPrinted } from '../coupangSend/printShipment';
import { useReady } from '../coupangOrder/data/readyStore';
import { useLineHanjung } from '../coupangOrder/data/useLineHanjung';
import { LineCheckMenu } from '../coupangOrder/components/OrderTable';
import { HanjungOrder, subscribeHanjung, productSummary, nameKey, makeHanjungOfficeLookup } from '../../data/hanjungStore';
import { HanjungQueueItem, subscribeHanjungQueue, makePlaceLookup } from '../coupangOrder/data/hanjungQueueStore';
import { subscribePoForms, readDraft, setDraftLine, SHORT_REASONS, DEFAULT_REASON } from '../coupangOrder/data/poFormStore';
import { startConfirmUpload, subscribeConfirmJob, clearConfirmJob, ConfirmJob } from '../coupangOrder/data/poConfirmRunner';
import { subscribeDateRequests, markDateRequested, applyCurrent, DateReq } from '../coupangOrder/data/poDateStore';
import { retargetBatches, saveShipmentBatch } from '../../data/shipmentStore';

// 발주 > 발주 진행. 단계마다 상자를 옆으로 두고, 발주서가 지금 단계의 상자 안에 담긴다(상자 안에서는 위아래 한 줄).
//   발주확정 → 묶음 → 쉽먼트(택배예약·서허 일괄등록) → 출력(문서·바코드) → 발송대기 → 발송완료
// 단계는 발주확인·예약·쉽먼트생성·발송대기 목록에서 그 발주서 줄이 어디 있는지로 계산한다.
// 한 발주서의 줄이 여러 단계에 나뉘어 있으면 가장 앞 단계의 상자에 두고 "일부만 넘어감"으로 알린다.

// 칸 이름: 1 새발주서(서허에 확정 올리기 전) → 2 발주확정(확정 끝, 쉽먼트 보내기 전) → 3 쉽먼트 → 4 출력 → 5 발송대기 → 6 발송완료
const STAGES = ['새발주서', '발주확정', '쉽먼트', '출력', '발송대기', '발송완료'] as const;
// 화면에 칸·탭으로 보여주는 단계. 새발주서는 "새 발주서" 창에서, 발송완료는 '발송완료' 메뉴에서 따로 본다.
const BOARD_STAGES: Stage[] = [1, 2, 4];
// 출력은 따로 칸을 두지 않는다(쉽먼트 칸 카드의 🖨 로 출력). 쉽먼트 끝났어도 출력 전이면 쉽먼트 칸에 둔다.
const SHOWN_STEPS: Stage[] = [0, 1, 2, 4, 5];
type Stage = 0 | 1 | 2 | 3 | 4 | 5;

const ORANGE = '#e67e22';
const GREEN = '#27ae60';
const RED = '#dc2626';
const GRAY = '#b8b8b8';

// 발송완료는 최근 2주만 본다(오래된 건은 발주서 검색에서 찾는다).
const SENT_DAYS = 14;

interface FlowLine {
  상품이름: string;
  확정수량: number | '';
  stage: Stage;
  where: string;
}

interface FlowOrder {
  no: string;
  center: string;
  date: string; // YYYY-MM-DD
  stage: Stage;
  partial: boolean;
  lines: FlowLine[];
  bundle?: string;       // 발주확인 묶음 이름
  hold?: string;         // 예약·대기
  item?: ShipOut;        // 쉽먼트 이후 단계의 출고 건
  batch?: ShipmentBatch; // 그 출고 건의 쉽먼트 기록
  confirmed: boolean;
}

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const dayText = (ymd: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
  if (!m) return ymd || '-';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return `${Number(m[2])}/${Number(m[3])}(${WEEK[d.getDay()]})`;
};
const daysAgo = (ymd: string) => {
  const t = Date.parse(`${ymd}T00:00:00`);
  return Number.isFinite(t) ? (Date.now() - t) / 86400000 : 999;
};

// view: 'board' = 단계마다 상자를 옆으로(발주 진행 메뉴), 'list' = 발주서마다 단계 한 줄(발주 단계별 메뉴). 내용은 같다.
export default function CoupangFlowPage({ onNavigate, view = 'board' }: { onNavigate: (menu: AppMenuId) => void; view?: 'board' | 'list' }) {
  const [tab, setTab] = useState<Stage | 'active'>('active');
  // 새 발주서 창(새 주문 수집 · 확정수량 고치기 · 발주확정 올리기)
  const [newOpen, setNewOpen] = useState(false);
  // 상품 줄 준비 상태: 준비됨 체크(쿠팡발주확인·쉽먼트·발송대기와 같은 기록) + 한중발주(한중 대기·입고중·일부입고·준비됨).
  const ready = useReady();
  // 상품별 체크 메뉴(준비됨 · 한중발주에 맡기기 · 사무실 재고에서 쓰기). 쉽먼트생성대기와 같은 메뉴.
  const lineHj = useLineHanjung(t => setDateNote({ tone: 'info', text: t }));
  const [hjOrders, setHjOrders] = useState<HanjungOrder[]>([]);
  const [hjQueue, setHjQueue] = useState<HanjungQueueItem[]>([]);
  useEffect(() => subscribeHanjung(setHjOrders), []);
  useEffect(() => subscribeHanjungQueue(setHjQueue), []);
  const placesOf = useMemo(() => makePlaceLookup(hjOrders, hjQueue), [hjOrders, hjQueue]);
  // 한중발주 번호(동그라미 안 숫자): 고유번호에 "1)"처럼 적힌 숫자. 없으면 끝 숫자(H260923-01 → 1), 그것도 없으면 만든 순서.
  const hjNo = useMemo(() => {
    const m = new Map<string, number>();
    [...hjOrders].sort((a, b) => a.createdAt - b.createdAt).forEach((o, i) => {
      const marked = /(\d+)\s*\)/.exec(o.code);
      const tail = /(\d+)\s*$/.exec(o.code);
      m.set(o.code, marked ? Number(marked[1]) : tail ? Number(tail[1]) : i + 1);
    });
    return m;
  }, [hjOrders]);
  // 한중발주마다 동그라미 색(쉽먼트생성대기의 한중 뱃지와 같은 색 순서).
  const hjColor = useMemo(() => {
    const COLORS = ['#2563eb', '#7c3aed', '#db2777', '#0891b2', '#4f46e5', '#9333ea', '#0d9488', '#be185d', '#1d4ed8', '#6d28d9'];
    const m = new Map<string, string>();
    [...hjOrders].sort((a, b) => a.createdAt - b.createdAt).forEach((o, i) => m.set(o.code, COLORS[i % COLORS.length]));
    return m;
  }, [hjOrders]);
  // 사무실 재고(한중으로 넉넉히 사 둔 여유): 도착한 것 + 오는 중인 것.
  const officeOf = useMemo(() => makeHanjungOfficeLookup(hjOrders), [hjOrders]);
  // 한중발주 안에서 그 상품이 다 들어왔는지.
  const hjArrived = useMemo(() => {
    const m = new Map<string, { received: number; ordered: number }>();
    for (const o of hjOrders) for (const p of productSummary(o)) m.set(`${o.code}│${nameKey(p.상품이름)}`, { received: p.received, ordered: p.ordered });
    return m;
  }, [hjOrders]);
  const [work, setWork] = useState(() => readWork().rows);
  // 발주번호 → 처음 들어온 시각(24시간 안에 들어온 것만 남아 있다). NEW 표시에 쓴다.
  const [seenAt, setSeenAt] = useState(() => readWork().seen);
  const [reservations, setReservations] = useState<OrderRow[]>([]);
  const [shipOuts, setShipOuts] = useState<ShipOut[]>([]);
  const [batches, setBatches] = useState<ShipmentBatch[]>([]);
  const batchesRef = React.useRef<ShipmentBatch[]>([]);
  batchesRef.current = batches;
  const [confirmed, setConfirmedMap] = useState<Record<string, number>>({});
  const [query, setQuery] = useState('');
  const [waybillBatch, setWaybillBatch] = useState<ShipmentBatch | null>(null);
  // 발주확정 양식·고친 수량이 바뀌면 다시 그린다.
  const [, setFormTick] = useState(0);
  useEffect(() => subscribePoForms(() => setFormTick(t => t + 1)), []);
  const [confirmJob, setConfirmJob] = useState<ConfirmJob | null>(null);
  useEffect(() => subscribeConfirmJob(setConfirmJob), []);
  // 발주확정 올리기: 새발주서 칸의 발주서들로 PO_FOR_CONFIRM 파일을 채워 서허에 올린다.
  const uploadConfirm = (list: FlowOrder[]) => {
    const nos = list.map(o => o.no);
    const zero = list.flatMap(o => o.lines.filter(l => readDraft(o.no).qty[l.상품이름] === 0).map(l => `${o.no} ${l.상품이름}`));
    if (!window.confirm(
      `새발주서 ${nos.length}건을 서허에 확정으로 올릴까요?` +
      (zero.length ? `\n\n확정수량 0개(사유: 단종 등) ${zero.length}줄:\n${zero.slice(0, 8).join('\n')}${zero.length > 8 ? '\n…' : ''}` : ''),
    )) return;
    startConfirmUpload(nos);
  };
  // ── 발주서 고르기(발주확정·쉽먼트 칸) → 아래쪽 메뉴 ──
  const PICKABLE: Stage[] = [1, 2];
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const togglePick = (no: string) => setPicked(prev => {
    const next = new Set(prev);
    if (next.has(no)) next.delete(no); else next.add(no);
    return next;
  });
  const [dateNote, setDateNote] = useState<{ tone: 'info' | 'ok' | 'error'; text: string } | null>(null);
  // 날짜 변경 요청 중인 발주서(발주번호 → 요청한 시각).
  const [dateReqs, setDateReqs] = useState<Record<string, DateReq>>({});
  useEffect(() => subscribeDateRequests(setDateReqs), []);
  // 적용: 확장이 서허 발주서 목록에서 지금 입고예정일·센터를 읽어 오면 앱에 적는다.
  const checkingRef = React.useRef<string[] | null>(null);
  const dateAck = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const onMsg = (event: MessageEvent) => {
      if (event.source !== window) return;
      const d = event.data;
      if (!d || d.source !== 'rocket-hub-extension') return;
      if (d.type === 'PO_DATE_ACK' || d.type === 'PO_DATE_STATUS') { if (dateAck.current) clearTimeout(dateAck.current); dateAck.current = null; }
      if (d.type === 'PO_DATE_ACK' && !d.ok) setDateNote({ tone: 'error', text: `서허 창을 열지 못했어요: ${d.error || ''}` });
      if (d.type === 'PO_DATE_STATUS') setDateNote({ tone: d.step === 'error' ? 'error' : d.step === 'done' ? 'ok' : 'info', text: d.status || '' });
      // 적용(서허 목록에서 지금 값 읽기) 결과
      if (checkingRef.current && (d.type === 'PO_COLLECT_ACK' || (d.type === 'PO_STATUS' && d.purpose === 'check'))) {
        if (dateAck.current) { clearTimeout(dateAck.current); dateAck.current = null; }
        const nos = checkingRef.current;
        if (d.type === 'PO_COLLECT_ACK') {
          if (!d.ok) { checkingRef.current = null; setDateNote({ tone: 'error', text: `서허 창을 열지 못했어요: ${d.error || ''}` }); }
          return;
        }
        if (d.step === 'error' || d.step === 'empty') { checkingRef.current = null; setDateNote({ tone: 'error', text: `서허에서 읽지 못했어요: ${d.status || ''}` }); return; }
        if (d.step === 'checked' && d.checked) {
          checkingRef.current = null;
          applyCurrent(nos, d.checked).then(res => {
            // 센터·날짜가 바뀐 출고 건은 쉽먼트 기록(박스·운송장)도 같이 옮긴다.
            for (const m of res.moved) {
              for (const next of retargetBatches(batchesRef.current, m.before, m.to, shipOutBatch(m.before, batchesRef.current))) {
                saveShipmentBatch(next).catch(err => console.error('쉽먼트 기록 옮기기 실패:', err));
              }
            }
            const parts = [
              res.changed.length ? `✅ ${res.changed.length}건 바꿨어요: ${res.changed.map(c => `${c.no} → ${c.to}`).join(', ')}` : '',
              res.same.length ? `아직 그대로(승인 전?) ${res.same.length}건: ${res.same.join(', ')}` : '',
              res.missing.length ? `서허 목록에서 못 찾음 ${res.missing.length}건: ${res.missing.join(', ')}` : '',
            ].filter(Boolean);
            setDateNote({ tone: res.changed.length && !res.same.length && !res.missing.length ? 'ok' : res.changed.length ? 'info' : 'error', text: parts.join(' · ') });
            setPicked(new Set());
          }).catch(err => setDateNote({ tone: 'error', text: `적용하지 못했어요: ${err instanceof Error ? err.message : String(err)}` }));
          return;
        }
        if (d.status) setDateNote({ tone: 'info', text: `서허 목록 확인 중 · ${d.status}` });
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);
  // 날짜 바꾸기: 서허 입고일 변경 요청 화면을 새 창으로 열어 고른 발주서를 하나씩 검색해 "+추가"까지 해 둔다(날짜는 사람이 고른다).
  const changeDate = () => {
    const nos: string[] = Array.from(picked);
    if (!nos.length) return;
    setDateNote({ tone: 'info', text: `서허 창 여는 중… 발주서 ${nos.length}건을 하나씩 넣어요.` });
    markDateRequested(nos, true);
    window.postMessage({ source: 'rocket-app-hub', type: 'PO_DATE_CHANGE', orderNos: nos }, window.location.origin);
    if (dateAck.current) clearTimeout(dateAck.current);
    dateAck.current = setTimeout(() => setDateNote({
      tone: 'error',
      text: '확장 프로그램이 대답하지 않아요. chrome://extensions 에서 "로켓 서허 연동"을 새로고침(↻)하고 이 화면도 새로고침해 주세요.',
    }), 5000);
  };
  // 적용: 서허에서 승인을 확인한 뒤 누른다. 확장이 서허 발주서 목록에서 그 발주서들의 지금 입고예정일·센터를 읽어 온다.
  const applyDate = () => {
    const nos: string[] = Array.from(picked);
    if (!nos.length) return;
    checkingRef.current = nos;
    setDateNote({ tone: 'info', text: `서허 발주서 목록에서 ${nos.length}건의 입고예정일·센터 확인 중…` });
    window.postMessage({ source: 'rocket-app-hub', type: 'PO_COLLECT', purpose: 'check', orderNos: nos, lastOrderNo: '' }, window.location.origin);
    if (dateAck.current) clearTimeout(dateAck.current);
    dateAck.current = setTimeout(() => {
      checkingRef.current = null;
      setDateNote({ tone: 'error', text: '확장 프로그램이 대답하지 않아요. chrome://extensions 에서 "로켓 서허 연동"을 새로고침(↻)하고 이 화면도 새로고침해 주세요.' });
    }, 5000);
  };
  // 새 주문 수집 결과(새 주문 수집 단추 아래에 보여준다).
  const [collectNote, setCollectNote] = useState('');
  const handleOrderFile = async (file: File) => {
    try {
      const { added, skipped } = await appendOrderFile(file, reservations);
      setCollectNote(added ? `✅ 새 발주 ${added}줄을 받았어요${skipped ? ` (이미 있는 ${skipped}줄 제외)` : ''}` : `새로 들어온 줄이 없어요${skipped ? ` (이미 있는 ${skipped}줄)` : ''}`);
    } catch (err) {
      setCollectNote(`⛔ 발주서를 읽지 못했어요: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  useEffect(() => subscribeWork(() => { const w = readWork(); setWork(w.rows); setSeenAt(w.seen); }), []);
  useEffect(() => subscribeReservations(setReservations), []);
  useEffect(() => subscribeShipOuts(setShipOuts), []);
  useEffect(() => subscribeShipments(setBatches), []);
  useEffect(() => subscribeConfirmed(setConfirmedMap), []);
  useEffect(() => onNeedWaybill(setWaybillBatch), []);

  const orders = useMemo(() => {
    const map = new Map<string, FlowOrder>();
    const add = (no: string, center: string, date: string, line: FlowLine, extra: Partial<FlowOrder>) => {
      if (!no) return;
      const o = map.get(no);
      if (!o || line.stage < o.stage) {
        map.set(no, {
          no, center, date, stage: line.stage, partial: !!o, lines: [...(o?.lines || []), line],
          confirmed: !!confirmed[no], ...extra,
        });
      } else {
        o.lines.push(line);
        if (line.stage !== o.stage) o.partial = true;
      }
    };
    for (const r of work) {
      const no = String(r.발주번호 ?? '').trim();
      const bundle = String(r.묶음 ?? '').trim();
      // 묶음에 넣었으면 확정은 끝난 것으로 본다.
      const stage: Stage = confirmed[no] || bundle ? 1 : 0;
      add(no, String(r.물류센터 ?? ''), dateKeyYMD(r.입고예정일 as string),
        { 상품이름: String(r.상품이름 ?? ''), 확정수량: r.확정수량 as number | '', stage, where: bundle ? `발주확인 · ${bundle}` : '발주확인' },
        { bundle: bundle || undefined });
    }
    for (const r of reservations) {
      const no = String(r.발주번호 || '').trim();
      const hold = (r.메모 || '').includes('대기') ? '대기' : '예약';
      add(no, r.물류센터, dateKeyYMD(r.입고예정일),
        { 상품이름: r.상품이름, 확정수량: r.확정수량, stage: 1, where: hold },
        { hold });
    }
    for (const item of shipOuts) {
      const st = shipOutStage(item, batches);
      if (st === 'sent' && daysAgo(item.sentDate || '') > SENT_DAYS) continue;
      const batch = shipOutBatch(item, batches);
      for (const l of item.lines) {
        const no = String(l.발주번호 || '').trim();
        const stage: Stage = st === 'sent' ? 5 : st === 'waiting' && (item.printedOrders || []).includes(no) ? 4 : 2;
        add(no, item.center, item.date,
          { 상품이름: l.상품이름, 확정수량: l.확정수량, stage, where: `${item.bundle} (${item.id})` },
          { item, batch });
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      ymdSortKey(a.date) - ymdSortKey(b.date)
      || a.center.localeCompare(b.center, 'ko', { numeric: true })
      || a.no.localeCompare(b.no, 'ko', { numeric: true }));
  }, [work, reservations, shipOuts, batches, confirmed]);

  // 고른 발주서가 다른 칸으로 가면 고른 데서 뺀다.
  useEffect(() => {
    setPicked(prev => {
      const ok = new Set(orders.filter(o => PICKABLE.includes(o.stage)).map(o => o.no));
      const next = new Set(Array.from(prev).filter(no => ok.has(no)));
      return next.size === prev.size ? prev : next;
    });
  }, [orders]);

  const q = query.trim().toLowerCase();
  const match = (o: FlowOrder) =>
    !q || o.no.includes(q) || o.center.toLowerCase().includes(q) || o.lines.some(l => l.상품이름.toLowerCase().includes(q));
  // 상자마다 담을 발주서. 발송완료는 최근 보낸 것이 위로.
  const boxes = STAGES.map((_, i) => {
    const list = orders.filter(o => o.stage === i && match(o));
    if (i === 5) list.sort((a, b) => (b.item?.sentDate || '').localeCompare(a.item?.sentDate || ''));
    return list;
  });

  const confirm1 = (nos: string[], on: boolean) =>
    setConfirmed(nos, on).catch(err => alert(`발주확정 표시 저장 실패: ${err instanceof Error ? err.message : String(err)}`));

  const run = (o: FlowOrder) => o.stage === 2 ? o.batch?.run : undefined;

  // 상자마다 다음에 할 일 버튼.
  const action = (o: FlowOrder) => {
    const r = run(o);
    switch (o.stage) {
      case 0:
        // 올리기는 상자 위 "발주확정 올리기"로 한꺼번에. 여기는 서허에서 직접 확정한 발주서를 표시만 할 때.
        return <button style={btn('#6b7280')} onClick={() => confirm1([o.no], true)} title="서허에서 직접 확정했으면 눌러서 발주확정 칸으로 넘깁니다">직접 확정함</button>;
      case 1:
        return <button style={btn(ORANGE)} onClick={() => onNavigate('coupang-order')} title="쿠팡발주확인에서 묶고 쉽먼트생성으로 보냅니다">쉽먼트로 보내기 →</button>;
      case 2:
        return (
          <>
            {/* 서허 등록이 끝나 쉽먼트 번호가 있으면 출력만, 아니면 쉽먼트 이어서 하기·화면 이동 */}
            {o.item?.shipmentNos?.[o.no] ? printButton(o) : (
              <>
                {o.item && o.batch && (!r || r.state !== 'running') && (
                  <button style={btn(ORANGE, true)} onClick={() => resumeShipment(o.batch!, [o.item!])} title="멈춘 데서 이어서 합니다. 택배예약은 다시 하지 않아요.">▶ 이어서 하기</button>
                )}
                <button style={btn(ORANGE, !o.batch)} onClick={() => onNavigate('coupang-ship')} title={o.batch ? '쉽먼트생성대기 화면' : '쉽먼트생성대기에서 택배예약부터 시작합니다'}>
                  {o.batch ? '쉽먼트 →' : '쉽먼트 시작 →'}
                </button>
                {printButton(o)}
              </>
            )}
          </>
        );
      case 3:
        return <button style={btn(ORANGE, true)} onClick={() => onNavigate('coupang-send')} title="발송대기 화면에서 문서와 바코드를 출력합니다">출력하러 →</button>;
      case 4:
        return <button style={btn(GREEN)} onClick={() => onNavigate('coupang-send')} title="준비되면 발송대기 화면에서 발송 완료를 누릅니다">발송대기 →</button>;
      default:
        return <span style={{ fontSize: 12, color: GREEN, fontWeight: 700 }}>{dayText(o.item?.sentDate || '')} 발송</span>;
    }
  };

  // ── 카드 조각들(상자 보기·단계별 보기가 같이 쓴다) ──
  // 입고예정일·센터를 가장 크게, 그 아래 발주번호.
  const headInfo = (o: FlowOrder, size: number) => (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', lineHeight: 1.2 }}>
        {PICKABLE.includes(o.stage) && (
          <input
            type="checkbox" checked={picked.has(o.no)} onChange={() => togglePick(o.no)}
            title="골라서 아래 메뉴로 날짜 바꾸기 등을 합니다"
            style={{ width: 16, height: 16, accentColor: ORANGE, cursor: 'pointer', flexShrink: 0 }}
          />
        )}
        <span style={{ fontSize: size, fontWeight: 900, color: '#111' }}>{dayText(o.date)}</span>
        <span style={{ fontSize: size, fontWeight: 900, color: ORANGE }}>{o.center || '센터 없음'}</span>
      </div>
      <div style={{ fontSize: 11.5, color: '#888', marginTop: 2 }}>
        발주 {o.no}
      </div>
    </div>
  );
  const tags = (o: FlowOrder) => {
    const shipNo = o.item?.shipmentNos?.[o.no];
    const req = !!dateReqs[o.no] && !dateReqs[o.no].doneAt;
    const changedDate = dateReqs[o.no]?.doneAt ? dateReqs[o.no] : null;
    if (!(((o.bundle || o.hold) && o.stage === 1) || shipNo || o.partial || req || changedDate)) return null;
    return (
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
        {req && <Tag color="#7c3aed">📅 날짜 변경 요청 중</Tag>}
        {changedDate && (
          <span title={`${changedDate.from} → ${changedDate.to}`} style={{ fontSize: 10.5, color: GREEN, fontWeight: 700 }}>✓ 날짜변경완료</span>
        )}
        {req && (
          <button onClick={() => { if (window.confirm(`${o.no}의 날짜 변경 요청 표시를 지울까요?(서허 요청은 그대로예요)`)) markDateRequested([o.no], false); }}
            style={{ padding: 0, border: 'none', background: 'transparent', color: '#aaa', fontSize: 10.5, cursor: 'pointer', textDecoration: 'underline' }}>
            표시 지우기
          </button>
        )}
        {o.bundle && o.stage === 1 && <Tag color="#6b7280">{o.bundle}</Tag>}
        {o.hold && o.stage === 1 && <Tag color="#7c3aed">{o.hold}</Tag>}
        {shipNo && <Tag color="#2563eb">쉽먼트 {shipNo}</Tag>}
        {o.partial && <Tag color={RED}>일부만 넘어감</Tag>}
      </div>
    );
  };
  const runNote = (o: FlowOrder) => {
    const r = run(o);
    if (!r || r.state === 'done') return null;
    return (
      <div style={{
        padding: '5px 7px', borderRadius: 6, fontSize: 11.5, lineHeight: 1.45,
        background: r.state === 'error' ? '#fef2f2' : '#eff6ff', color: r.state === 'error' ? '#b91c1c' : '#1d4ed8',
      }}>
        <b>{r.state === 'error' ? `⛔ ${STEP_LABEL[r.step]}에서 멈춤` : `⏳ ${STEP_LABEL[r.step]} 하는 중`}</b> · {r.message}
      </div>
    );
  };
  // 상품. 새발주서 단계에서는 확정수량을 바로 고친다(줄이면 사유, 기본 시장 단종). 다른 단계에 가 있는 줄은 어디 있는지 빨갛게.
  const products = (o: FlowOrder) => {
    const qty = o.lines.reduce((sum, l) => sum + (Number(l.확정수량) || 0), 0);
    return (
      <>
        {o.lines.map((l, i) => {
          const editable = o.stage === 0 && l.stage === 0;
          const draft = readDraft(o.no);
          const full = Number(l.확정수량) || 0;
          const now = draft.qty[l.상품이름] ?? full;
          return (
            <div key={i} style={{ padding: '2px 0', borderTop: i ? '1px dashed #f0f0f0' : 'none' }}>
              {/* 한 줄 표: [체크] [상품 이름(넘치면 …)] [사무실] [수량]. 줄바꿈하지 않고 칸 너비를 맞춘다. */}
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {o.stage > 0 && (() => {
                  // 상품별 체크 → 준비됨 / 한중발주 배정 / 사무실 재고
                  const hl = { 발주번호: o.no, 물류센터: o.center, 상품이름: l.상품이름, 확정수량: l.확정수량, 입고예정일: o.date, 메모: '', 쉼먼트: '' };
                  const key = { 발주번호: o.no, 상품이름: l.상품이름, 확정수량: l.확정수량 };
                  const on = ready.isReady(key, o.item?.readyKeys);
                  return (
                    <span style={{ flexShrink: 0, alignSelf: 'center' }}>
                      <LineCheckMenu
                        ready={on}
                        hanjung={lineHj.hanjungOf(hl)}
                        onReady={v => ready.setReady([key], v).catch(err => alert(`준비 표시 저장 실패: ${err?.message || err}`))}
                        onHanjung={action => { lineHj.setLineHanjung(hl, action, () => ready.setReady([key], true).catch(() => {})); }}
                      />
                    </span>
                  );
                })()}
                {(() => {
                  // 준비 상태: 준비됨(체크 또는 한중으로 다 도착) → 흐린 글씨, 한중발주로 오는 중 → 흐린 글씨 + 동그라미 안에 한중발주 번호.
                  const key = { 발주번호: o.no, 상품이름: l.상품이름, 확정수량: l.확정수량 };
                  const places = placesOf(key);
                  const coming = places.filter(p => {
                    if (!p.code) return false;
                    const a = hjArrived.get(`${p.code}│${nameKey(l.상품이름)}`);
                    return !a || a.received < a.ordered;
                  });
                  const arrived = places.length > 0 && places.every(p => p.code && !coming.includes(p));
                  const isReady = ready.isReady(key, o.item?.readyKeys) || arrived;
                  const waitingQueue = places.some(p => !p.code);
                  const faded = isReady || coming.length > 0;
                  return (
                    <span
                      title={`${l.상품이름}\n${isReady ? '준비됨' : coming.length ? `입고중(한중발주 ${coming.map(p => p.code).join(', ')})` : waitingQueue ? '한중발주 대기(1688 주문 전)' : '준비중'} — 왼쪽 체크 칸에서 준비됨·한중발주 배정`}
                      style={{
                        flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        // 준비중(아무 진행 없음) = 검정 굵게, 입고중 = 검정 보통 굵기 + 번호 동그라미, 준비됨 = 회색 + 줄 긋기 + 초록 ✓
                        color: now < full ? RED : isReady ? '#a8a29e' : '#111',
                        fontWeight: faded ? 400 : 700,
                        textDecoration: (editable && now === 0) || isReady ? 'line-through' : 'none',
                      }}
                    >
                      {isReady && <span style={{ marginRight: 4, color: GREEN, fontWeight: 900 }}>✓</span>}
                      {!isReady && coming.map(p => (
                        <span key={p.code!} style={{
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16, marginRight: 4,
                          borderRadius: '50%', background: hjColor.get(p.code!) || '#2563eb', color: '#fff', fontSize: 10, fontWeight: 800, verticalAlign: 'middle',
                        }}>{hjNo.get(p.code!) ?? '?'}</span>
                      ))}
                      {waitingQueue && !isReady && !coming.length && <span style={{ marginRight: 4, fontSize: 10, color: '#9ca3af' }}>대기</span>}
                      {l.상품이름}
                    </span>
                  );
                })()}
                {editable ? (
                  <span style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                    <input
                      type="number" min={0} max={full} value={now}
                      onChange={e => {
                        const v = Math.max(0, Math.min(full, Math.floor(Number(e.target.value) || 0)));
                        setDraftLine(o.no, l.상품이름, v === full ? null : v, v < full ? (draft.reason[l.상품이름] || DEFAULT_REASON) : undefined);
                      }}
                      title={`발주수량 ${full}개. 줄이면 납품부족사유를 골라요.`}
                      style={{ width: 44, padding: '1px 3px', fontSize: 12, fontWeight: 700, textAlign: 'right', border: `1px solid ${now < full ? RED : '#ddd'}`, borderRadius: 4 }}
                    />
                    <span style={{ fontSize: 11, color: '#999' }}>/{full}</span>
                  </span>
                ) : (
                  <>
                    {/* 사무실 재고(한중 여유): 도착 수 +오는 중. 필요한 만큼 도착했으면 초록, 오는 것까지 치면 되면 주황, 모자라면 빨강. */}
                    {(() => {
                      const office = officeOf(l.상품이름);
                      const arrived = office.qty || 0;
                      const incoming = office.incoming || 0;
                      // 칸을 맞추려고 없을 때도 같은 너비를 비워 둔다.
                      if (!arrived && !incoming) return <span style={{ flexShrink: 0, width: 46 }} />;
                      const need = Number(l.확정수량) || 0;
                      const color = arrived >= need ? GREEN : arrived + incoming >= need ? '#d97706' : RED;
                      return (
                        <span
                          title={`사무실 재고(한중 여유) · 도착 ${arrived}개${incoming ? ` · 오는 중 ${incoming}개` : ''}\n${office.names.join('\n')}`}
                          style={{ flexShrink: 0, width: 46, textAlign: 'right', fontSize: 13, fontWeight: 800, color, whiteSpace: 'nowrap' }}
                        >
                          {arrived}{incoming > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: '#d97706' }}> +{incoming}</span>}
                        </span>
                      );
                    })()}
                    <b style={{ flexShrink: 0, width: 38, textAlign: 'right', whiteSpace: 'nowrap' }}>{l.확정수량}개</b>
                  </>
                )}
              </div>
              {/* 수량: 배정(한중발주에 맡긴 수) · 대기(1688 주문 전) */}
              {o.stage > 0 && (() => {
                const key = { 발주번호: o.no, 상품이름: l.상품이름, 확정수량: l.확정수량 };
                const places = placesOf(key);
                const assigned = places.filter(p => p.code).reduce((n, p) => n + p.qty, 0);
                const queued = places.filter(p => !p.code).reduce((n, p) => n + p.qty, 0);
                const parts: React.ReactNode[] = [];
                if (assigned) parts.push(<span key="a" title={`한중발주 ${places.filter(p => p.code).map(p => `${p.code} ${p.qty}개`).join(', ')}`}>배정 <b>{assigned}</b></span>);
                if (queued) parts.push(<span key="q" title="한중발주 대기(1688 주문 전)">대기 <b>{queued}</b></span>);
                if (!parts.length) return null;
                return (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0 10px', fontSize: 10.5, color: '#8a857f', marginTop: 1, paddingLeft: 24 }}>{parts}</div>
                );
              })()}
              {editable && now < full && (
                <select
                  value={draft.reason[l.상품이름] || DEFAULT_REASON}
                  onChange={e => setDraftLine(o.no, l.상품이름, now, e.target.value)}
                  style={{ width: '100%', marginTop: 2, fontSize: 10.5, padding: '1px 2px', border: `1px solid ${RED}`, borderRadius: 4, color: RED }}
                >
                  {SHORT_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              )}
              {o.partial && l.stage !== o.stage && (
                <div style={{ color: RED, fontSize: 10.5 }}>{STAGES[l.stage]} · {l.where}</div>
              )}
            </div>
          );
        })}
      </>
    );
  };
  // 🖨 출력: 서허 Label·내역서(합친 PDF)와 바코드 라벨을 새 탭에 연다. 색으로 출력 여부를 보여준다(초록 = 출력완료).
  // 서허 일괄등록이 끝나 쉽먼트 번호가 생겨야 누를 수 있다.
  const [printNote, setPrintNote] = useState<Record<string, string>>({});
  const printButton = (o: FlowOrder) => {
    const item = o.item;
    const shipNo = item?.shipmentNos?.[o.no];
    const printed = !!item && (item.printedOrders || []).includes(o.no);
    if (!item) return null;
    const color = printed ? GREEN : shipNo ? ORANGE : GRAY;
    return (
      <button
        disabled={!shipNo}
        onClick={() => {
          if (!shipNo) return;
          if (printed && !window.confirm(`발주 ${o.no}은 이미 출력했어요. 다시 출력할까요?`)) return;
          printShipment(item, o.no, shipNo, t => setPrintNote(n => ({ ...n, [o.no]: t })));
        }}
        onContextMenu={e => {
          // 오른쪽 클릭: 출력완료 표시를 켜고 끈다(직접 출력했을 때).
          e.preventDefault();
          if (window.confirm(printed ? `발주 ${o.no}의 출력완료 표시를 풀까요?` : `발주 ${o.no}을 출력완료로 표시할까요?`)) setPrinted(item, o.no, !printed);
        }}
        title={!shipNo ? '서허 일괄등록이 끝나 쉽먼트 번호가 생기면 출력할 수 있어요'
          : printed ? '출력완료(초록). 누르면 다시 출력. 오른쪽 클릭: 출력완료 풀기'
          : '문서(Label·내역서)와 바코드 라벨을 새 탭에 열어요. 오른쪽 클릭: 출력완료로만 표시'}
        style={{ ...btn(color, printed || !!shipNo), cursor: shipNo ? 'pointer' : 'not-allowed', opacity: shipNo ? 1 : 0.6 }}
      >
        🖨{printed ? ' 출력완료' : ' 출력'}
      </button>
    );
  };

  const actionRow = (o: FlowOrder) => (
    <>
    {printNote[o.no] && o.stage === 2 && <div style={{ fontSize: 11, color: '#1d4ed8' }}>{printNote[o.no]}</div>}
    <div style={{ display: 'flex', gap: 4, flexWrap: 'nowrap', alignItems: 'center' }}>
      {action(o)}
      {o.confirmed && o.stage <= 1 && !o.bundle && (
        <button onClick={() => confirm1([o.no], false)} style={{ marginLeft: 'auto', padding: 0, border: 'none', background: 'transparent', color: '#aaa', fontSize: 10.5, cursor: 'pointer', textDecoration: 'underline' }}>
          확정 취소
        </button>
      )}
    </div>
    </>
  );
  const borderOf = (o: FlowOrder) => picked.has(o.no) ? `2px solid ${ORANGE}` : `1px solid ${run(o)?.state === 'error' ? '#fca5a5' : '#ececec'}`;

  // 상자 보기 카드: 상자 폭에 맞춰 위아래로.
  const card = (o: FlowOrder) => (
    // 카드끼리 잘 구분되게: 진한 테두리 + 그림자 + 왼쪽 색 띠(멈춘 건 빨강, 고른 건 주황).
    <div key={o.no} style={{
      background: '#fff', borderRadius: 10, padding: '10px 12px 10px 14px', boxShadow: '0 2px 6px rgba(0,0,0,0.10)',
      border: picked.has(o.no) ? `2px solid ${ORANGE}` : `1px solid ${run(o)?.state === 'error' ? '#f87171' : '#cfcac5'}`,
      borderLeft: `5px solid ${picked.has(o.no) ? ORANGE : run(o)?.state === 'error' ? RED : '#a8a29e'}`,
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      {headInfo(o, 17)}
      {tags(o)}
      {runNote(o)}
      <div style={{ fontSize: 12, borderTop: '1px solid #f3f3f3', paddingTop: 5 }}>{products(o)}</div>
      {actionRow(o)}
    </div>
  );

  // 단계별 보기 카드: 왼쪽에 날짜·센터·단계·버튼, 오른쪽에 상품.
  const row = (o: FlowOrder) => (
    <div key={o.no} style={{ display: 'flex', flexWrap: 'wrap', border: borderOf(o), borderRadius: 10, background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.04)', overflow: 'hidden' }}>
      <div style={{ flex: '0 0 auto', minWidth: 240, maxWidth: '100%', boxSizing: 'border-box', padding: '10px 12px', background: '#fafafa', borderRight: '1px solid #f0f0f0', display: 'flex', flexDirection: 'column', gap: 7 }}>
        {headInfo(o, 20)}
        <Stepper stage={o.stage} error={run(o)?.state === 'error'} />
        {tags(o)}
        {runNote(o)}
        {actionRow(o)}
      </div>
      <div style={{ flex: '1 1 220px', minWidth: 0, padding: '10px 12px', fontSize: 12.5 }}>{products(o)}</div>
    </div>
  );

  // 새 주문 수집 칸
  const collectPanel = (
    <div style={{ background: '#eff6ff', borderRadius: 12, padding: 8 }}>
      <CollectPurchaseOrders onFile={handleOrderFile} compact label="📥 새 주문 수집" />
      {collectNote && <div style={{ marginTop: 6, fontSize: 11.5, color: collectNote.startsWith('⛔') ? RED : '#1d4ed8', lineHeight: 1.4 }}>{collectNote}</div>}
    </div>
  );
  // 발주확정 올리기 칸(새발주서 단계 발주서들)
  const confirmPanel = (list: FlowOrder[]) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <button
        style={{ ...btn(ORANGE, true), width: '100%', padding: '7px 8px', fontSize: 12.5 }}
        onClick={() => {
          // 진행 중인 게 있으면 조용히 막지 않고 물어본다.
          if (confirmJob && !['applied', 'error'].includes(confirmJob.step) && Date.now() - confirmJob.at < 10 * 60 * 1000
            && !window.confirm(`아직 진행 중인 발주확정 올리기가 있어요(${confirmJob.status}).\n새로 시작할까요?`)) return;
          uploadConfirm(list);
        }}
        title="확정수량(I열)·납품부족사유(M열)를 채운 발주확정 파일을 만들어 서허 발주확정 업로드에 올립니다"
      >
        📤 발주확정 올리기 ({list.length}건)
      </button>
      <button
        style={{ ...btn('#6b7280'), width: '100%' }}
        onClick={() => { if (window.confirm(`서허에서 직접 확정한 발주서 ${list.length}건을 확정됨으로만 표시할까요?`)) confirm1(list.map(o => o.no), true); }}
        title="서허에서 직접 확정했을 때: 올리지 않고 표시만 해서 다음 단계로 넘깁니다"
      >
        직접 확정함
      </button>
      {confirmJob && (
        <div style={{
          fontSize: 11.5, lineHeight: 1.45, padding: '5px 7px', borderRadius: 6,
          background: confirmJob.step === 'error' ? '#fef2f2' : confirmJob.step === 'applied' ? '#ecfdf5' : '#eff6ff',
          color: confirmJob.step === 'error' ? '#b91c1c' : confirmJob.step === 'applied' ? '#047857' : '#1d4ed8',
        }}>
          {confirmJob.status}
          {(confirmJob.messages || []).length > 0 && <div>💬 {(confirmJob.messages || []).join(' / ')}</div>}
          <button onClick={clearConfirmJob} style={{ marginLeft: 6, border: 'none', background: 'transparent', color: '#888', cursor: 'pointer', fontSize: 11, textDecoration: 'underline' }}>
            {['applied', 'error'].includes(confirmJob.step) ? '닫기' : '그만두기'}
          </button>
        </div>
      )}
    </div>
  );

  // 고르면 화면 아래 가운데에 뜨는 메뉴.
  const layer = (picked.size > 0 || dateNote) && (
    <div style={{
      position: 'fixed', left: '50%', bottom: 18, transform: 'translateX(-50%)', zIndex: 50,
      background: '#1f2937', color: '#fff', borderRadius: 12, boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
      padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 'calc(100vw - 32px)',
    }}>
      {picked.size > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <b style={{ fontSize: 13, whiteSpace: 'nowrap' }}>발주서 {picked.size}건 고름</b>
          <button onClick={changeDate} style={{ padding: '6px 12px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: 'none', background: ORANGE, color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            📅 날짜 바꾸기
          </button>
          <button onClick={applyDate} title="서허에서 승인된 것을 확인한 뒤 누르세요. 서허 발주서 목록의 지금 입고예정일·센터를 읽어 앱에 적어요."
            style={{ padding: '6px 12px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: 'none', background: '#16a34a', color: '#fff', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            ✅ 바뀐 날짜 적용
          </button>
          <button onClick={() => setPicked(new Set())} style={{ padding: '6px 10px', fontSize: 12, borderRadius: 8, border: '1px solid #4b5563', background: 'transparent', color: '#d1d5db', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            고르기 풀기
          </button>
        </div>
      )}
      {dateNote && (
        <div style={{ fontSize: 12, lineHeight: 1.45, color: dateNote.tone === 'error' ? '#fca5a5' : dateNote.tone === 'ok' ? '#86efac' : '#bfdbfe', display: 'flex', gap: 8 }}>
          <span>{dateNote.text}</span>
          <button onClick={() => setDateNote(null)} style={{ border: 'none', background: 'transparent', color: '#9ca3af', cursor: 'pointer', fontSize: 12 }}>×</button>
        </div>
      )}
    </div>
  );

  // 머리줄의 "새 발주서" 단추(아직 확정 안 한 발주서 수). 누르면 새 발주서 창이 뜬다.
  const newCount = boxes[0].length;
  const newButton = (
    <button
      onClick={() => setNewOpen(true)}
      title="새 주문 수집 · 확정수량 고치기 · 발주확정 올리기"
      style={{
        padding: '6px 12px', fontSize: 13, fontWeight: 700, borderRadius: 8, cursor: 'pointer', whiteSpace: 'nowrap',
        border: `1.5px solid ${newCount ? RED : '#2563eb'}`, background: newCount ? RED : '#2563eb', color: '#fff',
      }}
    >
      📥 새 발주서{newCount ? ` ${newCount}건` : ''}
    </button>
  );
  // 새 발주서 창: 서허에서 새 주문을 받아 오고, 상품마다 확정수량을 고친 뒤 발주확정을 올린다.
  // 올리면 발주서가 발주확정 칸으로 넘어가서 이 창에서 빠진다.
  const newWindow = newOpen && (
    <div
      onClick={() => setNewOpen(false)}
      style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(15,23,42,0.35)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '4vh 16px' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ width: 'min(560px, 100%)', maxHeight: '92vh', display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: 14, boxShadow: '0 20px 50px rgba(0,0,0,0.25)', overflow: 'hidden' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: '1px solid #f0f0f0' }}>
          <b style={{ fontSize: 16 }}>📥 새 발주서</b>
          <span style={{ fontSize: 12, color: '#888' }}>{newCount}건 · 확정수량을 고치고 발주확정을 올려요</span>
          <button onClick={() => setNewOpen(false)} style={{ marginLeft: 'auto', border: 'none', background: 'transparent', fontSize: 20, color: '#999', cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        <div style={{ overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10, background: '#fafaf9' }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ flex: '1 1 230px' }}>{collectPanel}</div>
            {newCount > 0 && <div style={{ flex: '1 1 230px', background: '#fff7ed', borderRadius: 12, padding: 8 }}>{confirmPanel(boxes[0])}</div>}
          </div>
          {boxes[0].map(card)}
          {!newCount && <div style={{ padding: '30px 0', textAlign: 'center', fontSize: 13, color: '#aaa' }}>확정할 새 발주서가 없어요. 위 "새 주문 수집"으로 받아 오세요.</div>}
        </div>
      </div>
    </div>
  );

  const search = (
    <input
      value={query}
      onChange={e => setQuery(e.target.value)}
      placeholder="발주번호·센터·상품 찾기"
      style={{ padding: '6px 10px', fontSize: 13, border: '1px solid #e0e0e0', borderRadius: 8, minWidth: 180 }}
    />
  );
  const pageStyle: React.CSSProperties = { minHeight: '100vh', background: '#fff', color: '#1a1a1a', fontFamily: "'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif" };

  // ── 단계별 보기: 발주서마다 한 장, 위쪽 탭으로 단계 고르기 ──
  if (view === 'list') {
    const active = orders.filter(match);
    const inBoard = (o: FlowOrder) => BOARD_STAGES.includes(o.stage);
    const shown = tab === 'active' ? active.filter(inBoard) : boxes[tab];
    const tabs: { id: Stage | 'active'; label: string; n: number }[] = [
      { id: 'active', label: '진행 중 전체', n: active.filter(inBoard).length },
      ...BOARD_STAGES.map(st => ({ id: st, label: STAGES[st], n: boxes[st].length })),
    ];
    return (
      <div style={pageStyle}>
        <header style={{ background: '#fff', borderBottom: '1px solid #f0f0f0', position: 'sticky', top: 0, zIndex: 10 }}>
          <div style={{ maxWidth: 860, padding: '8px clamp(12px, 3vw, 20px)', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px 12px' }}>
            <h1 style={{ fontSize: 17, fontWeight: 800, margin: 0 }}>발주 단계별</h1>
            <span style={{ fontSize: 12, color: '#888' }}>발주서마다 지금 단계와 다음 할 일</span>
            {newButton}
            {search}
          </div>
          <div style={{ maxWidth: 860, padding: '0 clamp(12px, 3vw, 20px) 8px', display: 'flex', gap: 4, flexWrap: 'nowrap', overflowX: 'auto' }}>
            {tabs.map(t => (
              <button
                key={String(t.id)}
                onClick={() => setTab(t.id)}
                style={{
                  padding: '4px 9px', fontSize: 12, fontWeight: 700, borderRadius: 999, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                  border: `1.5px solid ${tab === t.id ? ORANGE : '#e5e5e5'}`,
                  background: tab === t.id ? ORANGE : '#fff', color: tab === t.id ? '#fff' : '#555',
                }}
              >
                {t.label} <span style={{ opacity: 0.8 }}>{t.n}</span>
              </button>
            ))}
          </div>
        </header>
        <main style={{ maxWidth: 860, padding: '12px clamp(10px, 3vw, 20px) 70px' }}>
          {!shown.length && <div style={{ padding: '48px 0', textAlign: 'center', color: '#aaa', fontSize: 14 }}>{q ? '찾는 발주서가 없어요.' : '이 단계에 있는 발주서가 없어요.'}</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{shown.map(row)}</div>
        </main>
        {layer}
        {newWindow}
        {waybillBatch && <ShipmentWaybillModal batch={waybillBatch} onClose={() => setWaybillBatch(null)} />}
      </div>
    );
  }

  // ── 상자 보기 ──
  return (
    <div style={pageStyle}>
      <header style={{ background: '#fff', borderBottom: '1px solid #f0f0f0', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ padding: '8px clamp(12px, 3vw, 20px)', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px 12px' }}>
          <h1 style={{ fontSize: 17, fontWeight: 800, margin: 0 }}>발주 진행</h1>
          <span style={{ fontSize: 12, color: '#888' }}>발주서가 지금 있는 상자 = 지금 단계</span>
          {newButton}
          {search}
        </div>
      </header>

      {/* 커다란 판 하나에 단계 칸이 옆으로 나란히(위쪽 머리줄 = 칸 제목). 발주서는 지금 단계 칸 안에 위아래 한 줄로 자리 잡는다. */}
      <main style={{ overflowX: 'auto', padding: '12px clamp(10px, 3vw, 20px) 70px' }}>
        <div style={{
          display: 'inline-grid', gridTemplateColumns: `repeat(${BOARD_STAGES.length}, 380px)`,
          border: '1.5px solid #d6d3d1', borderRadius: 12, background: '#efedea', overflow: 'hidden', alignItems: 'stretch',
        }}>
          {/* 머리줄 */}
          {BOARD_STAGES.map((i, col) => {
            const label = STAGES[i];
            const list = boxes[i];
            const stuck = i === 2 ? list.filter(o => run(o)?.state === 'error').length : 0;
            return (
              <div key={`h-${label}`} style={{
                position: 'sticky', top: 0, zIndex: 2, display: 'flex', alignItems: 'center', gap: 6, padding: '13px 14px',
                background: '#efedeb', borderBottom: '2px solid #d6d3d1', borderRight: col < BOARD_STAGES.length - 1 ? '1px solid #d6d3d1' : 'none',
              }}>
                <span style={{ fontSize: 11, color: '#a8a29e', fontWeight: 800 }}>{col + 1}</span>
                <b style={{ fontSize: 14, color: '#292524' }}>{label}</b>
                <span style={{ fontSize: 12, fontWeight: 800, color: '#fff', background: list.length ? (i === 5 ? GREEN : ORANGE) : GRAY, borderRadius: 999, padding: '0 7px' }}>{list.length}</span>
                {stuck > 0 && <span style={{ fontSize: 11.5, fontWeight: 800, color: RED }}>⛔ {stuck}</span>}
                {i === 5 && <span style={{ fontSize: 10.5, color: '#a8a29e', marginLeft: 'auto' }}>최근 {SENT_DAYS}일</span>}
              </div>
            );
          })}
          {/* 칸 */}
          {BOARD_STAGES.map((i, col) => {
            const label = STAGES[i];
            const list = boxes[i];
            return (
              <div key={`c-${label}`} style={{
                padding: '18px 14px 32px', minHeight: '78vh', display: 'flex', flexDirection: 'column', gap: 14, boxSizing: 'border-box',
                borderRight: col < BOARD_STAGES.length - 1 ? '1px solid #e7e5e4' : 'none',
              }}>
                {list.map(card)}
                {!list.length && <div style={{ padding: '18px 0', textAlign: 'center', fontSize: 12, color: '#c4c0bc' }}>{q ? '찾는 발주서 없음' : '비어 있음'}</div>}
              </div>
            );
          })}
        </div>
      </main>

      {layer}
      {newWindow}
      {waybillBatch && <ShipmentWaybillModal batch={waybillBatch} onClose={() => setWaybillBatch(null)} />}
    </div>
  );
}

// 6단계 한 줄: 끝난 단계는 초록, 지금 단계는 주황(멈췄으면 빨강), 남은 단계는 회색.
const Stepper: React.FC<{ stage: Stage; error?: boolean }> = ({ stage, error }) => (
  <div style={{ display: 'flex', flexWrap: 'nowrap', gap: 3 }}>
    {SHOWN_STEPS.map(i => {
      const label = STAGES[i];
      const done = i < stage || stage === 5;
      const now = i === stage && stage !== 5;
      const color = done ? GREEN : now ? (error ? RED : ORANGE) : GRAY;
      return (
        <span key={label} style={{
          padding: '2px 6px', fontSize: 11, fontWeight: now ? 800 : 600, flexShrink: 0, borderRadius: 999, whiteSpace: 'nowrap', textAlign: 'center',
          border: `1.5px solid ${color}`, background: now ? color : done ? '#f0fdf4' : '#fff', color: now ? '#fff' : color,
        }}>
          {done ? '✓' : ''}{label}
        </span>
      );
    })}
  </div>
);

const Tag: React.FC<{ color: string; children: React.ReactNode }> = ({ color, children }) => (
  <span style={{ padding: '1px 7px', fontSize: 10.5, fontWeight: 700, borderRadius: 999, border: `1px solid ${color}`, color, whiteSpace: 'nowrap' }}>{children}</span>
);

const btn = (color: string, solid = false): React.CSSProperties => ({
  padding: '4px 8px', fontSize: 11.5, fontWeight: 700, borderRadius: 7, cursor: 'pointer', whiteSpace: 'nowrap',
  border: `1.5px solid ${color}`, background: solid ? color : '#fff', color: solid ? '#fff' : color,
});
