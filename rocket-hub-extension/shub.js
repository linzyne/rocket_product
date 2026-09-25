// 서허(서플라이어허브)에서 쉽먼트 일괄등록 양식을 받아오는 B단계.
// 앱에서 "서허 양식 받기"를 누르면 background.js가 이 사이트를 새 창으로 열고, 여기서
//   물류 › 쉽먼트 › 쉽먼트 일괄등록 › 양식 다운로드
// 를 차례로 눌러 줍니다. 내려받은 파일은 background.js가 같은 주소로 한 번 더 받아 앱에 넘깁니다.
// 로그인은 사람이 직접 합니다(확장은 서허 비밀번호를 다루지 않습니다).
(() => {
  if (window.__rocketShubInjected) return;
  window.__rocketShubInjected = true;

  const KEY = 'shubPending';
  const IS_TOP = window === window.top;
  const MAX_AGE_MS = 10 * 60 * 1000;
  const DONE_STEPS = ['file', 'error', 'manual'];

  const TEXT = {
    logistics: /^물류$/,
    shipment: /^쉽먼트$/,
    batchPage: /^쉽먼트\s*일괄\s*등록$/,
    // 화면의 "일괄등록 양식 다운로드"를 누르면 발주건 목록 팝업이 뜬다.
    openPopup: /일괄\s*등록\s*양식\s*다운(로드)?/,
    // 팝업 아래쪽의 실제 받기 버튼.
    formDownload: /^양식\s*다운(로드)?$/,
    pick: /^선택$/,
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
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

  // 확장이 연 창에서만 움직인다(사장님이 따로 열어둔 서허 창은 건드리지 않음).
  let myWindowId = null;
  try {
    chrome.runtime.sendMessage({ type: 'MY_WINDOW' }, (res) => {
      if (chrome.runtime.lastError) return;
      myWindowId = (res && res.windowId) || null;
    });
  } catch (err) {}

  // 멈춤: 진행 기록을 지우면 모든 창에서 즉시 멈춘다.
  const stopAll = () => {
    try {
      chrome.storage.local.remove(KEY);
    } catch (err) {}
    if (panel) panel.style.display = 'none';
  };

  let panel = null;
  const visible = (el) => {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const st = getComputedStyle(el);
    return st.visibility !== 'hidden' && st.display !== 'none';
  };
  // 글자가 딱 맞는 가장 안쪽 요소들(패널 자신은 뺀다).
  const findAll = (re) =>
    Array.from(document.querySelectorAll('body *')).filter((el) => {
      if (panel && panel.contains(el)) return false;
      if (!re.test(clean(el.textContent))) return false;
      return !Array.from(el.children).some((c) => re.test(clean(c.textContent))) && visible(el);
    });
  const find = (re) => findAll(re)[0] || null;
  const realClick = (el) => {
    const target = el.closest('a,button,label,li,[role="button"],[onclick]') || el;
    const opts = { bubbles: true, cancelable: true, view: window };
    ['pointerover', 'mouseover', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((type) => {
      const Ev = type.startsWith('pointer') && window.PointerEvent ? PointerEvent : MouseEvent;
      target.dispatchEvent(new Ev(type, opts));
    });
  };

  // 진행 상황 패널(오른쪽 아래).
  const render = (p) => {
    if (!IS_TOP) return;
    if (p && p.windowId && myWindowId && p.windowId !== myWindowId) {
      if (panel) panel.style.display = 'none';
      return;
    }
    if (!p || Date.now() - (p.savedAt || 0) > MAX_AGE_MS) {
      if (panel) panel.style.display = 'none';
      return;
    }
    if (!panel) {
      panel = document.createElement('div');
      panel.style.cssText =
        'position:fixed;right:16px;bottom:16px;z-index:2147483647;background:#fff;border:1px solid #e3e8ef;' +
        'border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.12);font:13px -apple-system,BlinkMacSystemFont,"Malgun Gothic",sans-serif;' +
        'color:#111;min-width:260px;max-width:340px;padding:10px 12px';
      document.body.appendChild(panel);
    }
    panel.style.display = '';
    const color = p.step === 'error' ? '#dc2626' : p.step === 'file' ? '#059669' : '#1d4ed8';
    panel.innerHTML =
      `<div style="font-weight:700;margin-bottom:4px">📄 쉽먼트 양식 받기</div>` +
      `<div style="color:#64748b;font-size:12px">${p.batchId || ''}</div>` +
      `<div style="margin-top:6px;color:${color}">${p.status || ''}</div>` +
      `<div style="margin-top:8px;text-align:right"><button data-act="stop" style="border:1px solid #fecaca;background:#fff1f2;color:#b91c1c;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:12px">멈춤</button></div>`;
    panel.onclick = (e) => {
      const t = e.target;
      if (t && t.getAttribute && t.getAttribute('data-act') === 'stop') stopAll();
    };
  };

  // 팝업 목록에서 이 쉽먼트의 발주번호가 들어 있는 줄을 찾아 "선택"(또는 체크칸)을 누른다.
  const pickOrders = (orderNos) => {
    const done = [];
    for (const no of orderNos) {
      const cell = Array.from(document.querySelectorAll('td, th, span, div, li, a'))
        .filter((el) => visible(el) && el.children.length === 0 && clean(el.textContent) === String(no))
        .pop();
      if (!cell) continue;
      const row = cell.closest('tr, li, [role="row"]') || cell.parentElement;
      if (!row) continue;
      const box = row.querySelector('input[type="checkbox"]');
      if (box && !box.checked) {
        realClick(box);
        done.push(no);
        continue;
      }
      if (box && box.checked) {
        done.push(no);
        continue;
      }
      const btn = Array.from(row.querySelectorAll('button, a, span')).find((el) => TEXT.pick.test(clean(el.textContent)));
      if (btn) {
        realClick(btn);
        done.push(no);
      }
    }
    return done;
  };

  // 이 발주번호 줄의 체크가 켜져 있는지 본다(쪽을 넘겨도 선택이 남는지 확인할 때 쓴다).
  const isPicked = (no) => {
    const cell = Array.from(document.querySelectorAll('td, th, span, div, li, a'))
      .filter((el) => visible(el) && el.children.length === 0 && clean(el.textContent) === String(no))
      .pop();
    const row = cell && (cell.closest('tr, li, [role="row"]') || cell.parentElement);
    const box = row && row.querySelector('input[type="checkbox"]');
    return !!(box && box.checked);
  };

  // 쪽 번호 줄(1 2 3 4 …)을 찾는다. 표 안에도 "1", "2" 같은 숫자 칸이 있어서 글자만 보고 고르면
  // 엉뚱한 표 칸을 누르게 된다(그러다 줄이 눌려 체크가 풀리기도 한다). 그래서
  //   · 작은 칸이고(가로 60px 아래)
  //   · 같은 높이에 숫자들이 나란히 있고
  //   · 화면 아래쪽에 있는
  // 무리만 쪽 번호로 본다.
  const pagerMap = () => {
    const nums = Array.from(document.querySelectorAll('button, a, li, span, div'))
      .filter((el) => visible(el) && el.children.length === 0 && /^\d{1,2}$/.test(clean(el.textContent)))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.width < 60 && r.height > 0 && r.height < 60;
      });

    // 같은 줄(높이 차 12px 안)끼리 묶는다.
    const lines = [];
    for (const el of nums) {
      const y = el.getBoundingClientRect().top;
      const line = lines.find((l) => Math.abs(l.y - y) < 12);
      if (line) line.items.push(el);
      else lines.push({ y, items: [el] });
    }

    // 1, 2가 나란히 있는 줄 중 가장 아래쪽 줄이 쪽 번호 줄이다.
    const pagers = lines.filter((l) => {
      const texts = new Set(l.items.map((el) => clean(el.textContent)));
      return texts.has('1') && texts.has('2') && l.items.length >= 2;
    });
    const pager = pagers.sort((a, b) => b.y - a.y)[0];
    const map = new Map();
    if (pager) {
      for (const el of pager.items.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)) {
        const n = Number(clean(el.textContent));
        if (!map.has(n)) map.set(n, el);
      }
    }
    return map;
  };

  const pageButton = (n) => pagerMap().get(n) || null;

  const lastPageNo = () => {
    let max = 1;
    pagerMap().forEach((_, n) => { if (n > max) max = n; });
    return max;
  };

  // 팝업 위쪽 필터로 목록을 좁힌다: FC(물류센터)와 입고예정일을 넣고 검색을 누른다.
  // 쪽을 넘겨 가며 고르는 것보다 훨씬 안전하다. 센터가 섞인 쉽먼트면 FC는 건너뛰고 날짜만 좁힌다.
  const applyFilters = async (center, edd) => {
    let used = [];

    if (center) {
      for (const sel of document.querySelectorAll('select')) {
        if (!visible(sel)) continue;
        const opt = Array.from(sel.options).find((o) => clean(o.textContent).includes(center));
        if (!opt) continue;
        sel.value = opt.value;
        sel.dispatchEvent(new Event('input', { bubbles: true }));
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        used.push('FC');
        break;
      }
    }

    if (edd) {
      const input = Array.from(document.querySelectorAll('input')).find((i) => {
        if (!visible(i)) return false;
        const hint = `${i.placeholder || ''} ${i.getAttribute('aria-label') || ''} ${i.name || ''}`;
        return /edd/i.test(hint) || /입고/.test(hint);
      });
      if (input) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, edd);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        input.dispatchEvent(new Event('blur', { bubbles: true }));
        used.push('EDD');
      }
    }

    if (!used.length) return '';
    await sleep(400);
    const search = findAll(/^검색$/).filter((el) => !el.closest('table')).pop();
    if (search) realClick(search.closest('button') || search);
    await sleep(1500);
    return used.join('+');
  };

  // FC(물류센터) 필터를 "전체"로 되돌리고 다시 검색한다. 한 쉽먼트에 센터가 섞여 있으면
  // FC로 거른 목록에는 다른 센터 발주건이 안 보이기 때문이다.
  const clearCenterFilter = async () => {
    let done = false;
    for (const sel of document.querySelectorAll('select')) {
      if (!visible(sel) || !sel.options.length) continue;
      const all = Array.from(sel.options).find((o) => /전체|all/i.test(clean(o.textContent)));
      if (!all) continue;
      sel.value = all.value;
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      done = true;
      break;
    }
    if (!done) return false;
    await sleep(400);
    const search = findAll(/^검색$/).filter((el) => !el.closest('table')).pop();
    if (search) realClick(search.closest('button') || search);
    await sleep(1500);
    return true;
  };

  // 지금 목록에 보이는 발주번호들. 쪽이 실제로 넘어갔는지 이걸로 확인한다.
  const shownOrderNos = () =>
    Array.from(document.querySelectorAll('td, th, span, div, li, a'))
      .filter((el) => visible(el) && el.children.length === 0 && /^\d{8,}$/.test(clean(el.textContent)))
      .map((el) => clean(el.textContent))
      .join(',');

  // n쪽으로 넘긴다. 숫자 글자만 눌러서는 안 먹는 화면이 있어 감싸고 있는 버튼/링크까지 눌러 보고,
  // 목록에 보이는 발주번호가 바뀌는지로 넘어갔는지 확인한다.
  const goToPage = async (n) => {
    const before = shownOrderNos();
    const btn = pageButton(n);
    if (!btn) return false;
    // 표의 줄(tr/td)은 절대 누르지 않는다(줄을 누르면 체크가 풀리는 화면이 있다).
    const targets = [btn, btn.closest('a'), btn.closest('button'), btn.closest('[role="button"]'), btn.closest('li')]
      .filter((el, i, arr) => el && arr.indexOf(el) === i && !el.closest('table'));
    for (const t of targets) {
      realClick(t);
      for (let i = 0; i < 6; i++) {
        await sleep(300);
        if (shownOrderNos() !== before) return true;
      }
    }
    return false;
  };

  // 팝업 목록이 여러 쪽이면 쪽을 넘겨 가며 우리 발주건을 모두 고른다.
  const pickOrdersAcrossPages = async (orderNos) => {
    const picked = new Set(pickOrders(orderNos));
    const last = lastPageNo();
    const onPage1 = picked.size;
    if (picked.size >= orderNos.length) return { picked: Array.from(picked), last, onPage1 };
    if (last <= 1) return { picked: Array.from(picked), last, onPage1 };

    for (let n = 2; n <= last && picked.size < orderNos.length; n++) {
      if (!(await goToPage(n))) return { stuck: n, picked: Array.from(picked), last, onPage1 };
      await sleep(500);
      pickOrders(orderNos.filter((no) => !picked.has(no))).forEach((no) => picked.add(no));
    }

    // 1쪽으로 돌아가서, 쪽을 넘기는 사이에 앞서 고른 게 풀리지 않았는지 본다.
    const first = Array.from(picked)[0];
    if (!(await goToPage(1))) return { stuck: 1, picked: Array.from(picked), last, onPage1 };
    await sleep(500);
    let stillOn = false;
    for (let i = 0; i < 10 && !stillOn; i++) {
      stillOn = isPicked(first);
      if (!stillOn) await sleep(400);
    }
    if (!stillOn) return { lost: true, picked: Array.from(picked), last, onPage1 };
    return { picked: Array.from(picked), last, onPage1 };
  };

  // MAIN world 쪽에서 가로챈 양식 파일을 받아 저장한다(확장이 다시 받으면 서버가 거절해서 이 길을 쓴다).
  window.addEventListener('message', async (event) => {
    const d = event.data;
    if (event.source !== window || !d || d.source !== 'rocket-shub-hook') return;
    const p = await get();
    if (!p || p.file) return;
    if (p.windowId && myWindowId && p.windowId !== myWindowId) return;

    if (d.type === 'FILE') {
      await patch({ step: 'file', status: `✅ 양식을 받았어요 (${d.name})`, file: { name: d.name, dataUrl: d.dataUrl } });
      return;
    }
    // 폼 전송으로 내려오는 양식: 같은 요청을 한 번 더 보내 내용을 받는다.
    if (d.type === 'FORM') {
      try {
        const body = new URLSearchParams();
        (d.fields || []).forEach(([k, v]) => body.append(k, v));
        const res = await fetch(d.action, {
          method: d.method === 'GET' ? 'GET' : 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: d.method === 'GET' ? undefined : body,
        });
        if (!res.ok) return;
        const type = res.headers.get('content-type') || '';
        if (!/sheet|excel|octet-stream/i.test(type)) return;
        const buf = await res.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        await patch({
          step: 'file',
          status: '✅ 양식을 받았어요 (폼 다시 보내기)',
          file: { name: '쉽먼트양식.xlsx', dataUrl: `data:${mime};base64,${btoa(bin)}` },
        });
      } catch (err) {}
    }
  });

  let busy = false;
  let lastClick = 0;
  // 발주건 고르기는 한 번에 하나만. 검사 주기마다 다시 시작해서 쪽을 왔다 갔다 하지 않게 한다.
  let picking = false;
  let pickTries = 0;

  const tick = async () => {
    if (busy) return;
    const p = await get();
    if (IS_TOP) render(p);
    if (!p || DONE_STEPS.includes(p.step) || p.file) return;
    if (Date.now() - (p.savedAt || 0) > MAX_AGE_MS) return;
    // 확장이 연 창이 아니면 구경만 한다(다른 서허 창에서 제멋대로 누르지 않게).
    if (p.windowId && myWindowId && p.windowId !== myWindowId) return;

    busy = true;
    try {
      // 로그인 화면이면 사람이 로그인할 때까지 기다린다.
      if (document.querySelector('input[type="password"]') && !find(TEXT.logistics)) {
        await patch({ status: '서허에 로그인해 주세요. 로그인하면 이어서 진행합니다.' });
        return;
      }

      // 팝업이 떠 있으면(아래쪽에 "양식다운로드" 버튼이 보임) 우리 발주건을 고르고 받는다.
      const dl = find(TEXT.formDownload);
      if (dl) {
        const orderNos = Array.isArray(p.orderNos) ? p.orderNos : [];

        // 1) 먼저 FC(물류센터)로 목록을 좁힌다. 한 번만 한다.
        if (!p.filtered) {
          const used = await applyFilters(p.center || '', p.edd || '');
          await patch({
            filtered: true,
            filterOk: used,
            step: 'popup',
            status: used ? `[v4] 필터(${used})로 목록을 좁혔어요. 발주건 고르는 중…` : '[v4] 필터를 못 써서 목록을 그대로 훑어요…',
          });
          return;
        }

        // 이 쉽먼트의 발주건을 "전부" 고른 다음에만 양식을 받는다. 일부만 골라 받으면 양식에 그
        // 건들만 들어와서, 나중에 송장번호를 채울 줄이 통째로 빠져 버린다.
        if (!p.picked || p.picked < orderNos.length) {
          if (picking) return; // 이미 고르는 중이면 이 차례는 건너뛴다.
          if (pickTries >= 2) {
            await patch({
              step: 'manual',
              status: `[v4] 발주건을 다 고르지 못했어요(${p.pickInfo || '정보 없음'}). 목록에서 직접 모두 고른 뒤 양식다운로드를 눌러 주세요.`,
            });
            return;
          }
          picking = true;
          pickTries += 1;
          let res;
          try {
            res = await pickOrdersAcrossPages(orderNos);
          } finally {
            picking = false;
          }
          // 쪽을 넘기면 선택이 풀리는 화면이면 자동으로 할 수 없다. 사람에게 넘긴다.
          if (res && res.stuck) {
            await patch({
              step: 'manual',
              status: `[v4] 목록 ${res.stuck}쪽으로 넘기지 못했어요(${res.picked.length}건까지 골랐어요). 나머지를 직접 고른 뒤 양식다운로드를 눌러 주세요.`,
            });
            return;
          }
          if (res && res.lost) {
            await patch({
              step: 'manual',
              status: '[v4] 목록 쪽을 넘기면 앞에서 고른 발주건이 풀려요. FC(물류센터)나 입고예정일 필터로 한 쪽에 다 보이게 좁힌 뒤, 직접 모두 고르고 양식다운로드를 눌러 주세요.',
            });
            return;
          }
          const got = (res && res.picked) || [];
          const missing = orderNos.filter((no) => !got.includes(no));
          const info = `필터 ${p.filterOk || '없음'} · 쪽수 ${res.last || 1} · 1쪽에서 ${res.onPage1 || 0}건 · 모두 ${got.length}/${orderNos.length}건 · 못 찾음 ${missing.slice(0, 4).join(',')}`;
          await patch({ pickInfo: info });
          if (missing.length) {
            // 센터가 섞인 쉽먼트면 FC 필터 때문에 다른 센터 건이 목록에 없다. 필터를 풀고 한 번 더 훑는다.
            if (!p.wideRetry && String(p.filterOk || '').includes('FC')) {
              const cleared = await clearCenterFilter();
              pickTries = 0;
              await patch({
                wideRetry: true,
                picked: 0,
                step: 'popup',
                status: cleared ? '[v4] FC 필터를 풀고 다시 찾는 중…' : '[v4] FC 필터를 풀지 못했어요. 목록을 그대로 훑어요…',
              });
              return;
            }
            if (Date.now() - (p.savedAt || 0) > 40000) {
              await patch({
                step: 'manual',
                status: `[v4] 팝업에서 발주번호 ${missing.length}건(${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '…' : ''})을 못 찾았어요. 목록에서 직접 모두 고른 뒤 양식다운로드를 눌러 주세요.`,
              });
            } else {
              await patch({ step: 'popup', picked: got.length, status: `발주건 고르는 중… ${got.length}/${orderNos.length}건` });
            }
            return;
          }
          pickTries = 0;
          await patch({ step: 'popup', picked: got.length, status: `[v4] 발주건 ${got.length}/${orderNos.length}건 선택함. 양식 받는 중…` });
          await sleep(600);
        }
        if (Date.now() - lastClick > 6000) {
          lastClick = Date.now();
          realClick(dl);
          await patch({ step: 'page', status: '양식다운로드를 눌렀어요. 파일 오는 중…' });
        }
        return;
      }

      // 앞 단계가 화면에 보이면 그 단계에서 기다린다(시간 제한에 걸렸다고 뒷걸음질쳐서
      // 이미 연 창을 다시 열면 안 된다).
      //
      // 일괄등록 화면이면 "일괄등록 양식 다운로드"를 눌러 팝업을 띄운다.
      const opener = find(TEXT.openPopup);
      if (opener) {
        if (Date.now() - lastClick > 4000) {
          lastClick = Date.now();
          realClick(opener);
          await patch({ step: 'popup', status: '양식 다운로드 팝업 여는 중…' });
        }
        return;
      }

      // 쉽먼트 일괄등록 화면으로 가는 길: 물류 › 쉽먼트 › 쉽먼트 일괄등록.
      const pageLink = find(TEXT.batchPage);
      if (pageLink) {
        if (Date.now() - lastClick > 4000) {
          lastClick = Date.now();
          realClick(pageLink);
          await patch({ step: 'page', status: '쉽먼트 일괄등록 여는 중…' });
        }
        return;
      }
      const shipMenu = find(TEXT.shipment);
      if (shipMenu) {
        if (Date.now() - lastClick > 4000) {
          lastClick = Date.now();
          realClick(shipMenu);
          await patch({ step: 'menu', status: '쉽먼트 메뉴 여는 중…' });
        }
        return;
      }
      const logiMenu = find(TEXT.logistics);
      if (logiMenu) {
        if (Date.now() - lastClick > 4000) {
          lastClick = Date.now();
          realClick(logiMenu);
          await patch({ step: 'menu', status: '물류 메뉴 여는 중…' });
        }
        return;
      }
      if (Date.now() - (p.savedAt || 0) > 45000) {
        await patch({ step: 'manual', status: '서허에서 물류 › 쉽먼트 › 쉽먼트 일괄등록을 못 찾았어요. 직접 열고 양식 다운로드를 눌러 주세요.' });
      }
    } catch (err) {
      await patch({ step: 'error', status: `진행 중 오류: ${String((err && err.message) || err)}` });
    } finally {
      busy = false;
    }
  };

  setInterval(tick, 1200);
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[KEY] && IS_TOP) render(changes[KEY].newValue || null);
    });
  } catch (err) {}
  tick();
})();
