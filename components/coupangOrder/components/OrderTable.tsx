import React from 'react';
import { useIsMobile } from '../../../utils/useIsMobile';
import { badge as stateBadge } from '../data/useHanjungBadge';
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
  // 있으면 'box' 레이아웃의 박스 칸 옆에 나누기(✂) 버튼을 붙인다. 한 상품을 박스 여러 개에 나눠 담을 때 쓴다.
  onSplitLine?: (id: string) => void;
  // 'box' 레이아웃에서 쉽먼트까지 끝난 덩어리를 머리줄만 남기고 접는다. 묶음 값을 받아 접혔는지 돌려준다.
  isChunkCollapsed?: (bundle: string) => boolean;
  onToggleChunk?: (bundle: string) => void;
  // 있으면 'box' 레이아웃 덩어리 머리줄의 입고예정일을 눌러 바꿀 수 있다. 묶음 값을 받는다.
  onEditChunkDate?: (bundle: string) => void;
  // 있으면 'box' 레이아웃 덩어리 머리줄 끝에 붙일 것(쉽먼트생성대기의 요청등록중 버튼). 묶음 값을 받는다.
  chunkExtra?: (bundle: string) => React.ReactNode;
  // 있으면 'box' 레이아웃 박스 머리줄에 그 박스의 운송장번호를 붙인다. 묶음 값과 박스 번호를 받는다.
  boxWaybill?: (bundle: string, boxNo: number) => string;
  // 체크한 뒤 바로 누를 버튼들. actionOrder(발주번호) 머리줄의 체크 칸 옆에 띄운다.
  actionOrder?: string;
  actions?: React.ReactNode;
  // 'box' 레이아웃에서 덩어리 아래 여백을 더 벌릴 양(px). 옆 카드가 덩어리보다 길 때 줄을 맞추려고 쓴다.
  chunkPad?: Record<string, number>;
  // 있으면 예약/대기를 발주서 통째로만 고른다: 상품 줄의 예약 칸을 없애고 발주서 머리줄에 고르는 칸을 둔다.
  onOrderMemoChange?: (orderNo: string, value: string) => void;
  // 예약/대기 고르는 칸을 아예 두지 않는다(쿠팡발주확인에서 예약을 쓰지 않을 때).
  hideMemo?: boolean;
  // 상품 줄 고르기(onToggleLine)를 발주서 머리줄 체크로만 한다(상품 줄마다의 체크 칸을 숨긴다).
  lineSelectByOrder?: boolean;
  // 있으면 상품 줄마다 "한중" 버튼을 둔다(1688 주문 대기로 보내기). isHanjung은 그 줄이 이미 대기에 있는지.
  onToggleHanjung?: (id: string) => void;
  isHanjung?: (row: DisplayRow) => boolean;
  // 있으면 'box' 레이아웃 상품 줄 맨 앞에 "준비" 체크 칸을 둔다(상품이 준비됐는지).
  isReady?: (row: DisplayRow) => boolean;
  onToggleReady?: (row: DisplayRow, on: boolean) => void;
  // 있으면 'box' 레이아웃 체크 칸을 누를 때 "준비됨 / 한중발주"를 고르는 작은 메뉴가 뜬다(쉽먼트생성대기).
  // hanjungOf: 그 줄이 한중 어디에 몇 개씩 있는지와 고를 수 있는 한중발주(여유 포함).
  hanjungOf?: (row: DisplayRow) => LineHanjung;
  onLineHanjung?: (row: DisplayRow, action: HanjungAction) => void;
  // 있으면 'box' 레이아웃 상품이름 옆에 붙일 뱃지(한중 등).
  lineBadge?: (row: DisplayRow) => React.ReactNode;
  // 'box' 레이아웃에서 박스를 번호별 색 대신 이 한 색으로 칠한다(완료 덩어리는 초록). 화면 색을 줄이려고.
  monoBoxes?: string;
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

// 입고예정일 이름표: "10/2 (목)"처럼 크게 쓰고, 옆에 같은 모양으로 D-day를 붙인다(날짜가 지나면 D-day는 뺀다).
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
  const dText = diff < 0 ? '' : diff === 0 ? 'D-DAY' : `D-${diff}`;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <span style={{
        padding: '1px 8px', fontSize: 14, fontWeight: 800, borderRadius: 6,
        color: '#1e293b', background: '#fff', border: '1.5px solid #334155', lineHeight: '18px',
      }}>
        {Number(m[2])}/{Number(m[3])} ({WEEK[day.getDay()]})
      </span>
      {dText && (
        <span style={{
          padding: '1px 8px', fontSize: 14, fontWeight: 800, borderRadius: 6,
          color: '#1e293b', background: '#fff', border: '1.5px solid #334155', lineHeight: '18px',
        }}>
          {dText}
        </span>
      )}
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

// 한 덩어리(같은 센터·입고예정일) 안의 발주서마다 돌아가며 쓰는 색.
const PO_COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#ec4899', '#8b5cf6', '#06b6d4', '#ef4444', '#84cc16'];

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
        style={counterBtnStyle('#fff', c)}
      >−</button>
      <button
        onClick={toggle}
        style={{
          padding: '3px 8px',
          fontSize: 12,
          fontWeight: 700,
          background: '#fff',
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
        style={counterBtnStyle('#fff', c)}
      >+</button>
    </div>
  );
}

