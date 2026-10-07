// 쉽먼트 출력(앱의 발송대기에서 쉽먼트 번호를 누름 → background.js가 shubPrint를 남기고 택배 쉽먼트 화면을 엶).
// 택배 쉽먼트 화면(/ibs/asn/active)에서 발주 번호로 검색해 그 쉽먼트 줄을 찾고,
// 줄 맨 오른쪽의 "Label" → "내역서"를 차례로 누른다. 받아진 PDF 두 개는 background.js가 읽어 앱에 넘기고,
// 앱이 하나로 합쳐 새 탭에 연다(사람은 거기서 프린트만 누른다).
(() => {
  if (window.__rocketShubPrintInjected) return;
  window.__rocketShubPrintInjected = true;
  if (window !== window.top) return;

  const KEY = 'shubPrint';
  const MAX_AGE_MS = 5 * 60 * 1000;

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
      await chrome.storage.local.set({ [KEY]: { ...now, ...fields, savedAt: Date.now() } });
    } catch (err) {}
  };

  let myWindowId = null;
  try {
    chrome.runtime.sendMessage({ type: 'MY_WINDOW' }, (res) => {
      if (chrome.runtime.lastError) return;
      myWindowId = (res && res.windowId) || null;
    });
  } catch (err) {}

  const visible = (el) => {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const st = getComputedStyle(el);
    return st.visibility !== 'hidden' && st.display !== 'none';
  };
  const findAll = (re) =>
    Array.from(document.querySelectorAll('body *')).filter((el) => {
      if (!re.test(clean(el.textContent))) return false;
      return !Array.from(el.children).some((c) => re.test(clean(c.textContent))) && visible(el);
    });
  const clickable = (el) => el.closest('a,button,label,li,[role="button"],[onclick]') || el;
  const realClick = (el) => {
    const target = clickable(el);
    const opts = { bubbles: true, cancelable: true, view: window };
    ['pointerover', 'mouseover', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((type) => {
      const Ev = type.startsWith('pointer') && window.PointerEvent ? PointerEvent : MouseEvent;
      target.dispatchEvent(new Ev(type, opts));
    });
  };
  const setValue = (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    ['input', 'change', 'keyup', 'blur'].forEach((t) => input.dispatchEvent(new Event(t, { bubbles: true })));
  };
  const fieldNear = (labelRe) => {
    const label = findAll(labelRe).find((el) => !el.closest('table'));
    let box = label;
    for (let i = 0; i < 5 && box; i++) {
      const input = Array.from(box.querySelectorAll('input')).find((x) => visible(x) && x.type !== 'hidden');
      if (input) return input;
      box = box.parentElement;
    }
    return null;
  };
  const clickSearch = () => {
    const btn = findAll(/^검색$/).map(clickable).filter((el) => !el.closest('table')).pop();
    if (btn) realClick(btn);
  };
  // 조회 결과 표에서 쉽먼트 번호 칸이 이 번호인 줄.
  const findRow = (shipmentNo) => {
    for (const table of document.querySelectorAll('table')) {
      if (!visible(table)) continue;
      const heads = Array.from(table.querySelectorAll('thead th')).map((th) => clean(th.textContent));
      const col = heads.findIndex((h) => /쉽먼트\s*번호/.test(h));
      if (col < 0) continue;
      const tr = Array.from(table.querySelectorAll('tbody tr')).find((r) => {
        const td = r.querySelectorAll('td')[col];
        return td && clean(td.textContent) === shipmentNo;
      });
      if (tr) return tr;
    }
    return null;
  };
  const rowButton = (tr, re) => Array.from(tr.querySelectorAll('button, a')).find((b) => re.test(clean(b.textContent)));

  // 진행 패널.
  let panel = null;
  const render = (p) => {
    if (!p || (p.windowId && myWindowId && p.windowId !== myWindowId) || Date.now() - (p.savedAt || 0) > MAX_AGE_MS * 2) {
      if (panel) panel.style.display = 'none';
      return;
    }
    if (!panel) {
      panel = document.createElement('div');
      panel.style.cssText =
        'position:fixed;right:16px;bottom:16px;z-index:2147483647;background:#fff;border:1px solid #e3e8ef;border-radius:10px;' +
        'box-shadow:0 8px 24px rgba(0,0,0,.12);font:13px -apple-system,BlinkMacSystemFont,"Malgun Gothic",sans-serif;color:#111;min-width:240px;max-width:340px;padding:10px 12px';
      document.body.appendChild(panel);
    }
    panel.style.display = '';
    const color = p.step === 'error' ? '#dc2626' : p.step === 'files' ? '#059669' : '#1d4ed8';
    panel.innerHTML =
      `<div style="font-weight:700;margin-bottom:4px">🖨 쉽먼트 출력 파일 받기</div>` +
      `<div style="color:#64748b;font-size:12px">쉽먼트 ${p.shipmentNo} · 발주 ${p.orderNo || '-'}</div>` +
      `<div style="margin-top:6px;color:${color}">${p.status || ''}</div>`;
  };

  let busy = false;
  const tick = async () => {
    if (busy) return;
    const p = await get();
    render(p);
    if (!p || ['files', 'error'].includes(p.step)) return;
    if (Date.now() - (p.savedAt || 0) > MAX_AGE_MS) return;
    if (!p.windowId || !myWindowId || p.windowId !== myWindowId) return;
    if (!location.pathname.startsWith('/ibs/asn')) return;
    busy = true;
    try {
      // 1) 발주 번호로 검색해 그 쉽먼트 줄만 보이게 한다(목록이 길어도 찾게).
      if (p.step === 'start') {
        const input = fieldNear(/^발주\s*번호$/);
        if (!input) return; // 화면이 다 그려질 때까지 기다린다.
        if (p.orderNo) setValue(input, p.orderNo);
        await sleep(300);
        clickSearch();
        await patch({ step: 'searched', status: `쉽먼트 ${p.shipmentNo} 찾는 중…` });
        return;
      }
      const tr = findRow(p.shipmentNo);
      if (!tr) {
        if (Date.now() - (p.savedAt || 0) > 15000) await patch({ step: 'error', status: `조회 결과에서 쉽먼트 ${p.shipmentNo}을 못 찾았어요.` });
        return;
      }
      // 2) Label → 3) 내역서. 파일은 다운로드 폴더로 받아지고 background.js가 읽는다.
      if (p.step === 'searched') {
        const btn = rowButton(tr, /label/i);
        if (!btn) { await patch({ step: 'error', status: '그 줄에서 "Label" 버튼을 못 찾았어요.' }); return; }
        realClick(btn);
        await patch({ step: 'label', status: 'Label 받는 중…' });
        return;
      }
      if (p.step === 'label' && Date.now() - (p.savedAt || 0) > 2500) {
        const btn = rowButton(tr, /내역서/);
        if (!btn) { await patch({ step: 'error', status: '그 줄에서 "내역서" 버튼을 못 찾았어요.' }); return; }
        realClick(btn);
        await patch({ step: 'manifest', status: '내역서 받는 중…' });
        return;
      }
      if (p.step === 'manifest' && Date.now() - (p.savedAt || 0) > 30000) {
        const got = Object.keys(p.files || {});
        await patch({ step: 'error', status: `파일이 다 오지 않았어요(받은 것: ${got.join(', ') || '없음'}). 다운로드 폴더를 확인해 주세요.` });
      }
    } catch (err) {
      await patch({ step: 'error', status: `진행 중 오류: ${String((err && err.message) || err)}` });
    } finally {
      busy = false;
    }
  };

  setInterval(tick, 1000);
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[KEY]) render(changes[KEY].newValue || null);
    });
  } catch (err) {}
  tick();
})();
