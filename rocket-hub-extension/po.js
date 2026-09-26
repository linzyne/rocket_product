// 발주서 수집: 서허 "발주리스트"에서 새 발주서만 골라 업로드 양식을 받아옵니다.
// 앱의 발주 > 쿠팡발주확인에서 "서허에서 새 발주서 가져오기"를 누르면 background.js가 이 화면을
// 새 창으로 열고, 여기서
//   검색 → 화면이 서버에서 받은 목록(JSON)에서 발주번호를 읽기 → 기준번호 위쪽 번호만 추리기
//   → "발주서번호" 칸에 그 번호들을 넣고 다시 검색 → 전체 선택 → "발주서업로드양식" 누르기
// 를 차례로 합니다. 내려받은 파일은 background.js가 앱에 넘깁니다.
//
// 표를 눈으로 긁지 않고 JSON을 읽는 까닭: 목록 표는 화면에 보이는 줄만 만들어 두기 때문에
// 스크롤해도 아랫줄을 놓치고, 체크박스도 엉뚱한 줄에 들어갑니다. 받을 번호로 다시 검색해서
// 목록에 그것만 남긴 뒤 전체 선택을 누르면 고르는 것도 확실해집니다.
// JSON은 hook.js가 페이지와 같은 세계에서 복사해 보내줍니다(막지 않고 보기만 합니다).
// 새 발주서가 없으면 step을 'empty'로 적어 앱이 알려주게 합니다.
// 로그인은 사람이 직접 합니다(확장은 서허 비밀번호를 다루지 않습니다).
(() => {
  if (window.__rocketPoInjected) return;
  window.__rocketPoInjected = true;
  if (!/^\/po-web\/purchase\/order\/list/.test(location.pathname)) return;

  const KEY = 'poPending';
  const MAX_AGE_MS = 10 * 60 * 1000;
  const DONE_STEPS = ['downloading', 'file', 'empty', 'error'];

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const visible = (el) => !!(el && el.offsetParent !== null && el.getClientRects().length);

  const get = () =>
    new Promise((resolve) => {
      try {
        chrome.storage.local.get(KEY, (r) => resolve((r && r[KEY]) || null));
      } catch (err) {
        resolve(null);
      }
    });
  const patch = async (fields) => {
    const now = await get();
    if (!now) return;
    try {
      await chrome.storage.local.set({ [KEY]: { ...now, ...fields } });
    } catch (err) {}
  };

  // 확장이 연 창에서만 움직인다(따로 열어둔 서허 창은 건드리지 않음).
  let myWindowId = null;
  try {
    chrome.runtime.sendMessage({ type: 'MY_WINDOW' }, (res) => {
      if (chrome.runtime.lastError) return;
      myWindowId = (res && res.windowId) || null;
    });
  } catch (err) {}

  // 화면(React)이 알아채도록 진짜 클릭처럼 눌러준다.
  const clickEl = (el) => {
    if (!el) return false;
    const target = el.closest('button, a, li, label, [role="button"]') || el;
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
      target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
    return true;
  };

  const waitFor = async (fn, ms) => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      try {
        if (fn()) return true;
      } catch (err) {}
      await sleep(300);
    }
    return false;
  };

  const byText = (re) =>
    Array.from(document.querySelectorAll('button, a, [role="button"], input[type="submit"], input[type="button"]'))
      .filter((el) => visible(el) && re.test(clean(el.value || el.textContent).replace(/\s+/g, '')))
      .shift() || null;

  // 기간검색의 "검색" 버튼("기간검색" 같은 항목 이름은 뺀다).
  const searchButton = () => {
    const label = (el) => clean(el.value || el.textContent).replace(/\s+/g, '');
    const list = Array.from(document.querySelectorAll('button, a, [role="button"], input[type="submit"], input[type="button"]')).filter(visible);
    return (
      list.find((el) => label(el) === '검색') ||
      list.find((el) => /검색/.test(label(el)) && !/기간검색|상세검색|검색조건|검색어/.test(label(el))) ||
      null
    );
  };

  // ---- 화면이 서버에서 받은 목록(JSON)에서 발주번호 읽기 ----
  // hook.js가 페이지의 모든 JSON 응답을 복사해 보내준다. 그중 발주 목록으로 보이는 것만 쓴다.
  const HOOK_SOURCE = 'rocket-hub-hook';
  const seenJson = [];
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const d = event.data;
    if (!d || d.source !== HOOK_SOURCE || d.type !== 'JSON') return;
    seenJson.push({ url: String(d.url || ''), text: String(d.text || ''), at: d.at || Date.now() });
    if (seenJson.length > 40) seenJson.shift();
  });

  // 발주번호로 쓸 값: 8~12자리 숫자. 키 이름에 po/order/purchase가 들어간 것을 먼저 믿는다.
  const NO_RE = /^\d{8,12}$/;
  const NO_KEY_RE = /(^|[^a-z])(po|purchase|order)([^a-z]|$)|ponumber|pono|orderno|ordernumber|orderid|poid/i;
  const numLike = (v) => (typeof v === 'number' || typeof v === 'string') && NO_RE.test(String(v));

  // 목록처럼 생긴 배열(같은 모양의 객체가 여러 개)을 JSON 안에서 찾는다.
  const findRowArrays = (root) => {
    const out = [];
    const walk = (node, depth) => {
      if (!node || typeof node !== 'object' || depth > 6) return;
      if (Array.isArray(node)) {
        const objs = node.filter((x) => x && typeof x === 'object' && !Array.isArray(x));
        if (objs.length >= 1 && objs.length === node.length) out.push(objs);
        node.forEach((x) => walk(x, depth + 1));
        return;
      }
      Object.keys(node).forEach((k) => walk(node[k], depth + 1));
    };
    walk(root, 0);
    return out;
  };

  // 한 줄 배열에서 발주번호 열을 고른다(줄마다 값이 있고, 서로 다른 값이 가장 많은 열).
  const orderNosOf = (list) => {
    const keys = new Map();
    for (const row of list) {
      for (const k of Object.keys(row)) {
        if (!numLike(row[k])) continue;
        const e = keys.get(k) || { hits: 0, values: new Set() };
        e.hits += 1;
        e.values.add(String(row[k]));
        keys.set(k, e);
      }
    }
    let best = null;
    for (const [k, e] of keys) {
      if (e.hits < list.length) continue; // 줄마다 있어야 발주번호다
      const score = (NO_KEY_RE.test(k) ? 1000 : 0) + e.values.size;
      if (!best || score > best.score) best = { key: k, score };
    }
    if (!best) return [];
    return list.map((r) => String(r[best.key]));
  };

  // 가장 최근에 받은 목록 JSON에서 발주번호를 순서대로 뽑는다(화면에 보이는 차례와 같다).
  const listFromJson = (since) => {
    for (let i = seenJson.length - 1; i >= 0; i--) {
      const j = seenJson[i];
      if (j.at < since) continue;
      let root;
      try {
        root = JSON.parse(j.text);
      } catch (err) {
        continue;
      }
      let bestNos = [];
      for (const list of findRowArrays(root)) {
        const nos = orderNosOf(list).filter(Boolean);
        if (nos.length > bestNos.length) bestNos = nos;
      }
      if (bestNos.length) return bestNos;
    }
    return [];
  };

  // "발주서번호" 입력칸(여러 개를 쉼표로 넣는 칸).
  const orderNoInput = () =>
    Array.from(document.querySelectorAll('input, textarea')).find(
      (el) => visible(el) && /발주(서)?번호/.test(String(el.placeholder || '')) && /구분/.test(String(el.placeholder || ''))
    ) || null;

  // React가 쓰는 입력칸은 value를 그냥 바꾸면 모르기 때문에, 원래 setter로 바꾸고 이벤트를 보낸다.
  const setInput = (el, value) => {
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    try {
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    } catch (err) {
      el.value = value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  // 표 머리의 전체 선택 체크박스.
  const selectAllBox = () => {
    for (const tr of Array.from(document.querySelectorAll('thead tr'))) {
      const box = tr.querySelector('input[type="checkbox"]');
      if (box && visible(box)) return box;
    }
    return Array.from(document.querySelectorAll('table input[type="checkbox"]')).find(visible) || null;
  };

  const fail = async (message) => {

    await patch({ step: 'error', status: message });
    try { chrome.runtime.sendMessage({ type: 'PO_DONE' }); } catch (err) {}
  };

  const run = async (pending) => {
    await patch({ step: 'page', status: '발주서 목록 여는 중…' });

    // 화면이 뜨기를 기다렸다가, 기본 조회 조건 그대로 한 번 검색한다.
    if (!(await waitFor(() => searchButton(), 30000))) return fail('서허 발주서 목록을 열지 못했어요. 로그인돼 있는지 확인해 주세요.');
    await sleep(1000);
    await patch({ status: '발주서 검색하는 중…' });
    const askedAt = Date.now();
    clickEl(searchButton());

    // 화면이 서버에서 받은 목록에서 발주번호를 읽는다(표를 눈으로 긁지 않는다).
    if (!(await waitFor(() => listFromJson(askedAt).length > 0, 40000))) {
      return fail('발주서 목록을 읽지 못했어요. 서허 로그인과 검색 조건을 확인해 주세요.');
    }
    await sleep(1500);
    const all = listFromJson(askedAt);
    const last = String(pending.lastOrderNo || '');
    const hit = last ? all.indexOf(last) : -1;

    if (last && hit < 0) {
      return fail(
        `기준 발주번호 ${last}를 목록에서 찾지 못했어요(${all.length}건 확인` +
        `${all.length ? `, 맨 위 ${all[0]} ~ 맨 아래 ${all[all.length - 1]}` : ''}). ` +
        '번호가 맞는지 확인하시거나, 기간검색을 넓혀 주세요.'
      );
    }
    // 목록은 새 발주서가 맨 위에 온다. 기준번호 위쪽이 이번에 받을 것이다.
    const fresh = hit >= 0 ? all.slice(0, hit) : all;
    if (!fresh.length) {
      await patch({ step: 'empty', status: '새 발주서가 없어요.' });
      try { chrome.runtime.sendMessage({ type: 'PO_DONE' }); } catch (err) {}
      return;
    }

    // 받을 번호만 목록에 남기고 전체 선택을 누른다(줄마다 체크하면 엉뚱한 줄이 잡힌다).
    const input = orderNoInput();
    if (!input) return fail('"발주서번호" 검색칸을 찾지 못했어요.');
    await patch({ status: `새 발주서 ${fresh.length}건으로 다시 검색하는 중…` });
    window.scrollTo(0, 0);
    setInput(input, fresh.join(','));
    await sleep(500);
    const againAt = Date.now();
    clickEl(searchButton());
    if (!(await waitFor(() => listFromJson(againAt).length > 0, 40000))) {
      return fail('고른 발주서로 다시 검색하지 못했어요.');
    }
    await sleep(1500);
    const shown = listFromJson(againAt);
    const missing = fresh.filter((no) => !shown.includes(no));

    // 기준번호는 실제로 받은 것 중 맨 위로 남긴다(다시 검색해도 안 나온 건 뺀다).
    const topNo = fresh.find((no) => shown.includes(no)) || fresh[0];

    const box = selectAllBox();
    if (!box) return fail('목록의 전체 선택 칸을 찾지 못했어요.');
    if (!box.checked) clickEl(box);
    await sleep(800);
    if (!box.checked) return fail('발주서를 고르지 못했어요(전체 선택이 눌리지 않았어요).');

    const btn = byText(/^발주서업로드양식/);
    if (!btn) return fail(`"발주서업로드양식" 버튼을 찾지 못했어요(발주서 ${fresh.length}건은 골라 뒀어요).`);

    // 파일을 다 받았는지는 background.js가 본다(poPending.file).
    await patch({
      step: 'downloading',
      status: `발주서 ${shown.length}건 양식 받는 중…${missing.length ? ` (${missing.length}건은 다시 검색해도 안 나와 빠졌어요)` : ''}`,
      count: shown.length,
      topOrderNo: topNo,
    });
    clickEl(btn);
  };

  (async () => {
    const pending = await get();
    if (!pending) return;
    if (Date.now() - (pending.savedAt || 0) > MAX_AGE_MS) return;
    if (DONE_STEPS.includes(pending.step)) return;
    if (pending.windowId && myWindowId && pending.windowId !== myWindowId) return;
    // 창 번호를 아직 못 받았으면 잠깐 기다린다.
    if (pending.windowId && !myWindowId) {
      await sleep(500);
      if (myWindowId && pending.windowId !== myWindowId) return;
    }
    try {
      await run(pending);
    } catch (err) {
      await fail(String((err && err.message) || err));
    }
  })();
})();
