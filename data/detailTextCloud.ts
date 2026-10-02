import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, ensureSignedIn, isFirebaseConfigured, waitAtMost } from '../utils/firebase';

// 상품(1688 URL)마다 상세페이지의 글만 클라우드에 둔다. 사진은 넣지 않는다 — 넣으면 문서 하나가
// Firestore 한도(1MB)를 넘고 비용도 커진다. 그래서 다른 컴퓨터에서 열면 글은 그대로 오고,
// 사진만 다시 올리면 된다. 기본 템플릿은 사진을 올린 순서대로 자리를 채우므로 같은 순서로 올리면
// 원래 자리로 들어간다.
//
//  detailPageTexts/{URL의 해시} : { url, savedAt, photoCount, json }
//
// 내용은 JSON 글자 하나로 넣는다. Firestore는 undefined 값이나 배열 속 배열을 받지 않아서,
// 에디터 상태를 그대로 넣으면 어느 날 갑자기 저장이 실패할 수 있다.

const COLLECTION = 'detailPageTexts';
// 문서 한도(1MB)보다 넉넉히 작게. 넘으면 손그림(drawObjects)부터 뺀다.
const MAX_BYTES = 800_000;

interface StoredRecord {
  url: string;
  savedAt: number;
  photoCount: number;
  json: string;
}

export interface DetailTextRecord<T> {
  savedAt: number;
  photoCount: number;
  data: T;
}

// URL에는 '/'가 들어 있어 문서 이름으로 못 쓰므로 해시로 바꾼다.
// 1688 주소는 같은 상품이어도 뒤에 붙는 ?spm=… 꼬리가 열 때마다 달라서, 상품번호(offer/숫자)만 본다.
const docIdForUrl = async (url: string): Promise<string> => {
  const offer = url.match(/offer\/(\d+)/);
  const key = offer ? `1688:${offer[1]}` : url.trim().split('?')[0];
  const bytes = new TextEncoder().encode(key);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
};

export async function loadDetailText<T>(url: string): Promise<DetailTextRecord<T> | null> {
  if (!isFirebaseConfigured || !db || !url.trim()) return null;
  const firestore = db;
  try {
    await ensureSignedIn();
    const snap = await waitAtMost(getDoc(doc(firestore, COLLECTION, await docIdForUrl(url))), 10000);
    if (!snap || !snap.exists()) return null;
    const record = snap.data() as StoredRecord;
    return { savedAt: record.savedAt, photoCount: record.photoCount, data: JSON.parse(record.json) as T };
  } catch (error) {
    console.error('저장해둔 상세페이지 글을 불러오지 못했습니다.', error);
    return null;
  }
}

export async function saveDetailText<T extends { drawObjects?: unknown[] }>(url: string, photoCount: number, data: T): Promise<void> {
  if (!isFirebaseConfigured || !db || !url.trim()) return;
  const firestore = db;
  const byteLength = (text: string) => new TextEncoder().encode(text).length;
  let json = JSON.stringify(data);
  if (byteLength(json) > MAX_BYTES) json = JSON.stringify({ ...data, drawObjects: [] });
  if (byteLength(json) > MAX_BYTES) {
    console.warn('상세페이지 글이 너무 커서 클라우드에 저장하지 않았습니다.');
    return;
  }
  try {
    await ensureSignedIn();
    const record: StoredRecord = { url: url.trim(), savedAt: Date.now(), photoCount, json };
    await waitAtMost(setDoc(doc(firestore, COLLECTION, await docIdForUrl(url)), record));
  } catch (error) {
    console.error('상세페이지 글을 클라우드에 저장하지 못했습니다.', error);
  }
}
