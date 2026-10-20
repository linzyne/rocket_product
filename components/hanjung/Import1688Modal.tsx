import React, { useEffect, useMemo, useState } from 'react';
import { sameName } from '../../data/hanjungStore';
import type { HanjungOrder } from '../../data/hanjungStore';
import { subscribe1688Links, set1688Links, Order1688Links } from '../../data/order1688LinkStore';
import { fetch1688Basket, item1688Key, itemShareKrw, loadCnyRate, Order1688, Order1688Item, Order1688Ref } from '../../utils/order1688';
import ProductThumb from './ProductThumb';

// 한중발주 장바구니 "1688 주문 가져오기".
// 1688 주문목록에서 담아 둔 주문을 보여주고, 1688 상품마다 앱 상품(쿠팡 발주 상품이름)을 고르게 한다.
// 고른 짝은 기억해서 다음부터 미리 골라 둔다. 그래도 넣기 전에 사진을 나란히 보고 확인하게 한다.
// 확인하면 상품별로 산 수량·금액(원)을 합쳐 장바구니에 넘긴다(배정·여유 계산은 장바구니가 한다).

export interface Import1688Result {
  products: { name: string; qty: number; cost: number }[];
  refs: Order1688Ref[];
}

// 주문 하나를 "아직 안 넣은 상품"과 "이미 넣은 상품"으로 나눈 것.
type View = { o: Order1688; fresh: Order1688Item[]; used: Order1688Item[] };

type Choice = { mode: '' | 'cart' | 'other' | 'skip'; name: string; remembered?: boolean };

const ckey = (orderId: string, idx: number) => `${orderId}#${idx}`;
const won = (n: number) => `${Math.round(n).toLocaleString()}원`;

