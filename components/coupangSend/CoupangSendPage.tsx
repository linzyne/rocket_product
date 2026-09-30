import React, { useEffect, useMemo, useState } from 'react';
import { ShipOut, ShipOutLine, subscribeShipOuts, markShipOuts } from '../coupangOrder/data/shipOutStore';
import { ShipmentBatch, subscribeShipments, allBoxes, waybillForBox, batchForItem } from '../../data/shipmentStore';
import ShipmentWaybillModal from '../coupangOrder/components/ShipmentWaybillModal';
import { InventoryItem, subscribeInventory, makeOfficeLookup } from '../../data/inventoryStore';
import { expandBoxSplit, parseBoxNo } from '../coupangOrder/utils/dataProcessor';
import { ymdSortKey } from '../coupangOrder/utils/dateUtils';

// 발주 > 발송대기. 쉽먼트생성에서 "쉽먼트 완료"를 누른 건이 여기로 온다.
// 아직 준비 안 된 상품(입고 기다리는 것 등)이 다 준비될 때까지 기다리는 곳이다.
// 상품 줄마다 "준비됨"을 체크하고, 다 되면 "발송 완료"를 눌러 발송날짜를 고르면 아래 발송 완료 기록으로 내려간다.

// 쉽먼트생성과 같은 기준으로 끝난 건인지 본다(사람이 켠 완료가 우선, 없으면 예약·운송장·양식이 다 됐는지).
const batchOf = (item: ShipOut, batches: ShipmentBatch[]) => {
  const mine = new Set(item.lines.map(l => String(l.발주번호 || '').trim()).filter(Boolean));
  return batches.find(b => b.id === item.batchId)
    || batches
      .filter(b => allBoxes(b).some(box => box.lines.some(l => mine.has(String(l.발주번호 || '').trim()))))
      .sort((a, b) => b.createdAt - a.createdAt)[0];
};
const isShipDone = (item: ShipOut, batch?: ShipmentBatch) => {
  if (item.doneAt) return true;
  if (item.undoneAt) return false;
  const boxes = batch ? allBoxes(batch) : [];
  return boxes.length > 0 && boxes.every(b => (b.waybill || '').trim()) && !!item.formSavedAt;
};

// 준비 표시는 상품 줄 단위(여러 박스로 나눈 줄도 한 번에 체크).
const readyKey = (l: Pick<ShipOutLine, '발주번호' | '상품이름' | '확정수량'>) => `${l.발주번호}│${l.상품이름}│${l.확정수량}`;

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const dayText = (ymd: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
  if (!m) return ymd || '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return `${Number(m[2])}/${Number(m[3])} (${WEEK[d.getDay()]})`;
};
const today = () => new Date().toLocaleDateString('sv-SE');
const fmtWaybill = (w: string) => {
  const d = String(w || '').replace(/\D/g, '');
  return d.length === 12 ? `${d.slice(0, 4)}-${d.slice(4, 8)}-${d.slice(8)}` : w;
};

const GREEN = '#27ae60';
const ORANGE = '#e67e22';

