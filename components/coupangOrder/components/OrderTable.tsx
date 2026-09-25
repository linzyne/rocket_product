import React from 'react';
import type { DisplayRow } from '../utils/dataProcessor';
import type { OfficeMatch } from '../../../data/inventoryStore';
import { parseBoxNo, boxLabel } from '../utils/dataProcessor';
import { formatDateDisplay, dateKeyYMD } from '../utils/dateUtils';

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
  // 있으면 맨 왼쪽에 체크 칸을 붙인다. 묶기는 발주서 단위라서 체크 칸도 발주번호마다 하나만 나온다.
  // 담기는 값은 줄 id가 아니라 발주번호다.
  selectedOrders?: Set<string>;
  onToggleSelect?: (orderNo: string, checked: boolean) => void;
  // 있으면 발주서 머리줄에 "전체예약 · 전체박스" 버튼을 붙인다. 그 발주서의 상품 줄 전부에 한 번에 적용한다.
  onBulkOrder?: (orderNo: string, patch: { 메모?: string; 쉼먼트?: string }) => void;
  // 일이 끝나 불을 꺼 둘 발주서들(발주번호). 그 줄은 흐리게 보여준다.
  dimmedOrders?: Set<string>;
  // 있으면 박스 버튼 옆에 작은 정렬 아이콘을 붙인다(박스 번호 순으로 줄을 다시 세운다).
  onSortByBox?: () => void;
  // 묶음 값이 화면에 보여줄 이름과 다를 때(예: 출고번호로 묶어 둔 경우) 이름을 돌려준다.
  bundleLabel?: (key: string) => string;
  // 묶음 색을 바깥에서 정할 때(카드와 같은 색을 쓰려고). 없으면 묶음 이름으로 색을 뽑는다.
  bundleColorOf?: (key: string) => string;
}

// 박스 번호(박스1, 박스2…)마다 다른 색. 어느 상자에 담기는지 한눈에 보이게.
const BOX_COLORS = ['#e67e22', '#2563eb', '#16a34a', '#db2777', '#7c3aed', '#0891b2', '#b45309', '#0f766e'];
export const boxColor = (no: number) => BOX_COLORS[(no - 1) % BOX_COLORS.length];

// 묶음 이름(묶음1, 묶음2…)마다 다른 색을 준다. 같은 묶음끼리 한눈에 보이게.
const BUNDLE_COLORS = ['#7c3aed', '#0891b2', '#d97706', '#be185d', '#15803d', '#4338ca'];
export function bundleColor(name: string): string {
  const no = Number(/\d+/.exec(name || '')?.[0] || 0);
  return BUNDLE_COLORS[(no || 1) - 1] || BUNDLE_COLORS[(no || 1) % BUNDLE_COLORS.length];
}

