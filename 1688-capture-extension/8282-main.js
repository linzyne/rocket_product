// 8282한중무역 신청서 페이지 안(MAIN world)에서 페이지 함수를 대신 불러준다.
// 확장 쪽 스크립트(8282.js)는 페이지의 전역 함수(fnImgChg 등)를 직접 부를 수 없어서 이 중계가 필요하다.
// 정해 둔 함수만 부른다.
(() => {
  if (window.__rocket8282MainInjected) return;
  window.__rocket8282MainInjected = true;
  const ALLOWED = new Set(['fnImgChg', 'fnTotalProPrice', 'fnProPlus', 'fnTrkNoAfChk']);
  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.source !== 'rocket-8282' || d.type !== 'CALL') return;
    let ok = false;
    let error = '';
    try {
      const fn = window[d.fn];
      if (!ALLOWED.has(d.fn)) error = '허용하지 않은 함수';
      else if (typeof fn !== 'function') error = `${d.fn} 함수가 없어요`;
      else {
        fn.apply(window, Array.isArray(d.args) ? d.args : []);
        ok = true;
      }
    } catch (err) {
      error = String((err && err.message) || err);
    }
    window.postMessage({ source: 'rocket-8282-main', type: 'CALLED', id: d.id, ok, error }, window.location.origin);
  });
})();
