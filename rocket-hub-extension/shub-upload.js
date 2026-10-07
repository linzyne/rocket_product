// 서허 쉽먼트 일괄등록 "양식 업로드"(앱의 쉽먼트생성대기 → 쉽먼트업로드에서 양식을 채운 다음 단계).
// 사람이 하던 순서 그대로:
//   1) 택배 쉽먼트 화면(/ibs/asn/active) 오른쪽 위 "쉽먼트 일괄등록"
//   2) 뜨는 창에서 "일괄등록 양식 업로드"
//   3) 업로드 화면에서 택배사 = 롯데택배, 발송일 = 입고예정일 하루 전, 시간 = 23:55, 업로드 파일 = 채운 양식
//   4) 아래 파란 "쉽먼트 일괄등록"
// 누른 뒤에는 창을 닫지 않는다(결과를 사람이 확인). 서허가 띄운 알림 문구는 기록해서 앱에 보여준다.
// 화면에서 무엇을 찾았는지는 shubUploadDebug에 남긴다(안 될 때 고치려고).
(() => {
  if (window.__rocketShubUploadInjected) return;
  window.__rocketShubUploadInjected = true;
  if (window !== window.top) return;

  const KEY = 'shubUpload';
  const DEBUG_KEY = 'shubUploadDebug';
  const ARM = '__rocketShubUploadArm';
  const ASN_URL = 'https://supplier.coupang.com/ibs/asn/active';
  const MAX_AGE_MS = 10 * 60 * 1000;
  const DONE = ['done', 'error'];

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
      chrome.storage.local.set({ [DEBUG_KEY]: { at: new Date().toISOString(), url: location.href, step, ...extra } });
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
  // 글자가 맞는 가장 안쪽 요소들.
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
  const setValue = (input, value) => {
    const proto = input.tagName === 'SELECT' ? HTMLSelectElement.prototype : input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    setter.call(input, value);
    ['input', 'change', 'keyup', 'blur'].forEach((t) => input.dispatchEvent(new Event(t, { bubbles: true })));
  };

  // 항목 이름(택배사·발송일·업로드 파일) 옆의 입력칸들. 이름이 든 줄에서 가장 가까운 입력칸을 찾는다.
  const fieldsNear = (labelRe) => {
    const label = findAll(labelRe).find((el) => !el.closest('table'));
    if (!label) return [];
    let box = label;
    for (let i = 0; i < 5 && box; i++) {
      const found = Array.from(box.querySelectorAll('input:not([type="hidden"]), select')).filter((x) => x.type === 'file' || visible(x));
      if (found.length) return found;
      box = box.parentElement;
    }
    return [];
  };

  // ---- 진행 패널(오른쪽 아래) ----
  let panel = null;
  const render = (p) => {
    if (!p || (p.windowId && myWindowId && p.windowId !== myWindowId) || Date.now() - (p.savedAt || 0) > MAX_AGE_MS * 3) {
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
      `<div style="font-weight:700;margin-bottom:4px">📤 쉽먼트 일괄등록 업로드</div>` +
      `<div style="color:#64748b;font-size:12px">${p.batchId || ''} · 발송일 ${p.shipDate || ''} ${p.shipTime || ''}</div>` +
      `<div style="margin-top:6px;color:${color}">${p.status || ''}</div>${msgs}` +
      `<div style="margin-top:8px;text-align:right">` +
      (p.step === 'error' && onBulkPages() ? `<button data-act="retry" style="margin-right:6px;border:1px solid #bfdbfe;background:#eff6ff;color:#1d4ed8;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:12px">번호 다시 찾기</button>` : '') +
      `<button data-act="stop" style="border:1px solid #fecaca;background:#fff1f2;color:#b91c1c;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:12px">멈춤</button></div>`;
    panel.onclick = (e) => {
      // 등록은 됐는데 번호를 못 읽고 멈췄을 때: 내역 조회 맨 윗줄부터 다시 읽는다(업로드는 다시 안 한다).
      if (e.target && e.target.getAttribute && e.target.getAttribute('data-act') === 'retry') {
        patch({ step: 'submitted', submittedAt: Date.now(), resultAt: 0, status: '내역 조회에서 다시 찾는 중…' });
        return;
      }
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
    if (!p || (p.windowId && myWindowId && p.windowId !== myWindowId)) return;
    await patch({ messages: [...(p.messages || []), d.text].slice(-6) });
  });

  // 업로드 화면인지: 파일 칸과 "업로드 파일" 항목이 보이면.
  const onUploadPage = () => !!document.querySelector('input[type="file"]') && findAll(/^업로드\s*파일$/).length > 0;
  // 일괄등록 화면들(업로드·내역 조회 등)의 주소. 화면이 다 그려지기 전이라도 여기서는 다른 화면으로 떠나지 않는다.
  const onBulkPages = () => /\/bulk-creation/.test(location.pathname);
  // "일괄 등록 옵션 선택" 창이 떠 있는지.
  const optionModalOpen = () => findAll(/일괄\s*등록\s*옵션\s*선택/).length > 0;

  const dataUrlToFile = (dataUrl, name) => {
    const [head, body] = dataUrl.split(',');
    const mime = (/data:([^;]+)/.exec(head) || [])[1] || 'application/octet-stream';
    const bin = atob(body);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], name, { type: mime });
  };

  // 택배사를 롯데택배로. 서허는 숨은 <select>에 Chosen(검색되는 선택 상자)을 씌워 쓴다.
  // 보이는 검색칸에 글자만 넣으면 실제 선택은 안 되므로, 숨은 select의 값을 바꾸고 Chosen에 다시 그리라고 알린다.
  // 그래도 안 바뀌면 Chosen 목록을 열어 항목을 직접 누른다.
  const carrierSelect = () => {
    const label = findAll(/^택배사$/).find((el) => !el.closest('table'));
    let box = label;
    for (let i = 0; i < 6 && box; i++) {
      const sel = box.querySelector('select');
      if (sel) return sel;
      box = box.parentElement;
    }
    return null;
  };
  const selectedText = (sel) => (sel && sel.selectedIndex >= 0 ? clean(sel.options[sel.selectedIndex].textContent) : '');
  const setCarrier = async (want) => {
    const sel = carrierSelect();
    if (!sel) return { ok: false, why: '택배사 선택 상자를 못 찾았어요' };
    const options = Array.from(sel.options).map((o) => clean(o.textContent));
    const opt = Array.from(sel.options).find((o) => clean(o.textContent).includes(want));
    if (!opt) return { ok: false, why: `택배사 목록에 ${want}이 없어요`, options };
    setValue(sel, opt.value);
    sel.dispatchEvent(new Event('chosen:updated', { bubbles: true }));
    await sleep(400);
    if (!selectedText(sel).includes(want)) {
      // Chosen 목록을 열고 그 항목을 누른다.
      const chosen = sel.nextElementSibling && /chosen-container/.test(sel.nextElementSibling.className) ? sel.nextElementSibling : null;
      const head = chosen && chosen.querySelector('.chosen-single, .chosen-choices');
      if (head) {
        realClick(head);
        await sleep(400);
        const item = Array.from(chosen.querySelectorAll('li.active-result')).find((li) => clean(li.textContent).includes(want));
        if (item) {
          ['mouseover', 'mousedown', 'mouseup', 'click'].forEach((t) => item.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })));
          await sleep(400);
        }
      }
    }
    const now = selectedText(sel);
    return now.includes(want) ? { ok: true } : { ok: false, why: `택배사가 ${want}로 안 바뀌었어요(지금: ${now || '빈칸'})`, options };
  };

  const fieldInfo = (el) => ({
    tag: el.tagName, type: el.type, name: el.name, id: el.id, cls: String(el.className || '').slice(0, 80),
    placeholder: el.placeholder, value: el.type === 'file' ? (el.files && el.files.length ? el.files[0].name : '') : el.value, readOnly: el.readOnly,
  });

  // ---- 표 읽기 ----
  // 제목 줄(th)의 글자로 칸 번호를 찾고, 그 아래 줄들을 [칸 글자들, 줄 요소]로 돌려준다.
  const readTable = (headRes) => {
    for (const table of document.querySelectorAll('table')) {
      if (!visible(table)) continue;
      const heads = Array.from(table.querySelectorAll('thead th, tr:first-child th')).map((th) => clean(th.textContent));
      if (!heads.length) continue;
      const idx = {};
      let ok = true;
      for (const [k, re] of Object.entries(headRes)) {
        idx[k] = heads.findIndex((h) => re.test(h));
        if (idx[k] < 0) ok = false;
      }
      if (!ok) continue;
      const rows = Array.from(table.querySelectorAll('tbody tr'))
        .filter((tr) => tr.querySelectorAll('td').length >= heads.length - 1)
        .map((tr) => ({ tr, cells: Array.from(tr.querySelectorAll('td')).map((td) => clean(td.textContent)) }));
      return { idx, rows };
    }
    return null;
  };
  const clickSearch = () => {
    const btn = findAll(/^검색$/).map(clickable).filter((el) => !el.closest('table')).pop();
    if (btn) realClick(btn);
    return !!btn;
  };
  // 떠 있는 창(모달)의 글자. 실패 사유를 읽을 때 쓴다.
  const modalText = () => {
    const box = Array.from(document.querySelectorAll('[role="dialog"], .modal-content, .modal, .popup, .layer'))
      .filter(visible)
      .pop();
    return box ? clean(box.textContent).slice(0, 400) : '';
  };
  const baseName = (n) => clean(n).replace(/\s*\(\d+\)(?=\.\w+$)/, '');

  // 4) 일괄등록 내역 조회: 맨 윗줄이 방금 올린 파일인지 보고, 완료면 생성된 쉽먼트 번호들을, 실패면 사유를 읽는다.
  const readResult = async (p) => {
    const t = readTable({ status: /^상태$/, file: /업로드\s*파일명/, result: /업로드\s*결과/ });
    if (!t || !t.rows.length) return false;
    const top = t.rows[0];
    const fileName = top.cells[t.idx.file];
    const status = top.cells[t.idx.status];
    debug('result', { top: top.cells, want: p.file && p.file.name });
    if (baseName(fileName) !== baseName(p.file.name)) {
      // 아직 목록이 안 바뀌었을 수 있다. 몇 초마다 다시 검색한다.
      if (Date.now() - (p.resultAt || p.submittedAt || 0) > 5000) {
        await patch({ resultAt: Date.now(), status: `내역 조회에서 방금 올린 파일(${p.file.name})을 찾는 중… (맨 윗줄: ${fileName || '없음'})` });
        clickSearch();
      }
      if (Date.now() - (p.submittedAt || 0) > 120000) {
        await patch({ step: 'error', status: `내역 조회 맨 윗줄이 방금 올린 파일이 아니에요(맨 윗줄: ${fileName}). 이 창에서 확인해 주세요.` });
      }
      return true;
    }
    if (/실패/.test(status)) {
      const btn = Array.from(top.tr.querySelectorAll('button, a')).find((el) => /실패\s*사유/.test(clean(el.textContent)));
      let reason = '';
      if (btn) {
        realClick(btn);
        await sleep(1200);
        reason = modalText();
      }
      await patch({ step: 'error', status: `❌ 서허 일괄등록 실패${reason ? `: ${reason}` : ''}. 이 창에서 실패 사유를 확인해 주세요.` });
      return true;
    }
    if (!/완료/.test(status)) {
      if (Date.now() - (p.resultAt || 0) > 5000) {
        await patch({ resultAt: Date.now(), status: `서허가 처리 중이에요(상태: ${status || '?'}). 기다리는 중…` });
        clickSearch();
      }
      return true;
    }
    const btn = Array.from(top.tr.querySelectorAll('button, a')).find((el) => /생성된\s*쉽먼트/.test(clean(el.textContent)));
    if (!btn) {
      await patch({ step: 'error', status: '"생성된 쉽먼트 조회" 버튼을 못 찾았어요. 이 창에서 확인해 주세요.' });
      return true;
    }
    realClick(btn);
    // 목록은 누르고 1초쯤 지나야 뜬다. 최대 8초까지 0.4초마다 본다.
    const readNums = () => Array.from(new Set(
      Array.from(document.querySelectorAll('body *'))
        .filter((el) => visible(el) && !el.children.length)
        .map((el) => (/^쉽먼트\s*(\d{6,})$/.exec(clean(el.textContent)) || [])[1])
        .filter(Boolean)
    ));
    let nums = [];
    for (let i = 0; i < 20 && !nums.length; i++) {
      await sleep(400);
      nums = readNums();
    }
    debug('shipments', { nums });
    if (!nums.length) {
      await patch({ step: 'error', status: '생성된 쉽먼트 번호를 못 읽었어요. 이 창에서 "생성된 쉽먼트 조회"를 눌러 확인해 주세요.' });
      return true;
    }
    await patch({ step: 'linking', shipments: nums, linkIdx: 0, byOrder: {}, status: `쉽먼트 ${nums.join(', ')} 생성됨. 발주서별 쉽먼트 번호 찾는 중…` });
    location.href = ASN_URL;
    return true;
  };

  // 5) 택배 쉽먼트 화면에서 발주 번호로 하나씩 검색해, 방금 생성된 쉽먼트 중 그 발주서가 든 쉽먼트 번호를 찾는다.
  const linkOrders = async (p) => {
    const orderNos = p.orderNos || [];
    const i = p.linkIdx || 0;
    if (i >= orderNos.length) {
      const found = Object.values(p.byOrder || {}).filter(Boolean).length;
      await patch({ step: 'done', status: `✅ 등록 완료 · 발주서 ${found}/${orderNos.length}건에 쉽먼트 번호를 적었어요.` });
      return;
    }
    const no = orderNos[i];
    const input = fieldsNear(/^발주\s*번호$/).find((f) => f.tagName === 'INPUT');
    if (!input) {
      if (Date.now() - (p.savedAt || 0) > 20000) await patch({ step: 'error', status: '택배 쉽먼트 화면에서 "발주 번호" 칸을 못 찾았어요.' });
      return;
    }
    if (p.searching !== no) {
      setValue(input, no);
      await sleep(300);
      clickSearch();
      await patch({ searching: no, searchedAt: Date.now(), status: `발주서 ${no} 쉽먼트 번호 찾는 중… (${i + 1}/${orderNos.length})` });
      return;
    }
    if (Date.now() - (p.searchedAt || 0) < 2500) return;
    const t = readTable({ ship: /쉽먼트\s*번호/, po: /^발주서$/ });
    const ships = new Set(p.shipments || []);
    const hit = t && t.rows.find((r) => ships.has(r.cells[t.idx.ship]) && r.cells[t.idx.po].includes(no));
    const any = t && t.rows.find((r) => ships.has(r.cells[t.idx.ship]));
    const ship = (hit || any) ? (hit || any).cells[t.idx.ship] : '';
    debug('link', { no, ship, rows: t ? t.rows.slice(0, 5).map((r) => r.cells) : null });
    await patch({ byOrder: { ...(p.byOrder || {}), [no]: ship }, linkIdx: i + 1, searching: '' });
  };

  let busy = false;
  let lastNav = 0;
  const tick = async () => {
    if (busy) return;
    const p = await get();
    render(p);
    if (!p || DONE.includes(p.step)) return;
    if (Date.now() - (p.savedAt || 0) > MAX_AGE_MS) return;
    if (p.windowId && myWindowId && p.windowId !== myWindowId) return;
    if (!p.windowId || !myWindowId) return; // 확장이 연 창인지 확인된 뒤에만 움직인다.
    busy = true;
    try {
      if (document.querySelector('input[type="password"]')) {
        await patch({ status: '서허 로그인 중이에요. 로그인하면 이어서 진행해요.' });
        return;
      }

      // 발주서별 쉽먼트 번호 찾기(택배 쉽먼트 화면).
      if (p.step === 'linking') {
        if (location.pathname.startsWith('/ibs/asn') && !onUploadPage()) await linkOrders(p);
        else if (Date.now() - lastNav > 8000) { lastNav = Date.now(); location.href = ASN_URL; }
        return;
      }
      // 누른 뒤: 일괄등록 내역 조회 화면이 나오면 결과를 읽는다.
      if (p.step === 'submitted') {
        if (await readResult(p)) return;
        if (onUploadPage() && Date.now() - (p.submittedAt || 0) > 30000) {
          await patch({ step: 'error', status: '"쉽먼트 일괄등록"을 눌렀는데 내역 조회 화면으로 안 넘어갔어요. 이 창에서 확인해 주세요.' });
        }
        return;
      }

      // 3) 업로드 화면: 칸을 채우고 파일을 넣은 뒤 "쉽먼트 일괄등록"을 누른다.
      if (onUploadPage()) {
        if (!p.filled) {
          await patch({ step: 'filling', status: '업로드 화면 채우는 중…' });
          const carrier = await setCarrier(p.carrier || '롯데택배');
          const dates = fieldsNear(/^발송일$/).filter((f) => f.tagName === 'INPUT');
          if (dates[0]) setValue(dates[0], p.shipDate);
          if (dates[1]) setValue(dates[1], p.shipTime || '23:55');
          await sleep(300);
          const fileInput = document.querySelector('input[type="file"]');
          const file = dataUrlToFile(p.file.dataUrl, p.file.name || '쉽먼트양식.xlsx');
          const dt = new DataTransfer();
          dt.items.add(file);
          fileInput.files = dt.files;
          fileInput.dispatchEvent(new Event('input', { bubbles: true }));
          fileInput.dispatchEvent(new Event('change', { bubbles: true }));
          await sleep(800);
          const problems = [];
          if (!carrier.ok) problems.push(carrier.why);
          if (!dates[0] || clean(dates[0].value) !== p.shipDate) problems.push(`발송일이 ${p.shipDate}로 안 들어갔어요(지금: ${dates[0] ? dates[0].value || '빈칸' : '칸 없음'})`);
          if (!dates[1] || !clean(dates[1].value).startsWith((p.shipTime || '23:55').slice(0, 5))) problems.push(`시간이 ${p.shipTime || '23:55'}로 안 들어갔어요(지금: ${dates[1] ? dates[1].value || '빈칸' : '칸 없음'})`);
          if (!fileInput.files || !fileInput.files.length) problems.push('업로드 파일이 안 들어갔어요');
          debug('filled', {
            carrier, problems,
            fields: Array.from(document.querySelectorAll('input:not([type="hidden"]), select, button')).filter((x) => x.type === 'file' || visible(x)).slice(0, 40).map(fieldInfo),
            carrierOptions: carrier.options,
          });
          if (problems.length) {
            await patch({ step: 'error', status: `자동으로 다 채우지 못했어요: ${problems.join(' / ')}. 이 창에서 직접 고친 뒤 "쉽먼트 일괄등록"을 눌러 주세요.` });
            return;
          }
          await patch({ filled: true, status: '다 채웠어요. "쉽먼트 일괄등록" 누르는 중…' });
          return;
        }
        // 화면 맨 아래 파란 "쉽먼트 일괄등록"(위 메뉴의 같은 이름 버튼과 헷갈리지 않게 파일 칸보다 아래 것).
        const fileTop = document.querySelector('input[type="file"]').getBoundingClientRect().top;
        const btn = findAll(/^쉽먼트\s*일괄\s*등록$/)
          .map(clickable)
          .filter((el) => el.getBoundingClientRect().top > fileTop)
          .pop();
        if (!btn) {
          await patch({ step: 'error', status: '"쉽먼트 일괄등록" 버튼을 못 찾았어요. 직접 눌러 주세요.' });
          return;
        }
        if (btn.disabled) {
          await patch({ status: '"쉽먼트 일괄등록" 버튼이 아직 꺼져 있어요. 기다리는 중…' });
          if (Date.now() - (p.savedAt || 0) > 20000) await patch({ step: 'error', status: '"쉽먼트 일괄등록" 버튼이 켜지지 않아요. 칸을 확인하고 직접 눌러 주세요.' });
          return;
        }
        try { sessionStorage.setItem(ARM, String(Date.now())); } catch (err) {}
        await patch({ step: 'submitted', submittedAt: Date.now(), status: '"쉽먼트 일괄등록"을 눌렀어요. 결과 기다리는 중…' });
        realClick(btn);
        return;
      }

      // 일괄등록 화면인데 아직 칸이 안 그려졌으면 기다린다(떠나면 화면이 왔다갔다 한다).
      if (onBulkPages()) {
        if (!['filling', 'upload-clicked'].includes(p.step)) await patch({ step: 'upload-clicked', status: '업로드 화면 기다리는 중…' });
        return;
      }

      // 2) "일괄 등록 옵션 선택" 창이 떠 있으면 "일괄등록 양식 업로드".
      if (optionModalOpen()) {
        const upload = findAll(/일괄\s*등록\s*양식\s*업로드/).map(clickable)[0];
        if (upload && Date.now() - lastNav > 3000) {
          lastNav = Date.now();
          await patch({ step: 'upload-clicked', status: '"일괄등록 양식 업로드" 여는 중…' });
          realClick(upload);
        }
        return;
      }

      // 1) 택배 쉽먼트 화면의 "쉽먼트 일괄등록"(창을 띄운다).
      if (location.pathname.startsWith('/ibs/asn')) {
        const opener = findAll(/^쉽먼트\s*일괄\s*등록$/).map(clickable)[0];
        // 업로드를 누른 뒤 화면이 넘어가는 중이면 다시 누르지 않는다.
        if (p.step === 'upload-clicked' && Date.now() - (p.savedAt || 0) < 8000) return;
        if (opener && Date.now() - lastNav > 4000) {
          lastNav = Date.now();
          await patch({ step: 'open', status: '"쉽먼트 일괄등록" 누르는 중…' });
          realClick(opener);
        }
        if (p.step === 'upload-clicked' && Date.now() - (p.savedAt || 0) > 8000) await patch({ step: 'open' });
        return;
      }

      // 다른 화면이면 택배 쉽먼트 화면으로 간다.
      if (Date.now() - lastNav > 8000) {
        lastNav = Date.now();
        await patch({ step: 'nav', status: '택배 쉽먼트 화면 여는 중…' });
        location.href = ASN_URL;
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
  tick();
})();
