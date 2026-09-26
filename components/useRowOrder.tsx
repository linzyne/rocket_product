import React, { useEffect, useState } from 'react';
import { OrderKind, ProductOrder, applyOrder, loadLocalOrder, setProductOrder, subscribeProductOrder } from '../data/productOrderStore';

// 표의 상품 줄을 끌어서 순서를 바꾸는 손잡이. 로켓재고·판매량·입고가 같이 쓴다.
// "내 순서"로 둔 동안에만 끌 수 있고, 바꾼 순서는 클라우드에 저장돼 세 화면이 같은 차례로 보인다.
export const useRowOrder = (kind: OrderKind) => {
  const [order, setOrder] = useState<ProductOrder>(loadLocalOrder);
  const [mine, setMine] = useState(false);
  const [dragKey, setDragKey] = useState('');
  const [overKey, setOverKey] = useState('');

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

  // 줄에 붙일 것들. 상품 칸에 그대로 펼쳐 쓴다.
  const rowProps = (key: string, visibleKeys: string[]) =>
    mine
      ? {
          draggable: true,
          onDragStart: (e: React.DragEvent) => { setDragKey(key); e.dataTransfer.effectAllowed = 'move'; },
          onDragOver: (e: React.DragEvent) => { e.preventDefault(); if (overKey !== key) setOverKey(key); },
          onDragEnd: () => { setDragKey(''); setOverKey(''); },
          onDrop: (e: React.DragEvent) => { e.preventDefault(); drop(visibleKeys, dragKey, key); setDragKey(''); setOverKey(''); },
        }
      : {};

  const rowClass = (key: string) => (mine && overKey === key && dragKey !== key ? 'outline outline-2 outline-blue-400' : '');

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
    // 제네릭이 살아 있게 타입을 그대로 적어 둔다(줄 모양이 화면마다 달라서).
    sort: sort as <T>(rows: T[], keyOf: (row: T) => string) => T[],
    rowProps,
    rowClass,
    Toggle,
  };
};

// 상품 칸 앞에 두는 끌기 손잡이.
export const DragHandle: React.FC<{ show: boolean }> = ({ show }) =>
  show ? <span className="flex-shrink-0 text-gray-300 cursor-grab select-none px-0.5" title="끌어서 순서 바꾸기">⠿</span> : null;
