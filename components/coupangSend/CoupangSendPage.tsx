import React, { useEffect, useMemo, useState } from 'react';
import ProductQtySummary from '../coupangOrder/components/ProductQtySummary';
import { ShipOut, ShipOutLine, subscribeShipOuts, markShipOuts, shipOutBatch, shipOutDone } from '../coupangOrder/data/shipOutStore';
import { ShipmentBatch, subscribeShipments, allBoxes, waybillForBox, batchForItem } from '../../data/shipmentStore';
import ShipmentWaybillModal from '../coupangOrder/components/ShipmentWaybillModal';
import { useHanjungBadge } from '../coupangOrder/data/useHanjungBadge';
import { useShipmentNoSync } from '../coupangOrder/data/useShipmentNoSync';
import { useReady } from '../coupangOrder/data/readyStore';
import { HanjungOrder, subscribeHanjung, makeHanjungOfficeLookup } from '../../data/hanjungStore';
import { expandBoxSplit, parseBoxNo } from '../coupangOrder/utils/dataProcessor';
import { ymdSortKey } from '../coupangOrder/utils/dateUtils';
import { openBarcodes as openBarcodesShared, printShipment as printShipmentShared, setPrinted } from './printShipment';

// 발주 > 발송대기. 쉽먼트생성에서 "쉽먼트 완료"를 누른 건이 여기로 온다.
// 아직 준비 안 된 상품(입고 기다리는 것 등)이 다 준비될 때까지 기다리는 곳이다.
// 상품 줄마다 "준비됨"을 체크하고, 다 되면 "발송 완료"를 눌러 발송날짜를 고르면 아래 발송 완료 기록으로 내려간다.

// 쉽먼트생성과 같은 기준으로 끝난 건인지 본다(shipOutStore의 shipOutDone).
const batchOf = shipOutBatch;
const isShipDone = (item: ShipOut, batch?: ShipmentBatch) => shipOutDone(item, batch ? [batch] : []);

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

