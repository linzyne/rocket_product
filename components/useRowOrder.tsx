import React, { useEffect, useState } from 'react';
import { OrderKind, ProductOrder, applyOrder, loadLocalOrder, setProductOrder, subscribeProductOrder } from '../data/productOrderStore';

// 표의 상품 줄을 끌어서 순서를 바꾸는 손잡이. 로켓재고·판매량·입고가 같이 쓴다.
// "내 순서"로 둔 동안에만 끌 수 있고, 바꾼 순서는 클라우드에 저장돼 세 화면이 같은 차례로 보인다.
// "내 순서"로 보고 있었는지는 이 기기에 남겨 둔다(순서 자체는 클라우드에 있다).
const MINE_KEY = (kind: OrderKind) => `productOrderMine_${kind}`;
const loadMine = (kind: OrderKind) => {
  try {
    return localStorage.getItem(MINE_KEY(kind)) === '1';
  } catch {
    return false;
  }
};

export const useRowOrder = (kind: OrderKind) => {
  const [order, setOrder] = useState<ProductOrder>(loadLocalOrder);
  const [mine, setMineState] = useState(() => loadMine(kind));
  const setMine = (v: boolean) => {
    setMineState(v);
    try {
      localStorage.setItem(MINE_KEY(kind), v ? '1' : '0');
    } catch {}
  };
  const [overKey, setOverKey] = useState('');
  // 끄는 줄은 ref로 둔다(끄는 동안 화면을 다시 그리면 끌기가 끊긴다).
  const dragKeyRef = React.useRef('');
  // 지금 화면에 보이는 줄 차례. 위·아래 단추와 놓기가 같이 본다.
  const visibleRef = React.useRef<string[]>([]);

  useEffect(() => subscribeProductOrder(setOrder), []);

  const keys = order[kind];
  function sort<T>(rows: T[], keyOf: (row: T) => string): T[] {
    return mine ? applyOrder(rows, keyOf, keys) : rows;
  }

  // 끌어다 놓으면 지금 보이는 차례를 그대로 저장한다(걸러서 보고 있어도 안 보이던 상품 순서는 지키도록
  // 원래 목록에서 옮기기만 한다).
  const drop = (visibleKeys: string[], from: string, to: string) => {
    if (!from || !to || from === to) return;
    const base = keys.length ? keys.slice() : visibleKeys.slice();
    for (const k of visibleKeys) if (!base.includes(k)) base.push(k);
    const fromAt = base.indexOf(from);
    const toAt = base.indexOf(to);
    if (fromAt < 0 || toAt < 0) return;
    base.splice(toAt, 0, ...base.splice(fromAt, 1));
    setOrder(o => ({ ...o, [kind]: base }));
    setProductOrder(kind, base).catch(err => alert(`순서 저장 실패: ${err?.message || err}`));
  };

  // 줄에 붙일 것들. 줄(tr)에 그대로 펼쳐 쓴다.
  // dataTransfer에 값을 넣어야 끌기가 실제로 시작된다(넣지 않으면 브라우저가 무시한다).
  const rowProps = (key: string, visibleKeys: string[]) => {
    visibleRef.current = visibleKeys;
    if (!mine) return {};
    return {
      draggable: true,
      onDragStart: (e: React.DragEvent) => {
        dragKeyRef.current = key;
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', key); } catch (err) {}
      },
      onDragOver: (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (overKey !== key) setOverKey(key);
      },
      onDragEnd: () => { dragKeyRef.current = ''; setOverKey(''); },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        const from = dragKeyRef.current || e.dataTransfer.getData('text/plain');
        drop(visibleKeys, from, key);
        dragKeyRef.current = '';
        setOverKey('');
      },
    };
  };

  const rowClass = (key: string) => (mine && overKey === key && dragKeyRef.current !== key ? 'outline outline-2 outline-blue-400 outline-offset-[-2px]' : '');

  // 끌기가 어려울 때를 위한 위·아래 단추. 지금 보이는 차례에서 한 칸씩 옮긴다.
  const move = (key: string, delta: number) => {
    const visible = visibleRef.current;
    const at = visible.indexOf(key);
    const to = at + delta;
    if (at < 0 || to < 0 || to >= visible.length) return;
    drop(visible, key, visible[to]);
  };

  const reset = () => {
    if (!confirm('정해 둔 순서를 지우고 원래대로 돌릴까요?')) return;
    setOrder(o => ({ ...o, [kind]: [] }));
    setProductOrder(kind, []).catch(err => alert(`순서 저장 실패: ${err?.message || err}`));
  };

  // 화면 위쪽에 두는 전환 단추.
  const Toggle: React.FC = () => (
    <div className="inline-flex items-center gap-2">
      <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
        {[[false, '많은 순'], [true, '내 순서']].map(([v, label]) => (
          <button
            key={String(label)}
            onClick={() => setMine(v as boolean)}
            className={`px-3 py-1 rounded-md text-sm ${mine === v ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
          >
            {label as string}
          </button>
        ))}
      </div>
      {mine && (
        <>
          <span className="text-xs text-gray-400">상품을 끌어서 옮기세요</span>
          {keys.length > 0 && (
            <button onClick={reset} className="text-xs text-gray-400 underline hover:text-gray-600">순서 지우기</button>
          )}
        </>
      )}
    </div>
  );

  return {
    mine,
    move,
    // 제네릭이 살아 있게 타입을 그대로 적어 둔다(줄 모양이 화면마다 달라서).
    sort: sort as <T>(rows: T[], keyOf: (row: T) => string) => T[],
    rowProps,
    rowClass,
    Toggle,
  };
};

// 상품 칸 앞에 두는 끌기 손잡이와 위·아래 단추.
export const DragHandle: React.FC<{ show: boolean; onUp?: () => void; onDown?: () => void }> = ({ show, onUp, onDown }) =>
  show ? (
    <span className="flex-shrink-0 flex items-center gap-0.5">
      <span className="text-gray-300 cursor-grab select-none" title="끌어서 순서 바꾸기">⠿</span>
      <span className="flex flex-col leading-none">
        <button onClick={onUp} title="한 칸 위로" className="text-[9px] text-gray-400 hover:text-blue-600 px-0.5">▲</button>
        <button onClick={onDown} title="한 칸 아래로" className="text-[9px] text-gray-400 hover:text-blue-600 px-0.5">▼</button>
      </span>
    </span>
  ) : null;
