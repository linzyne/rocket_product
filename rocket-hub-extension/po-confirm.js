// 서허 발주확정 파일 업로드(앱의 발주 진행 → 발주확정 상자 → "발주확정 올리기").
// 사람이 하던 순서 그대로:
//   1) 발주확정 업로드 화면(/scm/purchase/upload/form)의 "발주확정 파일 업로드"
//   2) 뜨는 동의 창 맨 아래 "7. 최종 동의"의 (전체 선택) 체크
//   3) 그 아래 + 로 파일 추가(앱이 채운 PO_FOR_CONFIRM 파일)
//   4) "업로드하기"
// 동의 창이 같은 화면의 창(모달)이든 새 창이든 이 스크립트가 거기서도 돈다. 서허가 띄운 알림 문구는 기록해 앱에 보여준다.
// 화면에서 무엇을 찾았는지는 poConfirmDebug에 남긴다(안 될 때 고치려고).
(() => {
  if (window.__rocketPoConfirmInjected) return;
  window.__rocketPoConfirmInjected = true;

  const KEY = 'poConfirmUpload';
  const DEBUG_KEY = 'poConfirmDebug';
  const FORM_URL = 'https://supplier.coupang.com/scm/purchase/upload/form';
  const MAX_AGE_MS = 10 * 60 * 1000;
  const DONE = ['done', 'error'];
  const isTop = window === window.top;

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
  const debug = (step, extra) => {
    try {
      chrome.storage.local.set({ [DEBUG_KEY]: { at: new Date().toISOString(), url: location.href, frame: isTop ? 'top' : 'frame', step, ...extra } });
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
  const findAll = (re, root = document) =>
    Array.from(root.querySelectorAll('body *')).filter((el) => {
      if (panel && panel.contains(el)) return false;
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
  const dataUrlToFile = (dataUrl, name) => {
    const [head, body] = dataUrl.split(',');
    const mime = (/data:([^;]+)/.exec(head) || [])[1] || 'application/octet-stream';
    const bin = atob(body);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], name, { type: mime });
  };

  // ---- 진행 패널(오른쪽 아래, 맨 위 화면에만) ----
  let panel = null;
  const render = (p) => {
    if (!isTop) return;
    if (!p || Date.now() - (p.savedAt || 0) > MAX_AGE_MS * 3) {
      if (panel) panel.style.display = 'none';
      return;
    }
    if (!panel) {
      panel = document.createElement('div');
      panel.style.cssText =
        'position:fixed;right:16px;bottom:16px;z-index:2147483647;background:#fff;border:1px solid #e3e8ef;' +
        'border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.12);font:13px -apple-system,BlinkMacSystemFont,"Malgun Gothic",sans-serif;' +
        'color:#111;min-width:260px;max-width:360px;padding:10px 12px';
      document.body.appendChild(panel);
    }
    panel.style.display = '';
    const color = p.step === 'error' ? '#dc2626' : p.step === 'done' ? '#059669' : '#1d4ed8';
    const msgs = (p.messages || []).map((m) => `<div style="margin-top:4px;color:#334155;font-size:12px">💬 ${String(m).replace(/</g, '&lt;')}</div>`).join('');
    panel.innerHTML =
      `<div style="font-weight:700;margin-bottom:4px">📤 발주확정 파일 업로드</div>` +
      `<div style="color:#64748b;font-size:12px">발주 ${(p.orderNos || []).length}건 · ${String((p.file && p.file.name) || '').replace(/</g, '&lt;')}</div>` +
      `<div style="margin-top:6px;color:${color}">${p.status || ''}</div>${msgs}` +
      `<div style="margin-top:8px;text-align:right"><button data-act="stop" style="border:1px solid #fecaca;background:#fff1f2;color:#b91c1c;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:12px">멈춤</button></div>`;
    panel.onclick = (e) => {
      if (e.target && e.target.getAttribute && e.target.getAttribute('data-act') === 'stop') {
        try { chrome.storage.local.remove(KEY); } catch (err) {}
        panel.style.display = 'none';
      }
    };
  };

  // 서허가 띄운 알림·확인창 문구(shub-hook.js가 넘겨줌)를 기록한다.
  window.addEventListener('message', async (event) => {
    const d = event.data;
    if (event.source !== window || !d || d.source !== 'rocket-shub-hook' || d.type !== 'DIALOG') return;
    const p = await get();
    if (!p || DONE.includes(p.step) || !['submitted', 'agree'].includes(p.step)) return;
    await patch({ messages: [...(p.messages || []), d.text].slice(-6) });
  });

  // 동의 창: "(전체 선택) 안내문을 확인하고" 글자가 보이면.
  const agreeLabel = () => findAll(/\(\s*전체\s*선택\s*\)\s*안내문을\s*확인/)[0] || null;
  // 동의 창 전체(체크·파일 칸·업로드하기가 함께 든 가장 작은 상자).
  const agreeBox = (label) => {
    let box = label;
    for (let i = 0; i < 15 && box; i++) {
      if (/업로드\s*하기/.test(clean(box.textContent)) && box.querySelector('input[type="checkbox"]')) return box;
      box = box.parentElement;
    }
    return document.body;
  };
  const agreeCheckbox = (label) => {
    const own = label.closest('label');
    if (own) {
      const inside = own.querySelector('input[type="checkbox"]');
      if (inside) return inside;
      if (own.htmlFor) {
        const byFor = document.getElementById(own.htmlFor);
        if (byFor) return byFor;
      }
    }
    let box = label;
    for (let i = 0; i < 4 && box; i++) {
      const c = box.querySelector('input[type="checkbox"]');
      if (c) return c;
      box = box.parentElement;
    }
    return null;
  };

  let busy = false;
  let lastNav = 0;
  const tick = async () => {
    if (busy) return;
    const p = await get();
    render(p);
    if (!p || DONE.includes(p.step)) return;
    if (Date.now() - (p.savedAt || 0) > MAX_AGE_MS) return;
    busy = true;
    try {
      const label = agreeLabel();
      // 동의 창이 이 화면(또는 새 창)에 떠 있으면 확장이 연 창이 아니어도 이어서 한다(새 창은 창 번호가 다르다).
      if (!label) {
        if (!isTop) return;
        if (!p.windowId || !myWindowId || p.windowId !== myWindowId) return;
      }
      if (document.querySelector('input[type="password"]')) {
        await patch({ status: '서허 로그인 중이에요. 로그인하면 이어서 진행해요.' });
        return;
      }

      // 누른 뒤: 서허 알림을 몇 초 모아서 끝낸다.
      if (p.step === 'submitted') {
        const waited = Date.now() - (p.submittedAt || 0);
        const msgs = (p.messages || []).join(' / ');
        if (/실패|오류|error|올바르지|확인해\s*주|없습니다|불가/i.test(msgs) && !/성공|완료/.test(msgs)) {
          await patch({ step: 'error', status: `❌ 서허가 업로드를 받지 않았어요: ${msgs}` });
          return;
        }
        if (waited > 8000) {
          const box = label ? clean(agreeBox(label).textContent).slice(0, 200) : '';
          debug('result', { msgs, stillOpen: !!label, box });
          if (label && /업로드\s*하기/.test(box) && !msgs) {
            await patch({ step: 'error', status: '"업로드하기"를 눌렀는데 창이 그대로예요. 이 창에서 확인해 주세요.' });
            return;
          }
          await patch({ step: 'done', status: `✅ 발주확정 파일을 올렸어요.${msgs ? ` 서허: ${msgs}` : ''}` });
        }
        return;
      }

      // 2~4) 동의 창: 체크 → 파일 → 업로드하기
      if (label) {
        const box = agreeBox(label);
        const check = agreeCheckbox(label);
        if (!check) {
          debug('no-check', { box: clean(box.textContent).slice(0, 300) });
          await patch({ step: 'error', status: '최종 동의 체크칸을 못 찾았어요. 이 창에서 직접 체크하고 파일을 넣어 주세요.' });
          return;
        }
        if (!check.checked) {
          await patch({ step: 'agree', status: '최종 동의 체크하는 중…' });
          realClick(check.closest('label') || check);
          await sleep(400);
          if (!check.checked) { check.click(); await sleep(300); }
          if (!check.checked) {
            await patch({ step: 'error', status: '최종 동의에 체크가 안 돼요. 직접 체크해 주세요.' });
            return;
          }
        }
        let input = box.querySelector('input[type="file"]') || document.querySelector('input[type="file"]');
        if (!input) {
          // + 버튼이 파일 칸을 만드는 화면이면 눌러 본다(파일 고르는 창은 크롬이 막아서 뜨지 않는다).
          const plus = findAll(/파일을\s*추가해\s*주세요/)[0];
          const btn = plus && (plus.parentElement && plus.parentElement.querySelector('button,[role="button"],a'));
          if (btn) { realClick(btn); await sleep(600); }
          input = box.querySelector('input[type="file"]') || document.querySelector('input[type="file"]');
        }
        if (!input) {
          debug('no-file-input', { box: clean(box.textContent).slice(0, 300) });
          await patch({ step: 'error', status: '파일 넣는 칸을 못 찾았어요. 이 창에서 + 를 눌러 직접 넣어 주세요(파일은 다운로드 폴더에 저장돼 있어요).' });
          return;
        }
        if (!p.fileSet) {
          await patch({ step: 'agree', status: '파일 넣는 중…' });
          const file = dataUrlToFile(p.file.dataUrl, p.file.name || 'PO_FOR_CONFIRM.xlsx');
          const dt = new DataTransfer();
          dt.items.add(file);
          input.files = dt.files;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          await sleep(1200);
          const shown = clean(box.textContent).includes(clean(p.file.name || '').replace(/\.xlsx$/i, '').slice(0, 15));
          debug('file-set', { files: input.files ? input.files.length : 0, shown, box: clean(box.textContent).slice(-300) });
          if (!input.files || !input.files.length) {
            await patch({ step: 'error', status: '파일이 안 들어갔어요. 이 창에서 + 를 눌러 직접 넣어 주세요.' });
            return;
          }
          await patch({ fileSet: true, fileSetAt: Date.now(), status: '파일을 넣었어요. "업로드하기" 누르는 중…' });
          return;
        }
        const up = findAll(/^업로드\s*하기$/, box).map(clickable).pop() || findAll(/^업로드\s*하기$/).map(clickable).pop();
        if (!up) {
          await patch({ step: 'error', status: '"업로드하기" 버튼을 못 찾았어요. 직접 눌러 주세요.' });
          return;
        }
        if (up.disabled || up.getAttribute('aria-disabled') === 'true' || /disabled/.test(String(up.className))) {
          await patch({ status: '"업로드하기" 버튼이 아직 꺼져 있어요. 기다리는 중…' });
          if (Date.now() - (p.fileSetAt || p.savedAt || 0) > 20000) {
            await patch({ step: 'error', status: '"업로드하기" 버튼이 켜지지 않아요. 체크와 파일을 확인하고 직접 눌러 주세요.' });
          }
          return;
        }
        await patch({ step: 'submitted', submittedAt: Date.now(), messages: [], status: '"업로드하기"를 눌렀어요. 결과 기다리는 중…' });
        realClick(up);
        return;
      }

      // 1) 발주확정 업로드 화면의 "발주확정 파일 업로드"
      if (location.pathname.startsWith('/scm/purchase/upload')) {
        const opener = findAll(/^발주\s*확정\s*파일\s*업로드$/).map(clickable)[0];
        if (!opener) {
          if (Date.now() - (p.savedAt || 0) > 20000) {
            debug('no-opener', { body: clean(document.body.textContent).slice(0, 300) });
            await patch({ step: 'error', status: '"발주확정 파일 업로드" 버튼을 못 찾았어요. 이 창에서 직접 눌러 주세요.' });
          }
          return;
        }
        if (p.step === 'opened' && Date.now() - (p.savedAt || 0) < 6000) return;
        await patch({ step: 'opened', status: '"발주확정 파일 업로드" 누르는 중… 동의 창 기다리는 중' });
        realClick(opener);
        return;
      }

      // 다른 화면이면 발주확정 업로드 화면으로 간다.
      if (Date.now() - lastNav > 8000) {
        lastNav = Date.now();
        await patch({ step: 'nav', status: '발주확정 업로드 화면 여는 중…' });
        location.href = FORM_URL;
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
      if (area === 'local' && changes[KEY]) render(changes[KEY].newValue || null);
    });
  } catch (err) {}
})();
