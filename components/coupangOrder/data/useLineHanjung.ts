// 상품 줄 하나를 한중발주에 맡기기(쉽먼트생성대기 체크 메뉴와 발주 진행이 같이 쓴다).
//  · hanjungOf: 체크 메뉴에 보일 것(이 줄이 한중 어디에 몇 개 있는지 + 고를 수 있는 한중발주·이름 다른 같은 상품·사무실 재고)
//  · setLineHanjung: 고른 대로 맡긴다(발주 대기 / 그 한중발주 / 빼기 / 사무실 재고에서 쓰기)
import { useEffect, useMemo, useState } from 'react';
import {
  HanjungOrder, subscribeHanjung, saveHanjungOrder, freezeOrderQty, productSummary, sameName, orderQtyName, rememberSameProduct,
} from '../../../data/hanjungStore';
import { HanjungQueueItem, subscribeHanjungQueue, addToHanjungQueue, removeFromHanjungQueue, hanjungQueueKey, makePlaceLookup } from './hanjungQueueStore';
import { reservationKey } from './reservationStore';
import { dateKeyYMD } from '../utils/dateUtils';
import { nameSimilarity } from '../../../data/inventoryStore';
import type { LineHanjung, HanjungChoice, HanjungAction, HanjungLink } from '../components/OrderTable';

// 맡길 줄(박스로 나눈 조각이면 나누기 전 수량).
export type HLine = { 발주번호: string; 물류센터: string; 상품이름: string; 확정수량: number | ''; 입고예정일: Date | string; 메모: string; 쉼먼트: string };

