
// 앱이 쓰는 IndexedDB 한 곳. 여러 파일이 같은 DB를 제각각 열면 버전이 어긋나
// "requested version (1) is less than the existing version (2)" 오류가 나므로,
// 열기는 여기서만 하고 스토어도 여기서 다 만듭니다.
//
// 스토어를 새로 추가할 때: STORES에 이름을 넣고 DB_VERSION을 1 올리면 됩니다.

const DB_NAME = 'rocket-proposal-db';
const DB_VERSION = 2;

// [스토어 이름, keyPath] — keyPath가 없으면 키를 직접 넘기는(out-of-line) 스토어.
const STORES: Array<[string, string | null]> = [
  ['quoteTemplates', 'id'],
  ['fileHandles', null],
];

let dbPromise: Promise<IDBDatabase> | null = null;

export const openAppDb = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const [name, keyPath] of STORES) {
        if (db.objectStoreNames.contains(name)) continue;
        db.createObjectStore(name, keyPath ? { keyPath } : undefined);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });
  return dbPromise;
};
