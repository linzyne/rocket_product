import React, { useEffect, useMemo, useState } from 'react';
import { HanjungOrder } from '../data/hanjungStore';
import { ReceiveRow, subscribeReceives } from '../data/receiveStore';
import { OVERDUE_DAYS, ReturnCandidate, ReturnMark, findReturnCandidates, markIgnored, markReturned, subscribeReturns } from '../data/returnStore';
import ProductThumb, { useProductImage } from './hanjung/ProductThumb';
import type { ShipOut } from './coupangOrder/data/shipOutStore';

// 발송완료 화면 위의 두 상자. 발송완료한 것 중 아직 쿠팡 입고로 안 잡힌 수량을 보여준다(입고되면 저절로 빠짐).
//  · 입고 기다리는 중: 입고예정일에서 OVERDUE_DAYS일이 안 지난 것. 보기만 한다.
//  · 입고 안 됨: 그 날이 지나도 남은 것. "회송"이면 사무실 재고로 돌아오고(원래 한중발주 원가 그대로), "분실"이면 목록에서만 뺀다.
// 정산은 입고 내역으로 계산하니 이미 빠져 있다.
const ReturnCheck: React.FC<{ orders: HanjungOrder[]; sent: ShipOut[] }> = ({ orders, sent }) => {
  const [receives, setReceives] = useState<ReceiveRow[]>([]);
  const [marks, setMarks] = useState<Record<string, ReturnMark[]>>({});
  const [qty, setQty] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [openWait, setOpenWait] = useState(false);
  const [openLate, setOpenLate] = useState(true);
  const imageOf = useProductImage();

  useEffect(() => subscribeReceives(setReceives), []);
  useEffect(() => subscribeReturns(setMarks), []);

  const list = useMemo(() => findReturnCandidates(sent, receives, marks), [sent, receives, marks]);
  const waiting = list.filter(c => !c.overdue);
  const late = list.filter(c => c.overdue);
  if (!list.length) return null;

  const doReturn = async (c: ReturnCandidate) => {
    const n = Math.floor(Number(qty[c.id] ?? c.left));
    if (!Number.isFinite(n) || n <= 0 || n > c.left) { alert(`1 ~ ${c.left} 사이로 적어 주세요.`); return; }
    setBusy(c.id);
    try {
      const r = await markReturned(orders, c, n, marks[c.id] || []);
      if (r.holding) alert(`${r.holding}개는 연결된 한중발주가 없어 "0) 보유재고"에 원가 0원으로 넣었어요. 원가가 필요하면 한중발주에서 고쳐 주세요.`);
    } catch (err) {
      alert(`회송 처리 실패: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy('');
    }
  };

  const doLost = async (c: ReturnCandidate) => {
    if (!confirm(`${c.상품이름} ${c.left}개를 분실로 처리할까요? 재고는 그대로고 목록에서만 빠져요.`)) return;
    setBusy(c.id);
    try { await markIgnored(c, marks[c.id] || []); } finally { setBusy(''); }
  };

  const info = (c: ReturnCandidate) => (
    <div className="flex items-start gap-2">
      <ProductThumb url={imageOf(c.상품이름)} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-gray-900 break-keep">{c.상품이름}</div>
        <div className="text-[11px] text-gray-400 mt-0.5">
          발주 {c.발주번호} · {c.center} · {c.sentDate.slice(5).replace('-', '/')} 발송 · 입고예정 {c.dueDate}{c.lastIn ? ` · 마지막 입고 ${c.lastIn.slice(0, 10)}` : ''}
        </div>
        <div className="text-xs text-gray-600 mt-1">
          보냄 {c.shipped} · 입고 {c.received}{c.done ? ` · 처리함 ${c.done}` : ''} → <b className={c.overdue ? 'text-red-600' : 'text-gray-700'}>{c.left}개 남음</b>
          {c.noReceive && <span className="text-gray-400"> · 이 발주서 입고 기록 없음</span>}
        </div>
      </div>
    </div>
  );

  return (
    <div className="max-w-xl space-y-3 mb-4">
      {late.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl">
          <button onClick={() => setOpenLate(!openLate)} className="w-full flex items-center justify-between px-4 py-3 text-left">
            <div>
              <div className="text-sm font-bold text-red-900">입고 안 됨 {late.length}건</div>
              <div className="text-xs text-red-700">입고예정일에서 {OVERDUE_DAYS}일이 지나도 입고가 안 잡혔어요. 회송이면 재고로 되돌리고, 아니면 분실로 빼요.</div>
            </div>
            <span className="text-red-700 text-xs whitespace-nowrap">{openLate ? '접기' : '펴기'}</span>
          </button>
          {openLate && (
            <div className="px-3 pb-3 space-y-2">
              {late.map(c => (
                <div key={c.id} className="bg-white border border-red-100 rounded-lg p-3">
                  {info(c)}
                  <div className="flex items-center gap-2 mt-2 pl-9">
                    <input
                      type="number" min={1} max={c.left} value={qty[c.id] ?? String(c.left)}
                      onChange={e => setQty({ ...qty, [c.id]: e.target.value })}
                      className="w-16 px-2 py-1 border border-gray-200 rounded text-sm text-right font-mono"
                    />
                    <span className="text-xs text-gray-500">개</span>
                    <button disabled={busy === c.id} onClick={() => doReturn(c)}
                      className="px-2.5 py-1 rounded bg-gray-900 text-white text-xs font-semibold disabled:opacity-40">회송</button>
                    <button disabled={busy === c.id} onClick={() => doLost(c)}
                      className="px-2.5 py-1 rounded border border-gray-200 text-gray-600 text-xs disabled:opacity-40">분실</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {waiting.length > 0 && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl">
          <button onClick={() => setOpenWait(!openWait)} className="w-full flex items-center justify-between px-4 py-3 text-left">
            <div>
              <div className="text-sm font-bold text-gray-800">입고 기다리는 중 {waiting.length}건</div>
              <div className="text-xs text-gray-500">보냈지만 아직 쿠팡 입고로 안 잡힌 것이에요. 입고되면 저절로 빠져요.</div>
            </div>
            <span className="text-gray-500 text-xs whitespace-nowrap">{openWait ? '접기' : '펴기'}</span>
          </button>
          {openWait && (
            <div className="px-3 pb-3 space-y-2">
              {waiting.map(c => (
                <div key={c.id} className="bg-white border border-gray-100 rounded-lg p-3">{info(c)}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ReturnCheck;
