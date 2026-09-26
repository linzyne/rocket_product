// 앱의 "확장에서 가져오기" → app-bridge.js → 여기.
// 자동 수집 요청(hubAutoRun)을 남기고 쿠팡 광고 상품 화면을 엽니다. 실제 수집은 그 화면의 panel.js가 합니다.
// 수집은 언제나 새 창을 열어서 하고, 끝나면 그 창을 닫습니다(실패하면 확인할 수 있게 열어 둡니다).
// 열려 있는 탭은 건드리지 않습니다 — 보고 있던 화면이 수집 때문에 넘어가 버리면 안 되니까요.
const AUTO_KEY = 'hubAutoRun';
const START_URL = 'https://advertising.coupang.com/marketing/product-dashboard/advertised';
// 물류창고입고 자동 수집(서허 입고상세내역). 앱이 고른 날짜로 검색하고, 안 고르면 어제로 한다.
const RECEIVE_KEY = 'hubReceiveRun';
const RECEIVE_URL = 'https://supplier.coupang.com/scm/receive/detail';

// 어제 날짜(내 컴퓨터 시간 기준) 'YYYY-MM-DD'. 앱이 날짜를 안 보내면 이 날로 검색한다.
const yesterdayYMD = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const LOTTE_KEY = 'lottePending';

// 수집용 창 하나 열기. 열려 있는 탭을 쓰지 않고 언제나 새 창에서 합니다.
// 창을 앞으로 내세우는 이유: 크롬은 뒤에 숨은 창의 시계(setTimeout)를 늦추기 때문에,
// 뒤에서 돌리면 페이지가 많을 때 수집이 기어갑니다.
const openCollectWindow = async (url) => {
  const win = await chrome.windows.create({ url, type: 'popup', width: 1200, height: 900, focused: true });
  const tab = win && win.tabs && win.tabs[0];
  return { windowId: win ? win.id : null, tabId: tab ? tab.id : null };
};

// 우리가 연 수집 창만 닫습니다(사장님이 열어둔 창은 그대로).
const closeCollectWindow = (run, sender) => {
  if (!run || !run.done || !sender || !sender.tab) return;
  if (run.createdTabId && sender.tab.id !== run.createdTabId) return;
  if (run.createdWindowId) chrome.windows.remove(run.createdWindowId).catch(() => {});
  else if (run.createdTabId) chrome.tabs.remove(run.createdTabId).catch(() => {});
};

// 운송장 미리보기는 새 창(window.open)으로 뜨는데, 확장이 누른 클릭은 "사람이 누른 클릭"이 아니라서
// 크롬 팝업 차단에 걸린다. ALPS 창에는 주소창이 없어 차단 아이콘도 안 보인다.
// 그래서 롯데 사이트에 한해 팝업을 허용해 둔다(다른 사이트는 그대로).
const allowLottePopups = async () => {
  try {
    for (const pattern of ['https://*.llogis.com/*', 'http://*.llogis.com/*']) {
      await chrome.contentSettings.popups.set({ primaryPattern: pattern, setting: 'allow' });
    }
  } catch (err) {
    console.warn('팝업 허용 설정 실패:', err);
  }
};

// 롯데 팝업 창의 첫 화면(로그인). 로그인은 lotte.js가 확장 설정에 저장된 정보로 한다.
const LOTTE_START_URL = 'https://partner.alps.llogis.com/main/pages/sec/authentication';

// ---- B단계: 서허(서플라이어허브)에서 쉽먼트 일괄등록 양식 받아오기 ----
const SHUB_KEY = 'shubPending';
const SHUB_START_URL = 'https://supplier.coupang.com/';

// ---- 발주서 수집: 서허 발주서 목록에서 새 발주서만 골라 업로드 양식 받기 ----
const PO_KEY = 'poPending';
const PO_URL = 'https://supplier.coupang.com/po-web/purchase/order/list';

