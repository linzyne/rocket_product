// 서허 화면과 같은 세계(MAIN world)에서 도는 작은 스크립트.
// "일괄등록 양식 다운로드"로 파일이 내려올 때, 화면이 받은 그 내용을 그대로 가로채 확장에 넘깁니다.
// (같은 주소를 확장이 다시 요청하면 서버가 거절해서(400) 이렇게 받습니다.)
(() => {
  if (window.__rocketShubHookInjected) return;
  window.__rocketShubHookInjected = true;

  const SRC = 'rocket-shub-hook';
  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  const isFile = (type, disp) =>
    /sheet|excel|octet-stream|vnd\.ms-excel/i.test(String(type || '')) || /attachment/i.test(String(disp || ''));

  const nameFrom = (disp, url) => {
    const m = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(String(disp || ''));
    if (m) {
      try {
        return decodeURIComponent(m[1].replace(/"/g, '').trim());
      } catch (err) {
        return m[1];
      }
    }
    const last = String(url || '').split('?')[0].split('/').pop();
    return last && /\.xlsx?$/i.test(last) ? last : '쉽먼트양식.xlsx';
  };

  const send = (buf, name) => {
    try {
      const bytes = new Uint8Array(buf);
      if (!bytes.length || bytes.length > 20 * 1024 * 1024) return;
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      window.postMessage({ source: SRC, type: 'FILE', name, dataUrl: `data:${XLSX_MIME};base64,${btoa(bin)}` }, '*');
    } catch (err) {}
  };

  // 양식이 "폼 전송"으로 내려오면 fetch/XHR로는 안 잡힌다. 그 폼의 주소와 값을 넘겨,
  // 확장이 똑같은 요청을 한 번 더 보내 내용을 받게 한다.
  const sendForm = (form) => {
    try {
      const fd = new FormData(form);
      const fields = [];
      fd.forEach((v, k) => {
        if (typeof v === 'string') fields.push([k, v]);
      });
      window.postMessage(
        { source: SRC, type: 'FORM', action: form.action || location.href, method: (form.method || 'POST').toUpperCase(), fields },
        '*'
      );
    } catch (err) {}
  };
  document.addEventListener('submit', (e) => { if (e.target && e.target.tagName === 'FORM') sendForm(e.target); }, true);
  const origFormSubmit = HTMLFormElement.prototype.submit;
  HTMLFormElement.prototype.submit = function (...a) {
    sendForm(this);
    return origFormSubmit.apply(this, a);
  };

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    try {
      const type = res.headers.get('content-type');
      const disp = res.headers.get('content-disposition');
      if (isFile(type, disp)) {
        const url = (args[0] && args[0].url) || args[0];
        res.clone().arrayBuffer().then((b) => send(b, nameFrom(disp, url))).catch(() => {});
      }
    } catch (err) {}
    return res;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u, ...rest) {
    this.__u = u;
    return origOpen.call(this, m, u, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', () => {
      try {
        const type = this.getResponseHeader('content-type');
        const disp = this.getResponseHeader('content-disposition');
        if (!isFile(type, disp)) return;
        const name = nameFrom(disp, this.__u);
        const body = this.response;
        if (body instanceof ArrayBuffer) send(body, name);
        else if (body instanceof Blob) body.arrayBuffer().then((b) => send(b, name)).catch(() => {});
      } catch (err) {}
    });
    return origSend.apply(this, args);
  };
})();
