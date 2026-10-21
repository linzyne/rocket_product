// 8282한중무역 구매대행 신청서(STEP 04 상품 정보)에 1688에서 담은 주문을 채운다.
// 담은 주문은 1688 주문목록 화면(order-list.js)에서 저장한 것(chrome.storage.local rocket1688Basket).
//
// 상품 하나 = 신청서의 상품#칸 하나. 칸이 모자라면 "+상품추가"를 눌러 늘린다.
//  · 통관품목: 두 칸 모두 "영문…"이 들어간 항목을 고른다(영문입력 직접기재).
//  · 상품명(영문)·마켓등록상품명: 1688 중국어 상품명을 그대로 넣는다.
//  · 트래킹: 택배사는 이름으로 목록에서 찾고, 못 찾으면 빨갛게 표시한다. 직접 고르면 다음부터 기억한다.
//    운송장이 없으면 "트래킹번호 나중에 입력"을 체크한다.
//  · 오더번호·단가·수량·색상(옵션)·상품 URL·이미지 URL.
// 칸 이름(name)을 아는 것은 이름으로, 모르는 것(트래킹·마켓등록상품명·통관품목)은 왼쪽 제목 글자로 찾는다.
(() => {
  if (window.__rocket8282Injected) return;
  window.__rocket8282Injected = true;

  const BASKET_KEY = 'rocket1688Basket';
  const COURIER_KEY = 'rocket8282Couriers';
  const PANEL_OPEN_KEY = 'rocket8282PanelOpen';
  const BLOCK_SEL = '[id^="TextProduct"]';

  const extOk = () => !!(chrome.runtime && chrome.runtime.id);
  const storageGet = (key) =>
    new Promise((resolve) => {
      if (!extOk()) return resolve(undefined);
      try {
        chrome.storage.local.get(key, (r) => resolve(chrome.runtime.lastError ? undefined : r && r[key]));
      } catch (err) {
        resolve(undefined);
      }
    });
  const storageSet = (key, value) =>
    new Promise((resolve, reject) => {
      if (!extOk()) return reject(new Error('확장이 새로 설치됐어요. 이 페이지를 새로고침해 주세요.'));
      chrome.storage.local.set({ [key]: value }, () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      });
    });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, timeout = 4000, step = 100) => {
    const end = Date.now() + timeout;
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() > end) return null;
      await sleep(step);
    }
  };

  // 페이지 함수 부르기(8282-main.js가 대신 부른다).
  let callSeq = 0;
  const callPage = (fn, args = []) =>
    new Promise((resolve) => {
      const id = `c${Date.now()}_${callSeq++}`;
      const onMsg = (e) => {
        const d = e.data;
        if (e.source !== window || !d || d.source !== 'rocket-8282-main' || d.id !== id) return;
        window.removeEventListener('message', onMsg);
        clearTimeout(timer);
        resolve(d);
      };
      const timer = setTimeout(() => {
        window.removeEventListener('message', onMsg);
        resolve({ ok: false, error: '응답 없음' });
      }, 3000);
      window.addEventListener('message', onMsg);
      window.postMessage({ source: 'rocket-8282', type: 'CALL', id, fn, args }, window.location.origin);
    });

  // ───────── 칸 찾기·채우기 ─────────
  const blocks = () => Array.from(document.querySelectorAll(BLOCK_SEL)).filter((b) => b.querySelector('[name="SHOP_ORD_NO"], [name="COST"]'));
  const byName = (block, name) => block.querySelector(`[name="${name}"]`);
  const fire = (el, types) => types.forEach((t) => el.dispatchEvent(new Event(t, { bubbles: true })));
  const setVal = (el, value) => {
    if (!el) return false;
    el.value = String(value == null ? '' : value);
    fire(el, ['input', 'change']);
    el.dispatchEvent(new Event('blur'));
    return true;
  };
  const isEmptyBlock = (b) => ['SHOP_ORD_NO', 'COST', 'PRO_URL', 'IMG_URL'].every((n) => !((byName(b, n) || {}).value || '').trim());
  const norm = (s) => String(s || '').replace(/\s+/g, '');

  // 왼쪽 제목 글자(예: "트래킹번호")로 그 줄(tr)을 찾는다.
  const rowFor = (block, re) => {
    const cells = Array.from(block.querySelectorAll('th, td'));
    for (const c of cells) {
      if (c.querySelector('input, select, textarea')) continue;
      if (re.test(norm(c.textContent))) return c.closest('tr') || c.parentElement;
    }
    return null;
  };
  const textInputs = (row) =>
    Array.from(row.querySelectorAll('input')).filter((i) => !i.type || ['text', 'search', ''].includes(i.type.toLowerCase()));
  const mark = (el, bad) => {
    if (!el) return;
    el.style.outline = bad ? '3px solid #ff3511' : '';
    el.style.outlineOffset = bad ? '1px' : '';
  };

  // 통관품목: 칸마다 "영문"이 들어간 항목을 고른다. 두 번째 칸은 첫 칸을 고르면 새로 채워지므로 기다린다.
  const fillCategory = async (block) => {
    const row = rowFor(block, /통관품목/);
    const arc = byName(block, 'ARC_SEQ');
    const selectsNow = () => {
      const list = row ? Array.from(row.querySelectorAll('select')) : [];
      if (arc && !list.includes(arc)) list.push(arc);
      return list;
    };
    if (!selectsNow().length) return '통관품목 칸을 못 찾았어요';
    const pick = (sel) => Array.from(sel.options).find((o) => o.value && /영문/.test(o.textContent));
    for (let k = 0; k < 4; k++) {
      const list = selectsNow();
      if (k >= list.length) break;
      const sel = list[k];
      const opt = await waitFor(() => pick(sel), k === 0 ? 1500 : 3000);
      if (opt) {
        if (sel.value !== opt.value) {
          sel.value = opt.value;
          fire(sel, ['change']);
          // 첫 칸을 고르면 다음 칸 목록이 새로 채워지므로, 다음 칸에 "영문" 항목이 생길 때까지 잠깐 기다린다.
          if (k === 0) await waitFor(() => selectsNow().length > 1 && pick(selectsNow()[1]), 2500);
          else await sleep(200);
        }
      } else if (sel === arc && Array.from(sel.options).some((o) => o.value === '115')) {
        sel.value = '115';
        fire(sel, ['change']);
        await sleep(300);
      }
    }
    const visible = selectsNow().filter((s) => s.offsetParent !== null);
    const empty = visible.filter((s) => !s.value);
    // 보이는 칸이 모두 "영문…"으로 골라졌으면 끝이다. ARC_SEQ는 "영문 직접기재"를 고르면 숨겨지거나 비어 있는 칸이라
    // 그것만 보고 "못 골랐다"고 하면 안 된다(10/21: 잘 골랐는데 못 골랐다고 나옴).
    const allEnglish = visible.length > 0 && visible.every((s) => s.value && /영문/.test((s.options[s.selectedIndex] || {}).textContent || ''));
    const arcVisible = !!arc && arc.offsetParent !== null;
    if (!allEnglish && (arcVisible ? !arc.value : empty.length || !visible.length)) {
      (arcVisible && !arc.value ? [arc] : empty.length ? empty : visible).forEach((s) => mark(s, true));
      return '통관품목을 "영문 직접기재"로 못 골랐어요(빨간 칸을 직접 골라 주세요)';
    }
    visible.forEach((s) => mark(s, false));
    return '';
  };

  // 택배사: 기억한 짝 → 이름이 같은 것 → "快递·速递" 같은 꼬리를 뗀 이름이 들어 있는 것.
  const core = (s) =>
    norm(s)
      .replace(/(股份)?(有限)?公司$/, '')
      .replace(/(速递|快递|快运|速运|物流|快件)$/, '');
  let courierMap = {};
  const chooseCourier = (sel, company) => {
    const opts = Array.from(sel.options).filter((o) => o.value);
    const saved = courierMap[company];
    let opt = saved && opts.find((o) => o.value === saved);
    if (!opt) opt = opts.find((o) => norm(o.textContent) === norm(company));
    const c = core(company);
    if (!opt && c.length >= 2) opt = opts.find((o) => core(o.textContent) === c);
    if (!opt && c.length >= 2) opt = opts.find((o) => { const oc = core(o.textContent); return oc.length >= 2 && (oc.includes(c) || c.includes(oc)); });
    // 고친 값을 기억한다(자동으로 고른 게 틀려서 바꿔도, 못 찾아서 직접 골라도).
    if (!sel.dataset.rocketCourier) {
      sel.addEventListener('change', () => {
        const name = sel.dataset.rocketCourier;
        if (!name || !sel.value) return;
        courierMap = { ...courierMap, [name]: sel.value };
        storageSet(COURIER_KEY, courierMap).catch(() => {});
        mark(sel, false);
      });
    }
    sel.dataset.rocketCourier = company;
    if (!opt) {
      mark(sel, true);
      return false;
    }
    sel.value = opt.value;
    fire(sel, ['change']);
    mark(sel, false);
    return true;
  };

  const fillTracking = (block, idx, order) => {
    const pack = (order.packages || [])[0];
    const row = rowFor(block, /트래킹번호|TrackingNo/i);
    if (!pack) {
      const later = byName(block, 'TRACKING_NO_YN') || (row && row.querySelector('input[type="checkbox"]'));
      if (later && !later.checked) later.click();
      return '운송장이 아직 없어서 "트래킹번호 나중에 입력"을 체크했어요';
    }
    if (!row) return '트래킹번호 칸을 못 찾았어요';
    const sel = row.querySelector('select');
    const input = byName(block, 'TRACKING_NO') || textInputs(row)[0];
    const probs = [];
    if (!input) probs.push('트래킹번호 입력칸을 못 찾았어요');
    else setVal(input, pack.mailNo);
    if (sel && !chooseCourier(sel, pack.company)) probs.push(`택배사 "${pack.company}"를 목록에서 못 찾았어요(빨간 칸을 직접 고르면 다음부터 기억해요)`);
    if ((order.packages || []).length > 1) probs.push(`물류단이 ${order.packages.length}개예요. 첫 번째 운송장(${pack.mailNo})만 넣었어요`);
    return probs.join(' / ');
  };

  const fillBlock = async (block, idx, order, item) => {
    const probs = [];
    const cat = await fillCategory(block);
    if (cat) probs.push(cat);
    const set = (name, v, label) => {
      if (!setVal(byName(block, name), v)) probs.push(`${label} 칸(${name})을 못 찾았어요`);
    };
    set('SHOP_ORD_NO', order.orderId, '오더번호');
    set('PRO_NM', item.title, '상품명(영문)');
    const marketRow = rowFor(block, /마켓등록상품명/);
    const marketInput = marketRow && textInputs(marketRow)[0];
    if (marketInput) setVal(marketInput, item.title);
    else probs.push('마켓등록상품명 칸을 못 찾았어요');
    set('COST', Number(item.unitCny || 0).toFixed(2), '단가');
    set('QTY', item.qty, '수량');
    if (item.spec) set('CLR', item.spec, '색상');
    if (item.productUrl) set('PRO_URL', item.productUrl, '상품 URL');
    if (item.imageUrl) {
      set('IMG_URL', item.imageUrl, '이미지 URL');
      await callPage('fnImgChg', [String(idx + 1)]);
    }
    const trk = fillTracking(block, idx, order);
    if (trk) probs.push(trk);
    return probs;
  };

  // "+상품추가"를 눌러 칸을 하나 늘린다. 안 되면 페이지 함수를 직접 부른다.
  const addBlock = async () => {
    const before = blocks().length;
    const btns = Array.from(document.querySelectorAll('a, button, input[type="button"], span, div'))
      .filter((el) => /상품추가/.test(norm(el.value || el.textContent)) && norm(el.value || el.textContent).length <= 10);
    const last = btns[btns.length - 1];
    if (last) last.click();
    let ok = await waitFor(() => blocks().length > before, 4000);
    if (!ok) {
      await callPage('fnProPlus', ['1']);
      ok = await waitFor(() => blocks().length > before, 4000);
    }
    return !!ok;
  };

  // ───────── 상태·창 ─────────
  let basket = {};
  const picked = new Set();
  let open = true;
  let busy = false;
  let result = null; // { lines: [{label, probs}], summary }
  let pickedInit = false;

  // 상품마다 8282에 넣었는지(used8282At) 따로 본다. 예전 방식(주문에 표시)도 읽는다.
  const itemsOf = (o) => (o.items || []).map((it, i) => (it.idx == null ? { ...it, idx: i } : it));
  const pendingItems = (o) => (o.used8282At ? [] : itemsOf(o).filter((it) => !it.used8282At));
  const isDone = (o) => !pendingItems(o).length;
  const sortedOrders = () =>
    Object.values(basket).sort((a, b) => {
      if (isDone(a) !== isDone(b)) return isDone(a) ? 1 : -1;
      return String(a.orderTime || '').localeCompare(String(b.orderTime || ''));
    });

  const fill = async () => {
    if (busy) return;
    // 고른 주문에서 아직 8282에 안 넣은 상품만 넣는다(다 넣은 주문을 고르면 전부 다시 넣는다).
    const list = sortedOrders()
      .filter((o) => picked.has(o.orderId))
      .map((o) => ({ ...o, fillItems: isDone(o) ? itemsOf(o) : pendingItems(o) }));
    if (!list.length) return alert('채울 주문을 골라 주세요.');
    if (!blocks().length) return alert('상품 정보(STEP 04) 칸을 못 찾았어요. 신청서 화면이 맞는지 확인해 주세요.');
    // 이미 신청서에 같은 주문번호·옵션이 있으면 한 번 더 묻는다.
    const existing = new Set(blocks().map((b) => `${((byName(b, 'SHOP_ORD_NO') || {}).value || '').trim()}|${((byName(b, 'CLR') || {}).value || '').trim()}`));
    const dup = list.filter((o) => o.fillItems.some((it) => existing.has(`${o.orderId}|${String(it.spec || '').trim()}`)));
    if (dup.length && !confirm(`이미 신청서에 있는 상품이 있어요:\n${dup.map((o) => o.orderId).join('\n')}\n\n그래도 또 넣을까요? (취소하면 그 주문은 빼고 넣어요)`)) {
      dup.forEach((o) => picked.delete(o.orderId));
      return fill();
    }
    busy = true;
    result = { lines: [], summary: '채우는 중…' };
    render();
    const used = new Set();
    const filled = []; // [orderId, idx]
    let count = 0;
    try {
      for (const order of list) {
        for (const item of order.fillItems) {
          let all = blocks();
          let block = all.find((b) => !used.has(b) && isEmptyBlock(b));
          if (!block) {
            if (!(await addBlock())) {
              result.lines.push({ label: '상품추가', probs: ['"+상품추가"가 안 눌려요. 칸을 하나 직접 추가한 뒤 다시 눌러 주세요.'] });
              throw new Error('stop');
            }
            all = blocks();
            block = all.find((b) => !used.has(b) && isEmptyBlock(b));
            if (!block) throw new Error('새 칸을 못 찾았어요');
          }
          used.add(block);
          const idx = all.indexOf(block);
          const probs = await fillBlock(block, idx, order, item);
          count++;
          filled.push([order.orderId, item.idx]);
          result.lines.push({ label: `상품#${idx + 1} · …${order.orderId.slice(-6)} ${String(item.title || '').slice(0, 14)}`, probs });
          render();
        }
      }
      await callPage('fnTotalProPrice', []);
    } catch (err) {
      if (err.message !== 'stop') result.lines.push({ label: '오류', probs: [String(err.message || err)] });
    } finally {
      busy = false;
    }
    // 넣은 상품은 "8282 넣음"으로 표시한다(빨간 칸은 화면에서 마저 고치면 된다).
    if (filled.length) {
      const fresh = (await storageGet(BASKET_KEY)) || {};
      filled.forEach(([id, idx]) => {
        if (!fresh[id]) return;
        fresh[id] = { ...fresh[id], items: itemsOf(fresh[id]).map((it) => (it.idx === idx ? { ...it, used8282At: Date.now() } : it)) };
      });
      basket = fresh;
      await storageSet(BASKET_KEY, fresh).catch(() => {});
      list.forEach((o) => picked.delete(o.orderId));
    }
    const bad = result.lines.filter((l) => l.probs.some((p) => !/나중에 입력|첫 번째 운송장/.test(p))).length;
    result.summary = `상품 ${count}개를 채웠어요.${bad ? ` 확인할 칸이 ${bad}곳 있어요(빨간 테두리).` : ' 신청 전에 한 번 훑어봐 주세요.'}`;
    render();
  };

  const saveDiagnostics = () => {
    const bs = blocks();
    const b0 = bs[0] || document.querySelector(BLOCK_SEL);
    const log = {
      kind: '8282-form',
      url: location.href,
      at: new Date().toString(),
      blockCount: bs.length,
      blockIds: Array.from(document.querySelectorAll(BLOCK_SEL)).map((b) => b.id),
      selects: b0
        ? Array.from(b0.querySelectorAll('select')).map((s) => ({
            name: s.name,
            id: s.id,
            onchange: s.getAttribute('onchange'),
            value: s.value,
            options: Array.from(s.options).slice(0, 300).map((o) => [o.value, o.textContent.trim()]),
          }))
        : [],
      inputs: b0 ? Array.from(b0.querySelectorAll('input, textarea')).map((i) => ({ name: i.name, id: i.id, type: i.type, value: i.value, onclick: i.getAttribute('onclick') })) : [],
      addButtons: Array.from(document.querySelectorAll('a, button, input[type="button"]'))
        .filter((el) => /상품/.test(el.value || el.textContent))
        .map((el) => ({ tag: el.tagName, text: (el.value || el.textContent).trim().slice(0, 30), onclick: el.getAttribute('onclick'), href: el.getAttribute('href') })),
      blockHtml: b0 ? b0.outerHTML.slice(0, 200000) : document.body.innerHTML.slice(0, 300000),
      result,
    };
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const blob = new Blob([JSON.stringify(log, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `로켓8282로그_${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    alert('다운로드 폴더에 로켓8282로그 파일을 저장했어요.');
  };

  const host = document.createElement('div');
  host.id = 'rocket-8282-panel';
  const root = host.attachShadow({ mode: 'open' });
  const css = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; }
    .pill { position: fixed; right: 16px; bottom: 24px; z-index: 2147483646; background: #ff6a00; color: #fff; border: 0; border-radius: 999px; padding: 10px 16px; font-size: 14px; font-weight: 700; cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,.2); }
    .box { position: fixed; right: 12px; top: 90px; bottom: 16px; width: 320px; z-index: 2147483646; background: #fff; border: 2px solid #ff6a00; border-radius: 14px; box-shadow: 0 8px 28px rgba(0,0,0,.18); display: flex; flex-direction: column; overflow: hidden; font-size: 12px; color: #222; }
    .hd { display: flex; align-items: center; padding: 10px 12px; background: #fff4ec; border-bottom: 1px solid #ffd9bf; }
    .hd b { font-size: 14px; flex: 1; }
    .x { border: 0; background: none; font-size: 18px; cursor: pointer; color: #888; }
    .acts { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border-bottom: 1px solid #eee; }
    .btn { border: 1px solid #ddd; background: #fff; border-radius: 8px; padding: 7px 10px; font-size: 12px; cursor: pointer; }
    .btn.main { background: #ff6a00; border-color: #ff6a00; color: #fff; font-weight: 700; font-size: 13px; }
    .btn.main:disabled { background: #ccc; border-color: #ccc; cursor: default; }
    .row2 { display: flex; gap: 6px; } .row2 .btn { flex: 1; }
    .res { margin: 8px 12px 0; padding: 8px 10px; background: #fffbe6; border: 1px solid #ffe58f; border-radius: 8px; line-height: 1.5; max-height: 40%; overflow-y: auto; }
    .res .l { margin-top: 4px; } .res .p { color: #cf1322; } .res .w { color: #ad6800; }
    .list { flex: 1; overflow-y: auto; padding: 8px 12px 12px; }
    .empty { color: #999; padding: 20px 4px; line-height: 1.6; }
    .ord { border: 1px solid #eee; border-radius: 10px; padding: 8px; margin-bottom: 8px; cursor: pointer; }
    .ord.on { border-color: #ff6a00; background: #fff8f2; }
    .ord.done { opacity: .6; }
    .oh { display: flex; align-items: center; gap: 6px; }
    .oid { font-family: ui-monospace, Menlo, monospace; font-weight: 700; }
    .muted { color: #999; }
    .tag { font-size: 11px; padding: 1px 6px; border-radius: 999px; background: #e8f1ff; color: #1d5fd1; margin-left: auto; white-space: nowrap; }
    .trk { margin: 4px 0; color: #1d4f91; word-break: break-all; } .trk.no { color: #ad6800; }
    .it { display: flex; gap: 6px; margin-top: 4px; align-items: center; }
    .it img { width: 30px; height: 30px; object-fit: cover; border-radius: 5px; border: 1px solid #eee; flex: none; }
    .it span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  `;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const render = () => {
    if (!host.isConnected) document.documentElement.appendChild(host);
    const list = sortedOrders();
    if (!pickedInit && list.length) {
      list.filter((o) => !isDone(o)).forEach((o) => picked.add(o.orderId));
      pickedInit = true;
    }
    const waiting = list.reduce((n, o) => n + pendingItems(o).length, 0);
    if (!open) {
      root.innerHTML = `<style>${css}</style><button class="pill" data-act="open">📥 1688 주문 채우기${waiting ? ` · ${waiting}` : ''}</button>`;
      return;
    }
    const sel = list.filter((o) => picked.has(o.orderId));
    const itemCount = sel.reduce((s, o) => s + (isDone(o) ? itemsOf(o) : pendingItems(o)).length, 0);
    const scroll = (root.querySelector('.list') || {}).scrollTop || 0;
    root.innerHTML = `<style>${css}</style><div class="box">
      <div class="hd"><b>📥 1688 담은 주문 → 8282</b><button class="x" data-act="close">–</button></div>
      <div class="acts">
        <button class="btn main" data-act="fill" ${sel.length && !busy ? '' : 'disabled'}>${busy ? '채우는 중…' : `고른 주문 채우기 (${sel.length}건 · 상품 ${itemCount}개)`}</button>
        <div class="row2"><button class="btn" data-act="all">전부 고르기</button><button class="btn" data-act="none">고른 것 풀기</button></div>
        <button class="btn" data-act="diag">🔧 진단 저장</button>
      </div>
      ${
        result
          ? `<div class="res"><b>${esc(result.summary)}</b>${result.lines
              .map((l) => `<div class="l">${esc(l.label)}${l.probs.map((p) => `<div class="${/나중에 입력|첫 번째 운송장/.test(p) ? 'w' : 'p'}">· ${esc(p)}</div>`).join('')}</div>`)
              .join('')}</div>`
          : ''
      }
      <div class="list">${
        list.length
          ? list
              .map((o) => {
                const pack = (o.packages || [])[0];
                return `<div class="ord ${picked.has(o.orderId) ? 'on' : ''} ${isDone(o) ? 'done' : ''}" data-act="pick" data-id="${o.orderId}">
                  <div class="oh"><input type="checkbox" ${picked.has(o.orderId) ? 'checked' : ''} tabindex="-1"><span class="oid">…${esc(o.orderId.slice(-8))}</span><span class="muted">${esc(String(o.orderTime || '').slice(5, 16))}</span>${isDone(o) ? '<span class="tag">8282 넣음</span>' : ''}</div>
                  ${pack ? `<div class="trk">🚚 ${esc(pack.company)} ${esc(pack.mailNo)}</div>` : '<div class="trk no">운송장 없음 → "나중에 입력" 체크</div>'}
                  ${itemsOf(o).map((it) => `<div class="it">${it.imageUrl ? `<img src="${esc(it.imageUrl)}_80x80.jpg" alt="">` : ''}<span title="${esc(it.title)}">${esc(it.spec || it.title)}</span><b>${it.qty}개</b>${it.used8282At || o.used8282At ? '<span class="muted">✓</span>' : ''}</div>`).join('')}
                </div>`;
              })
              .join('')
          : '<div class="empty">담은 주문이 없어요.<br>1688 주문목록 화면 오른쪽 창에서 주문을 골라 "담기"를 눌러 주세요.</div>'
      }</div></div>`;
    const nl = root.querySelector('.list');
    if (nl) nl.scrollTop = scroll;
  };

  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    if (act === 'pick') {
      const id = el.dataset.id;
      if (picked.has(id)) picked.delete(id);
      else picked.add(id);
      render();
    } else if (act === 'open' || act === 'close') {
      open = act === 'open';
      storageSet(PANEL_OPEN_KEY, open).catch(() => {});
      render();
    } else if (act === 'all') {
      Object.keys(basket).forEach((id) => picked.add(id));
      render();
    } else if (act === 'none') {
      picked.clear();
      render();
    } else if (act === 'fill') fill();
    else if (act === 'diag') saveDiagnostics();
  });

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes[BASKET_KEY]) {
        basket = changes[BASKET_KEY].newValue || {};
        render();
      }
      if (changes[COURIER_KEY]) courierMap = changes[COURIER_KEY].newValue || {};
    });
  } catch (err) {}

  (async () => {
    // 신청서(STEP 04 상품 칸)가 있는 화면에서만 창을 띄운다.
    const found = await waitFor(() => document.querySelector(BLOCK_SEL), 10000, 300);
    if (!found) return;
    basket = (await storageGet(BASKET_KEY)) || {};
    courierMap = (await storageGet(COURIER_KEY)) || {};
    open = (await storageGet(PANEL_OPEN_KEY)) !== false;
    render();
  })();
})();
