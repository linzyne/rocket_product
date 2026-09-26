// 서허·광고 페이지와 같은 세계(MAIN world)에서 도는 스크립트.
//  1) 페이지가 서버에서 받아오는 JSON 응답을 복사해서 panel.js로 넘깁니다(막지 않고 보기만 합니다).
//  2) 상품 목록 요청(vendor-items…) 중 "첫 페이지" 요청의 모양을 기억해 두었다가, 자동 수집 때
//     페이지 번호만 바꿔 같은 요청을 다시 보냅니다. 로그인된 페이지가 보내는 것과 똑같은 요청이라
//     별도 로그인이 없습니다. 받은 응답은 panel.js로 넘겨줍니다(페이지마다 결과도 따로 알려줍니다).
(() => {
  if (window.__rocketHubHookInjected) return;
  window.__rocketHubHookInjected = true;

  const SOURCE = 'rocket-hub-hook';
  const PANEL_SOURCE = 'rocket-hub-panel';
  const MAX_CHARS = 3 * 1024 * 1024;
  const MAX_BUFFER = 30;
  // 다시 보낼 수 있는 요청(상품 목록). 쿠팡이 앞 경로를 바꿔도 견디게 이름만 본다.
  const REPLAY_RE = /vendor-items/i;

  // panel.js가 늦게 떠서 놓친 응답을 다시 보내줄 수 있게 최근 것을 남겨 둡니다.
  const buffer = [];
  // 경로(쿼리 제외) -> 마지막 요청 { url, method, headers, body }
  const templates = {};

  const pathOf = (url) => {
    try {
      return new URL(String(url), location.href).pathname;
    } catch (err) {
      return String(url);
    }
  };

  const send = (url, text) => {
    if (!text || text.length > MAX_CHARS) return;
    const head = text.trimStart()[0];
    if (head !== '{' && head !== '[') return;
    const msg = { source: SOURCE, type: 'JSON', url: String(url), text, at: Date.now() };
    buffer.push(msg);
    if (buffer.length > MAX_BUFFER) buffer.shift();
    window.postMessage(msg, window.location.origin);
  };

  // 요청에 들어 있는 페이지 번호 자리의 지금 값(없으면 null).
  // 쿠팡이 0부터 세는지 1부터 세는지 모르기 때문에, 첫 페이지 요청의 값을 기준으로 삼는다.
  const PAGE_KEY_RE = /^(page|pageNo|pageNum|pageNumber|currentPage|pageIndex)$/i;
  const pageValueOf = (url, body) => {
    try {
      const u = new URL(String(url), location.href);
      for (const [k, v] of u.searchParams.entries()) {
        if (PAGE_KEY_RE.test(k) && /^\d+$/.test(v)) return Number(v);
      }
    } catch (err) {}
    if (typeof body === 'string' && body) {
      try {
        let found = null;
        const walk = (obj) => {
          if (!obj || typeof obj !== 'object' || found != null) return;
          for (const k of Object.keys(obj)) {
            if (found != null) return;
            if (PAGE_KEY_RE.test(k) && typeof obj[k] === 'number') {
              found = obj[k];
              return;
            }
            if (obj[k] && typeof obj[k] === 'object') walk(obj[k]);
          }
        };
        walk(JSON.parse(body));
        if (found != null) return found;
      } catch (err) {}
    }
    return null;
  };

  // 본뜰 요청은 "첫 페이지" 것만 남긴다. 2페이지 요청을 본뜨면 "첫 페이지 값 + (n-1)"이 어긋나
  // 엉뚱한 페이지를 받아온다. 검색·필터를 바꾸면 화면이 첫 페이지를 다시 받으므로 그때는 새 것으로 갈아탄다.
  const remember = (url, method, headers, body) => {
    if (!REPLAY_RE.test(String(url))) return;
    const path = pathOf(url);
    const pageValue = pageValueOf(url, body);
    const prev = templates[path];
    if (prev && prev.pageValue != null && pageValue != null && pageValue > prev.pageValue) return;
    templates[path] = {
      url: String(url),
      method: method || 'GET',
      headers: headers || {},
      body: typeof body === 'string' ? body : null,
      pageValue,
    };
  };

  const headersToObject = (h) => {
    const out = {};
    if (!h) return out;
    if (typeof h.forEach === 'function' && !Array.isArray(h)) h.forEach((v, k) => { out[k] = v; });
    else if (Array.isArray(h)) h.forEach(([k, v]) => { out[k] = v; });
    else Object.assign(out, h);
    return out;
  };

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    try {
      const input = args[0];
      const init = args[1] || {};
      const url = (input && input.url) || input;
      remember(url, init.method || (input && input.method), headersToObject(init.headers || (input && input.headers)), init.body);
    } catch (err) {}
    const response = await origFetch.apply(this, args);
    try {
      const type = response.headers.get('content-type') || '';
      if (/json/i.test(type)) {
        const url = (args[0] && args[0].url) || args[0];
        response.clone().text().then(text => send(url, text)).catch(() => {});
      }
    } catch (err) {}
    return response;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__rocketUrl = url;
    this.__rocketMethod = method;
    this.__rocketHeaders = {};
    return origOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    if (this.__rocketHeaders) this.__rocketHeaders[k] = v;
    return origSetHeader.call(this, k, v);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    try {
      remember(this.__rocketUrl, this.__rocketMethod, this.__rocketHeaders, args[0]);
    } catch (err) {}
    this.addEventListener('load', () => {
      try {
        const type = this.getResponseHeader('content-type') || '';
        if (!/json/i.test(type)) return;
        if (this.responseType && this.responseType !== 'text' && this.responseType !== 'json') return;
        const text = this.responseType === 'json' ? JSON.stringify(this.response) : this.responseText;
        send(this.__rocketUrl, text);
      } catch (err) {}
    });
    return origSend.apply(this, args);
  };

  // 본뜬 요청(첫 페이지)에서 페이지 번호만 바꿉니다. 첫 페이지 값이 0이면 0부터, 1이면 1부터 세는
  // 방식이므로 "첫 페이지 값 + (n-1)"을 넣습니다. 페이지 번호 자리를 못 찾으면 null.
  const withPage = (tpl, page) => {
    const base = tpl.pageValue == null ? 1 : tpl.pageValue;
    const target = String(base + (page - 1));
    let changed = false;
    let url = tpl.url;
    try {
      const u = new URL(tpl.url, location.href);
      for (const [k] of Array.from(u.searchParams.entries())) {
        if (PAGE_KEY_RE.test(k)) {
          u.searchParams.set(k, target);
          changed = true;
        }
      }
      url = u.href;
    } catch (err) {}
    let body = tpl.body;
    if (body) {
      try {
        const json = JSON.parse(body);
        const walk = (obj) => {
          if (!obj || typeof obj !== 'object') return;
          for (const k of Object.keys(obj)) {
            if (PAGE_KEY_RE.test(k) && typeof obj[k] === 'number') {
              obj[k] = base + (page - 1);
              changed = true;
            } else if (obj[k] && typeof obj[k] === 'object') walk(obj[k]);
          }
        };
        walk(json);
        body = JSON.stringify(json);
      } catch (err) {}
    }
    return changed ? { url, body } : null;
  };

  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    const d = event.data;
    if (!d || d.source !== PANEL_SOURCE) return;

    if (d.type === 'GET_BUFFER') {
      buffer.forEach((msg) => window.postMessage(msg, window.location.origin));
      return;
    }

    if (d.type === 'FETCH_PAGES') {
      // 페이지마다 따로 알려줍니다. 한 번에 여러 장을 맡고 마지막에만 알리면,
      // 페이지가 많을 때 panel.js의 기다림이 먼저 끝나 버려 "못 가져왔다"고 잘못 봅니다.
      const replyPage = (page, ok, error) =>
        window.postMessage({ source: SOURCE, type: 'FETCH_PAGE_RESULT', path: d.path, page, ok, error }, window.location.origin);
      const found = Object.entries(templates).find(([path]) => path.endsWith(d.path));
      if (!found) {
        (d.pages || []).forEach((page) => replyPage(page, false, 'no-template'));
        return;
      }
      const tpl = found[1];
      for (const page of d.pages) {
        const req = withPage(tpl, page);
        if (!req) return replyPage(page, false, 'no-page-param');
        try {
          const headers = { ...tpl.headers };
          delete headers['content-length'];
          // 원래 fetch로 보냅니다. 우리가 덮어쓴 fetch로 보내면 이 요청이 "본뜰 요청"으로 다시 기억되어
          // 다음 페이지 번호 계산이 어긋납니다. 그래서 응답도 여기서 직접 넘겨줍니다.
          const res = await origFetch.call(
            window,
            req.url,
            { method: tpl.method, headers, body: /^(GET|HEAD)$/i.test(tpl.method) ? undefined : req.body, credentials: 'include' }
          );
          if (!res.ok) return replyPage(page, false, `HTTP ${res.status}`);
          const text = await res.text();
          const head = String(text).trimStart()[0];
          if (head !== '{' && head !== '[') return replyPage(page, false, 'not-json');
          send(req.url, text);
          replyPage(page, true);
        } catch (err) {
          return replyPage(page, false, String((err && err.message) || err));
        }
      }
    }
  });
})();