/* ── 체크하면 뜨는 작업 툴바 ── */
// 표 안에 끼우면 줄 높이·폭이 바뀌어서, 체크 칸 자리에 크기 없는 표시만 두고 툴바는 화면 위(fixed)에 띄운다.
// 그 줄 바로 위에 붙고, 위가 모자라면 아래에 붙는다. 스크롤하면 따라간다.
function ActionLayer({ children }: { children: React.ReactNode }) {
  const markRef = React.useRef<HTMLSpanElement>(null);
  const barRef = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState<{ left: number; top: number } | null>(null);
  React.useLayoutEffect(() => {
    const place = () => {
      const m = markRef.current?.getBoundingClientRect();
      const h = barRef.current?.offsetHeight || 36;
      if (!m) return;
      // 그 줄이 화면 밖으로 나가면 툴바도 숨긴다.
      if (m.bottom < 60 || m.top > window.innerHeight) { setPos(null); return; }
      const above = m.top - h - 8;
      setPos({ left: Math.max(8, m.left - 10), top: above > 60 ? above : m.bottom + 12 });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, []);
  return (
    <>
      <span ref={markRef} style={{ display: 'inline-block', width: 0, height: 12, verticalAlign: 'middle' }} />
      <style>{`
        .rk-actbar button { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; gap: 6px;
          height: 28px; padding: 0 10px; border-radius: 7px; font-size: 12.5px; font-weight: 600; color: #f3f4f6;
          cursor: pointer; white-space: nowrap; transition: background .12s; }
        .rk-actbar button:hover { background: rgba(255,255,255,0.12); }
        .rk-actbar button.rk-danger { color: #fca5a5; }
        .rk-actbar button.rk-close { padding: 0 8px; color: #9ca3af; }
        .rk-actbar .rk-sep { width: 1px; height: 16px; background: rgba(255,255,255,0.16); margin: 0 3px; }
        .rk-actbar .rk-count { padding: 0 8px 0 6px; font-size: 12px; font-weight: 700; color: #fff; }
        .rk-actbar .rk-dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; }
      `}</style>
      <div
        ref={barRef}
        className="rk-actbar"
        style={{
          position: 'fixed', left: pos?.left ?? -9999, top: pos?.top ?? -9999, zIndex: 50,
          display: 'flex', alignItems: 'center', gap: 2, padding: 4,
          background: '#1f2937', borderRadius: 10,
          boxShadow: '0 10px 28px rgba(15,23,42,0.28), 0 2px 6px rgba(15,23,42,0.18)',
        }}
      >
        {children}
      </div>
    </>
  );
}

/* ── 박스 번호 고르기(드롭다운) ── */
// 쉽먼트생성 표에서 쓴다. 목록에는 이 덩어리에 이미 있는 박스(1 ~ maxNo번)만 나오고,
// 맨 아래 "새 박스"로 다음 번호를 연다. 택배는 센터·입고예정일마다 9박스까지라 9번이 끝이다.
// 표가 가로로 스크롤되는 상자 안에 있어 메뉴가 잘리지 않게 화면 기준(fixed)으로 띄운다.
export function BoxPicker({ value, maxNo, onChange, allowNone = true, color }: {
  value: string; maxNo: number; onChange: (v: string) => void; allowNone?: boolean;
  // 있으면 박스 번호마다 다른 색 대신 이 한 색만 쓴다.
  color?: string;
}) {
  const no = parseBoxNo(value);
  const [menu, setMenu] = React.useState<{ left: number; top: number; up: boolean } | null>(null);
  const btnRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); };
  }, [menu]);

  const top = Math.max(maxNo, no || 0);
  const nos = Array.from({ length: top }, (_, i) => i + 1);
  const next = top + 1;
  const c = no ? (color || boxColor(no)) : '#b0b4bb';
  const pick = (v: string) => { setMenu(null); onChange(v); };
  const open = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const height = (nos.length + 2) * 32 + 12;
    const up = r.bottom + height > window.innerHeight - 8;
    setMenu({ left: r.left, top: up ? r.top - 4 : r.bottom + 4, up });
  };

  const item = (key: string, label: React.ReactNode, onClick: () => void, active = false, color = '#333') => (
    <button
      key={key}
      onClick={onClick}
      onMouseEnter={e => { if (!active) e.currentTarget.style.background = '#f4f5f7'; }}
      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%', height: 30, padding: '0 10px',
        fontSize: 12.5, fontWeight: active ? 800 : 600, color, textAlign: 'left',
        background: active ? '#eef4ff' : 'transparent', border: 'none', borderRadius: 6, cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => (menu ? setMenu(null) : open())}
        title="이 상품을 담을 박스 번호"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 82, justifyContent: 'space-between',
          padding: '3px 8px 3px 9px', fontSize: 12, fontWeight: 800, borderRadius: 14, cursor: 'pointer',
          border: `1.5px solid ${no ? c : '#d5d5d5'}`, background: no ? '#fff' : '#fafafa', color: no ? c : '#aaa',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: c }} />
          {no ? `박스 ${no}번` : '박스'}
        </span>
        <span style={{ fontSize: 9, opacity: 0.8 }}>▼</span>
      </button>
      {menu && (
        <>
          <div onClick={() => setMenu(null)} style={{ position: 'fixed', inset: 0, zIndex: 2000 }} />
          <div style={{
            position: 'fixed', left: menu.left, zIndex: 2001, minWidth: 150, padding: 5,
            ...(menu.up ? { bottom: window.innerHeight - menu.top } : { top: menu.top }),
            background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.14)',
          }}>
            {nos.map(n => item(`b${n}`, (
              <>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: color || boxColor(n) }} />
                박스 {n}번
                {n === no && <span style={{ marginLeft: 'auto', color: '#2563eb' }}>✓</span>}
              </>
            ), () => pick(boxLabel(n)), n === no))}
            {next <= 9 && item('new', <>＋ 새 박스 ({next}번)</>, () => pick(boxLabel(next)), false, '#2563eb')}
            {allowNone && no && (
              <>
                <div style={{ height: 1, background: '#f0f0f0', margin: '4px 2px' }} />
                {item('none', '박스 빼기', () => pick(''), false, '#999')}
              </>
            )}
          </div>
        </>
      )}
    </>
  );
}

