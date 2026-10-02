// 쉽먼트 한 묶음. 쿠팡발주확인에서 "쉽먼트생성"을 누른 순간의 박스 배정을 그대로 남긴다.
// 나중에 롯데 운송장번호를 여기에 채우고, 서허 쉽먼트 일괄등록 양식을 채울 때 이 기록을 본다.
//
//  shipmentBatches : 문서 id = 만든 시각으로 만든 번호(S260923-01 …)
//    센터 → 박스 → 그 박스에 담은 상품들(발주번호·상품명·확정수량). 박스 하나 = 택배 한 건 = 운송장 하나.
import { collection, doc, onSnapshot, setDoc, deleteDoc } from 'firebase/firestore';
import { db, ensureSignedIn } from '../utils/firebase';

export interface ShipmentLine {
  발주번호: string;
  상품이름: string;
  확정수량: number;
  입고예정일: string; // YYYYMMDD
}

export interface ShipmentBox {
  boxNo: number;
  // 롯데에서 받은 운송장번호. 처음에는 비어 있고 A단계(운송장출력)에서 채운다.
  waybill: string;
  lines: ShipmentLine[];
}

export interface ShipmentCenter {
  center: string;
  boxes: ShipmentBox[];
}

export interface ShipmentBatch {
  id: string;
  createdAt: number;
  centers: ShipmentCenter[];
  // reserved: 택배 예약만 함 / waybilled: 운송장번호까지 받음
  status: 'reserved' | 'waybilled';
}

const COLLECTION = 'shipmentBatches';
const LOCAL_KEY = 'shipmentBatches';

export const batchId = (orders: ShipmentBatch[], now = new Date()) => {
  const ymd = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const prefix = `S${ymd}-`;
  const used = orders.filter(b => b.id.startsWith(prefix)).map(b => Number(b.id.slice(prefix.length)) || 0);
  return `${prefix}${String((used.length ? Math.max(...used) : 0) + 1).padStart(2, '0')}`;
};

export const allBoxes = (batch: ShipmentBatch) =>
  batch.centers.flatMap(c => c.boxes.map(b => ({ center: c.center, ...b })));

// 이 출고 건의 쉽먼트 기록들. 출고 건에 붙은 쉽먼트 번호는 믿지 않고(예전 택배예약이 안 끝난 건 전부에 같은 번호를
// 붙였다) 내용으로 확인한다: 센터가 같고, 박스에 든 발주가 모두 이 건의 발주인 박스가 하나라도 있는 기록.
// (예전 기록은 다른 건의 발주가 일부 섞인 박스도 있어서, 모든 박스가 딱 맞기를 바라지는 않는다.)
const batchesForItem = (batches: ShipmentBatch[], item: { center: string; lines: { 발주번호: string }[] }) => {
  const mine = new Set(item.lines.map(l => String(l.발주번호 || '').trim()).filter(Boolean));
  return batches.filter(b => allBoxes(b).some(box =>
    box.center.trim() === item.center.trim() && box.lines.length > 0
    && box.lines.every(l => mine.has(String(l.발주번호 || '').trim()))));
};

// 출고 건의 n번 박스 운송장번호. 이 건의 쉽먼트 기록에서 같은 센터·같은 박스 번호의 번호를 쓴다.
// 그런 기록이 여럿인데 번호가 서로 다르면(같은 건을 여러 번 예약 등) 확실하지 않으니 빈 값을 돌려준다.
export const waybillForBox = (
  batches: ShipmentBatch[],
  item: { center: string; lines: { 발주번호: string }[] },
  no: number,
): string => {
  const mine = new Set(item.lines.map(l => String(l.발주번호 || '').trim()).filter(Boolean));
  const found = new Set<string>();
  for (const b of batchesForItem(batches, item)) {
    for (const box of allBoxes(b)) {
      if (box.boxNo !== no || box.center.trim() !== item.center.trim()) continue;
      // 같은 센터의 다른 출고 건 박스(번호가 같을 수 있다)를 잡지 않게, 이 건의 발주가 든 박스만 본다.
      if (!box.lines.some(l => mine.has(String(l.발주번호 || '').trim()))) continue;
      const w = String(box.waybill || '').replace(/\D/g, '');
      if (w) found.add(w);
    }
  }
  if (found.size !== 1) return '';
  const w = Array.from(found)[0];
  return w.length === 12 ? `${w.slice(0, 4)}-${w.slice(4, 8)}-${w.slice(8)}` : w;
};

