
import { QuoteTemplateRegistration } from './quoteTemplates';

// 견적서 파일(base64)은 용량이 커서 localStorage(브라우저당 약 5~10MB 한도)에 넣으면
// 상품 이미지 데이터와 합쳐져 용량 초과로 저장이 조용히 실패할 수 있습니다.
// IndexedDB는 훨씬 큰 저장 한도를 가지므로 견적서 파일은 여기에 저장합니다.
import { openAppDb } from './appDb';

const STORE_NAME = 'quoteTemplates';

const openDb = openAppDb;

export const getAllQuoteTemplates = async (): Promise<QuoteTemplateRegistration[]> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result as QuoteTemplateRegistration[]);
    request.onerror = () => reject(request.error);
  });
};

export const putQuoteTemplate = async (registration: QuoteTemplateRegistration): Promise<void> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(registration);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

export const deleteQuoteTemplate = async (id: string): Promise<void> => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};