const Import1688Modal: React.FC<{
  hanjungOrders: HanjungOrder[];
  cart: { name: string; qty: number }[];
  names: { name: string; from: string }[];
  imageOf: (name: string) => string;
  skipRefs: Order1688Ref[]; // 이번 장바구니에 이미 가져온 상품
  onApply: (r: Import1688Result) => void;
  onClose: () => void;
}> = ({ hanjungOrders, cart, names, imageOf, skipRefs, onApply, onClose }) => {
  const [basket, setBasket] = useState<Order1688[] | null | 'none'>(null);
  const [links, setLinks] = useState<Order1688Links>({});
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [showUsed, setShowUsed] = useState(false);
  const [saving, setSaving] = useState(false);
  const rate = useMemo(loadCnyRate, []);

  useEffect(() => subscribe1688Links(setLinks), []);
  const load = () => {
    setBasket(null);
    fetch1688Basket().then(list => setBasket(list === null ? 'none' : list));
  };
  useEffect(load, []);

  // 이미 어느 한중발주에 들어간 1688 상품(같은 상품을 두 번 넣지 않게). 열쇠: 주문번호#상품번호, 주문 전체면 주문번호#*.
  const usedIn = useMemo(() => {
    const m = new Map<string, string>();
    const add = (r: Order1688Ref, where: string) =>
      (r.items ? r.items.map(i => `${r.orderId}#${i}`) : [`${r.orderId}#*`]).forEach(k => m.set(k, where));
    hanjungOrders.forEach(o => (o.orders1688 || []).forEach(r => add(r, o.code)));
    skipRefs.forEach(r => add(r, '이번 장바구니'));
    return m;
  }, [hanjungOrders, skipRefs]);
  const usedWhere = (orderId: string, it: Order1688Item) => usedIn.get(`${orderId}#*`) || usedIn.get(`${orderId}#${it.idx}`);

  const list = Array.isArray(basket)
    ? [...basket]
        .map(o => ({ ...o, items: (o.items || []).map((it, i) => (it.idx == null ? { ...it, idx: i } : it)) }))
        .sort((a, b) => String(a.orderTime).localeCompare(String(b.orderTime)))
    : [];
  const views: View[] = list.map(o => ({ o, fresh: o.items.filter(it => !usedWhere(o.orderId, it)), used: o.items.filter(it => usedWhere(o.orderId, it)) }));
  const fresh = views.filter(v => v.fresh.length);
  const used = views.filter(v => v.used.length);

  // 처음 열 때: 아직 안 넣은 주문은 모두 고르고, 기억한 짝을 미리 골라 둔다.
  const [inited, setInited] = useState(false);
  useEffect(() => {
    if (inited || !Array.isArray(basket)) return;
    setPicked(new Set(fresh.map(v => v.o.orderId)));
    setInited(true);
  }, [basket, inited]);
  useEffect(() => {
    if (!Array.isArray(basket)) return;
    setChoices(prev => {
      const next = { ...prev };
      basket.forEach(o =>
        (o.items || []).forEach((it, i) => {
          const k = ckey(o.orderId, it.idx == null ? i : it.idx);
          if (next[k]) return;
          const name = links[item1688Key(it)];
          if (!name) return;
          const inCart = cart.find(c => sameName(c.name, name));
          next[k] = { mode: inCart ? 'cart' : 'other', name: inCart ? inCart.name : name, remembered: true };
        }),
      );
      return next;
    });
  }, [basket, links, cart]);

  const setChoice = (k: string, c: Choice) => setChoices(prev => ({ ...prev, [k]: c }));
  // 장바구니에 없는 앱 상품도 목록에서 바로 고르게(가나다순, 장바구니 상품은 빼고).
  const otherNames = useMemo(() => {
    const seen = new Set<string>();
    return names
      .filter(n => n.name.trim() && !cart.some(c => sameName(c.name, n.name)))
      .filter(n => { const k = n.name.trim(); if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }, [names, cart]);
  const toggle = (id: string) =>
    setPicked(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const pickedOrders = fresh.filter(v => picked.has(v.o.orderId));
  const missing = pickedOrders.flatMap(v =>
    v.fresh.map(it => ckey(v.o.orderId, it.idx)).filter(k => {
      const c = choices[k];
      return !c || !c.mode || (c.mode !== 'skip' && !c.name.trim());
    }),
  );
  const itemCount = pickedOrders.reduce((s, v) => s + v.fresh.length, 0);

  const apply = async () => {
    if (!pickedOrders.length || missing.length) return;
    const byName: { name: string; qty: number; cost: number }[] = [];
    const remember: Order1688Links = {};
    pickedOrders.forEach(v =>
      v.fresh.forEach(it => {
        const c = choices[ckey(v.o.orderId, it.idx)];
        if (!c || c.mode === 'skip') return;
        const name = c.name.trim();
        remember[item1688Key(it)] = name;
        const cost = itemShareKrw(it, rate);
        const cur = byName.find(p => sameName(p.name, name));
        if (cur) {
          cur.qty += it.qty;
          cur.cost += cost;
        } else byName.push({ name, qty: it.qty, cost });
      }),
    );
    setSaving(true);
    try {
      await set1688Links(remember);
    } catch (err) {
      console.error('1688 짝 저장 실패', err);
    } finally {
      setSaving(false);
    }
    onApply({
      products: byName,
      // 빼기로 한 상품도 이번에 처리한 것으로 남긴다(다음에 또 안 뜨게).
      refs: pickedOrders.map(v => ({ orderId: v.o.orderId, mailNos: (v.o.packages || []).map(p => p.mailNo).filter(Boolean), items: v.fresh.map(it => it.idx) })),
    });
  };

  const renderOrder = ({ o, fresh: freshItems, used: usedItems }: View, disabled: boolean) => {
    const on = picked.has(o.orderId) && !disabled;
    const shown = disabled ? usedItems : freshItems;
    const shownKrw = shown.reduce((s, it) => s + itemShareKrw(it, rate), 0);
    const shownCny = shown.reduce((s, it) => s + (it.cnyShare || it.unitCny * it.qty), 0);
    return (
      <div key={o.orderId} className={`border rounded-xl p-3 ${on ? 'border-sky-300 bg-sky-50/40' : 'border-gray-200'} ${disabled ? 'opacity-60' : ''}`}>
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={on} disabled={disabled} onChange={() => toggle(o.orderId)} />
          <span className="font-mono font-bold">…{o.orderId.slice(-8)}</span>
          <span className="text-xs text-gray-400">{String(o.orderTime).slice(5, 16)}</span>
          <span className="ml-auto text-xs font-semibold text-gray-700">
            ¥{shownCny.toFixed(2)} · {o.totalKrw > 0 ? won(shownKrw) : `약 ${won(shownKrw)}`}
          </span>
        </label>
        <div className="text-xs mt-1 text-gray-500">
          {o.packages?.length ? `🚚 ${o.packages.map(p => `${p.company} ${p.mailNo}`).join(' · ')}` : '🚚 운송장 없음'}
          {(o.itemCount || 0) > o.items.length && <span className="ml-2">· 이 주문 상품 {o.itemCount}개 중 {o.items.length}개 담음</span>}
        </div>
        {disabled && (
          <div className="mt-1 space-y-0.5 text-xs text-gray-500">
            {usedItems.map(it => (
              <div key={it.idx} className="truncate">· {it.spec || it.title} {it.qty}개 → <span className="text-amber-700 font-semibold">이미 {usedWhere(o.orderId, it)}에 넣었어요</span></div>
            ))}
          </div>
        )}
        {!disabled && (
          <div className="mt-2 space-y-2">
            {freshItems.map(it => {
              const k = ckey(o.orderId, it.idx);
              const c = choices[k] || { mode: '', name: '' };
              const bad = on && (!c.mode || (c.mode !== 'skip' && !c.name.trim()));
              const selectValue = c.mode === 'cart' ? `cart:${c.name}` : c.mode;
              return (
                <div key={k} className={`rounded-lg border p-2 bg-white ${bad ? 'border-red-300' : 'border-gray-100'}`}>
                  <div className="flex gap-2">
                    <span className="w-14 h-14 flex-shrink-0 rounded border border-gray-200 bg-gray-50 overflow-hidden">
                      {/* 1688 사진은 다른 사이트에서 부르면(리퍼러) 막히는 일이 있어 리퍼러 없이 부르고, 작은 사진이 안 되면 원본으로. */}
                      {it.imageUrl && (
                        <img
                          src={`${it.imageUrl}_120x120.jpg`}
                          alt=""
                          referrerPolicy="no-referrer"
                          onError={e => {
                            const img = e.currentTarget;
                            if (img.dataset.fallback) { img.style.display = 'none'; return; }
                            img.dataset.fallback = '1';
                            img.src = it.imageUrl!;
                          }}
                          className="w-full h-full object-cover"
                        />
                      )}
                    </span>
                    <div className="min-w-0 flex-1 text-xs">
                      <div className="text-gray-800 line-clamp-2">{it.title}</div>
                      {it.spec && <div className="text-gray-500 mt-0.5">{it.spec}</div>}
                      <div className="mt-0.5 font-semibold">
                        ¥{it.unitCny.toFixed(2)} × {it.qty}개 <span className="text-gray-400 font-normal">· {won(itemShareKrw(it, rate))}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-2 text-xs">
                    <span className="text-gray-500 whitespace-nowrap">→ 앱 상품</span>
                    {c.mode !== 'skip' && <ProductThumb url={c.name.trim() ? imageOf(c.name.trim()) : ''} size={40} />}
                    <div className="flex-1 min-w-0 space-y-1">
                      <select
                        value={c.mode === 'other' && c.name && otherNames.some(n => n.name === c.name) ? `name:${c.name}` : selectValue}
                        onChange={e => {
                          const v = e.target.value;
                          if (v.startsWith('cart:')) setChoice(k, { mode: 'cart', name: v.slice(5) });
                          else if (v.startsWith('name:')) setChoice(k, { mode: 'other', name: v.slice(5) });
                          else if (v === 'other') setChoice(k, { mode: 'other', name: c.mode === 'other' ? c.name : '' });
                          else setChoice(k, { mode: v as Choice['mode'], name: '' });
                        }}
                        className={`w-full px-2 py-1 border rounded bg-white ${bad ? 'border-red-400' : 'border-gray-300'}`}
                      >
                        <option value="">— 골라 주세요 —</option>
                        {cart.length > 0 && (
                          <optgroup label="🛒 장바구니(발주 대기)">
                            {cart.map(g => (
                              <option key={g.name} value={`cart:${g.name}`}>
                                {g.name} (필요 {g.qty})
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {otherNames.length > 0 && (
                          <optgroup label="📦 다른 앱 상품(여유로 들어가요)">
                            {otherNames.map(n => (
                              <option key={n.name} value={`name:${n.name}`}>{n.name}</option>
                            ))}
                          </optgroup>
                        )}
                        <option value="other">✍️ 직접 입력…</option>
                        <option value="skip">🚫 이 상품은 빼기</option>
                      </select>
                      {c.mode === 'other' && (
                        <input
                          list="import1688-names"
                          value={c.name}
                          onChange={e => setChoice(k, { mode: 'other', name: e.target.value })}
                          placeholder="상품명 입력 → 목록에서 고르기"
                          className="w-full px-2 py-1 border border-gray-300 rounded bg-white"
                        />
                      )}
                    </div>
                    {c.remembered && <span className="text-[11px] text-sky-600 whitespace-nowrap">기억한 짝</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 py-3 border-b">
          <span className="text-base font-bold">📥 1688 주문 가져오기</span>
          <button onClick={load} className="ml-auto text-xs px-2 py-1 border rounded-full text-gray-500 hover:bg-gray-50">새로고침</button>
          <button onClick={onClose} className="text-gray-400 text-xl leading-none px-1">×</button>
        </div>
        <datalist id="import1688-names">
          {names.map(n => <option key={n.name} value={n.name} label={n.from} />)}
        </datalist>
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
          {basket === null && <div className="text-sm text-gray-500 py-8 text-center">불러오는 중…</div>}
          {basket === 'none' && (
            <div className="text-sm text-gray-600 py-6 leading-relaxed">
              1688 확장이 응답하지 않아요.
              <br />· 크롬 확장 관리에서 "1688 상품 캡처 → 로켓"을 새로고침(⟳)한 뒤 이 화면도 새로고침해 주세요.
            </div>
          )}
          {Array.isArray(basket) && !list.length && (
            <div className="text-sm text-gray-600 py-6 leading-relaxed">
              담은 상품이 없어요.
              <br />1688 주문목록(待收货) 화면에서 상품 사진 아래 「＋ 담기」를 눌러 주세요.
            </div>
          )}
          {Array.isArray(basket) && list.length > 0 && !fresh.length && <div className="text-sm text-gray-500">새로 넣을 상품이 없어요(모두 이미 넣었어요).</div>}
          {fresh.map(v => renderOrder(v, false))}
          {used.length > 0 && (
            <button onClick={() => setShowUsed(v => !v)} className="text-xs text-gray-500 underline">
              이미 넣은 상품 {used.reduce((s, v) => s + v.used.length, 0)}개 {showUsed ? '접기' : '보기'}
            </button>
          )}
          {showUsed && used.map(v => renderOrder(v, true))}
        </div>
        <div className="px-5 py-3 border-t flex items-center gap-3">
          <span className="text-xs text-gray-500">
            {missing.length ? <span className="text-red-500 font-semibold">앱 상품을 안 고른 1688 상품이 {missing.length}개 있어요</span> : '사진을 나란히 보고 짝이 맞는지 확인해 주세요'}
          </span>
          <button
            onClick={apply}
            disabled={!pickedOrders.length || missing.length > 0 || saving}
            className="ml-auto px-4 py-2 rounded-full bg-sky-500 text-white text-sm font-bold disabled:bg-gray-300"
          >
            장바구니에 채우기 ({pickedOrders.length}건 · 상품 {itemCount}개)
          </button>
        </div>
      </div>
    </div>
  );
};

export default Import1688Modal;