const shubPatch = async (fields) => {
  const r = await chrome.storage.local.get(SHUB_KEY);
  const now = (r && r[SHUB_KEY]) || null;
  if (!now) return;
  await chrome.storage.local.set({ [SHUB_KEY]: { ...now, ...fields } });
};

// 지금 파일을 기다리는 작업 찾기. 쉽먼트 양식(shubPending)과 발주서 양식(poPending)이 같은 길로 받는다.
const waitingJob = async () => {
  const r = await chrome.storage.local.get([SHUB_KEY, PO_KEY]);
  const po = r && r[PO_KEY];
  if (po && !po.file && ['page', 'downloading'].includes(po.step)) return { key: PO_KEY, job: po };
  const shub = r && r[SHUB_KEY];
  if (shub && !shub.file && ['page', 'downloading'].includes(shub.step)) return { key: SHUB_KEY, job: shub };
  return null;
};
const jobPatch = async (key, fields) => {
  const r = await chrome.storage.local.get(key);
  const now = (r && r[key]) || null;
  if (!now) return;
  await chrome.storage.local.set({ [key]: { ...now, ...fields } });
};

// 양식은 화면이 파일을 내려받는 방식이라, 크롬이 받은 그 주소를 그대로 한 번 더 받아서
// 파일 내용을 앱으로 넘긴다(앱이 C단계에서 이 파일을 채운다).
// 파일이 다 내려오면, 다운로드 폴더의 그 파일을 직접 읽어 본다(확장이 같은 주소를 다시 받으면 거절당할 때의 길).
// 이 길은 확장 설정의 "파일 URL 접근 허용"이 켜져 있어야 한다.
const readDownloadedFile = async (id) => {
  const waiting = await waitingJob();
  if (!waiting) return;
  const [item] = await chrome.downloads.search({ id });
  if (!item || !item.filename) return;
  const name = item.filename.split(/[\\/]/).pop();
  if (!/\.xlsx?$/i.test(name)) return;
  const allowed = await new Promise((res) => chrome.extension.isAllowedFileSchemeAccess(res));
  if (!allowed) {
    await jobPatch(waiting.key, {
      step: 'error',
      status: `파일은 다운로드 폴더에 받았어요(${name}). 앱에서 그 파일을 직접 올려주세요. ` +
        '(매번 자동으로 하려면 chrome://extensions › 로켓 서허 연동 › 세부정보 › "파일 URL 접근 허용"을 켜주세요)',
    });
    return;
  }
  try {
    const res = await fetch(`file://${item.filename}`);
    const buf = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    await jobPatch(waiting.key, {
      step: 'file',
      status: `✅ 파일을 받았어요 (${name})`,
      file: { name, dataUrl: `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${btoa(bin)}` },
    });
  } catch (err) {
    await jobPatch(waiting.key, { step: 'error', status: `다운로드 폴더의 파일을 읽지 못했어요(${name}). 앱에서 직접 올려주세요.` });
  }
};

chrome.downloads.onChanged.addListener((delta) => {
  if (delta && delta.state && delta.state.current === 'complete') {
    setTimeout(() => readDownloadedFile(delta.id).catch(() => {}), 1200);
  }
});

chrome.downloads.onCreated.addListener(async (item) => {
  try {
    const waiting = await waitingJob();
    if (!waiting) return;
    const url = item.finalUrl || item.url;
    if (!url || url.startsWith('blob:')) {
      await jobPatch(waiting.key, { step: 'error', status: '파일 주소를 읽지 못했어요(blob). 직접 받아 앱에 올려주세요.' });
      return;
    }
    await jobPatch(waiting.key, { step: 'downloading', status: '파일 받는 중…' });
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`서버 응답 ${res.status}`);
    const buf = await res.arrayBuffer();
    let bin = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    const name = item.filename ? item.filename.split(/[\\/]/).pop() : '양식.xlsx';
    await jobPatch(waiting.key, {
      step: 'file',
      status: `✅ 파일을 받았어요 (${name})`,
      file: { name, dataUrl: `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${btoa(bin)}` },
    });
  } catch (err) {
    // 같은 주소를 다시 받으면 서버가 거절하는 경우가 있다(400). 그때는 다운로드가 끝난 뒤 파일 읽기가 이어받는다.
    const waiting = await waitingJob();
    if (waiting) await jobPatch(waiting.key, { status: '파일 받는 중… (다운로드 완료를 기다리는 중)' });
  }
});

