// 광고 화면 오른쪽 아래에 작은 패널을 띄우고, 화면이 바뀔 때마다(페이지 넘김·탭 전환·검색)
// 해당 수집기로 값을 뽑아 chrome.storage에 쌓습니다. 앱은 app-bridge.js를 통해 이 값을 가져갑니다.
//
// 저장 모양: hubData = { [수집기 id]: { items: { [key]: 항목 }, startedAt, updatedAt } }
//
// 자동 수집(앱의 "확장에서 가져오기" → background.js가 hubAutoRun을 남기고 이 화면을 엶):
//   광고 중인 상품 탭 → 광고하지 않는 상품 탭 순서로 열어서, 페이지가 받은 1페이지 응답으로 전체 페이지 수를
//   알아낸 뒤 나머지 페이지는 hook.js가 같은 요청을 페이지 번호만 바꿔 한 장씩 다시 보냅니다.
//   다 받았는지는 "이 단계에서 담은 상품 개수"로 봅니다(페이지 번호를 0부터 세는 응답도 있어 믿지 않습니다).
//   막히면 페이지 번호를 눌러 화면에서 직접 읽습니다. 끝나면 hubAutoRun.done=true → 앱이 그 값을 가져갑니다.
//   광고 중인 탭을 먼저 도는 이유: "광고하지 않는 상품" 목록에 광고 중인 상품이 섞여 오더라도,
//   이미 광고 중으로 잡힌 상품은 되돌리지 않기 때문입니다(doSave).
//
// 물류창고입고 자동 수집(앱의 물류 › 물류창고입고 "자동으로 가져오기" → background.js가 hubReceiveRun을
//   남기고 서허 입고상세내역을 엶): 앱이 고른 날짜로 기간을 맞추고 검색한 뒤, 페이지를 끝까지 넘기며 표를 모읍니다.
(() => {
  if (window.__rocketHubPanelInjected) return;
  window.__rocketHubPanelInjected = true;

  const DATA_KEY = 'hubData';
  const AUTO_KEY = 'hubAutoRun';
  const RECEIVE_KEY = 'hubReceiveRun';
  const LOG_KEY = 'hubLog';
  const HOOK_SOURCE = 'rocket-hub-hook';
  const PANEL_SOURCE = 'rocket-hub-panel';
  // 오래된 요청이 남아 엉뚱할 때 돌지 않도록, 마지막 소식(touchedAt) 뒤 5분 안에만 이어갑니다.
  const AUTO_MAX_AGE_MS = 5 * 60 * 1000;
  const AUTO_STEPS = [
    { id: 'ad', page: '/marketing/product-dashboard/advertised', api: '/vendor-items-advertised', label: '광고 중인 상품' },
    { id: 'noad', page: '/marketing/product-dashboard', api: '/vendor-items', label: '광고하지 않는 상품' },
  ];
  const MAX_RAW = 60;

  const collectors = window.__rocketHubCollectors || [];
  const raw = [];
  let panel = null;
  let collapsed = false;
  let timer = null;
  let autoStatus = '';
  // 상품 목록 응답이 온 탭별 정보. { '/vendor-items': { totalPages, total } }
  const pagingSeen = {};
  // 자동 수집 중인 단계. 다른 주소로 옮기는 중이면(autoNavigating) 이 화면에서는 더 하지 않는다.
  let autoStep = null;
  let autoNavigating = false;
  // 다른 창(확장이 연 수집 창)에서 수집이 돌고 있으면, 사장님이 열어둔 이 탭이 받은 값은 저장하지 않는다.
  // 이 탭이 다른 탭을 보고 있으면 같은 상품의 광고 여부를 거꾸로 덮어쓸 수 있다.
  let foreignRun = null;
  // 이 화면에서 담은 상품 번호들(탭별). 자동 수집에서 "다 받았는지"를 개수로 셀 때 쓴다.
  // 패널이 뜨기 전에 온 1페이지 응답도 세어야 하므로, 단계가 시작되기 전부터 계속 모아 둔다.
  const pageKeys = {};
  const keysFor = (api) => pageKeys[api] || (pageKeys[api] = new Set());
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const activeCollector = () => collectors.find((c) => c.match());

  const storageGet = () =>
    new Promise((resolve) => {
      try {
        chrome.storage.local.get(DATA_KEY, (r) => resolve((r && r[DATA_KEY]) || {}));
      } catch (err) {
        resolve({});
      }
    });
  const storageSet = (value) =>
    new Promise((resolve) => {
      try {
        chrome.storage.local.set({ [DATA_KEY]: value }, () => resolve());
      } catch (err) {
        resolve();
      }
    });

  const runGet = (key) =>
    new Promise((resolve) => {
      try {
        chrome.storage.local.get(key, (r) => resolve((r && r[key]) || null));
      } catch (err) {
        resolve(null);
      }
    });
  const runSet = (key, value) =>
    new Promise((resolve) => {
      try {
        chrome.storage.local.set({ [key]: value }, () => resolve());
      } catch (err) {
        resolve();
      }
    });
  const autoGet = () => runGet(AUTO_KEY);
  const autoSet = (value) => runSet(AUTO_KEY, value);

  // ---- 수집 로그 ----
  // 수집이 어디서 어긋났는지 나중에 볼 수 있게 한 줄씩 적어 둡니다. 앱의 재고 › 상품관리에서
  // 파일로 내려받아 그대로 넘기면 됩니다(상품명·재고 같은 사장님 장사 자료가 함께 담깁니다).
  // 단계마다 화면을 새로 열기 때문에, 같은 요청(requestedAt)이면 앞 단계 로그에 이어 적습니다.
  let log = null;
  let logTimer = null;
  const saveLog = () => {
    if (!log) return;
    clearTimeout(logTimer);
    logTimer = setTimeout(() => runSet(LOG_KEY, log), 300);
  };
  const saveLogNow = () => {
    clearTimeout(logTimer);
    return log ? runSet(LOG_KEY, log) : Promise.resolve();
  };
  const logLine = (text) => {
    if (!log) return;
    log.lines.push(`${new Date().toLocaleTimeString('ko-KR')} ${text}`);
    if (log.lines.length > 500) log.lines.shift();
    saveLog();
  };
  const startLog = async (kind, run) => {
    const prev = await runGet(LOG_KEY);
    if (prev && prev.requestedAt && prev.requestedAt === run.requestedAt) {
      log = prev;
      logLine(`─── 화면 다시 열림: ${location.pathname}`);
      return;
    }
    let version = '';
    try {
      version = chrome.runtime.getManifest().version;
    } catch (err) {}
    log = {
      kind,
      version,
      requestedAt: run.requestedAt || 0,
      startedAt: new Date().toISOString(),
      firstPage: location.href,
      title: document.title,
      lines: [],
      // 주소별 JSON 응답 횟수. 쿠팡이 목록 주소를 바꿨는지 여기서 알 수 있습니다.
      urls: {},
      // 탭별 첫 목록 응답의 앞부분(상품 칸 이름이 바뀌었는지 보려고).
      samples: [],
      error: '',
    };
    logLine(`수집 시작 (확장 ${version || '?'}) · ${location.href}`);
  };
  // 목록 응답을 받았을 때 남기는 자취.
  const logResponse = (api, path, text, json, items) => {
    if (!log) return;
    log.urls[path] = (log.urls[path] || 0) + 1;
    if (!api) return;
    const p = findPaging(json);
    logLine(`목록 응답 ${api} · 뽑은 상품 ${items ? items.length : 0}개 · 전체페이지 ${p && p.totalPages != null ? p.totalPages : '?'} · 전체상품 ${p && p.total != null ? p.total : '?'}`);
    if (log.samples.some((x) => x.api === api)) return;
    log.samples.push({
      api,
      path,
      parsed: items ? items.length : 0,
      firstItem: (items && items[0]) || null,
      // 칸 이름을 보려면 원본이 있어야 해서 앞부분만 담습니다.
      body: String(text || '').slice(0, 20000),
    });
    saveLog();
  };

  // 이 응답이 어느 탭의 상품 목록인지(collectors.js와 같은 규칙). 목록이 아니면 null.
  const apiOf = (url) => (window.__rocketHubAdsApiOf ? window.__rocketHubAdsApiOf(url) : null);

  // 응답 어디에 있든 페이지 정보를 찾는다(쿠팡이 칸 이름이나 자리를 바꿔도 견디도록).
  const numOf = (v) => (v != null && v !== '' && typeof v !== 'boolean' && Number.isFinite(Number(v)) ? Number(v) : null);
  const findPaging = (json) => {
    let out = null;
    const seen = new Set();
    const pick = (node, keys) => {
      for (const k of keys) {
        const v = numOf(node[k]);
        if (v != null) return v;
      }
      return null;
    };
    const walk = (node, depth) => {
      if (!node || typeof node !== 'object' || depth > 6 || seen.has(node)) return;
      seen.add(node);
      if (Array.isArray(node)) {
        for (const v of node) walk(v, depth + 1);
        return;
      }
      const totalPages = pick(node, ['totalPages', 'totalPage', 'pageCount', 'totalPageCount', 'lastPage']);
      const total = pick(node, ['totalElements', 'totalItems', 'totalCount', 'totalElementCount', 'total']);
      if (totalPages != null || total != null) {
        out = out || { totalPages: null, total: null };
        if (out.totalPages == null) out.totalPages = totalPages;
        if (out.total == null) out.total = total;
      }
      for (const v of Object.values(node)) walk(v, depth + 1);
    };
    walk(json, 0);
    return out;
  };

  // 목록 응답이 왔다는 표시. 전체 페이지 수·상품 수를 알면 같이 적어 둔다.
  // 몇 페이지짜리 응답인지는 응답마다 세는 방식이 달라(0부터/1부터) 믿지 않고,
  // "우리가 몇 개를 담았는지"로 다 받았는지 확인한다.
  const noteList = (api, json) => {
    const seen = pagingSeen[api] || (pagingSeen[api] = { totalPages: 1, total: null });
    const p = findPaging(json);
    if (!p) return;
    if (p.totalPages != null) seen.totalPages = Math.max(1, p.totalPages);
    if (p.total != null) seen.total = p.total;
  };

  // hook.js가 넘겨주는 JSON 응답.
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const d = event.data;
    if (!d || d.source !== HOOK_SOURCE || d.type !== 'JSON') return;
    raw.push({ url: d.url, at: d.at, page: location.href, text: d.text });
    if (raw.length > MAX_RAW) raw.shift();
    const api = apiOf(d.url);
    let path = String(d.url);
    try {
      path = new URL(String(d.url), location.href).pathname;
    } catch (err) {}
    // 자동 수집 중에는 지금 단계의 탭 목록만 받는다. 두 탭 목록이 섞이면 광고 여부와 개수가 어긋난다.
    if (api && autoStep && api !== autoStep.api) {
      logLine(`다른 탭 목록이라 흘려보냄: ${api}`);
      return;
    }
    let json = null;
    try {
      json = JSON.parse(d.text);
    } catch (err) {}
    if (api) noteList(api, json);
    const c = activeCollector();
    let items = [];
    if (c && c.fromResponse) {
      try {
        items = c.fromResponse(d.url, json) || [];
      } catch (err) {
        logLine(`목록 해석 실패: ${(err && err.message) || err}`);
      }
    }
    logResponse(api, path, d.text, json, items);
    if (items.length) {
      if (api) for (const it of items) keysFor(api).add(it.key);
      saveItems(c, items);
      return;
    }
    render();
  });

  // 같은 key는 합칩니다. 응답에서 온 값(사진 포함)이 화면에서 읽은 값보다 정확하므로 나중 값이 덮어씁니다.
  // 응답이 연달아 오면 읽고-쓰기가 겹쳐 앞의 것을 덮어쓰므로, 저장은 한 줄로 세워서 차례로 합니다.
  let saveChain = Promise.resolve();
  const queue = (fn) => (saveChain = saveChain.then(fn).catch(() => {}));
  const saveItems = (c, items) => queue(() => doSave(c, items));
  const doSave = async (c, items) => {
    if (foreignRun && fresh(foreignRun)) return;
    const data = await storageGet();
    const bucket = data[c.id] || { items: {}, startedAt: Date.now() };
    const now = Date.now();
    for (const item of items) {
      const prev = bucket.items[item.key];
      const next = { ...prev, ...item, seenAt: now };
      // "광고 중인 상품"으로 이미 잡힌 상품은, 뒤에 오는 전체 목록이 "광고 안 함"으로 되돌리지 않게 한다
      // (전체 목록에는 광고 중인 상품도 같이 들어 있을 수 있다).
      if (autoStep && prev && prev.adState === 'ad' && next.adState !== 'ad') next.adState = 'ad';
      bucket.items[item.key] = next;
      // 화면에서 읽어 담은 것도 이 단계 몫으로 센다(자동 수집 중에는 이 단계 탭만 들어온다).
      if (autoStep) keysFor(autoStep.api).add(item.key);
    }
    bucket.updatedAt = now;
    data[c.id] = bucket;
    await storageSet(data);
    lastPageCount = items.length;
    render(data);
  };

  const collectNow = async () => {
    const c = activeCollector();
    if (!c) return;
    let items = [];
    try {
      items = c.collect() || [];
    } catch (err) {
      console.warn('[로켓 서허 연동] 수집 실패', err);
    }
    if (!items.length) {
      render();
      return;
    }
    await saveItems(c, items);
  };

  let lastPageCount = 0;

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(collectNow, 700);
  };

  const clearBucket = (c) =>
    queue(async () => {
      const data = await storageGet();
      data[c.id] = { items: {}, startedAt: Date.now() };
      await storageSet(data);
      lastPageCount = 0;
    });

  const resetCollector = async () => {
    const c = activeCollector();
    if (!c) return;
    if (!confirm(`"${c.label}"에 모아둔 값을 비우고 처음부터 다시 모을까요?`)) return;
    await clearBucket(c);
    collectNow();
  };

  // ---- 자동 수집 ----
  const waitFor = async (fn, timeout) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const v = fn();
      if (v) return v;
      await sleep(300);
    }
    return null;
  };

  // 페이지 하나를 hook.js가 다시 요청하게 한다(응답은 위 message 처리로 들어와 저장된다).
  // 여러 페이지를 한 번에 맡기면 오래 걸려 기다림이 먼저 끝나 버리므로 한 장씩 주고받는다.
  const fetchPage = (api, page) =>
    new Promise((resolve) => {
      let settled = false;
      const finish = (res) => {
        if (settled) return;
        settled = true;
        window.removeEventListener('message', onMsg);
        resolve(res);
      };
      const onMsg = (event) => {
        const d = event.data;
        if (event.source !== window || !d || d.source !== HOOK_SOURCE || d.path !== api) return;
        if (d.type === 'FETCH_PAGE_RESULT' && d.page === page) finish(d);
      };
      window.addEventListener('message', onMsg);
      window.postMessage({ source: PANEL_SOURCE, type: 'FETCH_PAGES', path: api, pages: [page] }, window.location.origin);
      setTimeout(() => finish({ ok: false, error: 'timeout' }), 25000);
    });

  // 요청 다시 보내기가 안 될 때: 화면 아래 페이지 번호를 눌러서 넘깁니다.
  const clickPage = (page) => {
    const cands = Array.from(document.querySelectorAll('button, a, li, span, div')).filter((el) => {
      if (panel && panel.contains(el)) return false;
      if ((el.textContent || '').trim() !== String(page) || el.children.length > 1) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    const el = cands[cands.length - 1];
    if (!el) return false;
    (el.closest('button, a, li') || el).click();
    return true;
  };

  // 화면에 상품 카드("ID : 숫자")가 한 장이라도 보이는지. 상품이 0개인 탭과
  // 화면은 있는데 못 담은 경우를 가른다.
  const screenHasProducts = () => /ID\s*:\s*\d{6,}/.test(document.body.innerText || '');

  // 실제로 내려가는 곳. 창이 안 내려가는 화면이면 목록을 담고 있는 안쪽 상자를 찾는다.
  const scroller = () => {
    const doc = document.scrollingElement || document.documentElement;
    if (doc.scrollHeight > doc.clientHeight + 50) return doc;
    let best = null;
    for (const el of document.querySelectorAll('div, main, section, ul')) {
      if (panel && panel.contains(el)) continue;
      if (el.scrollHeight <= el.clientHeight + 50) continue;
      if (!/overlay|auto|scroll/.test(getComputedStyle(el).overflowY)) continue;
      if (!best || el.scrollHeight > best.scrollHeight) best = el;
    }
    return best || doc;
  };

  // 화면 아래쪽 카드는 스크롤해야 그려진다. 끝까지 조금씩 내리며 그때그때 담는다.
  const scrollCollect = async () => {
    const box = scroller();
    const start = box.scrollTop;
    for (let i = 0; i < 60; i++) {
      await collectNow();
      const y = box.scrollTop;
      if (y + box.clientHeight >= box.scrollHeight - 8) break;
      box.scrollTop = y + Math.round(box.clientHeight * 0.75);
      await sleep(450);
      if (box.scrollTop === y) break; // 더 안 내려가면 끝
    }
    await collectNow();
    box.scrollTop = start;
    await sleep(200);
  };

  // 응답으로 한 줄도 못 담았을 때의 대비책: 페이지를 넘기며 화면을 훑어 담는다.
  const collectByScreen = async (c, totalPages, label) => {
    for (let p = 1; p <= totalPages; p++) {
      if (p > 1) {
        if (!clickPage(p)) break;
        await sleep(1200);
      }
      autoStatus = `자동 수집 중 · ${label} ${p}/${totalPages}페이지 화면에서 읽는 중`;
      render();
      await scrollCollect();
    }
    await queue(() => sleep(200));
  };

  const failAuto = async (run, message) => {
    run.error = message;
    run.finishedAt = Date.now();
    // 앱이 오류를 보면 바로 로그를 가져가므로, 로그를 먼저 다 적어 둔다.
    if (log) {
      log.error = message;
      logLine(`❌ 실패: ${message}`);
      log.screenHasProducts = screenHasProducts();
      log.lastPage = location.href;
      try {
        log.sampleCards = window.__rocketHubSampleCards ? window.__rocketHubSampleCards() : [];
      } catch (err) {}
      await saveLogNow();
    }
    await autoSet(run);
    autoStatus = `❌ ${message}`;
    render();
    try {
      chrome.runtime.sendMessage({ type: 'HUB_AUTO_DONE' });
    } catch (err) {}
  };

  // 앱에 "아직 돌고 있다"고 알린다. 앱은 소식이 한참 없으면 끊긴 것으로 보고 멈추기 때문에,
  // 페이지가 많아 오래 걸릴 때도 기다려 주도록 진행 상황을 계속 적어 준다.
  const touch = async (run, force) => {
    const now = Date.now();
    if (!force && now - (run.touchedAt || 0) < 3000) return;
    run.touchedAt = now;
    run.status = autoStatus;
    await autoSet(run);
  };

  const runAuto = async (run) => {
    const idx = Math.max(0, AUTO_STEPS.findIndex((s) => s.id === run.step));
    const step = AUTO_STEPS[idx];
    // 이 단계의 탭으로 옮긴다. 화면이 스스로 다른 주소로 바꿔 놓는 경우가 있어 한 번만 옮긴다
    // (주소가 다르다고 계속 옮기면 새로고침만 되풀이한다).
    if (location.pathname.replace(/\/$/, '') !== step.page && run.goneTo !== step.id) {
      await startLog('ads', run);
      logLine(`"${step.label}" 화면으로 옮김: ${location.pathname} → ${step.page}`);
      await saveLogNow();
      run.goneTo = step.id;
      autoNavigating = true;
      await autoSet(run);
      location.href = step.page;
      return;
    }
    await startLog('ads', run);
    logLine(`단계 "${step.label}" 시작 · 주소 ${location.pathname}`);
    const c = activeCollector();
    if (!c) return failAuto(run, '광고 상품 대시보드 화면이 열리지 않았어요. 쿠팡 광고 사이트에 로그인돼 있는지 확인해 주세요.');
    // 이번 수집에 없던 상품을 앱이 알아볼 수 있게, 처음 한 번 비우고 시작합니다.
    if (!run.cleared) {
      await clearBucket(c);
      run.cleared = true;
      await autoSet(run);
    }
    autoStep = step;
    // 이 화면이 뜨기 전에 온 응답도 받도록 hook.js에 다시 보내 달라고 합니다.
    window.postMessage({ source: PANEL_SOURCE, type: 'GET_BUFFER' }, window.location.origin);

    autoStatus = `자동 수집 중 · ${step.label} 불러오는 중`;
    render();
    await touch(run, true);

    let seen = await waitFor(() => pagingSeen[step.api], 20000);
    // 목록이 안 오면 탭 이름을 눌러 본다(주소는 맞는데 다른 탭이 열려 있을 수 있다).
    if (!seen) {
      const tab = findByText(step.label);
      if (tab) {
        autoStatus = `자동 수집 중 · "${step.label}" 탭 누르는 중`;
        render();
        logLine(`목록이 안 와서 "${step.label}" 탭을 눌러 봄`);
        clickEl(tab);
        seen = await waitFor(() => pagingSeen[step.api], 20000);
      } else {
        logLine(`목록이 안 오고 "${step.label}" 탭도 못 찾음`);
      }
    }
    if (!seen && !screenHasProducts()) {
      return failAuto(run, `${step.label} 목록을 받지 못했어요. 광고 사이트 로그인을 확인해 주세요.`);
    }

    const totalPages = seen ? seen.totalPages : 1;
    const total = seen ? seen.total : null; // 이 탭의 상품 수(모르면 null)
    logLine(`전체 ${totalPages}페이지 · 전체상품 ${total == null ? '모름' : total}개`);
    let pageError = '';
    for (let p = 2; p <= totalPages; p++) {
      autoStatus = `자동 수집 중 · ${step.label} ${p}/${totalPages}페이지`;
      render();
      await touch(run);
      const res = await fetchPage(step.api, p);
      if (!res.ok) {
        pageError = String(res.error || '');
        logLine(`${p}페이지 못 받음: ${pageError}`);
        break;
      }
      await queue(() => sleep(0)); // 저장이 끝난 뒤 다음 페이지
    }
    await queue(() => sleep(200));

    // 다 담았는지 개수로 확인한다. 상품 수(total)는 응답마다 뜻이 다를 수 있어,
    // 한 페이지당 개수가 말이 될 때만(1~500개) 믿는다. 모르면 "한 건이라도 담았는지"로 본다.
    const got = keysFor(step.api).size;
    const perPage = total != null && totalPages > 0 ? total / totalPages : null;
    const expected = perPage != null && perPage >= 1 && perPage <= 500 ? total : null;
    logLine(`${step.label} 담은 상품 ${got}개 (있어야 할 개수 ${expected == null ? '모름' : expected})`);
    if (pageError || (expected == null ? !got : got < expected)) {
      if (!got && (total === 0 || !screenHasProducts())) {
        autoStatus = `${step.label}은 없어요 · 다음으로 넘어갑니다`;
        logLine(`${step.label}에 상품이 없어 넘어감`);
        render();
      } else {
        // 요청 다시 보내기가 막혔거나 빠진 게 있으면, 페이지를 넘기며 화면에서 읽어 담는다.
        logLine(`빠진 게 있어 화면에서 직접 읽기 시작(${totalPages}페이지)`);
        await collectByScreen(c, totalPages, step.label);
        logLine(`화면에서 읽은 뒤 ${keysFor(step.api).size}개`);
        await touch(run, true);
        if (!keysFor(step.api).size) {
          return failAuto(run, `${step.label}에서 한 건도 담지 못했어요. 광고 화면에 상품이 보이는지 확인해 주세요.`);
        }
      }
    }
    // 끝내 모자라면 앱에도 알린다. "완료"라고만 하면 빠진 상품을 사장님이 알 수 없다.
    const after = keysFor(step.api).size;
    if (expected != null && after < expected) {
      const note = `${step.label} ${expected}개 중 ${after}개만 가져왔어요`;
      run.warn = run.warn ? `${run.warn} · ${note}` : note;
      logLine(`⚠️ ${note}${pageError ? ` (${pageError})` : ''}`);
    }
    autoStep = null;

    if (idx < AUTO_STEPS.length - 1) {
      const next = AUTO_STEPS[idx + 1];
      run.step = next.id;
      run.goneTo = next.id;
      autoStatus = `자동 수집 중 · ${next.label} 화면으로 넘어가는 중`;
      logLine(`다음 단계 "${next.label}" 화면으로 넘어감 → ${next.page}`);
      await saveLogNow();
      autoNavigating = true;
      await touch(run, true);
      location.href = next.page;
      return;
    }
    run.done = true;
    run.finishedAt = Date.now();
    run.status = '';
    logLine('✅ 두 탭 모두 끝');
    await saveLogNow();
    await autoSet(run);
    autoStatus = '✅ 자동 수집 완료 · 앱에 반영했어요';
    render();
    try {
      chrome.runtime.sendMessage({ type: 'HUB_AUTO_DONE' });
    } catch (err) {}
  };


  // ---- 물류창고입고 자동 수집(서허 입고상세내역) ----
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  // 글자가 딱 맞는 버튼 찾기(우리 패널 안은 뺀다). 안쪽 요소가 먼저 걸리도록 마지막 것을 쓴다.
  const findByText = (text, selector) =>
    Array.from(document.querySelectorAll(selector || 'button, a, span, div, li, label'))
      .filter((el) => !(panel && panel.contains(el)) && el.children.length === 0 && (el.textContent || '').trim() === text && visible(el))
      .pop() || null;

  // 화면(React)이 알아채도록 진짜 클릭처럼 눌러준다.
  const clickEl = (el) => {
    if (!el) return false;
    const target = el.closest('button, a, li, [role="button"]') || el;
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
      target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
    return true;
  };

  // 기간검색의 날짜 칸 두 개(값이 2026-09-22 모양인 입력칸).
  const dateInputs = () =>
    Array.from(document.querySelectorAll('input')).filter((el) => /^\d{4}-\d{2}-\d{2}$/.test(el.value || '') && visible(el));

  // React가 쓰는 입력칸은 value를 그냥 바꾸면 모르기 때문에, 원래 setter로 바꾸고 이벤트를 보낸다.
  const setInput = (el, value) => {
    try {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, value);
    } catch (err) {
      el.value = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const dateRangeIs = (day) => {
    const inputs = dateInputs();
    return inputs.length >= 2 && inputs.every((el) => el.value === day);
  };

  // 지금 표에 보이는 줄들. 어느 날짜가 나왔는지 확인하는 데도 쓴다.
  const receiveItems = () => {
    const c = collectors.find((x) => x.id === 'receiveDetail');
    try {
      return (c && c.collect()) || [];
    } catch (err) {
      return [];
    }
  };

  // 지금 표에 보이는 줄들의 자취. 검색·페이지 넘김이 끝났는지 알아볼 때 쓴다.
  const receiveSign = () => {
    const items = receiveItems();
    return items.length ? `${items.length}|${items[0].key}|${items[items.length - 1].key}` : '';
  };

  // 표에 그 날짜 줄만 있는지. 검색이 실제로 반영됐는지 이걸로 본다.
  const rowsAreDay = (day) => {
    const items = receiveItems();
    return items.length > 0 && items.every((it) => String(it.date || '').startsWith(day));
  };
  const otherDays = (day) => {
    const set = new Set(receiveItems().map((it) => String(it.date || '').slice(0, 10)).filter((d) => d && d !== day));
    return Array.from(set);
  };

  // 표 아래 페이지 번호 버튼(표 안의 숫자와 헷갈리지 않게 버튼·링크만 본다).
  const pageEl = (page) =>
    Array.from(document.querySelectorAll('button, a, li, [role="button"]'))
      .filter((el) => !(panel && panel.contains(el)) && (el.textContent || '').trim() === String(page) && visible(el))
      .pop() || null;

  const receiveStatus = (text) => {
    autoStatus = text;
    render();
  };

  const failReceive = async (run, message) => {
    run.error = message;
    run.finishedAt = Date.now();
    if (log) {
      log.error = message;
      logLine(`❌ 실패: ${message}`);
      log.lastPage = location.href;
      log.dateInputs = dateInputs().map((el) => el.value);
      await saveLogNow();
    }
    await runSet(RECEIVE_KEY, run);
    receiveStatus(`❌ ${message}`);
    try {
      chrome.runtime.sendMessage({ type: 'HUB_RECEIVE_DONE' });
    } catch (err) {}
  };

  // 날짜 칸에 직접 적기. 달력이 딸린 칸이라 적은 뒤 Enter·포커스 해제까지 해 줘야 화면이 알아챈다.
  const typeDate = (el, value) => {
    try { el.focus(); } catch (err) {}
    setInput(el, value);
    for (const type of ['keydown', 'keypress', 'keyup']) {
      el.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    }
    try { el.blur(); } catch (err) {}
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  };

  // 날짜 칸을 누르면 달력이 떠서 "검색" 클릭을 가로챈다. Esc와 빈 곳 클릭으로 닫는다.
  const closePopups = () => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
      document.body.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: 5, clientY: 5 }));
    }
  };

  // 기간검색의 "검색" 버튼. 글자가 딱 "검색"인 것을 먼저 찾고, 없으면 "검색"이 든 버튼을 찾는다
  // (단, "기간검색" 같은 항목 이름은 뺀다).
  const searchButton = () => {
    const label = (el) => String(el.value || el.textContent || '').replace(/\s+/g, '');
    const list = Array.from(document.querySelectorAll('button, a, [role="button"], input[type="submit"], input[type="button"]'))
      .filter((el) => !(panel && panel.contains(el)) && visible(el));
    return (
      list.find((el) => label(el) === '검색') ||
      list.find((el) => /검색/.test(label(el)) && !/기간검색|상세검색|검색조건|검색어/.test(label(el))) ||
      null
    );
  };

  // 기간을 그 날짜로 맞춘다. 어제면 "어제" 버튼을 먼저 눌러 보고, 그래도 안 바뀌면 날짜 칸에 직접 적는다.
  const setDay = async (day, label) => {
    if (dateRangeIs(day)) return true;
    const btn = label ? findByText(label) : null;
    if (btn) {
      clickEl(btn);
      if (await waitFor(() => dateRangeIs(day), 5000)) return true;
    }
    const inputs = dateInputs();
    if (inputs.length >= 2) {
      typeDate(inputs[0], day);
      typeDate(inputs[1], day);
      closePopups();
      if (await waitFor(() => dateRangeIs(day), 3000)) return true;
    }
    return dateRangeIs(day);
  };

  const runReceiveAuto = async (run) => {
    const c = collectors.find((x) => x.id === 'receiveDetail');
    if (!c || !c.match()) return;
    const day = run.day || '';
    await startLog('receive', run);
    logLine(`물류창고입고 수집 시작 · 찾을 날짜 ${day}`);
    // 지난번에 모은 값은 비우고 시작한다(앱은 새 줄만 골라 저장한다).
    if (!run.cleared) {
      await clearBucket(c);
      run.cleared = true;
      await runSet(RECEIVE_KEY, run);
    }

    receiveStatus(`자동 수집 중 · 기간을 ${day}로 맞추는 중`);
    if (!(await waitFor(() => dateInputs().length >= 2, 30000))) {
      return failReceive(run, '기간검색 날짜 칸을 찾지 못했어요. 서허 로그인을 확인해 주세요.');
    }
    if (!(await setDay(day, run.range))) {
      const now = dateInputs().map((el) => el.value).join(' ~ ');
      return failReceive(run, `기간을 ${day}로 못 맞췄어요. 지금 화면은 ${now} 입니다.`);
    }

    closePopups(); // 달력이 떠 있으면 검색 클릭이 달력에 먹힌다
    await sleep(300);
    const searchBtn = searchButton();
    if (!searchBtn) return failReceive(run, '"검색" 버튼을 찾지 못했어요.');
    receiveStatus(`자동 수집 중 · ${day} 입고 내역 검색하는 중`);
    clickEl(searchBtn);

    // 표가 그 날짜 것으로 바뀔 때까지 기다린다. 그날 입고가 없으면 빈 표 그대로다.
    // 한 번에 안 되면 달력을 닫고 날짜를 다시 적은 뒤 진짜 클릭으로 한 번 더 눌러 본다.
    let ok = await waitFor(() => rowsAreDay(day), 12000);
    logLine(`검색 결과 ${ok ? '나옴' : '안 나옴'} · 표 ${receiveItems().length}줄`);
    if (!ok) {
      closePopups();
      await setDay(day, run.range);
      receiveStatus(`자동 수집 중 · ${day} 입고 내역 다시 검색하는 중`);
      const again = searchButton() || searchBtn;
      clickEl(again);
      try { again.click(); } catch (err) {}
      ok = await waitFor(() => rowsAreDay(day), 12000);
    }
    if (!ok) {
      const others = otherDays(day);
      if (others.length) {
        const now = dateInputs().map((el) => el.value).join(' ~ ');
        return failReceive(run, `검색이 ${day}로 바뀌지 않았어요(날짜 칸은 ${now}). 표에 ${others.join(', ')} 줄이 보여요.`);
      }
      // 줄이 아예 없으면 그날 입고가 없는 것으로 본다.
      run.done = true;
      run.pages = 0;
      run.empty = true;
      run.finishedAt = Date.now();
      await runSet(RECEIVE_KEY, run);
      receiveStatus(`✅ ${day} 입고 내역이 없어요`);
      try {
        chrome.runtime.sendMessage({ type: 'HUB_RECEIVE_DONE' });
      } catch (err) {}
      return;
    }

    // 페이지를 끝까지 넘기며 모은다.
    let page = 1;
    while (page < 50) {
      await collectNow();
      const sign = receiveSign();
      const next = pageEl(page + 1);
      if (!next) break;
      page += 1;
      receiveStatus(`자동 수집 중 · ${page}페이지`);
      clickEl(next);
      await waitFor(() => receiveSign() && receiveSign() !== sign, 15000);
      await sleep(500);
      if (!rowsAreDay(day)) return failReceive(run, `${page}페이지에 ${day}가 아닌 줄이 보여요. 다시 눌러 주세요.`);
    }
    await collectNow();
    await queue(() => sleep(200)); // 저장이 다 끝난 뒤 알린다

    run.done = true;
    run.pages = page;
    run.finishedAt = Date.now();
    logLine(`✅ ${page}페이지까지 끝`);
    await saveLogNow();
    await runSet(RECEIVE_KEY, run);
    receiveStatus('✅ 자동 수집 완료 · 앱에 반영했어요');
    try {
      chrome.runtime.sendMessage({ type: 'HUB_RECEIVE_DONE' });
    } catch (err) {}
  };

  // 소식이 있은 뒤(touchedAt) 5분 안이면 이어간다. 페이지가 많아 오래 걸려도 중간에 멈추지 않는다.
  const fresh = (run) =>
    run && !run.done && !run.error && Date.now() - Math.max(run.requestedAt || 0, run.touchedAt || 0) <= AUTO_MAX_AGE_MS;

  // 내 탭 번호. 확장이 연 수집 창에서만 자동 수집을 돌리려고 쓴다.
  let myTabId = null;
  const myTab = () =>
    new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: 'MY_WINDOW' }, (res) => {
          void chrome.runtime.lastError;
          resolve((res && res.tabId) || null);
        });
      } catch (err) {
        resolve(null);
      }
    });
  // 확장이 연 수집 창인지. 사장님이 열어둔 탭에서는 수집을 돌리지 않는다
  // (저장소 변화 알림은 열려 있는 모든 탭에 오기 때문에 이 검사가 꼭 있어야 한다).
  const isCollectWindow = async (run) => {
    if (!run.createdTabId) return true; // 옛 요청(창 번호가 없던 때)은 그대로 진행
    if (myTabId == null) myTabId = await myTab();
    return !myTabId || myTabId === run.createdTabId;
  };

  // 상품 수집은 광고 사이트에서만 돈다. 이 검사가 없으면 서허 탭도 요청을 보고
  // 자기 주소를 광고 화면 주소로 바꿔 버린다(서허에는 그런 화면이 없다).
  let autoRunning = false;
  const startAuto = (run) => {
    if (location.hostname !== 'advertising.coupang.com') return;
    if (run && (run.done || run.error)) foreignRun = null;
    if (!fresh(run) || autoRunning) return;
    autoRunning = true;
    (async () => {
      if (!(await isCollectWindow(run))) {
        foreignRun = run;
        return;
      }
      await runAuto(run);
    })()
      .catch(() => {})
      .then(() => {
        // 다른 주소로 옮기는 중이면 잠긴 채로 둔다. 풀어 두면 저장소 변화 알림이 와서
        // 옮겨지기를 기다리는 동안 이 화면에서 또 시작해 버린다.
        if (autoNavigating) return;
        autoRunning = false;
        autoStep = null;
      });
  };
  autoGet().then(startAuto);

  // 이 화면이 이미 열려 있으면 새로고침이 없을 수도 있어, 요청이 저장되는 것도 지켜본다.
  let receiveRunning = false;
  const startReceive = (run) => {
    if (!fresh(run) || receiveRunning) return;
    receiveRunning = true;
    (async () => {
      if (!(await isCollectWindow(run))) {
        foreignRun = run;
        return;
      }
      await runReceiveAuto(run);
    })()
      .catch(() => {})
      .then(() => { receiveRunning = false; });
  };
  runGet(RECEIVE_KEY).then(startReceive);
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes[RECEIVE_KEY]) {
        const r = changes[RECEIVE_KEY].newValue;
        if (r && (r.done || r.error)) foreignRun = null;
        startReceive(r);
      }
      // 광고 화면이 이미 열려 있어 새로고침이 없을 때도 시작되도록 요청 저장을 지켜본다.
      if (changes[AUTO_KEY]) startAuto(changes[AUTO_KEY].newValue);
    });
  } catch (err) {}

  // 데이터 확인용: 모은 항목 + 페이지가 받은 JSON 응답을 파일로 저장.
  const downloadRaw = async () => {
    const c = activeCollector();
    const data = await storageGet();
    const blob = new Blob(
      [JSON.stringify({
        page: location.href,
        savedAt: new Date().toISOString(),
        collected: c ? data[c.id] : null,
        sampleCards: window.__rocketHubSampleCards ? window.__rocketHubSampleCards() : [],
        // 확인용: 화면의 표 구조(앞부분). 수집이 안 될 때 어디에 값이 있는지 보려고 담습니다.
        sampleTables: Array.from(document.querySelectorAll('table')).slice(0, 6).map((t) => t.outerHTML.slice(0, 15000)),
        frames: document.querySelectorAll('iframe').length,
        responses: raw,
      }, null, 2)],
      { type: 'application/json' }
    );
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `로켓서허_원본_${c ? c.id : 'page'}_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  const render = async (dataArg) => {
    const c = activeCollector();
    if (!c) {
      if (panel) panel.style.display = 'none';
      return;
    }
    if (!panel) {
      panel = document.createElement('div');
      panel.style.cssText =
        'position:fixed;right:16px;bottom:16px;z-index:2147483647;width:260px;background:#fff;border:1px solid #d0d7e2;' +
        'border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.15);font:13px/1.45 -apple-system,sans-serif;color:#1f2937;';
      panel.addEventListener('click', (e) => {
        const act = e.target && e.target.getAttribute && e.target.getAttribute('data-act');
        if (act === 'toggle') {
          collapsed = !collapsed;
          render();
        } else if (act === 'collect') collectNow();
        else if (act === 'reset') resetCollector();
        else if (act === 'raw') downloadRaw();
      });
      document.body.appendChild(panel);
    }
    panel.style.display = '';
    const data = dataArg || (await storageGet());
    const bucket = data[c.id];
    const total = bucket ? Object.keys(bucket.items).length : 0;
    const updated = bucket && bucket.updatedAt ? new Date(bucket.updatedAt).toLocaleTimeString() : '-';
    const btn = 'border:1px solid #d0d7e2;background:#f8fafc;border-radius:6px;padding:4px 8px;cursor:pointer;font-size:12px;';
    panel.innerHTML = collapsed
      ? `<div data-act="toggle" style="padding:8px 12px;cursor:pointer;font-weight:600">🚀 ${c.label} ${total}개</div>`
      : `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-bottom:1px solid #eef1f5">
           <b>🚀 ${c.label}</b><span data-act="toggle" style="cursor:pointer;color:#94a3b8">접기</span>
         </div>
         <div style="padding:10px 12px">
           <div style="font-size:22px;font-weight:700">${total}<span style="font-size:13px;font-weight:400"> 개 모음</span></div>
           <div style="color:#64748b;font-size:12px">이 화면 ${lastPageCount}개 · 마지막 ${updated}</div>
           ${autoStatus ? `<div style="margin-top:6px;padding:6px 8px;background:#eff6ff;color:#1d4ed8;border-radius:6px;font-size:12px">${autoStatus}</div>` : ''}
           <div style="color:#64748b;font-size:12px;margin:6px 0 8px">${c.hint}</div>
           <div style="display:flex;gap:6px;flex-wrap:wrap">
             <button data-act="collect" style="${btn}">지금 모으기</button>
             <button data-act="reset" style="${btn}">비우고 다시</button>
             <button data-act="raw" style="${btn}" title="확인용: 페이지가 받은 원본 데이터 ${raw.length}개">원본 저장</button>
           </div>
           ${c.id === 'adsStock' ? '<div style="color:#94a3b8;font-size:11px;margin-top:8px">앱의 재고 › 상품관리에서 "확장에서 가져오기"를 누르면 이 화면을 알아서 넘기며 모아 갑니다.</div>' : ''}
           ${c.id === 'receiveDetail' ? '<div style="color:#94a3b8;font-size:11px;margin-top:8px">앱의 물류 › 물류창고입고에서 날짜를 고르고 "자동으로 가져오기"를 누르면 그 날짜로 검색해 알아서 모아 갑니다.</div>' : ''}
         </div>`;
  };

  // 화면 구조 저장(Alt+D). 새 화면(예: 서허 쉽먼트 일괄등록)을 자동화하려면 그 화면이 어떻게 생겼는지 알아야 해서,
  // 지금 보이는 화면의 요소들을 파일로 내려받는다. 개인정보가 아니라 화면 구조(버튼·칸 이름·위치)만 담는다.
  const dumpScreen = () => {
    const clean = (t) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
    };
    const wanted = 'button, a, input, select, textarea, label, th, span, div[role="button"], li';
    const elements = Array.from(document.querySelectorAll(wanted))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && !(panel && panel.contains(el));
      })
      .slice(0, 1200)
      .map((el) => ({
        tag: el.tagName,
        text: clean(el.textContent),
        value: clean(el.value),
        type: el.getAttribute('type') || '',
        id: el.id || '',
        name: el.getAttribute('name') || '',
        cls: String(el.className || '').slice(0, 60),
        box: box(el),
      }));
    const dump = {
      url: location.href.split('?')[0],
      title: document.title,
      iframes: Array.from(document.querySelectorAll('iframe')).map((f) => f.src || '(같은 창)'),
      elements,
    };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' }));
    a.download = `서허_화면구조_${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  };
  window.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 'd' || e.key === 'D' || e.code === 'KeyD')) {
      e.preventDefault();
      dumpScreen();
    }
  });

  // 페이지 넘김·탭 전환·검색 결과가 그려질 때, 늦게 불러온 사진이 들어올 때마다 다시 모읍니다
  // (패널 자신의 변화는 무시).
  new MutationObserver((mutations) => {
    if (mutations.every((m) => panel && panel.contains(m.target))) return;
    schedule();
  }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['src', 'srcset'] });

  schedule();
})();