export default function CoupangSendPage({ onGoShip }: { onGoShip?: () => void } = {}) {
  const [list, setList] = useState<ShipOut[]>([]);
  const [batches, setBatches] = useState<ShipmentBatch[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [sendPick, setSendPick] = useState<{ item: ShipOut; date: string } | null>(null);
  const [showSent, setShowSent] = useState(true);
  // 운송장번호를 고치는 창(쉽먼트 기록 하나를 연다).
  const [editBatch, setEditBatch] = useState<ShipmentBatch | null>(null);
  const editWaybills = (item: ShipOut) => {
    const b = batchForItem(batches, item);
    if (!b) { alert('이 건의 택배예약(쉽먼트) 기록을 찾지 못했어요. 쉽먼트생성 화면 아래 쉽먼트 기록에서 직접 고쳐 주세요.'); return; }
    setEditBatch(b);
  };

  useEffect(() => subscribeShipOuts(setList), []);
  useEffect(() => subscribeShipments(setBatches), []);
  useEffect(() => subscribeInventory(setInventory), []);
  const officeQtyOf = useMemo(() => makeOfficeLookup(inventory), [inventory]);

  // 발송대기: 쉽먼트 완료했고 아직 안 보낸 건. 입고예정일 빠른 순.
  const waiting = useMemo(
    () => list
      .filter(i => !i.sentDate && isShipDone(i, batchOf(i, batches)))
      .sort((a, b) => ymdSortKey(a.date) - ymdSortKey(b.date) || a.center.localeCompare(b.center, 'ko', { numeric: true })),
    [list, batches],
  );
  // 발송 완료: 보낸 날 최근 순.
  const sent = useMemo(
    () => list.filter(i => !!i.sentDate).sort((a, b) => (b.sentDate || '').localeCompare(a.sentDate || '') || b.createdAt - a.createdAt),
    [list],
  );

  // 박스 n번의 운송장번호(쉽먼트 기록을 내용으로 확인해서 확실한 것만).
  const waybillOf = (item: ShipOut, no: number) => waybillForBox(batches, item, no);

  // 박스별로 묶은 줄(나눠 담은 줄은 박스마다 조각으로).
  const boxesOf = (item: ShipOut) => {
    const byBox = new Map<number, { line: ShipOutLine; qty: number }[]>();
    for (const l of item.lines) {
      for (const piece of expandBoxSplit({ ...l, 쉼먼트: l.쉼먼트 || '' })) {
        const no = parseBoxNo(piece.쉼먼트) || 0;
        byBox.set(no, [...(byBox.get(no) || []), { line: l, qty: Number(piece.확정수량) || 0 }]);
      }
    }
    return Array.from(byBox.entries()).sort((a, b) => (a[0] || 9999) - (b[0] || 9999));
  };

  const readyCount = (item: ShipOut) => {
    const ready = new Set(item.readyKeys || []);
    return { done: item.lines.filter(l => ready.has(readyKey(l))).length, total: item.lines.length };
  };

  const toggleReady = (item: ShipOut, keys: string[], on: boolean) => {
    const next = new Set(item.readyKeys || []);
    keys.forEach(k => (on ? next.add(k) : next.delete(k)));
    markShipOuts([item.id], { readyKeys: Array.from(next) });
  };

  const backToShip = (item: ShipOut) => {
    if (!confirm(`${item.bundle}(${item.center})의 쉽먼트 완료를 풀고 쉽먼트생성으로 되돌릴까요?`)) return;
    markShipOuts([item.id], { doneAt: undefined, undoneAt: Date.now() });
    onGoShip?.();
  };

  const openSend = (item: ShipOut) => {
    const { done, total } = readyCount(item);
    if (done < total && !confirm(`아직 준비 안 된 상품이 ${total - done}줄 있어요. 그래도 발송 완료로 할까요?`)) return;
    setSendPick({ item, date: today() });
  };
  const saveSend = () => {
    if (!sendPick || !sendPick.date) return;
    markShipOuts([sendPick.item.id], { sentDate: sendPick.date });
    setSendPick(null);
  };
  const unsend = (item: ShipOut) => {
    if (!confirm(`${item.bundle}(${item.center} · ${item.sentDate} 발송)을 발송대기로 되돌릴까요?`)) return;
    markShipOuts([item.id], { sentDate: undefined });
  };

  const btn = (color: string, solid = false): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 4, height: 28, padding: '0 11px',
    fontSize: 12, fontWeight: 700, borderRadius: 7, cursor: 'pointer', whiteSpace: 'nowrap',
    border: `1.5px solid ${solid ? color : `${color}66`}`, background: solid ? color : '#fff', color: solid ? '#fff' : color,
  });

  return (
    <div style={{ minHeight: '100vh', background: '#fff', color: '#1a1a1a', fontFamily: "'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', sans-serif" }}>
      <header style={{ background: '#fff', borderBottom: '1px solid #f0f0f0', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px', height: 54, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.3px' }}>📦 발송대기/완료</span>
          <span style={{ fontSize: 12, color: '#999' }}>대기 {waiting.length}건 · 발송 완료 {sent.length}건</span>
        </div>
      </header>

      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '20px 24px 60px' }}>
        {waiting.length === 0 ? (
          <div style={{ border: '1px dashed #e0e0e0', borderRadius: 10, padding: '60px 0', textAlign: 'center', color: '#bbb', fontSize: 13 }}>
            발송을 기다리는 건이 없어요.<br />
            <span style={{ fontSize: 12 }}>쉽먼트생성에서 <strong>쉽먼트 완료</strong>를 누르면 여기로 와요.</span>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {waiting.map(item => {
              const { done, total } = readyCount(item);
              const allReady = total > 0 && done === total;
              const ready = new Set(item.readyKeys || []);
              const boxes = boxesOf(item);
              const boxCount = boxes.filter(([no]) => no > 0).length;
              return (
                <div key={item.id} style={{
                  border: `1px solid ${allReady ? `${GREEN}55` : '#e5e7eb'}`, borderLeft: `4px solid ${allReady ? GREEN : ORANGE}`,
                  borderRadius: 10, overflow: 'hidden', background: '#fff',
                }}>
                  {/* 머리줄: 센터 · 입고예정일 · 이름 · 박스 수 · 준비 현황 · 버튼 */}
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 12px',
                    background: allReady ? '#f2fbf6' : '#fafafa', borderBottom: '1px solid #f0f0f0',
                  }}>
                    <span style={{ padding: '2px 10px', fontSize: 14, fontWeight: 800, borderRadius: 6, color: '#fff', background: '#b04a3e' }}>{item.center}</span>
                    <span style={{ padding: '1px 8px', fontSize: 14, fontWeight: 800, borderRadius: 6, color: '#1e293b', border: '1.5px solid #334155' }}>{dayText(item.date)}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#666' }} title={`출고번호 ${item.id}`}>{item.bundle}</span>
                    <span style={{ fontSize: 13, fontWeight: 800, color: '#333' }}>📦 {boxCount}박스</span>
                    <span
                      title="준비됨으로 체크한 상품 줄 수"
                      style={{
                        padding: '2px 9px', fontSize: 12, fontWeight: 800, borderRadius: 999,
                        color: allReady ? '#fff' : ORANGE, background: allReady ? GREEN : `${ORANGE}14`, border: `1px solid ${allReady ? GREEN : `${ORANGE}55`}`,
                      }}
                    >
                      {allReady ? '✓ 모두 준비됨' : `준비 ${done}/${total}`}
                    </span>
                    <span style={{ flex: 1 }} />
                    <button onClick={() => toggleReady(item, item.lines.map(readyKey), !allReady)} style={btn('#555')}>
                      {allReady ? '준비 모두 풀기' : '모두 준비됨'}
                    </button>
                    <button onClick={() => openSend(item)} style={btn(GREEN, allReady)} title="택배를 보냈으면 누르고 발송날짜를 고르세요">
                      🚚 발송 완료
                    </button>
                    <button onClick={() => backToShip(item)} style={btn('#999')} title="쉽먼트 완료를 풀고 쉽먼트생성으로 되돌립니다">
                      ← 쉽먼트생성으로
                    </button>
                  </div>

                  {/* 박스별 상품 줄 */}
                  {boxes.map(([no, pieces]) => {
                    const wb = no ? waybillOf(item, no) : '';
                    return (
                      <div key={no}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px', background: `${ORANGE}0d`, borderBottom: '1px solid #f5f5f5', fontSize: 12 }}>
                          <span style={{ padding: '0 8px', fontWeight: 800, borderRadius: 8, color: '#fff', background: ORANGE }}>📦 {no ? `박스${no}` : '박스 미지정'}</span>
                          {wb && <span style={{ fontWeight: 800, color: '#333', fontFamily: 'monospace' }} title="롯데 운송장번호">🚚 {wb}</span>}
                          {no > 0 && (
                            <button onClick={() => editWaybills(item)} style={{ ...btn('#888'), height: 22, padding: '0 8px', fontSize: 11 }} title="이 건의 운송장번호를 고칩니다">
                              {wb ? '수정' : '번호 넣기'}
                            </button>
                          )}
                          <span style={{ marginLeft: 'auto', color: '#999', fontWeight: 700 }}>
                            {pieces.length}품목 · {pieces.reduce((s, p) => s + p.qty, 0).toLocaleString()}개
                          </span>
                        </div>
                        {pieces.map(({ line, qty }, i) => {
                          const key = readyKey(line);
                          const on = ready.has(key);
                          const office = officeQtyOf(line.상품이름);
                          const need = Number(line.확정수량) || 0;
                          const short = office?.qty != null && office.qty < need;
                          return (
                            <label
                              key={`${key}-${i}`}
                              style={{
                                display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', cursor: 'pointer',
                                borderBottom: '1px solid #f5f5f5', background: on ? '#f6fcf8' : '#fff',
                              }}
                            >
                              <input type="checkbox" checked={on} onChange={e => toggleReady(item, [key], e.target.checked)} style={{ width: 16, height: 16, margin: 0, cursor: 'pointer' }} />
                              <span style={{ flex: 1, fontSize: 13, color: on ? '#7a8a80' : '#222', textDecoration: on ? 'line-through' : 'none' }}>{line.상품이름}</span>
                              <span style={{ minWidth: 48, textAlign: 'right', fontSize: 13, fontWeight: 700 }} title={qty !== need ? `전체 ${need}개 중 이 박스` : undefined}>
                                {qty.toLocaleString()}개
                              </span>
                              <span
                                style={{ minWidth: 70, textAlign: 'right', fontSize: 11, color: office?.qty == null ? '#ccc' : short ? '#c0392b' : '#888', fontWeight: short ? 800 : 500 }}
                                title={office ? `사무실 재고 · ${office.names.join(' / ')}` : '사무실재고에서 같은 상품을 못 찾았어요'}
                              >
                                사무실 {office?.qty == null ? '-' : office.qty}
                              </span>
                              <span style={{ minWidth: 86, textAlign: 'right', fontSize: 12, color: '#8a8f98', fontWeight: 700 }}>{line.발주번호}</span>
                              {on && <span style={{ fontSize: 11, fontWeight: 800, color: GREEN }}>준비됨</span>}
                            </label>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}

        {/* 발송 완료 기록 */}
        {sent.length > 0 && (
          <div style={{ marginTop: 28 }}>
            <button
              onClick={() => setShowSent(v => !v)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: 0, background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700, color: GREEN }}
            >
              <span style={{ fontSize: 10, color: '#bbb' }}>{showSent ? '▾' : '▸'}</span>
              ✓ 발송 완료 {sent.length}건
              <span style={{ marginLeft: 4, fontSize: 11, fontWeight: 500, color: '#aaa' }}>{showSent ? '접기' : '펼치기'}</span>
            </button>
            {showSent && (
              <div style={{ marginTop: 8, border: '1px solid #eee', borderRadius: 10, overflow: 'hidden' }}>
                {sent.map(item => {
                  const nos = boxesOf(item).map(([no]) => no).filter(Boolean);
                  return (
                    <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', borderTop: '1px solid #f4f4f4', fontSize: 12 }}>
                      <b style={{ color: GREEN, minWidth: 70 }}>{dayText(item.sentDate || '')}</b>
                      <span style={{ fontWeight: 700, color: '#333', minWidth: 60 }}>{item.center}</span>
                      <span style={{ color: '#888' }}>입고 {dayText(item.date)}</span>
                      <span style={{ color: '#888' }}>{item.bundle}</span>
                      <span style={{ fontWeight: 700 }}>📦 {nos.length}박스</span>
                      {/* 운송장번호는 옆으로 늘어나지 않게 박스마다 한 줄씩 쌓는다. */}
                      <span style={{ display: 'flex', flexDirection: 'column', gap: 1, fontSize: 11.5, color: '#555', fontFamily: 'monospace' }}>
                        {nos.map(no => (
                          <span key={no}>
                            <span style={{ color: '#aaa', fontFamily: 'inherit' }}>박스{no} </span>
                            {waybillOf(item, no) || <span style={{ color: '#ccc' }}>번호 없음</span>}
                          </span>
                        ))}
                      </span>
                      <button onClick={() => editWaybills(item)} style={{ ...btn('#888'), marginLeft: 'auto', height: 24 }} title="이 건의 운송장번호를 고칩니다">
                        운송장 수정
                      </button>
                      <button onClick={() => unsend(item)} style={{ ...btn('#999'), height: 24 }} title="발송 완료를 풀고 발송대기로 되돌립니다">
                        되돌리기
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </main>

      {editBatch && <ShipmentWaybillModal batch={editBatch} onClose={() => setEditBatch(null)} />}

      {sendPick && (
        <div
          onClick={() => setSendPick(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div onClick={e => e.stopPropagation()} style={{ width: 300, background: '#fff', borderRadius: 12, padding: 18, boxShadow: '0 10px 30px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>발송 완료</div>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 12 }}>{sendPick.item.bundle} · {sendPick.item.center}</div>
            <label style={{ fontSize: 12, fontWeight: 700, color: '#333' }}>
              발송날짜
              <input
                type="date"
                value={sendPick.date}
                autoFocus
                onChange={e => setSendPick(prev => prev && { ...prev, date: e.target.value })}
                onKeyDown={e => { if (e.key === 'Enter') saveSend(); }}
                style={{ display: 'block', width: '100%', marginTop: 6, padding: '7px 10px', fontSize: 14, borderRadius: 8, border: '1px solid #ddd', boxSizing: 'border-box' }}
              />
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button onClick={() => setSendPick(null)} style={{ padding: '6px 14px', fontSize: 13, background: '#f3f3f3', border: 'none', borderRadius: 6, cursor: 'pointer' }}>취소</button>
              <button onClick={saveSend} disabled={!sendPick.date} style={{ padding: '6px 14px', fontSize: 13, fontWeight: 700, color: '#fff', background: GREEN, border: 'none', borderRadius: 6, cursor: 'pointer' }}>
                발송 완료
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
