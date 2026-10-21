import React, { useEffect, useMemo, useState } from 'react';
import { HanjungOrder, subscribeHanjung, nameKey, productKeyword, setProductKeywords, subscribeProductKeywords } from '../data/hanjungStore';
import { allLines, subscribeLines } from './coupangOrder/data/lineStore';
import { nameSimilarity, splitProductName } from '../data/inventoryStore';

// 상품 키워드: 쿠팡 발주와 한중발주(보유재고 포함) 양쪽에 나오는 상품 이름을 모두 모아 보여 주고,
// 사람이 키워드를 정하면 키워드가 같은 이름은 앱 어디서든 같은 상품으로 본다(사무실 재고·한중 여유·배정 모두).
// 이름은 지금 같은 상품으로 보는 것끼리 한 묶음으로 보여 준다. 묶음에 키워드를 넣으면 묶음 안 이름 모두에 붙는다.

interface NameUse { name: string; from: Set<string> }

// 색 이름이 서로 다르면(블랙·네이비 등) 이름이 비슷해도 다른 상품이다.
const COLORS = ['블랙', '검정', '네이비', '남색', '핑크', '블루', '파랑', '그린', '초록', '퍼플', '보라', '화이트', '흰색', '옐로우', '노랑', '레드', '빨강', '브라운', '갈색', '민트', '그레이', '회색', '베이지', '오렌지', '아이보리', '신랑', '신부'];
const colorsOf = (n: string) => COLORS.filter(c => n.includes(c)).map(c => ({ 검정: '블랙', 남색: '네이비', 파랑: '블루', 초록: '그린', 보라: '퍼플', 흰색: '화이트', 노랑: '옐로우', 빨강: '레드', 갈색: '브라운', 회색: '그레이' } as Record<string, string>)[c] || c);
// 쉼표 뒤 옵션(옷 종류·맛 등)이 둘 다 있는데 서로 다르면 다른 상품이다. 수량·크기 말(1개, 80g, 30cm)은 빼고 본다.
const optionOf = (n: string) => splitProductName(n).option
  .replace(/\d+(\.\d+)?\s*(개|세트|set|g|kg|ml|cm|mm|종|입|p|pcs)?/gi, ' ')
  .replace(/세트|set|단품|개입|종/gi, ' ')
  .replace(/[,()+]/g, ' ').replace(/\s+/g, ' ').trim();
