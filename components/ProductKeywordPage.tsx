import React, { useEffect, useMemo, useState } from 'react';
import { HanjungOrder, subscribeHanjung, nameKey, productKeyword, setProductKeywords, subscribeProductKeywords } from '../data/hanjungStore';
import { allLines, subscribeLines } from './coupangOrder/data/lineStore';

// 상품 키워드: 쿠팡 발주와 한중발주(보유재고 포함) 양쪽에 나오는 상품 이름을 모두 모아 보여 주고,
// 사람이 키워드를 정하면 키워드가 같은 이름은 앱 어디서든 같은 상품으로 본다(사무실 재고·한중 여유·배정 모두).
// 이름은 지금 같은 상품으로 보는 것끼리 한 묶음으로 보여 준다. 묶음에 키워드를 넣으면 묶음 안 이름 모두에 붙는다.

interface NameUse { name: string; from: Set<string> }

// 쓰이는 상품 이름 모으기(어디에 나오는지 같이).
const useProductNames = () => {
  const [orders, setOrders] = useState<HanjungOrder[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => subscribeHanjung(setOrders), []);
  useEffect(() => subscribeLines(() => setTick(t => t + 1)), []);
  useEffect(() => subscribeProductKeywords(() => setTick(t => t + 1)), []);
  const names = useMemo(() => {
    void tick;
    const m = new Map<string, NameUse>();
    const add = (raw: string, from: string) => {
      const name = String(raw || '').trim();
      if (!name) return;
      const u = m.get(name) || { name, from: new Set<string>() };
      u.from.add(from);
      m.set(name, u);
    };
    for (const l of allLines()) if (l.place !== 'trash') add(l.상품이름, '쿠팡 발주');
    for (const o of orders) {
      const where = /보유재고/.test(o.code) ? '보유재고' : `한중 ${o.code}`;
      o.lines.forEach(l => add(l.상품이름, where));
      Object.keys(o.orderQty || {}).forEach(n => add(n, where));
      o.receipts.forEach(r => r.items.forEach(it => add(it.상품이름, where)));
    }
    return Array.from(m.values());
  }, [orders, tick]);
  return { names, tick };
};

// 키워드를 아직 안 정한 묶음 수(메뉴 옆 숫자 — 새 상품이 생기면 키워드를 정하라고 알린다).
export const useUnkeyedCount = () => {
  const { names } = useProductNames();
  return useMemo(() => {
    const groups = new Map<string, boolean>();
    names.forEach(n => { const k = nameKey(n.name); groups.set(k, groups.get(k) || !!productKeyword(n.name)); });
    // 쿠팡 발주에만 한 번 나오는 이름도 상품이다. 키워드가 하나도 없는 묶음만 센다.
    return Array.from(groups.values()).filter(has => !has).length;
  }, [names]);
};

