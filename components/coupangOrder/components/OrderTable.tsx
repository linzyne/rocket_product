import React from 'react';
import type { DisplayRow } from '../utils/dataProcessor';
import type { OfficeMatch } from '../../../data/inventoryStore';
import { parseBoxNo, boxLabel, boxGroupKey, bundleCenters } from '../utils/dataProcessor';
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
  // 쉽먼트까지 끝난 발주서들(발주번호). 흐리게 하지 않고 연한 초록 바탕에 완료 도장을 찍어 준다.
  doneOrders?: Set<string>;
  // 있으면 박스 버튼 옆에 작은 정렬 아이콘을 붙인다(박스 번호 순으로 줄을 다시 세운다).
  onSortByBox?: () => void;
  // 묶음 값이 화면에 보여줄 이름과 다를 때(예: 출고번호로 묶어 둔 경우) 이름을 돌려준다.
  bundleLabel?: (key: string) => string;
  // 묶음 색을 바깥에서 정할 때(카드와 같은 색을 쓰려고). 없으면 묶음 이름으로 색을 뽑는다.
  bundleColorOf?: (key: string) => string;
  // 'order'(기본): 발주서 머리줄 → 상품. 'box': 덩어리 머리줄 → 박스 머리줄 → 상품(발주번호는 줄 맨 뒤 칸).
  layout?: 'order' | 'box';
  // 상품 줄 하나하나를 고르는 체크 칸(예약 패널에서 고른 줄만 발송으로 되돌릴 때 쓴다).
  selectedLines?: Set<string>;
  onToggleLine?: (id: string, checked: boolean) => void;
  // 박스 칸과 "전체박스" 버튼을 숨긴다(박스를 정하지 않는 쿠팡발주확인 화면).
  hideBox?: boolean;
  // 새로 들어온 발주서(발주번호). 발주서 머리줄에 NEW를 붙인다.
  newOrders?: Set<string>;
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

// 물류센터 이름표: 패널 색을 바탕으로 칠해 한눈에 들어오게 한다.
function CenterTag({ name, color }: { name: string; color: string }) {
  if (!name) return null;
  return (
    <span style={{
      padding: '2px 9px', fontSize: 14, fontWeight: 800, borderRadius: 6,
      color: '#fff', background: color, letterSpacing: '-0.2px', lineHeight: '18px',
    }}>
      {name}
    </span>
  );
}

// 입고예정일 이름표: "10/2 (목)"처럼 크게 쓰고, 옆에 같은 모양으로 D-day를 붙인다.
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
function DateTag({ value }: { value: Date | string }) {
  const ymd = dateKeyYMD(value);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m || ymd === '9999-12-31') {
    const raw = formatDateDisplay(value);
    return raw ? <span style={{ fontSize: 13, fontWeight: 700, color: '#2c3e50' }}>{raw}</span> : null;
  }
  const day = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((day.getTime() - today.getTime()) / 86400000);
  const dText = diff < 0 ? `${-diff}일 지남` : diff === 0 ? 'D-DAY' : `D-${diff}`;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span style={{
        padding: '1px 8px', fontSize: 14, fontWeight: 800, borderRadius: 6,
        color: '#1e293b', background: '#fff', border: '1.5px solid #334155', lineHeight: '18px',
      }}>
        {Number(m[2])}/{Number(m[3])} ({WEEK[day.getDay()]})
      </span>
      <span style={{
        padding: '1px 8px', fontSize: 14, fontWeight: 800, borderRadius: 6,
        color: '#1e293b', background: '#fff', border: '1.5px solid #334155', lineHeight: '18px',
      }}>
        {dText}
      </span>
    </span>
  );
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

// 쉽먼트까지 끝난 줄에 쓰는 색. 불을 꺼서 흐리게 하지 않고, 바탕을 연한 초록으로 물들여 표시한다.
const DONE = '#27ae60';
const DONE_BG = '#f2fbf6';
const DONE_HEAD_BG = '#e3f6ec';
const DONE_HOVER = '#e9f8f0';

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

// 예약 칸의 두 가지 표시. 예약은 한중발주(1688 주문)로 넘어가고, 대기는 예약 목록에만 머문다.
const MEMO_KIND = {
  예약: { color: '#27ae60', bg: '#e8f8f0' },
  대기: { color: '#d97706', bg: '#fff7e6' },
} as const;
const memoKind = (value: string): '예약' | '대기' | '' =>
  value.includes('대기') ? '대기' : (value.includes('예약') || value.includes('한중')) ? '예약' : '';

