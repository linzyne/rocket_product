// 센터 이름 맞추기(한 번씩): "수도권그룹(대구3센터)"·"로켓 인천30" 같은 이름을 "대구3"·"인천30"으로.
// 날짜 변경으로 들어온 이상한 센터 이름과 택배주소 이름을 앱을 켤 때 고친다. 이미 맞는 이름은 건드리지 않는다.
//  · 발주 줄(발주확인·예약·쉽먼트)  · 출고 건  · 쉽먼트 기록(박스가 든 센터)  · 택배주소 관리
import { normalizeCenter } from '../utils/centerName';
import { allLines, commit, linesReady } from './lineStore';
import { fixShipOutCenters } from './shipOutStore';
import { ShipmentBatch, subscribeShipments, saveShipmentBatch } from '../../../data/shipmentStore';
import { subscribeShippingSettings, saveAddresses } from './shippingSettingsStore';
import type { AddressEntry } from '../types';

let started = false;
export function startCenterCleanup() {
  if (started) return;
  started = true;

  linesReady().then(() => {
    const bad = allLines().filter(l => l.place !== 'trash' && normalizeCenter(l.물류센터) !== l.물류센터);
    if (bad.length) commit(bad.map(l => ({ ...l, 물류센터: normalizeCenter(l.물류센터) })));
    // 출고 건 목록이 받아진 뒤에 고친다(조금 기다린다).
    setTimeout(() => { try { fixShipOutCenters(normalizeCenter); } catch (err) { console.error(err); } }, 3000);
  });

  // 쉽먼트 기록: 센터 이름을 고치고, 같은 이름이 된 센터는 박스를 합친다.
  let batchesDone = false;
  const stopB = subscribeShipments((batches: ShipmentBatch[]) => {
    if (batchesDone || !batches.length) return;
    batchesDone = true;
    for (const b of batches) {
      if (!b.centers.some(c => normalizeCenter(c.center) !== c.center)) continue;
      const merged = new Map<string, ShipmentBatch['centers'][number]>();
      for (const c of b.centers) {
        const name = normalizeCenter(c.center);
        const was = merged.get(name);
        merged.set(name, was ? { center: name, boxes: [...was.boxes, ...c.boxes].sort((x, y) => x.boxNo - y.boxNo) } : { ...c, center: name });
      }
      saveShipmentBatch({ ...b, centers: Array.from(merged.values()) }).catch(err => console.error('쉽먼트 기록 센터 이름 고치기 실패:', err));
    }
    setTimeout(() => stopB(), 0);
  });

  // 택배주소 관리: 키(물류센터명)를 고치고, 같은 이름이 둘이 되면 앞의 것을 남긴다.
  let addrDone = false;
  const stopA = subscribeShippingSettings(({ addresses }) => {
    if (addrDone) return;
    addrDone = true;
    if (!addresses.some(a => normalizeCenter(a.key) !== a.key)) return;
    const seen = new Set<string>();
    const next: AddressEntry[] = [];
    for (const a of addresses) {
      const key = normalizeCenter(a.key);
      if (seen.has(key)) continue;
      seen.add(key);
      next.push({ ...a, key });
    }
    saveAddresses(next).catch(err => console.error('택배주소 이름 고치기 실패:', err));
    setTimeout(() => stopA(), 0);
  });
}
