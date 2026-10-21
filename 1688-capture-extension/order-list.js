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
        if (SKIP_TAGS.has(node.tagName) || node.hasAttribute('data-rocket-pick')) return;
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

  // 주문 나누기: 화면 전체 글자를 순서대로 늘어놓고, "订单号 숫자"가 나올 때마다 새 주문이 시작된다고 본다.
  // (화면 덩어리 모양에 기대지 않는다. 덩어리로 잡으면 여러 주문이 한 덩어리로 섞이는 일이 있었다.)
  // 마지막 주문 아래의 쪽번호·추천상품 머리글. 탭마다 문구가 달라서(발송전 탭 등) 짧은 글자에 "추천·喜欢·更多" 같은 말이 들면 끊는다.
  const PAGE_END_RE = /^(上一页|下一页|跳转|为你推荐|为您推荐|猜你喜欢|共\s*\d+\s*页|没有更多|已经到底)/;
  const PAGE_END_SHORT_RE = /(推荐|猜你|喜欢|看了又看|买了又买|大家都在买)/;
  const isPageEnd = (t) => t.kind === 'text' && (PAGE_END_RE.test(t.text) || (t.text.length <= 12 && PAGE_END_SHORT_RE.test(t.text)));
  const findOrders = (all) => {
    const heads = [];
    for (let i = 0; i < all.length; i++) {
      const t = all[i];
      if (t.kind !== 'text' || !t.text.includes('订单号')) continue;
      let id = (t.text.match(/(\d{15,22})/) || [])[1] || '';
      for (let j = i + 1; !id && j < Math.min(all.length, i + 6); j++) {
        if (all[j].kind === 'text') id = (all[j].text.match(/^\D{0,4}(\d{15,22})/) || [])[1] || '';
      }
      if (!id || heads.some((h) => h.id === id)) continue;
      heads.push({ id, at: i, el: t.el });
    }
    return heads.map((h, k) => {
      let end = k + 1 < heads.length ? heads[k + 1].at : all.length;
      // 마지막 주문은 아래쪽 쪽번호·추천상품 앞에서 끊는다.
      if (k + 1 === heads.length) {
        const stop = all.findIndex((t, i) => i > h.at && isPageEnd(t));
        if (stop > 0) end = stop;
      }
      return { id: h.id, head: h.el, tokens: all.slice(h.at, end) };
    });
  };

  const priceAt = (texts, j) => {
    const t = texts[j];
    const m = t.text.match(PRICE_RE);
    if (m) return { v: num(m[1]), used: [j] };
    if (/^[¥￥]$/.test(t.text) && texts[j + 1] && NUM_RE.test(texts[j + 1].text)) return { v: num(texts[j + 1].text), used: [j, j + 1] };
    return null;
  };

  // 주문 하나를 읽는다.
  //  · 상품 = 상품 사진(없으면 상품 링크). 사진 뒤 첫 긴 글자가 상품명, 쌍점(颜色: …)이 든 조각들이 옵션.
  //  · 단가·수량 = "¥ 값 바로 뒤(4조각 안)에 숫자만 있는 조각"이 나오는 짝. 줄 그은 원래 가격은 건너뛴다.
  //    한 주문에 상품이 여럿이면 사진 순서대로 짝을 맞춘다(사진들이 먼저 다 나오고 가격이 뒤에 몰려 있는 화면도 있어서).
  //  · 결제금액 = 짝에 안 쓴 ¥ 값 중 줄 긋지 않은 가장 큰 값.
  const parseOrder = ({ id, head, tokens }) => {
    const texts = [];
    const pos = new Map(); // tokens 위치 → texts 위치
    tokens.forEach((t, i) => {
      if (t.kind === 'text') {
        pos.set(i, texts.length);
        texts.push({ ...t, i });
      }
    });
    let starts = [];
    tokens.forEach((t, i) => {
      if (i > 0 && t.kind === 'img' && isProductImg(t.el)) starts.push(i);
    });
    if (!starts.length) {
      const seenOffer = new Set();
      tokens.forEach((t, i) => {
        const o = t.kind === 'a' ? offerOf(t.href) : '';
        if (o && !seenOffer.has(o)) {
          seenOffer.add(o);
          starts.push(i);
        }
      });
    }

    // 단가·수량 짝
    const pairs = [];
    const used = new Set();
    for (let j = 0; j < texts.length; j++) {
      if (used.has(j)) continue;
      const p = priceAt(texts, j);
      if (!p || isStruck(texts[j].el)) continue;
      const from = p.used[p.used.length - 1] + 1;
      for (let q = from; q < Math.min(texts.length, from + 4); q++) {
        const m = texts[q].text.match(QTY_RE);
        if (m) {
          pairs.push({ price: p.v, qty: Number(m[1]), at: texts[j].i });
          p.used.forEach((u) => used.add(u));
          used.add(q);
          break;
        }
        if (priceAt(texts, q)) break; // 다음 ¥ 값이 먼저 나오면 짝이 아니다
      }
    }
    // 가격 칸이 모두 나온 뒤에 수량 칸이 모두 나오는 화면(열마다 묶인 표)도 있다:
    // 짝이 사진 수보다 적으면, 사진 뒤 ¥ 값 N개와 그 뒤 숫자 N개를 순서대로 짝짓는다.
    if (pairs.length < starts.length && starts.length > 1) {
      const n = starts.length;
      const firstImg = starts[0];
      const prices = [];
      for (let j = 0; j < texts.length && prices.length < n; j++) {
        if (texts[j].i < firstImg) continue;
        const p = priceAt(texts, j);
        if (p && !isStruck(texts[j].el)) prices.push({ j, p });
      }
      if (prices.length === n) {
        const after = prices[n - 1].p.used[prices[n - 1].p.used.length - 1];
        const qtys = [];
        for (let q = after + 1; q < texts.length && qtys.length < n; q++) {
          const m = texts[q].text.match(QTY_RE);
          if (m) qtys.push({ q, v: Number(m[1]) });
        }
        if (qtys.length === n) {
          pairs.length = 0;
          used.clear();
          prices.forEach((x, k) => {
            pairs.push({ price: x.p.v, qty: qtys[k].v, at: texts[x.j].i });
            x.p.used.forEach((u) => used.add(u));
            used.add(qtys[k].q);
          });
        }
      }
    }
    // 사진마다 짝 하나: 개수가 같으면 순서대로, 다르면 사진 뒤 첫 짝.
    const pairOf = [];
    if (pairs.length === starts.length) starts.forEach((_, k) => (pairOf[k] = pairs[k]));
    else {
      const taken = new Set();
      starts.forEach((s, k) => {
        const p = pairs.find((x) => !taken.has(x) && x.at > s);
        if (p) taken.add(p);
        pairOf[k] = p;
      });
    }

    const inOfferLink = (el) => {
      for (let e = el, n = 0; e && n < 6; e = deepParent(e), n++) if (e.tagName === 'A' && offerOf(e.href)) return true;
      return false;
    };
    const clean = (s) => s.replace(/\[快照\]|【快照】|快照/g, '').trim();
    const items = starts.map((s, k) => {
      const end = k + 1 < starts.length ? starts[k + 1] : tokens.length;
      // 이 사진부터 다음 사진(또는 첫 ¥ 값)까지의 글자에서 상품명·옵션을 찾는다.
      const seg = texts.filter((t) => t.i > s && t.i < end);
      const stop = seg.findIndex((t) => PRICE_RE.test(t.text) || /^[¥￥]$/.test(t.text));
      const before = stop >= 0 ? seg.slice(0, stop) : seg;
      let titleParts = before.filter((t) => inOfferLink(t.el) && !/[:：]/.test(t.text) && clean(t.text));
      let titleEnd;
      if (titleParts.length) titleEnd = before.indexOf(titleParts[titleParts.length - 1]);
      else {
        const j = before.findIndex((t) => clean(t.text).length >= 6 && !/[:：]/.test(t.text));
        titleParts = j >= 0 ? [before[j]] : [];
        titleEnd = j;
      }
      const title = clean(titleParts.map((t) => t.text).join(''));
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
      const imgTok = tokens[s].kind === 'img' ? tokens[s] : null;
      let offerId = tokens[s].kind === 'a' ? offerOf(tokens[s].href) : '';
      if (!offerId) {
        const a = tokens.slice(s, end).find((t) => t.kind === 'a' && offerOf(t.href));
        if (a) offerId = offerOf(a.href);
      }
      if (!offerId && imgTok) {
        for (let e = imgTok.el, n = 0; e && n < 6; e = deepParent(e), n++) if (e.tagName === 'A' && offerOf(e.href)) { offerId = offerOf(e.href); break; }
      }
      const pr = pairOf[k];
      return {
        offerId,
        title,
        spec,
        unitCny: pr ? pr.price : 0,
        qty: pr ? pr.qty : 0,
        imageUrl: imgTok ? fullImageUrl(imgSrc(imgTok.el)) : '',
        productUrl: offerId ? `https://detail.1688.com/offer/${offerId}.html` : '',
        _img: tokens[s].el, // 1688 화면에 [＋ 담기] 버튼을 붙일 자리(저장하지 않는다)
      };
    });

    let totalCny = 0;
    for (let j = 0; j < texts.length; j++) {
      if (used.has(j)) continue;
      const p = priceAt(texts, j);
      if (!p || isStruck(texts[j].el)) continue;
      if (p.v > totalCny) totalCny = p.v;
    }
    const all = texts.map((t) => t.text).join(' ');
    const krw = all.match(/₩\s*([\d,]+)/);
    const ship = all.match(/含运费\s*[¥￥]?\s*([\d.]+)/);
    const date = all.match(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?)/);
    const status = STATUS_WORDS.find((w) => texts.some((t) => t.text === w)) || '';
    const goods = items.reduce((s2, it) => s2 + it.unitCny * it.qty, 0);
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
    if (pairs.length !== starts.length) problems.push(`상품 사진 ${starts.length}개, 가격·수량 ${pairs.length}개로 수가 안 맞아요`);
    // 스스로 검산: 단가×수량 합계가 주문 금액과 크게 다르면 다른 주문 것이 섞였거나 잘못 읽은 것이다.
    if (goods > 0 && (totalCny < goods * 0.5 || totalCny > goods * 2 + shipCny + 1)) {
      problems.push(`검산이 안 맞아요: 단가×수량 합계 ¥${goods.toFixed(2)} ↔ 주문 금액 ¥${totalCny.toFixed(2)}`);
    }

    return {
      orderId: id,
      orderTime: date ? date[1] : '',
      status,
      totalCny,
      shipCny,
      totalKrw: krw ? num(krw[1]) : 0,
      items,
      problems,
      card: head,
      tokens,
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
  let basket = {}; // 담은 주문 (orderId → 주문, items에는 담은 상품만)
  let tracking = {}; // orderId → { packages, fetchedAt, error }
  let open = true;
  let toast = '';
  let toastTimer = null;
  let tracking_busy = false;

  const showToast = (msg) => {
    toast = msg;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast = '';
      render();
    }, 6000);
    render();
  };

  // 예전 방식으로 담은 것(상품 번호 idx 없음)도 읽을 수 있게 맞춘다.
  const normalizeBasket = (b) => {
    const out = {};
    Object.entries(b || {}).forEach(([k, o]) => {
      out[k] = { ...o, items: (o.items || []).map((it, i) => (it.idx == null ? { ...it, idx: i } : it)) };
    });
    return out;
  };
  const basketItem = (orderId, idx) => ((basket[orderId] || {}).items || []).find((x) => x.idx === idx);

  // 담은 상품이 있는 주문만 운송장을 물어본다.
  const loadTrackingQueue = async (force) => {
    if (tracking_busy) return;
    tracking_busy = true;
    try {
      for (const o of orders) {
        if (!basket[o.orderId]) continue;
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
        if (tracking[o.orderId].packages.length) {
          const fresh2 = normalizeBasket(await storageGet(BASKET_KEY));
          if (fresh2[o.orderId]) {
            fresh2[o.orderId] = { ...fresh2[o.orderId], packages: tracking[o.orderId].packages };
            basket = fresh2;
            await storageSet(BASKET_KEY, basket).catch(() => {});
          }
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

  // ───────── 1688 화면의 상품마다 [＋ 담기] 버튼 ─────────
  const pickButtons = new Map(); // `${orderId}#${idx}` → 버튼
  const BTN_BASE = 'display:block;margin:6px 0 0;padding:3px 9px;font-size:12px;line-height:18px;border-radius:6px;cursor:pointer;font-weight:700;white-space:nowrap;font-family:inherit;';
  const paintButton = (btn, o, idx) => {
    const it = basketItem(o.orderId, idx);
    if (o.problems.length) {
      btn.textContent = '⚠ 못 읽음';
      btn.title = o.problems.join('\n');
      btn.style.cssText = `${BTN_BASE}border:1px solid #ccc;background:#f5f5f5;color:#999;`;
    } else if (it) {
      btn.textContent = it.used8282At || it.usedAppAt ? `✅ 담음${it.used8282At ? '·8282' : ''}${it.usedAppAt ? '·앱' : ''}` : '✅ 담음 (빼기)';
      btn.title = '누르면 담은 목록에서 빼요';
      btn.style.cssText = `${BTN_BASE}border:1px solid #ff6a00;background:#ff6a00;color:#fff;`;
    } else {
      btn.textContent = '＋ 담기';
      btn.title = '이 상품을 8282·로켓 앱으로 보낼 목록에 담아요';
      btn.style.cssText = `${BTN_BASE}border:1px solid #ff6a00;background:#fff;color:#ff6a00;`;
    }
  };
  const syncButtons = () => {
    const live = new Set();
    orders.forEach((o) =>
      o.items.forEach((item, idx) => {
        const img = item._img;
        if (!img || !img.isConnected) return;
        const key = `${o.orderId}#${idx}`;
        live.add(key);
        let btn = pickButtons.get(key);
        if (!btn || !btn.isConnected) {
          btn = document.createElement('button');
          btn.type = 'button';
          btn.setAttribute('data-rocket-pick', key);
          btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const cur = orders.find((x) => x.orderId === o.orderId);
            if (cur) toggleItem(cur, idx);
          });
          // 사진을 감싼 링크가 있으면 링크 밖(바로 뒤)에 둔다(누를 때 상품 페이지로 넘어가지 않게).
          let target = img;
          for (let e = img, n = 0; e && n < 3; e = deepParent(e), n++) if (e.tagName === 'A') { target = e; break; }
          target.insertAdjacentElement('afterend', btn);
          pickButtons.set(key, btn);
        }
        paintButton(btn, o, idx);
      }),
    );
    pickButtons.forEach((btn, key) => {
      if (!live.has(key)) {
        btn.remove();
        pickButtons.delete(key);
      }
    });
  };

  let lastSig = '';
  let lastQuick = '';
  const rescan = () => {
    if (document.hidden) return;
    // 1688이 화면을 다시 그려 사진이 바뀌었으면 처음부터 다시 읽는다.
    if (orders.some((o) => o.items.some((it) => it._img && !it._img.isConnected))) lastQuick = '';
    let found;
    try {
      // 화면 글자가 그대로면 다시 읽지 않는다(우리가 붙인 버튼 글자는 빼고 센다).
      const all = collect(document.body);
      const texts = all.filter((t) => t.kind === 'text').map((t) => t.text);
      const quick = `${texts.length}|${texts.join('').length}|${all.filter((t) => t.kind === 'img').length}`;
      if (quick === lastQuick) {
        syncButtons();
        return;
      }
      lastQuick = quick;
      found = findOrders(all).map(parseOrder);
    } catch (err) {
      console.warn('[로켓] 1688 주문 읽기 실패', err);
      return;
    }
    orders = found;
    syncButtons();
    const sig = JSON.stringify(found.map((o) => [o.orderId, o.totalCny, o.problems, o.items.map((it) => [it.title, it.spec, it.unitCny, it.qty])]));
    if (sig === lastSig) return;
    lastSig = sig;
    render();
    loadTrackingQueue(false);
  };

  // ───────── 담기 ─────────
  // 상품 하나를 담거나 뺀다. 결제금액(원화·위안)은 주문 전체 기준으로 이 상품 몫을 미리 나눠 둔다
  // (주문의 일부 상품만 담아도 금액이 맞게).
  const toggleItem = async (o, idx) => {
    if (o.problems.length) {
      alert(`이 주문은 제대로 못 읽었어요:\n· ${o.problems.join('\n· ')}\n\n오른쪽 창의 "🔧 진단 저장"을 눌러 파일을 보내 주세요.`);
      return;
    }
    try {
      basket = normalizeBasket(await storageGet(BASKET_KEY));
      const entry = basket[o.orderId];
      const exists = entry && entry.items.find((x) => x.idx === idx);
      if (exists) {
        if ((exists.used8282At || exists.usedAppAt) && !confirm('이미 8282나 앱에 넣은 상품이에요. 담은 목록에서 뺄까요?')) return;
        entry.items = entry.items.filter((x) => x.idx !== idx);
        if (!entry.items.length) delete basket[o.orderId];
      } else {
        const weights = o.items.map((it) => it.unitCny * it.qty);
        const sum = weights.reduce((a, w) => a + w, 0) || 1;
        const share = weights[idx] / sum;
        const { _img, ...item } = o.items[idx];
        const t = tracking[o.orderId];
        const base = entry || { orderId: o.orderId, items: [], packages: [], addedAt: Date.now() };
        basket[o.orderId] = {
          ...base,
          orderTime: o.orderTime,
          status: o.status,
          totalCny: o.totalCny,
          shipCny: o.shipCny,
          totalKrw: o.totalKrw,
          itemCount: o.items.length,
          packages: (t && t.packages && t.packages.length ? t.packages : base.packages) || [],
          items: [...base.items, { ...item, idx, krw: Math.round(o.totalKrw * share), cnyShare: Math.round(o.totalCny * share * 100) / 100, addedAt: Date.now() }].sort((a, b) => a.idx - b.idx),
          updatedAt: Date.now(),
        };
      }
      await storageSet(BASKET_KEY, basket);
      syncButtons();
      render();
      if (!exists) loadTrackingQueue(false);
    } catch (err) {
      showToast(`담기 실패: ${err.message || err}`);
    }
  };
  const removeItem = async (orderId, idx) => {
    basket = normalizeBasket(await storageGet(BASKET_KEY));
    const entry = basket[orderId];
    if (!entry) return;
    entry.items = entry.items.filter((x) => x.idx !== idx);
    if (!entry.items.length) delete basket[orderId];
    await storageSet(BASKET_KEY, basket).catch((err) => showToast(err.message));
    syncButtons();
    render();
  };
  const clearBasket = async () => {
    if (!confirm('담은 상품을 모두 지울까요? (8282·앱에 이미 넣은 것은 그대로 남아요)')) return;
    basket = {};
    await storageSet(BASKET_KEY, basket).catch((err) => showToast(err.message));
    syncButtons();
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
      orders: orders.map((o) => ({ ...o, card: undefined, tokens: undefined, items: o.items.map(({ _img, ...it }) => it) })),
      tracking,
      firstTrack,
      lastMtopRaw,
      cards: orders.slice(0, 3).map((o) => ({
        orderId: o.orderId,
        tokens: o.tokens.slice(0, 400).map((t) => (t.kind === 'text' ? t.text : t.kind === 'img' ? `[img ${imgSrc(t.el).slice(0, 120)} w=${Math.round(t.el.getBoundingClientRect().width)}]` : `[a ${String(t.href).slice(0, 160)}]`)),
        html: serialize(deepParent(deepParent(deepParent(deepParent(o.card)))) || o.card, 150000),
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
    .prob { color: #cf1322; line-height: 1.5; }
    .hint { color: #666; line-height: 1.5; }
    .hint b { color: #ff6a00; }
    .del { border: 0; background: none; color: #bbb; cursor: pointer; font-size: 13px; align-self: flex-start; padding: 0 2px; }
    .del:hover { color: #cf1322; }
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
  const itemTags = (it) =>
    `${it.used8282At ? '<span class="tag b">8282 넣음</span>' : ''}${it.usedAppAt ? `<span class="tag b">앱${it.usedAppCode ? ` ${esc(it.usedAppCode)}` : ''} 넣음</span>` : ''}`;
  const itemsHtml = (b) =>
    (b.items || [])
      .map(
        (it) => `<div class="it">${it.imageUrl ? `<img src="${esc(it.imageUrl)}_80x80.jpg" alt="">` : ''}<div class="t">
          <div class="nm">${esc(it.title || '(상품명 없음)')}</div>
          ${it.spec ? `<div class="sp">${esc(it.spec)}</div>` : ''}
          <div class="pq">${cny(it.unitCny)} × ${it.qty}개 ${itemTags(it)}</div></div>
          <button class="del" data-act="remove" data-id="${b.orderId}" data-idx="${it.idx}" title="담은 목록에서 빼기">✕</button></div>`,
      )
      .join('');

  const render = () => {
    if (!panelHost.isConnected) document.documentElement.appendChild(panelHost);
    const listEl = root.querySelector('.list');
    const scroll = listEl ? listEl.scrollTop : 0;
    const basketList = Object.values(basket).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const itemCount = basketList.reduce((s2, b) => s2 + (b.items || []).length, 0);
    if (!open) {
      root.innerHTML = `<style>${css}</style><button class="pill" data-act="open">📦 담은 상품${itemCount ? ` ${itemCount}개` : ''}</button>`;
      return;
    }
    const bad = orders.filter((o) => o.problems.length);
    const body = basketList.length
      ? basketList
          .map(
            (b) => `<div class="ord" data-act="jump" data-id="${b.orderId}">
              <div class="oh"><span class="oid">…${esc(b.orderId.slice(-8))}</span><span class="muted">${esc((b.orderTime || '').slice(5, 16))}</span>
              ${b.itemCount > 1 ? `<span class="muted">· 상품 ${b.itemCount}개 중 ${(b.items || []).length}개</span>` : ''}</div>
              ${trackHtml(b.orderId, b.packages)}
              ${itemsHtml(b)}
            </div>`,
          )
          .join('')
      : '<div class="empty">아직 담은 상품이 없어요.<br>왼쪽 1688 화면에서 상품 사진 아래 <b style="color:#ff6a00">＋ 담기</b>를 누르세요.</div>';
    root.innerHTML = `<style>${css}</style>
      <div class="box">
        <div class="hd"><b>📦 담은 상품 ${itemCount}개</b><button class="x" data-act="close" title="접기">–</button></div>
        <div class="acts">
          <div class="hint">1688 화면의 상품 사진 아래 <b>＋ 담기</b>로 골라요. 담은 상품은 8282 신청서·로켓 앱 장바구니에서 가져다 써요.</div>
          ${bad.length ? `<div class="prob">⚠ 이 화면에서 못 읽은 주문 ${bad.length}건(${bad.map((o) => `…${esc(o.orderId.slice(-6))}`).join(', ')}) → 아래 "진단 저장"을 눌러 주세요</div>` : ''}
          <div class="row2"><button class="btn" data-act="retrack">🔄 운송장 다시</button><button class="btn" data-act="diag">🔧 진단 저장</button></div>
          ${basketList.length ? '<button class="btn" data-act="clear">🗑 담은 상품 모두 지우기</button>' : ''}
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
    if (act === 'remove') {
      e.stopPropagation();
      removeItem(id, Number(el.dataset.idx));
      return;
    }
    if (act === 'jump') {
      // 담은 주문을 누르면 1688 화면의 그 주문으로 스크롤.
      const o = orders.find((x) => x.orderId === id);
      const el2 = o && o.card;
      if (el2 && el2.scrollIntoView) {
        el2.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const prev = el2.style.outline;
        el2.style.outline = '3px solid #ff6a00';
        setTimeout(() => {
          el2.style.outline = prev;
        }, 1500);
      } else showToast('이 주문은 지금 1688 화면(이 쪽)에 없어요.');
      return;
    }
    if (act === 'open' || act === 'close') {
      open = act === 'open';
      storageSet(PANEL_OPEN_KEY, open).catch(() => {});
      render();
      return;
    }
    if (act === 'retrack') loadTrackingQueue(true);
    else if (act === 'diag') saveDiagnostics();
    else if (act === 'clear') clearBasket();
  });

  // 8282·앱에서 "넣음" 표시가 바뀌면 바로 보이게 한다.
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes[BASKET_KEY]) return;
      basket = normalizeBasket(changes[BASKET_KEY].newValue);
      syncButtons();
      render();
    });
  } catch (err) {}

  let started = false;
  const start = async () => {
    if (started) return;
    started = true;
    basket = normalizeBasket(await storageGet(BASKET_KEY));
    // 예전 방식(주문을 통째로 담던 때, itemCount 없음)으로 담긴 것은 헷갈리니 지운다.
    const old = Object.keys(basket).filter((k) => basket[k].itemCount == null);
    if (old.length) {
      old.forEach((k) => delete basket[k]);
      await storageSet(BASKET_KEY, basket).catch(() => {});
    }
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
