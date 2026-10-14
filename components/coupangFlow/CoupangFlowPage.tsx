import React, { useEffect, useMemo, useState } from 'react';
import { readWork, subscribeWork } from '../coupangOrder/data/orderWorkCloud';
import { subscribeReservations } from '../coupangOrder/data/reservationStore';
import { ShipOut, subscribeShipOuts, shipOutStage, shipOutBatch } from '../coupangOrder/data/shipOutStore';
import { ShipmentBatch, subscribeShipments } from '../../data/shipmentStore';
import { subscribeConfirmed, setConfirmed } from '../coupangOrder/data/poConfirmStore';
import { resumeShipment, onNeedWaybill, STEP_LABEL, startShipment, fillAndUpload, subscribeLive } from '../coupangOrder/data/shipmentRunner';
import type { LiveStatus } from '../coupangOrder/data/shipmentRunner';
import { loadLocalAddresses, loadLocalSender, subscribeShippingSettings } from '../coupangOrder/data/shippingSettingsStore';
import type { AddressEntry, SenderInfo } from '../coupangOrder/types';
import ShipmentWaybillModal from '../coupangOrder/components/ShipmentWaybillModal';
import type { OrderRow } from '../coupangOrder/types';
import { dateKeyYMD, ymdSortKey } from '../coupangOrder/utils/dateUtils';
import type { AppMenuId } from '../AppSidebar';
import CollectPurchaseOrders from '../coupangOrder/CollectPurchaseOrders';
import { appendOrderFile } from '../coupangOrder/data/orderWorkStore';
import { changeLineQty } from '../coupangOrder/data/changeLineQty';
import { printShipment, setPrinted } from '../coupangSend/printShipment';
import ProductQtySummary from '../coupangOrder/components/ProductQtySummary';
import { useReady } from '../coupangOrder/data/readyStore';
import { subscribeMarks, setMark } from '../coupangOrder/data/poMarkStore';
import { useLineHanjung } from '../coupangOrder/data/useLineHanjung';
import { addShipOut, markShipOuts, splitShipOut, updateShipOutLine, mergeShipOuts, restoreOrders, readShipOuts, renameShipOutOrder } from '../coupangOrder/data/shipOutStore';
import type { ShipOutLine } from '../coupangOrder/data/shipOutStore';
import { linesAt } from '../coupangOrder/data/lineStore';
import { boxLabel, buildDisplayRows, expandBoxSplit, totalBoxCount, parseBoxNo, isBoxSplit, parseBoxSplit, joinBoxSplit } from '../coupangOrder/utils/dataProcessor';
import { LineCheckMenu, BoxPicker } from '../coupangOrder/components/OrderTable';
import { HanjungOrder, subscribeHanjung, productSummary, nameKey, makeHanjungOfficeLookup, sameName, saveHanjungOrder, assignRemaining } from '../../data/hanjungStore';
import { returnToHanjungQueue } from '../coupangOrder/data/hanjungQueueStore';
import { reservationKey } from '../coupangOrder/data/reservationStore';
import { normalizeDateValue } from '../coupangOrder/utils/dateUtils';
import { HanjungQueueItem, subscribeHanjungQueue, makePlaceLookup } from '../coupangOrder/data/hanjungQueueStore';
import { subscribePoForms, readDraft, setDraftLine, SHORT_REASONS, DEFAULT_REASON } from '../coupangOrder/data/poFormStore';
import { startConfirmUpload, subscribeConfirmJob, clearConfirmJob, ConfirmJob } from '../coupangOrder/data/poConfirmRunner';
import { subscribeDateRequests, markDateRequested, applyCurrent, DateReq, rememberRequested, requestedOf } from '../coupangOrder/data/poDateStore';
import { retargetBatches, saveShipmentBatch, allBoxes, patchShipmentBatch } from '../../data/shipmentStore';
import { useIsMobile } from '../../utils/useIsMobile';

// 발주 > 발주 진행. 단계마다 상자를 옆으로 두고, 발주서가 지금 단계의 상자 안에 담긴다(상자 안에서는 위아래 한 줄).
//   발주확정 → 묶음 → 쉽먼트(택배예약·서허 일괄등록) → 출력(문서·바코드) → 발송대기 → 발송완료
// 단계는 발주확인·예약·쉽먼트생성·발송대기 목록에서 그 발주서 줄이 어디 있는지로 계산한다.
// 한 발주서의 줄이 여러 단계에 나뉘어 있으면 가장 앞 단계의 상자에 두고 "일부만 넘어감"으로 알린다.

// 칸 이름: 1 새발주서(서허에 확정 올리기 전) → 2 발주확정(확정 끝, 쉽먼트 보내기 전) → 3 쉽먼트 → 4 출력 → 5 발송대기 → 6 발송완료
const STAGES = ['새발주서', '발주확정', '쉽먼트', '출력', '발송대기', '발송완료'] as const;
// 화면에 칸·탭으로 보여주는 단계. 새발주서는 "새 발주서" 창에서, 발송완료는 '발송완료' 메뉴에서 따로 본다.
const BOARD_STAGES: Stage[] = [1, 2, 4];
// 칸 제목에 마우스를 올리면 풍선으로 보여 주는 할 일 안내.
const STAGE_HINT: Partial<Record<Stage, string>> = {
  1: '수량 및 날짜변경 정리',
  2: '택배예약 및 쉽먼트생성',
  4: '출력하기',
};

// 마우스를 올리면 아래로 몽글몽글 뜨는 풍선글. 판 왼쪽 끝에서 잘리지 않게 제목 왼쪽에 맞춰 연다.
const HintBubble: React.FC<{ text: string; children: React.ReactNode }> = ({ text, children }) => {
  const [on, setOn] = useState(false);
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }} onMouseEnter={() => setOn(true)} onMouseLeave={() => setOn(false)}>
      {children}
      <span style={{
        position: 'absolute', top: 'calc(100% + 10px)', left: -8, zIndex: 20, pointerEvents: 'none', whiteSpace: 'nowrap',
        transformOrigin: '22px 0', transform: `translateY(${on ? 0 : -4}px) scale(${on ? 1 : 0.85})`, opacity: on ? 1 : 0,
        transition: 'opacity .18s ease, transform .22s cubic-bezier(.34,1.56,.64,1)',
        background: '#fff7ed', color: '#9a3412', border: '2px solid #fdba74', borderRadius: 16, padding: '6px 12px',
        fontSize: 12.5, fontWeight: 800, boxShadow: '0 4px 12px rgba(249,115,22,0.22)',
      }}>
        <span style={{
          position: 'absolute', top: -7, left: 22, width: 10, height: 10, background: '#fff7ed',
          borderLeft: '2px solid #fdba74', borderTop: '2px solid #fdba74', borderTopLeftRadius: 3, transform: 'rotate(45deg)',
        }} />
        ✨ {text} 🐣
      </span>
    </span>
  );
};
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
  ship?: ShipOutLine; // 쉽먼트 이후 단계 줄의 원래 출고 줄(박스 고르기에 쓴다)
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

// 같은 입고예정일·센터끼리 이어진 발주서를 한 덩어리로(목록은 이미 날짜 → 센터 순으로 정렬돼 있다).
const groupByCenterDate = (list: FlowOrder[], keyOf: (o: FlowOrder) => string = o => `${o.date}|${o.center.trim()}`) => {
  const groups: { key: string; date: string; center: string; list: FlowOrder[] }[] = [];
  for (const o of list) {
    const key = keyOf(o);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.list.push(o);
    else groups.push({ key, date: o.date, center: o.center.trim(), list: [o] });
  }
  return groups;
};

