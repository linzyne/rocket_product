import { useState } from 'react';
import type { DisplayRow } from '../utils/dataProcessor';
import { parseBoxNo, boxLabel } from '../utils/dataProcessor';
import { bundleColor } from './OrderTable';
import { dateKeyYMD, ymdSortKey } from '../utils/dateUtils';

interface Props {
  // 발송 목록 전체. 이 중 묶음이 붙은 줄만 골라 보여준다.
  rows: DisplayRow[];
  // 묶음 하나를 통째로 박스 지정/해제한다(묶음 = 택배 한 상자).
  onBoxChange: (bundle: string, value: string) => void;
  // 묶음 자체를 없앤다(줄은 발송 목록에 그대로 남는다).
  onUnbundle: (bundle: string) => void;
  // 발주서 하나만 묶음에서 뺀다(묶기는 발주서 단위다).
  onRemoveOrder: (orderNo: string) => void;
  // 지금 발송 목록에서 체크해 둔 발주서 수. 0보다 크면 카드마다 "+담기" 버튼이 뜬다.
  selectedCount: number;
  // 체크해 둔 발주서들을 이미 있는 묶음에 더 담는다.
  onAddSelected: (bundle: string) => void;
  // 일 다 본 묶음들. 여기 든 묶음은 카드 불이 꺼진다(흐리게).
  doneBundles: Set<string>;
  onToggleDone: (bundle: string) => void;
  // 택배를 보낼 물류센터를 직접 고를 때 쓰는 목록(택배주소 관리에 등록된 센터 + 지금 발주서에 있는 센터).
  centerOptions: string[];
  onCenterChange: (bundle: string, center: string) => void;
  // 묶음에서 새로 잡은 입고예정일('YYYY-MM-DD').
  onDateChange: (bundle: string, ymd: string) => void;
  // 고른 센터·입고예정일을 이 묶음의 발주서들에 그대로 덮어쓴다.
  onApply: (bundle: string) => void;
  // 이 묶음을 발주 > 쉽먼트생성으로 넘긴다.
  onShipOut: (bundle: string) => void;
}

// 9/28처럼 짧게. 묶음 카드에서는 연도까지 볼 일이 없다.
function shortDate(v: Date | string): string {
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v || '');
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/* ── 발주 > 쿠팡발주확인 가운데 패널(묶음) ──
   여러 발주서를 한 택배로 보낼 때, 발송 목록에서 발주번호마다 하나씩 있는 체크 칸으로 골라
   "묶기"로 담은 발주서들을 묶음별 카드로 보여준다.
   한눈에 들어오는 게 목적이라 발주서는 한 줄씩만 보여주고, 상품 목록은 그 줄을 눌러야 펼쳐진다.
   묶음에 박스를 지정하면 발주번호·입고예정일이 달라도 쉽먼트생성에서 상자 하나로 센다. */
