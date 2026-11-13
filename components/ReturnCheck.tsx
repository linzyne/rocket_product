import React, { useEffect, useMemo, useState } from 'react';
import { HanjungOrder } from '../data/hanjungStore';
import { ReceiveRow, subscribeReceives } from '../data/receiveStore';
import { ShipmentBatch, subscribeShipments } from '../data/shipmentStore';
import { ReturnCandidate, ReturnMark, findReturnCandidates, markIgnored, markReturned, subscribeReturns } from '../data/returnStore';
import ProductThumb, { useProductImage } from './hanjung/ProductThumb';

// 사무실재고 위의 회송 확인. 쉽먼트로 보낸 수량보다 쿠팡 입고가 적은 줄을 보여주고,
// "회송 처리"를 누르면 그 수량이 사무실 재고로 돌아온다(원래 한중발주 원가 그대로). 정산은 이미 빠져 있다.
const ReturnCheck: React.FC<{ orders: HanjungOrder[] }> = ({ orders }) => {
  const [batches, setBatches] = useState<ShipmentBatch[]>([]);
  const [receives, setReceives] = useState<ReceiveRow[]>([]);
  const [marks, setMarks] = useState<Record<string, ReturnMark[]>>({});
  const [qty, setQty] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [open, setOpen] = useState(true);
  const imageOf = useProductImage();

  useEffect(() => subscribeShipments(setBatches), []);
  useEffect(() => subscribeReceives(setReceives), []);
  useEffect(() => subscribeReturns(setMarks), []);

  const list = useMemo(() => findReturnCandidates(batches, receives, marks), [batches, receives, marks]);
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

  const doIgnore = async (c: ReturnCandidate) => {
    if (!confirm(`${c.상품이름} ${c.left}개를 회송 아님으로 숨길까요? 재고는 그대로예요.`)) return;
    setBusy(c.id);
    try { await markIgnored(c, marks[c.id] || []); } finally { setBusy(''); }
  };

  return (
    <div className="max-w-xl bg-amber-50 border border-amber-200 rounded-xl mb-4">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-4 py-3 text-left">
        <div>
          <div className="text-sm font-bold text-amber-900">회송 확인 {list.length}건</div>
          <div className="text-xs text-amber-700">쉽먼트로 보낸 것보다 쿠팡 입고가 적어요. 회송 온 거면 눌러서 재고로 되돌려요.</div>
        </div>
        <span className="text-amber-700 text-xs">{open ? '접기' : '펴기'}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          {list.map(c => (
            <div key={c.id} className="bg-white border border-amber-100 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <ProductThumb url={imageOf(c.상품이름)} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-gray-900 break-keep">{c.상품이름}</div>
                  <div className="text-[11px] text-gray-400 mt-0.5">발주 {c.발주번호} · {c.center} · 입고 {c.lastIn.slice(0, 10)} · {c.batchId}</div>
                  <div className="text-xs text-gray-600 mt-1">
                    보냄 {c.shipped} · 입고 {c.received}{c.done ? ` · 처리함 ${c.done}` : ''} → <b className="text-amber-700">{c.left}개 덜 들어옴</b>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 mt-2 pl-9">
                <input
                  type="number" min={1} max={c.left} value={qty[c.id] ?? String(c.left)}
                  onChange={e => setQty({ ...qty, [c.id]: e.target.value })}
                  className="w-16 px-2 py-1 border border-gray-200 rounded text-sm text-right font-mono"
                />
                <span className="text-xs text-gray-500">개</span>
                <button disabled={busy === c.id} onClick={() => doReturn(c)}
                  className="px-2.5 py-1 rounded bg-gray-900 text-white text-xs font-semibold disabled:opacity-40">회송 처리</button>
                <button disabled={busy === c.id} onClick={() => doIgnore(c)}
                  className="px-2 py-1 text-xs text-gray-400 hover:text-gray-700">회송 아님</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ReturnCheck;
