// 통합다운으로 만든 파일들을 쿠팡 서플라이어허브 "대량 상품 등록"(/qvt/registration) 화면까지
// 들고 가는 통로.
//
// 웹 페이지는 supplier.coupang.com에 직접 접속하거나 로그인 세션을 쓸 수 없기 때문에(다른
// 출처라 CORS로 막힙니다), 크롬 확장(1688-capture-extension)에 파일을 넘기고 나머지는
// 확장이 처리합니다. 앱 -> 확장 방향의 통신은 확장의 app-bridge.js가 window.postMessage를
// 받아서 중계합니다.
//
//   App.tsx --postMessage--> app-bridge.js --chrome.storage에 저장--> background.js
//     -> 등록 화면을 열고 -> supplier.js가 01/02/03 첨부 + 해당없음 선택 + 약관 동의 + 파일 검증
//
// 파일 자체는 sendMessage로 넘기지 않고 app-bridge가 chrome.storage.local에 직접 넣습니다.
// 이미지 zip이 수 MB까지 갈 수 있어, 메시지 크기 제한을 피하려는 것입니다.

declare var JSZip: any;

const APP_SOURCE = 'rocket-proposal-app';
const EXT_SOURCE = 'rocket-proposal-extension';
// 확장이 설치돼 있으면 응답은 곧바로 옵니다. 다만 파일 저장까지 기다리므로 조금 넉넉하게 둡니다.
const ACK_TIMEOUT_MS = 8000;

export interface ProposalFile {
  name: string;
  blob: Blob;
}

export interface ProposalPayload {
  productName?: string;
  /** 01번: 작성 완료된 견적서 엑셀. */
  quote: ProposalFile;
  /** 02번: 대표/상세 이미지 zip. */
  imagesZip?: ProposalFile | null;
  /** 03번: 제품 필수 표시사항(바코드 라벨 도안) 이미지들. 옵션마다 한 장씩. */
  labels?: ProposalFile[];
}

export interface ProposeQuoteResult {
  ok: boolean;
  /** 확장이 아예 응답하지 않은 경우(미설치, 또는 앱 주소가 확장 매치 목록에 없음). */
  noExtension?: boolean;
  error?: string;
}

const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('파일을 읽지 못했습니다.'));
    reader.readAsDataURL(blob);
  });

const toTransferable = async (file: ProposalFile) => ({
  name: file.name,
  dataUrl: await blobToDataUrl(file.blob),
});

export const sendProposalToSupplierHub = async (payload: ProposalPayload): Promise<ProposeQuoteResult> => {
  const message = {
    source: APP_SOURCE,
    type: 'PROPOSE_QUOTE',
    productName: payload.productName || '',
    quote: await toTransferable(payload.quote),
    imagesZip: payload.imagesZip ? await toTransferable(payload.imagesZip) : null,
    labels: await Promise.all((payload.labels || []).map(toTransferable)),
  };

  return new Promise<ProposeQuoteResult>((resolve) => {
    let settled = false;

    const finish = (result: ProposeQuoteResult) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      window.clearTimeout(timer);
      resolve(result);
    };

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.source !== EXT_SOURCE || data.type !== 'PROPOSE_QUOTE_ACK') return;
      finish({ ok: !!data.ok, error: data.error || undefined });
    };

    const timer = window.setTimeout(() => finish({ ok: false, noExtension: true }), ACK_TIMEOUT_MS);
    window.addEventListener('message', onMessage);

    window.postMessage(message, window.location.origin);
  });
};

// ---------------------------------------------------------------------------
// 카테고리 견적서 찾기
//
// 앱에서 키워드를 보내면 확장이 서플라이어허브를 백그라운드 탭으로 열어 검색하고,
// 결과 목록 -> (앱에서 선택) -> 견적서 파일을 이 앱으로 돌려보냅니다.
// ---------------------------------------------------------------------------

export interface CategoryEvents {
  onResults: (items: string[]) => void;
  onFile: (file: { name: string; dataUrl: string; path: string }) => void;
  onError: (message: string) => void;
}

/** 확장이 보내오는 카테고리 관련 메시지를 구독합니다. 해제 함수를 돌려줍니다. */
export const subscribeCategoryEvents = (events: CategoryEvents): (() => void) => {
  const onMessage = (event: MessageEvent) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== EXT_SOURCE) return;
    if (data.type === 'CATEGORY_RESULTS') events.onResults(Array.isArray(data.items) ? data.items : []);
    else if (data.type === 'CATEGORY_FILE') events.onFile({ name: data.name, dataUrl: data.dataUrl, path: data.path });
    else if (data.type === 'CATEGORY_ERROR') events.onError(String(data.message || '알 수 없는 오류'));
  };
  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
};

const requestWithAck = (message: Record<string, unknown>, ackType: string): Promise<ProposeQuoteResult> =>
  new Promise((resolve) => {
    let settled = false;
    const finish = (result: ProposeQuoteResult) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      window.clearTimeout(timer);
      resolve(result);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.source !== EXT_SOURCE || data.type !== ackType) return;
      finish({ ok: !!data.ok, error: data.error || undefined });
    };
    const timer = window.setTimeout(() => finish({ ok: false, noExtension: true }), ACK_TIMEOUT_MS);
    window.addEventListener('message', onMessage);
    window.postMessage({ source: APP_SOURCE, ...message }, window.location.origin);
  });

/** 키워드로 카테고리 검색을 요청합니다. 결과는 subscribeCategoryEvents로 옵니다. */
export const searchCategories = (keyword: string) =>
  requestWithAck({ type: 'CATEGORY_SEARCH', keyword }, 'CATEGORY_SEARCH_ACK');

/** 목록에서 고른 카테고리의 견적서를 받아옵니다. 파일도 subscribeCategoryEvents로 옵니다. */
export const pickCategory = (path: string) =>
  requestWithAck({ type: 'CATEGORY_PICK', path }, 'CATEGORY_PICK_ACK');

/** 검색을 중단하고 열어둔 서플라이어허브 탭을 닫습니다. */
export const cancelCategorySearch = () => {
  window.postMessage({ source: APP_SOURCE, type: 'CATEGORY_CANCEL' }, window.location.origin);
};

export const dataUrlToFile = (dataUrl: string, fileName: string): File => {
  const [meta, base64 = ''] = dataUrl.split(',');
  const mime = (meta.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], fileName, { type: mime });
};

/**
 * 서플라이어허브가 내려주는 카테고리 견적서는 zip으로 묶여 오는 경우가 있습니다
 * (카테고리를 여러 개 고를 수 있어서). 그 안의 엑셀을 꺼내 씁니다.
 *
 * 주의: xlsx 자체도 zip 컨테이너라 "열린다"는 것만으로는 구분이 안 됩니다.
 * 엑셀 파일이면 안에 [Content_Types].xml이 있으므로 그것으로 가려냅니다.
 */
export const unwrapDownloadedQuote = async (file: File, preferredName?: string): Promise<File> => {
  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  let zip: any;
  try {
    zip = await new JSZip().loadAsync(await file.arrayBuffer());
  } catch (error) {
    return file; // zip이 아니면 그대로 사용
  }
  if (zip.file('[Content_Types].xml')) return file; // 이미 엑셀 파일

  const entry = Object.values(zip.files).find(
    (f: any) => !f.dir && /\.xlsx?$/i.test(f.name),
  ) as any;
  if (!entry) return file;

  const blob = await entry.async('blob');
  const innerName = String(entry.name).split('/').pop() || 'quote.xlsx';
  return new File([blob], preferredName || innerName, { type: XLSX_MIME });
};
