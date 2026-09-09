import { openAppDb } from './appDb';

// 만들다 만 상세페이지를 이 컴퓨터에 보관한다. 사진이 통째로 들어가 수십 MB가 되므로
// localStorage(5~10MB)로는 안 되고 IndexedDB를 쓴다.
//
// 클라우드가 아니라 이 브라우저 안이다 — 다른 컴퓨터에서는 보이지 않는다.

const STORE = 'detailPageDrafts';

interface DraftRecord<T> {
  id: string;
  savedAt: number;
  data: T;
}

export async function saveDetailPageDraft<T>(id: string, data: T): Promise<void> {
  try {
    const db = await openAppDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ id, savedAt: Date.now(), data } as DraftRecord<T>);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch (error) {
    // 저장에 실패했다고 작업을 막을 이유는 없다 — 알려만 두고 넘어간다.
    console.error('상세페이지 작업 내용을 저장하지 못했습니다.', error);
  }
}

export async function loadDetailPageDraft<T>(id: string): Promise<{ data: T; savedAt: number } | null> {
  try {
    const db = await openAppDb();
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
      request.onsuccess = () => {
        const record = request.result as DraftRecord<T> | undefined;
        resolve(record ? { data: record.data, savedAt: record.savedAt } : null);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('저장해둔 상세페이지를 불러오지 못했습니다.', error);
    return null;
  }
}

export async function deleteDetailPageDraft(id: string): Promise<void> {
  try {
    const db = await openAppDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (error) {
    console.error('저장해둔 상세페이지를 지우지 못했습니다.', error);
  }
}
