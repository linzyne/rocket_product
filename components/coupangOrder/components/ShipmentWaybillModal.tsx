import React, { useState } from 'react';
import { ShipmentBatch, saveShipmentBatch } from '../../../data/shipmentStore';

// 쉽먼트 한 묶음의 박스별 운송장번호 확인 창.
// 확장이 롯데에서 모아온 번호가 미리 채워져 있고, 틀리면 여기서 고친다.
// 이 번호를 서허 쉽먼트 일괄등록 양식(송장번호입력·상품목록 탭)에 쓴다.
interface Props {
  batch: ShipmentBatch;
  onClose: () => void;
}

const ShipmentWaybillModal: React.FC<Props> = ({ batch, onClose }) => {
  const [draft, setDraft] = useState(batch);
  const [saving, setSaving] = useState(false);

  const setWaybill = (center: string, boxNo: number, waybill: string) =>
    setDraft(prev => ({
      ...prev,
      centers: prev.centers.map(c =>
        c.center !== center ? c : { ...c, boxes: c.boxes.map(b => (b.boxNo === boxNo ? { ...b, waybill } : b)) }
      ),
    }));

  const boxes = draft.centers.flatMap(c => c.boxes);
  const filled = boxes.filter(b => b.waybill.trim()).length;

  const save = async () => {
    setSaving(true);
    try {
      await saveShipmentBatch({ ...draft, status: filled === boxes.length ? 'waybilled' : 'reserved' });
      onClose();
    } catch (err: any) {
      alert(`저장 실패: ${err?.message || err}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        style={{ background: '#fff', borderRadius: 12, width: 'min(720px, 92vw)', maxHeight: '86vh', overflow: 'auto', padding: 20 }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
          <b style={{ fontSize: 16 }}>운송장번호 확인</b>
          <span style={{ fontSize: 12, color: '#999' }}>{draft.id} · 박스 {boxes.length}개 중 {filled}개 입력</span>
        </div>
        <p style={{ fontSize: 12, color: '#888', margin: '0 0 14px' }}>
          박스마다 롯데 운송장번호를 확인해 주세요. 비어 있으면 롯데 통합관리 운송장출력 목록에서 보고 직접 넣으면 돼요.
        </p>

        {draft.centers.map(c => (
          <div key={c.center} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#c0392b', marginBottom: 6 }}>{c.center}</div>
            {c.boxes.map(b => (
              <div key={b.boxNo} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '6px 0', borderTop: '1px solid #f2f2f2' }}>
                <span style={{ width: 62, fontSize: 12, color: '#e67e22', fontWeight: 700, paddingTop: 6 }}>박스 {b.boxNo}번</span>
                <input
                  value={b.waybill}
                  onChange={e => setWaybill(c.center, b.boxNo, e.target.value)}
                  placeholder="운송장번호"
                  style={{ width: 190, padding: '6px 8px', border: '1px solid #e0e0e0', borderRadius: 6, fontFamily: 'monospace', fontSize: 13 }}
                />
                <span style={{ flex: 1, fontSize: 11, color: '#888', lineHeight: 1.5, paddingTop: 4 }}>
                  {b.lines.map(l => `${l.상품이름} ${l.확정수량}개`).join(' · ')}
                </span>
              </div>
            ))}
          </div>
        ))}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
          <button onClick={onClose} style={{ padding: '8px 14px', border: '1px solid #e5e5e5', background: '#fff', borderRadius: 8, cursor: 'pointer' }}>닫기</button>
          <button
            onClick={save}
            disabled={saving}
            style={{ padding: '8px 16px', border: 'none', background: '#27ae60', color: '#fff', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}
          >
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ShipmentWaybillModal;