// 쉽먼트생성 체크 메뉴의 한중발주 고르기.
//  choices: 고를 수 있는 한중발주. has = 이 상품이 이미 있는 건(여유를 쓸 수 있음), 아니면 새로 넣는 건.
//  places : 이 줄이 지금 맡겨진 곳(code null = 발주 대기)과 수량.
export type HanjungChoice = { code: string; has: boolean; ordered: number; spare: number; arrived: boolean };
//  links: 이름은 다르지만 같은 상품일 수 있는 한중발주 품목(여유가 있는 것, 비슷한 이름 순). 고르면 그 품목 이름을 이 줄 이름으로 바꾸고 배정한다.
export type HanjungLink = { code: string; name: string; ordered: number; spare: number; arrived: boolean };
//  stock: 사무실 재고(도착했고 배정 안 된 여유)에서 이 상품을 쓸 수 있는 수량.
export type LineHanjung = { need: number; places: { code: string | null; qty: number }[]; choices: HanjungChoice[]; links?: HanjungLink[]; stock?: number };
//  queue: 전부 발주 대기로 / order: 그 한중발주에 맡김(whole 전부, split 여유만큼 + 나머지 대기, grow 그 건 주문 수량을 늘려 전부) / remove: 빼기
//  release: 이 줄을 원래 한중발주에서 뗄 때 그 건의 주문 수량을 어떻게 할지
//    shrink = 같이 줄이기(1688에서 안 샀음) / keep = 그대로 두고 여유로 남기기(사 둔 건 그대로)
export type HanjungRelease = 'shrink' | 'keep';
export type HanjungAction = (
  { type: 'queue' } | { type: 'order'; code: string; mode: 'whole' | 'split' | 'grow'; linkFrom?: string } | { type: 'remove' } | { type: 'stock' }
) & { release?: HanjungRelease };

