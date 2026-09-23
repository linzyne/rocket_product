// 재고 > 상품관리 데이터. "로켓 서허 연동" 확장이 쿠팡 광고 화면에서 모아온 상품·로켓센터 재고와,
// 사무실 재고(직접 입력)를 같은 문서에 저장한다.
//
//  inventoryItems : 문서 id = 광고 화면의 상품 ID. 확장에서 다시 가져올 때는 병합 저장이라
//                   사무실 재고는 지워지지 않는다.
//
// Firebase 설정이 없으면 이 기기의 localStorage에만 저장한다.
import { collection, doc, onSnapshot, writeBatch, setDoc } from 'firebase/firestore';
import { db, ensureSignedIn } from '../utils/firebase';

export interface InventoryItem {
  adsId: string;
  productName: string;
  // 로켓센터 재고. 품절이면 0, 화면에서 못 읽었으면 null.
  stock: number | null;
  soldOut: boolean;
  adState: string;
  imageUrl: string;
  collectedAt: number;
  // 마지막으로 가져온 목록에 있었는지. 빠진 상품은 지우지 않고 숨겨둔다.
  inLatest: boolean;
  officeQty?: number | null;
  officeUpdatedAt?: number;
  // 날짜별 기록('YYYY-MM-DD' -> 수량). 월별 표·어제 대비·판매량 계산에 쓴다.
  // stockHistory는 그날 마지막으로 모은 로켓센터 재고, officeHistory는 그날 마지막으로 고친 사무실 재고
  // (고치지 않은 날은 앞날 값이 이어진다).
  stockHistory?: Record<string, number>;
  officeHistory?: Record<string, number | null>;
}

// 이 기기 시간 기준 날짜 키.
export const dateKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// 기록 중 가장 최근 날짜의 값과 그 앞 기록 날짜의 값. 어제 대비 표시에 쓴다.
export const lastTwoStocks = (item: InventoryItem) => {
  const h = item.stockHistory || {};
  const days = Object.keys(h).sort();
  const lastDay = days[days.length - 1];
  const prevDay = days[days.length - 2];
  return { lastDay, last: lastDay ? h[lastDay] : null, prevDay, prev: prevDay ? h[prevDay] : null };
};

// 사무실 재고는 고친 날만 기록되므로, 그 날짜 이전의 가장 최근 기록을 쓴다.
export const officeOn = (item: InventoryItem, day: string): number | null => {
  const h = item.officeHistory || {};
  const before = Object.keys(h).filter(d => d <= day).sort();
  return before.length ? h[before[before.length - 1]] ?? null : null;
};

// 확장이 넘겨주는 모양(rocket-hub-extension/panel.js의 hubData).
export interface HubData {
  adsStock?: {
    items: Record<string, { key: string; seenAt?: number; adsId: string; productName: string; stock: number | null; soldOut: boolean; adState: string; imageUrl?: string }>;
    startedAt?: number;
    updatedAt?: number;
  };
}

const COLLECTION = 'inventoryItems';
const LOCAL_KEY = 'rocketInventory';

type Listener = (items: InventoryItem[]) => void;
const localListeners = new Set<Listener>();
const readLocal = (): Record<string, InventoryItem> => {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || '') || {};
  } catch {
    return {};
  }
};
const writeLocal = (state: Record<string, InventoryItem>) => {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
  localListeners.forEach(l => l(Object.values(state)));
};

export const subscribeInventory = (listener: Listener): (() => void) => {
  if (!db) {
    listener(Object.values(readLocal()));
    localListeners.add(listener);
    return () => localListeners.delete(listener);
  }
  const firestore = db;
  let cancelled = false;
  let unsubscribe: (() => void) | undefined;
  (async () => {
    await ensureSignedIn();
    if (cancelled) return;
    unsubscribe = onSnapshot(
      collection(firestore, COLLECTION),
      snap => listener(snap.docs.map(d => d.data() as InventoryItem)),
      error => console.error('재고 동기화 실패:', error)
    );
  })();
  return () => {
    cancelled = true;
    unsubscribe?.();
  };
};

// 병합 저장 시 기록(map)도 합쳐지게 한다(Firestore의 merge와 같은 동작).
const mergeLocal = (prev: InventoryItem | undefined, u: Partial<InventoryItem>): InventoryItem => ({
  ...(prev || {}),
  ...u,
  stockHistory: { ...(prev?.stockHistory || {}), ...(u.stockHistory || {}) },
  officeHistory: { ...(prev?.officeHistory || {}), ...(u.officeHistory || {}) },
} as InventoryItem);

export const setOfficeQty = async (adsId: string, qty: number | null) => {
  const now = Date.now();
  const updates: Partial<InventoryItem> = { officeQty: qty, officeUpdatedAt: now, officeHistory: { [dateKey(now)]: qty } };
  if (!db) {
    const s = readLocal();
    if (!s[adsId]) return;
    s[adsId] = mergeLocal(s[adsId], updates);
    writeLocal(s);
    return;
  }
  await ensureSignedIn();
  await setDoc(doc(db, COLLECTION, adsId), updates, { merge: true });
};

// 확장에서 받은 값을 저장한다. 사무실 재고는 건드리지 않는다.
// 이번에 받은 목록에 없는 기존 상품은 inLatest=false로만 표시한다(페이지를 끝까지 안 넘긴 경우도 있어서).
export const importHubData = async (hub: HubData, existing: InventoryItem[]) => {
  const now = Date.now();
  const incoming = Object.values(hub.adsStock?.items || {});
  if (!incoming.length) return 0;

  const writes: Array<[string, Partial<InventoryItem>]> = incoming.map(it => [it.adsId, {
    adsId: it.adsId,
    productName: it.productName,
    stock: it.stock,
    soldOut: it.soldOut,
    adState: it.adState,
    // 사진을 못 찾은 항목은 빈 값으로 덮지 않는다(전에 저장된 사진 유지).
    ...(it.imageUrl ? { imageUrl: it.imageUrl } : {}),
    collectedAt: it.seenAt || now,
    inLatest: true,
    ...(it.stock == null ? {} : { stockHistory: { [dateKey(it.seenAt || now)]: it.stock } }),
  }]);
  const fresh = new Set(incoming.map(it => it.adsId));
  existing.filter(e => !fresh.has(e.adsId) && e.inLatest !== false).forEach(e => writes.push([e.adsId, { inLatest: false }]));

  if (!db) {
    const s = readLocal();
    writes.forEach(([id, u]) => { s[id] = mergeLocal(s[id], u); });
    writeLocal(s);
    return incoming.length;
  }

  const firestore = db;
  await ensureSignedIn();
  // Firestore 일괄 쓰기는 한 번에 500개까지.
  for (let i = 0; i < writes.length; i += 450) {
    const batch = writeBatch(firestore);
    writes.slice(i, i + 450).forEach(([id, u]) => batch.set(doc(firestore, COLLECTION, id), u, { merge: true }));
    await batch.commit();
  }
  return incoming.length;
};

// 광고 화면 상품명은 "상품명, 옵션, 1개" 모양이라 첫 쉼표 앞을 상품명, 뒤를 옵션으로 나눈다.
export const splitProductName = (name: string) => {
  const i = name.indexOf(',');
  return i < 0 ? { base: name.trim(), option: '' } : { base: name.slice(0, i).trim(), option: name.slice(i + 1).trim() };
};
