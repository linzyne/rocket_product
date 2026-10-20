// 발송대기 마감 알림. 발주서는 입고예정일 하루 전까지 발송대기(또는 발송완료)에 들어가 있어야 한다
// (입고예정일 20일이면 늦어도 19일). 쉽먼트를 안 해서 발송대기에 못 올리면 쿠팡이 발주를 취소한다.
// 그래서 입고예정일 이틀 전부터 아직 발송대기에 안 들어간 발주서를 모아 알린다.
//   마감일 = 입고예정일 − 1일 · 남은 날 = 마감일 − 오늘
//   남은 날 1(내일까지) · 0(오늘까지) · 음수(마감 지남)
// 발송대기로 치는 기준은 발주 진행 화면과 같다: 보낸 날이 있거나, 쉽먼트를 끝내고(서허 등록) 출력했거나 "발송대기로"를 누른 건.
import { useEffect, useMemo, useState } from 'react';
import { linesAt, subscribeLines } from './lineStore';
import { ShipOut, shipOutStage, subscribeShipOuts } from './shipOutStore';
import { ShipmentBatch, subscribeShipments } from '../../../data/shipmentStore';

export interface DeadlineOrder {
  no: string;
  center: string;
  due: string;       // 입고예정일 YYYY-MM-DD
  deadline: string;  // 발송대기 마감일(입고예정일 하루 전)
  daysLeft: number;  // 마감일까지 남은 날(0 = 오늘까지, 음수 = 지남)
  where: string;     // 지금 있는 칸
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayNum = (s: string) => {
  const m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(String(s || ''));
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000 : NaN;
};

export function useShipDeadline(): DeadlineOrder[] {
  const [tick, setTick] = useState(0);
  const [shipOuts, setShipOuts] = useState<ShipOut[]>([]);
  const [batches, setBatches] = useState<ShipmentBatch[]>([]);
  useEffect(() => subscribeLines(() => setTick(t => t + 1)), []);
  useEffect(() => subscribeShipOuts(setShipOuts), []);
  useEffect(() => subscribeShipments(setBatches), []);
  // 날이 바뀌면 다시 센다(앱을 켜 둔 채로 자정을 넘겨도).
  const [today, setToday] = useState(() => ymd(new Date()));
  useEffect(() => {
    const t = window.setInterval(() => setToday(ymd(new Date())), 60 * 1000);
    return () => window.clearInterval(t);
  }, []);

  return useMemo(() => {
    void tick;
    const todayN = dayNum(today);
    // 발주서마다 가장 늦은(덜 진행된) 자리를 본다. 줄 하나라도 발송대기 전이면 아직이다.
    const pending = new Map<string, { center: string; due: string; where: string }>();
    const done = new Set<string>();
    const note = (no: string, center: string, due: string, where: string) => {
      if (!no || !due) return;
      if (!pending.has(no)) pending.set(no, { center, due, where });
    };
    for (const l of linesAt('work')) note(String(l.발주번호 || '').trim(), l.물류센터, l.입고예정일, '발주확정');
    for (const l of linesAt('reserve')) note(String(l.발주번호 || '').trim(), l.물류센터, l.입고예정일, (l.메모 || '').includes('대기') ? '대기' : '예약');
    for (const item of shipOuts) {
      const st = shipOutStage(item, batches);
      for (const l of item.lines) {
        const no = String(l.발주번호 || '').trim();
        const inWaiting = st === 'sent' || (st === 'waiting' && ((item.printedOrders || []).includes(no) || !!item.doneAt));
        if (inWaiting) done.add(no);
        else note(no, item.center, item.date, '쉽먼트');
      }
    }
    const out: DeadlineOrder[] = [];
    pending.forEach((v, no) => {
      const dueN = dayNum(v.due);
      if (!Number.isFinite(dueN)) return;
      const daysLeft = dueN - 1 - todayN;
      if (daysLeft > 1) return;
      // 입고예정일이 한참 지난 건(이미 취소됐을 일)은 알리지 않는다.
      if (dueN < todayN - 3) return;
      const d = new Date((dueN - 1) * 86400000);
      out.push({ no, center: v.center, due: v.due, deadline: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`, daysLeft, where: v.where });
    });
    return out.sort((a, b) => a.daysLeft - b.daysLeft || a.due.localeCompare(b.due) || a.no.localeCompare(b.no));
  }, [tick, shipOuts, batches, today]);
}

export const deadlineText = (d: DeadlineOrder) =>
  d.daysLeft < 0 ? `마감 지남(${-d.daysLeft}일)` : d.daysLeft === 0 ? '오늘까지' : '내일까지';

// 데스크톱 알림. 발주서마다 하루에 한 번만 띄운다(같은 날 새로고침해도 다시 안 뜨게).
const SHOWN_KEY = 'shipDeadline.notified';
export function notifyShipDeadline(list: DeadlineOrder[]) {
  if (!list.length || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const today = ymd(new Date());
  let shown: Record<string, string> = {};
  try { shown = JSON.parse(localStorage.getItem(SHOWN_KEY) || '{}') || {}; } catch {}
  const fresh = list.filter(d => shown[d.no] !== `${today}|${d.daysLeft}`);
  if (!fresh.length) return;
  const urgent = fresh.filter(d => d.daysLeft <= 0);
  const head = urgent.length ? `⛔ 오늘까지 발송대기에 올려야 할 발주 ${urgent.length}건` : `⏰ 내일까지 발송대기에 올려야 할 발주 ${fresh.length}건`;
  try {
    new Notification(head, {
      body: fresh.slice(0, 5).map(d => `${d.no} · ${d.center} · 입고 ${d.due.slice(5)} · ${d.where}`).join('\n') + (fresh.length > 5 ? `\n외 ${fresh.length - 5}건` : ''),
      tag: 'ship-deadline',
    });
  } catch {}
  fresh.forEach(d => { shown[d.no] = `${today}|${d.daysLeft}`; });
  try { localStorage.setItem(SHOWN_KEY, JSON.stringify(shown)); } catch {}
}
