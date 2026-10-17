// 1688 주문목록(我的订单) 화면에서 주문을 읽어 "담은 주문"으로 저장한다.
// 담은 주문은 8282한중무역 신청서(8282.js)와 로켓 앱 한중발주 장바구니(app-bridge.js)가 같이 가져다 쓴다.
//
//  · 주문마다 주문번호, 상품(이름·옵션·단가·수량·상품번호·사진), 결제금액(¥, 보이면 ₩)을 화면에서 읽는다.
//    새 주문목록은 화면 조각이 shadow DOM 안에 들어 있어서, 그 안까지 따라 들어가 글자를 순서대로 읽는다.
//  · 운송장번호·택배사는 화면에 없어서, 1688이 주문상세 물류 탭에 쓰는 것과 같은 요청(h5api)을 뒤에서 보낸다.
//    클릭할 일이 없다.
//  · 오른쪽에 좁은 창을 띄워 읽은 내용을 보여주고, 고른 주문만 담는다. 읽은 값이 이상하면 "진단 저장"으로
//    화면 구조를 파일로 남긴다(다운로드 폴더 로켓1688주문로그_*.json).
(() => {
  if (window.__rocket1688OrderListInjected) return;
  window.__rocket1688OrderListInjected = true;

  // 주문목록 주소. 주소가 달라도 화면에 "订单号·下单账号"가 보이면 주문목록으로 본다(아래 맨 끝).
  const PAGE_RE = /trade-order-list|buyer_order_list|buyList/i;

  const BASKET_KEY = 'rocket1688Basket';
  const TRACK_KEY = 'rocket1688Tracking';
  const PANEL_OPEN_KEY = 'rocket1688OrderPanelOpen';
  // 운송장을 다시 물어보는 간격. 이미 받은 운송장번호는 바뀌지 않으니 상태 글만 새로 받는 셈이다.
  const TRACK_FRESH_MS = 20 * 60 * 1000;

  const extOk = () => !!(chrome.runtime && chrome.runtime.id);
  const storageGet = (key) =>
    new Promise((resolve) => {
      if (!extOk()) return resolve(undefined);
      try {
        chrome.storage.local.get(key, (r) => resolve(chrome.runtime.lastError ? undefined : r && r[key]));
      } catch (err) {
        resolve(undefined);
      }
    });
  const storageSet = (key, value) =>
    new Promise((resolve, reject) => {
      if (!extOk()) return reject(new Error('확장이 새로 설치됐어요. 이 페이지를 새로고침해 주세요.'));
      chrome.storage.local.set({ [key]: value }, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      });
    });

  // ───────── 화면 읽기 (shadow DOM 안까지) ─────────
  let panelHost = null;
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'svg']);

  // 화면 순서대로 글자 조각(text)·사진(img)·링크(a)를 모은다. shadow DOM은 그 자리에서 먼저 읽는다.
  const collect = (root) => {
    const out = [];
    const visit = (node) => {
      if (node.nodeType === 3) {
        const text = node.nodeValue.replace(/\s+/g, ' ').trim();
        if (text) out.push({ kind: 'text', text, el: node.parentElement || (node.parentNode && node.parentNode.host) });
        return;
      }
      if (node.nodeType !== 1 && node.nodeType !== 11) return;
      if (node === panelHost) return;
      if (node.nodeType === 1) {
        if (SKIP_TAGS.has(node.tagName)) return;
        if (node.tagName === 'IMG') out.push({ kind: 'img', el: node });
        else if (node.tagName === 'A' && node.getAttribute('href')) out.push({ kind: 'a', el: node, href: node.href || node.getAttribute('href') });
        if (node.shadowRoot) node.shadowRoot.childNodes.forEach(visit);
      }
      node.childNodes.forEach(visit);
    };
    visit(root);
    return out;
  };
  const deepText = (root) => collect(root).filter((t) => t.kind === 'text').map((t) => t.text).join(' ');
  const deepParent = (el) => {
    if (!el) return null;
    if (el.parentElement) return el.parentElement;
    const p = el.parentNode;
    return p && p.host ? p.host : null;
  };

  const ORDER_ID_RE = /订单号\s*[:：]?\s*(\d{15,22})/;
  const PRICE_RE = /[¥￥]\s*([\d,]+(?:\.\d+)?)/;
  const NUM_RE = /^[\d,]+(?:\.\d+)?$/;
  const QTY_RE = /^[x×X]?\s*(\d{1,6})$/;
  const OFFER_RE = /(?:offer\/|offerId=|offer_id=|offerid=)(\d{6,})/i;
  const STATUS_WORDS = ['待付款', '待发货', '待收货', '交易成功', '交易关闭', '已收货', '退款中', '待评价'];
  const SEP_RE = /^[;；,，]$/;

  const isStruck = (el) => {
    for (let e = el, i = 0; e && i < 3; e = deepParent(e), i++) {
      if (e.tagName === 'DEL' || e.tagName === 'S') return true;
      try {
        if ((getComputedStyle(e).textDecorationLine || '').includes('line-through')) return true;
      } catch (err) {}
    }
    return false;
  };
  const num = (s) => Number(String(s).replace(/,/g, '')) || 0;
  const imgSrc = (img) => img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.currentSrc || '';
  // 1688 사진 주소의 _80x80.jpg 같은 꼬리를 떼서 원본 사진 주소로 만든다.
  const fullImageUrl = (raw) => {
    let u = String(raw || '').trim();
    if (!u) return '';
    if (u.startsWith('//')) u = `https:${u}`;
    u = u.replace(/^http:/, 'https:');
    const m = u.match(/^(.*?\.(?:jpe?g|png|webp|gif))(?:_[^/]*)?$/i);
    return m ? m[1] : u;
  };
  const isProductImg = (img) => {
    const src = imgSrc(img);
    if (!/alicdn|1688|taobao|tbcdn/i.test(src)) return false;
    const r = img.getBoundingClientRect();
    return r.width >= 40 || (img.naturalWidth || 0) >= 80;
  };
  const offerOf = (href) => {
    let h = String(href || '');
    try {
      h = decodeURIComponent(h);
    } catch (err) {}
    const m = h.match(OFFER_RE);
    return m ? m[1] : '';
  };

  // 주문 카드 찾기: "订单号 숫자"가 있는 머리줄에서 위로 올라가며, 주문번호가 하나만 들어 있는 가장 큰 덩어리를 카드로 본다.
  const findOrderCards = (all) => {
    const heads = [];
    const seen = new Set();
    all.forEach((t) => {
      if (t.kind !== 'text' || !t.text.includes('订单号')) return;
      let head = t.el;
      let id = '';
      for (let i = 0; head && i < 6; i++) {
        const m = deepText(head).match(ORDER_ID_RE);
        if (m) {
          id = m[1];
          break;
        }
        head = deepParent(head);
      }
      if (!id || seen.has(id)) return;
      seen.add(id);
      heads.push({ id, head });
    });
    return heads.map(({ id, head }) => {
      let card = head;
      for (;;) {
        const p = deepParent(card);
        if (!p || p === document.documentElement) break;
        const tokens = collect(p).filter((x) => x.kind === 'text').map((x) => x.text);
        if ((tokens.join(' ').match(/订单号/g) || []).length > 1) break;
        // 주문이 하나뿐인 화면에서 위쪽 탭 줄(全部·待付款…)까지 카드로 잡지 않게 멈춘다.
        if (tokens.includes('全部') && tokens.includes('待付款')) break;
        card = p;
        if (p === document.body) break;
      }
      return { id, head, card };
    });
  };

  // 카드 하나를 읽는다. 상품 사진이 나올 때마다 상품 하나가 시작된다고 보고, 사진 다음에 나오는
  // 첫 ¥ 값이 단가, 그다음 숫자만 있는 조각이 수량이다.
  const parseCard = ({ id, head, card }) => {
    const tokens = collect(card);
    let start = tokens.findIndex((t) => t.kind === 'text' && t.text.includes('订单号'));
    if (start < 0) start = 0;
    // 머리줄(주문번호 줄) 안의 사진(가게 아이콘 등)은 상품이 아니다.
    const isHeadEl = (el) => {
      for (let e = el; e; e = deepParent(e)) if (e === head) return true;
      return false;
    };

    let starts = [];
    tokens.forEach((t, i) => {
      if (i > start && t.kind === 'img' && isProductImg(t.el) && !isHeadEl(t.el)) starts.push(i);
    });
    // 사진을 못 찾으면 상품 링크(offer 번호)가 처음 나오는 곳을 상품 시작으로 쓴다.
    if (!starts.length) {
      const seenOffer = new Set();
      tokens.forEach((t, i) => {
        if (i <= start || t.kind !== 'a') return;
        const o = offerOf(t.href);
        if (o && !seenOffer.has(o)) {
          seenOffer.add(o);
          starts.push(i);
        }
      });
    }
    // 사진과 링크가 붙어 있어(사진을 링크가 감싸는 등) 한 상품에서 시작점이 둘 잡히는 것을 막는다:
    // 두 시작점 사이에 ¥ 값이 없으면 같은 상품이다.
    starts = starts.filter((s, k) => {
      if (k === 0) return true;
      const prev = starts[k - 1];
      return tokens.slice(prev, s).some((t) => t.kind === 'text' && (PRICE_RE.test(t.text) || /^[¥￥]$/.test(t.text)));
    });

    const usedPriceIdx = new Set();
    const items = starts.map((s, k) => {
      const end = k + 1 < starts.length ? starts[k + 1] : tokens.length;
      const seg = tokens.slice(s, end).map((t, j) => ({ ...t, i: s + j }));
      const texts = seg.filter((t) => t.kind === 'text');
      // 단가: 줄 그은 원래 가격은 건너뛴다.
      let priceAt = -1;
      let price = 0;
      for (let j = 0; j < texts.length; j++) {
        const t = texts[j];
        let v = null;
        const m = t.text.match(PRICE_RE);
        if (m) v = num(m[1]);
        else if (/^[¥￥]$/.test(t.text) && texts[j + 1] && NUM_RE.test(texts[j + 1].text)) v = num(texts[j + 1].text);
        if (v == null || isStruck(t.el)) continue;
        priceAt = j;
        price = v;
        usedPriceIdx.add(t.i);
        if (!m) usedPriceIdx.add(texts[j + 1].i);
        break;
      }
      let qty = 0;
      if (priceAt >= 0) {
        for (let j = priceAt + 1; j < texts.length; j++) {
          if (j === priceAt + 1 && /^[¥￥]$/.test(texts[priceAt].text)) continue; // ¥ 뒤 숫자는 가격
          const m = texts[j].text.match(QTY_RE);
          if (m) {
            qty = Number(m[1]);
            break;
          }
        }
      }
      // 상품명: 상품 링크 안 글자 → 없으면 사진 뒤 첫 긴 글자.
      const before = priceAt >= 0 ? texts.slice(0, priceAt) : texts;
      const inOfferLink = (el) => {
        for (let e = el, n = 0; e && n < 6; e = deepParent(e), n++) if (e.tagName === 'A' && offerOf(e.href)) return true;
        return false;
      };
      const clean = (s) => s.replace(/\[快照\]|【快照】|快照/g, '').trim();
      let titleParts = before.filter((t) => inOfferLink(t.el) && !/[:：]/.test(t.text) && clean(t.text));
      let titleEnd;
      if (titleParts.length) {
        titleEnd = before.indexOf(titleParts[titleParts.length - 1]);
      } else {
        const j = before.findIndex((t) => clean(t.text).length >= 6 && !/[:：]/.test(t.text) && !PRICE_RE.test(t.text));
        titleParts = j >= 0 ? [before[j]] : [];
        titleEnd = j;
      }
      const title = clean(titleParts.map((t) => t.text).join(''));
      // 옵션: 상품명 뒤 "颜色: …；高度: …"처럼 쌍점이 들어간 조각들이 이어진 부분.
      const specTokens = [];
      let on = false;
      for (let j = Math.max(0, titleEnd + 1); j < before.length; j++) {
        const t = before[j].text;
        const prev = specTokens[specTokens.length - 1] || '';
        const next = before[j + 1] ? before[j + 1].text : '';
        const hit = /[:：]/.test(t) || /[:：]$/.test(prev) || SEP_RE.test(t) || SEP_RE.test(prev) || /^[:：]/.test(next);
        if (hit) {
          on = true;
          specTokens.push(t);
        } else if (on) break;
      }
      const spec = specTokens.join(' ').replace(/\s*([:：])\s*/g, ': ').replace(/\s*([;；])\s*/g, '; ').replace(/[;；]\s*$/, '').trim();
      const img = seg.find((t) => t.kind === 'img' && isProductImg(t.el));
      const offerTok = seg.find((t) => t.kind === 'a' && offerOf(t.href));
      let offerId = offerTok ? offerOf(offerTok.href) : '';
      if (!offerId && img) {
        for (let e = img.el, n = 0; e && n < 6; e = deepParent(e), n++) if (e.tagName === 'A' && offerOf(e.href)) { offerId = offerOf(e.href); break; }
      }
      return {
        offerId,
        title,
        spec,
        unitCny: price,
        qty,
        imageUrl: img ? fullImageUrl(imgSrc(img.el)) : '',
        productUrl: offerId ? `https://detail.1688.com/offer/${offerId}.html` : '',
      };
    });

    // 주문 금액: 상품 단가로 쓰지 않은 ¥ 값 중 줄 긋지 않은 가장 큰 값.
    let totalCny = 0;
    tokens.forEach((t, i) => {
      if (i <= start || t.kind !== 'text' || usedPriceIdx.has(i)) return;
      let v = null;
      const m = t.text.match(PRICE_RE);
      if (m) v = num(m[1]);
      else if (/^[¥￥]$/.test(t.text) && tokens[i + 1] && tokens[i + 1].kind === 'text' && NUM_RE.test(tokens[i + 1].text) && !usedPriceIdx.has(i + 1)) v = num(tokens[i + 1].text);
      if (v == null || isStruck(t.el)) return;
      if (v > totalCny) totalCny = v;
    });
    const all = tokens.filter((t) => t.kind === 'text').map((t) => t.text).join(' ');
    const krw = all.match(/₩\s*([\d,]+)/);
    const ship = all.match(/含运费\s*[¥￥]?\s*([\d.]+)/);
    const date = all.match(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?)/);
    const status = STATUS_WORDS.find((w) => tokens.some((t) => t.kind === 'text' && t.text === w)) || '';
    const goods = items.reduce((s, it) => s + it.unitCny * it.qty, 0);
    const shipCny = ship ? Number(ship[1]) : 0;
    if (!totalCny) totalCny = Math.round((goods + shipCny) * 100) / 100;

    const problems = [];
    if (!items.length) problems.push('상품을 못 찾았어요');
    items.forEach((it, k) => {
      const label = items.length > 1 ? `상품 ${k + 1}: ` : '';
      if (!it.unitCny) problems.push(`${label}단가를 못 읽었어요`);
      if (!it.qty) problems.push(`${label}수량을 못 읽었어요`);
      if (!it.title) problems.push(`${label}상품명을 못 읽었어요`);
    });
    // 결제금액이 상품 합계와 너무 다르면 잘못 읽은 것일 수 있다(할인·운임으로 조금 다른 건 괜찮다).
    if (goods > 0 && (totalCny < goods * 0.5 || totalCny > goods * 2 + shipCny + 1)) problems.push(`결제금액(¥${totalCny})이 상품 합계(¥${goods.toFixed(2)})와 많이 달라요`);

    return {
      orderId: id,
      orderTime: date ? date[1] : '',
      status,
      totalCny,
      shipCny,
      totalKrw: krw ? num(krw[1]) : 0,
      items,
      problems,
      card,
    };
  };

  // ───────── 운송장 (1688 h5api) ─────────
  const APP_KEY = '12574478';
  const TRACK_API = 'mtop.1688.DeliveryOrderService.queryDeliveryOrderPackList';
  let lastMtopRaw = null;
  const readToken = () => {
    const m = document.cookie.match(/(?:^|;\s*)_m_h5_tk=([^;]+)/);
    return m ? decodeURIComponent(m[1]).split('_')[0] : '';
  };
  const askBackground = (message) =>
    new Promise((resolve, reject) => {
      if (!extOk()) return reject(new Error('확장이 새로 설치됐어요. 이 페이지를 새로고침해 주세요.'));
      chrome.runtime.sendMessage(message, (res) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else if (!res || !res.ok) reject(new Error((res && res.error) || '확장이 응답하지 않았어요.'));
        else resolve(res.data);
      });
    });
  const mtop = async (api, data) => {
    const dataStr = JSON.stringify(data);
    let lastRet = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = readToken();
      const t = String(Date.now());
      const params = new URLSearchParams({
        jsv: '2.7.4',
        appKey: APP_KEY,
        t,
        sign: globalThis.rocketMd5(`${token}&${t}&${APP_KEY}&${dataStr}`),
        api,
        v: '1.0',
        ecode: '1',
        type: 'originaljson',
        dataType: 'json',
        timeout: '20000',
      });
      const url = `https://h5api.m.1688.com/h5/${api.toLowerCase()}/1.0/?${params}`;
      const body = `data=${encodeURIComponent(dataStr)}`;
      let json;
      try {
        const res = await fetch(url, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
        });
        json = await res.json();
      } catch (err) {
        // 페이지에서 직접 못 보내면(CORS 등) 확장 뒤쪽에서 보낸다.
        json = await askBackground({ type: 'MTOP_1688', url, body });
      }
      lastMtopRaw = json;
      lastRet = String((json && json.ret && json.ret[0]) || '');
      if (lastRet.startsWith('SUCCESS')) return json.data || {};
      // 토큰이 없거나 낡았으면 이번 응답이 새 토큰 쿠키를 심어 주므로 한 번 더 보낸다.
      if (/TOKEN_EMPTY|TOKEN_EXOIRED|TOKEN_EXPIRED|ILLEGAL_ACCESS/i.test(lastRet) && attempt === 0) continue;
      break;
    }
    if (/SESSION_EXPIRED/i.test(lastRet)) throw new Error('1688 로그인이 풀렸어요. 다시 로그인해 주세요.');
    throw new Error(lastRet || '운송장 응답이 비어 있어요.');
  };
  const fetchTracking = async (orderId) => {
    const data = await mtop(TRACK_API, { orderId, userType: 'buyer', needOfferWeight: true });
    let model = data.model;
    if (typeof model === 'string') {
      try {
        model = JSON.parse(model);
      } catch (err) {
        model = [];
      }
    }
    const packs = (Array.isArray(model) ? model : []).filter((m) => m && m.mailNo);
    return packs.map((m) => {
      const traces = (m.logisticsTracePackDTOList || []).slice().sort((a, b) => new Date(b.actionTime) - new Date(a.actionTime));
      return {
        company: String(m.realLogisticsCompanyName || m.logisticsCompanyName || m.companyName || '').trim(),
        mailNo: String(m.mailNo).trim(),
        last: traces[0] ? `${traces[0].actionTime || ''} ${traces[0].remark || ''}`.trim() : '',
      };
    });
  };

  // ───────── 상태 ─────────
  let orders = []; // 이 화면에서 읽은 주문
  let basket = {}; // 담은 주문 (orderId → 주문)
  let tracking = {}; // orderId → { packages, fetchedAt, error }
  const checked = new Set();
  let open = true;
  let view = 'page'; // 'page' 이 화면 | 'basket' 담은 목록
  let toast = '';
  let toastTimer = null;
  let tracking_busy = false;

  const showToast = (msg) => {
    toast = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast = '';
      render();
    }, 5000);
    render();
  };

  const loadTrackingQueue = async (force) => {
    if (tracking_busy) return;
    tracking_busy = true;
    try {
      for (const o of orders) {
        const cur = tracking[o.orderId];
        const fresh = cur && !cur.error && Date.now() - cur.fetchedAt < TRACK_FRESH_MS;
        if (!force && fresh) continue;
        if (o.status === '待付款' || o.status === '待发货') {
          tracking[o.orderId] = { packages: [], fetchedAt: Date.now(), error: '', notShipped: true };
          continue;
        }
        tracking[o.orderId] = { ...(cur || { packages: [] }), loading: true };
        render();
        try {
          const packages = await fetchTracking(o.orderId);
          tracking[o.orderId] = { packages, fetchedAt: Date.now(), error: '' };
        } catch (err) {
          tracking[o.orderId] = { packages: (cur && cur.packages) || [], fetchedAt: Date.now(), error: String((err && err.message) || err) };
        }
        // 담아 둔 주문이면 운송장도 같이 고친다.
        if (basket[o.orderId] && tracking[o.orderId].packages.length) {
          basket[o.orderId] = { ...basket[o.orderId], packages: tracking[o.orderId].packages };
          await storageSet(BASKET_KEY, basket).catch(() => {});
        }
        render();
        await new Promise((r) => setTimeout(r, 250));
      }
      const keep = {};
      Object.entries(tracking).forEach(([k, v]) => {
        if (!v.loading && Date.now() - (v.fetchedAt || 0) < 3 * 24 * 3600 * 1000) keep[k] = { ...v, loading: false };
      });
      await storageSet(TRACK_KEY, keep).catch(() => {});
    } finally {
      tracking_busy = false;
    }
  };

  let lastSig = '';
  let lastQuick = '';
  const rescan = () => {
    if (document.hidden) return;
    let found;
    try {
      // 화면 글자가 그대로면(주문번호·글자 수가 같으면) 다시 읽지 않는다.
      const all = collect(document.body);
      const texts = all.filter((t) => t.kind === 'text').map((t) => t.text);
      const quick = `${texts.length}|${texts.join('').length}|${all.filter((t) => t.kind === 'img').length}`;
      if (quick === lastQuick) return;
      lastQuick = quick;
      found = findOrderCards(all).map(parseCard);
    } catch (err) {
      console.warn('[로켓] 1688 주문 읽기 실패', err);
      return;
    }
    const sig = JSON.stringify(found.map((o) => [o.orderId, o.totalCny, o.items.map((it) => [it.title, it.spec, it.unitCny, it.qty])]));
    orders = found;
    if (sig === lastSig) return;
    lastSig = sig;
    const ids = new Set(orders.map((o) => o.orderId));
    Array.from(checked).forEach((k) => {
      if (!ids.has(k)) checked.delete(k);
    });
    render();
    loadTrackingQueue(false);
  };

  // ───────── 담기 ─────────
  const toBasketEntry = (o) => {
    const prev = basket[o.orderId] || {};
    const t = tracking[o.orderId];
    return {
      orderId: o.orderId,
      orderTime: o.orderTime,
      status: o.status,
      totalCny: o.totalCny,
      shipCny: o.shipCny,
      totalKrw: o.totalKrw,
      items: o.items,
      packages: (t && t.packages && t.packages.length ? t.packages : prev.packages) || [],
      addedAt: prev.addedAt || Date.now(),
      updatedAt: Date.now(),
      ...(prev.used8282At ? { used8282At: prev.used8282At } : {}),
      ...(prev.usedAppAt ? { usedAppAt: prev.usedAppAt, usedAppCode: prev.usedAppCode || '' } : {}),
    };
  };
  const addChecked = async () => {
    const picked = orders.filter((o) => checked.has(o.orderId));
    if (!picked.length) return showToast('담을 주문을 먼저 골라 주세요.');
    const bad = picked.filter((o) => o.problems.length);
    if (bad.length) {
      return showToast(`잘못 읽은 주문이 있어요(${bad.map((o) => `…${o.orderId.slice(-6)}`).join(', ')}). 그 주문은 빼거나 "진단 저장"을 눌러 보내 주세요.`);
    }
    const noTrack = picked.filter((o) => !((tracking[o.orderId] || {}).packages || []).length);
    try {
      const fresh = (await storageGet(BASKET_KEY)) || {};
      basket = { ...fresh };
      picked.forEach((o) => {
        basket[o.orderId] = toBasketEntry(o);
      });
      await storageSet(BASKET_KEY, basket);
      checked.clear();
      showToast(`${picked.length}건 담았어요.${noTrack.length ? ` (운송장 없는 ${noTrack.length}건은 운송장이 생기면 이 화면을 열 때 채워져요)` : ''} 8282 신청서·로켓 앱 장바구니에서 가져다 쓰면 돼요.`);
    } catch (err) {
      showToast(`담기 실패: ${err.message || err}`);
    }
  };
  const removeFromBasket = async (orderId) => {
    const fresh = (await storageGet(BASKET_KEY)) || {};
    delete fresh[orderId];
    basket = fresh;
    await storageSet(BASKET_KEY, basket).catch((err) => showToast(err.message));
    render();
  };
  const clearBasket = async () => {
    if (!confirm('담은 주문을 모두 지울까요? (8282·앱에 이미 넣은 것은 그대로 남아요)')) return;
    basket = {};
    await storageSet(BASKET_KEY, basket).catch((err) => showToast(err.message));
    render();
  };

  // ───────── 진단 저장 ─────────
  const serialize = (node, budget) => {
    let out = '';
    const esc = (s) => s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
    const visit = (n) => {
      if (out.length > budget) return;
      if (n.nodeType === 3) {
        const t = n.nodeValue.trim();
        if (t) out += esc(t);
        return;
      }
      if (n.nodeType !== 1 && n.nodeType !== 11) return;
      if (n.nodeType === 1) {
        if (SKIP_TAGS.has(n.tagName)) return;
        const attrs = Array.from(n.attributes)
          .filter((a) => ['class', 'href', 'src', 'data-src', 'id', 'style', 'name', 'title'].includes(a.name))
          .map((a) => ` ${a.name}="${String(a.value).slice(0, 200)}"`)
          .join('');
        out += `<${n.tagName.toLowerCase()}${attrs}>`;
        if (n.shadowRoot) {
          out += '<#shadow>';
          n.shadowRoot.childNodes.forEach(visit);
          out += '</#shadow>';
        }
      }
      n.childNodes.forEach(visit);
      if (n.nodeType === 1) out += `</${n.tagName.toLowerCase()}>`;
    };
    visit(node);
    return out;
  };
  const saveDiagnostics = async () => {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    let firstTrack = null;
    if (orders[0]) {
      try {
        firstTrack = await fetchTracking(orders[0].orderId);
      } catch (err) {
        firstTrack = String(err.message || err);
      }
    }
    const log = {
      kind: '1688-order-list',
      url: location.href,
      at: new Date().toString(),
      ua: navigator.userAgent,
      hasToken: !!readToken(),
      orders: orders.map((o) => ({ ...o, card: undefined })),
      tracking,
      firstTrack,
      lastMtopRaw,
      cards: orders.slice(0, 3).map((o) => ({
        orderId: o.orderId,
        tokens: collect(o.card).slice(0, 400).map((t) => (t.kind === 'text' ? t.text : t.kind === 'img' ? `[img ${imgSrc(t.el).slice(0, 120)} w=${Math.round(t.el.getBoundingClientRect().width)}]` : `[a ${String(t.href).slice(0, 160)}]`)),
        html: serialize(o.card, 150000),
      })),
      pageHtml: orders.length ? '' : serialize(document.body, 400000),
    };
    const blob = new Blob([JSON.stringify(log, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `로켓1688주문로그_${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    showToast('다운로드 폴더에 로켓1688주문로그 파일을 저장했어요.');
  };

  // ───────── 창 ─────────
  panelHost = document.createElement('div');
  panelHost.id = 'rocket-1688-order-panel';
  const root = panelHost.attachShadow({ mode: 'open' });
  const css = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; }
    .pill { position: fixed; right: 16px; bottom: 24px; z-index: 2147483646; background: #ff6a00; color: #fff; border: 0; border-radius: 999px; padding: 10px 16px; font-size: 14px; font-weight: 700; cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,.2); }
    .box { position: fixed; right: 12px; top: 70px; bottom: 16px; width: 340px; z-index: 2147483646; background: #fff; border: 2px solid #ff6a00; border-radius: 14px; box-shadow: 0 8px 28px rgba(0,0,0,.18); display: flex; flex-direction: column; overflow: hidden; font-size: 12px; color: #222; }
    .hd { display: flex; align-items: center; gap: 6px; padding: 10px 12px; background: #fff4ec; border-bottom: 1px solid #ffd9bf; }
    .hd b { font-size: 14px; flex: 1; }
    .x { border: 0; background: none; font-size: 18px; cursor: pointer; color: #888; line-height: 1; }
    .tabs { display: flex; border-bottom: 1px solid #eee; }
    .tab { flex: 1; padding: 8px 4px; border: 0; background: #fff; cursor: pointer; font-size: 12px; color: #777; border-bottom: 2px solid transparent; }
    .tab.on { color: #ff6a00; font-weight: 700; border-bottom-color: #ff6a00; }
    .acts { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border-bottom: 1px solid #eee; }
    .btn { border: 1px solid #ddd; background: #fff; border-radius: 8px; padding: 7px 10px; font-size: 12px; cursor: pointer; text-align: left; }
    .btn:hover { background: #fafafa; }
    .btn.main { background: #ff6a00; border-color: #ff6a00; color: #fff; font-weight: 700; font-size: 13px; }
    .btn.main:disabled { background: #ccc; border-color: #ccc; cursor: default; }
    .row2 { display: flex; gap: 6px; }
    .row2 .btn { flex: 1; text-align: center; }
    .toast { margin: 8px 12px 0; padding: 8px 10px; background: #fffbe6; border: 1px solid #ffe58f; border-radius: 8px; line-height: 1.5; }
    .list { flex: 1; overflow-y: auto; padding: 8px 12px 12px; }
    .empty { color: #999; padding: 20px 4px; line-height: 1.6; }
    .ord { border: 1px solid #eee; border-radius: 10px; padding: 8px; margin-bottom: 8px; cursor: pointer; }
    .ord.on { border-color: #ff6a00; background: #fff8f2; }
    .ord.bad { border-color: #ff4d4f; }
    .oh { display: flex; align-items: center; gap: 6px; }
    .oh input { margin: 0; }
    .oid { font-family: ui-monospace, Menlo, monospace; font-weight: 700; }
    .muted { color: #999; }
    .tag { font-size: 11px; padding: 1px 6px; border-radius: 999px; background: #f0f0f0; color: #666; white-space: nowrap; }
    .tag.g { background: #e6f7ec; color: #18864b; }
    .tag.b { background: #e8f1ff; color: #1d5fd1; }
    .trk { margin: 5px 0 2px; padding: 4px 6px; background: #eef7ff; border-radius: 6px; color: #1d4f91; line-height: 1.45; word-break: break-all; }
    .trk.no { background: #f6f6f6; color: #888; }
    .trk.err { background: #fff1f0; color: #cf1322; }
    .it { display: flex; gap: 6px; margin-top: 6px; }
    .it img { width: 38px; height: 38px; object-fit: cover; border-radius: 6px; border: 1px solid #eee; flex: none; }
    .it .t { flex: 1; min-width: 0; }
    .it .nm { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.35; }
    .it .sp { color: #888; margin-top: 1px; }
    .it .pq { font-weight: 700; margin-top: 1px; }
    .tot { margin-top: 6px; text-align: right; font-weight: 700; }
    .prob { margin-top: 6px; color: #cf1322; line-height: 1.5; }
    .del { border: 0; background: none; color: #999; cursor: pointer; font-size: 12px; margin-left: auto; }
  `;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const cny = (n) => `¥${(Number(n) || 0).toFixed(2)}`;
  const krwText = (n) => (n ? ` (₩${Math.round(n).toLocaleString()})` : '');

  const trackHtml = (orderId, fallback) => {
    const t = tracking[orderId];
    const packs = (t && t.packages && t.packages.length ? t.packages : fallback) || [];
    if (packs.length) {
      return `<div class="trk">${packs
        .map((p) => `🚚 <b>${esc(p.company || '택배사?')}</b> ${esc(p.mailNo)}${p.last ? `<br><span class="muted">${esc(p.last.slice(0, 60))}</span>` : ''}`)
        .join('<br>')}${packs.length > 1 ? '<br>⚠ 물류단이 여러 개예요' : ''}</div>`;
    }
    if (!t) return '<div class="trk no">운송장 확인 전</div>';
    if (t.loading) return '<div class="trk no">운송장 불러오는 중…</div>';
    if (t.error) return `<div class="trk err">운송장 못 불러옴: ${esc(t.error)}</div>`;
    if (t.notShipped) return '<div class="trk no">아직 발송 전</div>';
    return '<div class="trk no">운송장 없음(발송 전이거나 직접 배송)</div>';
  };
  const itemsHtml = (items) =>
    items
      .map(
        (it) => `<div class="it">${it.imageUrl ? `<img src="${esc(it.imageUrl)}_80x80.jpg" alt="">` : ''}<div class="t">
          <div class="nm">${esc(it.title || '(상품명 없음)')}</div>
          ${it.spec ? `<div class="sp">${esc(it.spec)}</div>` : ''}
          <div class="pq">${cny(it.unitCny)} × ${it.qty}개</div></div></div>`,
      )
      .join('');
  const usedTags = (b) =>
    b ? `<span class="tag g">담음</span>${b.used8282At ? '<span class="tag b">8282</span>' : ''}${b.usedAppAt ? `<span class="tag b">앱${b.usedAppCode ? ` ${esc(b.usedAppCode)}` : ''}</span>` : ''}` : '';

  const render = () => {
    if (!panelHost.isConnected) document.documentElement.appendChild(panelHost);
    const listEl = root.querySelector('.list');
    const scroll = listEl ? listEl.scrollTop : 0;
    const basketList = Object.values(basket).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    if (!open) {
      root.innerHTML = `<style>${css}</style><button class="pill" data-act="open">📦 1688 주문 담기${basketList.length ? ` · ${basketList.length}` : ''}</button>`;
      return;
    }
    const pickedCount = orders.filter((o) => checked.has(o.orderId)).length;
    let body = '';
    if (view === 'page') {
      body = orders.length
        ? orders
            .map((o) => {
              const b = basket[o.orderId];
              const bad = o.problems.length > 0;
              return `<div class="ord ${checked.has(o.orderId) ? 'on' : ''} ${bad ? 'bad' : ''}" data-act="jump" data-id="${o.orderId}">
                <div class="oh"><input type="checkbox" data-act="check" data-id="${o.orderId}" ${checked.has(o.orderId) ? 'checked' : ''}>
                <span class="oid">…${esc(o.orderId.slice(-8))}</span><span class="muted">${esc(o.orderTime.slice(5, 16))}</span>
                <span style="margin-left:auto;display:flex;gap:3px">${usedTags(b)}</span></div>
                ${trackHtml(o.orderId, b && b.packages)}
                ${itemsHtml(o.items)}
                <div class="tot">${cny(o.totalCny)}${krwText(o.totalKrw)}${o.shipCny ? ` <span class="muted">운임 ${cny(o.shipCny)}</span>` : ''}</div>
                ${bad ? `<div class="prob">⚠ ${o.problems.map(esc).join('<br>⚠ ')}</div>` : ''}
              </div>`;
            })
            .join('')
        : '<div class="empty">이 화면에서 주문을 못 찾았어요.<br>주문목록이 다 뜬 뒤에도 그대로면 아래 "진단 저장"을 눌러 파일을 보내 주세요.</div>';
    } else {
      body = basketList.length
        ? basketList
            .map(
              (b) => `<div class="ord">
                <div class="oh"><span class="oid">…${esc(b.orderId.slice(-8))}</span><span class="muted">${esc((b.orderTime || '').slice(5, 16))}</span>
                <span style="display:flex;gap:3px">${usedTags(b)}</span>
                <button class="del" data-act="remove" data-id="${b.orderId}" title="담은 목록에서 빼기">✕</button></div>
                ${trackHtml(b.orderId, b.packages)}
                ${itemsHtml(b.items || [])}
                <div class="tot">${cny(b.totalCny)}${krwText(b.totalKrw)}</div>
              </div>`,
            )
            .join('')
        : '<div class="empty">아직 담은 주문이 없어요.</div>';
    }
    root.innerHTML = `<style>${css}</style>
      <div class="box">
        <div class="hd"><b>📦 1688 주문 → 8282·로켓</b><button class="x" data-act="close" title="접기">–</button></div>
        <div class="tabs">
          <button class="tab ${view === 'page' ? 'on' : ''}" data-act="view-page">이 화면 주문 ${orders.length}</button>
          <button class="tab ${view === 'basket' ? 'on' : ''}" data-act="view-basket">담은 주문 ${basketList.length}</button>
        </div>
        <div class="acts">
          ${
            view === 'page'
              ? `<button class="btn main" data-act="add" ${pickedCount ? '' : 'disabled'}>✅ 고른 주문 담기${pickedCount ? ` (${pickedCount}건)` : ''}</button>
                 <div class="row2"><button class="btn" data-act="all">전부 고르기</button><button class="btn" data-act="none">고른 것 풀기</button></div>
                 <div class="row2"><button class="btn" data-act="retrack">🔄 운송장 다시</button><button class="btn" data-act="diag">🔧 진단 저장</button></div>`
              : `<button class="btn" data-act="clear">🗑 담은 주문 모두 지우기</button>`
          }
        </div>
        ${toast ? `<div class="toast">${esc(toast)}</div>` : ''}
        <div class="list">${body}</div>
      </div>`;
    const nl = root.querySelector('.list');
    if (nl) nl.scrollTop = scroll;
  };

  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    const id = el.dataset.id;
    if (act === 'check') {
      e.stopPropagation();
      if (el.checked) checked.add(id);
      else checked.delete(id);
      render();
      return;
    }
    if (act === 'jump') {
      // 카드를 누르면 고르기/풀기 + 1688 화면의 그 주문으로 스크롤.
      const o = orders.find((x) => x.orderId === id);
      if (checked.has(id)) checked.delete(id);
      else checked.add(id);
      render();
      if (o && o.card && o.card.scrollIntoView) {
        o.card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const prev = o.card.style.outline;
        o.card.style.outline = '3px solid #ff6a00';
        setTimeout(() => {
          o.card.style.outline = prev;
        }, 1500);
      }
      return;
    }
    if (act === 'open' || act === 'close') {
      open = act === 'open';
      storageSet(PANEL_OPEN_KEY, open).catch(() => {});
      render();
      return;
    }
    if (act === 'view-page' || act === 'view-basket') {
      view = act === 'view-page' ? 'page' : 'basket';
      render();
      return;
    }
    if (act === 'add') addChecked();
    else if (act === 'all') {
      orders.forEach((o) => checked.add(o.orderId));
      render();
    } else if (act === 'none') {
      checked.clear();
      render();
    } else if (act === 'retrack') loadTrackingQueue(true);
    else if (act === 'diag') saveDiagnostics();
    else if (act === 'remove') removeFromBasket(id);
    else if (act === 'clear') clearBasket();
  });

  // 8282·앱에서 "넣음" 표시가 바뀌면 바로 보이게 한다.
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes[BASKET_KEY]) return;
      basket = changes[BASKET_KEY].newValue || {};
      render();
    });
  } catch (err) {}

  let started = false;
  const start = async () => {
    if (started) return;
    started = true;
    basket = (await storageGet(BASKET_KEY)) || {};
    tracking = (await storageGet(TRACK_KEY)) || {};
    const savedOpen = await storageGet(PANEL_OPEN_KEY);
    open = savedOpen !== false;
    render();
    rescan();
    // 새 주문목록은 shadow DOM이라 화면 변화 감지가 안 되므로, 몇 초마다 다시 읽는다(바뀐 게 없으면 그대로 둔다).
    setInterval(rescan, 2500);
  };
  if (PAGE_RE.test(location.href)) start();
  else {
    const looksLikeOrderList = () => {
      const text = deepText(document.body);
      return text.includes('订单号') && text.includes('下单账号');
    };
    [3000, 8000].forEach((ms) => setTimeout(() => {
      if (!started && looksLikeOrderList()) start();
    }, ms));
  }
})();
