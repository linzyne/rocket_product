// 서허 입고예정일·센터 변경 요청 화면(/plan/ticket/reportIssue/CHANGE_PO_INBOUND_DATE_AND_FC)에 발주서 넣기.
// 앱의 발주 진행에서 발주서를 골라 "날짜 바꾸기"를 누르면 background.js가 이 화면을 새 창으로 열고, 여기서
//   발주서번호 하나 검색 → 결과 줄 맨 왼쪽 "+추가" 누르기
// 를 고른 발주서마다 한 번씩 되풀이한다(검색은 한 번에 하나만 된다). 다 넣으면 맨 아래 "계속하기"까지 누르고 멈춘다(날짜는 사람이 고른다).
// 화면에서 무엇을 찾았는지는 poDateDebug에 남긴다(안 될 때 고치려고).
(() => {
  if (window.__rocketPoDateInjected) return;
  window.__rocketPoDateInjected = true;
  if (window !== window.top) return;

  const KEY = 'poDateChange';
  const DEBUG_KEY = 'poDateDebug';
  const URL_PATH = '/plan/ticket/reportIssue/CHANGE_PO_INBOUND_DATE_AND_FC';
  const PAGE_URL = 'https://supplier.coupang.com' + URL_PATH;
  const MAX_AGE_MS = 15 * 60 * 1000;
  const WAIT_RESULT_MS = 15000;

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
  const realClick = (el) => {
    const target = el.closest('a,button,label,[role="button"],[onclick]') || el;
    const opts = { bubbles: true, cancelable: true, view: window };
    ['pointerover', 'mouseover', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((type) => {
      const Ev = type.startsWith('pointer') && window.PointerEvent ? PointerEvent : MouseEvent;
      target.dispatchEvent(new Ev(type, opts));
    });
  };
  const setInput = (el, value) => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    try { Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value); } catch (err) { el.value = value; }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const pressEnter = (el) => {
    ['keydown', 'keypress', 'keyup'].forEach((t) => el.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true })));
  };

  // 발주서번호 검색칸: 이름·안내글에 "발주"가 든 칸, 없으면 화면에 보이는 첫 글자칸.
  const textInputs = () =>
    Array.from(document.querySelectorAll('input:not([type]), input[type="text"], input[type="search"], input[type="number"], textarea'))
      .filter((el) => visible(el) && !el.disabled && !el.readOnly && !(panel && panel.contains(el)));
  const labelOf = (el) => {
    const bits = [el.placeholder, el.name, el.id, el.getAttribute('aria-label')];
    let box = el.parentElement;
    for (let i = 0; i < 3 && box; i++) { bits.push(clean(box.textContent).slice(0, 60)); box = box.parentElement; }
    return bits.filter(Boolean).join(' ');
  };
  const searchInput = () => {
    const list = textInputs();
    return list.find((el) => /발주\s*(서)?\s*(번호|no)|po\s*(no|number)/i.test(labelOf(el))) || list[0] || null;
  };
  const searchButton = (input) => {
    let box = input;
    for (let i = 0; i < 5 && box; i++) {
      const btn = Array.from(box.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]'))
        .find((b) => visible(b) && /^(검색|조회|search)$/i.test(clean(b.value || b.textContent)));
      if (btn) return btn;
      box = box.parentElement;
    }
    return Array.from(document.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]'))
      .find((b) => visible(b) && /^(검색|조회)$/.test(clean(b.value || b.textContent))) || null;
  };
  // 결과에서 이 발주번호가 든 줄과 그 줄의 "+추가" 단추.
  const addButtonFor = (no) => {
    const rows = Array.from(document.querySelectorAll('tr, [role="row"], li'))
      .filter((r) => visible(r) && !(panel && panel.contains(r)) && clean(r.textContent).includes(no));
    for (const r of rows) {
      const btn = Array.from(r.querySelectorAll('button, a, [role="button"], span, div'))
        .find((b) => visible(b) && /^\+?\s*추가$/.test(clean(b.textContent)) && !b.querySelector('button'));
      if (btn) return { row: r, btn };
    }
    return { row: rows[0] || null, btn: null };
  };

  // ---- 진행 패널(오른쪽 아래) ----
  let panel = null;
  const render = (p) => {
    if (!p || Date.now() - (p.savedAt || 0) > MAX_AGE_MS * 2 || (p.windowId && myWindowId && p.windowId !== myWindowId)) {
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
    const nos = p.orderNos || [];
    const list = nos.map((no) => {
      const mark = (p.added || []).includes(no) ? '✅' : (p.failed || []).includes(no) ? '❌' : no === nos[p.idx || 0] && p.step !== 'done' ? '⏳' : '·';
      return `<span style="margin-right:6px;white-space:nowrap">${mark} ${no}</span>`;
    }).join('');
    panel.innerHTML =
      `<div style="font-weight:700;margin-bottom:4px">📅 입고일 변경 요청에 발주서 넣기</div>` +
      `<div style="font-size:12px;color:#475569;line-height:1.6">${list}</div>` +
      `<div style="margin-top:6px;color:${color}">${p.status || ''}</div>` +
      `<div style="margin-top:8px;text-align:right"><button data-act="stop" style="border:1px solid #fecaca;background:#fff1f2;color:#b91c1c;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:12px">${p.step === 'done' || p.step === 'error' ? '닫기' : '멈춤'}</button></div>`;
    panel.onclick = (e) => {
      if (e.target && e.target.getAttribute && e.target.getAttribute('data-act') === 'stop') {
        try { chrome.storage.local.remove(KEY); } catch (err) {}
        panel.style.display = 'none';
      }
    };
  };

  let busy = false;
  let lastNav = 0;
  const tick = async () => {
    if (busy) return;
    const p = await get();
    render(p);
    if (!p || ['done', 'error'].includes(p.step)) return;
    if (Date.now() - (p.savedAt || 0) > MAX_AGE_MS) return;
    if (!p.windowId || !myWindowId || p.windowId !== myWindowId) return; // 확장이 연 창에서만
    busy = true;
    try {
      if (document.querySelector('input[type="password"]')) {
        await patch({ status: '서허 로그인 중이에요. 로그인하면 이어서 진행해요.' });
        return;
      }
      if (!location.pathname.startsWith(URL_PATH)) {
        if (Date.now() - lastNav > 8000) {
          lastNav = Date.now();
          await patch({ status: '입고일 변경 화면 여는 중…' });
          location.href = PAGE_URL;
        }
        return;
      }
      const nos = p.orderNos || [];
      const idx = p.idx || 0;
      if (idx >= nos.length) {
        const added = (p.added || []).length;
        const failed = p.failed || [];
        const tail = failed.length ? ` 못 넣은 것: ${failed.join(', ')}.` : '';
        if (!added) {
          await patch({ step: 'error', status: `발주서를 하나도 넣지 못해서 "계속하기"는 누르지 않았어요.${tail}` });
          return;
        }
        // 다 넣었으면 맨 아래 "계속하기"를 누른다(그 다음 날짜 고르기는 사람이 한다).
        const next = Array.from(document.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]'))
          .filter((b) => visible(b) && !(panel && panel.contains(b)) && /^계속\s*하기$/.test(clean(b.value || b.textContent)))
          .sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top)[0];
        const disabled = next && (next.disabled || next.getAttribute('aria-disabled') === 'true' || /disabled/.test(String(next.className)));
        if (!next || disabled) {
          if (!p.waitNextAt) { await patch({ waitNextAt: Date.now(), status: `발주서 ${added}건을 넣었어요. "계속하기" 기다리는 중…` }); return; }
          if (Date.now() - p.waitNextAt > 10000) {
            debug('no-next', { found: !!next, disabled: !!disabled });
            await patch({ step: 'done', status: `✅ 발주서 ${added}건을 넣었어요.${tail} "계속하기"를 ${next ? '누를 수 없어서' : '못 찾아서'} 그대로 뒀어요. 직접 눌러 주세요.` });
          }
          return;
        }
        realClick(next);
        await patch({ step: 'done', status: `✅ 발주서 ${added}건을 넣고 "계속하기"를 눌렀어요.${tail} 이제 날짜를 골라 요청해 주세요.` });
        return;
      }
      const no = nos[idx];
      const input = searchInput();
      if (!input) {
        if (Date.now() - (p.startedAt || p.savedAt || 0) > 20000) {
          debug('no-input', { inputs: textInputs().map(labelOf).slice(0, 10) });
          await patch({ step: 'error', status: '발주서번호 검색칸을 못 찾았어요. 이 창에서 직접 검색해 주세요.' });
        }
        return;
      }

      // 1) 검색
      if (p.phase !== 'wait' || p.searchingNo !== no) {
        setInput(input, no);
        await sleep(200);
        const btn = searchButton(input);
        if (btn) realClick(btn); else pressEnter(input);
        await patch({ phase: 'wait', searchingNo: no, searchedAt: Date.now(), status: `${no} 검색 중… (${idx + 1}/${nos.length})` });
        return;
      }

      // 2) 결과에서 "+추가"
      const { row, btn } = addButtonFor(no);
      if (btn) {
        realClick(btn);
        await sleep(800);
        await patch({ added: [...(p.added || []), no], idx: idx + 1, phase: 'search', status: `${no} 추가했어요 (${idx + 1}/${nos.length})` });
        return;
      }
      if (Date.now() - (p.searchedAt || 0) > WAIT_RESULT_MS) {
        debug('no-add', { no, row: row ? clean(row.textContent).slice(0, 200) : null, body: clean(document.body.textContent).slice(0, 400) });
        await patch({
          failed: [...(p.failed || []), no], idx: idx + 1, phase: 'search',
          status: `${no}의 "+추가"를 못 찾았어요(검색 결과가 없거나 이미 넣었을 수 있어요). 다음으로 넘어가요.`,
        });
      }
    } catch (err) {
      await patch({ step: 'error', status: `진행 중 오류: ${String((err && err.message) || err)}` });
    } finally {
      busy = false;
    }
  };

  // ---- 요청 내용 기억하기 ----
  // "요청 내용 입력/수정" 표에서 발주서마다 "변경 납품센터"·"변경 입고예정일"을 읽어 둔다. "요청 등록"을 누르는 순간의 값을
  // poDateRequested에 적어 두면, 앱의 "적용"이 서허를 다시 읽지 않고 이 값으로 바꾼다. 이 화면을 사람이 직접 열었어도 기억한다.
  const REQ_KEY = 'poDateRequested';
  const readRequestTable = () => {
    for (const table of document.querySelectorAll('table')) {
      if (!visible(table)) continue;
      const heads = Array.from(table.querySelectorAll('thead th, thead td')).map((x) => clean(x.textContent));
      const iNo = heads.findIndex((h) => /발주\s*번호/.test(h));
      const iCenter = heads.findIndex((h) => /변경\s*납품\s*센터/.test(h));
      const iDate = heads.findIndex((h) => /변경\s*입고\s*예정일/.test(h));
      if (iNo < 0 || (iCenter < 0 && iDate < 0)) continue;
      const out = {};
      for (const tr of table.querySelectorAll('tbody tr')) {
        const tds = Array.from(tr.querySelectorAll('td'));
        const cellVal = (i) => {
          if (i < 0 || !tds[i]) return '';
          const input = tds[i].querySelector('input, select, textarea');
          return clean(input ? input.value : tds[i].textContent);
        };
        const no = (cellVal(iNo).match(/\d{8,12}/) || [])[0];
        if (!no) continue;
        const center = cellVal(iCenter);
        const dm = /(\d{4})[-./]?\s*(\d{1,2})[-./]?\s*(\d{1,2})/.exec(cellVal(iDate));
        const date = dm ? `${dm[1]}-${dm[2].padStart(2, '0')}-${dm[3].padStart(2, '0')}` : '';
        if (center || date) out[no] = { center, date };
      }
      return out;
    }
    return null;
  };
  // 화면에서 계속 읽어 두고(누르는 순간 표가 사라질 수 있어서), "요청 등록"을 누르면 그때 값을 기억한다.
  let draft = {};
  // 서허는 화면을 새로 불러오지 않고 주소만 바꾸기도 해서, 늘 걸어 두고 이 화면일 때만 움직인다.
  const onRequestPage = () => location.pathname.startsWith('/plan/ticket/reportIssue');
  {
    setInterval(() => {
      if (!onRequestPage()) return;
      const t = readRequestTable();
      if (t && Object.keys(t).length) draft = t;
    }, 800);
    document.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest && e.target.closest('button, a, [role="button"], input[type="button"], input[type="submit"]');
      if (!onRequestPage() || !btn || (panel && panel.contains(btn))) return;
      const label = clean(btn.value || btn.textContent).replace(/\s+/g, '');
      if (!/^(요청등록|등록|요청하기|요청|제출|저장)$/.test(label)) return;
      const now = readRequestTable() || draft;
      if (!now || !Object.keys(now).length) return;
      try {
        chrome.storage.local.get(REQ_KEY, (r) => {
          const prev = (r && r[REQ_KEY]) || {};
          const at = Date.now();
          const next = { ...prev };
          Object.entries(now).forEach(([no, v]) => { next[no] = { ...v, at }; });
          chrome.storage.local.set({ [REQ_KEY]: next });
          debug('requested', { label, count: Object.keys(now).length, now });
        });
      } catch (err) {}
    }, true);
  }

  setInterval(tick, 1200);
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[KEY]) render(changes[KEY].newValue || null);
    });
  } catch (err) {}
})();
