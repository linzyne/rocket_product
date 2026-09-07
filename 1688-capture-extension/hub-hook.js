// 서플라이어허브 페이지와 같은 세계(MAIN world)에서 도는 스크립트.
// "선택 된 카테고리의 견적서 다운로드"를 눌렀을 때 브라우저가 받는 엑셀 파일을 가로채서,
// 확장 쪽 supplier.js가 앱으로 보낼 수 있게 넘겨줍니다.
//
// 격리된 content script는 페이지의 fetch/XHR을 볼 수 없어서, 이 스크립트만 MAIN world에
// 넣습니다. 파일은 원래대로 다운로드 폴더에도 저장됩니다(가로채기만 하고 막지 않습니다).
(() => {
  if (window.__rocketHubHookInjected) return;
  window.__rocketHubHookInjected = true;

  const SOURCE = 'rocket-hub-hook';
  const XLSX_RE = /sheet|excel|officedocument|octet-stream/i;

  const send = (name, dataUrl) => {
    window.postMessage({ source: SOURCE, type: 'FILE', name, dataUrl }, window.location.origin);
  };

  const blobToDataUrl = (blob, name) => {
    const reader = new FileReader();
    reader.onload = () => send(name, String(reader.result));
    reader.readAsDataURL(blob);
  };

  const nameFromDisposition = (disposition) => {
    if (!disposition) return null;
    const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(disposition);
    if (star) {
      try {
        return decodeURIComponent(star[1].replace(/"/g, '').trim());
      } catch (err) {
        /* 아래 일반 filename으로 */
      }
    }
    const plain = /filename="?([^";]+)"?/i.exec(disposition);
    return plain ? plain[1].trim() : null;
  };

  // 1) fetch로 파일을 받는 경우
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    try {
      const type = response.headers.get('content-type') || '';
      const disposition = response.headers.get('content-disposition') || '';
      if (XLSX_RE.test(type) || /\.xlsx?/i.test(disposition)) {
        const name = nameFromDisposition(disposition) || '카테고리견적서.xlsx';
        response.clone().blob().then((blob) => blobToDataUrl(blob, name));
      }
    } catch (err) {
      /* 가로채기 실패는 페이지 동작에 영향을 주지 않게 무시 */
    }
    return response;
  };

  // 2) XHR로 받는 경우
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__rocketUrl = url;
    return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', () => {
      try {
        const type = this.getResponseHeader('content-type') || '';
        const disposition = this.getResponseHeader('content-disposition') || '';
        if (!XLSX_RE.test(type) && !/\.xlsx?/i.test(disposition)) return;
        const name = nameFromDisposition(disposition) || '카테고리견적서.xlsx';
        const body = this.response;
        if (body instanceof Blob) blobToDataUrl(body, name);
        else if (body instanceof ArrayBuffer) blobToDataUrl(new Blob([body]), name);
      } catch (err) {
        /* 무시 */
      }
    });
    return originalSend.apply(this, args);
  };

  // 3) blob을 만들어 <a download>로 저장하는 경우
  const originalCreateObjectURL = URL.createObjectURL;
  URL.createObjectURL = function (object) {
    const url = originalCreateObjectURL.call(this, object);
    try {
      if (object instanceof Blob && (XLSX_RE.test(object.type) || object.type === '')) {
        // 파일명은 여기서 알 수 없어 기본값을 씁니다(앱에서 다시 지정합니다).
        blobToDataUrl(object, '카테고리견적서.xlsx');
      }
    } catch (err) {
      /* 무시 */
    }
    return url;
  };
})();