// ---- 매일 정해진 시각에 저절로 수집 시작하기 ----
// 앱의 매일 > 수집에서 켜 두면, 크롬이 켜져 있는 한 그 시각에 로켓 앱 탭을 열어(없으면 새로 열어)
// "지금 수집해라" 표시를 남긴다. 실제 수집은 앱 화면이 한다(저장은 앱만 할 수 있다).
// 컴퓨터나 크롬이 꺼져 있으면 그날은 건너뛰고, 다음에 켜졌을 때 그 시각이 지났으면 바로 한다.
const SCHEDULE_KEY = 'autoCollect';
const SCHEDULE_RUN_KEY = 'autoCollectRun';
const ALARM_NAME = 'rocketAutoCollect';

const todayYMD = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const ensureAlarm = () => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
};

// 앱 탭을 앞으로 가져온다(없으면 새로 연다). 앱 주소는 앱이 설정을 저장할 때 알려준 것을 쓴다.
const openAppTab = async (appUrl) => {
  if (!appUrl) return;
  let origin = appUrl;
  try {
    origin = new URL(appUrl).origin;
  } catch (err) {}
  const tabs = await chrome.tabs.query({ url: `${origin}/*` });
  if (tabs.length) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    await chrome.windows.update(tabs[0].windowId, { focused: true }).catch(() => {});
    await chrome.tabs.reload(tabs[0].id).catch(() => {});
    return;
  }
  await chrome.tabs.create({ url: appUrl, active: true });
};