const ProductKeywordPage: React.FC = () => {
  const { names, tick } = useProductNames();
  const [search, setSearch] = useState('');
  const [onlyEmpty, setOnlyEmpty] = useState(true);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState('');

  const groups = useMemo(() => {
    void tick;
    const m = new Map<string, NameUse[]>();
    names.forEach(n => { const k = nameKey(n.name); m.set(k, [...(m.get(k) || []), n]); });
    return Array.from(m, ([key, list]) => {
      const kw = list.map(n => productKeyword(n.name)).find(Boolean) || '';
      return { key, list: list.sort((a, b) => a.name.localeCompare(b.name, 'ko')), kw };
    }).sort((a, b) => (a.kw ? 1 : 0) - (b.kw ? 1 : 0) || a.list[0].name.localeCompare(b.list[0].name, 'ko'));
  }, [names, tick]);

  const q = search.replace(/\s+/g, '').toLowerCase();
  const shown = groups.filter(g =>
    (!onlyEmpty || !g.kw || q)
    && (!q || g.kw.replace(/\s+/g, '').toLowerCase().includes(q) || g.list.some(n => n.name.replace(/\s+/g, '').toLowerCase().includes(q))));
  const emptyCount = groups.filter(g => !g.kw).length;

  const save = async (g: typeof groups[number]) => {
    const kw = (draft[g.key] ?? g.kw).trim();
    setSaving(g.key);
    try {
      await setProductKeywords(g.list.map(n => n.name), kw);
      setDraft(prev => { const n = { ...prev }; delete n[g.key]; return n; });
    } catch (err) {
      alert(`키워드 저장 실패: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving('');
    }
  };
  // 같은 키워드를 쓰는 다른 묶음(저장하면 하나로 합쳐진다).
  const mergeWith = (g: typeof groups[number]) => {
    const kw = (draft[g.key] ?? '').replace(/\s+/g, '').toLowerCase();
    if (!kw) return [];
    return groups.filter(o => o.key !== g.key && o.kw.replace(/\s+/g, '').toLowerCase() === kw);
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="sticky top-0 z-10 bg-white border-b border-gray-100 px-5 py-3">
        <div className="max-w-3xl flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-bold">상품 키워드</h1>
          <span className="text-xs text-gray-500">키워드가 같은 상품은 이름이 달라도 같은 상품으로 봐요(재고·여유·배정 모두).</span>
        </div>
        <div className="max-w-3xl flex flex-wrap items-center gap-2 mt-2">
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="상품명·키워드 찾기"
            className="flex-1 min-w-[12rem] px-3 py-1.5 text-sm text-gray-900 bg-white border border-gray-300 rounded-lg placeholder:text-gray-400" />
          <label className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer select-none">
            <input type="checkbox" checked={onlyEmpty} onChange={e => setOnlyEmpty(e.target.checked)} />
            키워드 없는 것만 <b className="text-red-600">{emptyCount}</b>
          </label>
        </div>
      </header>
      <main className="max-w-3xl p-5 space-y-2">
        {!shown.length && <div className="text-sm text-gray-500 py-10 text-center">{onlyEmpty ? '키워드를 안 정한 상품이 없어요 🎉' : '찾는 상품이 없어요'}</div>}
        {shown.map(g => {
          const value = draft[g.key] ?? g.kw;
          const changed = value.trim() !== g.kw;
          const merge = mergeWith(g);
          return (
            <div key={g.key} className={`bg-white rounded-xl border p-3 ${g.kw ? 'border-gray-200' : 'border-red-200'}`}>
              <div className="flex items-center gap-2">
                <input
                  value={value}
                  onChange={e => setDraft(prev => ({ ...prev, [g.key]: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter' && changed) save(g); }}
                  placeholder="키워드 (예: 버터크런치)"
                  className={`w-48 px-2 py-1 text-sm font-semibold text-gray-900 bg-white border rounded-md placeholder:text-gray-400 placeholder:font-normal ${g.kw ? 'border-gray-300' : 'border-red-300'}`}
                />
                <button onClick={() => save(g)} disabled={!changed || saving === g.key}
                  className="px-3 py-1 text-sm font-bold rounded-md bg-blue-600 text-white disabled:bg-gray-200 disabled:text-gray-400">
                  {saving === g.key ? '저장 중…' : '저장'}
                </button>
                {g.kw && !changed && <span className="text-xs text-emerald-600 font-semibold">✓ {g.kw}</span>}
              </div>
              {merge.length > 0 && (
                <div className="mt-1.5 text-xs text-blue-700">저장하면 같은 키워드의 {merge.reduce((n, o) => n + o.list.length, 0)}개 이름과 하나로 합쳐져요: {merge.flatMap(o => o.list.map(n => n.name)).slice(0, 3).join(' / ')}</div>
              )}
              <div className="mt-2 space-y-1">
                {g.list.map(n => (
                  <div key={n.name} className="flex items-baseline gap-2 text-sm">
                    <span className="text-gray-800">{n.name}</span>
                    <span className="text-[11px] text-gray-400 whitespace-nowrap">{Array.from(n.from).join(' · ')}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </main>
    </div>
  );
};

export default ProductKeywordPage;