// 상품 줄 체크 칸. 누르면 "준비됨"과 "한중발주" 중에서 고른다(둘 다 켤 수도 있다).
// 한중발주를 누르면 이 상품의 여유가 있는 한중발주를 고르거나, 발주 대기에 담는다.
// 준비됨이든 한중발주든 초록 체크로 보인다.
export function LineCheckMenu({ ready, hanjung, onReady, onHanjung }: {
  ready: boolean; hanjung: LineHanjung; onReady: (on: boolean) => void; onHanjung: (action: HanjungAction) => void;
}) {
  const btnRef = React.useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = React.useState<{ left: number; top: number; up: boolean } | null>(null);
  // 메뉴 화면: main(준비됨/한중발주) → pick(한중발주 고르기) → short(여유가 모자랄 때 어떻게 할지)
  const [view, setView] = React.useState<
    { kind: 'main' } | { kind: 'pick' } | { kind: 'link' } | { kind: 'short'; choice: HanjungChoice; linkFrom?: string }
    | { kind: 'release'; action: HanjungAction; from: { code: string; qty: number }[] }
  >({ kind: 'main' });
  const { need, places, choices } = hanjung;
  const links = hanjung.links || [];
  const open = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const up = r.bottom + 200 + choices.length * 32 > window.innerHeight - 8;
    setView({ kind: 'main' });
    setMenu({ left: r.left, top: up ? r.top - 4 : r.bottom + 4, up });
  };
  const on = ready || places.length > 0;
  const color = '#27ae60';
  const item = (key: string, label: React.ReactNode, onClick: (() => void) | null, color: string, close = true) => (
    <button
      key={key}
      onClick={onClick ? () => { if (close) setMenu(null); onClick(); } : undefined}
      disabled={!onClick}
      onMouseEnter={e => { if (onClick) e.currentTarget.style.background = '#f4f5f7'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%', minHeight: 32, padding: '4px 10px',
        fontSize: 13, fontWeight: 700, color, textAlign: 'left', whiteSpace: 'nowrap',
        background: 'transparent', border: 'none', borderRadius: 6, cursor: onClick ? 'pointer' : 'default',
      }}
    >
      {label}
    </button>
  );
  const line = <div style={{ height: 1, background: '#f0f0f0', margin: '4px 2px' }} />;
  const head = (text: React.ReactNode) => <div style={{ fontSize: 11, color: '#999', padding: '4px 10px 2px', whiteSpace: 'nowrap' }}>{text}</div>;
  const placeText = places.map(p => `${p.code ? p.code : '대기'}${places.length > 1 || p.qty !== need ? ` ×${p.qty}` : ''}`).join(' · ');
  const placeQty = (code: string | null) => places.find(p => p.code === code)?.qty || 0;
  const wholeIn = (code: string | null) => places.length === 1 && places[0].code === code && places[0].qty === need;
  // 이 줄이 이미 맡겨진 한중발주에서 떼게 되는 동작이면, 그 건의 주문 수량을 줄일지 먼저 묻는다.
  const act = (a: HanjungAction) => {
    const from = places
      .filter(p => p.code && !(a.type === 'order' && a.code === p.code))
      .map(p => ({ code: p.code as string, qty: p.qty }));
    if (from.length) { setView({ kind: 'release', action: a, from }); return; }
    setMenu(null);
    onHanjung(a);
  };
  const mine = choices.filter(c => c.has);
  const others = choices.filter(c => !c.has);
  // 한중발주를 골랐을 때: 이 줄이 이미 그 건에 맡긴 수량은 여유로 다시 쓸 수 있다고 보고 계산한다.
  const pick = (c: HanjungChoice) => {
    const free = c.spare + placeQty(c.code);
    if (!c.has || free >= need) { act({ type: 'order', code: c.code, mode: 'whole' }); return; }
    setView({ kind: 'short', choice: c });
  };
  return (
    <>
      <button
        ref={btnRef}
        onClick={() => (menu ? setMenu(null) : open())}
        title={[ready ? '준비됨' : '', placeText ? `한중 ${placeText}` : ''].filter(Boolean).join(' · ') || '눌러서 준비됨 또는 한중발주로 표시'}
        style={{
          width: 18, height: 18, padding: 0, borderRadius: 4, cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 12, fontWeight: 900, lineHeight: 1, color: '#fff',
          border: `1.5px solid ${on ? color : '#b5b5b5'}`, background: on ? color : '#fff',
        }}
      >
        {on ? '✓' : ''}
      </button>
      {menu && (
        <>
          <div onClick={() => setMenu(null)} style={{ position: 'fixed', inset: 0, zIndex: 2000 }} />
          <div style={{
            position: 'fixed', left: menu.left, zIndex: 2001, minWidth: 230, maxHeight: '70vh', overflowY: 'auto', padding: 5,
            ...(menu.up ? { bottom: window.innerHeight - menu.top } : { top: menu.top }),
            background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.14)',
          }}>
            {view.kind === 'main' && (
              <>
                {ready
                  ? item('ready', '준비됨 풀기', () => onReady(false), '#999')
                  : item('ready', <><span>✓</span> 준비됨</>, () => onReady(true), '#27ae60')}
                {/* 재고에서 쓰기: 오래된 한중발주 여유부터 자동 배정 → 사무실 재고에서 빠진다. */}
                {!places.length && (hanjung.stock || 0) > 0 && item('stock', (
                  <>
                    <span>📦</span> 재고에서 쓰기
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: (hanjung.stock || 0) >= need ? '#94a3b8' : '#dc2626' }}>
                      사무실 {hanjung.stock}{(hanjung.stock || 0) < need ? ` · ${need - (hanjung.stock || 0)}개 모자람` : ''}
                    </span>
                  </>
                ), () => onHanjung({ type: 'stock' }), '#27ae60')}
                {item('hj', (
                  <>
                    <span>＋</span> 한중발주
                    {placeText && <span style={{ marginLeft: 'auto', fontSize: 11, color: '#94a3b8' }}>{placeText}</span>}
                    <span style={{ marginLeft: placeText ? 4 : 'auto', fontSize: 10 }}>▶</span>
                  </>
                ), () => setView({ kind: 'pick' }), '#27ae60', false)}
              </>
            )}

            {view.kind === 'pick' && (
              <>
                {item('back', <>◀ 뒤로<span style={{ marginLeft: 'auto', fontSize: 11, color: '#999' }}>이 줄: {need}개</span></>, () => setView({ kind: 'main' }), '#999', false)}
                {line}
                {head('이 상품이 있는 한중발주')}
                {mine.map(c => {
                  const free = c.spare + placeQty(c.code);
                  return item(`c${c.code}`, (
                    <>
                      <span style={{ fontFamily: 'monospace' }}>{c.code}</span>
                      <span style={{ fontSize: 11, color: '#888', fontWeight: 600 }}>주문 {c.ordered} · 여유 <b style={{ color: free >= need ? '#27ae60' : '#dc2626' }}>{free}</b></span>
                      <span style={{ marginLeft: 'auto', fontSize: 11, color: c.arrived ? '#27ae60' : '#d97706' }}>{c.arrived ? '도착' : '입고중'}</span>
                      {free < need && <span style={{ fontSize: 11, color: '#dc2626' }}>⚠ 부족</span>}
                      {wholeIn(c.code) && <span>✓</span>}
                    </>
                  ), wholeIn(c.code) ? null : () => pick(c), '#333', false);
                })}
                {!mine.length && head(<span style={{ color: '#bbb' }}>이 상품이 있는 한중발주가 없어요</span>)}
                {others.length > 0 && (
                  <>
                    {line}
                    {head('다른 한중발주에 새로 넣기(1688에 추가 주문)')}
                    {others.map(c => item(`o${c.code}`, (
                      <>
                        <span style={{ fontFamily: 'monospace' }}>{c.code}</span>
                        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#999', fontWeight: 600 }}>이 상품 없음</span>
                      </>
                    ), () => pick(c), '#555', false))}
                  </>
                )}
                {links.length > 0 && (
                  <>
                    {line}
                    {item('link', <>이름이 다른 같은 상품에 연결<span style={{ marginLeft: 'auto', fontSize: 10 }}>▶</span></>, () => setView({ kind: 'link' }), '#2563eb', false)}
                  </>
                )}
                {line}
                {item('queue', (
                  <>
                    발주 대기에 담기(새로 주문)
                    {wholeIn(null) && <span style={{ marginLeft: 'auto' }}>✓</span>}
                  </>
                ), wholeIn(null) ? null : () => act({ type: 'queue' }), '#555', false)}
                {places.length > 0 && item('out', '한중에서 빼기', () => act({ type: 'remove' }), '#dc2626', false)}
              </>
            )}

            {view.kind === 'link' && (
              <>
                {item('back', <>◀ 뒤로<span style={{ marginLeft: 'auto', fontSize: 11, color: '#999' }}>이 줄: {need}개</span></>, () => setView({ kind: 'pick' }), '#999', false)}
                {line}
                {head('한중발주에 이름이 다르게 적힌 품목 · 같은 상품이면 골라요')}
                {head(<span style={{ color: '#bbb' }}>고르면 그 품목 이름이 이 상품 이름으로 바뀌어요</span>)}
                {links.map(lk => item(`l${lk.code}${lk.name}`, (
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, maxWidth: 360 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }} title={lk.name}>{lk.name}</span>
                    <span style={{ fontSize: 11, color: '#888', fontWeight: 600 }}>
                      <span style={{ fontFamily: 'monospace' }}>{lk.code}</span> · 주문 {lk.ordered} · 여유 <b style={{ color: lk.spare >= need ? '#27ae60' : '#dc2626' }}>{lk.spare}</b> · {lk.arrived ? '도착' : '입고중'}
                    </span>
                  </span>
                ), () => {
                  if (lk.spare >= need) act({ type: 'order', code: lk.code, mode: 'whole', linkFrom: lk.name });
                  else setView({ kind: 'short', choice: { code: lk.code, has: true, ordered: lk.ordered, spare: lk.spare, arrived: lk.arrived }, linkFrom: lk.name });
                }, '#333', false))}
              </>
            )}

            {view.kind === 'short' && (() => {
              const c = view.choice;
              const linkFrom = view.linkFrom;
              const free = c.spare + placeQty(c.code);
              const lack = need - free;
              return (
                <>
                  {item('back', '◀ 뒤로', () => setView({ kind: 'pick' }), '#999', false)}
                  {line}
                  <div style={{ fontSize: 12.5, color: '#333', padding: '4px 10px 6px', lineHeight: 1.5, whiteSpace: 'nowrap' }}>
                    <b style={{ fontFamily: 'monospace' }}>{c.code}</b> 여유가 <b>{free}</b>개뿐이에요.<br />이 줄은 <b>{need}</b>개 필요해요.
                  </div>
                  {free > 0 && item('split', <>① {free}개는 {c.code}에서, 모자란 {lack}개는 발주 대기</>, () => act({ type: 'order', code: c.code, mode: 'split', linkFrom }), '#27ae60', false)}
                  {item('grow', <>② {c.code}에 {lack}개 더 주문했어요</>, () => act({ type: 'order', code: c.code, mode: 'grow', linkFrom }), '#555', false)}
                  {item('cancel', '취소', () => setView({ kind: 'pick' }), '#999', false)}
                </>
              );
            })()}

            {view.kind === 'release' && (() => {
              const { action, from } = view;
              const done = (release: HanjungRelease) => { setMenu(null); onHanjung({ ...action, release }); };
              const where = from.map(f => `${f.code}(${f.qty}개)`).join(', ');
              return (
                <>
                  {item('back', '◀ 뒤로', () => setView({ kind: 'pick' }), '#999', false)}
                  {line}
                  <div style={{ fontSize: 12.5, color: '#333', padding: '4px 10px 6px', lineHeight: 1.5, whiteSpace: 'nowrap' }}>
                    이 줄을 <b style={{ fontFamily: 'monospace' }}>{where}</b>에서 빼요.<br />그 한중발주의 주문 수량은 어떻게 할까요?
                  </div>
                  {item('shrink', <>주문 수량도 줄이기 <span style={{ fontSize: 11, color: '#999', fontWeight: 600 }}>1688에서 안 샀어요</span></>, () => done('shrink'), '#dc2626')}
                  {item('keep', <>여유로 남기기 <span style={{ fontSize: 11, color: '#999', fontWeight: 600 }}>사 둔 건 그대로</span></>, () => done('keep'), '#27ae60')}
                </>
              );
            })()}
          </div>
        </>
      )}
    </>
  );
}