function MemoButton({ value, onChange, withHanjung, showCode }: { value: string; onChange: (v: string) => void; withHanjung: boolean; showCode: boolean }) {
  // 예전 "한중" 표시도 예약으로 본다(지금은 예약 하나로 한중발주까지 넘긴다).
  const kind = memoKind(value);
  const hanjung = value.includes('한중');
  // 예약 패널에서는 한중발주로 넘어온 건의 고유번호(예: "예약 H260923-01")를 같이 보여준다.
  const code = showCode ? (/\bH\d{6}-\d+\b|(?<=예약\s)\S+/.exec(value) || [])[0] : '';
  const c = kind ? MEMO_KIND[kind] : null;
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      {showCode ? (
        // 예약 패널: 예약/대기 표시만 보여준다.
        c && (
          <span style={{
            padding: '2px 8px', fontSize: 12, fontWeight: 700, borderRadius: 5,
            border: `1.5px solid ${c.color}`, background: c.bg, color: c.color, whiteSpace: 'nowrap',
          }}>
            {kind}
          </span>
        )
      ) : (
        // 발송 패널: 예약/대기를 고르면 그 줄이 예약 목록으로 넘어간다.
        <select
          value={kind}
          onChange={e => onChange(e.target.value)}
          title="예약: 한중발주로 넘김 · 대기: 예약 목록에만 둠"
          style={{
            padding: '2px 4px', fontSize: 12, fontWeight: c ? 700 : 400, borderRadius: 5, cursor: 'pointer',
            border: c ? `1.5px solid ${c.color}` : '1.5px solid #d5d5d5',
            background: c ? c.bg : '#fafafa', color: c ? c.color : '#999',
          }}
        >
          <option value="">선택</option>
          <option value="예약">예약</option>
          <option value="대기">대기</option>
        </select>
      )}
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
export default function OrderTable({ rows, onMemoChange, onShipmentChange, colorScheme = 'pink', readOnly = false, onDelete, officeQtyOf, selectedOrders, onToggleSelect, onBulkOrder, doneOrders, onSortByBox, bundleLabel, bundleColorOf, layout = 'order', selectedLines, onToggleLine, hideBox = false, newOrders }: Props) {
  if (rows.length === 0) return null;

  const sc = SCHEME[colorScheme];
  const selectable = !!onToggleSelect;
  const lineSelectable = !!onToggleLine;
  // 발주서마다 그 발주서에 속한 상품 줄 id들(머리줄 체크 한 번으로 다 고르게).
  const lineIdsByOrder = new Map<string, string[]>();
  for (const row of rows) {
    if (row.isBlank || !row._발주번호) continue;
    lineIdsByOrder.set(row._발주번호, [...(lineIdsByOrder.get(row._발주번호) || []), row.id]);
  }
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
  // 박스마다 품목 수·수량 합계와 그 박스가 표에 처음 나오는 줄. 박스 머리줄을 딱 한 번만 찍는 데 쓴다.
  // 무엇을 한 박스로 보는지는 택배 예약·쉽먼트 기록과 똑같이 센터 + 묶음(또는 센터·입고예정일 덩어리) + 박스번호로 센다.
  const rowCenter = bundleCenters(rows);
  const centerOf = (row: DisplayRow) =>
    (row.묶음 ? rowCenter.get(row.묶음) : '') || (row._물류센터 || row.물류센터).trim();
  const boxKeyOf = (row: DisplayRow) => `${centerOf(row)}|${boxGroupKey(row)}|${parseBoxNo(row.쉼먼트)}`;
  const statsByBox = new Map<string, { lines: number; qty: number; firstId: string }>();
  for (const row of rows) {
    if (row.isBlank || !row.쉼먼트) continue;
    const key = boxKeyOf(row);
    const st = statsByBox.get(key) || { lines: 0, qty: 0, firstId: row.id };
    st.lines += 1;
    st.qty += Number(row.확정수량) || 0;
    statsByBox.set(key, st);
  }
  // 발주번호·센터·입고예정일은 발주서마다 한 줄(머리줄)로 위에 올리고, 표 본문은 상품만 남긴다.
  const headers = [
    ...(lineSelectable ? ['고름'] : []),
    '상품이름', '확정수량',
    ...(officeQtyOf ? ['사무실'] : []),
    '예약', ...(hideBox ? [] : ['박스']), ...(onDelete ? ['삭제'] : []),
  ];


  // ── 'box' 레이아웃: 덩어리(센터·입고예정일 또는 묶음) → 박스 → 상품 ──
  // 쉽먼트생성 화면처럼 발주 정리가 끝나고 "무엇을 어느 박스에 담느냐"만 남은 곳에서 쓴다.
  if (layout === 'box') {
    type Box = { no: number; rows: DisplayRow[]; qty: number };
    type Chunk = { key: string; center: string; date: string | Date; bundle: string; orders: string[]; boxes: Box[]; lines: number; qty: number };
    const chunks: Chunk[] = [];
    const chunkBy = new Map<string, Chunk>();
    for (const row of rows) {
      if (row.isBlank) continue;
      const key = `${centerOf(row)}|${boxGroupKey(row)}`;
      let chunk = chunkBy.get(key);
      if (!chunk) {
        chunk = { key, center: centerOf(row), date: row._입고예정일, bundle: row.묶음 || '', orders: [], boxes: [], lines: 0, qty: 0 };
        chunkBy.set(key, chunk);
        chunks.push(chunk);
      }
      if (!chunk.orders.includes(row._발주번호)) chunk.orders.push(row._발주번호);
      chunk.lines += 1;
      chunk.qty += Number(row.확정수량) || 0;
      const no = parseBoxNo(row.쉼먼트) || 0;
      let box = chunk.boxes.find(b => b.no === no);
      if (!box) { box = { no, rows: [], qty: 0 }; chunk.boxes.push(box); }
      box.rows.push(row);
      box.qty += Number(row.확정수량) || 0;
    }
    // 박스 번호 순으로 세운다. 아직 박스를 안 정한 줄은 맨 아래로.
    for (const chunk of chunks) chunk.boxes.sort((a, b) => (a.no || 9999) - (b.no || 9999));

    const boxHeaders = [
      '상품이름', '확정수량',
      ...(officeQtyOf ? ['사무실'] : []),
      '예약', '박스', '발주번호', ...(onDelete ? ['삭제'] : []),
    ];

    return (
      <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid #e5e5e5', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              {boxHeaders.map(h => (
                <th key={h} style={{
                  background: sc.headerBg, color: sc.headerText, fontWeight: 700,
                  padding: h === '확정수량' || h === '사무실' ? '7px 3px' : '7px 8px',
                  textAlign: 'center', whiteSpace: 'nowrap',
                  border: `1px solid ${sc.headerBorder}`, fontSize: 13,
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {chunks.map((chunk, ci) => {
              const tint = chunk.bundle ? (bundleColorOf ? bundleColorOf(chunk.bundle) : bundleColor(chunk.bundle)) : '';
              // 덩어리 안 발주서가 모두 끝났으면 덩어리째 완료로 본다.
              const chunkDone = chunk.orders.length > 0 && chunk.orders.every(no => doneOrders?.has(no));
              const edge = chunkDone ? DONE : (tint || sc.accentBorder);
              const allOn = selectable && chunk.orders.every(no => selectedOrders?.has(no));
              return (
                <React.Fragment key={chunk.key}>
                  {ci > 0 && (
                    <tr>
                      <td colSpan={boxHeaders.length} style={{
                        // 덩어리끼리는 한눈에 끊겨 보이게 흰 여백으로 띄운다.
                        height: 26, background: '#fff', border: 'none', padding: 0,
                      }} />
                    </tr>
                  )}

                  {/* 덩어리 머리줄: 센터·입고예정일·묶음·전체선택·완료 */}
                  {/* data-chunk: 오른쪽 묶음 카드가 이 덩어리 옆에서만 따라오게 바깥에서 높이를 재는 표시다. */}
                  <tr data-chunk={chunk.bundle || chunk.key} style={{ background: chunkDone ? DONE_HEAD_BG : (tint ? `${tint}1c` : '#f7f7f8') }}>
                    <td colSpan={boxHeaders.length} style={{
                      padding: '5px 8px', textAlign: 'left', whiteSpace: 'nowrap',
                      borderTop: '1px solid #e8e8e8', borderBottom: '1px solid #f0f0f0',
                      borderLeft: `4px solid ${edge}`,
                    }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                        {selectable && (
                          <input
                            type="checkbox"
                            checked={!!allOn}
                            onChange={() => chunk.orders.forEach(no => onToggleSelect!(no, !allOn))}
                            title={`이 덩어리의 발주서 ${chunk.orders.length}건을 모두 고릅니다`}
                            style={{ cursor: 'pointer', margin: 0 }}
                          />
                        )}
                        <CenterTag name={chunk.center} color={sc.accent} />
                        <DateTag value={chunk.date} />
                        {!!chunk.bundle && (
                          <span style={{
                            padding: '0 6px', fontSize: 11, fontWeight: 700, borderRadius: 8,
                            color: tint, background: `${tint}22`,
                          }}>
                            {bundleLabel ? bundleLabel(chunk.bundle) : chunk.bundle}
                          </span>
                        )}
                        <span style={{ fontSize: 11, color: '#777', fontWeight: 700 }}
                          title="이 덩어리의 발주서 수 · 품목 수 · 수량 합계">
                          발주 {chunk.orders.length} · {chunk.lines}품목 · {chunk.qty.toLocaleString()}개
                        </span>
                        {chunkDone && (
                          <span
                            title="이 덩어리는 쉽먼트 생성까지 끝났어요"
                            style={{
                              padding: '1px 7px', fontSize: 11, fontWeight: 800, borderRadius: 8,
                              color: '#fff', background: DONE, letterSpacing: '-0.2px',
                            }}
                          >
                            쉽먼트 완료 ✓
                          </span>
                        )}
                        {onSortByBox && (
                          <button
                            onClick={onSortByBox}
                            title="박스 번호 순(1번 → 2번 → …)으로 줄을 다시 세웁니다"
                            style={{
                              padding: '1px 6px', fontSize: 11, lineHeight: 1.4,
                              color: '#aaa', background: '#fff', border: '1px solid #ececec',
                              borderRadius: 4, cursor: 'pointer',
                            }}
                          >
                            ↕ 박스순
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>

                  {chunk.boxes.map(box => {
                    const bc = box.no ? boxColor(box.no) : '#b0b4bb';
                    return (
                      <React.Fragment key={`${chunk.key}-${box.no}`}>
                        {/* 박스 머리줄: 이 박스에 들어갈 품목 수와 수량 */}
                        <tr style={{ background: `${bc}12` }}>
                          <td colSpan={boxHeaders.length} style={{
                            padding: '3px 8px', textAlign: 'left', whiteSpace: 'nowrap',
                            borderTop: `1px solid ${bc}33`, borderLeft: `4px solid ${bc}`,
                          }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                              <span style={{
                                padding: '0 7px', fontSize: 11, fontWeight: 800, borderRadius: 8,
                                color: '#fff', background: bc,
                              }}>
                                📦 {box.no ? boxLabel(box.no) : '박스 미지정'}
                              </span>
                              <span style={{ fontSize: 11, color: '#888', fontWeight: 700 }}
                                title="이 박스에 들어가는 품목 수와 수량 합계">
                                {box.rows.length}품목 · {box.qty.toLocaleString()}개
                              </span>
                            </span>
                          </td>
                        </tr>

                        {box.rows.map(row => {
                          const done = !!doneOrders?.has(row._발주번호);
                          const bg = done ? DONE_BG : (tint ? `${tint}0f` : '#fff');
                          return (
                            <tr
                              key={row.id}
                              style={{ borderBottom: '1px solid #ebebeb', background: bg }}
                              onMouseEnter={e => (e.currentTarget.style.background = done ? DONE_HOVER : sc.rowHover)}
                              onMouseLeave={e => (e.currentTarget.style.background = bg)}
                            >
                              <td style={{
                                ...cs(0), textAlign: 'left', minWidth: 210, padding: '5px 6px',
                                borderLeft: `4px solid ${bc}`, fontSize: 13,
                              }}>{row.상품이름}</td>
                              <td style={narrow(38)}>{row.확정수량 !== '' ? row.확정수량 : ''}</td>
                              {officeQtyOf && <OfficeCell match={officeQtyOf(row.상품이름)} need={Number(row.확정수량) || 0} />}
                              <td style={{ ...cs(64), padding: '4px 4px' }}>
                                {readOnly ? (
                                  <span style={{ fontSize: 12, color: '#666' }}>{row.메모}</span>
                                ) : (
                                  <MemoButton value={row.메모} onChange={(v) => onMemoChange(row.id, v)} withHanjung={false} showCode={colorScheme === 'green'} />
                                )}
                              </td>
                              <td style={{ ...cs(76), padding: '4px 4px' }}>
                                {readOnly ? (
                                  <span style={{ fontSize: 12, color: '#666' }}>{row.쉼먼트}</span>
                                ) : (
                                  <BoxButton value={row.쉼먼트} onChange={(v) => onShipmentChange(row.id, v)} />
                                )}
                              </td>
                              <td style={{ ...cs(92), color: '#8a8f98', fontWeight: 700 }} title="이 상품이 들어 있는 발주서">
                                {row._발주번호}
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
                        })}
                      </React.Fragment>
                    );
                  })}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

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
            // 쉽먼트까지 끝난 줄: 글자는 그대로 읽히게 두고 바탕만 연한 초록으로, 왼쪽 띠도 초록으로 바꾼다.
            const done = !!doneOrders?.has(row._발주번호);
            const edge = done ? DONE : tint;
            const bg = done ? DONE_BG : (tint ? `${tint}0f` : '#fff');
            // 발주번호가 찍히는 줄이 그 발주서의 첫 줄이다(아래 줄들은 같은 발주서라 번호를 비워 둔다).
            const isOrderHead = !!row.발주번호;
            // 묶음에서 고른 센터·입고예정일이 아직 이 발주서에 안 옮겨졌으면 "적용 대기".
            const pending = !!row.묶음 && (
              (!!row.묶음센터 && row.묶음센터.trim() !== (row._물류센터 || '').trim()) ||
              (!!row.묶음일자 && row.묶음일자 !== dateKeyYMD(row._입고예정일))
            );
            const head = isOrderHead ? (
              <tr key={`${row.id}-head`} style={{ background: done ? DONE_HEAD_BG : (tint ? `${tint}1c` : '#f7f7f8') }}>
                <td colSpan={headers.length} style={{
                  padding: '4px 8px', borderTop: '1px solid #e8e8e8', borderBottom: '1px solid #f0f0f0',
                  borderLeft: edge ? `4px solid ${edge}` : undefined,
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
                    {lineSelectable && (() => {
                      const ids = lineIdsByOrder.get(row._발주번호) || [];
                      const on = ids.length > 0 && ids.every(id => selectedLines?.has(id));
                      return (
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => ids.forEach(id => onToggleLine!(id, !on))}
                          style={{ cursor: 'pointer', margin: 0 }}
                          title="이 발주서의 상품 줄을 모두 고릅니다"
                        />
                      );
                    })()}
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#333' }}>{row._발주번호}</span>
                    {newOrders?.has(row._발주번호) && (
                      <span
                        title="최근 24시간 안에 새로 들어온 발주서"
                        style={{
                          padding: '1px 6px', fontSize: 10, fontWeight: 800, borderRadius: 4,
                          color: '#fff', background: '#ef4444', letterSpacing: '0.5px',
                        }}
                      >
                        NEW
                      </span>
                    )}
                    <CenterTag name={(row._물류센터 || '').trim()} color={sc.accent} />
                    <DateTag value={row._입고예정일} />
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
                        {!hideBox && <button
                          onClick={() => onBulkOrder(row._발주번호, { 쉼먼트: boxLabel(1) })}
                          title="이 발주서의 상품을 모두 박스 1번으로 지정합니다"
                          style={bulkBtn('#e67e22')}
                        >
                          전체박스
                        </button>}
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
                style={{ borderBottom: '1px solid #ebebeb', background: bg }}
                onMouseEnter={e => (e.currentTarget.style.background = done ? DONE_HOVER : sc.rowHover)}
                onMouseLeave={e => (e.currentTarget.style.background = bg)}
              >
                {lineSelectable && (
                  <td style={{ ...cs(32), padding: '4px 4px' }}>
                    <input
                      type="checkbox"
                      checked={!!selectedLines?.has(row.id)}
                      onChange={e => onToggleLine!(row.id, e.target.checked)}
                      style={{ cursor: 'pointer', margin: 0 }}
                      title="이 상품 줄을 고릅니다"
                    />
                  </td>
                )}
                <td style={{
                  ...cs(0), textAlign: 'left', minWidth: 210, padding: '5px 6px',
                  borderLeft: lineSelectable ? undefined : (edge ? `4px solid ${edge}` : undefined),
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
                {!hideBox && <td style={{ ...cs(onSortByBox ? 104 : 76), padding: '4px 4px' }}>
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
                </td>}

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
