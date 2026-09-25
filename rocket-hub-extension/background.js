// 앱의 "확장에서 가져오기" → app-bridge.js → 여기.
// 자동 수집 요청(hubAutoRun)을 남기고 쿠팡 광고 상품 화면을 엽니다. 실제 수집은 그 화면의 panel.js가 합니다.
// 이미 열린 광고 탭이 있으면 그 탭을 쓰고, 없으면 뒤에서 새 탭을 열었다가 끝나면 닫습니다.
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

const shubPatch = async (fields) => {
  const r = await chrome.storage.local.get(SHUB_KEY);
  const now = (r && r[SHUB_KEY]) || null;
  if (!now) return;
  await chrome.storage.local.set({ [SHUB_KEY]: { ...now, ...fields } });
};

// 양식은 화면이 파일을 내려받는 방식이라, 크롬이 받은 그 주소를 그대로 한 번 더 받아서
// 파일 내용을 앱으로 넘긴다(앱이 C단계에서 이 파일을 채운다).
// 파일이 다 내려오면, 다운로드 폴더의 그 파일을 직접 읽어 본다(확장이 같은 주소를 다시 받으면 거절당할 때의 길).
// 이 길은 확장 설정의 "파일 URL 접근 허용"이 켜져 있어야 한다.
const readDownloadedFile = async (id) => {
  const r = await chrome.storage.local.get(SHUB_KEY);
  const p = r && r[SHUB_KEY];
  if (!p || p.file) return;
  const [item] = await chrome.downloads.search({ id });
  if (!item || !item.filename) return;
  const name = item.filename.split(/[\\/]/).pop();
  if (!/\.xlsx?$/i.test(name)) return;
  const allowed = await new Promise((res) => chrome.extension.isAllowedFileSchemeAccess(res));
  if (!allowed) {
    await shubPatch({
      step: 'error',
      status: `양식은 다운로드 폴더에 받았어요(${name}). 앱에서 "양식 직접 고르기"로 그 파일을 올려주세요. ` +
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
    await shubPatch({
      step: 'file',
      status: `✅ 양식을 받았어요 (${name})`,
      file: { name, dataUrl: `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${btoa(bin)}` },
    });
  } catch (err) {
    await shubPatch({ step: 'error', status: `다운로드 폴더의 파일을 읽지 못했어요(${name}). 앱에서 "양식 직접 고르기"로 올려주세요.` });
  }
};

chrome.downloads.onChanged.addListener((delta) => {
  if (delta && delta.state && delta.state.current === 'complete') {
    setTimeout(() => readDownloadedFile(delta.id).catch(() => {}), 1200);
  }
});

chrome.downloads.onCreated.addListener(async (item) => {
  try {
    const r = await chrome.storage.local.get(SHUB_KEY);
    const p = r && r[SHUB_KEY];
    if (!p || p.file || !['page', 'downloading'].includes(p.step)) return;
    const url = item.finalUrl || item.url;
    if (!url || url.startsWith('blob:')) {
      await shubPatch({ step: 'error', status: '양식 파일 주소를 읽지 못했어요(blob). 직접 받아 앱에 올려주세요.' });
      return;
    }
    await shubPatch({ step: 'downloading', status: '양식 파일 받는 중…' });
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`서버 응답 ${res.status}`);
    const buf = await res.arrayBuffer();
    let bin = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    const name = item.filename ? item.filename.split(/[\\/]/).pop() : '쉽먼트양식.xlsx';
    await shubPatch({
      step: 'file',
      status: `✅ 양식을 받았어요 (${name})`,
      file: { name, dataUrl: `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${btoa(bin)}` },
    });
  } catch (err) {
    // 같은 주소를 다시 받으면 서버가 거절하는 경우가 있다(400). 그때는 화면에서 가로챈 파일을 기다린다.
    // 여기서 끝내지 않는다. 화면에서 가로챈 파일이나, 다운로드가 끝난 뒤 파일 읽기가 이어받는다.
    await shubPatch({ status: '양식 파일 받는 중… (다운로드 완료를 기다리는 중)' });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;

  if (message.type === 'HUB_COLLECT') {
    (async () => {
      try {
        const run = { requestedAt: Date.now(), step: 'ad', done: false, error: null, createdTabId: null };
        const tabs = await chrome.tabs.query({ url: '*://advertising.coupang.com/*' });
        if (tabs.length) {
          await chrome.storage.local.set({ [AUTO_KEY]: run });
          await chrome.tabs.update(tabs[0].id, { url: START_URL });
        } else {
          const tab = await chrome.tabs.create({ url: START_URL, active: false });
          run.createdTabId = tab.id;
          await chrome.storage.local.set({ [AUTO_KEY]: run });
        }
        sendResponse({ ok: true, requestedAt: run.requestedAt });
      } catch (err) {
        sendResponse({ ok: false, error: String((err && err.message) || err) });
      }
    })();
    return true;
  }

  // 앱의 물류 > 물류창고입고에서 "자동으로 가져오기" → 서허 입고상세내역을 열고 panel.js가
  // 앱이 고른 날짜(message.day, 없으면 어제)로 검색해 표를 모은다. 이미 그 화면이 열려 있으면 그 탭을 쓴다.
  if (message.type === 'RECEIVE_COLLECT') {
    (async () => {
      try {
        const asked = /^\d{4}-\d{2}-\d{2}$/.test(String(message.day || '')) ? message.day : '';
        const day = asked || yesterdayYMD();
        // 어제면 화면의 "어제" 버튼을 눌러 맞추고, 다른 날이면 날짜 칸에 직접 적는다.
        const run = { requestedAt: Date.now(), step: 'search', done: false, error: null, createdTabId: null, range: day === yesterdayYMD() ? '어제' : '', day };
        const tabs = await chrome.tabs.query({ url: '*://supplier.coupang.com/scm/receive*' });
        if (tabs.length) {
          await chrome.storage.local.set({ [RECEIVE_KEY]: run });
          await chrome.tabs.update(tabs[0].id, { url: RECEIVE_URL });
        } else {
          const tab = await chrome.tabs.create({ url: RECEIVE_URL, active: false });
          run.createdTabId = tab.id;
          await chrome.storage.local.set({ [RECEIVE_KEY]: run });
        }
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

  // 내가 지금 어느 창(브라우저 창)에 있는지 알려준다. 확장이 연 창에서만 자동 진행하려고 쓴다.
  if (message.type === 'MY_WINDOW') {
    sendResponse({ windowId: (sender && sender.tab && sender.tab.windowId) || null });
    return true;
  }

  if (message.type === 'HUB_RECEIVE_DONE') {
    chrome.storage.local.get(RECEIVE_KEY, (r) => {
      const run = r && r[RECEIVE_KEY];
      // 우리가 연 탭만 닫습니다(사장님이 열어둔 탭은 그대로).
      if (run && run.done && run.createdTabId && sender.tab && sender.tab.id === run.createdTabId) {
        chrome.tabs.remove(run.createdTabId).catch(() => {});
      }
    });
  }

  if (message.type === 'HUB_AUTO_DONE') {
    chrome.storage.local.get(AUTO_KEY, (r) => {
      const run = r && r[AUTO_KEY];
      // 우리가 연 탭만 닫습니다(사장님이 열어둔 탭은 그대로).
      if (run && run.done && run.createdTabId && sender.tab && sender.tab.id === run.createdTabId) {
        chrome.tabs.remove(run.createdTabId).catch(() => {});
      }
    });
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
