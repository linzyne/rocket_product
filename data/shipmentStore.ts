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
