// 로켓제안서 앱 화면에 붙어서, 앱과 확장 사이에서 메시지를 옮겨줍니다(양방향).
// 앱 페이지는 확장 API를 직접 부를 수 없기 때문에 이 중계가 필요합니다.
//
//  앱 -> 확장 : window.postMessage  ->  chrome.storage / chrome.runtime.sendMessage
//  확장 -> 앱 : chrome.runtime.onMessage  ->  window.postMessage
(() => {
  if (window.__rocketProposalBridgeInjected) return;
  window.__rocketProposalBridgeInjected = true;

  const APP_SOURCE = 'rocket-proposal-app';
  const EXT_SOURCE = 'rocket-proposal-extension';
  const PENDING_KEY = 'rocketPendingQuote';

  const reply = (payload) => {
    window.postMessage({ source: EXT_SOURCE, ...payload }, window.location.origin);
  };

  const storageSet = (value) =>
    new Promise((resolve, reject) => {
      chrome.storage.local.set({ [PENDING_KEY]: value }, () => {
        const lastError = chrome.runtime.lastError;
        if (lastError) reject(new Error(lastError.message));
        else resolve();
      });
    });

  const ask = (message) =>
    new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) reject(new Error(lastError.message));
        else if (!response || !response.ok) reject(new Error((response && response.error) || '확장이 응답하지 않았습니다.'));
        else resolve(response);
      });
    });

  // 확장 -> 앱 (검색 결과, 다운로드한 견적서 파일, 오류)
  chrome.runtime.onMessage.addListener((message) => {
    if (!message || !message.type) return;
    if (message.type === 'CATEGORY_RESULTS') reply({ type: 'CATEGORY_RESULTS', items: message.items });
    else if (message.type === 'CATEGORY_FILE') reply({ type: 'CATEGORY_FILE', name: message.name, dataUrl: message.dataUrl, path: message.path });
    else if (message.type === 'CATEGORY_ERROR') reply({ type: 'CATEGORY_ERROR', message: message.message });
  });

  // 앱 -> 확장
  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== APP_SOURCE) return;

    try {
      if (data.type === 'PROPOSE_QUOTE') {
        if (!data.quote || !data.quote.dataUrl) throw new Error('견적서 파일이 비어 있습니다.');
        await storageSet({
          productName: data.productName || '',
          quote: data.quote,
          imagesZip: data.imagesZip || null,
          labels: Array.isArray(data.labels) ? data.labels : [],
          savedAt: Date.now(),
        });
        await ask({ type: 'OPEN_REGISTRATION' });
        reply({ type: 'PROPOSE_QUOTE_ACK', ok: true });
        return;
      }

      if (data.type === 'CATEGORY_SEARCH') {
        await ask({ type: 'CATEGORY_SEARCH', keyword: data.keyword });
        reply({ type: 'CATEGORY_SEARCH_ACK', ok: true });
        return;
      }

      if (data.type === 'CATEGORY_PICK') {
        await ask({ type: 'CATEGORY_PICK', path: data.path });
        reply({ type: 'CATEGORY_PICK_ACK', ok: true });
        return;
      }

      if (data.type === 'CATEGORY_CANCEL') {
        await ask({ type: 'CATEGORY_CANCEL' });
        return;
      }
    } catch (err) {
      // 확장을 새로 로드한 뒤 옛 스크립트가 남아 있으면 여기로 옵니다("Extension context invalidated").
      const error = String((err && err.message) || err);
      if (data.type === 'PROPOSE_QUOTE') reply({ type: 'PROPOSE_QUOTE_ACK', ok: false, error });
      else if (data.type === 'CATEGORY_SEARCH') reply({ type: 'CATEGORY_SEARCH_ACK', ok: false, error });
      else if (data.type === 'CATEGORY_PICK') reply({ type: 'CATEGORY_PICK_ACK', ok: false, error });
    }
  });

  // 앱이 "확장이 깔려 있나"를 알 수 있게 준비 신호를 한 번 보냅니다.
  reply({ type: 'BRIDGE_READY' });
})();