export default function BundlePanel({ rows, onBoxChange, onUnbundle, onRemoveOrder, selectedCount, onAddSelected, doneBundles, onToggleDone, centerOptions, onCenterChange, onDateChange, onApply, onShipOut }: Props) {
  // 방금 복사한 묶음 이름(버튼에 잠깐 ✓를 보여준다).
  const [copied, setCopied] = useState('');
  // 상품 목록까지 펼쳐 둔 발주번호들.
  const [opened, setOpened] = useState<Set<string>>(new Set());
  const toggle = (orderNo: string) =>
    setOpened(prev => {
      const next = new Set(prev);
      if (next.has(orderNo)) next.delete(orderNo); else next.add(orderNo);
      return next;
    });

  // 이 묶음에 든 발주번호만 한 줄에 하나씩 클립보드로. 엑셀·검색창에 그대로 붙여 넣는다.
  const copyOrderNos = async (name: string, orderNos: string[]) => {
    const text = orderNos.join('\n');
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 클립보드 권한이 없을 때(오래된 브라우저 포함)를 위한 예비 방법.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(name);
    setTimeout(() => setCopied(prev => (prev === name ? '' : prev)), 1500);
  };

  const bundles = new Map<string, DisplayRow[]>();
  for (const row of rows) {
    if (row.isBlank || !row.묶음) continue;
    const list = bundles.get(row.묶음) || [];
    list.push(row);
    bundles.set(row.묶음, list);
  }

  // 카드 순서는 발송 표에 나오는 순서를 그대로 따른다(Map은 먼저 만난 묶음부터 담긴다).
  const sorted = Array.from(bundles.entries());

  if (sorted.length === 0) {
    return (
      <div style={{
        border: '1px dashed #d8cdf0', borderRadius: 10,
        padding: '48px 0', textAlign: 'center', color: '#b9aede', fontSize: 13,
      }}>
        발송 목록에서 같이 보낼 <strong style={{ color: '#7c3aed' }}>발주서를 체크</strong>하고<br />
        <span style={{ fontSize: 12 }}>묶기를 눌러주세요</span><br />
        <span style={{ fontSize: 11, color: '#c8bfe6' }}>이미 만든 묶음에 더 담을 때는 그 묶음의 +담기</span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {sorted.map(([name, list]) => {
        const color = bundleColor(name);
        const box = parseBoxNo(list[0]?.쉼먼트 || '');
        // 카드 안에서 발주번호별로 나눈다(같은 발주번호는 한 덩어리로).
        const orders = new Map<string, DisplayRow[]>();
        for (const row of list) {
          const key = row._발주번호 || '(번호없음)';
          orders.set(key, [...(orders.get(key) || []), row]);
        }
        const centers = Array.from(new Set(list.map(r => (r._물류센터 || '').trim()).filter(Boolean)));
        const mixed = centers.length > 1;
        // 택배가 갈 센터: 카드에서 고른 값이 있으면 그것, 없으면 첫 줄 센터.
        const shipCenter = (list.find(r => r.묶음센터)?.묶음센터 || centers[0] || '').trim();
        // 고를 수 있는 센터: 이 묶음에 든 센터를 앞에 두고, 나머지 등록된 센터를 뒤에 붙인다.
        const options = Array.from(new Set([...centers, ...centerOptions].filter(Boolean)));
        // 택배가 갈 입고예정일: 카드에서 고른 값이 있으면 그것, 없으면 이 묶음에서 가장 이른 날.
        const days = Array.from(new Set(list.map(r => dateKeyYMD(r._입고예정일)).filter(d => d && d !== '9999-12-31')));
        const baseDay = days.slice().sort((a, b) => ymdSortKey(a) - ymdSortKey(b))[0] || '';
        const pickedDay = (list.find(r => r.묶음일자)?.묶음일자 || '').trim();
        const shipDay = pickedDay || baseDay;
        // 발주서에 적힌 것과 달라졌는지(센터·날짜). 달라진 값은 주황색으로 보여주고 "적용"을 권한다.
        const centerChanged = !!shipCenter && (mixed || shipCenter !== centers[0]);
        const dayChanged = !!shipDay && (days.length > 1 || shipDay !== baseDay);
        const changed = centerChanged || dayChanged;
        const qty = list.reduce((sum, r) => sum + (Number(r.확정수량) || 0), 0);

        const done = doneBundles.has(name);

        return (
          <div key={name} style={{
            // 발송 표의 묶음 줄과 같은 색을 쓴다(왼쪽 4px 색 띠 + 연한 배경).
            border: `1px solid ${color}40`,
            borderLeft: `4px solid ${color}`,
            borderRadius: 10, overflow: 'hidden',
            // 카드 본문 배경도 발송 표의 묶음 줄과 같은 농도로 칠한다.
            background: `${color}0f`,
            // 완료한 묶음은 색은 그대로 두고 흐리게만 한다(색으로 묶음을 찾을 수 있게).
            opacity: done ? 0.5 : 1,
            transition: 'opacity 0.15s',
          }}>
            {/* 카드 머리: 첫 줄에 묶음 이름·센터·규모, 둘째 줄에 버튼들(가로가 좁아 두 줄로 나눈다) */}
            <div style={{
              padding: '6px 8px', background: `${color}1c`, borderBottom: `1px solid ${color}2e`,
              whiteSpace: 'nowrap',
            }}>
              {/* 첫 줄: 묶음 이름 · 센터 · 규모 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
                <span style={{ fontSize: 12, fontWeight: 800, color }}>{name}</span>
                <select
                  value={shipCenter}
                  onChange={e => onCenterChange(name, e.target.value)}
                  title={mixed
                    ? `이 묶음에 든 센터: ${centers.join(', ')}\n택배는 고른 센터(${shipCenter})로 갑니다.`
                    : '택배를 보낼 물류센터를 고릅니다'}
                  style={{
                    fontSize: 12, fontWeight: 700,
                    color: centerChanged ? '#e67e22' : '#333',
                    background: 'transparent', border: '1px solid transparent', borderRadius: 5,
                    padding: '1px 2px', cursor: 'pointer', maxWidth: 110,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = '#ddd')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = 'transparent')}
                >
                  {!shipCenter && <option value="">센터없음</option>}
                  {options.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                {mixed && <span style={{ fontSize: 11, color: '#c0392b' }} title={`센터가 섞여 있어요: ${centers.join(', ')}`}>⚠+{centers.length - 1}</span>}
                <input
                  type="date"
                  value={shipDay}
                  onChange={e => onDateChange(name, e.target.value)}
                  // 칸 아무 데나 누르면 바로 달력이 열리게 한다(숫자를 직접 치지 않아도 되게).
                  onClick={e => { try { (e.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.(); } catch {} }}
                  onFocus={e => { try { (e.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.(); } catch {} }}
                  title={days.length > 1
                    ? `이 묶음에 든 입고예정일: ${days.join(', ')}\n택배·발주는 고른 날(${shipDay})로 맞춥니다.`
                    : '이 묶음의 입고예정일을 고릅니다'}
                  style={{
                    fontSize: 11, fontWeight: 700,
                    color: dayChanged ? '#e67e22' : '#333',
                    background: 'transparent', border: '1px solid transparent', borderRadius: 5,
                    padding: '1px 2px', cursor: 'pointer', width: 108,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = '#ddd')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = 'transparent')}
                />
                <span style={{ marginLeft: 'auto', fontSize: 11, color: '#999' }}>발주 {orders.size} · {qty.toLocaleString()}개</span>
              </div>

              {/* 둘째 줄: 버튼들 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 5, flexWrap: 'wrap' }}>
                <button
                  onClick={() => copyOrderNos(name, Array.from(orders.keys()))}
                  title={`${name}의 발주번호 ${orders.size}개를 한 줄에 하나씩 복사합니다`}
                  style={{
                    padding: '2px 8px', fontSize: 11, cursor: 'pointer', borderRadius: 5,
                    border: copied === name ? `1.5px solid ${color}` : '1px solid #e5e5e5',
                    background: copied === name ? `${color}18` : '#fff',
                    color: copied === name ? color : '#888',
                    fontWeight: copied === name ? 700 : 400,
                  }}
                >
                  {copied === name ? '복사됨 ✓' : '📋 발주번호'}
                </button>
                {selectedCount > 0 && (
                  <button
                    onClick={() => onAddSelected(name)}
                    title={`발송 목록에서 체크한 발주서 ${selectedCount}건을 ${name}에 더 담습니다`}
                    style={{
                      padding: '2px 8px', fontSize: 11, fontWeight: 700,
                      borderRadius: 5, cursor: 'pointer',
                      border: `1.5px solid ${color}`, background: color, color: '#fff',
                    }}
                  >
                    +담기 {selectedCount}
                  </button>
                )}
                <button
                  onClick={() => onBoxChange(name, box ? '' : boxLabel(1))}
                  title="이 묶음을 택배 한 상자로 잡습니다(쉽먼트생성 박스 수에 반영)"
                  style={{
                    padding: '2px 8px', fontSize: 11, fontWeight: box ? 700 : 400,
                    borderRadius: 5, cursor: 'pointer',
                    border: box ? '1.5px solid #e67e22' : '1.5px solid #d5d5d5',
                    background: box ? '#fff4ec' : '#fafafa',
                    color: box ? '#e67e22' : '#bbb',
                  }}
                >
                  {box ? '1박스 ✓' : '박스'}
                </button>
                <button
                  onClick={() => onUnbundle(name)}
                  title="이 묶음을 없앱니다(줄은 발송 목록에 그대로 남아요)"
                  style={{
                    padding: '2px 7px', fontSize: 11, color: '#aaa',
                    background: '#fff', border: '1px solid #e5e5e5', borderRadius: 5, cursor: 'pointer',
                  }}
                >
                  해제
                </button>
              </div>

              {/* 셋째 줄: 진행 단계 버튼(1.묶음적용 → 2.발주적용완료 → 출고) */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 5, flexWrap: 'wrap' }}>
                {!changed && (
                  <span
                    title="이 묶음의 발주서들이 모두 같은 센터·입고예정일이에요(더 맞출 게 없어요)"
                    style={{
                      padding: '2px 8px', fontSize: 11, fontWeight: 700, borderRadius: 5,
                      border: '1px solid #b7e0c7', background: '#e8f8f0', color: '#27ae60',
                    }}
                  >
                    1.묶음적용완료 ✓
                  </span>
                )}
                {changed && (
                  <button
                    onClick={() => onApply(name)}
                    title={`이 묶음의 발주서들을 ${shipCenter} · ${shipDay}로 바꿉니다(발송 목록도 함께 바뀝니다)`}
                    style={{
                      padding: '2px 8px', fontSize: 11, fontWeight: 700, borderRadius: 5, cursor: 'pointer',
                      border: '1.5px solid #e67e22', background: '#e67e22', color: '#fff',
                    }}
                  >
                    1.묶음적용
                  </button>
                )}
                <button
                  onClick={() => onToggleDone(name)}
                  title={done ? '발주적용완료를 풀고 다시 켭니다' : '쿠팡에서 발주 수정까지 끝냈다고 표시합니다(카드 불이 꺼져요)'}
                  style={{
                    padding: '2px 10px', fontSize: 11, fontWeight: 700, borderRadius: 5, cursor: 'pointer',
                    border: done ? '1.5px solid #27ae60' : '1px solid #e5e5e5',
                    background: done ? '#e8f8f0' : '#fff',
                    color: done ? '#27ae60' : '#888',
                  }}
                >
                  {done ? '2.발주적용완료 ✓' : '2.발주적용완료'}
                </button>
                <button
                  onClick={() => onShipOut(name)}
                  title="이 묶음을 발주 > 쉽먼트생성으로 보냅니다(발주서와 묶음 정보가 함께 갑니다)"
                  style={{
                    marginLeft: 'auto',
                    padding: '2px 10px', fontSize: 11, fontWeight: 700, borderRadius: 5, cursor: 'pointer',
                    border: `1.5px solid ${color}`, background: '#fff', color,
                  }}
                >
                  쉽먼트 →
                </button>
              </div>
            </div>

            {/* 발주서 한 줄씩. 누르면 그 발주서의 상품 목록이 펼쳐진다. */}
            {Array.from(orders.entries()).map(([orderNo, lines]) => {
              const open = opened.has(orderNo);
              const sum = lines.reduce((s, r) => s + (Number(r.확정수량) || 0), 0);
              return (
                <div key={orderNo} style={{ borderTop: '1px solid #f3f3f3' }}>
                  <div
                    onClick={() => toggle(orderNo)}
                    title="눌러서 상품 목록 보기"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px',
                      cursor: 'pointer', whiteSpace: 'nowrap', fontSize: 11,
                    }}
                  >
                    <span style={{ width: 8, color: '#ccc', fontSize: 9 }}>{open ? '▾' : '▸'}</span>
                    <span style={{ fontWeight: 700, color: '#333', fontVariantNumeric: 'tabular-nums' }}>{orderNo}</span>
                    {mixed && <span style={{ color: '#888' }}>{(lines[0]._물류센터 || '').trim()}</span>}
                    <span style={{ color: '#aaa' }}>{shortDate(lines[0]._입고예정일)}</span>
                    <span style={{ marginLeft: 'auto', color: '#bbb' }}>{lines.length}품목</span>
                    <span style={{ fontWeight: 700, color: '#333', minWidth: 36, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {sum.toLocaleString()}개
                    </span>
                    <button
                      onClick={e => { e.stopPropagation(); onRemoveOrder(orderNo); }}
                      title="이 발주서를 묶음에서 빼기"
                      style={{
                        width: 17, height: 17, fontSize: 11, lineHeight: '13px', padding: 0,
                        color: '#c9c9c9', background: '#fff',
                        border: '1px solid #ececec', borderRadius: 4, cursor: 'pointer',
                      }}
                    >
                      ×
                    </button>
                  </div>

                  {open && (
                    <div style={{ padding: '2px 10px 6px 26px', background: `${color}08` }}>
                      {lines.map(row => (
                        <div key={row.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '1px 0', fontSize: 11 }}>
                          <span
                            title={row.상품이름}
                            style={{ flex: 1, color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          >
                            {row.상품이름}
                          </span>
                          <span style={{ color: '#333', fontWeight: 700, minWidth: 28, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                            {row.확정수량 !== '' ? row.확정수량 : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
