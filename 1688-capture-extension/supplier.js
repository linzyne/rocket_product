// 쿠팡 서플라이어허브 "대량 상품 등록"(supplier.coupang.com/qvt/registration) 화면에서,
// 로켓제안서 앱이 통합다운으로 만든 파일들을 대신 채워 넣습니다.
//
//   01 견적서 Excel      <- 통합다운의 _견적서_....xlsx
//   02 상품 이미지        <- 통합다운의 _이미지.zip (대표/상세)
//   03 제품 필수 표시사항  <- 통합다운의 라벨 png (옵션마다 한 장)
//   04 법적 필수서류      <- 토글이 있으면 전부 "해당없음"
//   로켓설치 상품 입니까?  <- 항상 "아니오"
//   약관 동의 체크 후 "파일 검증하기" 클릭
//
// 화면 구조(클래스명)는 쿠팡이 언제든 바꿀 수 있으므로, 각 칸을 클래스가 아니라 눈에 보이는
// 제목 글자로 찾습니다. 그래야 리뉴얼에 조금이라도 덜 깨집니다.
(() => {
  if (window.__rocketSupplierInjected) return;
  window.__rocketSupplierInjected = true;

  const PENDING_KEY = 'rocketPendingQuote';
  // 하루가 지난 파일은 예전 작업이 남은 것으로 보고 자동으로 버립니다.
  const MAX_AGE_MS = 24 * 60 * 60 * 1000;

  // 각 업로드 칸을 찾는 기준이 되는 제목 글자.
  const ANCHORS = {
    quote: /작성이\s*완료된\s*견적서/,
    images: /상품\s*이미지를\s*업로드/,
    labels: /제품\s*필수\s*표시사항을\s*업로드/,
    docs: /법적\s*필수서류를\s*업로드/,
  };

  let pending = null;
  let running = false;
  let panel = null;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const textOf = (el) => ((el && el.textContent) || '').replace(/\s+/g, ' ').trim();

  const storageGet = (key) =>
    new Promise((resolve) => {
      try {
        chrome.storage.local.get(key, (result) => {
          resolve(chrome.runtime.lastError ? null : result[key] || null);
        });
      } catch (err) {
        resolve(null);
      }
    });

  const storageRemove = (key) => {
    try {
      chrome.storage.local.remove(key);
    } catch (err) {
      /* 확장이 새로 로드된 경우 무시 */
    }
  };

  // 글자를 품은 가장 안쪽 요소들. 상위 요소도 같은 글자를 포함하므로, 다른 후보를 감싸는
  // 요소는 걸러내야 "그 글자가 실제로 적힌 곳"을 얻을 수 있습니다.
  const deepestWithText = (re, root) => {
    const all = Array.from((root || document.body).querySelectorAll('*')).filter((el) => re.test(textOf(el)));
    return all.filter((el) => !all.some((other) => other !== el && el.contains(other)));
  };

  // 제목 글자에서 위로 올라가며, 파일 입력칸을 품고 있으면서 다른 섹션 제목은 섞이지 않은
  // 가장 가까운 조상을 그 섹션으로 봅니다(왼쪽 설명과 오른쪽 업로드 박스를 함께 감싼 행).
  const findSection = (key) => {
    const anchor = deepestWithText(ANCHORS[key])[0];
    if (!anchor) return null;
    const others = Object.entries(ANCHORS).filter(([k]) => k !== key).map(([, re]) => re);

    let node = anchor;
    for (let i = 0; i < 12 && node; i++) {
      if (node.querySelector && node.querySelector('input[type="file"]')) {
        const text = textOf(node);
        // 다른 섹션까지 삼켰다면 너무 위로 올라온 것이라 더 볼 필요가 없습니다.
        if (others.some((re) => re.test(text))) return null;
        return node;
      }
      node = node.parentElement;
    }
    return null;
  };

  const dataUrlToFile = (item) => {
    const [meta, base64 = ''] = String(item.dataUrl).split(',');
    const mime = (meta.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new File([bytes], item.name, { type: mime });
  };

  const setInputFiles = (input, files) => {
    const transfer = new DataTransfer();
    files.forEach((file) => transfer.items.add(file));
    input.files = transfer.files;
    // 리액트/뷰로 만든 업로드 UI가 알아채도록 두 이벤트를 모두 흘려줍니다.
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  // 섹션 안의 파일 입력칸에 파일을 넣습니다. 여러 장인데 multiple이 아닌 칸이면 한 장씩
  // 연달아 넣습니다(한 개씩 받아 목록에 쌓는 UI가 많아서, 그 경우 전부 들어갑니다).
  const attachToSection = async (key, items) => {
    if (!items || items.length === 0) return { ok: true, skipped: true };
    const section = findSection(key);
    if (!section) return { ok: false, error: '칸을 찾지 못함' };
    const input = section.querySelector('input[type="file"]:not([disabled])');
    if (!input) return { ok: false, error: '입력칸 없음' };

    const files = items.map(dataUrlToFile);
    if (files.length === 1 || input.multiple) {
      setInputFiles(input, files);
      await sleep(600);
      return { ok: true, count: files.length };
    }

    for (const file of files) {
      setInputFiles(input, [file]);
      await sleep(700);
    }
    return { ok: true, count: files.length };
  };

  // 옵션 글자(예: "해당없음")에 딸린 라디오 버튼 찾기. 그 옵션만 감싼 요소 안에서 찾아야
  // 짝인 "해당함"을 잘못 집지 않습니다.
  const radioFor = (el, exactRe) => {
    const label = el.closest('label');
    if (label && exactRe.test(textOf(label))) {
      const radio = label.querySelector('input[type="radio"]');
      if (radio) return radio;
    }
    let node = el;
    for (let i = 0; i < 3 && node; i++) {
      const sibling = node.previousElementSibling;
      if (sibling && sibling.matches && sibling.matches('input[type="radio"]')) return sibling;
      if (exactRe.test(textOf(node))) {
        const radio = node.querySelector('input[type="radio"]');
        if (radio) return radio;
      }
      node = node.parentElement;
    }
    return null;
  };

  const pickOption = (el, exactRe) => {
    const radio = radioFor(el, exactRe);
    if (radio) {
      if (radio.checked) return true;
      radio.click();
      if (radio.checked) return true;
    }
    // 라디오를 직접 못 찾거나 클릭이 안 먹는 커스텀 UI는 글자를 눌러봅니다.
    el.click();
    return radio ? radio.checked : true;
  };

  // 04번 등 "해당함 / 해당없음" 토글은 전부 "해당없음"으로. (인증상품처럼 가끔 생기는 항목도
  // 같은 모양이라 함께 처리됩니다.)
  const chooseAllNotApplicable = () => {
    const exact = /^해당없음$/;
    const targets = deepestWithText(exact);
    let done = 0;
    targets.forEach((el) => {
      if (pickOption(el, exact)) done += 1;
    });
    return { total: targets.length, done };
  };

  // "카테고리별 공문 또는 확약서 자동 생성" 아래의 동의 질문들은 필수(*)라서, 고르지 않으면
  // 파일 검증 버튼이 열리지 않습니다. 전부 "예"로 답합니다.
  // ("로켓설치 상품 입니까?"는 문구가 달라 여기에 걸리지 않습니다.)
  const agreeToAutoDocuments = () => {
    const questions = deepestWithText(/동의하시겠습니까/);
    if (questions.length === 0) return { skipped: true };
    const exact = /^예$/;
    let done = 0;
    questions.forEach((question) => {
      let row = question;
      for (let i = 0; i < 6 && row; i++) {
        if (/아니오/.test(textOf(row))) break;
        row = row.parentElement;
      }
      if (!row) return;
      const target = deepestWithText(exact, row)[0];
      if (target && pickOption(target, exact)) done += 1;
    });
    return { total: questions.length, done };
  };

  const chooseRocketInstallNo = () => {
    const question = deepestWithText(/로켓설치\s*상품\s*입니까/)[0];
    if (!question) return { skipped: true };
    let row = question;
    for (let i = 0; i < 6 && row; i++) {
      if (/아니오/.test(textOf(row))) break;
      row = row.parentElement;
    }
    if (!row) return { ok: false };
    const exact = /^아니오$/;
    const target = deepestWithText(exact, row)[0];
    if (!target) return { ok: false };
    return { ok: pickOption(target, exact) };
  };

  const agreeToTerms = () => {
    const target = deepestWithText(/쿠팡\s*약관에\s*동의합니다/)[0];
    if (!target) return { skipped: true };
    const label = target.closest('label');
    let checkbox = label && label.querySelector('input[type="checkbox"]');
    if (!checkbox) {
      let node = target;
      for (let i = 0; i < 4 && node && !checkbox; i++) {
        const sibling = node.previousElementSibling;
        if (sibling && sibling.matches && sibling.matches('input[type="checkbox"]')) checkbox = sibling;
        else checkbox = node.querySelector && node.querySelector('input[type="checkbox"]');
        node = node.parentElement;
      }
    }
    if (checkbox) {
      if (!checkbox.checked) checkbox.click();
      if (checkbox.checked) return { ok: true };
    }
    target.click();
    return { ok: checkbox ? checkbox.checked : true };
  };

  const isDisabled = (el) =>
    el.disabled === true ||
    el.getAttribute('aria-disabled') === 'true' ||
    /disabled/i.test(el.className || '');

  const findVerifyButton = () => {
    const exact = /^파일\s*검증하기$/;
    const target = deepestWithText(exact)[0];
    if (!target) return null;
    return target.closest('button, a, [role="button"]') || target;
  };

  // 첨부한 파일이 서버로 올라가야 버튼이 열리는 화면이라, 열릴 때까지 잠시 기다립니다.
  const clickVerify = async (waitMs) => {
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      const button = findVerifyButton();
      if (button && !isDisabled(button)) {
        button.click();
        return { ok: true };
      }
      await sleep(1000);
    }
    return { ok: false, error: '버튼이 활성화되지 않음' };
  };

  const run = async () => {
    if (!pending || running) return;
    running = true;
    try {
      panel.step('quote', 'run', '01 견적서 첨부 중...');
      const quote = await attachToSection('quote', pending.quote ? [pending.quote] : []);
      panel.step('quote', quote.ok ? 'ok' : 'fail', quote.ok ? '01 견적서 첨부됨' : `01 견적서 실패(${quote.error})`);

      panel.step('images', 'run', '02 이미지 zip 첨부 중...');
      const images = await attachToSection('images', pending.imagesZip ? [pending.imagesZip] : []);
      panel.step(
        'images',
        images.skipped ? 'skip' : images.ok ? 'ok' : 'fail',
        images.skipped ? '02 이미지 없음(건너뜀)' : images.ok ? '02 이미지 zip 첨부됨' : `02 이미지 실패(${images.error})`,
      );

      panel.step('labels', 'run', '03 라벨 첨부 중...');
      const labels = await attachToSection('labels', pending.labels || []);
      panel.step(
        'labels',
        labels.skipped ? 'skip' : labels.ok ? 'ok' : 'fail',
        labels.skipped ? '03 라벨 없음(건너뜀)' : labels.ok ? `03 라벨 ${labels.count}개 첨부됨` : `03 라벨 실패(${labels.error})`,
      );

      const radios = chooseAllNotApplicable();
      panel.step('radios', radios.total === 0 ? 'skip' : 'ok', radios.total === 0 ? '04 토글 없음' : `04 해당없음 ${radios.done}/${radios.total}개 선택`);

      const documents = agreeToAutoDocuments();
      panel.step(
        'documents',
        documents.skipped ? 'skip' : documents.done > 0 ? 'ok' : 'fail',
        documents.skipped ? '공문/확약서 항목 없음' : `공문·확약서 자동 생성: 예 ${documents.done}/${documents.total}개`,
      );

      const install = chooseRocketInstallNo();
      panel.step('install', install.skipped ? 'skip' : install.ok ? 'ok' : 'fail', install.skipped ? '로켓설치 항목 없음' : install.ok ? '로켓설치: 아니오' : '로켓설치 선택 실패');

      const terms = agreeToTerms();
      panel.step('terms', terms.skipped ? 'skip' : terms.ok ? 'ok' : 'fail', terms.skipped ? '약관 항목 없음' : terms.ok ? '약관 동의 체크' : '약관 체크 실패');

      // 필수인 01번이 안 들어갔으면 검증을 눌러봐야 실패하므로 여기서 멈춥니다.
      if (!quote.ok) {
        panel.step('verify', 'fail', '견적서가 없어 검증을 누르지 않음');
        panel.note('01번을 직접 확인한 뒤 "다시 실행"을 눌러주세요.');
        return;
      }

      panel.step('verify', 'run', '파일 검증하기 활성화 대기 중...');
      const verify = await clickVerify(90000);
      panel.step('verify', verify.ok ? 'ok' : 'fail', verify.ok ? '파일 검증하기 클릭됨' : `검증 못 누름(${verify.error})`);

      if (verify.ok) {
        // 다음에 이 화면을 다시 열었을 때 같은 파일이 또 붙지 않도록 정리합니다.
        storageRemove(PENDING_KEY);
        panel.note('검증을 요청했습니다. 진행 상태는 "검증 진행상태 확인하기"에서 확인하세요.');
      } else {
        panel.note('화면에서 값 확인 후 "파일 검증하기"를 직접 눌러주세요.');
      }
    } catch (err) {
      console.error('[로켓제안] 자동 채우기 실패:', err);
      panel.note(`오류: ${(err && err.message) || err}`);
    } finally {
      running = false;
    }
  };

  // ---- 화면 우측 아래 진행 패널 (페이지 스타일과 섞이지 않게 shadow DOM 안에 그립니다) ----
  const buildPanel = () => {
    const host = document.createElement('div');
    host.id = 'rocket-supplier-quote-root';
    host.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483646;';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        .box {
          width: 320px; padding: 14px 16px; border-radius: 12px;
          background: #0f172a; color: #e2e8f0; border: 1px solid #334155;
          box-shadow: 0 12px 30px rgba(0,0,0,0.35);
          font-family: -apple-system, BlinkMacSystemFont, "Malgun Gothic", sans-serif; font-size: 13px;
        }
        .title { font-size: 13px; font-weight: 700; color: #f8fafc; margin: 0 0 4px; }
        .file { font-size: 11px; color: #93c5fd; word-break: break-all; margin: 0 0 8px; }
        ul { list-style: none; margin: 0 0 8px; padding: 0; }
        li { font-size: 11px; color: #cbd5e1; padding: 2px 0; line-height: 1.4; }
        li.ok { color: #34d399; }
        li.fail { color: #f87171; }
        li.skip { color: #64748b; }
        li.run { color: #fbbf24; }
        .note { font-size: 11px; color: #94a3b8; margin: 0 0 10px; line-height: 1.5; }
        .row { display: flex; gap: 6px; }
        button {
          flex: 1; padding: 7px 8px; border-radius: 7px; border: 1px solid #475569;
          background: #1e293b; color: #e2e8f0; font-size: 12px; font-weight: 600; cursor: pointer;
        }
        button.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
        button:hover { filter: brightness(1.1); }
      </style>
      <div class="box">
        <p class="title">📄 로켓제안서 자동 등록</p>
        <p class="file"></p>
        <ul class="steps"></ul>
        <p class="note"></p>
        <div class="row">
          <button class="primary rerun">다시 실행</button>
          <button class="dismiss">지우기</button>
        </div>
      </div>
    `;
    document.documentElement.appendChild(host);

    const stepsEl = shadow.querySelector('.steps');
    const noteEl = shadow.querySelector('.note');
    const items = new Map();

    shadow.querySelector('.rerun').addEventListener('click', () => run());
    shadow.querySelector('.dismiss').addEventListener('click', () => {
      storageRemove(PENDING_KEY);
      pending = null;
      host.remove();
    });

    return {
      setFile(name) {
        shadow.querySelector('.file').textContent = name;
      },
      step(key, status, text) {
        let li = items.get(key);
        if (!li) {
          li = document.createElement('li');
          items.set(key, li);
          stepsEl.appendChild(li);
        }
        li.className = status;
        li.textContent = `${status === 'ok' ? '✓' : status === 'fail' ? '✕' : status === 'skip' ? '−' : '…'} ${text}`;
      },
      note(text) {
        noteEl.textContent = text;
      },
    };
  };

  // ================= 카테고리 견적서 찾기 =================
  // 앱에서 키워드를 보내면 이 탭(백그라운드)에서 검색 -> 결과 목록을 앱으로 -> 앱에서 고른
  // 카테고리를 클릭 -> 견적서 다운로드 파일을 가로채 앱으로 돌려보냅니다.

  const send = (message) => {
    try {
      chrome.runtime.sendMessage(message, () => void chrome.runtime.lastError);
    } catch (err) {
      /* 확장이 새로 로드된 경우 무시 */
    }
  };

  const askJob = () =>
    new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: 'GET_JOB' }, (response) => {
          resolve(chrome.runtime.lastError ? null : response || null);
        });
      } catch (err) {
        resolve(null);
      }
    });

  const waitFor = async (getter, timeoutMs) => {
    const deadline = Date.now() + (timeoutMs || 15000);
    while (Date.now() < deadline) {
      const value = getter();
      if (value) return value;
      await sleep(300);
    }
    return null;
  };

  // 리액트가 관리하는 입력칸은 value를 그냥 넣으면 무시되므로, 네이티브 setter로 넣고
  // input 이벤트를 흘려 리액트가 상태를 갱신하게 합니다.
  const setNativeValue = (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const clickByText = (re) => {
    const target = deepestWithText(re)[0];
    if (!target) return false;
    (target.closest('button, a, [role="button"]') || target).click();
    return true;
  };

  const normalizePath = (text) => text.replace(/선택됨$/, '').replace(/\s*>\s*/g, ' > ').trim();

  // 검색 결과 한 줄은 "대분류 > 중분류 > 소분류 > 세부"처럼 > 가 두 개 이상 들어갑니다.
  // 카테고리 탐색 트리(뷰티, 생활용품 …)에는 > 가 없어 자연히 걸러집니다.
  const readResults = () => {
    const rows = deepestWithText(/>[^>]+>/).filter((el) => {
      const text = textOf(el);
      return text.split('>').length >= 3 && text.length < 200;
    });
    const seen = new Set();
    const items = [];
    rows.forEach((el) => {
      const path = normalizePath(textOf(el));
      if (!path || seen.has(path)) return;
      seen.add(path);
      items.push(path);
    });
    return items;
  };

  const findSearchInput = () => {
    const anchor = deepestWithText(/카테고리\s*검색/)[0];
    let root = anchor;
    for (let i = 0; i < 8 && root; i++) {
      const input = root.querySelector && root.querySelector('input[type="text"], input:not([type])');
      if (input) return input;
      root = root.parentElement;
    }
    return document.querySelector('input[type="text"]');
  };

  // hub-hook.js(MAIN world)가 가로챈 엑셀 파일을 기다립니다.
  const waitForFile = (timeoutMs) =>
    new Promise((resolve) => {
      const timer = setTimeout(() => {
        window.removeEventListener('message', onMessage);
        resolve(null);
      }, timeoutMs || 30000);
      const onMessage = (event) => {
        if (event.source !== window) return;
        const data = event.data;
        if (!data || data.source !== 'rocket-hub-hook' || data.type !== 'FILE') return;
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        resolve({ name: data.name, dataUrl: data.dataUrl });
      };
      window.addEventListener('message', onMessage);
    });

  // background가 알려준 다운로드 주소를 이 탭에서 다시 받아와, hub-hook이 보내는 것과 같은
  // 모양으로 흘려보냅니다(waitForFile이 그대로 받습니다).
  const fetchDownload = async (url, filename) => {
    try {
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') || '';
      const fromHeader = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
      let name = filename || (fromHeader ? decodeURIComponent(fromHeader[1]) : '') || '카테고리견적서.xlsx';
      name = name.trim();
      const reader = new FileReader();
      reader.onload = () => {
        window.postMessage(
          { source: 'rocket-hub-hook', type: 'FILE', name, dataUrl: String(reader.result) },
          window.location.origin,
        );
      };
      reader.readAsDataURL(blob);
    } catch (err) {
      console.error('[로켓제안] 다운로드 파일을 다시 받지 못했습니다:', err);
    }
  };

  const pickCategory = async (path) => {
    try {
      const target = await waitFor(
        () => deepestWithText(/>[^>]+>/).find((el) => normalizePath(textOf(el)) === path),
        10000,
      );
      if (!target) {
        send({ type: 'CATEGORY_ERROR', message: '고른 카테고리를 화면에서 찾지 못했습니다.' });
        return;
      }
      target.click();
      await sleep(800);

      const filePromise = waitForFile(120000);
      const clicked = clickByText(/선택\s*된?\s*카테고리의\s*견적서\s*다운로드/);
      if (!clicked) {
        send({ type: 'CATEGORY_ERROR', message: '견적서 다운로드 버튼을 찾지 못했습니다.' });
        return;
      }

      const file = await filePromise;
      if (!file) {
        send({ type: 'CATEGORY_ERROR', message: '견적서 파일을 받지 못했습니다(2분 초과). 쿠팡 탭에서 다운로드가 됐는지 확인해주세요.' });
        return;
      }
      send({ type: 'CATEGORY_FILE', name: file.name, dataUrl: file.dataUrl, path });
    } catch (err) {
      send({ type: 'CATEGORY_ERROR', message: String((err && err.message) || err) });
    }
  };

  const REGISTRATION_PATH = '/qvt/registration';
  // 비밀번호 만료 안내처럼 쿠팡이 중간에 끼워 넣는 화면. 막힌 게 아니라 메뉴로 계속 갈 수
  // 있으므로, 등록 화면으로 한 번 더 이동합니다(이동하면 이 스크립트가 새로 실행됩니다).
  const RETRY_FLAG = 'rocketRegistrationRetry';

  const redirectIfDetour = () => {
    if (location.pathname.startsWith(REGISTRATION_PATH)) return false;
    if (!/password-expired|home|^\/$/i.test(location.pathname)) return false;
    try {
      if (sessionStorage.getItem(RETRY_FLAG)) return false;
      sessionStorage.setItem(RETRY_FLAG, '1');
    } catch (err) {
      /* 세션 저장이 막힌 경우 그냥 한 번 이동 */
    }
    location.href = REGISTRATION_PATH;
    return true;
  };

  // 로그인이 아예 풀린 경우만 멈춥니다.
  const blockedByAccountScreen = () => {
    if (/login|signin/i.test(location.pathname)) return '쿠팡에 로그인한 뒤 다시 시도해주세요.';
    return null;
  };

  const runCategoryJob = async (keyword) => {
    chrome.runtime.onMessage.addListener((message) => {
      if (!message) return;
      if (message.type === 'CATEGORY_PICK') pickCategory(message.path);
      else if (message.type === 'FETCH_DOWNLOAD') fetchDownload(message.url, message.filename);
    });

    try {
      const blocked = blockedByAccountScreen();
      if (blocked) {
        send({ type: 'CATEGORY_ERROR', message: blocked });
        return;
      }
      // 다른 화면으로 튕겼으면 등록 화면으로 옮겨가고, 나머지는 새로 실행될 때 이어서 합니다.
      if (redirectIfDetour()) return;

      // 카테고리 검색창은 "최신 견적서 파일 다운로드" 안에 있습니다.
      // (로그인이 풀렸거나 화면이 아직 안 그려졌을 수 있어 넉넉히 기다립니다.)
      const opened = await waitFor(
        () => (clickByText(/최신\s*견적서\s*파일\s*다운로드|견적서\s*파일\s*다운로드/) ? true : null),
        30000,
      );
      if (!opened) {
        send({
          type: 'CATEGORY_ERROR',
          message: `견적서 다운로드 버튼을 찾지 못했습니다. (현재 화면: ${document.title || location.pathname})`,
        });
        return;
      }

      const input = await waitFor(findSearchInput, 15000);
      if (!input) {
        send({ type: 'CATEGORY_ERROR', message: '카테고리 검색창을 찾지 못했습니다.' });
        return;
      }

      setNativeValue(input, keyword);
      await sleep(400);
      if (!clickByText(/^검색$/)) {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
      }

      const items = await waitFor(() => {
        const found = readResults();
        return found.length > 0 ? found : null;
      }, 20000);

      if (!items) {
        send({ type: 'CATEGORY_ERROR', message: `"${keyword}" 검색 결과가 없습니다.` });
        return;
      }
      send({ type: 'CATEGORY_RESULTS', items });
    } catch (err) {
      send({ type: 'CATEGORY_ERROR', message: String((err && err.message) || err) });
    }
  };

  // ================= 시작 =================
  const startProposalFill = async () => {
    const stored = await storageGet(PENDING_KEY);
    if (!stored || !stored.quote) return;
    if (Date.now() - (stored.savedAt || 0) > MAX_AGE_MS) {
      storageRemove(PENDING_KEY);
      return;
    }
    pending = stored;

    // 화면 안 iframe에도 이 스크립트가 들어가므로, 등록 폼이 있는 문서에서만 움직입니다.
    if (!findSection('quote')) {
      // 폼이 늦게 그려지는 경우가 있어 잠시 기다렸다 다시 봅니다.
      for (let i = 0; i < 20 && !findSection('quote'); i++) await sleep(500);
      if (!findSection('quote')) return;
    }

    panel = buildPanel();
    panel.setFile(pending.quote.name);
    panel.note('자동으로 채우는 중입니다. 화면을 그대로 두세요.');
    await run();
  };


  const start = async () => {
    // 카테고리 작업은 최상위 문서에서 한 번만 돌립니다(iframe 중복 실행 방지).
    if (window.top === window) {
      const job = await askJob();
      if (job && job.keyword) {
        await runCategoryJob(job.keyword);
        return;
      }
    }
    await startProposalFill();
  };

  start();
})();