// "발주 N"에 마우스를 올리면 발주번호 목록이 뜨고, 번호를 누르면 클립보드에 복사된다.
function OrderNosHover({ orders }: { orders: string[] }) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const hideTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pos, setPos] = React.useState<{ left: number; top: number } | null>(null);
  const [copied, setCopied] = React.useState('');
  const show = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ left: r.left, top: r.bottom + 2 });
  };
  // 목록으로 마우스를 옮기는 사이에 닫히지 않게 조금 기다렸다 닫는다.
  const hide = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => { setPos(null); setCopied(''); }, 200);
  };
  const copy = (text: string, label: string) => {
    const done = () => setCopied(label);
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done).catch(() => alert('복사하지 못했어요.'));
    else {
      const t = document.createElement('textarea');
      t.value = text;
      document.body.appendChild(t);
      t.select();
      document.execCommand('copy');
      t.remove();
      done();
    }
  };
  const row = (key: string, label: React.ReactNode, onClick: () => void, on: boolean) => (
    <button
      key={key}
      onClick={onClick}
      onMouseEnter={e => (e.currentTarget.style.background = '#f4f5f7')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '4px 8px',
        fontSize: 12.5, fontWeight: 700, color: '#333', textAlign: 'left', whiteSpace: 'nowrap',
        background: 'transparent', border: 'none', borderRadius: 5, cursor: 'pointer',
      }}
    >
      {label}
      <span style={{ marginLeft: 'auto', fontSize: 11, color: on ? '#27ae60' : '#bbb' }}>{on ? '✓ 복사됨' : '복사'}</span>
    </button>
  );
  return (
    <>
      <span ref={ref} onMouseEnter={show} onMouseLeave={hide} style={{ cursor: 'default', textDecoration: 'underline dotted' }}>
        발주 {orders.length}
      </span>
      {pos && (
        <div
          onMouseEnter={show}
          onMouseLeave={hide}
          style={{
            position: 'fixed', left: pos.left, top: pos.top, zIndex: 2001, minWidth: 170, maxHeight: '60vh', overflowY: 'auto',
            padding: 5, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.14)',
          }}
        >
          <div style={{ fontSize: 11, color: '#999', padding: '2px 8px 4px' }}>발주번호 · 누르면 복사</div>
          {orders.map(no => row(no, <span style={{ fontFamily: 'monospace' }}>{no}</span>, () => copy(no, no), copied === no))}
          {orders.length > 1 && (
            <>
              <div style={{ height: 1, background: '#f0f0f0', margin: '4px 2px' }} />
              {row('all', `전체 ${orders.length}개`, () => copy(orders.join('\n'), 'all'), copied === 'all')}
            </>
          )}
        </div>
      )}
    </>
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
  // 한중 여유로 계산한 값(incoming이 있음): 도착한 여유와 오는 중인 여유를 같이 보여준다.
  if (match.incoming != null) {
    const arrived = match.qty || 0;
    const incoming = match.incoming;
    const color = arrived >= need ? '#2d7a4f' : arrived + incoming >= need ? '#d97706' : arrived + incoming > 0 ? '#c0392b' : '#ccc';
    const title = arrived + incoming > 0
      ? `사무실 재고(한중 여유) · 도착 ${arrived}개${incoming ? ` · 오는 중 ${incoming}개` : ''}\n${match.names.join('\n')}`
      : '한중으로 넉넉히 사 둔 여유가 없어요';
    return (
      <td style={{ ...narrow(42), color, fontWeight: 700, whiteSpace: 'nowrap' }} title={title}>
        {arrived + incoming > 0 ? arrived.toLocaleString() : '-'}
        {incoming > 0 && <span style={{ fontSize: 10, fontWeight: 600, color: '#d97706' }}> +{incoming}</span>}
      </td>
    );
  }
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
export default function OrderTable({ rows, onMemoChange, onShipmentChange, colorScheme = 'pink', readOnly = false, onDelete, officeQtyOf, selectedOrders, onToggleSelect, onBulkOrder, doneOrders, onSortByBox, bundleLabel, bundleColorOf, layout = 'order', selectedLines, onToggleLine, hideBox = false, newOrders, onSplitLine, isChunkCollapsed, onToggleChunk, onEditChunkDate, chunkExtra, boxWaybill, actionOrder, actions, chunkPad, monoBoxes, onOrderMemoChange, hideMemo, lineSelectByOrder, onToggleHanjung, isHanjung, isReady, onToggleReady, hanjungOf, onLineHanjung, lineBadge }: Props) {
  // 휴대폰에서는 머리줄을 여러 줄로 접고 상품이름 칸을 좁혀 표가 화면 안에 들어오게 한다.
  const isMobile = useIsMobile();
  const headWrap: React.CSSProperties['whiteSpace'] = isMobile ? 'normal' : 'nowrap';
  const nameMin = isMobile ? 120 : 210;
  if (rows.length === 0) return null;

  const sc = SCHEME[colorScheme];
  const selectable = !!onToggleSelect;
  // 상품 줄마다 체크 칸을 두는지(발주서 단위로만 고르면 머리줄 체크만 둔다).
  const lineSelectable = !!onToggleLine && !lineSelectByOrder;
  const orderMemo = !!onOrderMemoChange;
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
    ...(onToggleReady ? ['준비'] : []),
    '상품이름', '확정수량',
    ...(officeQtyOf ? ['사무실'] : []),
    ...(orderMemo || hideMemo ? [] : ['예약']), ...(onToggleHanjung ? ['한중'] : []), ...(hideBox ? [] : ['박스']), ...(onDelete ? ['삭제'] : []),
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
      ...(onToggleReady ? ['준비'] : []),
      '상품이름', '확정수량',
      ...(officeQtyOf ? ['사무실'] : []),
      '박스', '발주번호', ...(onDelete ? ['삭제'] : []),
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
              const canFold = chunkDone && !!chunk.bundle && !!onToggleChunk;
              // 이 덩어리에 만들어진 박스 중 가장 큰 번호. 드롭다운은 여기까지만 보여준다.
              const chunkMaxBox = Math.max(0, ...chunk.boxes.map(b => b.no));
              const folded = canFold && !!isChunkCollapsed?.(chunk.bundle);
              return (
                <React.Fragment key={chunk.key}>
                  {ci > 0 && (
                    <tr>
                      <td colSpan={boxHeaders.length} style={{
                        // 덩어리끼리는 한눈에 끊겨 보이게 흰 여백으로 띄운다(옆 카드가 길면 그만큼 더).
                        height: 26 + (chunkPad?.[chunks[ci - 1].bundle || chunks[ci - 1].key] || 0),
                        background: '#fff', border: 'none', padding: 0,
                      }} />
                    </tr>
                  )}

                  {/* 덩어리 머리줄: 센터·입고예정일·묶음·전체선택·완료 */}
                  {/* data-chunk: 오른쪽 묶음 카드가 이 덩어리 옆에서만 따라오게 바깥에서 높이를 재는 표시다. */}
                  <tr data-chunk={chunk.bundle || chunk.key} style={{ background: chunkDone ? DONE_HEAD_BG : (tint ? `${tint}1c` : '#f7f7f8') }}>
                    <td colSpan={boxHeaders.length} style={{
                      padding: '5px 8px', textAlign: 'left', whiteSpace: headWrap,
                      borderTop: '1px solid #e8e8e8', borderBottom: '1px solid #f0f0f0',
                      borderLeft: `4px solid ${edge}`,
                    }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', flexWrap: isMobile ? 'wrap' : 'nowrap', gap: 7 }}>
                        {canFold && (
                          <button
                            onClick={() => onToggleChunk!(chunk.bundle)}
                            title={folded ? '펼쳐서 박스·상품 보기' : '접기'}
                            style={{
                              width: 20, padding: 0, fontSize: 11, lineHeight: '18px',
                              color: DONE, background: '#fff', border: `1px solid ${DONE}55`,
                              borderRadius: 4, cursor: 'pointer',
                            }}
                          >
                            {folded ? '▸' : '▾'}
                          </button>
                        )}
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
                        {onEditChunkDate && chunk.bundle ? (
                          <span
                            onClick={() => onEditChunkDate(chunk.bundle)}
                            title="눌러서 입고예정일 바꾸기"
                            style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3 }}
                          >
                            <DateTag value={chunk.date} />
                            <span style={{ fontSize: 11, color: '#999' }}>✎</span>
                          </span>
                        ) : (
                          <DateTag value={chunk.date} />
                        )}
                        {/* 묶음 이름·완료·박스 수는 오른쪽 카드에 있어 여기서는 뺀다(같은 정보가 두 번 보이지 않게). */}
                        <span style={{ fontSize: 11, color: '#777', fontWeight: 700 }}>
                          <OrderNosHover orders={chunk.orders} /> · {chunk.lines}품목 · {chunk.qty.toLocaleString()}개
                        </span>
                        {onSortByBox && !folded && (
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
                        {chunkExtra && chunk.bundle && chunkExtra(chunk.bundle)}
                      </span>
                    </td>
                  </tr>

                  {!folded && chunk.boxes.map(box => {
                    const bc = monoBoxes ? (chunkDone ? DONE : monoBoxes) : box.no ? boxColor(box.no) : '#b0b4bb';
                    return (
                      <React.Fragment key={`${chunk.key}-${box.no}`}>
                        {/* 박스 머리줄: 이 박스에 들어갈 품목 수와 수량 */}
                        <tr style={{ background: `${bc}12` }}>
                          <td colSpan={boxHeaders.length} style={{
                            padding: '3px 8px', textAlign: 'left', whiteSpace: headWrap,
                            borderTop: `1px solid ${bc}33`, borderLeft: `4px solid ${bc}`,
                          }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                              <span style={{
                                padding: '0 7px', fontSize: 11, fontWeight: 800, borderRadius: 8,
                                color: bc, background: '#fff', border: `1.5px solid ${bc}`,
                              }}>
                                📦 {box.no ? boxLabel(box.no) : '박스 미지정'}
                              </span>
                              <span style={{ fontSize: 11, color: '#888', fontWeight: 700 }}
                                title="이 박스에 들어가는 품목 수와 수량 합계">
                                {box.rows.length}품목 · {box.qty.toLocaleString()}개
                              </span>
                              {(() => {
                                const wb = box.no && chunk.bundle && boxWaybill ? boxWaybill(chunk.bundle, box.no) : '';
                                return wb ? (
                                  <span style={{ fontSize: 11, fontWeight: 800, color: '#333', fontFamily: 'monospace' }} title="이 박스의 롯데 운송장번호">
                                    🚚 {wb}
                                  </span>
                                ) : null;
                              })()}
                            </span>
                          </td>
                        </tr>

                        {box.rows.map(row => {
                          const done = !!doneOrders?.has(row._발주번호);
                          const ready = !!isReady?.(row);
                          // 한중발주로 넘긴 줄(준비 안 됨)은 흰 바탕·검정 글자로 준비됨과 구분한다.
                          const hanjung = !!hanjungOf?.(row)?.places.length;
                          const bg = done ? DONE_BG : ready ? '#e2f4e9' : hanjung ? '#fff' : (tint ? `${tint}0f` : '#fff');
                          return (
                            <tr
                              key={row.id}
                              style={{ borderBottom: '1px solid #ebebeb', background: bg }}
                              onMouseEnter={e => (e.currentTarget.style.background = done ? DONE_HOVER : sc.rowHover)}
                              onMouseLeave={e => (e.currentTarget.style.background = bg)}
                            >
                              {onToggleReady && (
                                <td style={{ ...cs(40), padding: '4px 4px', borderLeft: `4px solid ${bc}` }}>
                                  {onLineHanjung ? (
                                    <LineCheckMenu
                                      ready={ready}
                                      hanjung={hanjungOf?.(row) || { need: 0, places: [], choices: [] }}
                                      onReady={on => onToggleReady(row, on)}
                                      onHanjung={action => onLineHanjung(row, action)}
                                    />
                                  ) : (
                                    <input
                                      type="checkbox"
                                      checked={ready}
                                      onChange={e => onToggleReady(row, e.target.checked)}
                                      title="상품이 준비됐으면 체크하세요(발송대기에서도 그대로 보여요)"
                                      style={{ width: 16, height: 16, margin: 0, cursor: 'pointer', accentColor: '#27ae60' }}
                                    />
                                  )}
                                </td>
                              )}
                              {/* 상품이름은 한 줄로 두고 넘치면 …로 자른다. 뱃지(준비됨·한중)는 늘 같은 줄 오른쪽 끝.
                                  maxWidth 0 + width 100%: 남는 폭만 쓰게 해서 표가 글자 길이만큼 늘어나지 않게 한다. */}
                              <td title={row.상품이름} style={{
                                ...cs(0), textAlign: 'left', minWidth: nameMin, maxWidth: 0, width: '100%', padding: '5px 6px',
                                borderLeft: onToggleReady ? undefined : `4px solid ${bc}`, fontSize: 13,
                                color: ready ? '#6b8f78' : hanjung ? '#111' : undefined,
                              }}>
                                {/* 칸이 좁으면 상품이름을 먼저 줄이고(최소 몇 글자는 남김), 그래도 넘치면 뱃지 끝이 잘린다(옆 칸을 덮지 않게). */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden' }}>
                                  <span style={{ flex: '1 1 auto', minWidth: 56, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.상품이름}</span>
                                  <span style={{ flex: '0 1 auto', minWidth: 0, overflow: 'hidden', display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>
                                    {ready && !hanjung && <span style={stateBadge('#27ae60', true)}>준비됨</span>}{lineBadge?.(row)}
                                  </span>
                                </div>
                              </td>
                              <td style={narrow(38)} title={row._조각 !== undefined ? `전체 ${row._원수량}개 중 이 박스에 담는 수량` : undefined}>
                                {row.확정수량 !== '' ? row.확정수량 : ''}
                                {row._조각 !== undefined && <div style={{ fontSize: 10, color: '#aaa' }}>/{row._원수량}</div>}
                              </td>
                              {officeQtyOf && <OfficeCell match={officeQtyOf(row.상품이름)} need={Number(row._원수량 ?? row.확정수량) || 0} />}
                              <td style={{ ...cs(76), padding: '4px 4px', whiteSpace: 'nowrap' }}>
                                {readOnly ? (
                                  <span style={{ fontSize: 12, color: '#666' }}>{row.쉼먼트}</span>
                                ) : (
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                    <BoxPicker value={row.쉼먼트} maxNo={chunkMaxBox} color={monoBoxes ? bc : undefined} onChange={(v) => onShipmentChange(row.id, v)} />
                                    {/* 나눌 수 없는 줄(1개)도 자리는 비워 둬서 드롭다운 줄이 맞게 한다. */}
                                    {onSplitLine && (
                                      <button
                                        onClick={() => onSplitLine(row.id)}
                                        disabled={(Number(row.확정수량) || 0) < 2 && row._조각 === undefined}
                                        title="이 상품을 박스 여러 개에 나눠 담습니다(박스마다 수량 입력)"
                                        style={{
                                          padding: '2px 6px', fontSize: 12, lineHeight: 1.3,
                                          color: '#888', background: '#fff', border: '1px solid #ddd',
                                          borderRadius: 5, cursor: 'pointer',
                                          visibility: (Number(row.확정수량) || 0) >= 2 || row._조각 !== undefined ? 'visible' : 'hidden',
                                        }}
                                      >
                                        ✂
                                      </button>
                                    )}
                                  </span>
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
            {(() => {
              const last = chunks[chunks.length - 1];
              const pad = last ? chunkPad?.[last.bundle || last.key] || 0 : 0;
              return pad > 0 ? (
                <tr><td colSpan={boxHeaders.length} style={{ height: pad, background: '#fff', border: 'none', padding: 0 }} /></tr>
              ) : null;
            })()}
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

            const bundleTint = row.묶음 ? (bundleColorOf ? bundleColorOf(row.묶음) : bundleColor(row.묶음)) : '';
            // 묶음이 아니면 같은 센터·입고예정일 덩어리 안에서 발주서마다 다른 색을 준다(발주서끼리 한눈에 나뉘게).
            const poIdx = (ordersByGroup.get(row.groupKey) || []).indexOf(row._발주번호);
            const tint = bundleTint || (poIdx >= 0 ? PO_COLORS[poIdx % PO_COLORS.length] : '');
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
                  whiteSpace: headWrap,
                }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', flexWrap: isMobile ? 'wrap' : 'nowrap', gap: 7 }}>
                    {selectable && (
                      <input
                        type="checkbox"
                        checked={!!selectedOrders?.has(row._발주번호)}
                        onChange={e => onToggleSelect!(row._발주번호, e.target.checked)}
                        style={{ cursor: 'pointer', margin: 0 }}
                        title="이 발주서를 묶음에 담을 후보로 고릅니다"
                      />
                    )}
                    {!!onToggleLine && (() => {
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
                    {orderMemo && !readOnly && (
                      <MemoButton value={row.메모} onChange={(v) => onOrderMemoChange!(row._발주번호, v)} withHanjung={false} showCode={false} />
                    )}
                    {!!actions && actionOrder === row._발주번호 && <ActionLayer>{actions}</ActionLayer>}
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
                {onToggleReady && (() => {
                  const ready = !!isReady?.(row);
                  return (
                    <td style={{ ...cs(40), padding: '4px 4px', borderLeft: lineSelectable ? undefined : (edge ? `4px solid ${edge}` : undefined), background: ready ? '#eaf8ef' : undefined }}>
                      <input
                        type="checkbox"
                        checked={ready}
                        onChange={e => onToggleReady(row, e.target.checked)}
                        title="상품이 준비됐으면 체크하세요(쉽먼트생성대기·발송대기에서도 그대로 보여요)"
                        style={{ width: 16, height: 16, margin: 0, cursor: 'pointer', accentColor: '#27ae60' }}
                      />
                    </td>
                  );
                })()}
                <td style={{
                  ...cs(0), textAlign: 'left', minWidth: nameMin, padding: '5px 6px',
                  borderLeft: lineSelectable || onToggleReady ? undefined : (edge ? `4px solid ${edge}` : undefined),
                  color: isReady?.(row) ? '#6b8f78' : undefined,
                }}>{row.상품이름}{isReady?.(row) && <span style={stateBadge('#27ae60', true)}>준비됨</span>}</td>
                <td style={narrow(38)}>{row.확정수량 !== '' ? row.확정수량 : ''}</td>
                {officeQtyOf && <OfficeCell match={officeQtyOf(row.상품이름)} need={Number(row.확정수량) || 0} />}

                {/* 예약(예전 이름은 메모 칸). 발주서 단위로 고를 때는 머리줄에 있다. */}
                {!orderMemo && !hideMemo && <td style={{ ...cs(64), padding: '4px 4px' }}>
                  {readOnly ? (
                    <span style={{ fontSize: 12, color: '#666' }}>{row.메모}</span>
                  ) : (
                    <MemoButton value={row.메모} onChange={(v) => onMemoChange(row.id, v)} withHanjung={false} showCode={colorScheme === 'green'} />
                  )}
                </td>}

                {/* 한중: 누르면 한중발주의 발주 대기로 보낸다(이 줄은 발송 목록에 그대로 남는다). */}
                {onToggleHanjung && (() => {
                  const on = !!isHanjung?.(row);
                  return (
                    <td style={{ ...cs(58), padding: '4px 4px' }}>
                      <button
                        onClick={() => onToggleHanjung(row.id)}
                        title={on ? '한중발주 대기에 들어가 있어요. 누르면 대기에서 뺍니다.' : '1688 주문할 상품이면 누르세요. 한중발주의 발주 대기로 갑니다.'}
                        style={{
                          padding: '2px 8px', fontSize: 12, fontWeight: 700, borderRadius: 5, cursor: 'pointer', whiteSpace: 'nowrap',
                          border: `1.5px solid ${on ? '#2563eb' : '#d5d5d5'}`, background: on ? '#eff6ff' : '#fafafa', color: on ? '#2563eb' : '#999',
                        }}
                      >
                        {on ? '한중 ✓' : '한중'}
                      </button>
                    </td>
                  );
                })()}

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
                      title="이 줄 삭제"
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