export function useLineHanjung(note: (text: string) => void = t => alert(t)) {
  const [hanjungQueue, setHanjungQueue] = useState<HanjungQueueItem[]>([]);
  const [hanjungOrders, setHanjungOrders] = useState<HanjungOrder[]>([]);
  useEffect(() => subscribeHanjungQueue(setHanjungQueue), []);
  useEffect(() => subscribeHanjung(setHanjungOrders), []);
  const queuedKeys = useMemo(() => new Set(hanjungQueue.map(q => q.key)), [hanjungQueue]);
  const placesOf = useMemo(() => makePlaceLookup(hanjungOrders, hanjungQueue), [hanjungOrders, hanjungQueue]);

  // 체크 메뉴에 보일 것: 이 줄이 한중 어디에 몇 개 있는지 + 고를 수 있는 한중발주(이 상품의 주문·여유).
  //  · 이 상품이 있는 건: 여유가 남았거나, 아직 입고 전이거나(더 주문할 수 있음), 이 줄이 이미 들어 있는 건
  //  · 이 상품이 없는 건: 아직 입고 전인 건만(1688에 추가 주문해 넣는 경우)
  const hanjungOf = (line: HLine): LineHanjung => {
    const places = placesOf(line);
    const choices: HanjungChoice[] = [];
    for (const o of hanjungOrders) {
      const p = productSummary(o).find(x => sameName(x.상품이름, line.상품이름));
      const placed = places.some(pl => pl.code === o.code);
      if (p && (p.spare > 0 || !o.receipts.length || placed)) {
        choices.push({ code: o.code, has: true, ordered: p.ordered, spare: p.spare, arrived: p.received > 0 });
      } else if (!p && !o.receipts.length) {
        choices.push({ code: o.code, has: false, ordered: 0, spare: 0, arrived: false });
      }
    }
    // 이름이 다르게 적힌 같은 상품 후보: 여유가 있고 쿠팡 발주 줄이 안 붙은 품목(직접 더한 품목), 비슷한 이름 순.
    const links: HanjungLink[] = [];
    for (const o of hanjungOrders) {
      for (const p of productSummary(o)) {
        if (p.spare <= 0 || p.allocated > 0 || sameName(p.상품이름, line.상품이름)) continue;
        links.push({ code: o.code, name: p.상품이름, ordered: p.ordered, spare: p.spare, arrived: p.received > 0 });
      }
    }
    links.sort((a, b) => nameSimilarity(b.name, line.상품이름) - nameSimilarity(a.name, line.상품이름));
    // 사무실 재고: 이 상품의 도착했고 배정 안 된 여유 합.
    const stock = hanjungOrders.reduce((sum, o) => {
      const p = productSummary(o).find(x => sameName(x.상품이름, line.상품이름));
      return sum + (p ? Math.min(p.spare, Math.max(0, p.received - p.allocated)) : 0);
    }, 0);
    return { need: Number(line.확정수량) || 0, places, choices, links, stock };
  };
  // 체크 메뉴에서 고른 대로 한중에 맡긴다. 먼저 이 줄을 있던 곳(한중발주·대기)에서 모두 떼고 새로 붙인다.
  // 줄을 떼도 1688에 산 수량(주문 수량)은 그대로라 그만큼 여유로 돌아간다.
  const setLineHanjung = async (line: HLine, action: HanjungAction, onFullReady?: () => void) => {
    if (action.type === 'stock') { await assignFromSpare(line, onFullReady); return; }
    const k = hanjungQueueKey(line);
    const name = line.상품이름;
    const need = Number(line.확정수량) || 0;
    const same = (l: { 발주번호: string; 상품이름: string; 확정수량: number }) => hanjungQueueKey(l) === k;
    try {
      // 1) 있던 한중발주에서 떼기
      const changed = new Map<string, HanjungOrder>();
      for (const o of hanjungOrders) {
        if (!o.lines.some(same)) continue;
        const lines = o.lines.filter(l => !same(l));
        const orderQty = freezeOrderQty(o, name);
        // 1688에서 안 샀으면 뗀 수량만큼 주문 수량도 줄인다(0이 되고 그 상품 줄도 없으면 품목에서 뺀다).
        // 같은 건에 다시 붙이는 경우(여유가 모자라 나누기 등)는 줄이지 않는다.
        const reattach = action.type === 'order' && action.code === o.code;
        if (action.release === 'shrink' && !reattach) {
          const freed = o.lines.filter(same).reduce((sum, l) => sum + (l.배정 ?? l.확정수량), 0);
          const qk = orderQtyName(orderQty, name);
          const left = Math.max(0, (orderQty[qk] || 0) - freed);
          if (left > 0 || lines.some(l => sameName(l.상품이름, name))) orderQty[qk] = left;
          else delete orderQty[qk];
        }
        changed.set(o.code, { ...o, orderQty, lines });
      }
      // 2) 고른 한중발주에 붙이기
      let toQueue = 0;
      if (action.type === 'queue') toQueue = need;
      if (action.type === 'order') {
        let base = changed.get(action.code) || hanjungOrders.find(o => o.code === action.code);
        if (!base) return;
        // 이름이 다르게 적힌 같은 상품에 연결: 그 품목 이름을 이 쿠팡 발주 상품 이름으로 바꾼다(수량은 그대로).
        if (action.linkFrom && base.orderQty && base.orderQty[action.linkFrom] != null) {
          const { [action.linkFrom]: q, ...rest } = base.orderQty;
          const k = orderQtyName(rest, name);
          base = { ...base, orderQty: { ...rest, [k]: (rest[k] || 0) + q } };
          // 주문할 때 적은 단가도 같은 이름으로 옮긴다.
          if (base.unitCost && base.unitCost[action.linkFrom] != null) {
            const { [action.linkFrom]: c, ...restCost } = base.unitCost;
            base = { ...base, unitCost: { ...restCost, [name]: c } };
          }
          // 수입입고에 적힌 이름도 같이 바꿔야 도착 수량이 맞는다.
          base = { ...base, receipts: base.receipts.map(r => ({ ...r, items: r.items.map(it => (it.상품이름 === action.linkFrom ? { ...it, 상품이름: name } : it)) })) };
        }
        if (action.linkFrom) {
          changed.set(base.code, base);
          // 다음부터는 묻지 않게 같은 상품이라고 기억해 둔다.
          rememberSameProduct(action.linkFrom, name, true).catch(() => undefined);
        }
        const p = productSummary(base).find(x => sameName(x.상품이름, name));
        const spare = p ? p.spare : 0;
        let orderQty = freezeOrderQty(base, name, need);
        let alloc = need;
        if (p && spare < need) {
          if (action.mode === 'split') {
            alloc = spare;
            toQueue = need - spare;
          } else if (action.mode === 'grow') {
            orderQty = { ...orderQty, [orderQtyName(orderQty, name)]: p.ordered + (need - spare) };
          }
        }
        if (alloc > 0) {
          changed.set(base.code, {
            ...base,
            orderQty,
            lines: [...base.lines, {
              key: reservationKey(line),
              발주번호: line.발주번호,
              물류센터: line.물류센터,
              상품이름: name,
              확정수량: need,
              입고예정일: dateKeyYMD(line.입고예정일).replace(/-/g, ''),
              ...(alloc !== need ? { 배정: alloc } : {}),
            }],
          });
        }
      }
      // 떼고 나서 품목이 하나도 안 남는 한중발주가 있으면 확인한다.
      const emptied = Array.from(changed.values()).filter(o => !o.lines.length && !Object.keys(o.orderQty || {}).length).map(o => o.code);
      if (emptied.length && !confirm(`${emptied.join(', ')}에 남는 품목이 없어요. 빈 한중발주가 돼요(한중발주 페이지에서 지울 수 있어요). 그래도 할까요?`)) return;
      for (const o of changed.values()) await saveHanjungOrder(o);
      // 3) 발주 대기: 있던 것은 지우고, 대기로 보낼 수량이 있으면 그만큼 다시 넣는다.
      if (queuedKeys.has(k)) await removeFromHanjungQueue([k]);
      if (toQueue > 0) await addToHanjungQueue([{ ...line, ...(toQueue !== need ? { 배정: toQueue } : {}) }], []);
    } catch (err: any) {
      alert(`한중발주 저장 실패: ${err?.message || err}`);
    }
  };
  const assignFromSpare = async (line: HLine, onFullReady?: () => void) => {
    if (placesOf(line).length) return; // 이미 한중에 맡긴 줄
    const name = line.상품이름;
    const need = Number(line.확정수량) || 0;
    if (!need) return;
    let left = need;
    const changed: HanjungOrder[] = [];
    for (const o of [...hanjungOrders].sort((a, b) => a.createdAt - b.createdAt)) {
      if (left <= 0) break;
      const p = productSummary(o).find(x => sameName(x.상품이름, name));
      // 사무실에 와 있는 여유만(아직 오는 중인 건 체크 메뉴의 한중발주에서 직접 고른다).
      const inOffice = p ? Math.min(p.spare, Math.max(0, p.received - p.allocated)) : 0;
      if (inOffice <= 0) continue;
      const take = Math.min(inOffice, left);
      left -= take;
      changed.push({
        ...o,
        orderQty: freezeOrderQty(o, name),
        lines: [...o.lines, {
          key: reservationKey(line),
          발주번호: line.발주번호,
          물류센터: line.물류센터,
          상품이름: name,
          확정수량: need,
          입고예정일: dateKeyYMD(line.입고예정일).replace(/-/g, ''),
          ...(take !== need ? { 배정: take } : {}),
        }],
      });
    }
    if (!changed.length) { note(`${name}: 사무실 재고가 없어요.`); return; }
    try {
      for (const o of changed) await saveHanjungOrder(o);
      // 사무실 재고에서 꺼낸 거라 물건은 이미 와 있다. 다 채웠으면 준비됨으로 체크한다.
      if (left <= 0) onFullReady?.();
      const where = changed.map(o => o.code).join(', ');
      note(left > 0
        ? `${name}: 사무실 재고에서 ${need - left}개만 썼어요(${where}). ${left}개는 모자라요 — 체크 메뉴의 한중발주에서 나머지를 정해 주세요.`
        : `${name} ${need}개를 사무실 재고(${where})에서 썼어요.`);
    } catch (err: any) {
      alert(`한중 여유 배정 실패: ${err?.message || err}`);
    }
  };

  return { hanjungOf, setLineHanjung, hanjungOrders };
}
