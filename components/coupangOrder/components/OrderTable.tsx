import type React from 'react';
import type { DisplayRow } from '../utils/dataProcessor';
import type { OfficeMatch } from '../../../data/inventoryStore';
import { parseBoxNo, boxLabel } from '../utils/dataProcessor';
import { formatDateDisplay } from '../utils/dateUtils';

interface Props {
  rows: DisplayRow[];
  onMemoChange: (id: string, value: string) => void;
  onShipmentChange: (id: string, value: string) => void;
  colorScheme?: 'pink' | 'green';
  readOnly?: boolean;
  // 있으면 맨 오른쪽에 삭제(×) 칸을 붙인다(예약 패널).
  onDelete?: (id: string) => void;
  // 있으면 확정수량 옆에 상품관리(재고>상품관리)의 사무실 재고를 붙인다. 상품이름으로 찾는다.
  officeQtyOf?: (productName: string) => OfficeMatch | null;
}

const SCHEME = {
  pink: {
    headerBg: '#c0392b', headerBorder: '#a93226', rowHover: '#fff0ef',
    groupOdd: '#fff', groupEven: '#fdf5f4',
    sepBg: '#f5e6e5', sepBorder: '#e8c4c1',
    accentBorder: '#d4796f',
  },
  green: {
    headerBg: '#27ae60', headerBorder: '#1e8449', rowHover: '#eaf7ef',
    groupOdd: '#fff', groupEven: '#f3faf5',
    sepBg: '#dff2e7', sepBorder: '#b7dfc5',
    accentBorder: '#5bbf82',
  },
};

/* ── 예약 / 한중 토글 버튼 (둘 중 하나만) ── */
function MemoToggle({ label, color, bg, active, onClick }: { label: string; color: string; bg: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '3px 8px',
        fontSize: 11,
        fontWeight: active ? 700 : 400,
        borderRadius: 5,
        border: active ? `1.5px solid ${color}` : '1.5px solid #d5d5d5',
        background: active ? bg : '#fafafa',
        color: active ? color : '#bbb',
        cursor: 'pointer',
        transition: 'all 0.12s',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );
}

function MemoButton({ value, onChange, withHanjung, showCode }: { value: string; onChange: (v: string) => void; withHanjung: boolean; showCode: boolean }) {
  // 예전 "한중" 표시도 예약으로 본다(지금은 예약 하나로 한중발주까지 넘긴다).
  const reserved = value.includes('예약') || value.includes('한중');
  const hanjung = value.includes('한중');
  // 예약 패널에서는 한중발주로 넘어온 건의 고유번호(예: "예약 H260923-01")를 같이 보여준다.
  const code = showCode ? (/\bH\d{6}-\d+\b|(?<=예약\s)\S+/.exec(value) || [])[0] : '';
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      <MemoToggle label="예약" color="#27ae60" bg="#e8f8f0" active={reserved} onClick={() => onChange(reserved ? '' : '예약')} />
      {withHanjung && (
        <MemoToggle label="한중" color="#2563eb" bg="#eff6ff" active={hanjung} onClick={() => onChange(hanjung ? '' : '한중')} />
      )}
      {code && <span style={{ fontSize: 10, color: '#2563eb', whiteSpace: 'nowrap' }} title="한중발주 고유번호">{code}</span>}
    </span>
  );
}

/* ── 박스 번호 버튼 ── */
// 이 상품이 몇 번 상자에 들어가는지 정한다. 여러 상품을 한 상자에 담으면 같은 번호를 준다.
// 센터별로 나온 상자 개수만큼 택배 예약이 만들어진다(utils/dataProcessor의 boxesByCenter).
function BoxButton({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const no = parseBoxNo(value);

  const toggle = () => onChange(no ? '' : boxLabel(1));
  const adjust = (delta: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = (no || 0) + delta;
    if (next <= 0) { onChange(''); return; }
    onChange(boxLabel(next));
  };

  if (!no) {
    return (
      <button
        onClick={toggle}
        style={{
          padding: '3px 12px',
          fontSize: 11,
          borderRadius: 5,
          border: '1.5px solid #d5d5d5',
          background: '#fafafa',
          color: '#bbb',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
        title="이 상품을 담을 상자 번호를 정합니다"
      >
        박스
      </button>
    );
  }

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 0, border: '1.5px solid #e67e22', borderRadius: 6, overflow: 'hidden' }}>
      <button
        onClick={(e) => adjust(-1, e)}
        style={counterBtnStyle('#fff4ec', '#c0392b')}
      >−</button>
      <button
        onClick={toggle}
        style={{
          padding: '3px 8px',
          fontSize: 11,
          fontWeight: 700,
          background: '#fff4ec',
          color: '#e67e22',
          border: 'none',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          borderLeft: '1px solid #f0c090',
          borderRight: '1px solid #f0c090',
        }}
        title="클릭하면 상자 지정 해제"
      >
        박스 {no}번
      </button>
      <button
        onClick={(e) => adjust(+1, e)}
        style={counterBtnStyle('#fff4ec', '#c0392b')}
      >+</button>
    </div>
  );
}

function counterBtnStyle(bg: string, color: string): React.CSSProperties {
  return {
    padding: '3px 7px',
    fontSize: 12,
    fontWeight: 700,
    background: bg,
    color,
    border: 'none',
    cursor: 'pointer',
  };
}