// 출고 건의 센터·입고예정일이 바뀌었을 때(요청등록 완료 등) 그 건의 쉽먼트 기록도 같이 옮긴다.
// 이 건의 발주만 든 박스는 새 센터로 옮기고(안 그러면 센터로 찾는 운송장번호가 안 보인다), 이 건 발주 줄의 날짜를 바꾼다.
// 바뀐 기록만 돌려준다. extra: 출고 건에 붙은 쉽먼트 번호로 찾은 기록(센터가 달라 내용으로 못 찾는 예전 기록).
export const retargetBatches = (
  batches: ShipmentBatch[],
  item: { center: string; lines: { 발주번호: string }[] },
  to: { center?: string; date?: string },
  extra?: ShipmentBatch,
): ShipmentBatch[] => {
  const mine = new Set(item.lines.map(l => String(l.발주번호 || '').trim()).filter(Boolean));
  const isMine = (l: { 발주번호: string }) => mine.has(String(l.발주번호 || '').trim());
  const from = item.center.trim();
  const center = (to.center || '').trim();
  const ymd = (to.date || '').replace(/-/g, '');
  const targets = batchesForItem(batches, item);
  if (extra && !targets.some(b => b.id === extra.id)) targets.push(extra);
  return targets.map(batch => {
    const moved: ShipmentBox[] = [];
    const centers = batch.centers.map(c => ({
      ...c,
      boxes: c.boxes
        .map(b => ({ ...b, lines: ymd ? b.lines.map(l => (isMine(l) ? { ...l, 입고예정일: ymd } : l)) : b.lines }))
        .filter(b => {
          const go = !!center && center !== from && c.center.trim() === from
            && b.lines.length > 0 && b.lines.every(isMine);
          if (go) moved.push(b);
          return !go;
        }),
    }));
    if (moved.length) {
      const dest = centers.find(c => c.center.trim() === center);
      if (dest) dest.boxes = [...dest.boxes, ...moved].sort((a, b) => a.boxNo - b.boxNo);
      else centers.push({ center, boxes: moved });
    }
    return { ...batch, centers: centers.filter(c => c.boxes.length) };
  }).filter((next, i) => JSON.stringify(next) !== JSON.stringify(targets[i]));
};

// 출고 건의 운송장번호를 고칠 쉽먼트 기록 하나: 이 건의 기록 중 운송장번호가 든 것 → 최근 것 순.
export const batchForItem = (
  batches: ShipmentBatch[],
  item: { center: string; lines: { 발주번호: string }[] },
): ShipmentBatch | undefined => {
  const hasWaybill = (b: ShipmentBatch) => allBoxes(b).some(box => String(box.waybill || '').trim());
  return batchesForItem(batches, item)
    .sort((a, b) => Number(hasWaybill(b)) - Number(hasWaybill(a)) || b.createdAt - a.createdAt)[0];
};

type Listener = (batches: ShipmentBatch[]) => void;
const localListeners = new Set<Listener>();
const readLocal = (): Record<string, ShipmentBatch> => {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || '') || {};
  } catch {
    return {};
  }
};
const sortBatches = (list: ShipmentBatch[]) => list.sort((a, b) => b.createdAt - a.createdAt);
const writeLocal = (state: Record<string, ShipmentBatch>) => {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
  const list = sortBatches(Object.values(state));
  localListeners.forEach(l => l(list));
};

export const subscribeShipments = (listener: Listener): (() => void) => {
  if (!db) {
    listener(sortBatches(Object.values(readLocal())));
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
      snap => listener(sortBatches(snap.docs.map(d => d.data() as ShipmentBatch))),
      error => console.error('쉽먼트 동기화 실패:', error)
    );
  })();
  return () => {
    cancelled = true;
    unsubscribe?.();
  };
};

export const saveShipmentBatch = async (batch: ShipmentBatch) => {
  if (!db) {
    const s = readLocal();
    s[batch.id] = batch;
    writeLocal(s);
    return;
  }
  await ensureSignedIn();
  await setDoc(doc(db, COLLECTION, batch.id), batch);
};

export const deleteShipmentBatch = async (id: string) => {
  if (!db) {
    const s = readLocal();
    delete s[id];
    writeLocal(s);
    return;
  }
  await ensureSignedIn();
  await deleteDoc(doc(db, COLLECTION, id));
};

// 롯데에서 모아온 운송장번호를 박스에 채운다.
// 예약 엑셀의 주문번호를 "S260923-01-3"처럼 붙여 두었으므로, 끝 숫자가 곧 박스 순서(1번째, 2번째…)다.
// 그 번호가 없을 때만 예전 방식(수하인명으로 센터 맞추기)을 쓴다.
export const fillWaybills = (
  batch: ShipmentBatch,
  collected: { waybill: string; receiver: string; ordNo?: string }[]
): ShipmentBatch => {
  const byOrder = new Map<number, string>();
  for (const w of collected) {
    const m = /-(\d+)\s*$/.exec(String(w.ordNo || ''));
    if (m && w.waybill) byOrder.set(Number(m[1]), w.waybill);
  }
  if (byOrder.size) {
    let no = 0;
    return {
      ...batch,
      centers: batch.centers.map(c => ({
        ...c,
        boxes: c.boxes.map(b => {
          no += 1;
          return { ...b, waybill: b.waybill || byOrder.get(no) || '' };
        }),
      })),
    };
  }
  return fillWaybillsByReceiver(batch, collected);
};

const fillWaybillsByReceiver = (batch: ShipmentBatch, collected: { waybill: string; receiver: string }[]): ShipmentBatch => {
  const byCenter = new Map<string, string[]>();
  for (const w of collected) {
    if (!w.waybill) continue;
    const key = w.receiver.trim();
    byCenter.set(key, [...(byCenter.get(key) || []), w.waybill]);
  }
  return {
    ...batch,
    centers: batch.centers.map(c => {
      // 센터 이름이 조금 달라도(앞뒤 글자) 맞춰 본다.
      const key = Array.from(byCenter.keys()).find(k => k === c.center || k.includes(c.center) || c.center.includes(k));
      const list = key ? byCenter.get(key) || [] : [];
      return {
        ...c,
        boxes: c.boxes.map((b, i) => ({ ...b, waybill: b.waybill || list[i] || '' })),
      };
    }),
  };
};
