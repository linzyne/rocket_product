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

  // 박스는 몇 번째 센터의 몇 번째 박스인지로 고른다. 같은 센터에 박스 번호가 같은 박스가 둘 있을 수 있어서
  // (같은 센터의 출고 건 두 개를 한 번에 예약한 경우) 번호로 고르면 두 박스가 함께 바뀐다.
  const setWaybill = (ci: number, bi: number, waybill: string) =>
    setDraft(prev => ({
      ...prev,
      centers: prev.centers.map((c, i) =>
        i !== ci ? c : { ...c, boxes: c.boxes.map((b, j) => (j === bi ? { ...b, waybill } : b)) }
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

        {draft.centers.map((c, ci) => (
          <div key={`${c.center}-${ci}`} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#c0392b', marginBottom: 6 }}>{c.center}</div>
            {c.boxes.map((b, bi) => (
              <div key={`${b.boxNo}-${bi}`} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '6px 0', borderTop: '1px solid #f2f2f2' }}>
                <span style={{ width: 62, fontSize: 12, color: '#e67e22', fontWeight: 700, paddingTop: 6 }}>박스 {b.boxNo}번</span>
                <input
                  value={b.waybill}
                  onChange={e => setWaybill(ci, bi, e.target.value)}
                  placeholder="운송장번호"
                  style={{ width: 190, padding: '6px 8px', border: '1px solid #e0e0e0', borderRadius: 6, fontFamily: 'monospace', fontSize: 13 }}
                />
                {/* 박스에 든 상품을 한 줄에 하나씩: 상품이름 · 수량 · 발주번호 */}
                <div style={{ flex: 1, minWidth: 0, fontSize: 12, lineHeight: 1.45 }}>
                  <div style={{ fontSize: 11, color: '#aaa', marginBottom: 2 }}>
                    {b.lines.length}품목 · {b.lines.reduce((s, l) => s + (Number(l.확정수량) || 0), 0).toLocaleString()}개
                  </div>
                  {b.lines.map((l, i) => (
                    <div key={`${l.발주번호}-${l.상품이름}-${i}`} style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '2px 0', borderTop: i ? '1px dashed #f0f0f0' : 'none' }}>
                      <span style={{ flex: 1, minWidth: 0, color: '#333' }}>{l.상품이름}</span>
                      <b style={{ minWidth: 40, textAlign: 'right', color: '#222' }}>{l.확정수량}개</b>
                      <span style={{ minWidth: 76, textAlign: 'right', fontSize: 11, color: '#aaa' }}>{l.발주번호}</span>
                    </div>
                  ))}
                </div>
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