const optionClash = (a: string, b: string) => {
  const oa = optionOf(a);
  const ob = optionOf(b);
  if (!oa || !ob) return false;
  return nameSimilarity(oa, ob) < 0.67;
};
const colorClash = (a: string, b: string) => {
  const ca = new Set(colorsOf(a));
  const cb = new Set(colorsOf(b));
  if (!ca.size || !cb.size) return false;
  return ![...ca].some(c => cb.has(c));
};

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

  // 같은 상품일 수 있는 다른 묶음: 이름이 비슷하고(낱말 75% 이상 겹침) 색이 다르지 않은 것. 비슷한 순으로 5개까지.
  const similar = useMemo(() => {
    const m = new Map<string, { g: typeof groups[number]; score: number }[]>();
    groups.forEach(g => {
      const list = groups
        .filter(o => o.key !== g.key && !(g.kw && o.kw && g.kw === o.kw))
        .map(o => {
          let best = 0;
          for (const a of g.list) for (const b of o.list) {
            if (colorClash(a.name, b.name) || optionClash(a.name, b.name)) continue;
            best = Math.max(best, nameSimilarity(a.name, b.name));
          }
          return { g: o, score: best };
        })
        .filter(x => x.score >= 0.75)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
      m.set(g.key, list);
    });
    return m;
  }, [groups]);
  // 카드마다 같이 묶으려고 체크한 다른 묶음.
  const [checked, setChecked] = useState<Record<string, Set<string>>>({});
  const toggleCheck = (key: string, other: string) => setChecked(prev => {
    const cur = new Set(prev[key] || []);
    if (cur.has(other)) cur.delete(other); else cur.add(other);
    return { ...prev, [key]: cur };
  });

  const q = search.replace(/\s+/g, '').toLowerCase();
  const shown = groups.filter(g =>
    (!onlyEmpty || !g.kw || q)
    && (!q || g.kw.replace(/\s+/g, '').toLowerCase().includes(q) || g.list.some(n => n.name.replace(/\s+/g, '').toLowerCase().includes(q))));
  const emptyCount = groups.filter(g => !g.kw).length;

  const save = async (g: typeof groups[number]) => {
    const kw = (draft[g.key] ?? g.kw).trim();
    if (!kw && (checked[g.key]?.size || 0) > 0) { alert('같이 묶으려면 키워드를 넣어 주세요.'); return; }
    // 같은 키워드로 합쳐질 이름들(이 카드·체크한 후보·이미 그 키워드를 쓰는 묶음) 중 색·옵션이 다른 게 있으면 한 번 더 묻는다.
    if (kw) {
      const all = [
        ...g.list.map(n => n.name),
        ...groups.filter(o => checked[g.key]?.has(o.key)).flatMap(o => o.list.map(n => n.name)),
        ...groups.filter(o => o.key !== g.key && o.kw && o.kw.replace(/\s+/g, '').toLowerCase() === kw.replace(/\s+/g, '').toLowerCase()).flatMap(o => o.list.map(n => n.name)),
      ];
      const clash = clashIn(all);
      if (clash && !window.confirm(`색상이나 옵션이 다른 상품이 같은 키워드로 묶여요:\n· ${clash[0]}\n· ${clash[1]}\n\n보통은 키워드를 다르게 정해요(예: "${kw} ${(colorsOf(clash[0])[0] || '옵션')}"). 그래도 같은 상품으로 묶을까요?`)) return;
    }
    setSaving(g.key);
    try {
      // 이 카드 이름 + 체크한 비슷한 이름 모두에 같은 키워드.
      const extra = groups.filter(o => checked[g.key]?.has(o.key)).flatMap(o => o.list.map(n => n.name));
      await setProductKeywords([...g.list.map(n => n.name), ...extra], kw);
      setDraft(prev => { const n = { ...prev }; delete n[g.key]; return n; });
      setChecked(prev => { const n = { ...prev }; delete n[g.key]; return n; });
    } catch (err) {
      alert(`키워드 저장 실패: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving('');
    }
  };
  // 같은 키워드를 쓰는 다른 묶음(저장하면 하나로 합쳐진다).
  // 묶으려는 이름들 사이에 색·옵션이 다른 쌍이 있는지(있으면 다른 상품일 가능성이 크다).
  const clashIn = (names: string[]) => {
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
      if (colorClash(names[i], names[j]) || optionClash(names[i], names[j])) return [names[i], names[j]];
    }
    return null;
  };
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
          const changed = value.trim() !== g.kw || (checked[g.key]?.size || 0) > 0;
          const sims = similar.get(g.key) || [];
          const merge = mergeWith(g);
          return (
            <div key={g.key} className={`bg-white rounded-xl border p-3 ${g.kw ? 'border-gray-200' : 'border-red-200'}`}>
              <div className="flex items-center gap-2">
                <input
                  value={value}
                  onChange={e => setDraft(prev => ({ ...prev, [g.key]: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter' && changed) save(g); }}
                  placeholder="키워드 (색·옵션까지: 손잡이필통 블랙)"
                  className={`w-48 px-2 py-1 text-sm font-semibold text-gray-900 bg-white border rounded-md placeholder:text-gray-400 placeholder:font-normal ${g.kw ? 'border-gray-300' : 'border-red-300'}`}
                />
                <button onClick={() => save(g)} disabled={!changed || saving === g.key}
                  className="px-3 py-1 text-sm font-bold rounded-md bg-blue-600 text-white disabled:bg-gray-200 disabled:text-gray-400">
                  {saving === g.key ? '저장 중…' : '저장'}
                </button>
                {g.kw && !changed && <span className="text-xs text-emerald-600 font-semibold">✓ {g.kw}</span>}
              </div>
              {merge.length > 0 && (() => {
                const clash = clashIn([...g.list.map(n => n.name), ...merge.flatMap(o => o.list.map(n => n.name))]);
                return clash
                  ? <div className="mt-1.5 text-xs font-bold text-red-600">⚠ 색상·옵션이 다른 상품과 합쳐져요: {merge.flatMap(o => o.list.map(n => n.name)).slice(0, 2).join(' / ')} — 키워드를 다르게 정해 주세요(예: 색상 붙이기)</div>
                  : <div className="mt-1.5 text-xs text-blue-700">저장하면 같은 키워드의 {merge.reduce((n, o) => n + o.list.length, 0)}개 이름과 하나로 합쳐져요: {merge.flatMap(o => o.list.map(n => n.name)).slice(0, 3).join(' / ')}</div>;
              })()}
              <div className="mt-2 space-y-1">
                {g.list.map(n => (
                  <div key={n.name} className="flex items-baseline gap-2 text-sm">
                    <span className="text-gray-800">{n.name}</span>
                    <span className="text-[11px] text-gray-400 whitespace-nowrap">{Array.from(n.from).join(' · ')}</span>
                  </div>
                ))}
              </div>
              {sims.length > 0 && (
                <div className="mt-2 pt-2 border-t border-dashed border-gray-200">
                  <div className="text-[11px] font-bold text-amber-700 mb-1">같은 상품일 수 있어요 · 체크하고 저장하면 같은 키워드로 묶여요</div>
                  {sims.map(({ g: o }) => (
                    <label key={o.key} className="flex items-baseline gap-2 text-sm cursor-pointer select-none py-0.5">
                      <input type="checkbox" checked={!!checked[g.key]?.has(o.key)} onChange={() => toggleCheck(g.key, o.key)} className="translate-y-0.5" />
                      <span className="text-gray-700">{o.list.map(n => n.name).join(' / ')}</span>
                      <span className="text-[11px] text-gray-400 whitespace-nowrap">{Array.from(new Set(o.list.flatMap(n => Array.from(n.from)))).join(' · ')}{o.kw ? ` · 키워드 ${o.kw}` : ''}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </main>
    </div>
  );
};

export default ProductKeywordPage;
