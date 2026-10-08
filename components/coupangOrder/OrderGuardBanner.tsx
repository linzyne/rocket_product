import React, { useEffect, useState } from 'react';
import { startOrderGuard, subscribeRestored, clearRestored } from './data/orderGuard';
import type { RestoredNote } from './data/orderGuard';

// 발주 지킴이를 앱이 켜질 때 한 번 걸고, 사라질 뻔한 발주를 되살렸으면 어느 화면에서든 위에 알린다.
// "확인"을 누를 때까지 남아 있다.
const OrderGuardBanner: React.FC<{ onGoOrder?: () => void }> = ({ onGoOrder }) => {
  const [notes, setNotes] = useState<RestoredNote[]>([]);
  useEffect(() => { startOrderGuard(); }, []);
  useEffect(() => subscribeRestored(setNotes), []);
  if (!notes.length) return null;
  const lines = notes.flatMap(n => n.lines);
  const time = (ms: number) => new Date(ms).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  return (
    <div style={{ position: 'sticky', top: 0, zIndex: 60, background: '#fff7ed', borderBottom: '2px solid #f97316', color: '#7c2d12', padding: '10px 16px', fontSize: 13 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <b>⚠️ 어디에도 없던 발주 {lines.length}줄을 발주확인으로 되살렸어요</b>
        <span style={{ color: '#9a3412' }}>(마지막 {time(notes[notes.length - 1].at)})</span>
        <span style={{ flex: 1 }} />
        {onGoOrder && (
          <button type="button" onClick={onGoOrder} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #f97316', background: '#fff', color: '#c2410c', cursor: 'pointer' }}>발주확인 보기</button>
        )}
        <button type="button" onClick={clearRestored} style={{ padding: '4px 10px', borderRadius: 6, border: 'none', background: '#f97316', color: '#fff', cursor: 'pointer' }}>확인</button>
      </div>
      <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
        {lines.slice(0, 12).map((l, i) => (
          <span key={i}>발주 {l.발주번호} · {l.상품이름} · {l.확정수량}개</span>
        ))}
        {lines.length > 12 && <span>… 외 {lines.length - 12}줄</span>}
      </div>
    </div>
  );
};

export default OrderGuardBanner;
