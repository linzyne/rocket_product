// 로켓 앱 화면에 붙어서, 확장이 모아둔 서허 데이터를 앱에 넘겨줍니다.
// 1688 확장의 app-bridge와 섞이지 않도록 source 이름을 따로 씁니다.
//
//  앱 -> 확장 : { source: 'rocket-app-hub', type: 'HUB_REQUEST' }
//  확장 -> 앱 : { source: 'rocket-hub-extension', type: 'HUB_DATA', data }
//               데이터가 바뀌면(서허 창에서 새로 모으면) HUB_DATA를 다시 보냅니다.
//  앱 -> 확장 : { type: 'HUB_COLLECT' }  자동 수집 시작(background.js가 광고 화면을 열어 모음)
//  확장 -> 앱 : { type: 'HUB_COLLECT_ACK', ok, requestedAt, error }
//  앱 -> 확장 : { type: 'RECEIVE_COLLECT', day }  물류창고입고 자동 수집(서허 입고상세내역을 그 날짜로 검색, 없으면 어제)
//  확장 -> 앱 : { type: 'RECEIVE_COLLECT_ACK', ok, requestedAt, error }
//               { type: 'RECEIVE_AUTO', run, data }  진행/완료/실패. 완료면 data에 모은 값이 같이 옵니다.
//  앱 -> 확장 : { type: 'LOTTE_UPLOAD', file: { name, dataUrl } }  롯데택배 엑셀을 ALPS에 올리기(lotte.js)
//               { type: 'HUB_AUTO', run, data }  자동 수집 진행/완료/실패. 완료면 data에 모은 값이 같이 옵니다.
(() => {
  if (window.__rocketHubBridgeInjected) return;
  window.__rocketHubBridgeInjected = true;

  const APP_SOURCE = 'rocket-app-hub';
  const EXT_SOURCE = 'rocket-hub-extension';
  const DATA_KEY = 'hubData';
  const AUTO_KEY = 'hubAutoRun';
  const RECEIVE_KEY = 'hubReceiveRun';

  const reply = (payload) => window.postMessage({ source: EXT_SOURCE, ...payload }, window.location.origin);

  const sendData = () => {
    try {
      chrome.storage.local.get(DATA_KEY, (r) => reply({ type: 'HUB_DATA', data: (r && r[DATA_KEY]) || {} }));
    } catch (err) {
      // 확장을 새로 로드한 뒤 옛 스크립트가 남은 경우("Extension context invalidated").
    }
  };

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const d = event.data;
    if (!d || d.source !== APP_SOURCE) return;
    if (d.type === 'HUB_REQUEST') sendData();
    if (d.type === 'LOTTE_UPLOAD') {
      try {
        chrome.runtime.sendMessage({ type: 'LOTTE_UPLOAD', file: d.file, boxCount: d.boxCount, batchId: d.batchId }, (res) => {
          const lastError = chrome.runtime.lastError;
          reply({ type: 'LOTTE_UPLOAD_ACK', ok: !lastError && !!(res && res.ok), error: (lastError && lastError.message) || (res && res.error) });
        });
      } catch (err) {
        reply({ type: 'LOTTE_UPLOAD_ACK', ok: false, error: '확장을 새로고침한 뒤 앱도 새로고침해 주세요.' });
      }
      return;
    }
    // B단계: 서허에서 쉽먼트 일괄등록 양식 받아오기.
    if (d.type === 'SHUB_FORM') {
      try {
        chrome.runtime.sendMessage({ type: 'SHUB_FORM', batchId: d.batchId, boxCount: d.boxCount, orderNos: d.orderNos || [], center: d.center || '', edd: d.edd || '' }, (res) => {
          const lastError = chrome.runtime.lastError;
          reply({ type: 'SHUB_FORM_ACK', ok: !lastError && !!(res && res.ok), error: (lastError && lastError.message) || (res && res.error) });
        });
      } catch (err) {
        reply({ type: 'SHUB_FORM_ACK', ok: false, error: '확장을 새로고침한 뒤 앱도 새로고침해 주세요.' });
      }
      return;
    }
    if (d.type === 'RECEIVE_COLLECT') {
      try {
        chrome.runtime.sendMessage({ type: 'RECEIVE_COLLECT', day: d.day || '' }, (res) => {
          const lastError = chrome.runtime.lastError;
          if (lastError || !res) reply({ type: 'RECEIVE_COLLECT_ACK', ok: false, error: (lastError && lastError.message) || '확장이 응답하지 않았습니다.' });
          else reply({ type: 'RECEIVE_COLLECT_ACK', ...res });
        });
      } catch (err) {
        reply({ type: 'RECEIVE_COLLECT_ACK', ok: false, error: '확장을 새로고침한 뒤 앱도 새로고침해 주세요.' });
      }
      return;
    }
    if (d.type === 'HUB_COLLECT') {
      try {
        chrome.runtime.sendMessage({ type: 'HUB_COLLECT' }, (res) => {
          const lastError = chrome.runtime.lastError;
          if (lastError || !res) reply({ type: 'HUB_COLLECT_ACK', ok: false, error: (lastError && lastError.message) || '확장이 응답하지 않았습니다.' });
          else reply({ type: 'HUB_COLLECT_ACK', ...res });
        });
      } catch (err) {
        reply({ type: 'HUB_COLLECT_ACK', ok: false, error: '확장을 새로고침한 뒤 앱도 새로고침해 주세요.' });
      }
    }
  });

  const sendAuto = (run) => {
    if (!run) return;
    if (!run.done) return reply({ type: 'HUB_AUTO', run, data: null });
    chrome.storage.local.get(DATA_KEY, (r) => reply({ type: 'HUB_AUTO', run, data: (r && r[DATA_KEY]) || {} }));
  };

  const sendReceiveAuto = (run) => {
    if (!run) return;
    if (!run.done) return reply({ type: 'RECEIVE_AUTO', run, data: null });
    chrome.storage.local.get(DATA_KEY, (r) => reply({ type: 'RECEIVE_AUTO', run, data: (r && r[DATA_KEY]) || {} }));
  };

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes[DATA_KEY]) sendData();
      if (changes[AUTO_KEY]) sendAuto(changes[AUTO_KEY].newValue);
      if (changes[RECEIVE_KEY]) sendReceiveAuto(changes[RECEIVE_KEY].newValue);
      // 롯데택배 올리기 진행 상황(앱이 끝났는지·실패했는지 알림을 띄움).
      if (changes.lottePending && changes.lottePending.newValue) {
        const v = changes.lottePending.newValue;
        reply({ type: 'LOTTE_STATUS', step: v.step, status: v.status, savedAt: v.savedAt, waybills: v.waybills || null });
      }
      // 서허 양식 받기 진행 상황. 다 받으면 file(이름·내용)이 같이 온다.
      if (changes.shubPending && changes.shubPending.newValue) {
        const v = changes.shubPending.newValue;
        reply({ type: 'SHUB_STATUS', step: v.step, status: v.status, savedAt: v.savedAt, batchId: v.batchId, file: v.file || null });
      }
    });
  } catch (err) {}

  reply({ type: 'HUB_READY' });
})();
