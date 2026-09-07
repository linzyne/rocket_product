// 앱 탭 <-> 서플라이어허브 탭 사이의 중계.
//
//  (1) 통합다운 제안: 앱이 파일을 chrome.storage에 넣고 -> 등록 화면을 새 탭으로 연다.
//  (2) 카테고리 견적서 찾기: 앱이 키워드를 보내면 -> 등록 화면을 백그라운드 탭으로 열고,
//      그 탭의 supplier.js가 검색/다운로드를 대신 한 뒤 결과를 앱 탭으로 돌려보낸다.
//      탭끼리는 직접 말할 수 없어서 이 서비스워커가 주소록 역할을 한다.

const REGISTRATION_URL = 'https://supplier.coupang.com/qvt/registration';

// 진행 중인 카테고리 찾기 작업. 한 번에 하나만 둔다(사용자가 한 상품씩 처리하므로).
let job = null;

const relayToApp = (message) => {
  if (!job || !job.appTabId) return;
  chrome.tabs.sendMessage(job.appTabId, message).catch(() => {
    /* 앱 탭이 닫혔으면 무시 */
  });
};

// 우리가 연 탭만 닫습니다. 사용자가 원래 열어두고 쓰던 탭이면 그대로 둡니다.
const closeHubTab = () => {
  if (job && job.hubTabId && job.ownedTab) chrome.tabs.remove(job.hubTabId).catch(() => {});
};

// 이미 열려 있는 서플라이어허브 탭이 있으면 그 탭을 다시 씁니다(검색할 때마다 새 창이
// 쌓이지 않게). 없을 때만 새로 엽니다.
const openOrReuseHubTab = async () => {
  const [existing] = await chrome.tabs.query({ url: '*://supplier.coupang.com/*' });
  if (existing) {
    await chrome.tabs.update(existing.id, { url: REGISTRATION_URL, active: true });
    return { id: existing.id, owned: false };
  }
  const created = await chrome.tabs.create({ url: REGISTRATION_URL, active: true });
  return { id: created.id, owned: true };
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;

  // ---- 앱 -> 확장 ----
  if (message.type === 'OPEN_REGISTRATION') {
    chrome.tabs
      .create({ url: REGISTRATION_URL })
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true;
  }

  if (message.type === 'CATEGORY_SEARCH') {
    const appTabId = sender.tab && sender.tab.id;
    if (!appTabId) {
      sendResponse({ ok: false, error: '앱 탭을 확인할 수 없습니다.' });
      return true;
    }
    closeHubTab();
    job = { keyword: message.keyword, appTabId, hubTabId: null, ownedTab: false };
    // 화면이 안 그려지는 걸 막으려 앞으로 띄우고, 검색 결과가 나오면 곧바로 앱 탭으로
    // 되돌려줍니다(아래 CATEGORY_RESULTS).
    openOrReuseHubTab()
      .then(({ id, owned }) => {
        job.hubTabId = id;
        job.ownedTab = owned;
        sendResponse({ ok: true });
      })
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true;
  }

  if (message.type === 'CATEGORY_PICK') {
    if (!job || !job.hubTabId) {
      sendResponse({ ok: false, error: '진행 중인 검색이 없습니다.' });
      return true;
    }
    chrome.tabs
      .sendMessage(job.hubTabId, { type: 'CATEGORY_PICK', path: message.path })
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
    return true;
  }

  if (message.type === 'CATEGORY_CANCEL') {
    closeHubTab();
    job = null;
    sendResponse({ ok: true });
    return true;
  }

  // ---- 서플라이어허브 탭 -> 확장 ----
  if (message.type === 'GET_JOB') {
    const isHubTab = job && sender.tab && sender.tab.id === job.hubTabId;
    sendResponse(isHubTab ? { keyword: job.keyword } : null);
    return true;
  }

  if (message.type === 'CATEGORY_RESULTS') {
    relayToApp({ type: 'CATEGORY_RESULTS', items: message.items });
    // 목록에서 고르는 건 앱에서 하므로 화면을 돌려줍니다.
    if (job && job.appTabId) chrome.tabs.update(job.appTabId, { active: true }).catch(() => {});
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'CATEGORY_FILE') {
    relayToApp({ type: 'CATEGORY_FILE', name: message.name, dataUrl: message.dataUrl, path: message.path });
    closeHubTab();
    job = null;
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === 'CATEGORY_ERROR') {
    relayToApp({ type: 'CATEGORY_ERROR', message: message.message });
    if (job && job.appTabId) chrome.tabs.update(job.appTabId, { active: true }).catch(() => {});
    sendResponse({ ok: true });
    return true;
  }
});

// 견적서가 fetch/XHR가 아니라 브라우저 다운로드로 바로 받아지는 경우가 있어, 다운로드가
// 시작되면 그 주소를 서플라이어허브 탭에 알려줍니다. 그 탭에서 같은 주소를 다시 받아오면
// (로그인 세션이 그대로라) 파일 내용을 앱으로 넘길 수 있습니다.
// PC에 저장되는 파일 이름도 검색 키워드로 바꿔줍니다(쿠팡 기본 이름은 카테고리 구분이
// 안 돼서, 여러 개 받으면 무엇이 무엇인지 알 수 없습니다).
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  const url = item.finalUrl || item.url || '';
  if (!job || !job.keyword || !/supplier\.coupang\.com/.test(url)) return;
  const ext = (/\.([a-z0-9]+)$/i.exec(item.filename || '') || [, 'xlsx'])[1];
  suggest({ filename: `${job.keyword}_견적서.${ext}` });
});

chrome.downloads.onCreated.addListener((item) => {
  if (!job || !job.hubTabId) return;
  const url = item.finalUrl || item.url || '';
  if (!/supplier\.coupang\.com/.test(url)) return;
  const filename = (item.filename || '').split(/[\\/]/).pop();
  chrome.tabs.sendMessage(job.hubTabId, { type: 'FETCH_DOWNLOAD', url, filename }).catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (job && (tabId === job.hubTabId || tabId === job.appTabId)) job = null;
});
