import React, { useEffect, useMemo, useState } from 'react';
import type { AppMenuId } from '../AppSidebar';
import type { OrderRow } from './types';
import { loadWork, subscribeWork } from './data/orderWorkStore';
import { subscribeReservations } from './data/reservationStore';
import { ShipOut, subscribeShipOuts, shipOutStage } from './data/shipOutStore';
import { ShipmentBatch, subscribeShipments, waybillForBox } from '../../data/shipmentStore';
import { HanjungOrder, subscribeHanjung } from '../../data/hanjungStore';
import { HanjungQueueItem, subscribeHanjungQueue } from './data/hanjungQueueStore';
import { useReady } from './data/readyStore';
import { dateKeyYMD } from './utils/dateUtils';
import { expandBoxSplit, parseBoxNo } from './utils/dataProcessor';

// 발주 > 발주서 검색. 발주번호(일부만 넣어도 됨)나 상품이름으로 찾아서, 그 발주서 줄이 지금 어느 단계에 있는지 한 번에 보여준다.
//   쿠팡발주확인(발송 목록 · 묶음) → 예약/대기 → 한중발주(1688 주문) → 쉽먼트생성 → 발송대기 → 발송 완료
// 어디에도 없으면 "앱에 없음"으로 알려준다(지워졌거나 아직 수집 안 된 발주).

interface Hit {
  발주번호: string;
  상품이름: string;
  확정수량: number | '';
  물류센터: string;
  입고예정일: string; // YYYY-MM-DD
  stage: string;      // 단계 이름
  detail: string;     // 단계 안에서의 위치(묶음·출고번호·박스·운송장 등)
  color: string;
  menu: AppMenuId;
}

const STAGE = {
  order: { label: '쿠팡발주확인', color: '#b04a3e', menu: 'coupang-order' as AppMenuId },
  reserve: { label: '예약', color: '#27ae60', menu: 'coupang-order' as AppMenuId },
  wait: { label: '대기', color: '#7f8c8d', menu: 'coupang-order' as AppMenuId },
  hanjungWait: { label: '한중 대기', color: '#60a5fa', menu: 'cn-order' as AppMenuId },
  hanjung: { label: '한중발주', color: '#2563eb', menu: 'cn-order' as AppMenuId },
  ship: { label: '쉽먼트생성', color: '#e67e22', menu: 'coupang-ship' as AppMenuId },
  waiting: { label: '발송대기', color: '#7c3aed', menu: 'coupang-send' as AppMenuId },
  sent: { label: '발송 완료', color: '#15803d', menu: 'coupang-send' as AppMenuId },
};

const ymd = (v: unknown) => {
  const s = String(v ?? '');
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return v instanceof Date || s ? dateKeyYMD(v as Date | string) : '';
};
const md = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : d);

