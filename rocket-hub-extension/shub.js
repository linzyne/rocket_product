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

  // 쪽 번호 버튼(1 2 3 4). 눌린 뒤 화면이 다시 그려지므로 쓸 때마다 새로 찾는다.
  const pageButton = (n) =>
    Array.from(document.querySelectorAll('button, a, li, span'))
      .filter((el) => visible(el) && el.children.length === 0 && clean(el.textContent) === String(n))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.width < 80 && r.height < 80;
      })[0] || null;

  const lastPageNo = () => {
    let max = 1;
    for (let n = 2; n <= 50; n++) if (pageButton(n)) max = n;
    return max;
  };

  // 팝업 목록이 여러 쪽이면 쪽을 넘겨 가며 우리 발주건을 모두 고른다.
  const pickOrdersAcrossPages = async (orderNos) => {
    const picked = new Set(pickOrders(orderNos));
    if (picked.size >= orderNos.length) return Array.from(picked);

    const last = lastPageNo();
    const first = Array.from(picked)[0];
    for (let n = 2; n <= last && picked.size < orderNos.length; n++) {
      const btn = pageButton(n);
      if (!btn) continue;
      realClick(btn);
      await sleep(1200);
      pickOrders(orderNos.filter((no) => !picked.has(no))).forEach((no) => picked.add(no));
    }

    // 1쪽으로 돌아가서, 쪽을 넘기는 사이에 앞서 고른 게 풀리지 않았는지 본다.
    if (last > 1) {
      const home = pageButton(1);
      if (home) {
        realClick(home);
        await sleep(1200);
      }
      if (first && !isPicked(first)) return { lost: true, picked: Array.from(picked) };
    }
    return Array.from(picked);
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
        // 이 쉽먼트의 발주건을 "전부" 고른 다음에만 양식을 받는다. 일부만 골라 받으면 양식에 그
        // 건들만 들어와서, 나중에 송장번호를 채울 줄이 통째로 빠져 버린다.
        if (!p.picked || p.picked < orderNos.length) {
          const res = await pickOrdersAcrossPages(orderNos);
          // 쪽을 넘기면 선택이 풀리는 화면이면 자동으로 할 수 없다. 사람에게 넘긴다.
          if (res && res.lost) {
            await patch({
              step: 'manual',
              status: '목록 쪽을 넘기면 앞에서 고른 발주건이 풀려요. 한 쪽에 다 보이게 필터(입고예정일 등)를 좁히거나, 직접 모두 고른 뒤 양식다운로드를 눌러 주세요.',
            });
            return;
          }
          const got = Array.isArray(res) ? res : [];
          const missing = orderNos.filter((no) => !got.includes(no));
          if (missing.length) {
            if (Date.now() - (p.savedAt || 0) > 40000) {
              await patch({
                step: 'manual',
                status: `팝업에서 발주번호 ${missing.length}건(${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '…' : ''})을 못 찾았어요. 목록에서 직접 모두 고른 뒤 양식다운로드를 눌러 주세요.`,
              });
            } else {
              await patch({ step: 'popup', picked: got.length, status: `발주건 고르는 중… ${got.length}/${orderNos.length}건` });
            }
            return;
          }
          await patch({ step: 'popup', picked: got.length, status: `발주건 ${got.length}/${orderNos.length}건 선택함. 양식 받는 중…` });
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
