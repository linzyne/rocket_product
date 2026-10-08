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

// 발주 > 발주 진행. 발주서 하나를 한 줄에 두고, 그 발주서가 지금 어느 단계인지 보여준다.
//   발주확정 → 묶음 → 쉽먼트(택배예약·서허 일괄등록) → 출력(문서·바코드) → 발송대기 → 발송완료
// 단계는 발주확인·예약·쉽먼트생성·발송대기 목록에서 그 발주서 줄이 어디 있는지로 계산한다.
// 한 발주서의 줄이 여러 단계에 나뉘어 있으면 가장 앞 단계를 보여주고 "일부"로 알린다.

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
  const [reservations, setReservations] = useState<OrderRow[]>([]);
  const [shipOuts, setShipOuts] = useState<ShipOut[]>([]);
  const [batches, setBatches] = useState<ShipmentBatch[]>([]);
  const [confirmed, setConfirmedMap] = useState<Record<string, number>>({});
  const [tab, setTab] = useState<Stage | 'active'>('active');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [waybillBatch, setWaybillBatch] = useState<ShipmentBatch | null>(null);

  useEffect(() => subscribeWork(() => setWork(readWork().rows)), []);
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

  const counts = useMemo(() => {
    const c = [0, 0, 0, 0, 0, 0];
    orders.forEach(o => { c[o.stage]++; });
    return c;
  }, [orders]);

  const q = query.trim().toLowerCase();
  const shown = orders.filter(o =>
    (tab === 'active' ? o.stage < 5 : o.stage === tab)
    && (!q || o.no.includes(q) || o.center.toLowerCase().includes(q) || o.lines.some(l => l.상품이름.toLowerCase().includes(q))));
  // 발송완료는 최근 보낸 것이 위로.
  if (tab === 5) shown.sort((a, b) => (b.item?.sentDate || '').localeCompare(a.item?.sentDate || ''));

  const toggleOpen = (no: string) => setOpen(prev => {
    const next = new Set(prev);
    if (next.has(no)) next.delete(no); else next.add(no);
    return next;
  });

  const confirm1 = (nos: string[], on: boolean) =>
    setConfirmed(nos, on).catch(err => alert(`발주확정 표시 저장 실패: ${err instanceof Error ? err.message : String(err)}`));

  const run = (o: FlowOrder) => o.stage === 2 ? o.batch?.run : undefined;

  // 단계마다 다음에 할 일 버튼.
  const action = (o: FlowOrder) => {
    const r = run(o);
    switch (o.stage) {
      case 0:
        return <button style={btn(ORANGE, true)} onClick={() => confirm1([o.no], true)} title="서허에 발주확정을 올렸으면 눌러 주세요">✓ 확정했어요</button>;
      case 1:
        return <button style={btn(ORANGE)} onClick={() => onNavigate('coupang-order')} title="쿠팡발주확인에서 묶고 쉽먼트생성으로 보냅니다">묶음·보내기 →</button>;
      case 2:
        return (
          <span style={{ display: 'inline-flex', gap: 6 }}>
            {o.item && o.batch && (!r || r.state !== 'running') && (
              <button style={btn(ORANGE, true)} onClick={() => resumeShipment(o.batch!, [o.item!])} title="멈춘 데서 이어서 합니다. 택배예약은 다시 하지 않아요.">▶ 이어서 하기</button>
            )}
            <button style={btn(ORANGE, !o.batch)} onClick={() => onNavigate('coupang-ship')} title={o.batch ? '쉽먼트생성대기 화면' : '쉽먼트생성대기에서 택배예약부터 시작합니다'}>
              {o.batch ? '쉽먼트 화면 →' : '쉽먼트 시작 →'}
            </button>
          </span>
        );
      case 3:
        return <button style={btn(ORANGE, true)} onClick={() => onNavigate('coupang-send')} title="발송대기 화면에서 문서와 바코드를 출력합니다">출력하러 →</button>;
      case 4:
        return <button style={btn(GREEN)} onClick={() => onNavigate('coupang-send')} title="준비되면 발송대기 화면에서 발송 완료를 누릅니다">발송대기 →</button>;
      default:
        return <span style={{ fontSize: 12, color: GREEN, fontWeight: 700 }}>{dayText(o.item?.sentDate || '')} 발송</span>;
    }
  };

  const tabs: { id: Stage | 'active'; label: string; n: number }[] = [
    { id: 'active', label: '진행 중 전체', n: counts.slice(0, 5).reduce((s, x) => s + x, 0) },
    ...STAGES.map((label, i) => ({ id: i as Stage, label, n: counts[i] })),
  ];

  return (
    <div style={{ minHeight: '100vh', background: '#fff', color: '#1a1a1a', fontFamily: "'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif" }}>
      <header style={{ background: '#fff', borderBottom: '1px solid #f0f0f0', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '8px clamp(12px, 4vw, 24px)', boxSizing: 'border-box', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px 12px' }}>
          <h1 style={{ fontSize: 17, fontWeight: 800, margin: 0 }}>발주 진행</h1>
          <span style={{ fontSize: 12, color: '#888' }}>발주서마다 지금 단계와 다음 할 일</span>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="발주번호·센터·상품 찾기"
            style={{ marginLeft: 'auto', padding: '6px 10px', fontSize: 13, border: '1px solid #e0e0e0', borderRadius: 8, minWidth: 180 }}
          />
        </div>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 clamp(12px, 4vw, 24px) 8px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {tabs.map(t => (
            <button
              key={String(t.id)}
              onClick={() => setTab(t.id)}
              style={{
                padding: '5px 12px', fontSize: 12.5, fontWeight: 700, borderRadius: 999, cursor: 'pointer',
                border: `1.5px solid ${tab === t.id ? ORANGE : '#e5e5e5'}`,
                background: tab === t.id ? ORANGE : '#fff', color: tab === t.id ? '#fff' : '#555',
              }}
            >
              {t.label} <span style={{ opacity: 0.8 }}>{t.n}</span>
            </button>
          ))}
        </div>
      </header>

      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '14px clamp(10px, 4vw, 24px) 70px' }}>
        {tab === 0 && shown.length > 1 && (
          <div style={{ marginBottom: 10, fontSize: 12, color: '#666', display: 'flex', alignItems: 'center', gap: 8 }}>
            서허에 한꺼번에 확정했으면
            <button style={btn(ORANGE)} onClick={() => { if (window.confirm(`보이는 발주서 ${shown.length}건을 모두 확정했다고 표시할까요?`)) confirm1(shown.map(o => o.no), true); }}>
              보이는 {shown.length}건 모두 확정
            </button>
          </div>
        )}

        {!shown.length && (
          <div style={{ padding: '48px 0', textAlign: 'center', color: '#aaa', fontSize: 14 }}>
            {q ? '찾는 발주서가 없어요.' : '이 단계에 있는 발주서가 없어요.'}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {shown.map(o => {
            const r = run(o);
            const qty = o.lines.reduce((s, l) => s + (Number(l.확정수량) || 0), 0);
            const isOpen = open.has(o.no);
            const shipNo = o.item?.shipmentNos?.[o.no];
            return (
              <div key={o.no} style={{ border: `1px solid ${r?.state === 'error' ? '#fecaca' : '#eee'}`, borderRadius: 10, background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px 14px', padding: '10px 12px' }}>
                  <button onClick={() => toggleOpen(o.no)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 0, textAlign: 'left', minWidth: 190 }} title="상품 줄 보기">
                    <div style={{ fontSize: 14, fontWeight: 800, color: '#222' }}>
                      <span style={{ color: '#bbb', fontSize: 11, marginRight: 4 }}>{isOpen ? '▼' : '▶'}</span>
                      {o.no}
                    </div>
                    <div style={{ fontSize: 12, color: '#777', marginTop: 2 }}>
                      {o.center || '센터 없음'} · 입고 {dayText(o.date)} · {o.lines.length}종 {qty}개
                    </div>
                  </button>

                  <Stepper stage={o.stage} error={r?.state === 'error'} />

                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginLeft: 'auto' }}>
                    {o.bundle && o.stage === 1 && <Tag color="#6b7280">{o.bundle}</Tag>}
                    {o.hold && o.stage === 1 && <Tag color="#7c3aed">{o.hold}</Tag>}
                    {shipNo && <Tag color="#2563eb">쉽먼트 {shipNo}</Tag>}
                    {o.partial && <Tag color={RED}>일부만 넘어감</Tag>}
                    {action(o)}
                  </div>
                </div>

                {r && r.state !== 'done' && (
                  <div style={{
                    margin: '0 12px 10px', padding: '6px 10px', borderRadius: 6, fontSize: 12, lineHeight: 1.5,
                    background: r.state === 'error' ? '#fef2f2' : '#eff6ff', color: r.state === 'error' ? '#b91c1c' : '#1d4ed8',
                  }}>
                    <b>{r.state === 'error' ? `⛔ ${STEP_LABEL[r.step]}에서 멈춤` : `⏳ ${STEP_LABEL[r.step]} 하는 중`}</b> · {r.message}
                  </div>
                )}

                {isOpen && (
                  <div style={{ borderTop: '1px solid #f4f4f4', padding: '8px 12px 10px 32px', fontSize: 12.5 }}>
                    {o.lines.map((l, i) => (
                      <div key={i} style={{ display: 'flex', gap: 10, padding: '3px 0', alignItems: 'baseline' }}>
                        <span style={{ flex: 1, color: '#333' }}>{l.상품이름}</span>
                        <b style={{ minWidth: 40, textAlign: 'right' }}>{l.확정수량}개</b>
                        <span style={{ minWidth: 150, color: l.stage === o.stage ? '#888' : RED, fontSize: 11.5 }}>{STAGES[l.stage]} · {l.where}</span>
                      </div>
                    ))}
                    {o.confirmed && o.stage <= 1 && !o.bundle && (
                      <button onClick={() => confirm1([o.no], false)} style={{ marginTop: 6, border: 'none', background: 'transparent', color: '#999', fontSize: 11.5, cursor: 'pointer', textDecoration: 'underline' }}>
                        확정 표시 취소
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </main>

      {waybillBatch && <ShipmentWaybillModal batch={waybillBatch} onClose={() => setWaybillBatch(null)} />}
    </div>
  );
}

// 6단계 점 줄: 끝난 단계는 초록, 지금 단계는 주황(멈췄으면 빨강), 남은 단계는 회색.
const Stepper: React.FC<{ stage: Stage; error?: boolean }> = ({ stage, error }) => (
  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', rowGap: 4 }}>
    {STAGES.map((label, i) => {
      const done = i < stage || stage === 5;
      const now = i === stage && stage !== 5;
      const color = done ? GREEN : now ? (error ? RED : ORANGE) : GRAY;
      return (
        <React.Fragment key={label}>
          {i > 0 && <span style={{ width: 14, height: 2, background: i <= stage ? GREEN : '#e5e5e5' }} />}
          <span style={{
            padding: '2px 8px', fontSize: 11.5, fontWeight: now ? 800 : 600, borderRadius: 999, whiteSpace: 'nowrap',
            border: `1.5px solid ${color}`, background: now ? color : done ? '#f0fdf4' : '#fff', color: now ? '#fff' : color,
          }}>
            {done ? '✓ ' : ''}{label}
          </span>
        </React.Fragment>
      );
    })}
  </div>
);

const Tag: React.FC<{ color: string; children: React.ReactNode }> = ({ color, children }) => (
  <span style={{ padding: '1px 8px', fontSize: 11, fontWeight: 700, borderRadius: 999, border: `1px solid ${color}`, color, whiteSpace: 'nowrap' }}>{children}</span>
);

const btn = (color: string, solid = false): React.CSSProperties => ({
  padding: '5px 11px', fontSize: 12, fontWeight: 700, borderRadius: 7, cursor: 'pointer', whiteSpace: 'nowrap',
  border: `1.5px solid ${color}`, background: solid ? color : '#fff', color: solid ? '#fff' : color,
});