const SCHEME = {
  pink: {
    // 머리줄은 눈에 덜 띄는 연한 회색으로 두고, 글자는 진한 회색으로 읽는다.
    headerBg: '#f3f4f6', headerBorder: '#e3e5e8', headerText: '#4b5563', accent: '#b04a3e',
    rowHover: '#fff0ef',
    groupOdd: '#fff', groupEven: '#fdf5f4',
    sepBg: '#f5e6e5', sepBorder: '#e8c4c1',
    accentBorder: '#d4796f',
  },
  green: {
    headerBg: '#eef6f1', headerBorder: '#dbe9e1', headerText: '#41705a', accent: '#2f8a57',
    rowHover: '#eaf7ef',
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
        fontSize: 12,
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
      {code && <span style={{ fontSize: 11, color: '#2563eb', whiteSpace: 'nowrap' }} title="한중발주 고유번호">{code}</span>}
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

  const c = no ? boxColor(no) : '';

  if (!no) {
    return (
      <button
        onClick={toggle}
        style={{
          padding: '3px 12px',
          fontSize: 12,
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
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 0, border: `1.5px solid ${c}`, borderRadius: 6, overflow: 'hidden' }}>
      <button
        onClick={(e) => adjust(-1, e)}
        style={counterBtnStyle(`${c}14`, c)}
      >−</button>
      <button
        onClick={toggle}
        style={{
          padding: '3px 8px',
          fontSize: 12,
          fontWeight: 700,
          background: `${c}14`,
          color: c,
          border: 'none',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          borderLeft: `1px solid ${c}55`,
          borderRight: `1px solid ${c}55`,
        }}
        title="클릭하면 상자 지정 해제"
      >
        박스 {no}번
      </button>
      <button
        onClick={(e) => adjust(+1, e)}
        style={counterBtnStyle(`${c}14`, c)}
      >+</button>
    </div>
  );
}

// 발주서 머리줄의 일괄 적용 버튼(전체예약·전체박스).
function bulkBtn(color: string): React.CSSProperties {
  return {
    padding: '1px 7px', fontSize: 10, fontWeight: 700,
    color, background: '#fff', border: `1px solid ${color}55`,
    borderRadius: 5, cursor: 'pointer', whiteSpace: 'nowrap',
  };
}

function counterBtnStyle(bg: string, color: string): React.CSSProperties {
  return {
    padding: '3px 7px',
    fontSize: 13,
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
    return <td style={{ ...narrow(42), color: '#bbb', fontSize: 11 }} title={`${matched} (사무실 재고 미입력)`}>미입력</td>;
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
export default function OrderTable({ rows, onMemoChange, onShipmentChange, colorScheme = 'pink', readOnly = false, onDelete, officeQtyOf, selectedOrders, onToggleSelect, onBulkOrder, dimmedOrders, onSortByBox, bundleLabel, bundleColorOf }: Props) {
  if (rows.length === 0) return null;

  const sc = SCHEME[colorScheme];
  const selectable = !!onToggleSelect;
  // 같은 물류센터·입고예정일로 한 덩어리(한 박스)에 묶여 있는 발주번호들. 덩어리 전체선택에 쓴다.
  const ordersByGroup = new Map<string, string[]>();
  // 덩어리별 품목 수와 수량 합계(한 박스에 들어갈 물량이 한눈에 보이게).
  const statsByGroup = new Map<string, { lines: number; qty: number }>();
  for (const row of rows) {
    if (row.isBlank || !row._발주번호) continue;
    const list = ordersByGroup.get(row.groupKey) || [];
    if (!list.includes(row._발주번호)) list.push(row._발주번호);
    ordersByGroup.set(row.groupKey, list);
    const st = statsByGroup.get(row.groupKey) || { lines: 0, qty: 0 };
    st.lines += 1;
    st.qty += Number(row.확정수량) || 0;
    statsByGroup.set(row.groupKey, st);
  }
  // 발주번호·센터·입고예정일은 발주서마다 한 줄(머리줄)로 위에 올리고, 표 본문은 상품만 남긴다.
  const headers = [
    '상품이름', '확정수량',
    ...(officeQtyOf ? ['사무실'] : []),
    '예약', '박스', ...(onDelete ? ['삭제'] : []),
  ];

  return (
    <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid #e5e5e5', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            {headers.map(h => (
              <th key={h} style={{
                background: sc.headerBg,
                color: sc.headerText,
                fontWeight: 700,
                padding: h === '확정수량' || h === '사무실' ? '7px 3px' : '7px 8px',
                textAlign: 'center',
                whiteSpace: 'nowrap',
                border: `1px solid ${sc.headerBorder}`,
                fontSize: 13,
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

            const tint = row.묶음 ? (bundleColorOf ? bundleColorOf(row.묶음) : bundleColor(row.묶음)) : '';
            const bg = tint ? `${tint}0f` : '#fff';
            // 발주번호가 찍히는 줄이 그 발주서의 첫 줄이다(아래 줄들은 같은 발주서라 번호를 비워 둔다).
            const isOrderHead = !!row.발주번호;
            // 묶음에서 고른 센터·입고예정일이 아직 이 발주서에 안 옮겨졌으면 "적용 대기".
            const pending = !!row.묶음 && (
              (!!row.묶음센터 && row.묶음센터.trim() !== (row._물류센터 || '').trim()) ||
              (!!row.묶음일자 && row.묶음일자 !== dateKeyYMD(row._입고예정일))
            );
            const dim = !!dimmedOrders?.has(row._발주번호);
            const head = isOrderHead ? (
              <tr key={`${row.id}-head`} style={{ background: tint ? `${tint}1c` : '#f7f7f8', opacity: dim ? 0.45 : 1 }}>
                <td colSpan={headers.length} style={{
                  padding: '4px 8px', borderTop: '1px solid #e8e8e8', borderBottom: '1px solid #f0f0f0',
                  borderLeft: tint ? `4px solid ${tint}` : undefined,
                  whiteSpace: 'nowrap',
                }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                    {selectable && (
                      <input
                        type="checkbox"
                        checked={!!selectedOrders?.has(row._발주번호)}
                        onChange={e => onToggleSelect!(row._발주번호, e.target.checked)}
                        style={{ cursor: 'pointer', margin: 0 }}
                        title="이 발주서를 묶음에 담을 후보로 고릅니다"
                      />
                    )}
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#333' }}>{row._발주번호}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: sc.accent }}>{(row._물류센터 || '').trim()}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#2c3e50' }}>{formatDateDisplay(row._입고예정일)}</span>
                    {row.묶음 && (
                      <span style={{
                        padding: '0 6px', fontSize: 11, fontWeight: 700, borderRadius: 8,
                        color: tint, background: `${tint}22`,
                      }}>
                        {bundleLabel ? bundleLabel(row.묶음) : row.묶음}
                      </span>
                    )}
                    {!!row.물류센터 && (() => {
                      const st = statsByGroup.get(row.groupKey);
                      const cnt = (ordersByGroup.get(row.groupKey) || []).length;
                      if (!st) return null;
                      return (
                        <span style={{ fontSize: 11, color: '#777', fontWeight: 700 }}
                          title="이 센터·입고예정일로 한 덩어리인 발주서 수 · 품목 수 · 수량 합계">
                          발주 {cnt} · {st.lines}품목 · {st.qty.toLocaleString()}개
                        </span>
                      );
                    })()}
                    {selectable && !!row.물류센터 && (ordersByGroup.get(row.groupKey) || []).length > 1 && (() => {
                      const groupOrders = ordersByGroup.get(row.groupKey) || [];
                      const allOn = groupOrders.every(no => selectedOrders?.has(no));
                      return (
                        <label
                          title={`${(row._물류센터 || '').trim()} · ${formatDateDisplay(row._입고예정일)}로 한 덩어리인 발주서 ${groupOrders.length}건을 모두 고릅니다`}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 3, marginLeft: 4, fontSize: 10, color: '#888', cursor: 'pointer' }}
                        >
                          <input
                            type="checkbox"
                            checked={allOn}
                            onChange={() => groupOrders.forEach(no => onToggleSelect!(no, !allOn))}
                            style={{ cursor: 'pointer', margin: 0 }}
                          />
                          덩어리 전체
                        </label>
                      );
                    })()}
                    {onBulkOrder && !readOnly && (
                      <span style={{ display: 'inline-flex', gap: 4, marginLeft: 6 }}>
                        <button
                          onClick={() => onBulkOrder(row._발주번호, { 메모: '예약' })}
                          title="이 발주서의 상품을 모두 예약으로 넘깁니다"
                          style={bulkBtn('#27ae60')}
                        >
                          전체예약
                        </button>
                        <button
                          onClick={() => onBulkOrder(row._발주번호, { 쉼먼트: boxLabel(1) })}
                          title="이 발주서의 상품을 모두 박스 1번으로 지정합니다"
                          style={bulkBtn('#e67e22')}
                        >
                          전체박스
                        </button>
                      </span>
                    )}
                    {row.묶음 && (
                      pending ? (
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#e67e22' }}
                          title="묶음에서 고른 센터·입고예정일이 아직 이 발주서에 반영되지 않았어요. 묶음 카드의 '묶음 적용'을 눌러주세요.">
                          적용 대기
                        </span>
                      ) : (
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#27ae60' }}
                          title="묶음의 센터·입고예정일이 이 발주서에 반영돼 있어요">
                          적용됨 ✓
                        </span>
                      )
                    )}
                  </span>
                </td>
              </tr>
            ) : null;

            const line = (
              <tr
                key={row.id}
                style={{ borderBottom: '1px solid #ebebeb', background: bg, opacity: dim ? 0.45 : 1 }}
                onMouseEnter={e => (e.currentTarget.style.background = sc.rowHover)}
                onMouseLeave={e => (e.currentTarget.style.background = bg)}
              >
                <td style={{
                  ...cs(0), textAlign: 'left', minWidth: 210, padding: '5px 6px',
                  borderLeft: tint ? `4px solid ${tint}` : undefined,
                }}>{row.상품이름}</td>
                <td style={narrow(38)}>{row.확정수량 !== '' ? row.확정수량 : ''}</td>
                {officeQtyOf && <OfficeCell match={officeQtyOf(row.상품이름)} need={Number(row.확정수량) || 0} />}

                {/* 예약(예전 이름은 메모 칸) */}
                <td style={{ ...cs(64), padding: '4px 4px' }}>
                  {readOnly ? (
                    <span style={{ fontSize: 12, color: '#666' }}>{row.메모}</span>
                  ) : (
                    <MemoButton value={row.메모} onChange={(v) => onMemoChange(row.id, v)} withHanjung={false} showCode={colorScheme === 'green'} />
                  )}
                </td>

                {/* 박스수량(롯데 N박스) */}
                <td style={{ ...cs(onSortByBox ? 104 : 76), padding: '4px 4px' }}>
                  {readOnly ? (
                    <span style={{ fontSize: 12, color: '#666' }}>{row.쉼먼트}</span>
                  ) : (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                    <BoxButton value={row.쉼먼트} onChange={(v) => onShipmentChange(row.id, v)} />
                    {onSortByBox && (
                      <button
                        onClick={onSortByBox}
                        title="박스 번호 순(1번 → 2번 → …)으로 줄을 다시 세웁니다"
                        style={{
                          marginLeft: 4, padding: '2px 4px', fontSize: 11, lineHeight: 1,
                          color: '#bbb', background: '#fff', border: '1px solid #ececec',
                          borderRadius: 4, cursor: 'pointer',
                        }}
                      >
                        ↕
                      </button>
                    )}
                  </span>
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

            return head ? <React.Fragment key={row.id}>{head}{line}</React.Fragment> : line;
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
    fontSize: 12,
  };
}
