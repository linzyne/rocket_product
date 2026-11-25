// 판매량 계산. 로켓 > 판매량 표가 쓴다.
//
// 판매량 = 직전 수집 재고 + 그 사이 입고 − 이 날 재고.
//  · "그 사이"는 날짜가 아니라 수집 시각으로 가른다. 직전 수집 뒤 같은 날 들어온 입고도 빠지지 않게.
//    수집 시각이 없는 옛 기록은, 그날 입고 중 앞 칸이 음수가 되지 않을 만큼만 수집 전 입고로 본다.
//  · 묶음 옵션(…, 2개 / 3개 …)은 쿠팡이 1개짜리 재고를 묶음 수로 나눠 보여줄 뿐이라, 1개짜리와 한 줄로
//    합쳐 낱개 기준으로 센다. 어느 묶음이 몇 건 팔렸는지는 재고로는 알 수 없다.
import type { InventoryItem } from './inventoryStore';
import type { ReceiveRow } from './receiveStore';

export interface SalesGroup {
  key: string;
  // 표에 보여줄 상품(1개짜리).
  base: InventoryItem;
  // 합친 상품과 묶음 수.
  members: { it: InventoryItem; n: number }[];
  // 날짜별 낱개 재고와 수집 시각.
  units: Record<string, number>;
  at: Record<string, number>;
}

export interface SalesCell { day: string; v: number | null; span: number }

const PACK = /^(\d+)\s*개$/;

// "상품명, 옵션, 2개, 30cm" → { n: 2, key: "상품명, 옵션, 30cm" }
const packOf = (name: string) => {
  const parts = String(name || '').split(',').map(s => s.trim());
  const i = parts.findIndex(p => PACK.test(p));
  if (i < 0) return null;
  return { n: Number(PACK.exec(parts[i])![1]), key: parts.filter((_, j) => j !== i).join(', ') };
};

// 묶음 상품의 재고가 정말 1개짜리 재고를 나눈 값인지(같은 재고를 나눠 쓰는지) 본다.
// 따로 재고를 가진 상품을 잘못 합치지 않도록, 같이 모은 날이 하루 이상이고 그날들이 모두 맞을 때만 합친다.
const sharesStock = (one: InventoryItem, pack: InventoryItem, n: number) => {
  const a = one.stockHistory || {};
  const b = pack.stockHistory || {};
  const common = Object.keys(b).filter(d => a[d] != null);
  if (!common.length || !common.some(d => a[d] >= n)) return false;
  return common.every(d => Math.abs(Math.floor(a[d] / n) - b[d]) <= 1);
};

export const groupItems = (items: InventoryItem[]): SalesGroup[] => {
  const byKey = new Map<string, { it: InventoryItem; n: number }[]>();
  const singles: InventoryItem[] = [];
  for (const it of items) {
    const p = packOf(it.productName);
    if (!p) { singles.push(it); continue; }
    const list = byKey.get(p.key) || [];
    list.push({ it, n: p.n });
    byKey.set(p.key, list);
  }
  const single = (it: InventoryItem): SalesGroup => ({
    key: it.adsId, base: it, members: [{ it, n: 1 }], units: { ...(it.stockHistory || {}) }, at: { ...(it.stockAt || {}) },
  });
  const groups = singles.map(single);
  for (const list of byKey.values()) {
    const one = list.find(m => m.n === 1);
    if (!one) { list.forEach(m => groups.push(single(m.it))); continue; }
    const members = [one];
    for (const m of list) {
      if (m === one) continue;
      if (sharesStock(one.it, m.it, m.n)) members.push(m);
      else groups.push(single(m.it));
    }
    // 낱개 재고는 1개짜리 값을 쓰고, 그날 1개짜리를 못 모았으면 묶음 재고 × 묶음 수 중 가장 큰 값으로 어림한다.
    const units: Record<string, number> = { ...(one.it.stockHistory || {}) };
    const at: Record<string, number> = { ...(one.it.stockAt || {}) };
    for (const m of members) {
      if (m === one) continue;
      for (const [d, s] of Object.entries(m.it.stockHistory || {})) {
        if ((one.it.stockHistory || {})[d] != null) continue;
        if (units[d] == null || s * m.n > units[d]) units[d] = s * m.n;
        if (at[d] == null && m.it.stockAt?.[d]) at[d] = m.it.stockAt[d];
      }
    }
    groups.push({ key: one.it.adsId, base: one.it, members, units, at });
  }
  return groups;
};

// 'YYYY-MM-DD' 그날 0시(이 기기 시간).
const dayStart = (d: string) => {
  const [y, m, dd] = d.split('-').map(Number);
  return new Date(y, m - 1, dd).getTime();
};

// 입고 일시('2026-09-22 11:55:13')를 ms로.
const receiveTime = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(String(s || ''));
  if (!m) return NaN;
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)).getTime();
};

export type Receipt = { t: number; qty: number };

// 상품(adsId)별 입고. 짝지어 둔 SKU만 센다(반출은 빼서 더한다).
export const receiptsByItem = (receives: ReceiveRow[], links: Record<string, string>, sign: (r: ReceiveRow) => number) => {
  const map = new Map<string, Receipt[]>();
  for (const r of receives) {
    const adsId = links[r.sku];
    if (!adsId) continue;
    const t = receiveTime(r.date);
    if (!Number.isFinite(t)) continue;
    const list = map.get(adsId) || [];
    list.push({ t, qty: sign(r) * r.qty });
    map.set(adsId, list);
  }
  return map;
};

// 한 묶음(상품)의 날짜별 판매량.
export const salesOf = (g: SalesGroup, byItem: Map<string, Receipt[]>, days: string[], today: string): SalesCell[] => {
  const rs = g.members.flatMap(m => byItem.get(m.it.adsId) || []).sort((a, b) => a.t - b.t);
  const sum = (from: number, to: number) => rs.reduce((s, r) => (r.t > from && r.t <= to ? s + r.qty : s), 0);
  const rec = Object.keys(g.units).sort();

  // 날마다 "이 시각까지 들어온 입고는 그날 재고에 들어 있다"는 기준 시각.
  const cut: Record<string, number> = {};
  rec.forEach((d, i) => {
    if (g.at[d]) { cut[d] = g.at[d]; return; }
    const start = dayStart(d);
    const end = start + 86400000 - 1;
    if (i === 0) { cut[d] = end; return; }
    const p = rec[i - 1];
    let v = g.units[p] + sum(cut[p], start - 1) - g.units[d];
    const today_ = rs.filter(r => r.t >= start && r.t <= end);
    let k = 0;
    while (v < 0 && k < today_.length) { v += today_[k].qty; k++; }
    // 같은 시각에 찍힌 입고는 함께 간다.
    while (k > 0 && k < today_.length && today_[k].t === today_[k - 1].t) k++;
    cut[d] = k === 0 ? start - 1 : k === today_.length ? end : today_[k - 1].t;
  });

  return days.map(day => {
    const cur = g.units[day];
    if (day > today || cur == null) return { day, v: null, span: 0 };
    const i = rec.indexOf(day);
    if (i <= 0) return { day, v: null, span: 0 };
    const prev = rec[i - 1];
    const span = Math.round((dayStart(day) - dayStart(prev)) / 86400000);
    return { day, v: g.units[prev] + sum(cut[prev], cut[day]) - cur, span };
  });
};
