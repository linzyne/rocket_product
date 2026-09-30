import React from 'react';
import { ShipmentBatch, allBoxes } from '../../../data/shipmentStore';

// 쉽먼트생성으로 만들어 둔 묶음들. 여기서 A단계(운송장번호 확인)와 B단계(서허 양식 받기)를 각각 시작한다.
// A를 이미 끝낸 쉽먼트를 골라 B부터 바로 테스트할 수 있다.
interface Props {
  batches: ShipmentBatch[];
  onWaybills: (batch: ShipmentBatch) => void;
  onShubForm: (batch: ShipmentBatch) => void;
  // 있으면 운송장번호가 하나도 없는 기록(예약만 하다 만 것)을 지울 수 있다.
  onDelete?: (batches: ShipmentBatch[]) => void;
}

const dayText = (ms: number) => {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const ShipmentList: React.FC<Props> = ({ batches, onWaybills, onShubForm, onDelete }) => {
  if (!batches.length) return null;
  const btn = (bg: string, on: boolean): React.CSSProperties => ({
    padding: '5px 10px',
    border: 'none',
    borderRadius: 7,
    background: on ? bg : '#f2f2f2',
    color: on ? '#fff' : '#bbb',
    fontSize: 12,
    fontWeight: 600,
    cursor: on ? 'pointer' : 'not-allowed',
  });

  const empty = batches.filter(b => !allBoxes(b).some(x => x.waybill.trim()));

  return (
    <div style={{ marginTop: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#555' }}>📦 쉽먼트 기록</span>
        {onDelete && empty.length > 0 && (
          <button
            onClick={() => onDelete(empty)}
            title="운송장번호가 하나도 없는 기록을 모두 지웁니다"
            style={{ padding: '3px 9px', fontSize: 11, fontWeight: 600, color: '#c0392b', background: '#fff', border: '1px solid #f0c4c0', borderRadius: 6, cursor: 'pointer' }}
          >
            송장 없는 기록 {empty.length}건 지우기
          </button>
        )}
      </div>
      <div style={{ border: '1px solid #eee', borderRadius: 10, overflow: 'hidden' }}>
        {batches.slice(0, 8).map(b => {
          const boxes = allBoxes(b);
          const filled = boxes.filter(x => x.waybill.trim()).length;
          const ready = filled === boxes.length && boxes.length > 0;
          return (
            <div
              key={b.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 12px', borderTop: '1px solid #f4f4f4', fontSize: 12,
              }}
            >
              <b style={{ fontFamily: 'monospace', color: '#333' }}>{b.id}</b>
              <span style={{ color: '#aaa' }}>{dayText(b.createdAt)}</span>
              <span style={{ color: '#888' }}>{b.centers.length}센터 · {boxes.length}박스</span>
              <span style={{ color: ready ? '#27ae60' : '#e67e22', fontWeight: 600 }}>
                운송장 {filled}/{boxes.length}
              </span>
              <span style={{ flex: 1 }} />
              <button onClick={() => onWaybills(b)} style={btn('#e67e22', true)}>운송장 확인</button>
              <button
                onClick={() => ready && onShubForm(b)}
                disabled={!ready}
                style={btn('#2980b9', ready)}
                title={ready ? '서허에서 쉽먼트 일괄등록 양식을 받아옵니다' : '운송장번호가 다 채워져야 받을 수 있어요'}
              >
                서허 양식 받기
              </button>
              {onDelete && (
                <button
                  onClick={() => filled === 0 && onDelete([b])}
                  disabled={filled > 0}
                  title={filled === 0 ? '이 기록을 지웁니다' : '운송장번호가 있는 기록은 지우지 않아요'}
                  style={{
                    padding: '5px 8px', fontSize: 12, borderRadius: 7, background: '#fff',
                    border: '1px solid #eee', color: filled === 0 ? '#c0392b' : '#ddd',
                    cursor: filled === 0 ? 'pointer' : 'not-allowed',
                  }}
                >
                  삭제
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ShipmentList;
