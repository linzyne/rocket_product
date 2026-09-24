// 화면별 수집기. 화면 하나당 "지금 보이는 화면에서 어떤 값을 뽑을지"만 정합니다.
// 나중에 정산·입고·발주를 붙일 때도 여기에 수집기를 하나씩 더하면 됩니다.
//
// 각 수집기:
//   id      저장소에서 쓰는 이름(모은 항목은 id별로 따로 쌓임)
//   label   패널에 보이는 이름
//   match   이 화면에서 도는지(location 기준)
//   collect 지금 화면에서 항목 배열을 뽑음. 항목마다 key가 있어야 함(같은 key는 덮어씀)
//
// 화면 구조(클래스명)는 쿠팡이 언제든 바꿀 수 있으므로 눈에 보이는 제목 글자로 칸을 찾습니다.
(() => {
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const toNumber = (s) => {
    const n = parseInt(String(s || '').replace(/[^\d]/g, ''), 10);
    return Number.isFinite(n) ? n : null;
  };

  // 카드 안에서 상품 사진 고르기. "광고효율UP" 같은 뱃지도 <img>라서 첫 번째 이미지를 쓰면 안 되고,
  // 화면 아래쪽 카드는 사진을 늦게 불러와서(lazy) src가 비어 있거나 자리표시 이미지일 수 있습니다.
  // 그래서 data-src 등도 보고, 가로세로가 정사각형에 가까운 것 중 가장 큰 것을 고릅니다.
  const imageUrlOf = (img) => {
    const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset') || '';
    const url = img.currentSrc || img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-original') || img.getAttribute('data-lazy') || srcset.split(/[\s,]+/)[0] || '';
    return /^(https?:)?\/\//.test(url) ? new URL(url, location.href).href : '';
  };
  const bgUrlOf = (el) => {
    const bg = getComputedStyle(el).backgroundImage || '';
    const m = /url\(["']?([^"')]+)["']?\)/.exec(bg);
    return m && /^(https?:)?\/\//.test(m[1]) ? new URL(m[1], location.href).href : '';
  };
  // 후보는 <img>와 배경 이미지(CSS background-image) 둘 다. 크기는 화면에 그려진 크기로 비교합니다
  // (뱃지는 가로로 길고, 상품 사진은 정사각형에 가깝습니다).
  const pickProductImage = (card) => {
    const candidates = [];
    for (const img of card.querySelectorAll('img')) candidates.push([img, imageUrlOf(img)]);
    for (const el of card.querySelectorAll('div,span,a,i,figure')) {
      const url = bgUrlOf(el);
      if (url) candidates.push([el, url]);
    }
    let best = '';
    let bestScore = -1;
    for (const [el, url] of candidates) {
      if (!url || /badge|icon|logo|\.svg|\.gif/i.test(url)) continue;
      if (/광고효율|뱃지|badge/i.test(`${el.alt || ''} ${el.title || ''} ${el.className || ''}`)) continue;
      const rect = el.getBoundingClientRect();
      const w = rect.width || el.naturalWidth || 0;
      const h = rect.height || el.naturalHeight || 0;
      const ratio = w && h ? w / h : 1;
      if (ratio < 0.7 || ratio > 1.4) continue;
      // 크기를 아직 모르면(안 그려짐) 후보로는 두되 가장 낮은 순위.
      const score = w * h;
      if (score > bestScore) {
        best = url;
        bestScore = score;
      }
    }
    return best;
  };

  // 확인용: 카드 몇 장의 구조(HTML). 사진이 어디 있는지 모를 때 "원본 저장" 파일에 같이 담습니다.
  window.__rocketHubSampleCards = () => {
    const cards = [];
    for (const el of document.querySelectorAll('body *')) {
      if (cards.length >= 3) break;
      if (el.children.length > 3 || !/ID\s*:\s*\d{6,}/.test(el.textContent || '')) continue;
      if (Array.from(el.children).some((c) => /ID\s*:\s*\d{6,}/.test(c.textContent || ''))) continue;
      let card = el;
      for (let i = 0; i < 8 && card && !/재고량/.test(card.textContent || ''); i++) card = card.parentElement;
      const row = card && (card.closest('tr') || card.parentElement);
      if (row && !cards.some((c) => c.el === row)) cards.push({ el: row });
    }
    return cards.map(({ el }) => el.outerHTML.slice(0, 20000));
  };

  // 쿠팡 광고 "상품 대시보드"의 상품 카드. 카드마다 "ID: 123..."와 "재고량: 436개(또는 품절)"가 있습니다.
  const collectAdsStock = () => {
    const activeTab = Array.from(document.querySelectorAll('*')).find((el) => {
      if (el.children.length > 2) return false;
      const t = clean(el.textContent);
      if (t !== '광고 중인 상품' && t !== '광고하지 않는 상품') return false;
      const cls = String(el.className || '') + ' ' + String((el.parentElement && el.parentElement.className) || '');
      return /active|selected|on\b|current/i.test(cls) || el.getAttribute('aria-selected') === 'true';
    });
    const adState = activeTab ? (clean(activeTab.textContent) === '광고 중인 상품' ? 'ad' : 'noad') : '';

    // "ID: 숫자"를 직접 담은 가장 작은 요소들.
    const idEls = Array.from(document.querySelectorAll('body *')).filter((el) => {
      if (el.children.length > 3) return false;
      return /ID\s*:\s*\d{6,}/.test(el.textContent || '') && !Array.from(el.children).some((c) => /ID\s*:\s*\d{6,}/.test(c.textContent || ''));
    });

    const items = new Map();
    for (const idEl of idEls) {
      const adsId = (/ID\s*:\s*(\d{6,})/.exec(idEl.textContent) || [])[1];
      if (!adsId || items.has(adsId)) continue;
      // 재고량 글자까지 들어 있는 가장 가까운 조상 = 카드 한 장.
      let card = idEl;
      for (let i = 0; i < 8 && card && !/재고량/.test(card.textContent || ''); i++) card = card.parentElement;
      if (!card) continue;
      const text = card.innerText || card.textContent || '';
      const m = /재고량\s*:?\s*(품절|[\d,]+)/.exec(text);
      const stock = !m ? null : m[1] === '품절' ? 0 : toNumber(m[1]);
      const lines = text.split('\n').map(clean).filter(Boolean);
      const idLine = lines.findIndex((l) => l.includes(adsId));
      let productName = '';
      for (let i = idLine - 1; i >= 0; i--) {
        if (/광고효율|^선택/.test(lines[i])) continue;
        productName = lines[i];
        break;
      }
      // 사진은 글자 영역(card) 밖, 같은 상품 링크(vendorItemId=ID) 안에 있습니다.
      const linkImg = document.querySelector(`a[href*="vendorItemId=${adsId}"] img`);
      const imageUrl = (linkImg && imageUrlOf(linkImg)) || pickProductImage(card);
      const item = { key: adsId, adsId, productName, stock, soldOut: !!m && m[1] === '품절', adState };
      // 사진을 못 찾았으면 빈 값으로 덮지 않도록 아예 넣지 않습니다(전에 잡아둔 사진 유지).
      if (imageUrl) item.imageUrl = imageUrl;
      items.set(adsId, item);
    }
    return Array.from(items.values());
  };

  // 광고 화면이 받아오는 상품 목록 응답(/marketing/product-api/vendor-items, vendor-items-advertised)에서
  // 바로 뽑기. 화면 글자보다 정확하고, 스크롤하지 않아도 그 페이지 50개가 다 들어옵니다.
  const COUPANG_THUMB = 'https://thumbnail.coupangcdn.com/thumbnails/remote/160x160/image/';
  const fromAdsResponse = (url, json) => {
    if (!/\/product-api\/vendor-items/.test(url) || !json || !Array.isArray(json.vendorItems)) return [];
    const advertisedList = /vendor-items-advertised/.test(url);
    return json.vendorItems
      .filter((v) => v && v.vendorItemId)
      .map((v) => {
        const soldOut = !!v.isSoldOut || Number(v.stockQuantity) <= 0;
        const item = {
          key: String(v.vendorItemId),
          adsId: String(v.vendorItemId),
          productName: clean(v.itemName),
          stock: soldOut ? 0 : Number(v.stockQuantity),
          soldOut,
          adState: advertisedList || v.isAd ? 'ad' : 'noad',
        };
        if (v.mainImagePath) item.imageUrl = COUPANG_THUMB + String(v.mainImagePath).replace(/^\/+/, '');
        return item;
      });
  };

  // 서허 "입고상세내역"(scm/receive/detail) 표.
  // 칸: 구분 | 번호(발주번호) | SKU 번호 | SKU 명 | 입고/반출일자 | 물류센터 | 세금타입 | 수량 | 단가 | 공급가액 | 세액
  //     | 총 단가 | 총 공급가액 | 총 세액 | 계산서번호 | 지급일
  // 제목 줄과 내용 줄이 서로 다른 <table>일 수 있어서, 제목 줄을 찾은 뒤 같은 묶음 안에서 칸 수가 같은 줄을 읽습니다.
  const collectReceiveTable = () => {
    const header = Array.from(document.querySelectorAll('tr')).find((tr) => {
      const t = clean(tr.textContent);
      return /SKU\s*번호/.test(t) && /수량/.test(t) && /번호/.test(t);
    });
    if (!header) return [];
    const names = Array.from(header.querySelectorAll('th,td')).map((c) => clean(c.textContent));
    const col = (re) => names.findIndex((n) => re.test(n));
    const idx = {
      type: col(/^구분$/), orderNo: col(/^번호$/), sku: col(/^SKU\s*번호$/), skuName: col(/^SKU\s*명$/),
      date: col(/일자/), center: col(/물류센터/), qty: col(/^수량$/), unit: col(/^단가$/),
      supply: col(/^공급가액$/), tax: col(/^세액$/), total: col(/^총\s*단가$/), totalSupply: col(/^총\s*공급가액$/),
      totalTax: col(/^총\s*세액$/), invoice: col(/계산서/), payDate: col(/지급일/),
    };
    if (idx.orderNo < 0 || idx.qty < 0) return [];

    let scope = header.closest('table');
    for (let i = 0; i < 4 && scope && scope.parentElement; i++) {
      scope = scope.parentElement;
      if (scope.querySelectorAll('tr').length > 2) break;
    }
    const num = (v) => {
      const n = Number(String(v || '').replace(/[^\d.-]/g, ''));
      return Number.isFinite(n) ? n : 0;
    };
    const items = [];
    for (const tr of (scope || document).querySelectorAll('tr')) {
      if (tr === header || tr.querySelector('th')) continue;
      const cells = Array.from(tr.querySelectorAll('td')).map((td) => clean(td.textContent));
      if (cells.length < names.length - 1) continue;
      const get = (i) => (i >= 0 ? cells[i] || '' : '');
      const orderNo = get(idx.orderNo).replace(/[^\d]/g, '');
      if (!orderNo) continue;
      const sku = get(idx.sku).replace(/[^\d]/g, '');
      const date = get(idx.date);
      items.push({
        key: `${get(idx.type)}|${orderNo}|${sku}|${date}`,
        구분: get(idx.type),
        발주번호: orderNo,
        sku,
        skuName: get(idx.skuName),
        date,
        center: get(idx.center),
        qty: num(get(idx.qty)),
        unitPrice: num(get(idx.unit)),
        supply: num(get(idx.supply)),
        tax: num(get(idx.tax)),
        total: num(get(idx.total)),
        totalSupply: num(get(idx.totalSupply)),
        totalTax: num(get(idx.totalTax)),
        invoiceNo: get(idx.invoice).replace(/^-$/, ''),
        payDate: get(idx.payDate).replace(/^-$/, ''),
      });
    }
    return items;
  };

  window.__rocketHubCollectors = [
    {
      id: 'receiveDetail',
      label: '물류창고 입고',
      hint: '앱의 물류 › 물류창고입고에서 "자동으로 가져오기"를 누르면 기간 "어제"로 검색해 알아서 모아 갑니다. 직접 기간을 고르고 검색해도 표가 모입니다(여러 페이지면 넘겨주세요).',
      match: () => location.hostname === 'supplier.coupang.com' && location.pathname.startsWith('/scm/receive'),
      collect: collectReceiveTable,
    },
    {
      id: 'adsStock',
      label: '상품·재고',
      hint: '"광고하지 않는 상품"과 "광고 중인 상품" 두 탭을 열고 페이지 번호만 넘기면 자동으로 모입니다(스크롤 필요 없음).',
      match: () => location.hostname === 'advertising.coupang.com' && location.pathname.startsWith('/marketing/product-dashboard'),
      collect: collectAdsStock,
      fromResponse: fromAdsResponse,
    },
  ];
})();