// view: 'waiting' = 발송대기 메뉴(아직 안 보낸 건), 'sent' = 발송완료 메뉴(보낸 기록만).
export default function CoupangSendPage({ onGoShip, view = 'waiting' }: { onGoShip?: () => void; view?: 'waiting' | 'sent' } = {}) {
  const [list, setList] = useState<ShipOut[]>([]);
  const hanjungBadge = useHanjungBadge();
  useShipmentNoSync();
  // 쉽먼트 출력 진행 상황(발주번호 → 글). 쉽먼트 번호를 누르면 확장이 서허에서 Label·내역서를 받아 오고,
  // 여기서 두 PDF를 하나로 합쳐 새 탭에 연다(사람은 프린트만 누른다).
  const [printNote, setPrintNote] = useState<Record<string, string>>({});
  const openBarcodes = openBarcodesShared;
  const printShipment = (item: ShipOut, orderNo: string, shipmentNo: string) =>
    printShipmentShared(item, orderNo, shipmentNo, t => setPrintNote(n => ({ ...n, [orderNo]: t })));
  // 준비 체크: 쿠팡발주확인부터 쓰는 공통 기록 + 예전에 이 출고 건에 적어 둔 표시.
  const readyStore = useReady();
  const [batches, setBatches] = useState<ShipmentBatch[]>([]);
  // 사무실 칸 = 한중으로 넉넉히 사 둔 여유(도착한 것 + 오는 중인 것).
  const [hanjungOrders, setHanjungOrders] = useState<HanjungOrder[]>([]);
  const [sendPick, setSendPick] = useState<{ item: ShipOut; date: string } | null>(null);
  // 운송장번호를 고치는 창(쉽먼트 기록 하나를 연다).
  const [editBatch, setEditBatch] = useState<ShipmentBatch | null>(null);
  const editWaybills = (item: ShipOut) => {
    const b = batchForItem(batches, item);
    if (!b) { alert('이 건의 택배예약(쉽먼트) 기록을 찾지 못했어요. 쉽먼트생성 화면 아래 쉽먼트 기록에서 직접 고쳐 주세요.'); return; }
    setEditBatch(b);
  };

  useEffect(() => subscribeShipOuts(setList), []);
  useEffect(() => subscribeShipments(setBatches), []);
  useEffect(() => subscribeHanjung(setHanjungOrders), []);
  const officeQtyOf = useMemo(() => makeHanjungOfficeLookup(hanjungOrders), [hanjungOrders]);

  // 발송대기: 쉽먼트 완료했고 아직 안 보낸 건. 입고예정일 빠른 순.
  // 발송대기: 입고예정일이 늦은 것부터(빠른 날짜가 아래로).
  const waiting = useMemo(
    () => list
      .filter(i => !i.sentDate && isShipDone(i, batchOf(i, batches)))
      .sort((a, b) => ymdSortKey(b.date) - ymdSortKey(a.date) || a.center.localeCompare(b.center, 'ko', { numeric: true })),
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

  const isLineReady = (item: ShipOut, l: ShipOutLine) => readyStore.isReady(l, item.readyKeys);
  const readyCount = (item: ShipOut) => ({ done: item.lines.filter(l => isLineReady(item, l)).length, total: item.lines.length });

  const toggleReady = (item: ShipOut, lines: ShipOutLine[], on: boolean) => {
    readyStore.setReady(lines, on).catch(err => alert(`준비 체크 저장 실패: ${err?.message || err}`));
    // 끌 때는 예전 방식으로 출고 건에 적혀 있던 표시도 지운다.
    if (!on && item.readyKeys?.length) {
      const drop = new Set(lines.map(readyKey));
      const rest = item.readyKeys.filter(k => !drop.has(k));
      if (rest.length !== item.readyKeys.length) markShipOuts([item.id], { readyKeys: rest });
    }
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
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '6px clamp(12px, 4vw, 24px)', minHeight: 54, boxSizing: 'border-box', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px 12px' }}>
          <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.3px' }}>{view === 'sent' ? '✓ 발송완료' : '📦 발송대기'}</span>
          <span style={{ fontSize: 12, color: '#999' }}>{view === 'sent' ? `보낸 기록 ${sent.length}건` : `대기 ${waiting.length}건`}</span>
        </div>
      </header>

      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '20px clamp(10px, 4vw, 24px) 70px' }}>
        {view === 'waiting' && <ProductQtySummary lines={waiting.flatMap(i => i.lines.map(l => ({ ...l, ready: isLineReady(i, l) })))} />}
        {view !== 'waiting' ? null : waiting.length === 0 ? (
          <div style={{ border: '1px dashed #e0e0e0', borderRadius: 10, padding: '60px 0', textAlign: 'center', color: '#bbb', fontSize: 13 }}>
            발송을 기다리는 건이 없어요.<br />
            <span style={{ fontSize: 12 }}>쉽먼트생성에서 <strong>쉽먼트 완료</strong>를 누르면 여기로 와요.</span>
          </div>
        ) : (
          // 카드 목록(격자). 카드 안에서 바로 박스별 상품 준비 체크 · 운송장 · 발송 완료까지 한다.
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(340px, 100%), 1fr))', gap: 16, alignItems: 'start' }}>
            {waiting.map(item => {
              const { done, total } = readyCount(item);
              const allReady = total > 0 && done === total;
              const boxes = boxesOf(item);
              const boxCount = boxes.filter(([no]) => no > 0).length;
              return (
                <div key={item.id} style={{
                  border: `1.5px solid ${allReady ? `${GREEN}88` : '#e5e7eb'}`, borderRadius: 14, overflow: 'hidden',
                  background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
                }}>
                  {/* 머리: 센터 · 입고예정일 · 박스 수, 그 아래 발주서마다 한 줄(발주번호 · 쉽먼트 번호 · 🖨 출력 · 출력됨/미출력). */}
                  <div style={{ padding: '10px 12px', background: allReady ? '#f2fbf6' : '#fafafa', borderBottom: '1px solid #f0f0f0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ padding: '2px 9px', fontSize: 13, fontWeight: 800, borderRadius: 6, color: '#fff', background: '#b04a3e' }}>{item.center}</span>
                      <b style={{ fontSize: 14, color: '#1e293b' }}>{dayText(item.date)}</b>
                      <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 800, color: '#333' }}>📦 {boxCount}박스</span>
                    </div>
                    {Array.from(new Set<string>(item.lines.map(l => String(l.발주번호 || '')))).filter(Boolean).map(no => {
                      const on = (item.printedOrders || []).includes(no);
                      const ship = item.shipmentNos?.[no];
                      return (
                        <div key={no} style={{ marginTop: 6 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                            <span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#333' }}>{no}</span>
                            {ship
                              ? <span style={{ fontFamily: 'monospace', color: '#0369a1', fontWeight: 700 }}>· 쉽먼트 {ship}</span>
                              : <span style={{ color: '#bbb' }}>· 쉽먼트 번호 없음</span>}
                            <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              <button
                                onClick={() => ship ? printShipment(item, no, ship) : alert('쉽먼트 번호가 아직 없어요. 서허 쉽먼트 일괄등록 뒤에 생겨요.')}
                                title={ship ? 'Label·내역서를 받아 하나로 합쳐 새 탭에 열어요(거기서 프린트)' : '쉽먼트 번호가 아직 없어요'}
                                style={{ width: 28, height: 24, padding: 0, fontSize: 15, borderRadius: 6, cursor: ship ? 'pointer' : 'not-allowed', border: '1px solid #d1d5db', background: '#fff', opacity: ship ? 1 : 0.4 }}
                              >
                                🖨
                              </button>
                              <button
                                onClick={() => openBarcodes(item, no)}
                                title="이 발주서 상품들의 바코드 라벨(폼텍 40칸)을 수량만큼 새 탭에 열어요"
                                style={{ width: 28, height: 24, padding: 0, fontSize: 14, borderRadius: 6, cursor: 'pointer', border: '1px solid #d1d5db', background: '#fff' }}
                              >
                                🏷
                              </button>
                              <button
                                onClick={() => {
                                  if (on && !confirm(`발주 ${no}을 미출력으로 되돌릴까요?`)) return;
                                  setPrinted(item, no, !on);
                                }}
                                title={on ? '눌러서 미출력으로 되돌려요' : '출력했으면 눌러요'}
                                style={{
                                  padding: '1px 9px', borderRadius: 999, cursor: 'pointer', fontSize: 11, fontWeight: 800,
                                  border: `1px solid ${on ? GREEN : '#f59e0b'}`, background: on ? GREEN : '#fffbeb', color: on ? '#fff' : '#b45309',
                                }}
                              >
                                {on ? '✓ 출력됨' : '미출력'}
                              </button>
                            </span>
                          </div>
                          {printNote[no] && <div style={{ fontSize: 10.5, marginTop: 2, color: printNote[no].startsWith('❌') ? '#c0392b' : '#64748b' }}>{printNote[no]}</div>}
                        </div>
                      );
                    })}
                  </div>

                  {/* 박스별 상품 줄: 체크하면 준비됨. 상품이 많으면 이 안에서만 스크롤해 카드 높이를 맞춘다. */}
                  <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                  {boxes.map(([no, pieces]) => {
                    const wb = no ? waybillOf(item, no) : '';
                    return (
                      <div key={no}>
                        <div style={{ position: 'sticky', top: 0, zIndex: 1, display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px', background: '#fdf5ec', fontSize: 11.5 }}>
                          <span style={{ padding: '0 7px', fontWeight: 800, borderRadius: 8, color: '#fff', background: ORANGE }}>{no ? `박스${no}` : '박스 미지정'}</span>
                          {wb
                            ? <span style={{ fontWeight: 700, color: '#333', fontFamily: 'monospace' }} title="롯데 운송장번호">🚚 {wb}</span>
                            : no > 0 && <span style={{ color: '#bbb' }}>운송장 없음</span>}
                          {no > 0 && (
                            <button onClick={() => editWaybills(item)} style={{ ...btn('#888'), height: 20, padding: '0 7px', fontSize: 10.5 }} title="이 건의 운송장번호를 고칩니다">
                              {wb ? '수정' : '넣기'}
                            </button>
                          )}
                        </div>
                        {pieces.map(({ line, qty }, i) => {
                          const key = readyKey(line);
                          const on = isLineReady(item, line);
                          const office = officeQtyOf(line.상품이름);
                          const need = Number(line.확정수량) || 0;
                          const short = (office.qty || 0) < need;
                          return (
                            <label
                              key={`${key}-${i}`}
                              title={`${line.상품이름} · 발주 ${line.발주번호}`}
                              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px', cursor: 'pointer', borderTop: '1px solid #f5f5f5', background: on ? '#f6fcf8' : '#fff' }}
                            >
                              <input type="checkbox" checked={on} onChange={e => toggleReady(item, [line], e.target.checked)} style={{ width: 15, height: 15, margin: 0, cursor: 'pointer', flexShrink: 0 }} />
                              <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 1.35, color: on ? '#8a9a90' : '#222', textDecoration: on ? 'line-through' : 'none' }}>
                                {line.상품이름.replace(/^주노엘\s*/, '')}
                                {hanjungBadge(line)}
                              </span>
                              <b style={{ fontSize: 12.5, whiteSpace: 'nowrap' }} title={qty !== need ? `전체 ${need}개 중 이 박스` : undefined}>{qty.toLocaleString()}개</b>
                              <span
                                style={{ minWidth: 44, textAlign: 'right', fontSize: 10.5, whiteSpace: 'nowrap', color: !office.qty && !office.incoming ? '#ccc' : short ? '#c0392b' : '#999', fontWeight: short ? 800 : 500 }}
                                title={office.qty || office.incoming ? `사무실 재고(한중 여유) · 도착 ${office.qty}개${office.incoming ? ` · 오는 중 ${office.incoming}개` : ''}\n${office.names.join('\n')}` : '한중으로 넉넉히 사 둔 여유가 없어요'}
                              >
                                사무실 {office.qty || office.incoming ? office.qty : '-'}{office.incoming ? ` +${office.incoming}` : ''}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    );
                  })}
                  </div>

                  {/* 아래: 준비 진행 막대 · 버튼 */}
                  <div style={{ padding: '10px 12px 12px', borderTop: '1px solid #f0f0f0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, height: 7, borderRadius: 999, background: '#eef0f3', overflow: 'hidden' }}>
                        <div style={{ width: `${total ? (done / total) * 100 : 0}%`, height: '100%', borderRadius: 999, background: allReady ? GREEN : ORANGE, transition: 'width .2s' }} />
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 800, color: allReady ? GREEN : ORANGE, whiteSpace: 'nowrap' }}>
                        {allReady ? '✓ 모두 준비됨' : `준비 ${done}/${total}`}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10 }}>
                      <button onClick={() => toggleReady(item, item.lines, !allReady)} style={btn('#555')}>
                        {allReady ? '준비 풀기' : '모두 준비'}
                      </button>
                      <button onClick={() => openSend(item)} style={btn(GREEN, allReady)} title="택배를 보냈으면 누르고 발송날짜를 고르세요">
                        🚚 발송 완료
                      </button>
                      <button onClick={() => backToShip(item)} style={{ ...btn('#999'), marginLeft: 'auto' }} title="쉽먼트 완료를 풀고 쉽먼트생성으로 되돌립니다">
                        ← 쉽먼트생성
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 발송 완료 기록 */}
        {view === 'sent' && sent.length === 0 && (
          <div style={{ border: '1px dashed #e0e0e0', borderRadius: 10, padding: '60px 0', textAlign: 'center', color: '#bbb', fontSize: 13 }}>보낸 기록이 없어요.</div>
        )}
        {view === 'sent' && sent.length > 0 && (
          <div>
            {(
              <div style={{ marginTop: 8, border: '1px solid #eee', borderRadius: 10, overflow: 'hidden' }}>
                {sent.map(item => {
                  const nos = boxesOf(item).map(([no]) => no).filter(Boolean);
                  return (
                    // 칸 너비를 고정해서 줄마다 세로로 맞춘다: 보낸 날 · 센터 · 입고일 · 발주번호 · 박스 수 · 운송장 · 단추.
                    <div key={item.id} style={{
                      display: 'grid', gridTemplateColumns: '84px 70px 96px 120px 64px 1fr auto auto', alignItems: 'center',
                      columnGap: 12, padding: '8px 12px', borderTop: '1px solid #f4f4f4', fontSize: 12,
                    }}>
                      <b style={{ color: GREEN, whiteSpace: 'nowrap' }}>{dayText(item.sentDate || '')}</b>
                      <span style={{ fontWeight: 700, color: '#333', whiteSpace: 'nowrap' }}>{item.center}</span>
                      <span style={{ color: '#888', whiteSpace: 'nowrap' }}>입고 {dayText(item.date)}</span>
                      {/* 예전 "묶음1" 같은 묶음 이름 대신 실제 발주번호를 보여준다(여러 개면 첫 번호 외 N). */}
                      {(() => {
                        const orderNos = Array.from(new Set(item.lines.map(l => String(l.발주번호))));
                        return (
                          <span style={{ color: '#888', whiteSpace: 'nowrap' }} title={orderNos.join(', ')}>
                            {orderNos[0] || '-'}{orderNos.length > 1 ? ` 외 ${orderNos.length - 1}` : ''}
                          </span>
                        );
                      })()}
                      <span style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>📦 {nos.length}박스</span>
                      {/* 운송장번호는 옆으로 늘어나지 않게 박스마다 한 줄씩 쌓는다. */}
                      <span style={{ display: 'flex', flexDirection: 'column', gap: 1, fontSize: 11.5, color: '#555', fontFamily: 'monospace' }}>
                        {nos.map(no => (
                          <span key={no}>
                            <span style={{ color: '#aaa', fontFamily: 'inherit' }}>박스{no} </span>
                            {waybillOf(item, no) || <span style={{ color: '#ccc' }}>번호 없음</span>}
                          </span>
                        ))}
                      </span>
                      <button onClick={() => editWaybills(item)} style={{ ...btn('#888'), height: 24 }} title="이 건의 운송장번호를 고칩니다">
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