/* ── 사무실 재고 칸 ── */
// 상품관리에 짝이 되는 상품이 없으면 '-', 사무실 재고를 아직 안 넣었으면 '미입력'.
// 확정수량보다 모자라면 빨갛게 보여준다. 옵션만 다른 상품이 여럿이면 합친 값이고,
// 이름이 딱 맞지 않아 비슷한 상품으로 맞춘 경우에는 * 를 붙인다.
function OfficeCell({ match, need }: { match: OfficeMatch | null; need: number }) {
  if (!match) return <td style={{ ...narrow(42), color: '#ccc' }} title="상품관리에서 같은 이름을 못 찾았어요">-</td>;
  const matched = `상품관리: ${match.names.join(' / ')}`;
  if (match.qty == null) {
    return <td style={{ ...narrow(42), color: '#bbb', fontSize: 10 }} title={`${matched} (사무실 재고 미입력)`}>미입력</td>;
  }
  const short = match.qty < need;
  const note = [
    match.names.length > 1 ? `상품 ${match.names.length}개를 합친 값` : '',
    match.exact ? '' : '이름이 조금 달라 비슷한 상품으로 맞춤',
  ].filter(Boolean).join(' · ');
  return (
    <td
      style={{ ...narrow(42), color: short ? '#c0392b' : '#2d7a4f', fontWeight: 700 }}
      title={note ? `${matched}\n${note}` : matched}
    >
      {match.qty.toLocaleString()}
      {!match.exact && <span style={{ color: '#e67e22', fontWeight: 400 }}>*</span>}
    </td>
  );
}

/* ── 메인 테이블 ── */
export default function OrderTable({ rows, onMemoChange, onShipmentChange, colorScheme = 'pink', readOnly = false, onDelete, officeQtyOf }: Props) {
  if (rows.length === 0) return null;

  const sc = SCHEME[colorScheme];
  const headers = [
    '발주번호', '물류센터', '상품이름', '확정수량',
    ...(officeQtyOf ? ['사무실'] : []),
    '입고예정일', '메모', '박스수량', ...(onDelete ? ['삭제'] : []),
  ];

  return (
    <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid #e5e5e5', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            {headers.map(h => (
              <th key={h} style={{
                background: sc.headerBg,
                color: '#fff',
                fontWeight: 600,
                padding: h === '확정수량' || h === '사무실' ? '7px 3px' : '7px 8px',
                textAlign: 'center',
                whiteSpace: 'nowrap',
                border: `1px solid ${sc.headerBorder}`,
                fontSize: 12,
              }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(() => {
            let groupIndex = 0;
            return rows.map((row) => {
            if (row.isBlank) {
              groupIndex++;
              return (
                <tr key={row.id}>
                  <td colSpan={headers.length} style={{
                    height: 10,
                    background: sc.sepBg,
                    borderTop: `2px solid ${sc.sepBorder}`,
                    borderBottom: `2px solid ${sc.sepBorder}`,
                    padding: 0,
                  }} />
                </tr>
              );
            }

            return (
              <tr
                key={row.id}
                style={{ borderBottom: '1px solid #ebebeb', background: '#fff' }}
                onMouseEnter={e => (e.currentTarget.style.background = sc.rowHover)}
                onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
              >
                <td style={cs(70)}>{row.발주번호}</td>
                <td style={cs(60)}>{row.물류센터}</td>
                <td style={{ ...cs(0), textAlign: 'left', minWidth: 220, padding: '5px 8px' }}>{row.상품이름}</td>
                <td style={narrow(38)}>{row.확정수량 !== '' ? row.확정수량 : ''}</td>
                {officeQtyOf && <OfficeCell match={officeQtyOf(row.상품이름)} need={Number(row.확정수량) || 0} />}
                <td style={{ ...cs(80), whiteSpace: 'nowrap' }}>{formatDateDisplay(row.입고예정일)}</td>

                {/* 메모 */}
                <td style={{ ...cs(70), padding: '4px 6px' }}>
                  {readOnly ? (
                    <span style={{ fontSize: 11, color: '#666' }}>{row.메모}</span>
                  ) : (
                    <MemoButton value={row.메모} onChange={(v) => onMemoChange(row.id, v)} withHanjung={false} showCode={colorScheme === 'green'} />
                  )}
                </td>

                {/* 박스수량(롯데 N박스) */}
                <td style={{ ...cs(90), padding: '4px 6px' }}>
                  {readOnly ? (
                    <span style={{ fontSize: 11, color: '#666' }}>{row.쉼먼트}</span>
                  ) : (
                    <BoxButton value={row.쉼먼트} onChange={(v) => onShipmentChange(row.id, v)} />
                  )}
                </td>

                {onDelete && (
                  <td style={{ ...cs(40), padding: '4px 6px' }}>
                    <button
                      onClick={() => onDelete(row.id)}
                      title="이 예약 삭제"
                      style={{
                        width: 24, height: 24, fontSize: 14, lineHeight: '20px',
                        color: '#c0392b', background: '#fff',
                        border: '1px solid #f0c4c0', borderRadius: 5, cursor: 'pointer',
                      }}
                    >
                      ×
                    </button>
                  </td>
                )}
              </tr>
            );
          });
          })()}
        </tbody>
      </table>
    </div>
  );
}

// 수량 칸처럼 좁게 쓰는 칸(좌우 여백을 줄인다).
function narrow(width: number): React.CSSProperties {
  return { ...cs(width), padding: '5px 3px' };
}

function cs(width: number): React.CSSProperties {
  return {
    padding: '5px 8px',
    textAlign: 'center',
    color: '#444',
    border: '1px solid #eeeeee',
    width: width > 0 ? width : undefined,
    fontSize: 11,
  };
}
