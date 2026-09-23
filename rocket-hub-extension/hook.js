// 서허·광고 페이지와 같은 세계(MAIN world)에서 도는 스크립트.
//  1) 페이지가 서버에서 받아오는 JSON 응답을 복사해서 panel.js로 넘깁니다(막지 않고 보기만 합니다).
//  2) 상품 목록 요청(product-api/vendor-items…)의 모양을 기억해 두었다가, 자동 수집 때 페이지 번호만
//     바꿔 같은 요청을 다시 보냅니다. 로그인된 페이지가 보내는 것과 똑같은 요청이라 별도 로그인이 없습니다.
//     응답은 1)을 거쳐 panel.js로 그대로 들어갑니다.
(() => {
  if (window.__rocketHubHookInjected) return;
  window.__rocketHubHookInjected = true;

  const SOURCE = 'rocket-hub-hook';
  const PANEL_SOURCE = 'rocket-hub-panel';
  const MAX_CHARS = 3 * 1024 * 1024;
  const MAX_BUFFER = 30;
  const REPLAY_RE = /\/product-api\/vendor-items/;

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

  const remember = (url, method, headers, body) => {
    if (!REPLAY_RE.test(String(url))) return;
    templates[pathOf(url)] = { url: String(url), method: method || 'GET', headers: headers || {}, body: typeof body === 'string' ? body : null };
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

  // 요청에서 페이지 번호 자리를 찾아 바꿉니다(쿼리 ?page= 또는 JSON 본문의 page 계열 키).
  // 원래 값이 0이면 0부터 세는 방식으로 보고 page-1을 넣습니다. 못 찾으면 null.
  const PAGE_KEY_RE = /^(page|pageNo|pageNum|pageNumber|currentPage|pageIndex)$/i;
  const withPage = (tpl, page) => {
    let changed = false;
    let url = tpl.url;
    try {
      const u = new URL(tpl.url, location.href);
      for (const [k, v] of Array.from(u.searchParams.entries())) {
        if (PAGE_KEY_RE.test(k)) {
          u.searchParams.set(k, String(v === '0' ? page - 1 : page));
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
              obj[k] = obj[k] === 0 ? page - 1 : page;
              changed = true;
            } else if (typeof obj[k] === 'object') walk(obj[k]);
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
      const tpl = Object.entries(templates).find(([path]) => path.endsWith(d.path));
      const reply = (ok, error) => window.postMessage({ source: SOURCE, type: 'FETCH_PAGES_RESULT', path: d.path, ok, error }, window.location.origin);
      if (!tpl) return reply(false, 'no-template');
      for (const page of d.pages) {
        const req = withPage(tpl[1], page);
        if (!req) return reply(false, 'no-page-param');
        try {
          const headers = { ...tpl[1].headers };
          delete headers['content-length'];
          const res = await window.fetch(req.url, { method: tpl[1].method, headers, body: tpl[1].method === 'GET' ? undefined : req.body, credentials: 'include' });
          if (!res.ok) return reply(false, `HTTP ${res.status}`);
        } catch (err) {
          return reply(false, String((err && err.message) || err));
        }
      }
      reply(true);
    }
  });
})();
