// 쿠팡발주확인의 택배주소(물류센터별 받는 곳)와 보내는사람 설정. 클라우드(Firestore)에 두어 다른 컴퓨터에서도
// 같고, 브라우저 기록을 지워도 남는다. 이 기기의 localStorage에도 같이 남겨서 처음 뜰 때 바로 보이게 한다.
//
//  appSettings/coupangShipping : { addresses, sender, updatedAt }
//
// 클라우드에 아직 저장된 게 없으면(처음 한 번) 이 기기에 있던 값을 올려 보낸다.
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db, ensureSignedIn } from '../../../utils/firebase';
import type { AddressEntry, SenderInfo } from '../types';
import { DEFAULT_ADDRESSES } from './addresses';

const ADDR_KEY = 'shipment_addresses';
const SENDER_KEY = 'shipment_sender';
const DOC_PATH = ['appSettings', 'coupangShipping'] as const;

export const DEFAULT_SENDER: SenderInfo = { name: '', phone1: '', phone2: '', zip: '', addr: '' };

export function loadLocalAddresses(): AddressEntry[] {
  try {
    const saved = localStorage.getItem(ADDR_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return DEFAULT_ADDRESSES;
}

export function loadLocalSender(): SenderInfo {
  try {
    const saved = localStorage.getItem(SENDER_KEY);
    if (saved) return { ...DEFAULT_SENDER, ...JSON.parse(saved) };
  } catch {}
  return DEFAULT_SENDER;
}

const saveLocal = (addresses?: AddressEntry[], sender?: SenderInfo) => {
  try {
    if (addresses) localStorage.setItem(ADDR_KEY, JSON.stringify(addresses));
    if (sender) localStorage.setItem(SENDER_KEY, JSON.stringify(sender));
  } catch {}
};

export const subscribeShippingSettings = (
  listener: (s: { addresses: AddressEntry[]; sender: SenderInfo }) => void
): (() => void) => {
  if (!db) return () => {};
  const firestore = db;
  let cancelled = false;
  let unsubscribe: (() => void) | undefined;
  (async () => {
    await ensureSignedIn();
    if (cancelled) return;
    unsubscribe = onSnapshot(
      doc(firestore, ...DOC_PATH),
      snap => {
        const data = snap.data() as { addresses?: AddressEntry[]; sender?: SenderInfo } | undefined;
        if (!data) {
          // 처음 한 번: 이 기기에 있던 값을 클라우드로 올린다.
          setDoc(doc(firestore, ...DOC_PATH), { addresses: loadLocalAddresses(), sender: loadLocalSender(), updatedAt: Date.now() }).catch(err =>
            console.error('택배주소 올리기 실패:', err)
          );
          return;
        }
        const addresses = data.addresses || loadLocalAddresses();
        const sender = { ...DEFAULT_SENDER, ...(data.sender || {}) };
        saveLocal(addresses, sender);
        listener({ addresses, sender });
      },
      error => console.error('택배주소 동기화 실패(이 기기에 저장된 값을 씁니다):', error)
    );
  })();
  return () => {
    cancelled = true;
    unsubscribe?.();
  };
};

const saveCloud = async (updates: { addresses?: AddressEntry[]; sender?: SenderInfo }) => {
  saveLocal(updates.addresses, updates.sender);
  if (!db) return;
  await ensureSignedIn();
  await setDoc(doc(db, ...DOC_PATH), { ...updates, updatedAt: Date.now() }, { merge: true });
};

export const saveAddresses = (addresses: AddressEntry[]) => saveCloud({ addresses });
export const saveSender = (sender: SenderInfo) => saveCloud({ sender });