const checkSchedule = async () => {
  const r = await chrome.storage.local.get(SCHEDULE_KEY);
  const cfg = r && r[SCHEDULE_KEY];
  if (!cfg || !cfg.on || !/^\d{2}:\d{2}$/.test(String(cfg.time || ''))) return;
  const today = todayYMD();
  if (cfg.lastRun === today) return;
  const now = new Date();
  const [hh, mm] = cfg.time.split(':').map(Number);
  if (now.getHours() * 60 + now.getMinutes() < hh * 60 + mm) return;
  // 오늘 몫은 시작했다고 먼저 적어 둔다(탭 여는 사이에 두 번 도는 일이 없게).
  await chrome.storage.local.set({ [SCHEDULE_KEY]: { ...cfg, lastRun: today } });
  await chrome.storage.local.set({ [SCHEDULE_RUN_KEY]: { requestedAt: Date.now(), day: today } });
  await openAppTab(cfg.appUrl);
};

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) checkSchedule().catch(() => {});
});
chrome.runtime.onStartup.addListener(() => { ensureAlarm(); checkSchedule().catch(() => {}); });
chrome.runtime.onInstalled.addListener(() => { ensureAlarm(); });
ensureAlarm();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;

  if (message.type === 'HUB_COLLECT') {
    (async () => {
      try {
        const run = { requestedAt: Date.now(), step: 'ad', done: false, error: null, createdTabId: null, createdWindowId: null };
        const win = await openCollectWindow(START_URL);
        run.createdTabId = win.tabId;
        run.createdWindowId = win.windowId;
        await chrome.storage.local.set({ [AUTO_KEY]: run });
        sendResponse({ ok: true, requestedAt: run.requestedAt });
      } catch (err) {
        sendResponse({ ok: false, error: String((err && err.message) || err) });
      }
    })();
    return true;
  }

  // 앱의 물류 > 물류창고입고에서 "자동으로 가져오기" → 새 창으로 서허 입고상세내역을 열고 panel.js가
  // 앱이 고른 날짜(message.day, 없으면 어제)로 검색해 표를 모은다. 열려 있는 서허 탭은 건드리지 않는다.
  if (message.type === 'RECEIVE_COLLECT') {
    (async () => {
      try {
        const asked = /^\d{4}-\d{2}-\d{2}$/.test(String(message.day || '')) ? message.day : '';
        const day = asked || yesterdayYMD();
        // 어제면 화면의 "어제" 버튼을 눌러 맞추고, 다른 날이면 날짜 칸에 직접 적는다.
        const run = { requestedAt: Date.now(), step: 'search', done: false, error: null, createdTabId: null, createdWindowId: null, range: day === yesterdayYMD() ? '어제' : '', day };
        const win = await openCollectWindow(RECEIVE_URL);
        run.createdTabId = win.tabId;
        run.createdWindowId = win.windowId;
        await chrome.storage.local.set({ [RECEIVE_KEY]: run });
        sendResponse({ ok: true, requestedAt: run.requestedAt });
      } catch (err) {
        sendResponse({ ok: false, error: String((err && err.message) || err) });
      }
    })();
    return true;
  }

  // 롯데택배 엑셀을 ALPS 일괄주문접수에 올리기. 작은 팝업 창으로 ALPS를 열면 lotte.js가 로그인·메뉴 이동·
  // 파일 올리기를 하고, 올리고 나면 아래 onChanged에서 창을 닫는다(오류면 확인할 수 있게 열어 둔다).
  if (message.type === 'LOTTE_UPLOAD') {
    (async () => {
      try {
        if (!message.file || !message.file.dataUrl) throw new Error('엑셀 파일이 비어 있습니다.');
        await allowLottePopups();
        const win = await chrome.windows.create({ url: LOTTE_START_URL, type: 'popup', width: 1000, height: 680, focused: true });
        await chrome.storage.local.set({
          [LOTTE_KEY]: {
            file: message.file,
            boxCount: Number(message.boxCount) || 0,
            batchId: message.batchId || '',
            savedAt: Date.now(),
            step: 'start',
            status: '',
            windowId: win.id,
          },
        });
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: String((err && err.message) || err) });
      }
    })();
    return true;
  }

  // 앱에서 "서허 양식 받기"를 누르면 서허 창을 열고, shub.js가 메뉴를 눌러 양식을 받는다.
  if (message.type === 'SHUB_FORM') {
    (async () => {
      try {
        const win = await chrome.windows.create({ url: SHUB_START_URL, type: 'popup', width: 1200, height: 800, focused: true });
        await chrome.storage.local.set({
          [SHUB_KEY]: {
            batchId: message.batchId || '',
            boxCount: Number(message.boxCount) || 0,
            orderNos: Array.isArray(message.orderNos) ? message.orderNos : [],
            center: message.center || '',
            edd: message.edd || '',
            savedAt: Date.now(),
            step: 'start',
            status: '서허 여는 중…',
            file: null,
            windowId: win.id,
          },
        });
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: String((err && err.message) || err) });
      }
    })();
    return true;
  }

  // 앱의 발주 > 쿠팡발주확인에서 "서허에서 새 발주서 가져오기" → 발주서 목록을 새 창으로 열고
  // po.js가 지난번 발주번호 위쪽만 골라 업로드 양식을 받는다.
  if (message.type === 'PO_COLLECT') {
    (async () => {
      try {
        const win = await chrome.windows.create({ url: PO_URL, type: 'popup', width: 1400, height: 900, focused: true });
        await chrome.storage.local.set({
          [PO_KEY]: {
            requestedAt: Date.now(),
            lastOrderNo: String(message.lastOrderNo || ''),
            savedAt: Date.now(),
            step: 'start',
            status: '서허 발주서 목록 여는 중…',
            count: 0,
            topOrderNo: '',
            file: null,
            windowId: win.id,
          },
        });
        sendResponse({ ok: true, requestedAt: Date.now() });
      } catch (err) {
        sendResponse({ ok: false, error: String((err && err.message) || err) });
      }
    })();
    return true;
  }

  // 앱이 자동 수집 설정을 바꾸거나 물어본다. 앱 주소는 보낸 탭에서 그대로 가져온다.
  if (message.type === 'AUTO_COLLECT_SET') {
    (async () => {
      try {
        const r = await chrome.storage.local.get(SCHEDULE_KEY);
        const before = (r && r[SCHEDULE_KEY]) || {};
        const cfg = {
          ...before,
          on: !!message.on,
          time: /^\d{2}:\d{2}$/.test(String(message.time || '')) ? message.time : before.time || '09:00',
          appUrl: (sender && sender.tab && sender.tab.url) || before.appUrl || '',
        };
        // 시각이나 켬/끔을 바꾸면 오늘 몫을 다시 할 수 있게 한다(방금 지난 시각으로 맞춘 경우).
        if (before.time !== cfg.time || before.on !== cfg.on) delete cfg.lastRun;
        await chrome.storage.local.set({ [SCHEDULE_KEY]: cfg });
        ensureAlarm();
        sendResponse({ ok: true, config: cfg });
      } catch (err) {
        sendResponse({ ok: false, error: String((err && err.message) || err) });
      }
    })();
    return true;
  }

  if (message.type === 'AUTO_COLLECT_GET') {
    (async () => {
      const r = await chrome.storage.local.get(SCHEDULE_KEY);
      sendResponse({ ok: true, config: (r && r[SCHEDULE_KEY]) || null });
    })();
    return true;
  }

  // 앱이 "지금 수집해라" 표시를 받아 갔다. 다시 뜨지 않게 지운다.
  if (message.type === 'AUTO_COLLECT_TAKEN') {
    chrome.storage.local.remove(SCHEDULE_RUN_KEY);
  }

  // 내가 지금 어느 창·탭에 있는지 알려준다. 확장이 연 창에서만 자동 진행하려고 쓴다.
  if (message.type === 'MY_WINDOW') {
    sendResponse({
      windowId: (sender && sender.tab && sender.tab.windowId) || null,
      tabId: (sender && sender.tab && sender.tab.id) || null,
    });
    return true;
  }

  if (message.type === 'HUB_RECEIVE_DONE') {
    chrome.storage.local.get(RECEIVE_KEY, (r) => closeCollectWindow(r && r[RECEIVE_KEY], sender));
  }

  if (message.type === 'HUB_AUTO_DONE') {
    chrome.storage.local.get(AUTO_KEY, (r) => closeCollectWindow(r && r[AUTO_KEY], sender));
  }
});