// view: 'board' = 단계마다 상자를 옆으로(발주 진행 메뉴), 'list' = 발주서마다 단계 한 줄(발주 단계별 메뉴). 내용은 같다.
export default function CoupangFlowPage({ onNavigate, view = 'board' }: { onNavigate: (menu: AppMenuId) => void; view?: 'board' | 'list' }) {
  const [tab, setTab] = useState<Stage | 'active'>('active');
  // 휴대폰: 단계 칸을 옆으로 나누면 상품명이 안 보여서, 위 탭으로 한 칸만 화면 가득 보여 준다.
  const isMobile = useIsMobile();
  const [mobileStage, setMobileStage] = useState<Stage>(BOARD_STAGES[0]);
  // 새 발주서 창(새 주문 수집 · 확정수량 고치기 · 발주확정 올리기)
  const [newOpen, setNewOpen] = useState(false);
  // 인쇄 아이콘 옆 작은 체크칸(사람이 쓰는 표시, 켜면 그대로 남는다).
  const [marks, setMarks] = useState<Set<string>>(new Set());
  useEffect(() => subscribeMarks(setMarks), []);
  // 남은 수량 배정 창(미배정 N을 눌렀을 때)
  const [assignFor, setAssignFor] = useState<{ o: FlowOrder; l: FlowLine; left: number } | null>(null);
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
  // 상자 머리의 번호 모음을 펼친 상자들.
  const [openSum, setOpenSum] = useState<Set<string>>(new Set());
  const copyNo = (label: string, v: string) => navigator.clipboard.writeText(v).then(() => setDateNote({ tone: 'ok', text: `${label} ${v} 복사했어요` })).catch(() => {});
  // 상자에 든 발주번호·송장번호·쉽먼트번호(겹치지 않게).
  const summaryOf = (list: FlowOrder[]) => ({
    orders: list.map(o => o.no),
    waybills: Array.from(new Set(list.flatMap(o => (o.item && o.batch && o.item.batchId === o.batch.id)
      ? allBoxes(o.batch).filter(b => b.lines.some(l => String(l.발주번호 || '').trim() === o.no)).map(b => (b.waybill || '').trim())
      : []).filter(Boolean))),
    ships: Array.from(new Set(list.map(o => o.item?.shipmentNos?.[o.no] || '').filter(Boolean))),
    // 쉽먼트 기록에서 이 상자 발주서가 든 박스 수.
    boxes: new Set(list.flatMap(o => o.batch ? allBoxes(o.batch)
      .filter(b => b.lines.some(l => String(l.발주번호 || '').trim() === o.no)).map(b => `${o.batch!.id}|${b.center}|${b.boxNo}`) : [])).size,
  });
  // 박스 나누기 창(한 상품을 박스 여러 개에 나눠 담기). 쉽먼트생성 화면의 창과 같다.
  const [splitting, setSplitting] = useState<{ itemId: string; line: ShipOutLine; total: number; boxMax: number; pieces: { no: number; qty: string }[] } | null>(null);
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
  const PICKABLE: Stage[] = [1, 2, 4];
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
      if (d.type === 'PO_DATE_REQUESTED' && d.data) rememberRequested(d.data);
      if (d.type === 'SHUB_FIND_ACK' && !d.ok) setDateNote({ tone: 'error', text: `서허 창을 열지 못했어요: ${d.error || ''} (확장 프로그램을 새로고침해 주세요)` });
      if (d.type === 'SHUB_UPLOAD_STATUS' && d.batchId === 'lookup') {
        const found = Object.values(d.byOrder || {}).filter(Boolean).length;
        setDateNote({ tone: d.step === 'error' ? 'error' : d.step === 'done' ? 'ok' : 'info', text: d.step === 'done' ? `쉽먼트 번호 ${found}건 찾았어요. 이제 🖨 출력을 누르세요.` : (d.status || '') });
      }
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
    // 확장이 기억해 둔 요청 내용(변경 센터·날짜)을 받아 둔다.
    window.postMessage({ source: 'rocket-app-hub', type: 'PO_DATE_REQUESTED_GET' }, window.location.origin);
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
    const picks: string[] = Array.from(picked);
    if (!picks.length) return;
    // 서허 요청 등록 때 기억한 변경 센터·날짜가 있으면 그 값으로 바로 바꾼다(승인을 확인한 뒤 누르는 버튼이므로).
    const known = picks.filter(no => requestedOf(no));
    if (known.length) {
      const values = Object.fromEntries(known.map(no => [no, requestedOf(no)!]));
      const list = known.map(no => `· ${no} → ${values[no].date || '날짜 그대로'} ${values[no].center || '센터 그대로'}`);
      if (!window.confirm(`서허 요청 때 적은 값으로 바꿀까요?(승인을 확인했을 때만)\n\n${list.join('\n')}`)) return;
      applyCurrent(known, values).then(res => {
        for (const m of res.moved) {
          for (const next of retargetBatches(batchesRef.current, m.before, m.to, shipOutBatch(m.before, batchesRef.current))) {
            saveShipmentBatch(next).catch(err => console.error('쉽먼트 기록 옮기기 실패:', err));
          }
        }
        const rest = picks.filter(no => !known.includes(no));
        setDateNote({
          tone: rest.length ? 'info' : 'ok',
          text: `✅ ${res.changed.length}건 바꿨어요.` + (res.same.length ? ` 이미 같은 값 ${res.same.length}건.` : '') + (rest.length ? ` 요청 내용을 모르는 발주서 ${rest.length}건(${rest.join(', ')})은 서허 요청 등록 때 확장이 기억하지 못했어요.` : ''),
        });
        setPicked(new Set());
      }).catch(err => setDateNote({ tone: 'error', text: `적용하지 못했어요: ${err instanceof Error ? err.message : String(err)}` }));
      return;
    }
    const nos = picks;
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
  // 택배예약 → 서허 일괄등록 자동 진행(shipmentRunner). 보내는사람·택배주소는 쉽먼트생성 화면 설정 그대로 쓴다.
  const [addresses, setAddresses] = useState<AddressEntry[]>(loadLocalAddresses);
  const [sender, setSender] = useState<SenderInfo>(loadLocalSender);
  useEffect(() => subscribeShippingSettings(({ addresses, sender }) => { setAddresses(addresses); setSender(sender); }), []);
  const [live, setLive] = useState<LiveStatus | null>(null);
  useEffect(() => subscribeLive(setLive), []);

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
        // 쉽먼트 끝 + 출력완료면 발송대기. 사람이 "발송대기로"를 눌렀으면(doneAt) 출력 전이어도 발송대기.
        const stage: Stage = st === 'sent' ? 5 : st === 'waiting' && ((item.printedOrders || []).includes(no) || !!item.doneAt) ? 4 : 2;
        add(no, item.center, item.date,
          { 상품이름: l.상품이름, 확정수량: l.확정수량, stage, where: `${item.bundle} (${item.id})`, ship: l },
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
  // 상품 줄이 준비됐는지(카드에서 줄 긋는 것과 같은 기준): 준비 체크했거나, 맡긴 한중발주에 그 상품이 다 도착.
  const lineIsReady = (o: FlowOrder, l: FlowLine) => {
    const key = { 발주번호: o.no, 상품이름: l.상품이름, 확정수량: l.확정수량 };
    if (ready.isReady(key, o.item?.readyKeys)) return true;
    const places = placesOf(key);
    // 맡긴 수량이 줄 수량에 못 미치면(일부만 배정) 준비된 게 아니다.
    if (places.reduce((n, p) => n + p.qty, 0) < (Number(l.확정수량) || 0)) return false;
    return places.length > 0 && places.every(p => {
      if (!p.code) return false;
      const a = hjArrived.get(`${p.code}│${nameKey(l.상품이름)}`);
      return !!a && a.received >= a.ordered;
    });
  };
  const allReady = (o: FlowOrder) => o.lines.length > 0 && o.lines.every(l => lineIsReady(o, l));
  const boxes = STAGES.map((_, i) => {
    const list = orders.filter(o => o.stage === i && match(o));
    if (i === 5) list.sort((a, b) => (b.item?.sentDate || '').localeCompare(a.item?.sentDate || ''));
    // 쉽먼트: 발주확정에서 막 넘어온 것(출고 건을 늦게 만든 것)이 위로. 준비됨·재고에서 쓰기·체크칸 같은
    // 상태가 바뀌어도 자리는 움직이지 않는다(그 안에서는 원래 순서).
    // 쉽먼트: 입고예정일이 빠른(급한) 것이 위로. 같은 날이면 센터 → 출고 건 순으로 붙여서 덩어리가 흩어지지 않게.
    if (i === 2) list.sort((a, b) =>
      ymdSortKey(a.item?.date || a.date) - ymdSortKey(b.item?.date || b.date)
      || (a.item?.center || a.center).localeCompare(b.item?.center || b.center, 'ko', { numeric: true })
      || (a.item?.createdAt || 0) - (b.item?.createdAt || 0)
      || (a.item?.id || a.no).localeCompare(b.item?.id || b.no));
    // 발송대기: 늦게 넘어온 것이 위, 먼저 넘어온 것은 아래로 쌓인다(넘어온 때 = 발송대기로 누른 때, 없으면 서허 등록 때).
    if (i === 4) {
      const at = (o: FlowOrder) => o.item?.doneAt || o.item?.uploadedAt || o.item?.createdAt || 0;
      // 같은 택배예약(쉽먼트 기록)끼리 붙어 있게: 예약 안의 가장 늦은 때로 덩어리 순서를 정한다.
      const groupAt = new Map<string, number>();
      list.forEach(o => { const k = o.item?.batchId || o.item?.id || o.no; groupAt.set(k, Math.max(groupAt.get(k) || 0, at(o))); });
      const keyOf = (o: FlowOrder) => o.item?.batchId || o.item?.id || o.no;
      list.sort((a, b) => (groupAt.get(keyOf(b))! - groupAt.get(keyOf(a))!) || keyOf(a).localeCompare(keyOf(b)) || at(b) - at(a));
    }
    return list;
  });

  const confirm1 = (nos: string[], on: boolean) =>
    setConfirmed(nos, on).catch(err => alert(`발주확정 표시 저장 실패: ${err instanceof Error ? err.message : String(err)}`));

  const run = (o: FlowOrder) => o.stage === 2 ? o.batch?.run : undefined;
  // 택배예약을 한 발주서인지: 쉽먼트 번호가 있거나, 그 출고 건의 쉽먼트 기록 박스에 이 발주서가 실제로 들어 있을 때.
  // (박스가 없어 기록에서 빠진 발주서는 예약 안 한 것으로 보고 다시 예약할 수 있게)
  const reservedOrder = (o: FlowOrder) => !!o.item && (!!o.item.shipmentNos?.[o.no] || (!!o.item.batchId && !!o.batch && o.batch.id === o.item.batchId
    && allBoxes(o.batch).some(b => b.lines.some(l => String(l.발주번호 || '').trim() === o.no))));

  // 상자마다 다음에 할 일 버튼.
  const action = (o: FlowOrder) => {
    const r = run(o);
    switch (o.stage) {
      case 0:
        // 올리기는 상자 위 "발주확정 올리기"로 한꺼번에. 여기는 서허에서 직접 확정한 발주서를 표시만 할 때.
        return <button style={btn('#6b7280')} onClick={() => confirm1([o.no], true)} title="서허에서 직접 확정했으면 눌러서 발주확정 칸으로 넘깁니다">직접 확정함</button>;
      case 1:
        // 쉽먼트로 보내기는 발주서를 고르면 아래쪽 메뉴에 나온다.
        return null;
      case 2:
        // 인쇄는 발주번호 옆 아이콘. 여기는 쉽먼트가 멈췄을 때 이어서 하기만.
        // 진행 중인 채로 3분 넘게 소식이 없으면(확장이 답을 안 줌) 멈춘 것으로 보고 이어서 하기를 보인다.
        // 진행 중이어도 늘 보인다(멈췄는지 기다리지 않고 바로 다시 할 수 있게). 지운 표시는 그 진행 기록(시각)에만 해당한다.
        if (o.item?.shipmentNos?.[o.no] || !o.item || !o.batch || !r || r.state === 'done' || o.batch.resumeHiddenFor === `${r.step}|${r.state}|${r.at}`) return null;
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <button style={btn(ORANGE, true)} onClick={() => resumeShipment(o.batch!, [o.item!])} title="멈춘 데서 이어서 합니다. 택배예약은 다시 하지 않아요.">▶ 이어서 하기</button>
            {(r.step === 'form' || r.step === 'upload') && (
              <button style={btn('#2980b9')} onClick={() => pickFormFile(o.batch!.id)} title="다운로드 폴더의 서허 양식(쉽먼트양식_… 또는 서허에서 받은 양식)을 골라 채우고 서허에 올려요">양식 직접 고르기</button>
            )}
            <button title="이어서 하기 버튼 지우기" onClick={() => patchShipmentBatch(o.batch!.id, { resumeHiddenFor: `${r.step}|${r.state}|${r.at}` }).catch(err => alert(`지우기 실패: ${err?.message || err}`))}
              style={{ border: 'none', background: 'transparent', color: '#9ca3af', cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: 0 }}>×</button>
          </span>
        );
      case 3:
      case 4:
        // 발송완료로 넘기기는 발주서를 고르면 아래쪽 메뉴에 나온다.
        return null;
      default:
        return <span style={{ fontSize: 12, color: GREEN, fontWeight: 700 }}>{dayText(o.item?.sentDate || '')} 발송</span>;
    }
  };

  // ── 카드 조각들(상자 보기·단계별 보기가 같이 쓴다) ──
  // 입고예정일·센터를 가장 크게, 그 아래 발주번호.
  // 발주번호 줄(+쉽먼트 번호·인쇄·체크칸) + 송장번호 줄. 카드 머리와 날짜·센터 덩어리 안에서 같이 쓴다.
  const subLine = (o: FlowOrder) => (
    <>
      <div style={{ fontSize: 11.5, color: '#888', marginTop: 2 }}>
        {/* 발주번호만 따로 감싼다: 앱 전체의 "발주번호 누르면 복사"(utils/copyOrderNo)가 글자가 번호 하나일 때만 복사한다. */}
        발주 <span title="눌러서 발주번호 복사" style={{ cursor: 'copy', textDecoration: 'underline dotted', textUnderlineOffset: 2 }}>{o.no}</span>
        {/* 쉽먼트·발송대기 칸: 쉽먼트 번호와 인쇄 아이콘을 같은 줄에 */}
        {o.stage >= 2 && o.item?.shipmentNos?.[o.no] && (
          <span style={{ marginLeft: 10 }}>쉽먼트 <span
            title="눌러서 쉽먼트 번호 복사"
            onClick={() => { const v = o.item!.shipmentNos![o.no]; navigator.clipboard.writeText(v).then(() => setDateNote({ tone: 'ok', text: `쉽먼트 번호 ${v} 복사했어요` })).catch(() => {}); }}
            style={{ cursor: 'copy', textDecoration: 'underline dotted', textUnderlineOffset: 2 }}
          >{o.item.shipmentNos[o.no]}</span></span>
        )}
        {(o.stage === 2 || o.stage === 4) && o.item && <span style={{ marginLeft: 8 }}>{printButton(o)}</span>}
        {(o.stage === 2 || o.stage === 4) && o.item && (
          <input
            type="checkbox" checked={marks.has(o.no)} onChange={e => setMark(o.no, e.target.checked)}
            title="체크 표시(켜 두면 그대로 남아요)"
            style={{ width: 13, height: 13, marginLeft: 4, verticalAlign: 'middle', cursor: 'pointer', accentColor: '#6b7280' }}
          />
        )}
      </div>
      {/* 쉽먼트 이후: 이 발주서가 든 박스의 운송장번호(이 출고 건의 쉽먼트 기록에서). 누르면 복사. */}
      {o.stage >= 2 && o.item && o.batch && o.item.batchId === o.batch.id && (() => {
        const waybills = Array.from(new Set(allBoxes(o.batch).filter(b => b.lines.some(l => String(l.발주번호 || '').trim() === o.no)).map(b => (b.waybill || '').trim()).filter(Boolean)));
        if (!waybills.length) return null;
        return (
          <div style={{ fontSize: 11.5, color: '#6b7280', marginTop: 2 }}>
            송장 {waybills.map((w, i) => (
              <span key={w}>
                {i > 0 && ', '}
                <span title="눌러서 송장번호 복사" style={{ cursor: 'copy', textDecoration: 'underline dotted', textUnderlineOffset: 2 }}
                  onClick={() => navigator.clipboard.writeText(w).then(() => setDateNote({ tone: 'ok', text: `송장번호 ${w} 복사했어요` })).catch(() => {})}>{w}</span>
                {/* 롯데 ALPS에서 이 송장을 다시 출력(미리보기 창까지 열고 표준라벨E로 골라 둔다). */}
                {reprintIcon(w, o.date)}
              </span>
            ))}
          </div>
        );
      })()}
    </>
  );
  // 발주확정·쉽먼트 줄의 확정수량 고치기. 준비됨 ✓·한중발주 배정·장바구니도 새 수량으로 같이 옮긴다.
  const editQty = async (o: FlowOrder, l: FlowLine) => {
    const cur = Number(l.확정수량) || 0;
    const input = prompt(`${l.상품이름}\n확정수량을 몇 개로 바꿀까요? (지금 ${cur}개)`, String(cur));
    if (input == null) return;
    const n = Math.floor(Number(input.trim()));
    if (!Number.isFinite(n) || n < 1 || String(n) !== input.trim()) { alert('1 이상의 숫자로 적어 주세요.'); return; }
    if (n === cur) return;
    const key = { 발주번호: o.no, 상품이름: l.상품이름, 확정수량: l.확정수량 };
    try {
      await changeLineQty(key, n, {
        shipOutId: o.stage === 2 ? o.item?.id : undefined,
        wasReady: ready.isReady(key, o.item?.readyKeys),
        hjOrders, hjQueue,
      });
      setDateNote({ tone: 'ok', text: `${o.no} · ${l.상품이름} 확정수량 ${cur}개 → ${n}개로 바꿨어요` });
    } catch (err) {
      alert(`수량을 바꾸지 못했어요: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  // 롯데 ALPS에서 이 송장을 다시 출력(미리보기 창까지 열고 표준라벨E로 골라 둔다).
  const reprintIcon = (w: string, edd: string) => (
    <span title="롯데택배에서 이 송장 출력 창 열기" style={{ cursor: 'pointer', marginLeft: 3 }}
      onClick={() => {
        window.postMessage({ source: 'rocket-app-hub', type: 'LOTTE_REPRINT', waybill: w, edd }, window.location.origin);
        setDateNote({ tone: 'ok', text: `롯데택배 창을 열어 송장 ${w}를 찾는 중이에요` });
      }}>🖨</span>
  );
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
      {subLine(o)}
    </div>
  );
  const tags = (o: FlowOrder) => {
    // 요청 표시는 날짜 바꾸기를 눌렀거나(at) 서허 요청 등록 때 확장이 값을 기억했을 때(want).
    const req = !!dateReqs[o.no] && !dateReqs[o.no].doneAt && !dateReqs[o.no].dismissedAt;
    const changedDate = dateReqs[o.no]?.doneAt ? dateReqs[o.no] : null;
    if (!((o.hold && o.stage === 1) || o.partial || req || changedDate)) return null;
    return (
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
        {req && (() => {
          const w = dateReqs[o.no]?.want;
          return <Tag color="#7c3aed">📅 날짜 변경 요청 중{w ? ` → ${w.date ? dayText(w.date) : ''} ${w.center || ''}` : ''}</Tag>;
        })()}
        {changedDate && (
          <span title={`${changedDate.from} → ${changedDate.to}`} style={{ fontSize: 10.5, color: GREEN, fontWeight: 700 }}>✓ 날짜변경완료</span>
        )}
        {req && (
          <button onClick={() => { if (window.confirm(`${o.no}의 날짜 변경 요청 표시를 지울까요?(서허 요청은 그대로예요)`)) markDateRequested([o.no], false); }}
            style={{ padding: 0, border: 'none', background: 'transparent', color: '#aaa', fontSize: 10.5, cursor: 'pointer', textDecoration: 'underline' }}>
            표시 지우기
          </button>
        )}
        {o.hold && o.stage === 1 && <Tag color="#7c3aed">{o.hold}</Tag>}
        {o.partial && <Tag color={RED}>일부만 넘어감</Tag>}
      </div>
    );
  };
  const runNote = (o: FlowOrder) => {
    const r = run(o);
    if (!r || r.state === 'done' || r.hidden || o.batch?.noteHiddenFor === `${r.step}|${r.state}`) return null;
    const batchId = o.batch!.id;
    return (
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 6,
        padding: '5px 7px', borderRadius: 6, fontSize: 11.5, lineHeight: 1.45,
        background: r.state === 'error' ? '#fef2f2' : '#eff6ff', color: r.state === 'error' ? '#b91c1c' : '#1d4ed8',
      }}>
        <span style={{ flex: 1 }}><b>{r.state === 'error' ? `⛔ ${STEP_LABEL[r.step]}에서 멈춤` : `⏳ ${STEP_LABEL[r.step]} 하는 중`}</b> · {r.message}</span>
        <button title="이 안내문 닫기" onClick={() => patchShipmentBatch(batchId, { noteHiddenFor: `${r.step}|${r.state}` }).catch(err => alert(`닫기 실패: ${err?.message || err}`))}
          style={{ border: 'none', background: 'transparent', color: '#9ca3af', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
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
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                {o.stage === 2 && l.stage === 2 && l.ship && o.item && (() => {
                  // 박스: 택배예약 전에는 고를 수 있고, 예약한 뒤에는 보기만.
                  const item = o.item!;
                  const v = l.ship!.쉼먼트 || '';
                  const maxNo = Math.max(1, ...shipOuts.filter(x => x.center.trim() === item.center.trim() && x.date === item.date).flatMap(x => x.lines).map(x => isBoxSplit(x.쉼먼트 || '') ? Math.max(...parseBoxSplit(x.쉼먼트 || '').map(p => p.no)) : parseBoxNo(x.쉼먼트 || '') || 0));
                  const splitText = isBoxSplit(v) ? parseBoxSplit(v).map(p => `${p.no}번×${p.qty}`).join(' ') : '';
                  if (o.item?.shipmentNos?.[o.no]) {
                    const text = splitText || (parseBoxNo(v) ? `박스 ${parseBoxNo(v)}` : '');
                    return text ? <span style={{ flexShrink: 0, fontSize: 11, color: '#6b7280', whiteSpace: 'nowrap' }}>{text}</span> : null;
                  }
                  const openSplit = () => {
                    const total = Number(l.ship!.확정수량) || 0;
                    const now = isBoxSplit(v) ? parseBoxSplit(v) : [{ no: parseBoxNo(v) || 1, qty: total }];
                    const nextNo = Math.min(9, Math.max(maxNo, ...now.map(p => p.no)) + 1);
                    setSplitting({ itemId: item.id, line: l.ship!, total, boxMax: maxNo, pieces: [...now.map(p => ({ no: p.no, qty: String(p.qty) })), ...(isBoxSplit(v) ? [] : [{ no: nextNo, qty: '' }])] });
                  };
                  if (splitText) {
                    return (
                      <span onClick={openSplit} title="눌러서 박스 나누기 고치기"
                        style={{ flexShrink: 0, fontSize: 11, color: '#e67e22', fontWeight: 700, whiteSpace: 'nowrap', cursor: 'pointer', textDecoration: 'underline dotted' }}>
                        {splitText}
                      </span>
                    );
                  }
                  return (
                    <span style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                      <BoxPicker value={v} maxNo={maxNo} allowNone={false} compact
                        onChange={nv => updateShipOutLine(item.id, { 발주번호: l.ship!.발주번호, 상품이름: l.ship!.상품이름, 확정수량: l.ship!.확정수량, 입고예정일: l.ship!.입고예정일 }, { 쉼먼트: nv })} />
                      <button onClick={openSplit} title="이 상품을 박스 여러 개에 나눠 담기"
                        style={{ border: '1px solid #e5e7eb', background: '#fff', borderRadius: 6, padding: '1px 5px', fontSize: 11, cursor: 'pointer', color: '#6b7280' }}>✂</button>
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
                  // 한중으로 다 도착: 맡긴 곳이 모두 한중발주이고 다 도착했고, 맡긴 수량이 줄 수량을 다 채울 때만.
                  const placedQty = places.reduce((n, p) => n + p.qty, 0);
                  const arrived = places.length > 0 && placedQty >= (Number(l.확정수량) || 0) && places.every(p => p.code && !coming.includes(p));
                  const isReady = ready.isReady(key, o.item?.readyKeys) || arrived;
                  const waitingQueue = places.some(p => !p.code);
                  const faded = isReady || coming.length > 0;
                  // 상품 이름을 누르면 준비됨 · 한중발주 배정 · 사무실 재고 메뉴(예전 체크칸 대신).
                  const nameEl = (
                    <span
                      title={`${l.상품이름}\n${isReady ? '준비됨' : coming.length ? `입고중(한중발주 ${coming.map(p => p.code).join(', ')})` : waitingQueue ? '1688 주문하기' : '준비중'} — 눌러서 준비됨·한중발주 배정`}
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
                      {/* 장바구니(1688 주문하기)에 든 몫: 주황 동그라미 장바구니 */}
                      {waitingQueue && !isReady && (
                        <span title="1688 주문하기(장바구니)에 담겨 있어요" style={{
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16, marginRight: 4,
                          borderRadius: '50%', background: ORANGE, verticalAlign: 'middle',
                        }}>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="9" cy="20" r="1.6" /><circle cx="18" cy="20" r="1.6" /><path d="M2 3h3l2.6 12.4a1 1 0 0 0 1 .8h9.7a1 1 0 0 0 1-.8L21 7H6" />
                          </svg>
                        </span>
                      )}
                      {l.상품이름}
                    </span>
                  );
                  if (o.stage === 0) return nameEl;
                  const hl = { 발주번호: o.no, 물류센터: o.center, 상품이름: l.상품이름, 확정수량: l.확정수량, 입고예정일: o.date, 메모: '', 쉼먼트: '' };
                  return (
                    <LineCheckMenu
                      ready={ready.isReady(key, o.item?.readyKeys)}
                      hanjung={lineHj.hanjungOf(hl)}
                      onReady={v => ready.setReady([key], v).catch(err => alert(`준비 표시 저장 실패: ${err?.message || err}`))}
                      onHanjung={action => { lineHj.setLineHanjung(hl, action, () => ready.setReady([key], true).catch(() => {})); }}
                      trigger={nameEl}
                      triggerStyle={{ flex: 1, minWidth: 0, display: 'flex' }}
                    />
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
                  (() => {
                    // 오른쪽: 주문수량 (배정 N · 사무실+오는 중). 배정·대기·미배정과 사무실 재고를 괄호 안에 같이 보여준다.
                    const key = { 발주번호: o.no, 상품이름: l.상품이름, 확정수량: l.확정수량 };
                    const places = placesOf(key);
                    const assigned = places.filter(p => p.code).reduce((n, p) => n + p.qty, 0);
                    const queued = places.filter(p => !p.code).reduce((n, p) => n + p.qty, 0);
                    const isReadyLine = ready.isReady(key, o.item?.readyKeys);
                    // 일부만 맡겼으면 남은 수량을 빨갛게 알린다(준비됨으로 체크한 줄은 빼고).
                    const left = Math.max(0, (Number(l.확정수량) || 0) - assigned - queued);
                    const showLeft = (assigned > 0 || queued > 0) && left > 0 && !isReadyLine;
                    const office = officeOf(l.상품이름);
                    const arrived = office.qty || 0;
                    const incoming = office.incoming || 0;
                    // 사무실 재고는 0이어도 늘 보여준다(0+0).
                    const hasOffice = true;
                    // 사무실 숫자 색: 이 줄에 아직 채울 게 남았을 때만(이미 다 맡겼거나 준비됨이면 회색).
                    const need = Math.max(0, (Number(l.확정수량) || 0) - assigned - queued);
                    const covered = need === 0 || isReadyLine;
                    const officeColor = covered ? '#a8a29e' : arrived >= need ? GREEN : arrived + incoming >= need ? '#d97706' : RED;
                    const hasParen = assigned > 0 || queued > 0 || hasOffice;
                    return (
                      <span style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'baseline', gap: 3, whiteSpace: 'nowrap', letterSpacing: '-0.3px' }}>
                        {(o.stage === 1 || o.stage === 2) && l.stage === o.stage
                          ? <b onClick={() => editQty(o, l)} title="눌러서 확정수량 고치기(서허 요청등록에서 수량을 바꿨을 때)"
                              style={{ cursor: 'pointer', textDecoration: 'underline dotted', textUnderlineOffset: 2 }}>{l.확정수량}개</b>
                          : <b>{l.확정수량}개</b>}
                        {hasParen && (
                          <span
                            title={[
                              assigned ? `배정: ${places.filter(p => p.code).map(p => `${p.code} ${p.qty}개`).join(', ')}` : '',
                              queued ? `1688 주문하기 ${queued}개` : '',
                              showLeft ? `남은 ${left}개를 배정해 주세요 — "미배정"을 누르면 남은 수량만 배정해요` : '',
                              hasOffice ? `사무실 재고(한중 여유) · 도착 ${arrived}개 · 오는 중 ${incoming}개\n${office.names.join('\n')}` : '',
                            ].filter(Boolean).join('\n')}
                            style={{ fontSize: 11, color: '#8a857f', whiteSpace: 'nowrap', flexShrink: 0 }}
                          >
                            (
                            {assigned ? <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#8a857f" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: '-1px', marginRight: 1 }}><path d="M20 6 9 17l-5-5" /></svg><b>{assigned}</b></> : null}
                            {queued ? <>{assigned ? ' · ' : ''}<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={ORANGE} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: '-1px', marginRight: 1 }}><circle cx="9" cy="20" r="1.6" /><circle cx="18" cy="20" r="1.6" /><path d="M2 3h3l2.6 12.4a1 1 0 0 0 1 .8h9.7a1 1 0 0 0 1-.8L21 7H6" /></svg><b>{queued}</b></> : null}
                            {showLeft && <> · <b onClick={() => setAssignFor({ o, l, left })} style={{ color: RED, cursor: 'pointer', textDecoration: 'underline dotted', textUnderlineOffset: 2 }}>미배정 {left}</b></>}
                            {hasOffice && <>{assigned || queued ? ' · ' : ''}<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={officeColor} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', verticalAlign: '-1px', marginRight: 1 }}><path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16" /><path d="M15 10h4a1 1 0 0 1 1 1v10" /><path d="M2 21h20M8 8h3M8 12h3M8 16h3" /></svg><b style={{ color: officeColor }}>{arrived}</b>{' · '}<svg width="11" height="11" viewBox="0 0 24 24" fill={covered || !incoming ? '#a8a29e' : '#d97706'} style={{ display: 'inline-block', verticalAlign: '-1px', marginRight: 1 }}><path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z" /></svg><b style={{ color: covered || !incoming ? '#a8a29e' : '#d97706' }}>{incoming}</b></>}
                            )
                          </span>
                        )}
                      </span>
                    );
                  })()
                )}
              </div>
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
    // 아이콘 색은 늘 회색. 출력완료면 아이콘 아래 종이 부분을 채워서 구분한다.
    const color = '#6b7280';
    return (
      <button
        onClick={() => {
          // 쉽먼트 번호가 없으면(서허 일괄등록을 직접 한 건) 서허 택배 쉽먼트 화면에서 찾아 온다.
          // 쉽먼트 칸에서 번호 없는 발주서를 한꺼번에 찾는다.
          if (!shipNo) {
            const nos = orders.filter(x => (x.stage === 2 || x.stage === 4) && x.item && !x.item.shipmentNos?.[x.no]).map(x => x.no);
            if (!window.confirm(`쉽먼트 번호가 없어서 출력할 수 없어요.\n서허 택배 쉽먼트 화면에서 발주서 ${nos.length}건의 쉽먼트 번호를 찾아 올까요?\n(서허 일괄등록이 끝난 건만 찾을 수 있어요)`)) return;
            setDateNote({ tone: 'info', text: `서허에서 쉽먼트 번호 찾는 중… (발주서 ${nos.length}건)` });
            window.postMessage({ source: 'rocket-app-hub', type: 'SHUB_FIND_SHIPMENTS', orderNos: nos }, window.location.origin);
            return;
          }
          if (printed && !window.confirm(`발주 ${o.no}은 이미 출력했어요. 다시 출력할까요?`)) return;
          printShipment(item, o.no, shipNo, t => setPrintNote(n => ({ ...n, [o.no]: t })));
        }}
        onContextMenu={e => {
          // 오른쪽 클릭: 출력완료 표시를 켜고 끈다(직접 출력했을 때).
          e.preventDefault();
          if (window.confirm(printed ? `발주 ${o.no}의 출력완료 표시를 풀까요?` : `발주 ${o.no}을 출력완료로 표시할까요?`)) setPrinted(item, o.no, !printed);
        }}
        title={!shipNo ? '쉽먼트 번호가 없어요. 눌러서 서허에서 찾아 와요(일괄등록을 서허에서 직접 한 건)'
          : printed ? '출력완료(초록). 누르면 다시 출력. 오른쪽 클릭: 출력완료 풀기'
          : '문서(Label·내역서)와 바코드 라벨을 새 탭에 열어요. 오른쪽 클릭: 출력완료로만 표시'}
        style={{ display: 'inline-flex', alignItems: 'center', padding: 2, border: 'none', background: 'transparent', cursor: 'pointer', lineHeight: 0, verticalAlign: 'middle' }}
      >
        {/* 프린터 아이콘(회색): 종이 부분이 채워져 있으면 출력완료 */}
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9V3h12v6" />
          <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
          <rect x="6" y="14" width="12" height="7" rx="1" fill={printed ? color : 'none'} />
        </svg>
      </button>
    );
  };

  // 상자째 출력: 쉽먼트 번호마다 한 번씩(같은 쉽먼트면 문서가 같다). 바코드는 그 쉽먼트 발주서 상품을 한 장에.
  const printBox = (key: string, list: FlowOrder[]) => {
    const withItem = list.filter(o => o.item);
    const byShip = new Map<string, FlowOrder[]>();
    withItem.forEach(o => { const s = o.item!.shipmentNos?.[o.no]; if (s) byShip.set(s, [...(byShip.get(s) || []), o]); });
    if (!byShip.size) return;
    if (withItem.length && withItem.every(o => marks.has(o.no)) && !window.confirm('이 상자는 이미 출력완료예요. 다시 출력할까요?')) return;
    byShip.forEach((os, ship) => {
      const nos = os.map(o => o.no);
      const items = Array.from(new Map(os.map(o => [o.item!.id, o.item!])).values());
      const item = { ...items[0], lines: items.flatMap(it => it.lines) };
      printShipment(item, nos[0], ship, t => setPrintNote(n => ({ ...n, [key]: t })), nos, () => nos.forEach(no => setMark(no, true)));
    });
  };

  // 카드 아래 단추 줄(할 일이 없으면 줄을 안 그린다).
  const actionRow = (o: FlowOrder) => {
    const act = action(o);
    const note = printNote[o.no] && (o.stage === 2 || o.stage === 4) ? <div style={{ fontSize: 11, color: '#1d4ed8' }}>{printNote[o.no]}</div> : null;
    if (!act && !note) return null;
    return (
      <>
        {note}
        {act && <div style={{ display: 'flex', gap: 4, flexWrap: 'nowrap', alignItems: 'center' }}>{act}</div>}
      </>
    );
  };
  const borderOf = (o: FlowOrder) => picked.has(o.no) ? `2px solid ${ORANGE}` : `1px solid ${run(o)?.state === 'error' ? '#fca5a5' : '#ececec'}`;

  // 상자 보기 카드: 상자 폭에 맞춰 위아래로.
  const card = (o: FlowOrder) => {
    // 발주확정·쉽먼트·발송대기에서 상품이 다 준비된 발주서는 초록 테두리·띠 + 연한 초록 바탕으로 확 구분한다.
    const done = (o.stage === 1 || o.stage === 2 || o.stage === 4) && allReady(o);
    const err = run(o)?.state === 'error';
    return (
    // 카드끼리 잘 구분되게: 테두리 + 그림자 + 왼쪽 색 띠(고른 건 주황, 멈춘 건 빨강, 다 준비된 건 초록).
    <div key={o.no} style={{
      background: done ? '#f0faf3' : '#fff', borderRadius: 10, padding: '10px 12px 10px 14px', boxShadow: '0 2px 6px rgba(0,0,0,0.10)',
      border: picked.has(o.no) ? `2px solid ${ORANGE}` : done ? `2px solid ${GREEN}` : `1px solid ${err ? '#f87171' : '#b8b2ab'}`,
      borderLeft: `5px solid ${picked.has(o.no) ? ORANGE : err ? RED : done ? GREEN : '#a8a29e'}`,
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      {headInfo(o, 17)}
      {tags(o)}
      {runNote(o)}
      <div style={{ fontSize: 13.5, borderTop: '1px solid #f3f3f3', paddingTop: 5 }}>{products(o)}</div>
      {actionRow(o)}
    </div>
    );
  };

  // 날짜·센터 덩어리 안의 발주서: 날짜·센터는 덩어리 머리줄에 있으니 빼고 "발주번호 → 상품목록"만.
  // once: 쉽먼트 이후 덩어리(출고 건)에서는 진행 안내문·이어서 하기를 덩어리에 한 번만 보인다(같은 쉽먼트라 내용이 같다).
  const slim = (o: FlowOrder, once = true) => (
    <div key={o.no} style={{
      // 발주서 사이에 빈 줄 하나만큼 띄운다(가독성).
      borderTop: '1px solid #f3f3f3', paddingTop: 6, marginTop: 14,
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
        {PICKABLE.includes(o.stage) && (
          <input type="checkbox" checked={picked.has(o.no)} onChange={() => togglePick(o.no)}
            style={{ width: 15, height: 15, accentColor: ORANGE, cursor: 'pointer', flexShrink: 0 }} />
        )}
        {/* 발주서마다는 발주번호만. 쉽먼트·송장 번호·출력(📄)·출력완료 체크는 덩어리 머리에 한 번 */}
        <div style={{ minWidth: 0, fontSize: 11.5, color: '#888', marginTop: 2 }}>
          발주 <span title="눌러서 발주번호 복사" style={{ cursor: 'copy', textDecoration: 'underline dotted', textUnderlineOffset: 2 }}>{o.no}</span>
          {o.stage >= 2 && o.item && (
            <span title="이 발주서의 쉽먼트 번호 넣기·고치기" onClick={() => setShipNos([o])}
              style={{ marginLeft: 6, cursor: 'pointer', color: o.item.shipmentNos?.[o.no] ? '#16a34a' : '#b45309' }}>
              {o.item.shipmentNos?.[o.no] ? '✎' : '+쉽먼트'}
            </span>
          )}
        </div>
      </div>
      {tags(o)}
      {(o.stage < 2 || once) && runNote(o)}
      <div style={{ fontSize: 13.5 }}>{products(o)}</div>
      {(o.stage < 2 || once) ? actionRow(o) : (printNote[o.no] ? <div style={{ fontSize: 11, color: '#1d4ed8' }}>{printNote[o.no]}</div> : null)}
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
      <div style={{ flex: '1 1 220px', minWidth: 0, padding: '10px 12px', fontSize: 13.5 }}>{products(o)}</div>
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

  // 고른 것 중 발주확정 칸에 있는 발주서 → 쉽먼트로 보내기.
  // 센터·입고예정일이 같은 것끼리 출고 건 하나씩 만든다(택배는 한 센터로만 간다). 박스를 안 정한 줄은 박스1.
  // 줄은 발주확인·예약 어디에 있든 그 줄 그대로 쉽먼트로 옮겨 간다.
  const pickedConfirmed = orders.filter(o => o.stage === 1 && picked.has(o.no));
  const sendToShip = () => {
    const nos = new Set(pickedConfirmed.map(o => o.no));
    const lines = [...linesAt('work'), ...linesAt('reserve')].filter(l => nos.has(l.발주번호));
    if (!lines.length) return;
    const groups = new Map<string, typeof lines>();
    for (const l of lines) {
      const k = `${l.물류센터.trim()}|${l.입고예정일}`;
      groups.set(k, [...(groups.get(k) || []), l]);
    }
    const summary = Array.from(groups.entries()).map(([k, ls]) => {
      const [center, date] = k.split('|');
      return `  ${center} · ${date} · 발주 ${new Set(ls.map(l => l.발주번호)).size}건`;
    });
    if (!window.confirm(`고른 발주서 ${nos.size}건을 쉽먼트로 보낼까요?\n\n${summary.join('\n')}\n\n(센터·입고예정일이 같은 것끼리 한 건으로 넘어가요)`)) return;
    const made: string[] = [];
    groups.forEach((ls, k) => {
      const [center, date] = k.split('|');
      const orderNos = Array.from(new Set(ls.map(l => l.발주번호)));
      const name = orderNos.length === 1 ? orderNos[0] : `발주 ${orderNos.length}건`;
      const item = addShipOut(name, center, date, ls.map(l => ({
        발주번호: l.발주번호, 물류센터: l.물류센터, 상품이름: l.상품이름, 확정수량: l.확정수량, 입고예정일: l.입고예정일,
        메모: l.메모 || '', 쉼먼트: l.쉼먼트 || boxLabel(1), 묶음: '', SKU: l.SKU || '',
      })));
      made.push(item.id);
    });
    setPicked(new Set());
    setDateNote({ tone: 'ok', text: `🚚 발주 ${nos.size}건을 쉽먼트로 보냈어요(${made.join(', ')}). 쉽먼트 칸에서 이어서 하세요.` });
  };

  // 고른 것 중 쉽먼트 칸에 있는 발주서 → 발송대기로. 출고 건 단위로 넘어간다(쉽먼트생성대기의 "발송대기로 →"와 같다).
  const pickedShipping = orders.filter(o => o.stage === 2 && picked.has(o.no) && o.item);
  const sendToWaiting = () => {
    const items = new Map<string, ShipOut>();
    pickedShipping.forEach(o => items.set(o.item!.id, o.item!));
    const others = Array.from(items.values()).flatMap(it => Array.from(new Set(it.lines.map(l => l.발주번호))).filter(no => !picked.has(no)));
    const notDone = pickedShipping.filter(o => !o.item?.shipmentNos?.[o.no]).map(o => o.no);
    if (!window.confirm(
      `고른 발주서 ${pickedShipping.length}건을 발송대기로 넘길까요?` +
      (notDone.length ? `\n\n⚠ 아직 서허 등록(쉽먼트 번호)이 안 된 발주서: ${notDone.join(', ')}` : '') +
      (others.length ? `\n\n같은 출고 건에 든 다른 발주서도 같이 넘어가요: ${others.join(', ')}` : ''),
    )) return;
    markShipOuts(Array.from(items.keys()), { doneAt: Date.now(), undoneAt: undefined });
    setPicked(new Set());
    setDateNote({ tone: 'ok', text: `발주 ${pickedShipping.length + others.length}건을 발송대기로 넘겼어요.` });
  };

  // 고른 것 중 쉽먼트 칸에서 아직 택배예약 안 한 출고 건 → 택배예약 → 운송장 → 서허 양식 → 서허 일괄등록까지 한 번에.
  // 이미 예약한 건(쉽먼트 기록이 있는 건)은 두 번 예약하면 안 되므로 빼고, 멈춘 건은 카드의 "이어서 하기"로.
  // 택배예약 대상: 고른 것 중 서허 등록(쉽먼트 번호)이 안 된 발주서. 이미 택배예약한 것도 사람이 원하면 다시 예약한다
  // (예약은 됐는데 서허에 일부만 올라간 일처럼, 예약을 무시하고 처음부터 다시 해야 할 때).
  const toReserve = new Set(pickedShipping.filter(o => !o.item!.shipmentNos?.[o.no]).map(o => o.no));
  const reserveItems = (() => {
    const m = new Map<string, ShipOut>();
    pickedShipping.forEach(o => { if (toReserve.has(o.no)) m.set(o.item!.id, o.item!); });
    return Array.from(m.values());
  })();
  // 박스는 센터·입고예정일이 같으면 출고 건이 달라도 같은 박스로 본다(출고 건마다 따로 세면 박스1이 건마다 하나씩 생겨
  // 택배가 더 많이 잡힌다). 그래서 묶음 값에 출고번호 대신 센터·날짜를 넣는다.
  const rowsOf = (items: ShipOut[]) => buildDisplayRows(items.flatMap(item => item.lines.flatMap(l => expandBoxSplit({
    발주번호: l.발주번호,
    물류센터: l.물류센터,
    상품이름: l.상품이름,
    확정수량: l.확정수량,
    입고예정일: normalizeDateValue(l.입고예정일),
    메모: l.메모 || '',
    쉼먼트: l.쉼먼트 || '',
    묶음: `${item.center.trim()}|${item.date}`,
    묶음센터: item.center,
  }))));
  const reserveShip = () => {
    const registered = pickedShipping.filter(o => !toReserve.has(o.no)).map(o => o.no);
    const again = pickedShipping.filter(o => toReserve.has(o.no) && reservedOrder(o)).map(o => o.no);
    if (registered.length && !window.confirm(`서허 등록까지 끝난 발주서는 빼고 해요: ${registered.join(', ')}`)) return;
    if (again.length && !window.confirm(`이미 택배예약한 발주서 ${again.length}건이 있어요: ${again.join(', ')}\n\n예약을 무시하고 택배예약부터 다시 할까요?\n(롯데에 이미 잡힌 예약은 직접 취소해 주세요)`)) return;
    // 고른 발주서 줄만 예약한다. 출고 건에 안 고른 발주서가 섞여 있으면, 예약이 시작된 뒤 고른 줄만 새 출고 건으로 떼어 낸다.
    const pickedOnly = reserveItems.map(it => ({ ...it, lines: it.lines.filter(l => toReserve.has(l.발주번호)) }));
    const whole = pickedOnly.filter((it, i) => it.lines.length === reserveItems[i].lines.length);
    const b = startShipment(rowsOf(pickedOnly), whole.map(i => i.id), addresses, sender, batches);
    if (!b) return;
    pickedOnly.forEach((it, i) => {
      if (it.lines.length !== reserveItems[i].lines.length) splitShipOut(it.id, Array.from(new Set(it.lines.map(l => l.발주번호))), { batchId: b.id });
    });
    setPicked(new Set());
  };
  const pickFormFile = (id: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx,.xls';
    input.onchange = async () => {
      const f = input.files && input.files[0];
      if (f) fillAndUpload(await f.arrayBuffer(), id, batchesRef.current.find(b => b.id === id));
    };
    input.click();
  };

  // 묶기: 고른 쉽먼트 칸 발주서들의 출고 건을 하나로(= 같은 출고 건 안에서 박스를 나눈다). 센터·날짜가 같아야 하고,
  // 택배예약·서허 등록을 한 발주서는 송장번호·쉽먼트 번호가 모두 같을 때만 묶는다(쉽먼트·발송대기 어디서든).
  const bundleShip = () => {
    const pickedBundle = pickedUnbundle;
    const done = pickedBundle.filter(o => reservedOrder(o) || o.stage === 4);
    if (done.length) {
      // 출고 건에 쉽먼트 기록 번호가 안 붙어 있어도, 찾은 쉽먼트 기록의 박스에서 송장번호를 읽는다.
      const waybillsOf = (o: FlowOrder) => (o.batch ? Array.from(new Set(allBoxes(o.batch)
        .filter(b => b.lines.some(l => String(l.발주번호 || '').trim() === o.no)).map(b => (b.waybill || '').trim()).filter(Boolean))) : []).sort().join(',');
      const shipOf = (o: FlowOrder) => o.item?.shipmentNos?.[o.no] || '';
      const same = done.length === pickedBundle.length
        && new Set(pickedBundle.map(waybillsOf)).size === 1 && !!waybillsOf(pickedBundle[0])
        && new Set(pickedBundle.map(shipOf)).size === 1 && !!shipOf(pickedBundle[0]);
      if (!same) {
        alert(`이미 택배예약·서허 등록한 발주서는 송장번호·쉽먼트 번호가 모두 같을 때만 묶을 수 있어요.\n\n${pickedBundle.map(o => `${o.no} · 송장 ${waybillsOf(o) || '없음'} · 쉽먼트 ${shipOf(o) || '없음'}`).join('\n')}`);
        return;
      }
    }
    const items = Array.from(new Map<string, ShipOut>(pickedBundle.map(o => [o.item!.id, o.item!])).values());
    if (items.length < 2) { alert('이미 한 건으로 묶여 있어요. 다른 출고 건의 발주서를 같이 골라 주세요.'); return; }
    const keys = new Set(items.map(it => `${it.center.trim()}|${it.date}`));
    if (keys.size > 1) {
      alert(`센터·입고예정일이 달라서 묶을 수 없어요. 날짜 변경·적용으로 먼저 맞춰 주세요.\n\n${pickedBundle.map(o => `${o.no} · ${o.center} · ${o.date}`).join('\n')}`);
      return;
    }
    const others = items.flatMap(it => Array.from(new Set(it.lines.map(l => l.발주번호)))).filter(no => !picked.has(no));
    if (!window.confirm(`발주서 ${pickedBundle.length + others.length}건을 한 건으로 묶을까요?\n(${items[0].center} · ${items[0].date})` +
      (others.length ? `\n\n같은 출고 건에 든 다른 발주서도 같이 묶여요: ${others.join(', ')}` : ''))) return;
    const t = mergeShipOuts(items.map(it => it.id));
    setPicked(new Set());
    setDateNote({ tone: 'ok', text: `발주서를 한 건(${t?.id || ''})으로 묶었어요. 박스는 카드에서 정하세요.` });
  };
  // 해제: 고른 발주서를 묶음에서 빼서 발주서마다 출고 건 하나씩으로.
  // 쉽먼트·발송대기 어디서든 풀 수 있다(택배예약·서허 등록 표시는 떼어 낸 건에도 그대로 남는다).
  const pickedUnbundle = orders.filter(o => (o.stage === 2 || o.stage === 4) && picked.has(o.no) && o.item);
  const unbundleShip = () => {
    const byItem = new Map<string, { item: ShipOut; nos: string[] }>();
    pickedUnbundle.forEach(o => {
      const e = byItem.get(o.item!.id) || { item: o.item!, nos: [] };
      e.nos.push(o.no);
      byItem.set(o.item!.id, e);
    });
    const jobs = Array.from(byItem.values()).filter(e => new Set(e.item.lines.map(l => l.발주번호)).size > 1);
    if (!jobs.length) { alert('고른 발주서는 묶여 있지 않아요.'); return; }
    if (!window.confirm(`고른 발주서를 묶음에서 풀어 발주서마다 따로 둘까요?`)) return;
    for (const { item, nos } of jobs) {
      const all = Array.from(new Set(item.lines.map(l => l.발주번호)));
      // 출고 건의 발주서를 다 골랐으면 첫 발주서는 원래 건에 남기고 나머지만 뗀다.
      const out = nos.length >= all.length ? all.slice(1) : nos;
      for (const no of out) splitShipOut(item.id, [no]);
    }
    setPicked(new Set());
    setDateNote({ tone: 'ok', text: '묶음을 풀었어요. 발주서마다 따로 있어요.' });
  };
  // 쉽먼트 칸 → 발주확정으로 되돌리기. 택배예약·서허 등록을 한 발주서는 되돌리지 않는다.
  const backToConfirmed = () => {
    const done = pickedShipping.filter(o => reservedOrder(o)).map(o => o.no);
    if (done.length) { alert(`이미 택배예약·서허 등록한 발주서는 발주확정으로 보낼 수 없어요: ${done.join(', ')}`); return; }
    const nos = pickedShipping.map(o => o.no);
    if (!window.confirm(`고른 발주서 ${nos.length}건을 발주확정으로 되돌릴까요?\n(박스 나누기는 첫 박스로 돌아가요)`)) return;
    restoreOrders(nos);
    setPicked(new Set());
    setDateNote({ tone: 'ok', text: `발주 ${nos.length}건을 발주확정으로 되돌렸어요.` });
  };
  const pickedBundled = pickedUnbundle.some(o => new Set(o.item!.lines.map(l => l.발주번호)).size > 1);
  const onlyShipping = pickedShipping.length > 0 && pickedShipping.length === picked.size;
  // 날짜 변경·적용: 발주확정·쉽먼트 칸 발주서만 골랐을 때(발송대기는 빼고).
  const dateOk = picked.size > 0 && pickedConfirmed.length + pickedShipping.length === picked.size;

  // 날짜·센터 직접 고치기: 고른 발주서(발주확정·쉽먼트)의 입고예정일·센터를 사람이 적은 값으로 바꾼다.
  // "적용"과 같은 길(발주확인·예약·쉽먼트 줄과 출고 건·쉽먼트 기록까지)로 바꾼다.
  const editDateCenter = () => {
    const list = orders.filter(o => picked.has(o.no));
    if (!list.length) return;
    const date = window.prompt(`고른 발주서 ${list.length}건의 입고예정일(YYYY-MM-DD)`, list[0].date);
    if (date == null) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) { alert('날짜는 2026-10-13처럼 적어 주세요.'); return; }
    const center = window.prompt(`고른 발주서 ${list.length}건의 센터(예: 대구3)`, list[0].center);
    if (center == null || !center.trim()) return;
    const nos = list.map(o => o.no);
    const values = Object.fromEntries(nos.map(no => [no, { center: center.trim(), date: date.trim() }]));
    applyCurrent(nos, values).then(res => {
      for (const m of res.moved) {
        for (const next of retargetBatches(batchesRef.current, m.before, m.to, shipOutBatch(m.before, batchesRef.current))) {
          saveShipmentBatch(next).catch(err => console.error('쉽먼트 기록 옮기기 실패:', err));
        }
      }
      setPicked(new Set());
      setDateNote({ tone: 'ok', text: `✅ ${res.changed.length}건을 ${date.trim()} ${center.trim()}(으)로 바꿨어요.` + (res.same.length ? ` 이미 같은 값 ${res.same.length}건.` : '') });
    }).catch(err => setDateNote({ tone: 'error', text: `바꾸지 못했어요: ${err instanceof Error ? err.message : String(err)}` }));
  };
  // 쉽먼트 번호 직접 넣기(서허에서 직접 등록했을 때). 넣으면 인쇄할 수 있고 서허 등록 끝난 건으로 본다.
  const setShipNos = (targets: FlowOrder[]) => {
    const list = targets.filter(o => o.item);
    if (!list.length) return;
    const cur = Array.from(new Set(list.map(o => o.item!.shipmentNos?.[o.no] || '').filter(Boolean)));
    const v = window.prompt(list.length > 1 ? `발주서 ${list.length}건(${list.map(o => o.no).join(', ')})의 쉽먼트 번호` : `${list[0].no}의 쉽먼트 번호`, cur.length === 1 ? cur[0] : '');
    if (v == null) return;
    const no = v.replace(/\s+/g, '');
    if (no && !/^\d{6,}$/.test(no)) { alert('쉽먼트 번호는 숫자만 적어 주세요.'); return; }
    const byItem = new Map<string, string[]>();
    list.forEach(o => byItem.set(o.item!.id, [...(byItem.get(o.item!.id) || []), o.no]));
    const fresh = readShipOuts();
    byItem.forEach((nos, id) => {
      const it = fresh.find(x => x.id === id);
      const next = { ...(it?.shipmentNos || {}) };
      nos.forEach(n => { if (no) next[n] = no; else delete next[n]; });
      markShipOuts([id], { shipmentNos: next });
    });
    setDateNote({ tone: 'ok', text: no ? `쉽먼트 번호 ${no}을(를) 적었어요. 이제 🖨 인쇄할 수 있어요.` : '쉽먼트 번호를 지웠어요.' });
  };

  // 상자의 발주번호 고치기: 출고 건 줄과 쉽먼트 기록 박스 안 번호를 같이 바꾼다.
  const editOrderNo = (list: FlowOrder[], from: string) => {
    const v = window.prompt(`발주번호 ${from}을(를) 무엇으로 고칠까요?`, from);
    if (v == null) return;
    const to = v.replace(/\s+/g, '');
    if (!to || to === from) return;
    if (!/^\d+$/.test(to)) { alert('발주번호는 숫자만 적어 주세요.'); return; }
    if (orders.some(o => o.no === to)) { alert(`발주번호 ${to}은(는) 이미 있어요.`); return; }
    const mine = list.filter(o => o.no === from);
    renameShipOutOrder(Array.from(new Set(mine.map(o => o.item?.id).filter((x): x is string => !!x))), from, to);
    const batches = new Map<string, ShipmentBatch>();
    mine.forEach(o => { if (o.batch) batches.set(o.batch.id, o.batch); });
    batches.forEach(b => {
      const centers = b.centers.map(c => ({ ...c, boxes: c.boxes.map(x => ({ ...x, lines: x.lines.map(l => (String(l.발주번호 || '').trim() === from ? { ...l, 발주번호: to } : l)) })) }));
      patchShipmentBatch(b.id, { centers }).catch(() => {});
    });
    setDateNote({ tone: 'ok', text: `발주번호 ${from} → ${to}(으)로 고쳤어요.` });
  };
  // 상자의 송장번호 넣기·고치기. from이 있으면 그 번호를 쓴 박스만, 없으면 이 상자 발주서가 든 빈 박스에 넣는다.
  const editWaybill = (list: FlowOrder[], from: string) => {
    const v = window.prompt(from ? `송장번호 ${from}을(를) 무엇으로 고칠까요? (비우면 지워요)` : '이 상자의 송장번호', from);
    if (v == null) return;
    const to = v.replace(/\s+/g, '');
    if (to === from) return;
    if (to && !/^\d+$/.test(to)) { alert('송장번호는 숫자만 적어 주세요.'); return; }
    const nos = new Set(list.map(o => o.no));
    const batches = new Map<string, ShipmentBatch>();
    list.forEach(o => { if (o.item && o.batch && o.item.batchId === o.batch.id) batches.set(o.batch.id, o.batch); });
    let n = 0;
    batches.forEach(b => {
      const centers = b.centers.map(c => ({ ...c, boxes: c.boxes.map(x => {
        if (!x.lines.some(l => nos.has(String(l.발주번호 || '').trim()))) return x;
        if ((x.waybill || '').trim() !== from) return x;
        n += 1;
        return { ...x, waybill: to };
      }) }));
      patchShipmentBatch(b.id, { centers }).catch(() => {});
    });
    if (!n) { setDateNote({ tone: 'error', text: '송장번호를 넣을 박스가 없어요(택배예약 전인 상자예요).' }); return; }
    setDateNote({ tone: 'ok', text: to ? `송장번호 ${to}을(를) 박스 ${n}개에 적었어요.` : `송장번호를 박스 ${n}개에서 지웠어요.` });
  };

  // 고른 것 중 발송대기 칸에 있는 발주서 → 발송완료. 보낸 날을 묻고 출고 건 단위로 넘긴다(발송대기 화면의 "발송 완료"와 같다).
  const pickedWaiting = orders.filter(o => o.stage === 4 && picked.has(o.no) && o.item);
  const sendDone = () => {
    const items = new Map<string, ShipOut>();
    pickedWaiting.forEach(o => items.set(o.item!.id, o.item!));
    const others = Array.from(items.values()).flatMap(it => Array.from(new Set(it.lines.map(l => l.발주번호))).filter(no => !picked.has(no)));
    const notReady = Array.from(items.values()).flatMap(it => it.lines.filter(l => !ready.isReady(l, it.readyKeys)).map(l => `${l.발주번호} ${l.상품이름}`));
    const today = new Date().toLocaleDateString('sv-SE');
    const date = window.prompt(
      `고른 발주서 ${pickedWaiting.length}건을 발송완료로 넘겨요. 보낸 날을 적어 주세요(YYYY-MM-DD).` +
      (notReady.length ? `\n\n⚠ 아직 준비 안 된 상품 ${notReady.length}줄: ${notReady.slice(0, 5).join(', ')}${notReady.length > 5 ? ' …' : ''}` : '') +
      (others.length ? `\n\n같은 출고 건에 든 다른 발주서도 같이 넘어가요: ${others.join(', ')}` : ''),
      today,
    );
    if (date == null) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) { alert('날짜는 2026-10-09처럼 적어 주세요.'); return; }
    markShipOuts(Array.from(items.keys()), { sentDate: date.trim() });
    setPicked(new Set());
    setDateNote({ tone: 'ok', text: `발주 ${pickedWaiting.length + others.length}건을 발송완료(${date.trim()})로 넘겼어요. 발송완료 메뉴에서 볼 수 있어요.` });
  };

  // 발송대기 → 쉽먼트로 되돌리기(쉽먼트생성 화면의 "완료 풀기"와 같다). 출고 건 단위로 돌아간다.
  const backToShipping = () => {
    const items = new Map<string, ShipOut>();
    pickedWaiting.forEach(o => items.set(o.item!.id, o.item!));
    const others = Array.from(items.values()).flatMap(it => Array.from(new Set(it.lines.map(l => l.발주번호))).filter(no => !picked.has(no)));
    if (!window.confirm(`고른 발주서 ${pickedWaiting.length}건을 쉽먼트로 되돌릴까요?` +
      (others.length ? `\n\n같은 출고 건에 든 다른 발주서도 같이 돌아가요: ${others.join(', ')}` : ''))) return;
    markShipOuts(Array.from(items.keys()), { doneAt: undefined, undoneAt: Date.now() });
    setPicked(new Set());
    setDateNote({ tone: 'ok', text: `발주 ${pickedWaiting.length + others.length}건을 쉽먼트로 되돌렸어요.` });
  };

  // 고르면 화면 아래 가운데에 뜨는 메뉴. 흰 띠 하나에 날짜 변경·적용 | [고른 수] 다음 단계로 넘기기 | 취소.
  const pill = (kind: 'primary' | 'ghost'): React.CSSProperties => ({
    height: 34, padding: '0 14px', fontSize: 13, fontWeight: 600, borderRadius: 9, cursor: 'pointer', whiteSpace: 'nowrap',
    display: 'inline-flex', alignItems: 'center', gap: 6, letterSpacing: '-0.2px', transition: 'background .15s',
    ...(kind === 'primary'
      ? { border: 'none', background: '#111827', color: '#fff' }
      : { border: '1px solid #e5e7eb', background: '#fff', color: '#374151' }),
  });
  const divider = <span style={{ width: 1, height: 22, background: '#e5e7eb', margin: '0 4px', flexShrink: 0 }} />;
  const countOf = (n: number) => (n !== picked.size ? <span style={{ opacity: 0.6, fontWeight: 500 }}>{n}</span> : null);
  const moves = [
    pickedConfirmed.length > 0 && (
      <button key="ship" onClick={sendToShip} style={pill('primary')} title="고른 발주확정 발주서를 센터·입고예정일이 같은 것끼리 묶어 쉽먼트로 보내요">
        쉽먼트로 {countOf(pickedConfirmed.length)}<span style={{ opacity: 0.7 }}>→</span>
      </button>
    ),
    reserveItems.length > 0 && (
      <button key="lotte" onClick={reserveShip} style={{ ...pill('primary'), background: ORANGE }}
        title="고른 쉽먼트 발주서로 택배예약 → 운송장 → 서허 양식 → 서허 일괄등록까지 이어서 해요">
        🚚 택배예약·일괄등록 <span style={{ opacity: 0.8, fontWeight: 500 }}>{totalBoxCount(rowsOf(reserveItems.map(it => ({ ...it, lines: it.lines.filter(l => toReserve.has(l.발주번호)) }))))}박스</span>
      </button>
    ),
    pickedShipping.length > 0 && (
      <button key="back" onClick={backToConfirmed} style={pill('ghost')} title="고른 쉽먼트 발주서를 발주확정 칸으로 되돌려요">
        <span style={{ opacity: 0.7 }}>←</span> 발주확정으로 {countOf(pickedShipping.length)}
      </button>
    ),
    pickedShipping.length > 0 && (
      <button key="wait" onClick={sendToWaiting} style={pill('primary')} title="고른 쉽먼트 발주서를 발송대기로 넘겨요">
        발송대기로 {countOf(pickedShipping.length)}<span style={{ opacity: 0.7 }}>→</span>
      </button>
    ),
    pickedWaiting.length > 0 && (
      <button key="backship" onClick={backToShipping} style={pill('ghost')} title="고른 발송대기 발주서를 쉽먼트 칸으로 되돌려요">
        <span style={{ opacity: 0.7 }}>←</span> 쉽먼트로 {countOf(pickedWaiting.length)}
      </button>
    ),
    pickedWaiting.length > 0 && (
      <button key="sent" onClick={sendDone} style={pill('primary')} title="고른 발송대기 발주서를 발송완료로 넘겨요(보낸 날을 물어요)">
        발송완료 {countOf(pickedWaiting.length)}<span style={{ opacity: 0.7 }}>→</span>
      </button>
    ),
  ].filter(Boolean);
  const calendar = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
  const check = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
  );
  const noteColor = dateNote?.tone === 'error' ? '#b91c1c' : dateNote?.tone === 'ok' ? '#047857' : '#1d4ed8';
  const layer = (picked.size > 0 || dateNote || live) && (
    <div style={{
      position: 'fixed', left: '50%', bottom: 20, transform: 'translateX(-50%)', zIndex: 50,
      background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(8px)', color: '#111827',
      border: '1px solid #e5e7eb', borderRadius: 14, boxShadow: '0 12px 32px rgba(15,23,42,0.16), 0 2px 6px rgba(15,23,42,0.06)',
      padding: 8, display: 'flex', flexDirection: 'column', gap: 6, maxWidth: 'calc(100vw - 32px)',
    }}>
      {picked.size > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* 날짜 변경·적용·묶기·해제는 쉽먼트 칸 발주서만 골랐을 때 */}
          {dateOk && <button onClick={changeDate} style={pill('ghost')} title="서허 입고일 변경 요청 화면에 고른 발주서를 넣어 둬요">{calendar}날짜 변경</button>}
          {dateOk && <button onClick={editDateCenter} style={pill('ghost')} title="고른 발주서의 입고예정일·센터를 직접 적어 바꿔요">✏️ 날짜·센터</button>}
          {dateOk && <button onClick={applyDate} style={pill('ghost')} title="서허에서 승인된 걸 확인한 뒤 누르세요. 서허 발주서 목록의 지금 입고예정일·센터를 읽어 앱에 적어요">{check}적용</button>}
          {pickedUnbundle.length === picked.size && picked.size >= 2 && <button onClick={bundleShip} style={pill('ghost')} title="고른 발주서들을 한 건으로 묶어요(센터·입고예정일이 같아야 해요)">🔗 묶기</button>}
          {pickedUnbundle.length === picked.size && pickedBundled && <button onClick={unbundleShip} style={pill('ghost')} title="묶은 발주서를 풀어 발주서마다 따로 둬요">✂ 해제</button>}
          {divider}
          <span style={{ height: 34, padding: '0 8px', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>
            <span style={{ minWidth: 22, height: 22, padding: '0 6px', borderRadius: 999, background: ORANGE, color: '#fff', fontSize: 12, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{picked.size}</span>
            선택됨
          </span>
          {moves}
          {divider}
          <button onClick={() => setPicked(new Set())} title="고른 발주서를 모두 해제해요"
            style={{ ...pill('ghost'), border: 'none', color: '#6b7280', padding: '0 10px' }}>
            취소
          </button>
        </div>
      )}
      {live && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 10px', borderRadius: 9, fontSize: 12, lineHeight: 1.5,
          background: live.tone === 'error' ? '#fef2f2' : live.tone === 'ok' ? '#ecfdf5' : '#eff6ff',
          color: live.tone === 'error' ? '#b91c1c' : live.tone === 'ok' ? '#047857' : '#1d4ed8',
        }}>
          <span style={{ flex: 1 }}>{live.text}</span>
          {live.canPickForm && (
            <button onClick={() => pickFormFile(live.batchId)} title="다운로드 폴더에 받아진 서허 양식을 직접 골라 채우고 서허에 올려요"
              style={{ border: 'none', borderRadius: 6, background: '#2980b9', color: '#fff', fontSize: 11.5, padding: '2px 8px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              양식 직접 고르기
            </button>
          )}
          <button onClick={() => setLive(null)} style={{ border: 'none', background: 'transparent', color: '#9ca3af', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>×</button>
        </div>
      )}
      {dateNote && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 10px', borderRadius: 9, background: '#f8fafc', fontSize: 12, lineHeight: 1.5, color: noteColor }}>
          <span style={{ flex: 1 }}>{dateNote.text}</span>
          <button onClick={() => setDateNote(null)} style={{ border: 'none', background: 'transparent', color: '#9ca3af', cursor: 'pointer', fontSize: 14, lineHeight: 1 }}>×</button>
        </div>
      )}
    </div>
  );

  const saveSplit = () => {
    if (!splitting) return;
    const pieces = splitting.pieces.map(p => ({ no: p.no, qty: Math.floor(Number(p.qty) || 0) })).filter(p => p.qty > 0);
    const sum = pieces.reduce((n, p) => n + p.qty, 0);
    if (sum !== splitting.total) { alert(`박스별 수량 합계(${sum}개)가 전체 수량(${splitting.total}개)과 같아야 해요.`); return; }
    // 같은 박스 번호가 두 번이면 합친다. 한 박스만 남으면 나누지 않은 줄로 둔다.
    const merged = Array.from(pieces.reduce((m, p) => m.set(p.no, (m.get(p.no) || 0) + p.qty), new Map<number, number>()).entries()).map(([no, qty]) => ({ no, qty }));
    const L = splitting.line;
    updateShipOutLine(splitting.itemId, { 발주번호: L.발주번호, 상품이름: L.상품이름, 확정수량: L.확정수량, 입고예정일: L.입고예정일 },
      { 쉼먼트: merged.length === 1 ? boxLabel(merged[0].no) : joinBoxSplit(merged) });
    setSplitting(null);
  };
  const splitModal = splitting && (() => {
    const sum = splitting.pieces.reduce((n, p) => n + (Math.floor(Number(p.qty) || 0)), 0);
    const left = splitting.total - sum;
    const boxMax = Math.max(splitting.boxMax, ...splitting.pieces.map(p => p.no));
    const setPiece = (i: number, patch: Partial<{ no: number; qty: string }>) =>
      setSplitting(prev => prev && { ...prev, pieces: prev.pieces.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
    return (
      <div onClick={() => setSplitting(null)}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div onClick={e => e.stopPropagation()} style={{ width: 380, maxWidth: 'calc(100vw - 32px)', background: '#fff', borderRadius: 12, padding: 18, boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
          <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>박스 나누기</div>
          <div style={{ fontSize: 12, color: '#666', marginBottom: 12 }}>
            {splitting.line.상품이름} · 전체 <b>{splitting.total}개</b>
          </div>
          {splitting.pieces.map((p, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <BoxPicker value={`박스${p.no}`} maxNo={boxMax} allowNone={false} onChange={v => setPiece(i, { no: parseBoxNo(v) || p.no })} />
              <input type="number" min={0} value={p.qty} placeholder="수량" autoFocus={i === splitting.pieces.length - 1}
                onChange={e => setPiece(i, { qty: e.target.value })}
                onKeyDown={e => { if (e.key === 'Enter') saveSplit(); }}
                style={{ width: 90, padding: '5px 8px', fontSize: 13, borderRadius: 6, border: '1px solid #ddd', textAlign: 'right' }} />
              <span style={{ fontSize: 12, color: '#888' }}>개</span>
              <button onClick={() => setSplitting(prev => prev && { ...prev, pieces: prev.pieces.filter((_, j) => j !== i) })}
                disabled={splitting.pieces.length <= 1} title="이 박스 줄 빼기"
                style={{ marginLeft: 'auto', padding: '2px 8px', fontSize: 12, color: '#c0392b', background: '#fff', border: '1px solid #f0c4c0', borderRadius: 5, cursor: 'pointer' }}>×</button>
            </div>
          ))}
          <button onClick={() => setSplitting(prev => prev && { ...prev, pieces: [...prev.pieces, { no: Math.min(9, Math.max(0, ...prev.pieces.map(p => p.no)) + 1), qty: left > 0 ? String(left) : '' }] })}
            style={{ padding: '4px 10px', fontSize: 12, color: '#2980b9', background: '#fff', border: '1px dashed #2980b9', borderRadius: 6, cursor: 'pointer' }}>
            + 박스 추가
          </button>
          <div style={{ marginTop: 12, fontSize: 12, fontWeight: 700, color: left === 0 ? '#27ae60' : '#c0392b' }}>
            합계 {sum}개 / {splitting.total}개{left > 0 ? ` · ${left}개 남음` : left < 0 ? ` · ${-left}개 넘침` : ' ✓'}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
            <button onClick={() => setSplitting(null)} style={{ padding: '6px 14px', fontSize: 13, background: '#f3f3f3', border: 'none', borderRadius: 6, cursor: 'pointer' }}>취소</button>
            <button onClick={saveSplit} disabled={left !== 0}
              style={{ padding: '6px 14px', fontSize: 13, fontWeight: 700, color: '#fff', background: left === 0 ? '#2980b9' : '#a9c6dc', border: 'none', borderRadius: 6, cursor: left === 0 ? 'pointer' : 'default' }}>
              저장
            </button>
          </div>
        </div>
      </div>
    );
  })();

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

  // 남은 수량만 배정: 이미 맡긴 곳은 그대로 두고, 남은 수량을 고른 한중발주(여유 안에서 / 주문 늘려서)나 발주 대기로.
  const doAssign = async (target: { code: string; grow: boolean; qty: number } | 'queue') => {
    if (!assignFor) return;
    const { o, l, left } = assignFor;
    const line = { 발주번호: o.no, 물류센터: o.center, 상품이름: l.상품이름, 확정수량: Number(l.확정수량) || 0, 입고예정일: o.date.replace(/-/g, '') };
    try {
      if (target === 'queue') {
        await returnToHanjungQueue([{ ...line, 입고예정일: normalizeDateValue(line.입고예정일), 메모: '', 쉼먼트: '', ...(left !== line.확정수량 ? { 배정: left } : {}) }], hjQueue);
      } else {
        const order = hjOrders.find(x => x.code === target.code);
        if (!order) return;
        const key = reservationKey({ 발주번호: line.발주번호, 상품이름: line.상품이름, 확정수량: line.확정수량, 입고예정일: normalizeDateValue(line.입고예정일) });
        await saveHanjungOrder(assignRemaining(order, line, target.qty, key, target.grow));
      }
      setDateNote({ tone: 'ok', text: target === 'queue' ? `${l.상품이름} ${left}개를 1688 주문하기로 보냈어요.` : `${l.상품이름} ${target.qty}개를 ${target.code}에 배정했어요.` });
      setAssignFor(null);
    } catch (err) {
      alert(`배정 실패: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const assignWindow = assignFor && (() => {
    const { l, left } = assignFor;
    // 이 상품이 있는 한중발주: 여유(도착 → 오는 중)를 보여준다. 아직 다 안 온 건은 주문을 늘려 맡길 수도 있다.
    const opts = hjOrders.map(o => {
      const p = productSummary(o).find(x => sameName(x.상품이름, l.상품이름));
      if (!p) return null;
      const arrivedSpare = Math.min(p.spare, Math.max(0, p.received - p.allocated));
      const open = p.received < p.ordered || !o.receipts.length;
      if (p.spare <= 0 && !open) return null;
      return { o, spare: p.spare, arrivedSpare, open };
    }).filter(Boolean) as { o: HanjungOrder; spare: number; arrivedSpare: number; open: boolean }[];
    const optBtn: React.CSSProperties = { padding: '6px 10px', fontSize: 12.5, fontWeight: 600, borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer', whiteSpace: 'nowrap' };
    return (
      <div onClick={() => setAssignFor(null)} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(15,23,42,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <div onClick={e => e.stopPropagation()} style={{ width: 'min(460px, 100%)', background: '#fff', borderRadius: 14, boxShadow: '0 20px 50px rgba(0,0,0,0.25)', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 800 }}>남은 {left}개 배정</div>
          <div style={{ fontSize: 12.5, color: '#666', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={l.상품이름}>{l.상품이름}</div>
          {opts.length === 0 && <div style={{ fontSize: 12.5, color: '#999' }}>이 상품의 여유가 있거나 아직 도착 전인 한중발주가 없어요.</div>}
          {opts.map(({ o, spare, arrivedSpare, open }) => {
            const take = Math.min(spare, left);
            return (
              <div key={o.code} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', border: '1px solid #f0f0f0', borderRadius: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{o.code}</div>
                  <div style={{ fontSize: 11.5, color: '#888' }}>여유 {spare}개{spare ? ` (도착 ${arrivedSpare} · 오는 중 ${spare - arrivedSpare})` : ''}</div>
                </div>
                {take > 0 && <button style={optBtn} onClick={() => doAssign({ code: o.code, grow: false, qty: take })}>{take}개 배정</button>}
                {take < left && open && (
                  <button style={{ ...optBtn, borderColor: '#fcd34d' }} title={`이 한중발주 주문 수량을 ${left - take}개 늘려요(1688에 더 주문)`}
                    onClick={() => doAssign({ code: o.code, grow: true, qty: left })}>
                    주문 +{left - take} 늘려 {left}개
                  </button>
                )}
              </div>
            );
          })}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button style={optBtn} onClick={() => doAssign('queue')} title="다음 한중발주로 주문해요">1688 주문하기로 {left}개</button>
            <button style={{ ...optBtn, border: 'none', color: '#888' }} onClick={() => setAssignFor(null)}>닫기</button>
          </div>
        </div>
      </div>
    );
  })();

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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>{shown.map(row)}</div>
        </main>
        {layer}
        {newWindow}
        {assignWindow}
        {waybillBatch && <ShipmentWaybillModal batch={waybillBatch} onClose={() => setWaybillBatch(null)} />}
        {splitModal}
      </div>
    );
  }

  // ── 상자 보기 ──
  const shownStages = isMobile ? [mobileStage] : BOARD_STAGES;
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
      <main style={{ overflowX: 'hidden', padding: '12px clamp(10px, 3vw, 20px) 70px' }}>
        {/* 상품별 주문 수량(발주확정·쉽먼트·발송대기 칸의 발주서 합). 접었다 펼친다. 준비 안 됨 / 준비됨으로 나눠 보여준다. */}
        <ProductQtySummary lines={BOARD_STAGES.flatMap(st => boxes[st]).flatMap(o => o.lines.map(l => ({ 상품이름: l.상품이름, 확정수량: l.확정수량, ready: lineIsReady(o, l) })))} remember={false} />
        {isMobile && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            {BOARD_STAGES.map(i => {
              const on = i === mobileStage;
              return (
                <button key={i} onClick={() => setMobileStage(i)} style={{
                  flex: 1, padding: '8px 4px', fontSize: 13, fontWeight: 800, borderRadius: 9, cursor: 'pointer',
                  border: `1.5px solid ${on ? ORANGE : '#d6d3d1'}`, background: on ? ORANGE : '#fff', color: on ? '#fff' : '#57534e',
                }}>
                  {STAGES[i]} <span style={{ opacity: 0.8 }}>{boxes[i].length}</span>
                </button>
              );
            })}
          </div>
        )}
        <div style={{
          display: 'grid', width: '100%', boxSizing: 'border-box', gridTemplateColumns: `repeat(${shownStages.length}, minmax(0, 1fr))`,
          border: '1.5px solid #d6d3d1', borderRadius: 12, background: '#efedea', overflow: 'hidden', alignItems: 'stretch',
        }}>
          {/* 머리줄 */}
          {shownStages.map((i, col) => {
            const label = STAGES[i];
            const list = boxes[i];
            const stuck = i === 2 ? list.filter(o => run(o)?.state === 'error').length : 0;
            return (
              <div key={`h-${label}`} style={{
                position: 'sticky', top: 0, zIndex: 2, display: 'flex', alignItems: 'center', gap: 6, padding: '13px 14px',
                background: '#efedeb', borderBottom: '2px solid #d6d3d1', borderRight: col < shownStages.length - 1 ? '1px solid #d6d3d1' : 'none',
              }}>
                <span style={{ fontSize: 11, color: '#a8a29e', fontWeight: 800 }}>{BOARD_STAGES.indexOf(i) + 1}</span>
                {STAGE_HINT[i] ? <HintBubble text={STAGE_HINT[i]!}><b style={{ fontSize: 14, color: '#292524', cursor: 'help' }}>{label}</b></HintBubble>
                  : <b style={{ fontSize: 14, color: '#292524' }}>{label}</b>}
                <span style={{ fontSize: 12, fontWeight: 800, color: '#fff', background: ORANGE, opacity: list.length ? 1 : 0.45, borderRadius: 999, padding: '0 7px' }}>{list.length}</span>
                {stuck > 0 && <span style={{ fontSize: 11.5, fontWeight: 800, color: RED }}>⛔ {stuck}</span>}
                {i === 5 && <span style={{ fontSize: 10.5, color: '#a8a29e', marginLeft: 'auto' }}>최근 {SENT_DAYS}일</span>}
              </div>
            );
          })}
          {/* 칸 */}
          {shownStages.map((i, col) => {
            const label = STAGES[i];
            const list = boxes[i];
            return (
              <div key={`c-${label}`} style={{
                padding: '18px 14px 32px', minHeight: '78vh', display: 'flex', flexDirection: 'column', gap: 20, boxSizing: 'border-box',
                borderRight: col < shownStages.length - 1 ? '1px solid #e7e5e4' : 'none',
              }}>
                {i <= 4 ? groupByCenterDate(list, i >= 2 ? (o => (i === 4 ? o.item?.batchId : '') || o.item?.id || o.no) : undefined).map(g => (
                  // 새발주서·발주확정: 예전 쿠팡발주확인처럼 같은 입고예정일·센터끼리 한 덩어리로 모아 보여준다(묶음은 아니다).
                  // 겉모양은 쉽먼트·발송대기 카드와 같게(흰 바탕·테두리·그림자·왼쪽 띠). 고른 발주서가 있으면 주황.
                  (() => {
                    // 발주확정·쉽먼트·발송대기: 상품이 다 준비된 덩어리는 초록, 멈춘 건 빨강(카드와 같은 색 규칙).
                    const pickedAny = g.list.some(o => picked.has(o.no));
                    const doneAll = (i === 1 || i === 2 || i === 4) && g.list.every(allReady);
                    const errAny = g.list.some(o => run(o)?.state === 'error');
                    // 상자 안 발주서를 다 인쇄했으면(출력완료) 옅은 회색 바탕.
                    // 출력완료 체크칸(인쇄 옆)을 켰거나 인쇄 기록이 있으면 출력완료로 본다.
                    const printedAll = (i === 2 || i === 4) && g.list.every(o => marks.has(o.no) || (o.item?.printedOrders || []).includes(o.no));
                    return (
                  <div key={g.key} style={{
                    background: printedAll ? '#ececec' : doneAll ? '#f0faf3' : '#fff', borderRadius: 10, padding: '10px 12px 10px 14px', boxShadow: '0 2px 6px rgba(0,0,0,0.10)',
                    border: pickedAny ? `2px solid ${ORANGE}` : doneAll ? `2px solid ${GREEN}` : `1px solid ${errAny ? '#f87171' : '#b8b2ab'}`,
                    borderLeft: `5px solid ${pickedAny ? ORANGE : errAny ? RED : doneAll ? GREEN : '#a8a29e'}`,
                    display: 'flex', flexDirection: 'column', gap: 6,
                  }}>
                    {/* 날짜·센터 글씨는 쉽먼트·발송대기 카드 머리와 같게 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', lineHeight: 1.2, padding: '0 4px' }}>
                      {/* 덩어리 전체 고르기: 안의 발주서를 한꺼번에 고르거나 풀기 */}
                      {PICKABLE.includes(i as Stage) && (() => {
                        const all = g.list.every(o => picked.has(o.no));
                        const some = !all && g.list.some(o => picked.has(o.no));
                        return (
                          <input type="checkbox" checked={all} ref={el => { if (el) el.indeterminate = some; }}
                            onChange={() => setPicked(prev => {
                              const next = new Set(prev);
                              g.list.forEach(o => { if (all) next.delete(o.no); else next.add(o.no); });
                              return next;
                            })}
                            title="이 날짜·센터 발주서 전체 고르기"
                            style={{ width: 16, height: 16, accentColor: ORANGE, cursor: 'pointer', flexShrink: 0 }} />
                        );
                      })()}
                      <span style={{ fontSize: 17, fontWeight: 900, color: '#111' }}>{dayText(g.date)}</span>
                      <span style={{ fontSize: 17, fontWeight: 900, color: ORANGE }}>{Array.from(new Set(g.list.map(o => o.center.trim()).filter(Boolean))).join(' · ') || '센터 없음'}</span>
                      {i >= 2 && (() => {
                        // 카드의 박스 번호(출고 건 줄)로 센다. 없으면 쉽먼트 기록의 박스 수.
                        const nos = new Set(g.list.map(o => o.no));
                        const items = Array.from(new Map(g.list.filter(o => o.item).map(o => [o.item!.id, o.item!])).values())
                          .map(it => ({ ...it, lines: it.lines.filter(l => nos.has(String(l.발주번호 || '').trim())) }));
                        const n = totalBoxCount(rowsOf(items)) || summaryOf(g.list).boxes;
                        const ships = summaryOf(g.list).ships.length;
                        const st = { fontSize: 17, fontWeight: 900, color: '#111', whiteSpace: 'nowrap' } as const;
                        return <>
                          {n > 0 && <span style={st}>📦 {n}</span>}
                          {ships > 0 && <span style={{ ...st, cursor: 'pointer' }} onClick={() => printBox(g.key, g.list)}
                            title="눌러서 이 상자 쉽먼트 출력(Label·내역서·바코드). 쉽먼트가 여럿이면 쉽먼트마다 열려요">📄 {ships}</span>}
                          {(i === 2 || i === 4) && g.list.some(o => o.item) && (() => {
                            const all = g.list.every(o => marks.has(o.no));
                            return <input type="checkbox" checked={all} onChange={e => g.list.forEach(o => setMark(o.no, e.target.checked))}
                              title="출력완료 체크(켜면 상자가 회색)" style={{ width: 16, height: 16, cursor: 'pointer', accentColor: '#6b7280' }} />;
                          })()}
                        </>;
                      })()}
                      {i < 2 && <span style={{ fontSize: 11.5, fontWeight: 700, color: '#a8a29e' }}>발주 {g.list.length}건</span>}
                      {i >= 2 && (() => {
                        // 날짜·센터 줄에 번호를 하나씩만. 여러 개면 "+N"을 눌러 아래로 펼친다.
                        const sm = summaryOf(g.list);
                        const many = sm.orders.length > 1 || sm.waybills.length > 1 || sm.ships.length > 1;
                        const one = (label: string, xs: string[]) => xs.length ? (
                          <span style={{ fontSize: 11.5, color: '#6b7280', whiteSpace: 'nowrap' }}>
                            {label} <span title={`눌러서 복사`} onClick={() => copyNo(label, xs[0])} style={{ cursor: 'copy', textDecoration: 'underline dotted', textUnderlineOffset: 2 }}>{xs[0]}</span>
                            {label === '송장' && reprintIcon(xs[0], g.date)}
                            {xs.length > 1 && <b style={{ color: '#2563eb', marginLeft: 2 }}>+{xs.length - 1}</b>}
                          </span>
                        ) : null;
                        return (
                          <>
                            {one('발주', sm.orders)}
                            {one('송장', sm.waybills)}
                            {sm.ships.length ? one('쉽먼트', sm.ships) : (
                              <span onClick={() => setShipNos(g.list)} title="이 상자 발주서 전체에 쉽먼트 번호 넣기" style={{ fontSize: 11.5, color: '#b45309', cursor: 'pointer', whiteSpace: 'nowrap' }}>+쉽먼트</span>
                            )}
                            <button onClick={() => setOpenSum(prev => { const n = new Set(prev); if (n.has(g.key)) n.delete(g.key); else n.add(g.key); return n; })}
                              title={openSum.has(g.key) ? '접기' : '발주·송장·쉽먼트 번호 다 보기'}
                              style={{ border: 'none', background: 'transparent', color: '#2563eb', cursor: 'pointer', fontSize: 11.5, padding: 0, fontWeight: 700 }}>
                              {openSum.has(g.key) ? '▲' : many ? '▼' : '⋯'}
                            </button>
                          </>
                        );
                      })()}
                    </div>
                    {printNote[g.key] && <div style={{ fontSize: 11, color: '#1d4ed8', padding: '0 4px' }}>{printNote[g.key]}</div>}
                    {i >= 2 && openSum.has(g.key) && (() => {
                      // 펼친 상자: 발주·송장·쉽먼트 번호를 다(누르면 복사).
                      const sm = summaryOf(g.list);
                      const chip = (label: string, v: string) => (
                        <span key={label + v} title={`눌러서 ${label} 복사`} onClick={() => copyNo(label, v)}
                          style={{ cursor: 'copy', textDecoration: 'underline dotted', textUnderlineOffset: 2, marginRight: 6 }}>{v}</span>
                      );
                      return (
                        <div style={{ fontSize: 11.5, color: '#6b7280', lineHeight: 1.6, padding: '0 4px' }}>
                          <div>발주 {sm.orders.map(v => (
                            <React.Fragment key={'o' + v}>{chip('발주번호', v)}<span onClick={() => editOrderNo(g.list, v)} title="이 발주번호 고치기"
                              style={{ cursor: 'pointer', color: '#2563eb', fontWeight: 700, marginRight: 8, marginLeft: -4 }}>✎</span></React.Fragment>
                          ))}</div>
                          <div>
                            송장 {sm.waybills.map(v => (
                              <React.Fragment key={'w' + v}>{chip('송장번호', v)}<span onClick={() => editWaybill(g.list, v)} title="이 송장번호 고치기"
                                style={{ cursor: 'pointer', color: '#2563eb', fontWeight: 700, marginLeft: -4 }}>✎</span>
                                <span style={{ marginRight: 8 }}>{reprintIcon(v, g.date)}</span></React.Fragment>
                            ))}
                            {!sm.waybills.length && <><span style={{ color: '#b45309' }}>없음 </span><span onClick={() => editWaybill(g.list, '')} title="이 상자 박스에 송장번호 넣기"
                              style={{ cursor: 'pointer', color: '#2563eb', fontWeight: 700 }}>+ 넣기</span></>}
                          </div>
                          <div>
                            쉽먼트 {sm.ships.length ? sm.ships.map(v => chip('쉽먼트 번호', v)) : <span style={{ color: '#b45309' }}>없음</span>}
                            <span onClick={() => setShipNos(g.list)} title="이 상자 발주서 전체에 쉽먼트 번호 넣기·고치기"
                              style={{ cursor: 'pointer', color: '#2563eb', fontWeight: 700 }}>{sm.ships.length ? '✎' : '+ 넣기'}</span>
                          </div>
                        </div>
                      );
                    })()}
                    {(() => {
                      // 안내문·이어서 하기를 보일 발주서: 덩어리에서 처음으로 할 일이 있는 발주서 하나.
                      const first = Math.max(0, g.list.findIndex(o => !!action(o) || !!runNote(o)));
                      return g.list.map((o, idx) => slim(o, idx === first));
                    })()}
                  </div>
                    );
                  })()
                )) : list.map(card)}
                {!list.length && <div style={{ padding: '18px 0', textAlign: 'center', fontSize: 12, color: '#c4c0bc' }}>{q ? '찾는 발주서 없음' : '비어 있음'}</div>}
              </div>
            );
          })}
        </div>
      </main>

      {layer}
      {newWindow}
      {assignWindow}
      {waybillBatch && <ShipmentWaybillModal batch={waybillBatch} onClose={() => setWaybillBatch(null)} />}
      {splitModal}
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
