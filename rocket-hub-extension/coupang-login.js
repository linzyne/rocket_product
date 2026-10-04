// 쿠팡(서허·광고) 자동 로그인. 확장이 수집하려고 연 창에 로그인 화면이 뜨면, 확장 설정에 저장한
// 쿠팡 아이디·비밀번호로 대신 로그인합니다. 사장님이 따로 열어 둔 창에서는 아무것도 하지 않습니다.
// 틀린 비밀번호로 계속 시도해 계정이 잠기지 않도록 한 창에서 최대 2번, 15초 간격으로만 시도합니다.
(() => {
  if (window.__rocketCoupangLoginInjected) return;
  window.__rocketCoupangLoginInjected = true;

  const CRED_KEY = 'coupangCredentials';
  const TRY_KEY = 'coupangLoginTries';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const visible = (el) => {
    if (!el || !el.getBoundingClientRect) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const st = getComputedStyle(el);
    return st.visibility !== 'hidden' && st.display !== 'none';
  };

  const ask = (message) =>
    new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (res) => resolve(chrome.runtime.lastError ? null : res));
      } catch (err) {
        resolve(null);
      }
    });

  const setValue = (el, v) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    el.focus();
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const realClick = (el) => {
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
  };

  const note = (html) => {
    let box = document.getElementById('__rocketLoginNote');
    if (!box) {
      box = document.createElement('div');
      box.id = '__rocketLoginNote';
      box.style.cssText =
        'position:fixed;left:50%;top:96px;transform:translateX(-50%);z-index:2147483647;max-width:520px;padding:12px 16px;' +
        'background:#fef3c7;border:1px solid #f59e0b;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.15);' +
        'font:14px/1.5 -apple-system,sans-serif;color:#78350f;';
      document.body.appendChild(box);
    }
    box.innerHTML = html;
  };

  const passwordInput = () => Array.from(document.querySelectorAll('input[type="password"]')).find(visible) || null;

  const tryLogin = async (creds) => {
    const pw = passwordInput();
    if (!pw) return false;
    // 시도 횟수는 창(탭)마다 센다. 로그인 화면이 다시 뜨면 페이지가 새로 열려도 이어서 센다.
    const tries = Number(sessionStorage.getItem(TRY_KEY) || 0);
    const lastAt = Number(sessionStorage.getItem(`${TRY_KEY}At`) || 0);
    if (tries >= 2) {
      note('<b>🚀 자동 로그인이 두 번 실패했어요</b><br>직접 로그인해 주세요. 확장 아이콘 › 설정의 쿠팡 비밀번호도 확인해 주세요.<br>로그인하면 수집을 이어갑니다.');
      return true;
    }
    if (Date.now() - lastAt < 15000) return true;

    const inputs = Array.from(document.querySelectorAll('input')).filter(
      (el) => visible(el) && /^(text|email|tel|)$/.test(el.type || '')
    );
    const idInput = inputs.filter((el) => el.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING).pop() || inputs[0];
    if (!idInput) return false;

    sessionStorage.setItem(TRY_KEY, String(tries + 1));
    sessionStorage.setItem(`${TRY_KEY}At`, String(Date.now()));
    note('<b>🚀 쿠팡 자동 로그인 중…</b>');
    setValue(idInput, creds.id);
    setValue(pw, creds.pw);
    await sleep(400);
    const scope = pw.form || document;
    const btn =
      Array.from(scope.querySelectorAll('button, input[type="submit"], input[type="button"], a, [role="button"]')).find(
        (el) => visible(el) && /^(로그인|login|signin|sign in)$/i.test(clean(el.textContent || el.value))
      ) || (pw.form && pw.form.querySelector('[type="submit"]'));
    if (btn) realClick(btn);
    else if (pw.form) pw.form.requestSubmit ? pw.form.requestSubmit() : pw.form.submit();
    else pw.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    return true;
  };

  (async () => {
    // 확장이 연 수집 창인지 먼저 묻는다.
    const res = await ask({ type: 'IS_COLLECT_WINDOW' });
    if (!res || !res.collect) return;

    // 화면이 다 그려질 때까지 비밀번호 칸을 잠깐 기다린다.
    const until = Date.now() + 20000;
    while (Date.now() < until && !passwordInput()) await sleep(500);
    if (!passwordInput()) return;

    const r = await new Promise((resolve) => {
      try {
        chrome.storage.local.get(CRED_KEY, (x) => resolve((x && x[CRED_KEY]) || null));
      } catch (err) {
        resolve(null);
      }
    });
    if (!r || !r.id || !r.pw) {
      note('<b>🚀 쿠팡 로그인이 풀려 있어요</b><br>여기서 로그인하면 수집을 이어갑니다.<br>확장 아이콘 › 설정에 쿠팡 아이디·비밀번호를 저장하면 다음부터 알아서 로그인해요.');
      return;
    }
    // 로그인이 안 되고 같은 화면에 머물면 15초 뒤 한 번 더 해 본다(최대 2번).
    for (let i = 0; i < 3; i++) {
      if (!passwordInput()) return;
      await tryLogin(r);
      await sleep(16000);
    }
  })();
})();
