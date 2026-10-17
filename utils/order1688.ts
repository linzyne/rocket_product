// 1688 주문목록에서 담은 주문을 1688 확장(1688-capture-extension)에서 받아 온다.
// 확장의 1688 주문목록 화면(order-list.js)이 chrome.storage에 담아 두고, app-bridge.js가 앱에 넘긴다.
//
//   한중발주 장바구니 "1688 주문 가져오기" --GET_1688_BASKET--> app-bridge.js --1688_BASKET--> 여기
//   주문완료 뒤 --MARK_1688_USED--> app-bridge.js (1688·8282 창에 "앱 넣음" 표시)

const APP_SOURCE = 'rocket-proposal-app';
const EXT_SOURCE = 'rocket-proposal-extension';

export interface Order1688Item {
  offerId: string;
  title: string; // 1688 중국어 상품명
  spec: string; // 옵션(颜色: …; 高度: …)
  unitCny: number;
  qty: number;
  imageUrl: string;
  productUrl: string;
}

export interface Order1688 {
  orderId: string;
  orderTime: string;
  status: string;
  totalCny: number; // 결제금액(운임 포함)
  shipCny: number;
  totalKrw: number; // 1688 화면에 보인 원화. 없으면 0
  items: Order1688Item[];
  packages: { company: string; mailNo: string; last?: string }[];
  addedAt: number;
  used8282At?: number;
  usedAppAt?: number;
  usedAppCode?: string;
}

// 확장이 없으면(또는 앱 주소가 확장 목록에 없으면) null.
export const fetch1688Basket = (timeoutMs = 3000): Promise<Order1688[] | null> =>
  new Promise(resolve => {
    let done = false;
    const finish = (v: Order1688[] | null) => {
      if (done) return;
      done = true;
      window.removeEventListener('message', onMessage);
      window.clearTimeout(timer);
      resolve(v);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.source !== EXT_SOURCE || data.type !== '1688_BASKET') return;
      finish(Array.isArray(data.orders) ? data.orders : []);
    };
    window.addEventListener('message', onMessage);
    const timer = window.setTimeout(() => finish(null), timeoutMs);
    window.postMessage({ source: APP_SOURCE, type: 'GET_1688_BASKET' }, window.location.origin);
  });

export const mark1688Used = (orderIds: string[], code: string) => {
  if (!orderIds.length) return;
  window.postMessage({ source: APP_SOURCE, type: 'MARK_1688_USED', orderIds, code }, window.location.origin);
};

// 1688 상품 하나를 가리키는 열쇠(짝 기억용). 같은 상품이라도 옵션(색상)이 다르면 앱에서는 다른 상품일 수 있어 옵션까지 넣는다.
export const item1688Key = (it: Pick<Order1688Item, 'offerId' | 'title' | 'spec'>) =>
  `${it.offerId || it.title.replace(/\s+/g, '')}|${it.spec.replace(/\s+/g, '')}`;

// 주문 결제금액을 상품별(단가×수량 비율)로 나눈 원화 금액. 1688 화면에 원화가 보였으면 그 값을, 아니면 ¥×환율.
export const itemShareKrw = (o: Order1688, idx: number, cnyRate: number) => {
  const weights = o.items.map(it => it.unitCny * it.qty);
  const sum = weights.reduce((s, w) => s + w, 0);
  const share = sum > 0 ? weights[idx] / sum : 1 / Math.max(1, o.items.length);
  const total = o.totalKrw > 0 ? o.totalKrw : (o.totalCny || sum) * cnyRate;
  return Math.round(total * share);
};

// 앱의 위안화 환율(수익 계산기에서 정한 값). 없으면 210.
export const loadCnyRate = () => {
  try {
    const n = parseFloat(localStorage.getItem('cnyExchangeRate') || '');
    return n > 0 ? n : 210;
  } catch {
    return 210;
  }
};