export default function OrderSearchPage({ onNavigate }: { onNavigate?: (menu: AppMenuId) => void } = {}) {
  const [q, setQ] = useState('');
  const [work, setWork] = useState<OrderRow[]>(() => loadWork().rows.filter(r => !r.isBlank).map(r => ({ ...r, 발주번호: r._발주번호, 물류센터: r._물류센터, 입고예정일: r._입고예정일 })));
  const [reservations, setReservations] = useState<OrderRow[]>([]);
  const [shipOuts, setShipOuts] = useState<ShipOut[]>([]);
  const [batches, setBatches] = useState<ShipmentBatch[]>([]);
  const [hanjung, setHanjung] = useState<HanjungOrder[]>([]);
  const [hanjungQueue, setHanjungQueue] = useState<HanjungQueueItem[]>([]);
  const readyStore = useReady();
  useEffect(() => subscribeHanjungQueue(setHanjungQueue), []);

  useEffect(() => subscribeWork(() => setWork(loadWork().rows.filter(r => !r.isBlank).map(r => ({ ...r, 발주번호: r._발주번호, 물류센터: r._물류센터, 입고예정일: r._입고예정일 })))), []);
  useEffect(() => subscribeReservations(setReservations), []);
  useEffect(() => subscribeShipOuts(setShipOuts), []);
  useEffect(() => subscribeShipments(setBatches), []);
  useEffect(() => subscribeHanjung(setHanjung), []);

  // 모든 단계의 줄을 한 목록으로 모은다.
  const all: Hit[] = useMemo(() => {
    const out: Hit[] = [];
    for (const r of work) {
      out.push({
        발주번호: r.발주번호, 상품이름: r.상품이름, 확정수량: r.확정수량, 물류센터: r.물류센터, 입고예정일: ymd(r.입고예정일),
        stage: STAGE.order.label, color: STAGE.order.color, menu: STAGE.order.menu,
        detail: [r.묶음 ? `묶음 ${r.묶음}` : '발송 목록', r.메모 ? `메모 ${r.메모}` : '', readyStore.isReady(r) ? '준비됨' : '준비 전'].filter(Boolean).join(' · '),
      });
    }
    for (const r of reservations) {
      const st = (r.메모 || '').includes('대기') ? STAGE.wait : STAGE.reserve;
      out.push({
        발주번호: r.발주번호, 상품이름: r.상품이름, 확정수량: r.확정수량, 물류센터: r.물류센터, 입고예정일: ymd(r.입고예정일),
        stage: st.label, color: st.color, menu: st.menu,
        detail: [r.묶음 ? `묶음 ${r.묶음}` : '', r.메모 && r.메모 !== st.label ? r.메모 : ''].filter(Boolean).join(' · ') || '예약 목록',
      });
    }
    for (const q of hanjungQueue) {
      out.push({
        발주번호: q.발주번호, 상품이름: q.상품이름, 확정수량: q.확정수량, 물류센터: q.물류센터, 입고예정일: ymd(q.입고예정일),
        stage: STAGE.hanjungWait.label, color: STAGE.hanjungWait.color, menu: STAGE.hanjungWait.menu,
        detail: '1688 주문 전',
      });
    }
    for (const o of hanjung) {
      for (const l of o.lines) {
        out.push({
          발주번호: l.발주번호, 상품이름: l.상품이름, 확정수량: l.확정수량, 물류센터: l.물류센터, 입고예정일: ymd(l.입고예정일),
          stage: STAGE.hanjung.label, color: STAGE.hanjung.color, menu: STAGE.hanjung.menu,
          detail: `${o.code}${o.receipts.length ? ` · 입고 ${o.receipts.length}회` : ''}`,
        });
      }
    }
    for (const s of shipOuts) {
      const stage = shipOutStage(s, batches);
      const st = stage === 'sent' ? STAGE.sent : stage === 'waiting' ? STAGE.waiting : STAGE.ship;
      for (const l of s.lines) {
        const boxes = expandBoxSplit({ ...l, 쉼먼트: l.쉼먼트 || '' }).map(p => parseBoxNo(p.쉼먼트) || 0).filter(Boolean);
        const wbs = boxes.map(no => waybillForBox(batches, s, no)).filter(Boolean);
        const parts = [
          `${s.id} (${s.center} ${md(s.date)})`,
          boxes.length ? boxes.map(n => `박스${n}`).join('·') : '박스 미지정',
          wbs.length ? `운송장 ${wbs.join(', ')}` : '',
          stage !== 'sent' ? (readyStore.isReady(l, s.readyKeys) ? '준비됨' : '준비 전') : '',
          stage === 'sent' ? `${md(s.sentDate || '')} 발송` : '',
        ];
        out.push({
          발주번호: l.발주번호, 상품이름: l.상품이름, 확정수량: l.확정수량, 물류센터: l.물류센터, 입고예정일: ymd(l.입고예정일),
          stage: st.label, color: st.color, menu: st.menu, detail: parts.filter(Boolean).join(' · '),
        });
      }
    }
    return out;
  }, [work, reservations, hanjung, hanjungQueue, shipOuts, batches, readyStore]);

  // 검색: 숫자면 발주번호(일부), 아니면 상품이름(띄어쓰기로 나눈 말이 모두 들어간 것). 여러 발주번호를 쉼표·줄바꿈으로 넣어도 된다.
  const terms = q.split(/[\s,]+/).map(t => t.trim()).filter(Boolean);
  const isNumbers = terms.length > 0 && terms.every(t => /^\d{3,}$/.test(t));
  const results = useMemo(() => {
    if (!terms.length) return [];
    if (isNumbers) return all.filter(h => terms.some(t => h.발주번호.includes(t)));
    const words = terms.map(t => t.toLowerCase());
    return all.filter(h => words.every(w => h.상품이름.toLowerCase().includes(w)));
  }, [all, q]);

  // 발주번호별로 묶는다.
  const groups = useMemo(() => {
    const m = new Map<string, Hit[]>();
    for (const h of results) m.set(h.발주번호, [...(m.get(h.발주번호) || []), h]);
    return Array.from(m.entries()).sort((a, b) => b[0].localeCompare(a[0], 'ko', { numeric: true }));
  }, [results]);
  // 발주번호로 찾았는데 앱 어디에도 없는 번호(8자리 이상 통째로 넣은 것만).
  const missing = isNumbers ? terms.filter(t => t.length >= 8 && !all.some(h => h.발주번호 === t)) : [];

  return (
    <div style={{ minHeight: '100vh', background: '#fff', color: '#1a1a1a', fontFamily: "'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif" }}>
      <header style={{ background: '#fff', borderBottom: '1px solid #f0f0f0', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 24px', height: 54, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.3px' }}>🔎 발주서 검색</span>
          <span style={{ fontSize: 12, color: '#999' }}>앱 전체 {new Set(all.map(h => h.발주번호)).size}건에서 찾아요</span>
        </div>
      </header>

      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '20px 24px 60px' }}>
        <input
          autoFocus
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="발주번호(일부도 됨, 여러 개는 쉼표로) 또는 상품이름"
          style={{ width: '100%', boxSizing: 'border-box', padding: '12px 14px', fontSize: 15, borderRadius: 10, border: '1.5px solid #d5d5d5', outline: 'none' }}
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10, fontSize: 11 }}>
          {Object.values(STAGE).map(s => (
            <span key={s.label} style={{ padding: '1px 8px', borderRadius: 999, color: s.color, background: `${s.color}14`, border: `1px solid ${s.color}40`, fontWeight: 700 }}>{s.label}</span>
          ))}
        </div>

        {missing.map(no => (
          <div key={no} style={{ marginTop: 14, padding: '10px 12px', borderRadius: 10, background: '#fdecea', color: '#c0392b', fontSize: 13, fontWeight: 700 }}>
            {no} · 앱에 없음 <span style={{ fontWeight: 500, color: '#a5544b' }}>(아직 수집 안 됐거나, 지워졌어요)</span>
          </div>
        ))}

        {terms.length > 0 && !groups.length && !missing.length && (
          <div style={{ marginTop: 24, color: '#bbb', fontSize: 13, textAlign: 'center' }}>찾은 발주서가 없어요.</div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 14 }}>
          {groups.map(([no, hits]) => (
            <div key={no} style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: '#fafafa', borderBottom: '1px solid #f0f0f0' }}>
                <b style={{ fontSize: 15, fontFamily: 'monospace' }}>{no}</b>
                <span style={{ fontSize: 12, color: '#666' }}>{Array.from(new Set(hits.map(h => h.물류센터))).join(', ')}</span>
                <span style={{ fontSize: 12, color: '#666' }}>입고 {Array.from(new Set(hits.map(h => md(h.입고예정일)))).join(', ')}</span>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                  {Array.from(new Set(hits.map(h => h.stage))).map(label => {
                    const h = hits.find(x => x.stage === label)!;
                    return <span key={label} style={{ padding: '1px 8px', fontSize: 11, fontWeight: 800, borderRadius: 999, color: '#fff', background: h.color }}>{label}</span>;
                  })}
                </span>
              </div>
              {hits.map((h, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', borderTop: i ? '1px solid #f5f5f5' : 'none', fontSize: 13 }}>
                  <span style={{ minWidth: 74, padding: '1px 8px', fontSize: 11, fontWeight: 800, borderRadius: 999, textAlign: 'center', color: h.color, background: `${h.color}14`, border: `1px solid ${h.color}40` }}>{h.stage}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>{h.상품이름}</span>
                  <b style={{ minWidth: 44, textAlign: 'right' }}>{h.확정수량}개</b>
                  <span style={{ minWidth: 220, fontSize: 11.5, color: '#777' }}>{h.detail}</span>
                  {onNavigate && (
                    <button
                      onClick={() => onNavigate(h.menu)}
                      style={{ padding: '2px 9px', fontSize: 11, fontWeight: 700, borderRadius: 6, border: '1px solid #ddd', background: '#fff', color: '#555', cursor: 'pointer', whiteSpace: 'nowrap' }}
                    >
                      가기 →
                    </button>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
