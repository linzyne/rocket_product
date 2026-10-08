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
import { subscribePoForms, readDraft, setDraftLine, hasForm, savePoForm, SHORT_REASONS, DEFAULT_REASON } from '../coupangOrder/data/poFormStore';
import { startConfirmUpload, subscribeConfirmJob, clearConfirmJob, ConfirmJob } from '../coupangOrder/data/poConfirmRunner';

// 발주 > 발주 진행. 단계마다 상자를 옆으로 두고, 발주서가 지금 단계의 상자 안에 담긴다(상자 안에서는 위아래 한 줄).
//   발주확정 → 묶음 → 쉽먼트(택배예약·서허 일괄등록) → 출력(문서·바코드) → 발송대기 → 발송완료
// 단계는 발주확인·예약·쉽먼트생성·발송대기 목록에서 그 발주서 줄이 어디 있는지로 계산한다.
// 한 발주서의 줄이 여러 단계에 나뉘어 있으면 가장 앞 단계의 상자에 두고 "일부만 넘어감"으로 알린다.

const STAGES = ['발주확정', '묶음', '쉽먼트', '출력', '발송대기', '발송완료'] as const;
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

export default function CoupangFlowPage({ onNavigate }: { onNavigate: (menu: AppMenuId) => void }) {
  const [work, setWork] = useState(() => readWork().rows);
  // 발주번호 → 처음 들어온 시각(24시간 안에 들어온 것만 남아 있다). NEW 표시와 발주확정 상자 순서에 쓴다.
  const [seenAt, setSeenAt] = useState(() => readWork().seen);
  const [reservations, setReservations] = useState<OrderRow[]>([]);
  const [shipOuts, setShipOuts] = useState<ShipOut[]>([]);
  const [batches, setBatches] = useState<ShipmentBatch[]>([]);
  const [confirmed, setConfirmedMap] = useState<Record<string, number>>({});
  const [query, setQuery] = useState('');
  const [waybillBatch, setWaybillBatch] = useState<ShipmentBatch | null>(null);
  // 발주확정 양식·고친 수량이 바뀌면 다시 그린다.
  const [, setFormTick] = useState(0);
  useEffect(() => subscribePoForms(() => setFormTick(t => t + 1)), []);
  const [confirmJob, setConfirmJob] = useState<ConfirmJob | null>(null);
  useEffect(() => subscribeConfirmJob(setConfirmJob), []);
  // 발주확정 올리기: 발주확정 상자의 발주서들로 PO_FOR_CONFIRM 파일을 채워 서허에 올린다.
  const uploadConfirm = (list: FlowOrder[]) => {
    const nos = list.map(o => o.no);
    const noForm = nos.filter(no => !hasForm(no));
    const zero = list.flatMap(o => o.lines.filter(l => readDraft(o.no).qty[l.상품이름] === 0).map(l => `${o.no} ${l.상품이름}`));
    if (!window.confirm(
      `발주확정 상자의 발주서 ${nos.length - noForm.length}건을 서허에 확정으로 올릴까요?` +
      (zero.length ? `\n\n확정수량 0개(사유: 단종 등) ${zero.length}줄:\n${zero.slice(0, 8).join('\n')}${zero.length > 8 ? '\n…' : ''}` : '') +
      (noForm.length ? `\n\n양식 파일이 없어 빠지는 발주서 ${noForm.length}건: ${noForm.join(', ')}` : ''),
    )) return;
    const file = startConfirmUpload(nos);
    if (!file) alert('이 발주서들의 발주확정 양식(PO_FOR_CONFIRM 파일)이 없어요. "양식 파일 넣기"로 다운로드 폴더의 파일을 넣어 주세요.');
  };
  // 다운로드 폴더의 PO_FOR_CONFIRM 파일을 직접 넣는다(예전에 받아 앱에 양식이 없는 발주서용).
  const pickForm = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xlsx';
    input.multiple = true;
    input.onchange = async () => {
      const files = Array.from(input.files || []);
      let ok = 0;
      for (const f of files) if (await savePoForm(f).catch(() => false)) ok++;
      alert(ok ? `발주확정 양식 ${ok}개를 넣었어요.` : '발주확정 양식(PO_FOR_CONFIRM 파일)이 아니에요.');
    };
    input.click();
  };
  // 새 주문 수집 결과(발주확정 상자 위에 보여준다).
  const [collectNote, setCollectNote] = useState('');
  const handleOrderFile = async (file: File) => {
    try {
      const { added, skipped } = await appendOrderFile(file, reservations);
      setCollectNote(added ? `✅ 새 발주 ${added}줄을 발주확정 상자에 넣었어요${skipped ? ` (이미 있는 ${skipped}줄 제외)` : ''}` : `새로 들어온 줄이 없어요${skipped ? ` (이미 있는 ${skipped}줄)` : ''}`);
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
        const stage: Stage = st === 'ship' ? 2 : st === 'sent' ? 5 : (item.printedOrders || []).includes(no) ? 4 : 3;
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
        return <button style={btn('#6b7280')} onClick={() => confirm1([o.no], true)} title="서허에서 직접 확정했으면 눌러서 묶음 상자로 넘깁니다">직접 확정함</button>;
      case 1:
        return <button style={btn(ORANGE)} onClick={() => onNavigate('coupang-order')} title="쿠팡발주확인에서 묶고 쉽먼트생성으로 보냅니다">묶음·보내기 →</button>;
      case 2:
        return (
          <>
            {o.item && o.batch && (!r || r.state !== 'running') && (
              <button style={btn(ORANGE, true)} onClick={() => resumeShipment(o.batch!, [o.item!])} title="멈춘 데서 이어서 합니다. 택배예약은 다시 하지 않아요.">▶ 이어서 하기</button>
            )}
            <button style={btn(ORANGE, !o.batch)} onClick={() => onNavigate('coupang-ship')} title={o.batch ? '쉽먼트생성대기 화면' : '쉽먼트생성대기에서 택배예약부터 시작합니다'}>
              {o.batch ? '쉽먼트 →' : '쉽먼트 시작 →'}
            </button>
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

  // 발주서 카드 하나(상자 폭에 맞춘 세로 카드).
  const card = (o: FlowOrder) => {
    const r = run(o);
    const qty = o.lines.reduce((sum, l) => sum + (Number(l.확정수량) || 0), 0);
    const shipNo = o.item?.shipmentNos?.[o.no];
    return (
      <div key={o.no} style={{
        background: '#fff', borderRadius: 9, padding: '9px 10px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        border: `1px solid ${r?.state === 'error' ? '#fca5a5' : '#ececec'}`, display: 'flex', flexDirection: 'column', gap: 6,
      }}>
        {/* 입고예정일·센터를 가장 크게 */}
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap', lineHeight: 1.2 }}>
            <span style={{ fontSize: 17, fontWeight: 900, color: '#111' }}>{dayText(o.date)}</span>
            <span style={{ fontSize: 17, fontWeight: 900, color: ORANGE }}>{o.center || '센터 없음'}</span>
          </div>
          <div style={{ fontSize: 11.5, color: '#888', marginTop: 2 }}>
            발주 {o.no}
            {seenAt[o.no] && Date.now() - seenAt[o.no] < 24 * 60 * 60 * 1000 && (
              <span style={{ marginLeft: 5, padding: '0 5px', borderRadius: 4, background: RED, color: '#fff', fontSize: 10, fontWeight: 800 }}>NEW</span>
            )}
          </div>
        </div>

        {((o.bundle || o.hold) && o.stage === 1) || shipNo || o.partial ? (
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {o.bundle && o.stage === 1 && <Tag color="#6b7280">{o.bundle}</Tag>}
            {o.hold && o.stage === 1 && <Tag color="#7c3aed">{o.hold}</Tag>}
            {shipNo && <Tag color="#2563eb">쉽먼트 {shipNo}</Tag>}
            {o.partial && <Tag color={RED}>일부만 넘어감</Tag>}
          </div>
        ) : null}
        {o.stage === 0 && !hasForm(o.no) && (
          <div style={{ fontSize: 10.5, color: '#b45309' }}>⚠ 발주확정 양식 없음 — 상자 위 "양식 파일 넣기"로 PO_FOR_CONFIRM 파일을 넣어 주세요</div>
        )}

        {r && r.state !== 'done' && (
          <div style={{
            padding: '5px 7px', borderRadius: 6, fontSize: 11.5, lineHeight: 1.45,
            background: r.state === 'error' ? '#fef2f2' : '#eff6ff', color: r.state === 'error' ? '#b91c1c' : '#1d4ed8',
          }}>
            <b>{r.state === 'error' ? `⛔ ${STEP_LABEL[r.step]}에서 멈춤` : `⏳ ${STEP_LABEL[r.step]} 하는 중`}</b> · {r.message}
          </div>
        )}

        {/* 상품. 다른 상자에 가 있는 줄은 어디 있는지 빨갛게 적는다. */}
        <div style={{ fontSize: 12, borderTop: '1px solid #f3f3f3', paddingTop: 5 }}>
          {o.lines.map((l, i) => {
            // 발주확정 상자에서는 확정수량을 바로 고친다. 발주수량보다 줄이면 사유를 고른다(기본: 시장 단종).
            const editable = o.stage === 0 && l.stage === 0;
            const draft = readDraft(o.no);
            const full = Number(l.확정수량) || 0;
            const now = draft.qty[l.상품이름] ?? full;
            return (
            <div key={i} style={{ padding: '2px 0' }}>
              <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                <span style={{ flex: 1, minWidth: 0, color: now < full ? RED : '#333', wordBreak: 'keep-all', textDecoration: editable && now === 0 ? 'line-through' : 'none' }}>{l.상품이름}</span>
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
                  <b style={{ flexShrink: 0 }}>{l.확정수량}개</b>
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
          {o.lines.length > 1 && <div style={{ fontSize: 10.5, color: '#aaa', textAlign: 'right' }}>{o.lines.length}종 · {qty}개</div>}
        </div>

        <div style={{ display: 'flex', gap: 4, flexWrap: 'nowrap', alignItems: 'center' }}>
          {action(o)}
          {o.confirmed && o.stage <= 1 && !o.bundle && (
            <button onClick={() => confirm1([o.no], false)} style={{ marginLeft: 'auto', padding: 0, border: 'none', background: 'transparent', color: '#aaa', fontSize: 10.5, cursor: 'pointer', textDecoration: 'underline' }}>
              확정 취소
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={{ minHeight: '100vh', background: '#fff', color: '#1a1a1a', fontFamily: "'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif" }}>
      <header style={{ background: '#fff', borderBottom: '1px solid #f0f0f0', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ padding: '8px clamp(12px, 3vw, 20px)', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px 12px' }}>
          <h1 style={{ fontSize: 17, fontWeight: 800, margin: 0 }}>발주 진행</h1>
          <span style={{ fontSize: 12, color: '#888' }}>발주서가 지금 있는 상자 = 지금 단계</span>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="발주번호·센터·상품 찾기"
            style={{ padding: '6px 10px', fontSize: 13, border: '1px solid #e0e0e0', borderRadius: 8, minWidth: 180 }}
          />
        </div>
      </header>

      {/* 상자는 단계 순서대로 옆으로, 발주서는 상자 안에서 위아래 한 줄로. */}
      <main style={{ display: 'flex', alignItems: 'flex-start', gap: 10, overflowX: 'auto', padding: '12px clamp(10px, 3vw, 20px) 70px' }}>
        {STAGES.map((label, i) => {
          const list = boxes[i];
          const stuck = i === 2 ? list.filter(o => run(o)?.state === 'error').length : 0;
          return (
            <div key={label} style={{ flex: '0 0 250px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* 1번 상자(발주확정) 위: 서허에서 새 주문 받아 오기 */}
            {i === 0 && (
              <div style={{ background: '#eff6ff', borderRadius: 12, padding: 8 }}>
                <CollectPurchaseOrders onFile={handleOrderFile} compact label="📥 새 주문 수집" />
                {collectNote && <div style={{ marginTop: 6, fontSize: 11.5, color: collectNote.startsWith('⛔') ? RED : '#1d4ed8', lineHeight: 1.4 }}>{collectNote}</div>}
              </div>
            )}
            <section style={{ background: '#f5f5f4', borderRadius: 12, padding: 8, boxSizing: 'border-box' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 4px 8px' }}>
                <b style={{ fontSize: 14, color: '#333' }}>{label}</b>
                <span style={{ fontSize: 12, fontWeight: 800, color: '#fff', background: list.length ? (i === 5 ? GREEN : ORANGE) : GRAY, borderRadius: 999, padding: '0 7px' }}>{list.length}</span>
                {stuck > 0 && <span style={{ fontSize: 11.5, fontWeight: 800, color: RED }}>⛔ 멈춤 {stuck}</span>}
                {i === 5 && <span style={{ fontSize: 10.5, color: '#999', marginLeft: 'auto' }}>최근 {SENT_DAYS}일</span>}
              </div>
              {i === 0 && list.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 8 }}>
                  <button
                    style={{ ...btn(ORANGE, true), width: '100%', padding: '7px 8px', fontSize: 12.5 }}
                    disabled={!!confirmJob && !['done', 'applied', 'error'].includes(confirmJob.step)}
                    onClick={() => uploadConfirm(list)}
                    title="확정수량(I열)·납품부족사유(M열)를 채운 발주확정 파일을 만들어 서허 발주확정 업로드에 올립니다"
                  >
                    📤 발주확정 올리기 ({list.length}건)
                  </button>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button style={{ ...btn('#6b7280'), flex: 1 }} onClick={pickForm} title="앱에 양식이 없는 발주서: 다운로드 폴더의 PO_FOR_CONFIRM 파일을 넣어요">양식 파일 넣기</button>
                    <button
                      style={{ ...btn('#6b7280'), flex: 1 }}
                      onClick={() => { if (window.confirm(`서허에서 직접 확정한 발주서 ${list.length}건을 확정됨으로만 표시할까요?`)) confirm1(list.map(o => o.no), true); }}
                      title="서허에서 직접 확정했을 때: 올리지 않고 표시만 해서 묶음 상자로 넘깁니다"
                    >
                      직접 확정함
                    </button>
                  </div>
                  {confirmJob && (
                    <div style={{
                      fontSize: 11.5, lineHeight: 1.45, padding: '5px 7px', borderRadius: 6,
                      background: confirmJob.step === 'error' ? '#fef2f2' : confirmJob.step === 'applied' ? '#ecfdf5' : '#eff6ff',
                      color: confirmJob.step === 'error' ? '#b91c1c' : confirmJob.step === 'applied' ? '#047857' : '#1d4ed8',
                    }}>
                      {confirmJob.status}
                      {(confirmJob.messages || []).length > 0 && <div>💬 {(confirmJob.messages || []).join(' / ')}</div>}
                      {['applied', 'error'].includes(confirmJob.step) && (
                        <button onClick={clearConfirmJob} style={{ marginLeft: 6, border: 'none', background: 'transparent', color: '#888', cursor: 'pointer', fontSize: 11, textDecoration: 'underline' }}>닫기</button>
                      )}
                    </div>
                  )}
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {list.map(card)}
                {!list.length && <div style={{ padding: '18px 0', textAlign: 'center', fontSize: 12, color: '#bbb' }}>{q ? '찾는 발주서 없음' : '비어 있음'}</div>}
              </div>
            </section>
            </div>
          );
        })}
      </main>

      {waybillBatch && <ShipmentWaybillModal batch={waybillBatch} onClose={() => setWaybillBatch(null)} />}
    </div>
  );
}

const Tag: React.FC<{ color: string; children: React.ReactNode }> = ({ color, children }) => (
  <span style={{ padding: '1px 7px', fontSize: 10.5, fontWeight: 700, borderRadius: 999, border: `1px solid ${color}`, color, whiteSpace: 'nowrap' }}>{children}</span>
);

const btn = (color: string, solid = false): React.CSSProperties => ({
  padding: '4px 8px', fontSize: 11.5, fontWeight: 700, borderRadius: 7, cursor: 'pointer', whiteSpace: 'nowrap',
  border: `1.5px solid ${color}`, background: solid ? color : '#fff', color: solid ? '#fff' : color,
});
