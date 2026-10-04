import React, { useMemo, useState } from 'react';

type Line = { 상품이름?: string; 확정수량?: unknown; ready?: boolean };

// 같은 상품을 하나로 더해 많은 순으로 세운다.
const sumByName = (lines: Line[]) => {
  const m = new Map<string, number>();
  for (const l of lines) {
    const name = String(l.상품이름 || '').trim();
    if (!name) continue;
    m.set(name, (m.get(name) || 0) + (Number(l.확정수량) || 0));
  }
  return Array.from(m.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'));
};
const totalOf = (items: [string, number][]) => items.reduce((sum, [, q]) => sum + q, 0);

// 화면 위쪽에 띄우는 상품별 수량 표. 기본은 접어 두고 머리줄(몇 종 · 총 몇 개)만 보여준다.
// 줄에 ready가 있으면 펼쳤을 때 "준비 안 됨"과 "준비됨" 표를 양쪽으로 나눠 보여준다.
export default function ProductQtySummary({ lines }: { lines: Line[] }) {
  // 한 번 펼치면 접을 때까지(새로고침·메뉴 이동 후에도) 펼친 채로 둔다.
  const [open, setOpenState] = useState(() => {
    try { return localStorage.getItem(OPEN_KEY) === '1'; } catch { return false; }
  });
  const setOpen = (f: (o: boolean) => boolean) => setOpenState(o => {
    const next = f(o);
    try { localStorage.setItem(OPEN_KEY, next ? '1' : '0'); } catch { /* 저장 못 해도 화면은 그대로 */ }
    return next;
  });
  const withReady = lines.some(l => l.ready !== undefined);
  const all = useMemo(() => sumByName(lines), [lines]);
  const notReady = useMemo(() => sumByName(lines.filter(l => !l.ready)), [lines]);
  const ready = useMemo(() => sumByName(lines.filter(l => l.ready)), [lines]);
  if (!all.length) return null;

  return (
    <div style={{ marginBottom: 14, border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
      <button
        onClick={() => setOpen(o => !o)}
        title={open ? '상품별 수량 접기' : '상품별 수량 펼치기'}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '2px 8px', padding: '8px 12px',
          background: '#fafbfc', border: 'none', borderBottom: open ? '1px solid #eef0f3' : 'none',
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span style={{ fontSize: 10, color: '#aaa' }}>{open ? '▾' : '▸'}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#333' }}>상품별 수량</span>
        <span style={{ fontSize: 12, color: '#777' }}>{all.length}종 · 총 <b style={{ color: '#1e293b' }}>{totalOf(all).toLocaleString()}</b>개</span>
        {withReady && (
          <span style={{ fontSize: 12, color: '#777' }}>
            (안 됨 <b style={{ color: ORANGE }}>{totalOf(notReady).toLocaleString()}</b> · 준비 <b style={{ color: GREEN }}>{totalOf(ready).toLocaleString()}</b>)
          </span>
        )}
      </button>
      {open && (withReady ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))' }}>
          <QtyTable title="준비 안 됨" color={ORANGE} items={notReady} />
          <QtyTable title="준비됨" color={GREEN} items={ready} />
        </div>
      ) : (
        <QtyTable items={all} />
      ))}
    </div>
  );
}

const OPEN_KEY = 'productQtySummaryOpen';
const ORANGE = '#e67e22';
const GREEN = '#27ae60';

function QtyTable({ title, color, items }: { title?: string; color?: string; items: [string, number][] }) {
  return (
    <div style={{ borderLeft: title === '준비됨' ? '1px solid #eef0f3' : undefined, minWidth: 0 }}>
      {title && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: `${color}10`, borderBottom: `1px solid ${color}30` }}>
          <span style={{ fontSize: 12, fontWeight: 800, color }}>{title}</span>
          <span style={{ fontSize: 11.5, color: '#777' }}>{items.length}종 · {totalOf(items).toLocaleString()}개</span>
        </div>
      )}
      <div style={{ maxHeight: 360, overflowY: 'auto' }}>
        {items.length ? (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <tbody>
              {items.map(([name, qty], i) => (
                <tr key={name} style={{ borderTop: i ? '1px solid #f3f4f6' : 'none' }}>
                  <td style={{ padding: '5px 12px', color: '#333' }}>{name}</td>
                  <td style={{ padding: '5px 12px', textAlign: 'right', fontWeight: 800, color: '#1e293b', whiteSpace: 'nowrap', width: 1 }}>
                    {qty.toLocaleString()}개
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div style={{ padding: '14px 12px', fontSize: 12, color: '#bbb', textAlign: 'center' }}>없음</div>
        )}
      </div>
    </div>
  );
}