// 운송장번호까지 다 모으면(waybills) 팝업 창을 닫는다. 중간에 멈추면(error) 확인할 수 있게 열어 둔다.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[LOTTE_KEY]) return;
  const now = changes[LOTTE_KEY].newValue;
  const before = changes[LOTTE_KEY].oldValue;
  if (!now || !now.windowId || (before && before.step === now.step)) return;
  if (now.step === 'waybills') setTimeout(() => chrome.windows.remove(now.windowId).catch(() => {}), 1500);
});

// 양식 파일까지 받으면 서허 창을 닫는다(오류면 확인할 수 있게 열어 둔다).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[SHUB_KEY]) return;
  const now = changes[SHUB_KEY].newValue;
  const before = changes[SHUB_KEY].oldValue;
  if (!now || !now.windowId || (before && before.step === now.step)) return;
  if (now.step === 'file') setTimeout(() => chrome.windows.remove(now.windowId).catch(() => {}), 1500);
});

// 발주서 양식을 받았거나 새 발주서가 없으면 창을 닫는다(오류면 확인할 수 있게 열어 둔다).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[PO_KEY]) return;
  const now = changes[PO_KEY].newValue;
  const before = changes[PO_KEY].oldValue;
  if (!now || !now.windowId || (before && before.step === now.step)) return;
  if (now.step === 'file' || now.step === 'empty') setTimeout(() => chrome.windows.remove(now.windowId).catch(() => {}), 1500);
});
