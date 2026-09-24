(function () {
  'use strict';

  if (window.__rocketCaptureInjected) return;
  window.__rocketCaptureInjected = true;

  // 1688 페이지가 자체 아이콘 폰트(iconfont)를 전역 선택자로 강제 적용해두는 경우가 많아,
  // 일반 DOM에 삽입하면 우리 텍스트까지 그 폰트로 렌더링되어 글자가 깨진다.
  // Shadow DOM + :host{all:initial}으로 페이지 스타일 상속을 완전히 차단한다.
  // 1688은 중국어 페이지라 크롬이 "이 페이지 번역"을 자동으로 걸어두는 경우가 많은데, 그 번역기가
  // Shadow DOM 안의 우리 텍스트(이미 한국어인데도)까지 건드려서 "제조사"→"누구", "높이"→"안녕하세요"
  // 처럼 글자가 완전히 엉뚱하게 바뀌는 문제가 있었다. translate="no"로 이 영역 전체를 번역 대상에서
  // 제외한다.
  const shadowHost = document.createElement('div');
  shadowHost.id = 'rocket-1688-capture-root';
  shadowHost.setAttribute('translate', 'no');
  shadowHost.classList.add('notranslate');
  document.documentElement.appendChild(shadowHost);
  const root = shadowHost.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Malgun Gothic", Arial, sans-serif; }
    .rc-fab { position:fixed; bottom:24px; right:24px; z-index:2147483000; background:#f97316; color:#fff; border:none; padding:12px 16px; border-radius:9999px; font-size:14px; font-weight:600; cursor:pointer; box-shadow:0 10px 25px -5px rgba(0,0,0,0.5); }
    .rc-overlay { position:fixed; inset:0; z-index:2147483647; display:flex; align-items:flex-start; justify-content:center; padding:44px 0 20px; box-sizing:border-box; pointer-events:none; }
    .rc-box { pointer-events:auto; background:#ffffff; color:#1e293b; width:330px; max-width:94vw; max-height:calc(100vh - 64px); display:flex; flex-direction:column; overflow:hidden; border-radius:12px; padding:14px; border:1px solid #e2e8f0; box-shadow:0 25px 50px -12px rgba(0,0,0,0.35); }
    .rc-box h2 { margin:0; font-size:15px; font-weight:700; cursor:move; user-select:none; color:#0f172a; }
    .rc-box h2::after { content:'✥ 드래그해서 옮기기'; display:block; font-size:10px; font-weight:400; color:#94a3b8; margin-top:1px; }
    .rc-hint { margin:6px 0 0; font-size:11px; color:#64748b; line-height:1.4; }
    .rc-fields { display:flex; flex-direction:column; gap:12px; margin-top:12px; overflow-y:auto; overflow-x:hidden; flex:1 1 auto; min-height:0; padding:6px 3px 4px 1px; }
    .rc-section {
      background:#e2e8f0; border:1px solid #94a3b8; border-radius:12px; padding:14px 12px 12px;
    }
    .rc-section-heading {
      font-weight:700; font-size:12.5px; color:#0f172a; margin:0 0 9px; padding-bottom:8px;
      display:flex; align-items:center; gap:7px; border-bottom:1px solid #e2e8f0;
    }
    .rc-step-num {
      flex:0 0 auto; width:18px; height:18px; border-radius:9999px; background:#f97316; color:#fff;
      font-size:10.5px; font-weight:800; display:flex; align-items:center; justify-content:center;
    }
    .rc-field-group { display:flex; flex-direction:column; gap:6px; }
    .rc-label { font-size:11px; color:#64748b; }
    .rc-label-red { color:#64748b; }
    .rc-row { display:flex; gap:6px; }
    .rc-row > label { flex:1; min-width:0; }
    .rc-input { width:100%; margin-top:3px; padding:6px 8px; border-radius:6px; border:1px solid #cbd5e1; background:#ffffff; color:#0f172a; }
    .rc-actions { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:8px; margin-top:12px; }
    .rc-header-row {
      display:flex; align-items:flex-start; justify-content:space-between; gap:10px;
      position:sticky; top:0; z-index:5;
      margin:-14px -14px 0; padding:14px 14px 10px;
      background:#ffffff; border-bottom:1px solid #e2e8f0;
    }
    .rc-header-actions { display:flex; gap:6px; flex:0 0 auto; padding-top:1px; }
    .rc-header-actions .rc-btn-secondary { padding:5px 10px; font-size:11.5px; }
    .rc-btn-secondary { padding:8px 12px; border-radius:8px; border:1px solid #cbd5e1; background:#ffffff; color:#334155; cursor:pointer; font-size:12.5px; box-shadow:0 1px 2px rgba(0,0,0,0.05); }
    .rc-btn-secondary:hover { background:#f1f5f9; }
    .rc-btn-primary { flex:1 1 auto; padding:9px 12px; border-radius:8px; border:none; background:#3b82f6; color:#fff; font-weight:700; cursor:pointer; font-size:12.5px; box-shadow:0 4px 10px -2px rgba(59,130,246,0.5); }
    .rc-btn-primary:hover { background:#2563eb; }
    .rc-toast { position:fixed; bottom:24px; right:24px; z-index:2147483647; color:#fff; padding:12px 16px; border-radius:8px; font-size:13px; box-shadow:0 10px 25px -5px rgba(0,0,0,0.5); max-width:320px; }
    .rc-option-rows { display:flex; flex-direction:column; gap:6px; }
    .rc-option-card { border:1px solid #cbd5e1; border-radius:10px; padding:7px 10px; background:#f8fafc; }
    .rc-option-top { display:flex; align-items:center; gap:8px; margin-bottom:8px; }
    .rc-option-card:has(.rc-option-body[hidden]) .rc-option-top { margin-bottom:0; }
    .rc-option-top input[type="checkbox"] { flex:0 0 auto; width:16px; height:16px; accent-color:#f97316; }
    .rc-option-label { flex:1 1 auto; min-width:0; margin:0; color:#dc2626; }
    .rc-option-toggle { flex:0 0 auto; background:transparent; border:none; color:#64748b; cursor:pointer; font-size:13px; line-height:1; padding:2px 6px; }
    .rc-option-toggle:hover { color:#0f172a; }
    .rc-option-remove { flex:0 0 auto; background:transparent; border:none; color:#64748b; cursor:pointer; font-size:18px; line-height:1; padding:2px 4px; }
    .rc-option-remove:hover { color:#dc2626; }
    .rc-option-size-row { display:flex; align-items:center; gap:5px; margin-bottom:6px; }
    .rc-option-dim { flex:1 1 0; min-width:0; padding-left:4px; padding-right:4px; text-align:center; margin:0; }
    .rc-option-dim-sep { flex:0 0 auto; color:#94a3b8; font-size:11px; }
    .rc-option-price-row { display:flex; align-items:center; gap:6px; }
    .rc-option-price-row .rc-label { flex:0 0 auto; white-space:nowrap; }
    .rc-option-price { flex:1 1 auto; min-width:0; margin:0; }
    .rc-option-buttons { display:flex; flex-direction:column; align-items:center; gap:8px; margin-top:8px; }
    .rc-add-option { flex:0 0 auto; padding:6px 10px; border-radius:8px; border:1px dashed #cbd5e1; background:#ffffff; color:#64748b; cursor:pointer; font-size:11.5px; }
    .rc-add-option:hover { color:#0f172a; border-color:#94a3b8; }
    .rc-pick-option { width:100%; padding:11px 14px; border-radius:10px; border:none; background:linear-gradient(135deg,#fb923c,#f97316); color:#fff; cursor:pointer; font-size:13px; font-weight:700; text-align:center; box-shadow:0 6px 16px -4px rgba(249,115,22,0.55); transition:transform .12s ease, box-shadow .12s ease; }
    .rc-pick-option:hover { transform:translateY(-1px); box-shadow:0 8px 20px -4px rgba(249,115,22,0.65); }
    .rc-pick-option:active { transform:translateY(0); }
    .rc-pick-highlight { position:fixed; pointer-events:none; z-index:2147483646; border:2px solid #f97316; background:rgba(249,115,22,0.15); border-radius:4px; display:none; }
    .rc-pick-bar { position:fixed; top:16px; left:50%; transform:translateX(-50%); z-index:2147483647; background:#dc2626; color:#ffffff; padding:16px 24px; border-radius:14px; border:2px solid #7f1d1d; box-shadow:0 20px 40px -10px rgba(0,0,0,0.5); font-size:17px; font-weight:700; display:flex; align-items:center; gap:16px; max-width:90vw; pointer-events:auto; }
    .rc-pick-bar span { min-width:0; }
    .rc-pick-bar button { flex:0 0 auto; padding:9px 22px; border-radius:9999px; border:none; background:#f97316; color:#fff; font-weight:700; cursor:pointer; font-size:15px; }
    .rc-pick-warn { display:block; font-size:12px; font-weight:600; color:#fde047; margin-top:2px; }
    .rc-pick-bar button.rc-pick-cancel { background:#ffffff; color:#b91c1c; border:1px solid #fecaca; }
    .rc-margin-result { display:grid; grid-template-columns:1fr 1fr; gap:6px; margin:8px 0 4px; }
    .rc-margin-result-item { background:#f8fafc; border:1px solid #cbd5e1; border-radius:8px; padding:8px 10px; }
    .rc-margin-result-item span { display:block; font-size:10px; color:#64748b; }
    .rc-margin-result-item strong { display:block; font-size:15px; font-weight:700; color:#0f172a; margin-top:2px; }
    .rc-margin-result-item.supply strong { color:#059669; }
    .rc-margin-result-item.sell strong { color:#d97706; }
    .rc-margin-result-item.rocket strong { color:#2563eb; }
    .rc-margin-result-item.profit strong { color:#16a34a; }
    .rc-apply-price-btn { width:100%; padding:10px 14px; border-radius:10px; border:none; background:linear-gradient(135deg,#fb923c,#f97316); color:#fff; cursor:pointer; font-size:13px; font-weight:700; margin-top:10px; box-shadow:0 6px 16px -4px rgba(249,115,22,0.55); transition:transform .12s ease, box-shadow .12s ease; }
    .rc-apply-price-btn:hover { transform:translateY(-1px); box-shadow:0 8px 20px -4px rgba(249,115,22,0.65); }
    .rc-apply-price-btn:active { transform:translateY(0); }
    .rc-textarea { min-height:70px; resize:vertical; font-family:inherit; line-height:1.5; }
    .rc-step-hint { margin:0 0 8px; font-size:11px; color:#94a3b8; line-height:1.5; }
    .rc-image-work-btn { width:100%; padding:10px 14px; border-radius:10px; border:none; background:linear-gradient(135deg,#60a5fa,#3b82f6); color:#fff; cursor:pointer; font-size:13px; font-weight:700; margin-top:8px; box-shadow:0 6px 16px -4px rgba(59,130,246,0.55); transition:transform .12s ease, box-shadow .12s ease; }
    .rc-image-work-btn:hover { transform:translateY(-1px); box-shadow:0 8px 20px -4px rgba(59,130,246,0.65); }
    .rc-image-work-btn:active { transform:translateY(0); }
    .rc-image-toolbar { display:flex; align-items:center; gap:6px; margin-top:8px; }
    .rc-image-count { margin-left:auto; font-size:11px; color:#64748b; }
    .rc-image-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:6px; margin-top:8px; max-height:240px; overflow-y:auto; padding:2px; }
    .rc-image-tile { position:relative; aspect-ratio:1/1; padding:0; border:2px solid #cbd5e1; border-radius:8px; overflow:hidden; background:#fff; cursor:pointer; }
    .rc-image-tile img { width:100%; height:100%; object-fit:cover; display:block; }
    .rc-image-tile.on { border-color:#f97316; }
    .rc-image-tile.dragging { opacity:0.4; }
    .rc-image-tile.drop { border-color:#3b82f6; }
    .rc-image-check { position:absolute; top:3px; left:3px; width:16px; height:16px; border-radius:5px; background:rgba(255,255,255,0.92); color:#f97316; font-size:11px; font-weight:800; display:flex; align-items:center; justify-content:center; }
    .rc-image-star { position:absolute; top:3px; right:3px; width:18px; height:18px; border-radius:5px; background:rgba(255,255,255,0.92); color:#cbd5e1; font-size:12px; line-height:18px; text-align:center; cursor:pointer; }
    .rc-image-star:hover { color:#f59e0b; }
    .rc-image-star.on { color:#f59e0b; background:rgba(255,255,255,0.98); }
    .rc-image-kind { position:absolute; left:0; right:0; bottom:0; background:rgba(15,23,42,0.6); color:#fff; font-size:9px; padding:2px 0; text-align:center; }
    .rc-image-status { margin:6px 0 0; }
    .rc-quote-row { display:flex; gap:6px; align-items:center; }
    .rc-quote-row .rc-input { margin-top:0; }
    .rc-quote-search { flex:0 0 auto; padding:7px 14px; border-radius:8px; border:none; background:#3b82f6; color:#fff; font-size:12px; font-weight:700; cursor:pointer; }
    .rc-quote-search:hover { background:#2563eb; }
    .rc-quote-search:disabled { background:#94a3b8; cursor:not-allowed; }
    .rc-quote-words { display:flex; flex-wrap:wrap; gap:4px; margin-top:6px; }
    .rc-quote-word { padding:3px 9px; border-radius:9999px; border:1px solid #cbd5e1; background:#fff; color:#475569; font-size:11px; cursor:pointer; }
    .rc-quote-word:hover { border-color:#3b82f6; color:#1d4ed8; }
    .rc-quote-word.on { background:#3b82f6; border-color:#3b82f6; color:#fff; }
    .rc-quote-results { display:flex; flex-direction:column; gap:4px; margin-top:8px; max-height:190px; overflow-y:auto; }
    .rc-quote-item { text-align:left; padding:7px 9px; border-radius:8px; border:1px solid #cbd5e1; background:#fff; color:#0f172a; font-size:11.5px; line-height:1.4; cursor:pointer; }
    .rc-quote-item:hover { border-color:#3b82f6; background:#eff6ff; }
    .rc-quote-done { margin-top:8px; padding:8px 10px; border-radius:8px; background:#dcfce7; border:1px solid #86efac; color:#166534; font-size:11.5px; line-height:1.4; }
    .rc-option-calc { display:grid; grid-template-columns:1fr 1fr; gap:5px; margin-top:6px; }
    .rc-calc-chip { font-size:10.5px; padding:4px 6px; border-radius:8px; background:#f8fafc; border:1px solid #cbd5e1; color:#64748b; white-space:nowrap; text-align:center; overflow:hidden; text-overflow:ellipsis; }
    .rc-calc-chip strong { display:block; color:#0f172a; font-weight:700; font-size:12px; }
    .rc-calc-chip-input { display:block; width:100%; margin:1px 0 0; padding:0; border:none; border-bottom:1px dashed rgba(100,116,139,0.4); background:transparent; color:#0f172a; font-weight:700; font-size:12px; text-align:center; font-family:inherit; cursor:text; }
    .rc-calc-chip-input::placeholder { color:#94a3b8; font-weight:400; }
    .rc-calc-chip-input:focus { outline:none; border-bottom-style:solid; }
    .rc-calc-chip-input::-webkit-inner-spin-button, .rc-calc-chip-input::-webkit-outer-spin-button { margin:0; }
    .rc-calc-chip.supply { border-color:rgba(5,150,105,0.4); }
    .rc-calc-chip.supply strong, .rc-calc-chip.supply .rc-calc-chip-input { color:#059669; }
    .rc-calc-chip.supply .rc-calc-chip-input { border-bottom-color:rgba(5,150,105,0.45); }
    .rc-calc-chip.sell { border-color:rgba(217,119,6,0.4); }
    .rc-calc-chip.sell strong, .rc-calc-chip.sell .rc-calc-chip-input { color:#d97706; }
    .rc-calc-chip.sell .rc-calc-chip-input { border-bottom-color:rgba(217,119,6,0.45); }
    .rc-calc-chip.rocket { border-color:rgba(37,99,235,0.4); }
    .rc-calc-chip.rocket strong { color:#2563eb; }
    .rc-calc-chip.profit { border-color:rgba(22,163,74,0.4); }
    .rc-calc-chip.profit strong { color:#16a34a; }
    .rc-option-calc-btn { flex:0 0 auto; background:transparent; border:none; color:#2563eb; cursor:pointer; font-size:16px; line-height:1; padding:2px 4px; }
    .rc-option-calc-btn:hover { color:#1d4ed8; }
    .rc-sub-backdrop { position:fixed; inset:0; z-index:2147483647; background:rgba(15,23,42,0.55); display:flex; align-items:center; justify-content:center; padding:16px; }
    .rc-sub-box { background:#ffffff; color:#1e293b; width:340px; max-width:100%; max-height:88vh; overflow-y:auto; border-radius:12px; padding:16px; border:1px solid #e2e8f0; box-shadow:0 25px 50px -12px rgba(0,0,0,0.35); position:relative; }
    .rc-sub-box h3 { margin:0 0 4px; font-size:15px; font-weight:700; padding-right:22px; color:#0f172a; }
    .rc-sub-box .rc-label { display:block; margin-top:12px; }
    .rc-sub-box .rc-label:first-of-type { margin-top:0; }
    .rc-sub-close { position:absolute; top:14px; right:14px; background:transparent; border:none; color:#64748b; font-size:18px; cursor:pointer; line-height:1; }
    .rc-sub-close:hover { color:#0f172a; }
    .rc-sub-hint { font-size:11px; color:#64748b; margin:0 0 14px; line-height:1.5; }
    .rc-sub-result-box { background:#f1f5f9; border:1px solid #e2e8f0; border-radius:8px; padding:10px 12px; margin:12px 0; }
    .rc-sub-result-title { font-size:11px; font-weight:600; color:#64748b; }
    .rc-sub-result-value { font-size:19px; font-weight:700; color:#2563eb; margin:2px 0 0; }
    .rc-sub-result-formula { font-size:10px; color:#94a3b8; margin:3px 0 0; }
    .rc-sub-field-note { font-size:11px; color:#334155; margin:6px 0 0; }
    .rc-sub-field-note strong { color:#059669; }
    .rc-sub-amount-line { display:flex; justify-content:space-between; font-size:12px; margin-top:4px; color:#334155; }
    .rc-sub-amount-line strong { color:#d97706; }
    .rc-sub-toggle { width:100%; text-align:left; background:#f1f5f9; border:1px solid #cbd5e1; color:#334155; padding:8px 10px; border-radius:6px; font-size:11px; font-weight:600; cursor:pointer; display:flex; justify-content:space-between; align-items:center; margin:14px 0 10px; }
    .rc-sub-tax { display:none; border:1px solid #cbd5e1; border-radius:6px; padding:10px; margin:-4px 0 12px; background:#f8fafc; }
    .rc-sub-tax.open { display:block; }
    .rc-sub-tax-row { display:flex; justify-content:space-between; font-size:11px; padding:2px 0; color:#334155; }
    .rc-sub-tax-row.total { border-top:1px solid #cbd5e1; margin-top:4px; padding-top:6px; font-weight:700; color:#dc2626; }
    .rc-sub-final { background:#f1f5f9; border:1px solid #e2e8f0; border-radius:8px; padding:12px; margin-top:14px; }
    .rc-sub-final-row { display:flex; justify-content:space-between; align-items:center; font-size:12px; color:#334155; }
    .rc-sub-final-row + .rc-sub-final-row { margin-top:6px; }
    .rc-sub-final-row.split { border-top:1px solid #cbd5e1; margin-top:8px; padding-top:8px; }
    .rc-sub-final-label { font-size:13px; font-weight:700; color:#0f172a; }
    .rc-sub-final-value { font-size:20px; font-weight:700; color:#16a34a; }
    .rc-sub-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:16px; }
    .rc-sub-btn-secondary { padding:8px 12px; border-radius:8px; border:1px solid #cbd5e1; background:#ffffff; color:#334155; cursor:pointer; font-size:12.5px; }
    .rc-sub-btn-secondary:hover { background:#f1f5f9; }
    .rc-sub-btn-primary { padding:8px 14px; border-radius:8px; border:none; background:#3b82f6; color:#fff; font-weight:700; cursor:pointer; font-size:12.5px; box-shadow:0 4px 10px -2px rgba(59,130,246,0.5); }
    .rc-sub-btn-primary:hover { background:#2563eb; }
    .rc-sub-btn-primary:disabled { background:#cbd5e1; color:#f8fafc; cursor:not-allowed; box-shadow:none; }
  `;
  root.appendChild(style);

  // 로켓 앱의 수익 계산기(MarginCalculatorModal)와 동일한 계산식. 옵션별 위안화 가격에
  // 공급/판매 마진율을 적용해 원가·공급가·판매가를 미리 계산해두면, 복사 → 앱에서 붙여넣기 시
  // 그 값이 그대로 원가/공급가/판매가 칸에 채워진다(별도로 앱 계산기를 다시 열 필요가 없어진다).
  const CNY_BASE_RATE_DEFAULT = 210;
  const CNY_RATE_STORAGE_KEY = 'cnyExchangeRate';
  const SUPPLY_MARGIN_STORAGE_KEY = 'marginCalcSupplyPercent';
  const SELLING_MARGIN_STORAGE_KEY = 'marginCalcSellingPercent';
  const FEE_RATE = 0.1;
  const VAT_RATE = 0.1;
  const COMPREHENSIVE_INCOME_TAX_RATE = 0.06;
  const LOCAL_INCOME_TAX_RATE = 0.1;

  const roundupToNearest100 = (num) => {
    if (isNaN(num) || !isFinite(num)) return 0;
    return Math.ceil(num / 100) * 100;
  };

  // priceCny/exchangeRate/마진율(%)로부터 원가(KRW, 수수료+VAT 포함)·공급가·판매가·최종 순수익을
  // 계산한다. 입력이 부족하면(가격/환율 없음) null을 돌려줘서 호출부가 "계산 안 됨"으로 처리하게 한다.
  // supplyOverride/sellOverride를 주면(옵션 행에서 사용자가 공급가/판매가 칸을 직접 고친 경우)
  // 마진율 계산 대신 그 값을 그대로 쓴다 — 순수익은 그 경우에도 (공급가-원가) 기준으로 다시 계산된다.
  function computeMargin(priceCny, exchangeRate, supplyMarginPercent, sellingMarginPercent, supplyOverride, sellOverride) {
    const cny = parseFloat(priceCny);
    const rate = parseFloat(exchangeRate);
    if (isNaN(cny) || cny <= 0 || isNaN(rate) || rate <= 0) return null;

    const costInKrw = cny * rate;
    const costWithFee = costInKrw * (1 + FEE_RATE);
    const costPriceKrw = Math.round(costWithFee * (1 + VAT_RATE));

    let supplyPriceKrw;
    if (typeof supplyOverride === 'number' && supplyOverride > 0) {
      supplyPriceKrw = Math.round(supplyOverride);
    } else {
      const supplyMarginValue = parseFloat(supplyMarginPercent);
      supplyPriceKrw = !isNaN(supplyMarginValue) && supplyMarginValue < 100 && costPriceKrw > 0
        ? roundupToNearest100(costPriceKrw / (1 - supplyMarginValue / 100))
        : 0;
    }
    if (supplyPriceKrw <= 0) {
      return {
        costPriceKrw, supplyPriceKrw: 0, sellingPriceKrw: 0, marginKrw: 0,
        inputVat: 0, outputVat: 0, vatPayable: 0, grossMargin: 0, marginAfterVat: 0, comprehensiveIncomeTax: 0,
      };
    }

    let sellingPriceKrw;
    if (typeof sellOverride === 'number' && sellOverride > 0) {
      sellingPriceKrw = Math.round(sellOverride);
    } else {
      const sellingMarginValue = parseFloat(sellingMarginPercent);
      sellingPriceKrw = !isNaN(sellingMarginValue) && sellingMarginValue < 100
        ? roundupToNearest100(supplyPriceKrw / (1 - sellingMarginValue / 100))
        : 0;
    }

    const inputVat = Math.round(costPriceKrw - (costPriceKrw / (1 + VAT_RATE)));
    const outputVat = Math.round(supplyPriceKrw - (supplyPriceKrw / (1 + VAT_RATE)));
    const vatPayable = outputVat > inputVat ? outputVat - inputVat : 0;
    const grossMargin = supplyPriceKrw - costPriceKrw;
    const marginAfterVat = grossMargin - vatPayable;
    const effectiveIncomeTaxRate = COMPREHENSIVE_INCOME_TAX_RATE * (1 + LOCAL_INCOME_TAX_RATE);
    const comprehensiveIncomeTax = marginAfterVat > 0 ? Math.round(marginAfterVat * effectiveIncomeTaxRate) : 0;
    const marginKrw = marginAfterVat - comprehensiveIncomeTax;

    return {
      costPriceKrw, supplyPriceKrw, sellingPriceKrw, marginKrw,
      inputVat, outputVat, vatPayable, grossMargin, marginAfterVat, comprehensiveIncomeTax,
    };
  }

  // 회사명 패턴(예: "OO유한공사"). 상품명 폴백이 이 패턴과 겹치면 그 값은 버린다.
  const COMPANY_NAME_RE = /^[一-龥]{2,20}(?:有限公司|公司)$/;

  function guessTitle() {
    // '.module-od-title .title-content'는 1688이 2025년에 새로 바꾼 상세페이지(od-version-2025) 구조.
    // 옛 셀렉터는 마이그레이션 안 된 페이지를 위해 폴백으로 남겨둔다.
    const selectors = [
      '.module-od-title .title-content',
      '.title-content.title-content-multi-line',
      '.title-content',
      'h1.d-title',
      '.od-pc-offer-title',
      '.title-text',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      const text = el && el.textContent && el.textContent.trim();
      if (text && !COMPANY_NAME_RE.test(text)) return text;
    }
    const og = document.querySelector('meta[property="og:title"]');
    if (og && og.content) {
      const text = og.content.trim();
      if (text && !COMPANY_NAME_RE.test(text)) return text;
    }
    // document.title은 "상품명 - 阿里巴巴" 형식이라 사이트명 접미사를 잘라낸다.
    const docTitle = document.title.trim().replace(/\s*-\s*(阿里巴巴|1688(?:\.com)?)\s*$/i, '').trim();
    return COMPANY_NAME_RE.test(docTitle) ? '' : docTitle;
  }

  function guessManufacturer() {
    // '.shop-company-name'이 od-version-2025 구조의 실제 셀렉터. 나머지는 옛 페이지용 폴백.
    const selectors = ['.shop-company-name', '.company-name', '.shop-name', '.stall-name', '[class*="company-name"]'];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      const text = el && el.textContent && el.textContent.trim();
      if (text) return text;
    }
    const text = document.body.innerText || '';
    const m = text.match(/[一-龥]{2,20}(?:有限公司|公司)/);
    return m ? m[0] : '';
  }

  function guessSku() {
    const m = location.href.match(/\/offer\/(\d+)/);
    return m ? m[1] : '';
  }

  const SELECTED_OPTION_SELECTORS = ['.sku-selected', '.sku-value-selected', '[class*="sku-item"].selected', '[class*="attr-value"].selected', '[class*="sku-prop"] .selected'];

  function guessColor() {
    for (const sel of SELECTED_OPTION_SELECTORS) {
      const el = document.querySelector(sel);
      const text = el && el.textContent && el.textContent.trim();
      if (text) return text;
    }
    const text = document.body.innerText || '';
    const m = text.match(/颜色[:：]\s*([^\n,，]{1,20})/);
    return m ? m[1].trim() : '';
  }

  function guessPriceCny() {
    // 1688이 해외구매자용으로 원화(₩) 환산 가격을 같이 보여주는 경우가 많고, 그 원화 표시 요소도
    // class에 "price"가 들어있는 경우가 흔해서, ¥/￥ 기호가 실제로 붙어있는 텍스트만 위안화로
    // 인정한다(₩로 표시된 원화 값을 위안화로 착각해서 잘못 읽는 것을 막기 위함).
    const priceEls = document.querySelectorAll('[class*="price" i]');
    const CNY_RE = /[¥￥]/;
    // 1차: ¥/￥ 기호가 있고 소수점도 있는 값을 우선한다(위안화 가격은 거의 항상 xx.xx 형태).
    for (const el of priceEls) {
      const text = el.textContent || '';
      if (!CNY_RE.test(text)) continue;
      const m = text.match(/[¥￥]\s?(\d+(?:,\d{3})*\.\d{1,2})/);
      if (m) {
        const val = parseFloat(m[1].replace(/,/g, ''));
        if (!isNaN(val) && val > 0 && val < 1000000) return val;
      }
    }
    // 2차: ¥/￥ 기호는 있는데 소수점 없는 값(정수)도 허용한다.
    for (const el of priceEls) {
      const text = el.textContent || '';
      if (!CNY_RE.test(text)) continue;
      const m = text.match(/[¥￥]\s?(\d+(?:,\d{3})*(?:\.\d+)?)/);
      if (m) {
        const val = parseFloat(m[1].replace(/,/g, ''));
        if (!isNaN(val) && val > 0 && val < 1000000) return val;
      }
    }
    const bodyText = document.body.innerText || '';
    const m2 = bodyText.match(/[¥￥]\s?(\d+(?:,\d{3})*\.\d{1,2})/) || bodyText.match(/[¥￥]\s?(\d+(?:,\d{3})*(?:\.\d+)?)/);
    if (m2) {
      const val = parseFloat(m2[1].replace(/,/g, ''));
      if (!isNaN(val)) return val;
    }
    return null;
  }

  function guessSizeAndWeight() {
    const text = document.body.innerText || '';
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    let width = null, height = null, depth = null, weight = null;

    for (const line of lines) {
      if (width === null) {
        const dim = line.match(/(\d+(?:\.\d+)?)\s*[*×xX]\s*(\d+(?:\.\d+)?)\s*[*×xX]\s*(\d+(?:\.\d+)?)/);
        if (dim) {
          width = parseFloat(dim[1]);
          height = parseFloat(dim[2]);
          depth = parseFloat(dim[3]);
        }
      }
      if (weight === null && /重量|毛重|净重/.test(line)) {
        const wm = line.match(/(\d+(?:\.\d+)?)\s*(kg|KG|千克|g|G|克)/);
        if (wm) {
          let val = parseFloat(wm[1]);
          if (/kg|KG|千克/.test(wm[2])) val *= 1000;
          weight = Math.round(val);
        }
      }
      if (width !== null && weight !== null) break;
    }
    return { width, height, depth, weight };
  }

  const DRAFT_KEY = 'rocket1688Draft';

  // 확장 프로그램이 재로드/업데이트된 뒤에도 이 페이지의 content script는 옛 컨텍스트에 묶인 채
  // 남아있을 수 있다("Extension context invalidated"). 이 경우 chrome.storage 호출이 던지므로,
  // 매번 감싸서 페이지를 새로고침하기 전까지는 draft 없이 조용히 동작하도록 한다.
  function isExtensionContextValid() {
    return !!(chrome.runtime && chrome.runtime.id);
  }

  function loadDraft() {
    return new Promise((resolve) => {
      if (!isExtensionContextValid()) return resolve(null);
      try {
        chrome.storage.local.get(DRAFT_KEY, (result) => resolve(result[DRAFT_KEY] || null));
      } catch (err) {
        resolve(null);
      }
    });
  }

  function saveDraft(values) {
    if (!isExtensionContextValid()) return;
    try {
      chrome.storage.local.set({ [DRAFT_KEY]: values });
    } catch (err) {
      // 컨텍스트 무효화 등으로 저장 실패 시 무시 (페이지 새로고침하면 정상 동작)
    }
  }

  function clearDraft() {
    if (!isExtensionContextValid()) return;
    try {
      chrome.storage.local.remove(DRAFT_KEY);
    } catch (err) {
      // 위와 동일
    }
  }

  // 환율/마진율은 확장프로그램 팝업(수익 계산기)과 같은 키를 써서 값을 공유한다(팝업에서
  // 입력한 환율을 여기서도 그대로 이어 쓸 수 있게).
  function loadMarginSettings() {
    return new Promise((resolve) => {
      const fallback = { exchangeRate: CNY_BASE_RATE_DEFAULT, supplyMarginPercent: '', sellingMarginPercent: '' };
      if (!isExtensionContextValid()) return resolve(fallback);
      try {
        chrome.storage.local.get(
          [CNY_RATE_STORAGE_KEY, SUPPLY_MARGIN_STORAGE_KEY, SELLING_MARGIN_STORAGE_KEY],
          (result) => {
            const rate = parseFloat(result[CNY_RATE_STORAGE_KEY]);
            resolve({
              exchangeRate: !isNaN(rate) && rate > 0 ? rate : CNY_BASE_RATE_DEFAULT,
              supplyMarginPercent: result[SUPPLY_MARGIN_STORAGE_KEY] ?? '',
              sellingMarginPercent: result[SELLING_MARGIN_STORAGE_KEY] ?? '',
            });
          }
        );
      } catch (err) {
        resolve(fallback);
      }
    });
  }

  function saveMarginSettings(values) {
    if (!isExtensionContextValid()) return;
    try {
      chrome.storage.local.set({
        [CNY_RATE_STORAGE_KEY]: values.exchangeRate,
        [SUPPLY_MARGIN_STORAGE_KEY]: values.supplyMarginPercent,
        [SELLING_MARGIN_STORAGE_KEY]: values.sellingMarginPercent,
      });
    } catch (err) {
      // 위와 동일
    }
  }

  const WORK_DRAFT_KEY = 'rocket1688WorkDraft';

  // 옵션 행(라벨/사이즈/가격/체크 여부)과 "수익 계산기" 미리보기 입력(위안가격/사이즈)은 작업하다
  // 창을 닫았다 다시 열어도(또는 페이지를 오갔다 와도) 그대로 남아있어야 한다 — 사용자가 "초기화"
  // 버튼을 직접 누르기 전까지는 절대 지우지 않는다.
  function loadWorkDraft() {
    return new Promise((resolve) => {
      if (!isExtensionContextValid()) return resolve(null);
      try {
        chrome.storage.local.get(WORK_DRAFT_KEY, (result) => resolve(result[WORK_DRAFT_KEY] || null));
      } catch (err) {
        resolve(null);
      }
    });
  }

  function saveWorkDraft(values) {
    if (!isExtensionContextValid()) return;
    try {
      chrome.storage.local.set({ [WORK_DRAFT_KEY]: values });
    } catch (err) {
      // 위와 동일
    }
  }

  function clearWorkDraft() {
    if (!isExtensionContextValid()) return;
    try {
      chrome.storage.local.remove(WORK_DRAFT_KEY);
    } catch (err) {
      // 위와 동일
    }
  }

  // 상품명/제조사/SKU/재질/중량은 상품이 바뀌어도 재사용하고 싶어하는 값이라 draft로 유지한다.
  function readFormValues(box) {
    return {
      title: box.querySelector('#rc-title').value,
      manufacturer: box.querySelector('#rc-manufacturer').value,
      sku: box.querySelector('#rc-sku').value,
      sellingPoints: box.querySelector('#rc-selling-points').value,
      detailCopyText: box.querySelector('#rc-detail-copy').value,
      material: box.querySelector('#rc-material').value,
      weight: box.querySelector('#rc-weight').value,
    };
  }

  function applyValues(box, values) {
    box.querySelector('#rc-title').value = values.title ?? '';
    box.querySelector('#rc-manufacturer').value = values.manufacturer ?? '';
    box.querySelector('#rc-sku').value = values.sku ?? '';
    box.querySelector('#rc-selling-points').value = values.sellingPoints ?? '';
    box.querySelector('#rc-detail-copy').value = values.detailCopyText ?? '';
    box.querySelector('#rc-material').value = values.material ?? '';
    box.querySelector('#rc-weight').value = values.weight ?? '';
    // 이전에 저장된(draft) 값이 그대로 채워진 직후에는 '아직 안 건드림' 상태로 표시해서,
    // 필드를 처음 클릭했을 때 이전 값을 바로 지우고 새로 입력할 수 있게 한다.
    box.querySelectorAll('.rc-input').forEach((input) => { input.dataset.rcPristine = '1'; });
  }

  function valuesFromGuess(initial) {
    return {
      title: initial.titleRaw || '',
      manufacturer: initial.manufacturerRaw || '',
      sku: '',
      sellingPoints: '',
      detailCopyText: '',
      material: initial.materialRaw || '',
      weight: initial.weightG ?? '',
    };
  }

  // handle(제목 표시줄)을 잡고 끌면 box를 옮긴다. 처음엔 overlay의 flex 중앙 정렬로 위치가
  // 잡혀 있으므로, 드래그가 시작되는 순간 현재 화면상 위치를 그대로 fixed left/top으로 고정해서
  // 중앙으로 되돌아가지 않게 한다. 화면 밖으로 완전히 사라지지 않도록 위치를 살짝 clamp한다.
  function makeDraggable(box, handle) {
    let dragging = false;
    let startX = 0, startY = 0, startLeft = 0, startTop = 0;

    handle.addEventListener('mousedown', (e) => {
      if (e.target !== handle) return; // h2 안의 다른 요소(없지만 방어적으로) 클릭은 무시
      dragging = true;
      const rect = box.getBoundingClientRect();
      box.style.position = 'fixed';
      box.style.left = `${rect.left}px`;
      box.style.top = `${rect.top}px`;
      box.style.margin = '0';
      startX = e.clientX;
      startY = e.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const margin = 24;
      const maxLeft = window.innerWidth - margin;
      const maxTop = window.innerHeight - margin;
      const nextLeft = Math.min(Math.max(startLeft + (e.clientX - startX), -box.offsetWidth + margin), maxLeft);
      const nextTop = Math.min(Math.max(startTop + (e.clientY - startY), 0), maxTop);
      box.style.left = `${nextLeft}px`;
      box.style.top = `${nextTop}px`;
    });

    window.addEventListener('mouseup', () => { dragging = false; });
  }

  // 자동 스캔은 페이지에 설치된 다른 확장프로그램(가격비교 도구 등)이 끼워넣은 메뉴까지
  // "반복되는 짧은 텍스트"로 오인해서 잘못 잡는 경우가 많아 신뢰할 수 없다. 대신 사용자가
  // 마우스로 실제 옵션 요소를 직접 가리켜서 클릭하는 방식으로, 클릭한 요소의 텍스트만 정확히
  // 옵션으로 추가한다. onAdd(text)는 클릭할 때마다 호출되고, 완료(Esc 또는 버튼)되면 resolve된다.

  // 로켓 앱의 renderCopyPrompt(utils/detailPageCopyTemplate.ts)와 같은 결과를 내야 한다.
  // 라벨과 줄 구성이 어긋나면 앱이 AI 답변을 알아보지 못하므로 그대로 맞춰 둔다.
  //
  // 프롬프트 전문과 섹션 개수는 앱의 상세페이지 에디터에서 사용자가 직접 정한다. 정한 값은
  // app-bridge.js가 chrome.storage.local에 넣어두므로 여기서 읽어 쓰고, 아직 한 번도 정한 적이
  // 없으면 앱과 같은 기본값을 쓴다(utils/detailPageCopyPrompt.ts).
  const DEFAULT_COPY_SETTINGS = {
    template: [
      '아래 상품 정보를 참고해서 쇼핑몰 상세페이지 문구를 작성해줘.',
      '과장되거나 근거 없는 표현(효능 단정, 최상급 남발)은 피하고, 담백하면서도 매력적인 톤으로 써줘.',
      '',
      '상품명: {상품명}',
      '카테고리: {카테고리}',
      '소재: {소재}',
      '소구점 메모: {소구점}',
      '',
      '{응답형식}',
    ].join('\n'),
    highlightCount: 4,
    featureBlockCount: 3,
  };
  let copySettings = DEFAULT_COPY_SETTINGS;

  const normalizeCopySettings = (raw) => {
    if (!raw || typeof raw !== 'object') return DEFAULT_COPY_SETTINGS;
    const clamp = (value, fallback) => {
      const n = Math.round(Number(value));
      return Number.isFinite(n) && n >= 1 && n <= 8 ? n : fallback;
    };
    return {
      template: typeof raw.template === 'string' && raw.template.trim() ? raw.template : DEFAULT_COPY_SETTINGS.template,
      highlightCount: clamp(raw.highlightCount, DEFAULT_COPY_SETTINGS.highlightCount),
      featureBlockCount: clamp(raw.featureBlockCount, DEFAULT_COPY_SETTINGS.featureBlockCount),
    };
  };

  try {
    chrome.storage.local.get('detailCopySettings', (result) => {
      if (chrome.runtime.lastError) return;
      copySettings = normalizeCopySettings(result && result.detailCopySettings);
    });
    // 1688 창을 열어둔 채로 앱에서 프롬프트를 고치는 경우도 있어 바뀌면 바로 따라간다.
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.detailCopySettings) return;
      copySettings = normalizeCopySettings(changes.detailCopySettings.newValue);
    });
  } catch (err) {
    // 확장을 다시 로드해서 옛 스크립트가 남은 경우. 기본값으로 계속 동작한다.
  }

  // {응답형식} 자리에 들어가는 라벨 형식. 앱의 파서(parseDetailPageCopyText)가 읽는 규격이라
  // 사용자가 고칠 수 없고, 개수만 설정을 따라간다.
  function buildLabelFormatBlock(highlightCount, featureBlockCount) {
    const lines = [
      '아래 형식을 절대 그대로 지켜서 답변해줘 (라벨과 <사진> 표시, 줄 순서를 바꾸지 말고, 라벨 다음 줄에 내용만 채워줘):',
      '',
      '제품명',
      '(제품명 한 줄)',
      '',
      '후킹 문구',
      '(임팩트 있는 문구. 반드시 두 줄로 나눠 쓰고, 한 줄은 18자를 넘기지 마)',
      '',
      '<사진>',
      '',
    ];
    for (let i = 1; i <= highlightCount; i++) {
      lines.push(`특별한점 ${String(i).padStart(2, '0')}`, '(짧은 특징 한 줄)', '');
    }
    for (let i = 1; i <= featureBlockCount; i++) {
      lines.push(String(i).padStart(2, '0'), '(특징 소제목 한 줄)', '', '(특징 설명 2~3문장)', '<사진>', '');
    }
    lines.push('마무리 문구', '(마무리 한 줄)');
    return lines.join('\n');
  }

  function buildDetailPageCopyPrompt({ productName, category, material, sellingPoints }) {
    const { template, highlightCount, featureBlockCount } = copySettings;
    // {소재}가 든 줄은 소재가 비어 있으면 통째로 뺀다(앱의 renderCopyPrompt와 같은 규칙).
    const body = template
      .split('\n')
      .filter((line) => !(line.includes('{소재}') && !String(material || '').trim()))
      .join('\n');
    return body
      .replace(/\{상품명\}/g, productName || '(미입력)')
      .replace(/\{카테고리\}/g, category || '(미입력)')
      .replace(/\{소재\}/g, material || '')
      .replace(/\{소구점\}/g, sellingPoints || '(미입력)')
      .replace(/\{특별한점개수\}/g, String(highlightCount))
      .replace(/\{특징개수\}/g, String(featureBlockCount))
      .replace(/\{응답형식\}/g, buildLabelFormatBlock(highlightCount, featureBlockCount))
      .trim();
  }

  function startPickMode(onAdd) {
    return new Promise((resolve) => {
      const highlight = document.createElement('div');
      highlight.className = 'rc-pick-highlight';
      root.appendChild(highlight);

      const bar = document.createElement('div');
      bar.className = 'rc-pick-bar';
      // 크롬 번역이 켜져 있으면 <html>에 translated-* 클래스가 붙는다. 그 상태에서는 옵션명이
      // 번역문으로 들어가고 클릭이 잘 안 먹을 수 있어 미리 알려준다.
      const translated = /translated-(ltr|rtl)/.test(document.documentElement.className);
      bar.innerHTML = `<span>옵션을 클릭하세요 · <strong id="rc-pick-count" style="color:#fde047;">0</strong>개 선택됨${translated ? ' <span class="rc-pick-warn">크롬 번역을 끄면 원문 옵션명이 들어갑니다</span>' : ''}</span><button type="button" id="rc-pick-done">완료</button><button type="button" id="rc-pick-skip" class="rc-pick-cancel">옵션 없이 열기</button><button type="button" id="rc-pick-cancel" class="rc-pick-cancel">취소</button>`;
      root.appendChild(bar);
      const countEl = bar.querySelector('#rc-pick-count');
      let count = 0;

      const onMouseOver = (e) => {
        const target = e.target;
        if (target === shadowHost) { highlight.style.display = 'none'; return; }
        const rect = target.getBoundingClientRect();
        highlight.style.display = 'block';
        highlight.style.left = `${rect.left}px`;
        highlight.style.top = `${rect.top}px`;
        highlight.style.width = `${rect.width}px`;
        highlight.style.height = `${rect.height}px`;
      };

      // 크롬 "이 페이지 번역"을 켜면 글자가 <font> 안으로 들어가고 번역문으로 바뀐다. 그때는
      // 클릭한 곳에 글자가 없을 수 있어, 위로 올라가며 title/alt 같은 원문이 남아 있는 곳을 찾는다.
      const optionTextAt = (el) => {
        const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
        let node = el;
        for (let i = 0; i < 4 && node && node.getAttribute; i++) {
          const attr = clean(node.getAttribute('title') || node.getAttribute('aria-label') || node.getAttribute('data-name'));
          if (attr) return attr;
          const img = node.querySelector && node.querySelector('img[alt]');
          const alt = img && clean(img.getAttribute('alt'));
          if (alt) return alt;
          const text = clean(node.textContent);
          if (text) return text;
          node = node.parentElement;
        }
        return '';
      };

      const onClick = (e) => {
        const target = e.target;
        if (target === shadowHost) return; // 완료 버튼 등 우리 UI 클릭은 그대로 통과시킨다.
        e.preventDefault();
        e.stopPropagation();
        const text = optionTextAt(target);
        if (!text || text.length > 60) return;
        count += 1;
        countEl.textContent = String(count);
        onAdd(text);
      };

      const onKeyDown = (e) => {
        if (e.key === 'Escape') finish(true);
      };

      // cancelled=true면 고른 것을 쓰지 않는다(호출한 쪽에서 되돌린다).
      const finish = (cancelled) => {
        document.removeEventListener('mouseover', onMouseOver, true);
        document.removeEventListener('click', onClick, true);
        document.removeEventListener('keydown', onKeyDown, true);
        highlight.remove();
        bar.remove();
        resolve({ cancelled: !!cancelled });
      };

      bar.querySelector('#rc-pick-done').addEventListener('click', () => finish(false));
      // 옵션을 하나도 못 골라도(번역 중이거나 옵션이 없는 상품) 창은 열 수 있어야 한다.
      bar.querySelector('#rc-pick-skip').addEventListener('click', () => finish(false));
      bar.querySelector('#rc-pick-cancel').addEventListener('click', () => finish(true));
      document.addEventListener('mouseover', onMouseOver, true);
      document.addEventListener('click', onClick, true);
      document.addEventListener('keydown', onKeyDown, true);
    });
  }

  // 지금 열려 있는 "값 확인" 창. 상세페이지 에디터 창이 닫혔을 때 여기에 대고 복사를 묻는다.
  let currentBox = null;

  try {
    chrome.runtime.onMessage.addListener((message) => {
      if (!message || !message.type) return;

      // 카테고리 검색 결과·견적서 파일(서플라이어허브 탭에서 background.js를 거쳐 온다).
      if (categoryHandlers) {
        if (message.type === 'CATEGORY_RESULTS') {
          categoryHandlers.onResults(Array.isArray(message.items) ? message.items : []);
          return;
        }
        if (message.type === 'CATEGORY_FILE') {
          categoryHandlers.onFile({ name: message.name, dataUrl: message.dataUrl, path: message.path });
          return;
        }
        if (message.type === 'CATEGORY_ERROR') {
          categoryHandlers.onError(String(message.message || '알 수 없는 오류'));
          return;
        }
      }

      if (message.type !== 'DETAIL_EDITOR_CLOSED' || !currentBox) return;
      const copyBtn = currentBox.querySelector('#rc-copy');
      if (!copyBtn) return;
      if (window.confirm('로켓으로 보낼 값을 복사할까요?')) copyBtn.click();
    });
  } catch (err) {
    /* 확장이 새로 로드된 경우 무시 */
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // ---- 페이지 사진 모으기 ----
  // 상세페이지 에디터로 사진을 바로 넘기기 위해, 이 페이지에 있는 사진 "주소"를 긁어온다.
  // 실제로 내려받는 건 background.js가 한다 — 여기서 받으면 이미지 서버가 막는다(CORS).
  const ALICDN_RE = /^https?:\/\/[^/]*alicdn\.com\//i;

  // 같은 사진이 썸네일(...jpg_60x60.jpg)·중간 크기(...jpg_.webp)로 여러 번 나온다. 확장자 뒤에
  // 붙은 크기 꼬리표를 떼어 원본 주소 하나로 모은다.
  const normalizeImageUrl = (raw) => {
    if (!raw) return null;
    let url = String(raw).trim();
    if (url.startsWith('//')) url = `https:${url}`;
    if (!ALICDN_RE.test(url)) return null;
    // /tfs/·/tps/ 아래는 사이트 UI용 아이콘·로고라 상품 사진이 아니다.
    if (/\/(tfs|tps)\//i.test(url)) return null;
    url = url.split(/[?#]/)[0];
    const match = /^(.*?\.(?:jpg|jpeg|png|gif|webp))(?:_.*)?$/i.exec(url);
    if (match) return match[1];
    // HTML을 통째로 훑을 때는 스크립트·스타일 주소도 딸려 나온다. 사진이 아닌 건 버린다.
    if (/\.(js|css|html?|json|mp4|swf|woff2?|ttf|ico|svg)$/i.test(url)) return null;
    return url;
  };

  // 상세설명 이미지는 그 자리까지 스크롤해야 로드된다. 내려갈수록 페이지가 길어지므로 매번
  // 바닥을 다시 재면서 끝까지 내려간 뒤 원래 자리로 돌아온다.
  const loadLazyImages = async () => {
    const start = window.scrollY;
    const pageBottom = () => Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
    const step = Math.max(400, Math.round(window.innerHeight * 0.75));
    let y = 0;
    for (let i = 0; i < 80 && y < pageBottom(); i++) {
      window.scrollTo(0, y);
      await sleep(260);
      y += step;
    }
    // 맨 아래 사진들은 바닥에 한 번 더 머물러야 로드되는 경우가 있다.
    window.scrollTo(0, pageBottom());
    await sleep(700);
    window.scrollTo(0, start);
    await sleep(250);
  };

  // 상세설명 영역. 여기 있는 사진은 "상세", 나머지(갤러리·옵션 썸네일)는 "대표"로 표시한다.
  const DETAIL_AREA_SELECTOR =
    '#mod-detail-description, #desc, .desc-lazyload-container, [class*="detail-desc"], [class*="description"], [id*="description"], [id*="detail"]';

  // 같은 사진이 여러 경로로 잡히면 더 확실한 쪽을 남긴다(대표 > 상세 > 기타).
  const KIND_RANK = { main: 3, detail: 2, etc: 1 };

  // 문서 하나(페이지 또는 iframe) 안의 사진 주소를 모은다.
  //  - <img>와 배경 이미지: 지금 화면에 그려져 있는 사진.
  //  - HTML 전체 훑기: 아직 안 그려진 사진(스크립트 안 JSON, 이름이 제각각인 data-* 속성 등)까지
  //    건진다. 보이는 것만 모으면 빠지는 게 많다. 대신 추천상품 같은 잡다한 것도 딸려오므로
  //    "기타"로 따로 표시하고 기본 선택은 하지 않는다.
  const collectImagesInDocument = (doc, forcedKind) => {
    const found = new Map();
    const add = (raw, kind) => {
      const url = normalizeImageUrl(raw);
      if (!url) return;
      const existing = found.get(url);
      if (existing && KIND_RANK[existing.kind] >= KIND_RANK[kind]) return;
      found.set(url, { url, kind });
    };

    const detailRoots = Array.from(doc.querySelectorAll(DETAIL_AREA_SELECTOR));
    const kindOf = (el) => forcedKind || (detailRoots.some((root) => root.contains(el)) ? 'detail' : 'main');

    doc.querySelectorAll('img').forEach((img) => {
      const kind = kindOf(img);
      // 지연 로딩 속성 이름이 사이트마다 제각각(data-src, data-lazyload-src, data-ks-lazyload...)이라
      // 주소처럼 생긴 값은 속성 이름을 가리지 않고 본다.
      Array.from(img.attributes).forEach((attr) => {
        if (/^(src|srcset|data-|lazy)/i.test(attr.name)) add(String(attr.value).split(/\s+/)[0], kind);
      });
    });

    doc.querySelectorAll('[style*="background-image"]').forEach((el) => {
      const match = /url\((['"]?)(.*?)\1\)/i.exec(el.getAttribute('style') || '');
      if (match) add(match[2], kindOf(el));
    });

    try {
      // 스크립트 안 JSON에는 주소가 \/ 로 적혀 있어 되돌린 뒤 훑는다.
      const html = (doc.documentElement ? doc.documentElement.innerHTML : '').replace(/\\\//g, '/');
      (html.match(/(?:https?:)?\/\/[^"'\\\s()<>]*alicdn\.com\/[^"'\\\s()<>]+/gi) || []).forEach((raw) => {
        add(raw, forcedKind || 'etc');
      });
    } catch (err) {
      /* 페이지가 너무 크면 건너뛴다 */
    }

    return Array.from(found.values());
  };

  const collectPageImages = () => collectImagesInDocument(document);

  // 여러 곳에서 모은 목록을 합치고, 고르기 좋게 대표 -> 상세 -> 기타 순으로 늘어놓는다.
  const mergeImages = (lists) => {
    const found = new Map();
    lists.flat().forEach((item) => {
      const existing = found.get(item.url);
      if (existing && KIND_RANK[existing.kind] >= KIND_RANK[item.kind]) return;
      found.set(item.url, item);
    });
    const all = Array.from(found.values());
    return [
      ...all.filter((i) => i.kind === 'main'),
      ...all.filter((i) => i.kind === 'detail'),
      ...all.filter((i) => i.kind === 'etc'),
    ].slice(0, 150);
  };

  // 상세설명이 iframe 안에 든 페이지가 있다. 그 안에서도 이 스크립트가 도니까(manifest의
  // all_frames), 부탁을 보내면 각자 훑어서 결과를 맨 위 창으로 보내준다.
  const FRAME_REQUEST = 'rocket-1688-collect-request';
  const FRAME_RESPONSE = 'rocket-1688-collect-response';

  const askFramesToCollect = () => {
    document.querySelectorAll('iframe').forEach((frame) => {
      try {
        frame.contentWindow.postMessage({ source: FRAME_REQUEST }, '*');
      } catch (err) {
        /* 접근할 수 없는 프레임은 무시 */
      }
    });
  };

  const collectFrameImages = (waitMs) =>
    new Promise((resolve) => {
      const gathered = [];
      const onMessage = (event) => {
        if (!event.data || event.data.source !== FRAME_RESPONSE || !Array.isArray(event.data.items)) return;
        gathered.push(...event.data.items);
      };
      window.addEventListener('message', onMessage);
      askFramesToCollect();
      setTimeout(() => {
        window.removeEventListener('message', onMessage);
        resolve(gathered);
      }, waitMs);
    });

  // iframe 안에서 도는 경우: 화면(FAB·입력 창)은 맨 위 창에만 있고, 여기서는 부탁을 받으면
  // 자기 문서를 훑어서 보내주기만 한다.
  const setUpFrameCollector = () => {
    window.addEventListener('message', async (event) => {
      if (!event.data || event.data.source !== FRAME_REQUEST) return;
      askFramesToCollect();
      await loadLazyImages();
      try {
        window.top.postMessage({ source: FRAME_RESPONSE, items: collectImagesInDocument(document, 'detail') }, '*');
      } catch (err) {
        /* 무시 */
      }
    });
  };

  // 상세페이지에 쓰기엔 너무 작은 썸네일·아이콘은 아예 가져오지 않는다. 주소만 보고는 크기를
  // 알 수 없어(썸네일 주소를 원본으로 되돌려 놓은 것이라 더 그렇다) 실제로 한 번 불러와
  // 가로폭을 재고 거른다. 여기서 받아둔 건 브라우저 캐시에 남아 뒤에 다시 쓴다.
  const MIN_IMAGE_WIDTH = 400;
  const MEASURE_AT_ONCE = 8;

  const measureImageWidth = (url) =>
    new Promise((resolve) => {
      const img = new Image();
      const timer = setTimeout(() => resolve(0), 8000);
      img.onload = () => { clearTimeout(timer); resolve(img.naturalWidth || 0); };
      img.onerror = () => { clearTimeout(timer); resolve(0); };
      img.src = url;
    });

  const keepBigImages = async (items, onProgress) => {
    const widths = new Array(items.length).fill(0);
    let next = 0;
    let done = 0;

    const worker = async () => {
      while (next < items.length) {
        const index = next++;
        widths[index] = await measureImageWidth(items[index].url);
        done += 1;
        if (onProgress) onProgress(done, items.length);
      }
    };

    await Promise.all(Array.from({ length: Math.min(MEASURE_AT_ONCE, items.length) }, worker));

    return items
      .map((item, index) => ({ ...item, width: widths[index] }))
      .filter((item) => item.width >= MIN_IMAGE_WIDTH);
  };

  // 고르는 화면에 띄울 작은 그림. alicdn은 주소 뒤에 크기를 붙이면 그 크기로 내려준다.
  const thumbUrl = (url) => `${url}_200x200.jpg`;

  // 확장(background.js)에 물어본다. 확장이 잠들거나 죽으면 답이 영영 안 올 수 있어, 시간 제한을
  // 두고 실패로 돌린다 — 안 그러면 버튼이 눌린 채로 멈춰 있게 된다.
  const askExtension = (message, timeoutMs = 30000) =>
    new Promise((resolve) => {
      let done = false;
      const finish = (result) => {
        if (done) return;
        done = true;
        resolve(result);
      };
      setTimeout(() => finish({ ok: false, error: '확장이 응답하지 않았습니다(시간 초과).' }), timeoutMs);
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) finish({ ok: false, error: chrome.runtime.lastError.message });
          else finish(response || { ok: false, error: '확장이 응답하지 않았습니다.' });
        });
      } catch (err) {
        finish({ ok: false, error: String((err && err.message) || err) });
      }
    });

  // 앱에 넘길 값을 확장 저장소에 직접 넣는다. 사진까지 담으면 수 MB라, 메시지로 넘기면 크기
  // 제한에 걸려 통째로 실패한다(저장소는 unlimitedStorage로 열어두었다).
  const savePendingDetailCopy = (payload) =>
    new Promise((resolve) => {
      try {
        chrome.storage.local.set({ pendingDetailCopy: { payload, savedAt: Date.now() } }, () => {
          if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
          else resolve({ ok: true });
        });
      } catch (err) {
        resolve({ ok: false, error: String((err && err.message) || err) });
      }
    });

  // 고른 사진을 확장을 통해 받아 dataURL로 만든다. 한 장씩 차례로 받으면 수십 장일 때 몇 분씩
  // 걸려 멈춘 것처럼 보이므로, 몇 개씩 동시에 받는다. 고른 순서는 그대로 지킨다.
  const DOWNLOAD_AT_ONCE = 5;

  const downloadImages = async (urls, onProgress) => {
    const results = new Array(urls.length).fill(null);
    let next = 0;
    let done = 0;

    const worker = async () => {
      while (next < urls.length) {
        const index = next++;
        const response = await askExtension({ type: 'FETCH_IMAGE', url: urls[index] }, 20000);
        if (response && response.ok && response.dataUrl) results[index] = response.dataUrl;
        else console.warn('[로켓제안] 사진 받기 실패', urls[index], response && response.error);
        done += 1;
        if (onProgress) onProgress(done, urls.length);
      }
    };

    await Promise.all(Array.from({ length: Math.min(DOWNLOAD_AT_ONCE, urls.length) }, worker));

    return results
      .map((dataUrl, index) => ({ dataUrl, url: urls[index] }))
      .filter((item) => typeof item.dataUrl === 'string')
      .map((item, i) => ({ name: `1688_${String(i + 1).padStart(2, '0')}.jpg`, dataUrl: item.dataUrl, url: item.url }));
  };

  // ---- 카테고리 견적서 찾기 ----
  // 앱의 "견적서 찾기"와 같은 일을 여기서 한다. 검색과 다운로드는 서플라이어허브 화면을 실제로
  // 조작해야 해서 supplier.js가 맡고(background.js가 중계), 이 창은 물어보고 받기만 한다.
  // 받은 파일은 확장 저장소에 넣어두고, 앱이 1688 값을 받을 때 함께 가져가 등록한다.
  const QUOTE_KEY = 'pendingCategoryQuote';

  // 카테고리 검색은 한 단어여야 결과가 나온다. 상품명에서 품목으로 보이는 단어 하나를 고른다
  // (앱의 utils/categoryKeyword.ts와 같은 규칙).
  const KEYWORD_NOISE = new Set([
    '세트', '개입', '개', '매', '장', '팩', '박스', '묶음', '벌크',
    '대용량', '휴대용', '무료배송', '정품', '신상', '인기',
  ]);

  const extractCategoryKeywords = (productName) => {
    const tokens = String(productName || '')
      .replace(/[[\](){}<>,/·]/g, ' ')
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .filter((t) => t.length >= 2 && !KEYWORD_NOISE.has(t) && /[가-힣]/.test(t) && !/^\d/.test(t));
    if (tokens.length === 0) return [];
    // 한국어 상품명은 보통 끝쪽에 품목명이 오므로 뒤에서부터 후보로 삼고, 맨 앞 단어(대개
    // 브랜드)는 맨 뒤로 미룬다.
    const [first, ...others] = tokens;
    const ordered = others.length > 0 ? [...others.reverse(), first] : [first];
    return Array.from(new Set(ordered));
  };

  /** 가장 그럴듯한 키워드 하나. 검색창의 기본값으로 쓴다. */
  const guessCategoryKeyword = (productName) => extractCategoryKeywords(productName)[0] || '';

  const saveCategoryQuote = (value) =>
    new Promise((resolve) => {
      try {
        chrome.storage.local.set({ [QUOTE_KEY]: value }, () => {
          if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
          else resolve({ ok: true });
        });
      } catch (err) {
        resolve({ ok: false, error: String((err && err.message) || err) });
      }
    });

  // 지금 열려 있는 창이 검색 결과·견적서를 받을 자리. 창을 닫으면 비운다.
  let categoryHandlers = null;

  async function buildModal(initial, pickedLabels) {
    const overlay = document.createElement('div');
    overlay.className = 'rc-overlay';

    const box = document.createElement('div');
    box.className = 'rc-box';

    box.innerHTML = `
      <div class="rc-header-row">
        <h2>로켓으로 보낼 값 확인</h2>
        <div class="rc-header-actions">
          <button id="rc-reset" class="rc-btn-secondary" title="저장된 값을 지우고 이 페이지에서 다시 읽어옵니다">초기화</button>
          <button id="rc-cancel" class="rc-btn-secondary">취소</button>
        </div>
      </div>
      <div class="rc-fields">
        <div class="rc-section">
          <p class="rc-section-heading"><span class="rc-step-num">1</span>📄 상세페이지 문구 (선택)</p>
          <p class="rc-step-hint">프롬프트를 복사해 AI에 물어보고, 받은 답을 그대로 아래에 붙여넣으세요. 로켓에 붙여넣을 때 상세페이지에도 같이 들어갑니다. 프롬프트 내용은 로켓 앱 상세페이지 에디터의 "프롬프트 직접 수정하기"에서 고칠 수 있고, 고치면 여기에도 바로 반영됩니다.</p>
          <label class="rc-label">소구점 메모 (프롬프트에 들어갈 재료)
            <input id="rc-selling-points" class="rc-input" placeholder="예) 튼튼함, 넉넉한 수납, 선물용" />
          </label>
          <button type="button" id="rc-copy-prompt" class="rc-image-work-btn">🤖 AI용 프롬프트 복사하기</button>
          <label class="rc-label" style="margin-top:8px;">AI가 준 문구 붙여넣기
            <textarea id="rc-detail-copy" class="rc-input rc-textarea" rows="4" placeholder="AI 답변을 그대로 붙여넣으세요"></textarea>
          </label>
        </div>
        <div class="rc-section">
          <p class="rc-section-heading"><span class="rc-step-num">2</span>📋 견적서 찾기 (선택)</p>
          <p class="rc-step-hint">쿠팡 카테고리를 찾아 견적서를 미리 받아둡니다. 받은 견적서는 "등록하기"를 누를 때 그 상품에 함께 등록됩니다.</p>
          <div class="rc-quote-row">
            <input id="rc-quote-keyword" class="rc-input" placeholder="검색어 한 단어 (예: 노트)" />
            <button type="button" id="rc-quote-search" class="rc-quote-search">검색</button>
          </div>
          <div id="rc-quote-words" class="rc-quote-words"></div>
          <div id="rc-quote-results" class="rc-quote-results"></div>
          <p id="rc-quote-status" class="rc-step-hint rc-image-status"></p>
        </div>
        <div class="rc-section">
          <p class="rc-section-heading"><span class="rc-step-num">3</span>🎨 옵션 선택</p>
          <div id="rc-option-rows" class="rc-option-rows"></div>
          <div class="rc-option-buttons">
            <button type="button" id="rc-pick-options" class="rc-pick-option">🎯 클릭해서 옵션 선택</button>
            <button type="button" id="rc-add-option" class="rc-add-option">+ 직접 입력</button>
          </div>
        </div>
        <div class="rc-section">
          <p class="rc-section-heading"><span class="rc-step-num">4</span>📝 기본 정보</p>
          <div class="rc-field-group">
            <label class="rc-label">제조사/공급사(원문)
              <input id="rc-manufacturer" class="rc-input" />
            </label>
            <label class="rc-label rc-label-red">상품명(원문) · 수정 필수
              <input id="rc-title" class="rc-input" />
            </label>
            <label class="rc-label rc-label-red">SKU
              <input id="rc-sku" class="rc-input" placeholder="예) 30개 (박스에 들어가는 수량)" />
            </label>
            <label class="rc-label">재질
              <input id="rc-material" class="rc-input" />
            </label>
            <label class="rc-label rc-label-red">중량 (g)
              <input id="rc-weight" class="rc-input" type="number" step="1" />
            </label>
            <div class="rc-row">
              <label class="rc-label rc-label-red">가로(mm)
                <input id="rc-margin-width" class="rc-input" type="number" step="0.1" placeholder="가로" />
              </label>
              <label class="rc-label rc-label-red">세로(mm)
                <input id="rc-margin-height" class="rc-input" type="number" step="0.1" placeholder="세로" />
              </label>
              <label class="rc-label rc-label-red">높이(mm)
                <input id="rc-margin-depth" class="rc-input" type="number" step="0.1" placeholder="높이" />
              </label>
            </div>
          </div>
        </div>
        <div class="rc-section">
          <p class="rc-section-heading"><span class="rc-step-num">5</span>💰 수익 계산기 (선택)</p>
          <div class="rc-row">
            <label class="rc-label">환율
              <input id="rc-exchange-rate" class="rc-input" type="number" placeholder="210" title="환율(1위안=?원)" />
            </label>
            <label class="rc-label">위안(¥)
              <input id="rc-margin-cny" class="rc-input" type="number" step="0.01" placeholder="6.5" title="위안 가격(¥)" />
            </label>
            <label class="rc-label">공급%
              <input id="rc-supply-margin" class="rc-input" type="number" placeholder="30" title="공급 마진율(%)" />
            </label>
            <label class="rc-label">판매%
              <input id="rc-selling-margin" class="rc-input" type="number" placeholder="50" title="판매 마진율(%)" />
            </label>
          </div>
          <div class="rc-margin-result">
            <div class="rc-margin-result-item supply">
              <span>공급가</span>
              <strong id="rc-margin-supply">-</strong>
            </div>
            <div class="rc-margin-result-item sell">
              <span>판매가</span>
              <strong id="rc-margin-sell">-</strong>
            </div>
            <div class="rc-margin-result-item rocket">
              <span>로켓마진</span>
              <strong id="rc-margin-rocket">-</strong>
            </div>
            <div class="rc-margin-result-item profit">
              <span>내마진</span>
              <strong id="rc-margin-profit">-</strong>
            </div>
          </div>
          <button type="button" id="rc-apply-price" class="rc-apply-price-btn">↑ 옵션에 적용하기</button>
        </div>
        <div class="rc-section">
          <p class="rc-section-heading"><span class="rc-step-num">6</span>🖼 이미지</p>
          <p class="rc-step-hint">창이 열리면서 이 페이지의 사진을 자동으로 찾습니다. 쓸 사진만 남기면 맨 아래 "등록하기"를 누를 때 그대로 담아 보냅니다. ★를 누르면 대표이미지가 되고(옵션이 여럿이면 누를 때마다 옵션이 바뀝니다), 끌어다 놓으면 순서가 바뀝니다. 고른 것은 초기화 전까지 그대로 남습니다.</p>
          <div id="rc-image-area" hidden>
            <div class="rc-image-toolbar">
              <button type="button" id="rc-image-all" class="rc-add-option">전체 선택</button>
              <button type="button" id="rc-image-none" class="rc-add-option">전체 해제</button>
              <span id="rc-image-count" class="rc-image-count">0장 선택</span>
            </div>
            <div id="rc-image-grid" class="rc-image-grid"></div>
          </div>
          <p id="rc-image-status" class="rc-step-hint rc-image-status"></p>
          <button type="button" id="rc-scan-images" class="rc-image-work-btn">🔁 사진 다시 찾기</button>
        </div>
      </div>
      <div class="rc-actions">
        <button id="rc-copy" class="rc-btn-primary">🚀 등록하기</button>
      </div>
    `;

    overlay.appendChild(box);
    root.appendChild(overlay);
    currentBox = box;
    makeDraggable(box, box.querySelector('h2'));

    // 옵션 행(색상 라벨 + 가로/세로/높이 + 가격 + 체크 여부)은 페이지마다 새로 읽어오는 값이라
    // draft로 남기지 않는다. 사이즈/가격은 공통으로 읽은 값을 기본값으로 깔아주고, 옵션마다 다르면
    // 클릭해서 고친다. 첫 옵션의 값을 기본값으로 삼아 새 행을 추가할 때마다 그대로 복사해준다.
    const defaultWidth = initial.sizeCm.width ?? '';
    const defaultHeight = initial.sizeCm.height ?? '';
    const defaultDepth = initial.sizeCm.depth ?? '';
    const defaultPrice = initial.priceCny ?? '';
    let rowSeq = 0;
    const makeRow = (label, checked, overrides) => ({
      id: `rc-opt-${Date.now()}-${rowSeq++}`,
      label,
      width: defaultWidth,
      height: defaultHeight,
      depth: defaultDepth,
      price: defaultPrice,
      checked,
      // 기본값이 자동으로 채워진 채로 "아직 안 건드린" 칸은, 처음 클릭했을 때 값을 지워서
      // 바로 새 값을 입력할 수 있게 한다(값을 지우고 다시 타이핑하는 수고를 없앰).
      pristine: true,
      // 공급가/판매가 칩을 직접 클릭해서 고친 값. null이면 마진율 계산값을 그대로 쓴다.
      supplyPriceOverride: null,
      sellingPriceOverride: null,
      // 사이즈/가격 설정 칸을 접어서 옵션명만 보이게 할지 여부(펼침 상태는 행마다 따로 기억).
      collapsed: true,
      ...overrides,
    });
    // 옵션 행은 창을 닫았다 다시 열어도(또는 페이지를 오갔다 와도) "초기화" 버튼을 누르기 전까지
    // 그대로 유지되어야 한다 — 저장된 작업 내역이 있으면 그걸 우선 복원하고, 없을 때만(최초 실행)
    // 자동 스캔("선택된" 옵션 하나)으로 시작한다.
    const workDraft = await loadWorkDraft();
    let rows;
    if (Array.isArray(pickedLabels) && pickedLabels.length > 0) {
      // 캡처 버튼을 눌러 방금 화면에서 고른 옵션이 있으면 그것으로 시작한다(저장된 작업 내역보다 우선).
      rows = pickedLabels.map((label) => makeRow(label, true));
    } else if (workDraft && Array.isArray(workDraft.rows) && workDraft.rows.length > 0) {
      rows = workDraft.rows.map((r) => makeRow(r.label || '', !!r.checked, {
        width: r.width ?? '',
        height: r.height ?? '',
        depth: r.depth ?? '',
        price: r.price ?? '',
        supplyPriceOverride: typeof r.supplyPriceOverride === 'number' ? r.supplyPriceOverride : null,
        sellingPriceOverride: typeof r.sellingPriceOverride === 'number' ? r.sellingPriceOverride : null,
        pristine: false,
        collapsed: true,
      }));
    } else {
      rows = initial.colorRaw ? [makeRow(initial.colorRaw, true)] : [];
    }

    // 고른 사진과 받아둔 견적서도 옵션 행과 함께 "작업 내역"에 남긴다 — 창을 닫았다 열거나
    // 페이지를 오갔다 와도 "초기화"를 누르기 전까지 그대로 있어야 한다.
    let imageItems = [];
    let categoryQuote = null;

    const optionRowsEl = box.querySelector('#rc-option-rows');
    const numVal = (v) => (v === '' || v === null || v === undefined ? '' : v);

    // 수익 계산기 입력(환율/마진율)은 옵션 행들과 별개로 공용으로 쓰인다. 저장된 값을 먼저
    // 불러와 채워 넣은 뒤(비동기) 옵션 행을 처음 그린다.
    const marginSettings = await loadMarginSettings();
    const exchangeRateInput = box.querySelector('#rc-exchange-rate');
    const cnyPreviewInput = box.querySelector('#rc-margin-cny');
    const widthPreviewInput = box.querySelector('#rc-margin-width');
    const heightPreviewInput = box.querySelector('#rc-margin-height');
    const depthPreviewInput = box.querySelector('#rc-margin-depth');
    const supplyMarginInput = box.querySelector('#rc-supply-margin');
    const sellingMarginInput = box.querySelector('#rc-selling-margin');
    exchangeRateInput.value = marginSettings.exchangeRate || '';
    cnyPreviewInput.value = workDraft && workDraft.previewCny !== undefined ? workDraft.previewCny : defaultPrice;
    widthPreviewInput.value = workDraft && workDraft.previewWidth !== undefined ? workDraft.previewWidth : defaultWidth;
    heightPreviewInput.value = workDraft && workDraft.previewHeight !== undefined ? workDraft.previewHeight : defaultHeight;
    depthPreviewInput.value = workDraft && workDraft.previewDepth !== undefined ? workDraft.previewDepth : defaultDepth;
    supplyMarginInput.value = marginSettings.supplyMarginPercent;
    sellingMarginInput.value = marginSettings.sellingMarginPercent;

    // 옵션 행 + 미리보기 입력(위안가격/사이즈) 전체를 저장한다. 체크박스 토글, 필드 수정, 추가/
    // 삭제, "적용" 버튼 등 상태가 바뀌는 모든 지점에서 호출한다.
    function persistWork() {
      saveWorkDraft({
        rows: rows.map(({ label, width, height, depth, price, checked, supplyPriceOverride, sellingPriceOverride }) =>
          ({ label, width, height, depth, price, checked, supplyPriceOverride, sellingPriceOverride })),
        previewCny: cnyPreviewInput.value,
        previewWidth: widthPreviewInput.value,
        previewHeight: heightPreviewInput.value,
        previewDepth: depthPreviewInput.value,
        // 사진은 주소와 고른 상태만 남긴다(그림 자체는 페이지에서 다시 불러온다).
        images: imageItems.map(({ url, kind, checked, mainFor }) => ({ url, kind, checked, mainFor: mainFor || null })),
        categoryQuote,
      });
    }

    const getMarginInputs = () => ({
      exchangeRate: parseFloat(exchangeRateInput.value) || 0,
      supplyMarginPercent: supplyMarginInput.value,
      sellingMarginPercent: sellingMarginInput.value,
    });

    const fmtWon = (n) => {
      const rounded = Math.round(n);
      return `${rounded < 0 ? '-' : ''}₩${Math.abs(rounded).toLocaleString('ko-KR')}`;
    };

    // 결과 칩 DOM은 옵션 행이 그려질 때 한 번만 만든다(아래 buildCalcEl). 여기서는 그 안의 값만
    // 갱신한다 — 공급가/판매가는 사용자가 클릭해서 직접 고칠 수 있는 입력칸이라, 매번 innerHTML을
    // 통째로 새로 그리면 타이핑 중에 포커스가 날아가 버린다. 그래서 현재 포커스된 칸의 값은
    // 건드리지 않고, 로켓마진/내마진(항상 읽기전용)과 포커스가 없는 나머지 칸만 갱신한다.
    function refreshRowCalc(row, calcEl) {
      const { exchangeRate, supplyMarginPercent, sellingMarginPercent } = getMarginInputs();
      const calc = computeMargin(row.price, exchangeRate, supplyMarginPercent, sellingMarginPercent, row.supplyPriceOverride, row.sellingPriceOverride);
      const rocketEl = calcEl.querySelector('.rc-calc-rocket');
      const profitEl = calcEl.querySelector('.rc-calc-profit');
      const supplyInput = calcEl.querySelector('.rc-calc-supply-input');
      const sellInput = calcEl.querySelector('.rc-calc-sell-input');
      if (rocketEl) rocketEl.textContent = calc && calc.sellingPriceKrw > 0 ? fmtWon(calc.sellingPriceKrw - calc.supplyPriceKrw) : '-';
      if (profitEl) profitEl.textContent = calc && calc.supplyPriceKrw > 0 ? fmtWon(calc.marginKrw) : '-';
      if (supplyInput && document.activeElement !== supplyInput) {
        supplyInput.value = calc && calc.supplyPriceKrw > 0 ? calc.supplyPriceKrw : '';
      }
      if (sellInput && document.activeElement !== sellInput) {
        sellInput.value = calc && calc.sellingPriceKrw > 0 ? calc.sellingPriceKrw : '';
      }
    }

    // 옵션 행 하나의 결과 칩 DOM을 최초 1회 만들고, 공급가/판매가 칸에 직접 값을 입력하면
    // row.supplyPriceOverride/sellingPriceOverride에 저장해서 이후 계산에 그대로 반영한다.
    function buildCalcEl(row) {
      const calcEl = document.createElement('div');
      calcEl.className = 'rc-option-calc';
      calcEl.innerHTML = `
        <span class="rc-calc-chip supply">공급가<input type="number" step="1" class="rc-calc-chip-input rc-calc-supply-input" placeholder="-" title="클릭해서 직접 수정 가능" /></span>
        <span class="rc-calc-chip sell">판매가<input type="number" step="1" class="rc-calc-chip-input rc-calc-sell-input" placeholder="-" title="클릭해서 직접 수정 가능" /></span>
        <span class="rc-calc-chip rocket">로켓마진<strong class="rc-calc-rocket">-</strong></span>
        <span class="rc-calc-chip profit">내마진<strong class="rc-calc-profit">-</strong></span>
      `;
      const supplyInput = calcEl.querySelector('.rc-calc-supply-input');
      const sellInput = calcEl.querySelector('.rc-calc-sell-input');
      supplyInput.addEventListener('input', () => {
        row.supplyPriceOverride = supplyInput.value === '' ? null : parseFloat(supplyInput.value);
        persistWork();
        refreshRowCalc(row, calcEl);
      });
      supplyInput.addEventListener('blur', () => refreshRowCalc(row, calcEl));
      sellInput.addEventListener('input', () => {
        row.sellingPriceOverride = sellInput.value === '' ? null : parseFloat(sellInput.value);
        persistWork();
        refreshRowCalc(row, calcEl);
      });
      sellInput.addEventListener('blur', () => refreshRowCalc(row, calcEl));
      return calcEl;
    }

    function refreshAllCalcs() {
      optionRowsEl.querySelectorAll('[data-row-id]').forEach((wrapperEl) => {
        const row = rows.find(r => r.id === wrapperEl.dataset.rowId);
        const calcEl = wrapperEl.querySelector('.rc-option-calc');
        if (row && calcEl) refreshRowCalc(row, calcEl);
      });
    }

    // 옵션 카드의 🧮 아이콘을 누르면 뜨는 팝업. 로켓 앱의 MarginCalculatorModal과 동일한
    // 입력/계산 흐름(환율 → 위안 → 공급 마진율(%) → 판매 마진율(%) → 세금 상세 → 최종 순수익)을
    // 그대로 재현한다. 환율은 앱처럼 바꾸는 즉시 저장·전체 반영되고, 위안/마진율은 앱처럼 "저장하고
    // 적용하기"를 눌러야 이 옵션에 반영된다(그 전까지는 이 옵션의 기존 값에 영향을 주지 않는다).
    function openOptionCalcModal(row, calcEl) {
      const backdrop = document.createElement('div');
      backdrop.className = 'rc-sub-backdrop';
      const popup = document.createElement('div');
      popup.className = 'rc-sub-box';
      const titleSuffix = row.label ? ` — ${row.label.replace(/</g, '&lt;')}` : '';
      popup.innerHTML = `
        <button type="button" class="rc-sub-close" aria-label="닫기">×</button>
        <h3>마진 계산기${titleSuffix}</h3>
        <p class="rc-sub-hint">이 옵션에만 적용됩니다. "저장하고 적용하기"를 눌러야 반영돼요.</p>

        <label class="rc-label">적용 환율 (1위안 = ?원)
          <input type="number" class="rc-input" id="op-rate" placeholder="예: ${CNY_BASE_RATE_DEFAULT}" />
        </label>

        <label class="rc-label">위안 (CNY)
          <input type="number" step="0.01" class="rc-input" id="op-cny" placeholder="예: 10" />
        </label>

        <div class="rc-sub-result-box">
          <span class="rc-sub-result-title">환산 원가 (KRW, VAT 포함)</span>
          <p class="rc-sub-result-value" id="op-krw">₩ 0</p>
          <p class="rc-sub-result-formula">계산식: ((위안 × 환율) + 수수료 10%) + VAT 10%</p>
        </div>

        <label class="rc-label">공급 마진율(%)
          <input type="number" class="rc-input" id="op-supply-margin" placeholder="예: 30 (100 미만)" />
        </label>
        <p class="rc-sub-field-note">계산된 공급가: <strong id="op-supply-out">₩ 0</strong></p>

        <label class="rc-label">판매 마진율(공급가 대비 %)
          <input type="number" class="rc-input" id="op-selling-margin" placeholder="예: 50 (100 미만)" />
        </label>
        <p class="rc-sub-field-note">계산된 판매가: <strong id="op-sell-out">₩ 0</strong></p>
        <div class="rc-sub-amount-line"><span>판매가 - 공급가</span><strong id="op-sell-margin-amount">₩ 0</strong></div>

        <button type="button" class="rc-sub-toggle" id="op-tax-toggle"><span>세금 정보 상세 보기</span><span id="op-tax-arrow">▾</span></button>
        <div class="rc-sub-tax" id="op-tax-details">
          <div class="rc-sub-tax-row"><span>매출세액 (공급가 부가세)</span><span id="op-output-vat">₩ 0</span></div>
          <div class="rc-sub-tax-row"><span>매입세액 (원가 부가세)</span><span id="op-input-vat">₩ 0</span></div>
          <div class="rc-sub-tax-row total"><span>납부 예상 부가세</span><span id="op-vat-payable">₩ 0</span></div>
          <div class="rc-sub-tax-row" style="margin-top:8px;"><span>과세 대상 소득</span><span id="op-margin-after-vat">₩ 0</span></div>
          <div class="rc-sub-tax-row total" style="color:#fb923c;"><span>예상 종합소득세</span><span id="op-income-tax">₩ 0</span></div>
        </div>

        <div class="rc-sub-final">
          <div class="rc-sub-final-row"><span>마진 (공급가 - 원가)</span><span id="op-gross-margin">₩ 0</span></div>
          <div class="rc-sub-final-row"><span>납부 예상 부가세</span><span id="op-vat-payable2" style="color:#f87171;">- ₩ 0</span></div>
          <div class="rc-sub-final-row"><span>예상 종합소득세</span><span id="op-income-tax2" style="color:#fb923c;">- ₩ 0</span></div>
          <div class="rc-sub-final-row split">
            <span class="rc-sub-final-label">최종 순수익 (예상)</span>
            <span class="rc-sub-final-value" id="op-net-profit">₩ 0</span>
          </div>
        </div>

        <div class="rc-sub-actions">
          <button type="button" class="rc-sub-btn-secondary" id="op-close">닫기</button>
          <button type="button" class="rc-sub-btn-primary" id="op-save" disabled>저장하고 적용하기</button>
        </div>
      `;
      backdrop.appendChild(popup);
      root.appendChild(backdrop);

      const rateEl = popup.querySelector('#op-rate');
      const cnyEl = popup.querySelector('#op-cny');
      const supplyMarginEl = popup.querySelector('#op-supply-margin');
      const sellingMarginEl = popup.querySelector('#op-selling-margin');
      const saveBtn = popup.querySelector('#op-save');

      // 앱의 수익 계산기와 마찬가지로 환율만 이어서 쓰고(공유 설정), 위안/마진율은 매번 새로
      // 입력한다 — 이 옵션에 이미 반영된 값이 있어도 그 값을 덮어쓸지는 저장 전까지 알 수 없으므로
      // 빈 칸에서 시작한다.
      rateEl.value = exchangeRateInput.value || CNY_BASE_RATE_DEFAULT;

      let lastCalc = null;

      function refresh() {
        const rate = parseFloat(rateEl.value) || 0;
        const calc = computeMargin(cnyEl.value, rate, supplyMarginEl.value, sellingMarginEl.value);
        lastCalc = calc;
        popup.querySelector('#op-krw').textContent = fmtWon(calc ? calc.costPriceKrw : 0);
        popup.querySelector('#op-supply-out').textContent = fmtWon(calc ? calc.supplyPriceKrw : 0);
        popup.querySelector('#op-sell-out').textContent = fmtWon(calc ? calc.sellingPriceKrw : 0);
        const sellMarginAmount = calc && calc.sellingPriceKrw > 0 && calc.supplyPriceKrw > 0 ? calc.sellingPriceKrw - calc.supplyPriceKrw : 0;
        popup.querySelector('#op-sell-margin-amount').textContent = fmtWon(sellMarginAmount);
        popup.querySelector('#op-output-vat').textContent = fmtWon(calc ? calc.outputVat : 0);
        popup.querySelector('#op-input-vat').textContent = fmtWon(calc ? calc.inputVat : 0);
        popup.querySelector('#op-vat-payable').textContent = fmtWon(calc ? calc.vatPayable : 0);
        popup.querySelector('#op-margin-after-vat').textContent = fmtWon(calc ? calc.marginAfterVat : 0);
        popup.querySelector('#op-income-tax').textContent = fmtWon(calc ? calc.comprehensiveIncomeTax : 0);
        popup.querySelector('#op-gross-margin').textContent = fmtWon(calc ? calc.grossMargin : 0);
        popup.querySelector('#op-vat-payable2').textContent = `- ${fmtWon(calc ? calc.vatPayable : 0)}`;
        popup.querySelector('#op-income-tax2').textContent = `- ${fmtWon(calc ? calc.comprehensiveIncomeTax : 0)}`;
        popup.querySelector('#op-net-profit').textContent = fmtWon(calc ? calc.marginKrw : 0);
        saveBtn.disabled = !(calc && calc.costPriceKrw > 0 && calc.supplyPriceKrw > 0);
      }

      rateEl.addEventListener('input', () => {
        // 환율은 앱에서도(useEffect로 즉시 localStorage 반영) 그리고 이 확장프로그램 전체에서도
        // 공유하는 설정이라, 여기서 바꾸는 즉시 상단 공용 환율 칸과 저장소에 반영한다.
        exchangeRateInput.value = rateEl.value;
        saveMarginSettings(getMarginInputs());
        updateMainResult();
        refreshAllCalcs();
        refresh();
      });
      [cnyEl, supplyMarginEl, sellingMarginEl].forEach((input) => input.addEventListener('input', refresh));

      const taxToggleBtn = popup.querySelector('#op-tax-toggle');
      const taxDetailsEl = popup.querySelector('#op-tax-details');
      const taxArrowEl = popup.querySelector('#op-tax-arrow');
      taxToggleBtn.addEventListener('click', () => {
        const open = taxDetailsEl.classList.toggle('open');
        taxArrowEl.textContent = open ? '▴' : '▾';
      });

      const close = () => backdrop.remove();
      popup.querySelector('.rc-sub-close').addEventListener('click', close);
      popup.querySelector('#op-close').addEventListener('click', close);

      // 앱의 "저장하고 적용하기"와 동일: 계산된 원가/공급가/판매가를 이 옵션에 고정값으로 반영한다.
      // 이후 공용 마진율 설정이 바뀌어도 이 옵션은 저장 시점 값 그대로 유지된다(다시 열어서
      // 저장해야 갱신됨), 인라인 칩을 직접 고친 경우와 동일한 override 방식을 쓴다.
      saveBtn.addEventListener('click', () => {
        if (!lastCalc || lastCalc.supplyPriceKrw <= 0) return;
        row.price = parseFloat(cnyEl.value);
        row.supplyPriceOverride = lastCalc.supplyPriceKrw;
        row.sellingPriceOverride = lastCalc.sellingPriceKrw > 0 ? lastCalc.sellingPriceKrw : null;
        row.pristine = false;
        persistWork();
        close();
        renderOptionRows(); // 옵션 카드의 "위안 가격" 입력칸도 새 값으로 다시 그린다
      });

      refresh();
    }

    // 옵션 행이 하나도 없어도(아직 옵션을 안 골랐어도) 이 미리보기 결과창은 바로 계산돼서 보인다 —
    // "계산기가 안 보인다"는 혼란을 없애기 위해 옵션 유무와 완전히 독립적으로 동작시킨다.
    function updateMainResult() {
      const { exchangeRate, supplyMarginPercent, sellingMarginPercent } = getMarginInputs();
      const calc = computeMargin(cnyPreviewInput.value, exchangeRate, supplyMarginPercent, sellingMarginPercent);
      box.querySelector('#rc-margin-supply').textContent = calc && calc.supplyPriceKrw > 0 ? fmtWon(calc.supplyPriceKrw) : '-';
      box.querySelector('#rc-margin-sell').textContent = calc && calc.sellingPriceKrw > 0 ? fmtWon(calc.sellingPriceKrw) : '-';
      box.querySelector('#rc-margin-rocket').textContent = calc && calc.sellingPriceKrw > 0 ? fmtWon(calc.sellingPriceKrw - calc.supplyPriceKrw) : '-';
      box.querySelector('#rc-margin-profit').textContent = calc && calc.supplyPriceKrw > 0 ? fmtWon(calc.marginKrw) : '-';
    }
    updateMainResult();

    [exchangeRateInput, cnyPreviewInput, supplyMarginInput, sellingMarginInput].forEach((input) => {
      input.addEventListener('input', () => {
        updateMainResult();
        refreshAllCalcs();
        saveMarginSettings(getMarginInputs());
        persistWork();
      });
    });

    // 4번 "기본 정보"의 가로/세로/높이는 상품명·중량처럼 적으면 바로 반영되는 칸으로 보이지만,
    // 원래는 "↑ 옵션에 적용하기"를 눌러야 옵션 행에 들어갔다. 누르는 걸 잊으면 옵션 행에 남아 있던
    // 예전 사이즈(자동 인식값 또는 지난 작업 내역)가 그대로 앱으로 넘어간다. 그래서 여기에 값을
    // 적으면 체크된 옵션 전체에 곧바로 반영한다(옵션마다 다르면 옵션 카드에서 따로 고치면 된다).
    const DIM_INDEX = { width: 0, height: 1, depth: 2 };
    const applyDimToCheckedRows = (field, rawValue) => {
      const value = rawValue === '' ? '' : parseFloat(rawValue);
      if (rawValue !== '' && isNaN(value)) return;
      rows.filter(r => r.checked).forEach((row) => {
        row[field] = value;
        row.pristine = false;
        // 카드를 다시 그리면 접어둔 상태가 풀리므로 해당 칸의 값만 바꿔 준다(적용 버튼과 동일).
        const wrapperEl = optionRowsEl.querySelector(`[data-row-id="${row.id}"]`);
        if (!wrapperEl) return;
        const input = wrapperEl.querySelectorAll('.rc-option-dim')[DIM_INDEX[field]];
        if (!input) return;
        input.value = numVal(row[field]);
        input.dataset.rcPristine = '0';
      });
    };

    [[widthPreviewInput, 'width'], [heightPreviewInput, 'height'], [depthPreviewInput, 'depth']].forEach(([input, field]) => {
      input.addEventListener('input', () => {
        applyDimToCheckedRows(field, input.value);
        persistWork();
      });
    });

    function renderOptionRows() {
      optionRowsEl.innerHTML = '';
      rows.forEach((row) => {
        const wrapperEl = document.createElement('div');
        wrapperEl.className = 'rc-option-card';
        wrapperEl.dataset.rowId = row.id;
        wrapperEl.innerHTML = `
          <div class="rc-option-top">
            <input type="checkbox" class="rc-opt-checked" ${row.checked ? 'checked' : ''} aria-label="옵션 선택" />
            <input type="text" class="rc-input rc-option-label" placeholder="옵션명(예: 빨강)" value="${row.label.replace(/"/g, '&quot;')}" />
            <button type="button" class="rc-option-toggle" aria-label="가격 설정 접기/펼치기" aria-expanded="${row.collapsed ? 'false' : 'true'}" title="가격/사이즈 설정 접기·펼치기">${row.collapsed ? '▸' : '▾'}</button>
            <button type="button" class="rc-option-calc-btn" aria-label="마진 계산기" title="마진 계산기 (앱과 동일한 계산기 팝업)">🧮</button>
            <button type="button" class="rc-option-remove" aria-label="옵션 삭제" title="옵션 삭제">×</button>
          </div>
          <div class="rc-option-body"${row.collapsed ? ' hidden' : ''}>
            <div class="rc-option-size-row">
              <input type="number" step="0.1" class="rc-input rc-option-dim" placeholder="가로" value="${numVal(row.width)}" title="가로(mm)" />
              <span class="rc-option-dim-sep">×</span>
              <input type="number" step="0.1" class="rc-input rc-option-dim" placeholder="세로" value="${numVal(row.height)}" title="세로(mm)" />
              <span class="rc-option-dim-sep">×</span>
              <input type="number" step="0.1" class="rc-input rc-option-dim" placeholder="높이" value="${numVal(row.depth)}" title="높이(mm)" />
            </div>
            <div class="rc-option-price-row">
              <span class="rc-label">위안 가격</span>
              <input type="number" step="0.01" class="rc-input rc-option-price" placeholder="예: 6.5" value="${numVal(row.price)}" title="가격(위안/CNY)" />
            </div>
          </div>
        `;
        const checkedInput = wrapperEl.querySelector('.rc-opt-checked');
        const labelInput = wrapperEl.querySelector('.rc-option-label');
        const toggleBtn = wrapperEl.querySelector('.rc-option-toggle');
        const bodyEl = wrapperEl.querySelector('.rc-option-body');
        const [widthInput, heightInput, depthInput] = wrapperEl.querySelectorAll('.rc-option-dim');
        const priceInput = wrapperEl.querySelector('.rc-option-price');

        const calcEl = buildCalcEl(row);

        // field가 숫자 칸이면 parseFloat, 텍스트 칸(옵션명)이면 그대로 저장한다.
        const wireField = (input, field, numeric) => {
          if (row.pristine && input.value !== '') input.dataset.rcPristine = '1';
          const setFromInput = () => {
            row[field] = input.value === '' ? '' : (numeric ? parseFloat(input.value) : input.value);
          };
          input.addEventListener('mousedown', () => {
            if (input.dataset.rcPristine === '1' && input.value !== '') {
              input.value = '';
              input.dataset.rcPristine = '0';
              row.pristine = false;
              setFromInput();
            }
          });
          input.addEventListener('input', () => {
            input.dataset.rcPristine = '0';
            row.pristine = false;
            setFromInput();
            persistWork();
          });
        };

        checkedInput.addEventListener('change', () => { row.checked = checkedInput.checked; persistWork(); });
        toggleBtn.addEventListener('click', () => {
          row.collapsed = !row.collapsed;
          bodyEl.hidden = row.collapsed;
          toggleBtn.textContent = row.collapsed ? '▸' : '▾';
          toggleBtn.setAttribute('aria-expanded', row.collapsed ? 'false' : 'true');
        });
        wrapperEl.querySelector('.rc-option-calc-btn').addEventListener('click', () => openOptionCalcModal(row, calcEl));
        wireField(labelInput, 'label', false);
        wireField(widthInput, 'width', true);
        wireField(heightInput, 'height', true);
        wireField(depthInput, 'depth', true);
        wireField(priceInput, 'price', true);
        priceInput.addEventListener('input', () => refreshRowCalc(row, calcEl));
        wrapperEl.querySelector('.rc-option-remove').addEventListener('click', () => {
          rows = rows.filter(r => r.id !== row.id);
          persistWork();
          renderOptionRows();
        });
        bodyEl.appendChild(calcEl);
        optionRowsEl.appendChild(wrapperEl);
        refreshRowCalc(row, calcEl);
      });
    }
    renderOptionRows();

    // 미리보기 위안 가격/사이즈를 체크된 옵션 전체의 칸에 그대로 덮어쓴다. 채운 항목만 적용되고
    // (예: 사이즈는 비워두고 가격만 채우면 가격만 덮어씀), 비워둔 항목은 옵션의 기존 값을 그대로 둔다.
    box.querySelector('#rc-apply-price').addEventListener('click', () => {
      const cnyVal = cnyPreviewInput.value;
      const widthVal = widthPreviewInput.value;
      const heightVal = heightPreviewInput.value;
      const depthVal = depthPreviewInput.value;
      const hasCny = cnyVal !== '' && !isNaN(parseFloat(cnyVal));
      const hasWidth = widthVal !== '' && !isNaN(parseFloat(widthVal));
      const hasHeight = heightVal !== '' && !isNaN(parseFloat(heightVal));
      const hasDepth = depthVal !== '' && !isNaN(parseFloat(depthVal));
      if (!hasCny && !hasWidth && !hasHeight && !hasDepth) {
        showToast('위안 가격이나 사이즈를 먼저 입력하세요.', true);
        return;
      }
      const checkedRows = rows.filter(r => r.checked);
      if (checkedRows.length === 0) {
        showToast('체크된 옵션이 없어요.', true);
        return;
      }
      checkedRows.forEach((row) => {
        if (hasCny) {
          row.price = parseFloat(cnyVal);
          // 가격을 새로 덮어쓰면 예전에 손으로 고쳐둔 공급가/판매가는 더 이상 맞지 않을 수 있어
          // 마진율 계산값으로 되돌린다.
          row.supplyPriceOverride = null;
          row.sellingPriceOverride = null;
        }
        if (hasWidth) row.width = parseFloat(widthVal);
        if (hasHeight) row.height = parseFloat(heightVal);
        if (hasDepth) row.depth = parseFloat(depthVal);
        row.pristine = false;

        // 카드를 통째로 다시 그리면 접어둔 상태가 초기화되므로, 접힘/펼침은 그대로 두고 값만 갱신한다.
        const wrapperEl = optionRowsEl.querySelector(`[data-row-id="${row.id}"]`);
        if (wrapperEl) {
          const [widthInput, heightInput, depthInput] = wrapperEl.querySelectorAll('.rc-option-dim');
          const priceInput = wrapperEl.querySelector('.rc-option-price');
          if (hasWidth) widthInput.value = numVal(row.width);
          if (hasHeight) heightInput.value = numVal(row.height);
          if (hasDepth) depthInput.value = numVal(row.depth);
          if (hasCny) priceInput.value = numVal(row.price);
          [widthInput, heightInput, depthInput, priceInput].forEach((input) => { input.dataset.rcPristine = '0'; });
          const calcEl = wrapperEl.querySelector('.rc-option-calc');
          if (calcEl) refreshRowCalc(row, calcEl);
        }
      });
      persistWork();
      showToast(`체크된 옵션 ${checkedRows.length}개에 적용했어요.`);
    });

    // ---- 견적서 찾기 ----
    // 앱의 "견적서 찾기"와 같은 화면. 검색·다운로드는 서플라이어허브 탭에서 일어나고, 받은
    // 파일은 확장 저장소에 넣어둔다. 앱은 1688 값을 받을 때 그 파일을 가져가 상품에 등록한다.
    const quoteKeywordInput = box.querySelector('#rc-quote-keyword');
    const quoteSearchBtn = box.querySelector('#rc-quote-search');
    const quoteResultsEl = box.querySelector('#rc-quote-results');
    const quoteStatusEl = box.querySelector('#rc-quote-status');
    const titleInput = box.querySelector('#rc-title');
    let searchedKeyword = '';

    // 상품명에서 뽑은 키워드 후보들. 검색은 한 단어여야 결과가 나오므로, 눌러서 바꿔 가며
    // 찾을 수 있게 칩으로 늘어놓는다(앱의 견적서 찾기와 같은 방식).
    const quoteWordsEl = box.querySelector('#rc-quote-words');

    const renderKeywordWords = () => {
      const words = extractCategoryKeywords(titleInput.value);
      quoteWordsEl.innerHTML = '';
      words.forEach((word) => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = `rc-quote-word${quoteKeywordInput.value.trim() === word ? ' on' : ''}`;
        chip.textContent = word;
        chip.addEventListener('click', () => {
          quoteKeywordInput.value = word;
          quoteKeywordInput.dataset.rcTouched = '1';
          renderKeywordWords();
        });
        quoteWordsEl.appendChild(chip);
      });
    };

    // 검색어는 상품명에서 뽑아 기본값으로 깔아준다. 사람이 한 번 고치면 그 뒤로는 건드리지 않는다.
    quoteKeywordInput.value = guessCategoryKeyword(titleInput.value);
    titleInput.addEventListener('input', () => {
      if (quoteKeywordInput.dataset.rcTouched !== '1') quoteKeywordInput.value = guessCategoryKeyword(titleInput.value);
      renderKeywordWords();
    });
    quoteKeywordInput.addEventListener('input', () => {
      quoteKeywordInput.dataset.rcTouched = '1';
      renderKeywordWords();
    });
    renderKeywordWords();

    const pickCategory = async (path) => {
      quoteResultsEl.innerHTML = '';
      quoteStatusEl.textContent = '견적서를 받는 중입니다...';
      const response = await askExtension({ type: 'CATEGORY_PICK', path });
      if (!response.ok) quoteStatusEl.textContent = `견적서를 받지 못했습니다: ${response.error}`;
    };

    const showQuoteDone = () => {
      quoteResultsEl.innerHTML = '';
      quoteStatusEl.innerHTML = '';
      const done = document.createElement('div');
      done.className = 'rc-quote-done';
      done.textContent = `✓ "${categoryQuote.category}" 견적서를 받았습니다. "등록하기"를 누르면 이 상품에 함께 등록됩니다.`;
      quoteStatusEl.appendChild(done);
      persistWork();
    };

    // 견적서 한 장에 카테고리가 여러 개 들어 있는 경우. 어느 값을 넣을지 여기서 고른다.
    const showCategoryOptions = (options, fallback) => {
      quoteStatusEl.textContent = '견적서에 넣을 카테고리를 고르세요. (파일의 드롭다운에 있는 값 그대로 들어갑니다)';
      quoteResultsEl.innerHTML = '';
      options.forEach((option) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'rc-quote-item';
        // 고른 카테고리 경로의 마지막 조각과 같은 값이 대개 맞는 값이라 표시해준다.
        item.textContent = option === fallback ? `${option} (찾은 카테고리)` : option;
        item.addEventListener('click', () => {
          categoryQuote.category = option;
          showQuoteDone();
        });
        quoteResultsEl.appendChild(item);
      });
    };

    categoryHandlers = {
      onResults: (items) => {
        quoteResultsEl.innerHTML = '';
        if (items.length === 0) {
          quoteStatusEl.textContent = '검색 결과가 없습니다. 다른 단어로 찾아보세요.';
          return;
        }
        quoteStatusEl.textContent = `${items.length}개를 찾았어요. 맞는 카테고리를 누르면 견적서를 받습니다.`;
        items.forEach((path) => {
          const item = document.createElement('button');
          item.type = 'button';
          item.className = 'rc-quote-item';
          item.textContent = path;
          item.addEventListener('click', () => { void pickCategory(path); });
          quoteResultsEl.appendChild(item);
        });
      },
      onFile: async ({ name, dataUrl, path }) => {
        const keyword = searchedKeyword || guessCategoryKeyword(titleInput.value);
        const saved = await saveCategoryQuote({ name, dataUrl, path, keyword, savedAt: Date.now() });
        if (!saved.ok) {
          quoteStatusEl.textContent = `견적서를 저장하지 못했습니다: ${saved.error}`;
          return;
        }

        // 파일 자체는 저장소에 두고, 넘기는 값에는 어떤 견적서인지만 적는다(클립보드에 수 MB를
        // 실으면 복사·붙여넣기가 무거워진다).
        const fallback = String(path || '').split('>').pop().trim() || '카테고리';
        categoryQuote = { name, path, keyword, category: fallback };

        quoteResultsEl.innerHTML = '';
        quoteStatusEl.textContent = '견적서를 확인하는 중입니다...';

        // 견적서의 카테고리 칸은 드롭다운이라 파일에 든 값 그대로 넣어야 한다. 파일을 열어 그
        // 목록을 읽고, 여러 개면 여기서 고르게 한다(못 읽으면 앱이 물어본다).
        let options = [];
        try {
          options = await window.__rocketReadCategoryOptions(dataUrl);
        } catch (err) {
          console.warn('[로켓제안] 견적서 카테고리 목록을 읽지 못했습니다', err);
        }

        if (options.length > 1) showCategoryOptions(options, fallback);
        else {
          categoryQuote.category = options[0] || fallback;
          showQuoteDone();
        }
      },
      onError: (message) => {
        quoteResultsEl.innerHTML = '';
        quoteStatusEl.textContent = `오류: ${message}`;
      },
    };

    quoteSearchBtn.addEventListener('click', async () => {
      const keyword = quoteKeywordInput.value.trim();
      if (!keyword) {
        showToast('검색어를 한 단어 입력해주세요.', true);
        return;
      }
      searchedKeyword = keyword;
      quoteResultsEl.innerHTML = '';
      quoteStatusEl.textContent = `"${keyword}" 카테고리를 찾는 중입니다... (쿠팡 창이 잠깐 열립니다)`;
      quoteSearchBtn.disabled = true;
      const response = await askExtension({ type: 'CATEGORY_SEARCH', keyword });
      quoteSearchBtn.disabled = false;
      if (!response.ok) quoteStatusEl.textContent = `검색을 시작하지 못했습니다: ${response.error}`;
    });

    quoteKeywordInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        quoteSearchBtn.click();
      }
    });

    // ---- 1번: 페이지 사진 고르기 ----
    // 고른 사진은 "상세페이지 에디터 열기"를 누르는 순간 받아서 함께 보낸다. 미리 받아두면
    // 고르기만 하고 에디터를 안 여는 경우에 헛일이 되고, 메모리에 몇 MB를 들고 있게 된다.
    const imageScanBtn = box.querySelector('#rc-scan-images');
    const imageArea = box.querySelector('#rc-image-area');
    const imageGrid = box.querySelector('#rc-image-grid');
    const imageCountEl = box.querySelector('#rc-image-count');
    const imageStatusEl = box.querySelector('#rc-image-status');

    const pickedImageUrls = () => imageItems.filter((item) => item.checked).map((item) => item.url);

    // 대표이미지를 옵션별로 고를 수 있게, 지금 체크된 옵션들의 이름을 순서대로 돌려준다.
    // (이름이 비어 있는 행은 "옵션 1"처럼 순번으로 부른다.)
    const optionLabels = () => rows.filter((row) => row.checked).map((row, i) => row.label.trim() || `옵션 ${i + 1}`);

    // 끌어다 놓아 순서를 바꾸는 중인 사진의 자리.
    let dragIndex = null;

    const renderImageGrid = () => {
      imageGrid.innerHTML = '';
      // 고른 사진에는 몇 번째로 들어갈지 번호를 보여준다 — 에디터에 이 순서 그대로 담긴다.
      const orderOf = new Map();
      imageItems.filter((item) => item.checked).forEach((item, i) => orderOf.set(item.url, i + 1));

      imageItems.forEach((item, index) => {
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.draggable = true;
        tile.className = `rc-image-tile${item.checked ? ' on' : ''}`;

        const img = document.createElement('img');
        img.loading = 'lazy';
        img.src = thumbUrl(item.url);
        // 크기를 붙인 주소가 안 먹는 이미지 서버도 있어, 실패하면 원본으로 보여준다.
        img.addEventListener('error', () => { img.src = item.url; }, { once: true });
        tile.appendChild(img);

        const check = document.createElement('span');
        check.className = 'rc-image-check';
        check.textContent = item.checked ? String(orderOf.get(item.url)) : '';
        tile.appendChild(check);

        const kind = document.createElement('span');
        kind.className = 'rc-image-kind';
        // 대표로 지정한 사진은 어느 옵션의 대표인지 보여준다.
        kind.textContent = item.mainFor
          ? `★ ${item.mainFor || '대표'}`
          : item.kind === 'detail' ? '상세' : item.kind === 'etc' ? '기타' : '대표';
        tile.appendChild(kind);

        // 대표이미지(썸네일)는 옵션마다 따로 고를 수 있다. ★를 누를 때마다 옵션을 하나씩
        // 돌아가며 지정된다(마지막 옵션 다음은 지정 해제). 작은 칸에 목록을 띄우면 가려져서
        // 누르기 어려우므로 돌려가며 고르는 방식으로 둔다.
        const star = document.createElement('span');
        star.className = `rc-image-star${item.mainFor ? ' on' : ''}`;
        star.textContent = '★';
        star.title = optionLabels().length > 1 ? '누를 때마다 옵션이 바뀝니다 (대표이미지 지정)' : '대표이미지로 지정';
        star.addEventListener('click', (event) => {
          event.stopPropagation();
          const labels = optionLabels();
          if (labels.length === 0) return;
          const current = labels.indexOf(item.mainFor);
          const nextLabel = current + 1 >= labels.length ? null : labels[current + 1];
          // 한 옵션에 두 장이 대표일 수는 없다. 다른 사진에 걸려 있던 지정은 푼다.
          if (nextLabel) imageItems.forEach((other) => { if (other.mainFor === nextLabel) other.mainFor = null; });
          item.mainFor = nextLabel;
          if (nextLabel) item.checked = true;
          renderImageGrid();
        });
        tile.appendChild(star);

        tile.addEventListener('click', () => {
          item.checked = !item.checked;
          // 대표로 지정한 사진을 빼면 대표 지정도 같이 푼다.
          if (!item.checked) item.mainFor = null;
          renderImageGrid();
        });

        // 끌어다 놓아 순서 바꾸기. 여기서 만든 순서 그대로 상세페이지 에디터에 담긴다.
        tile.addEventListener('dragstart', (event) => {
          dragIndex = index;
          tile.classList.add('dragging');
          if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = 'move';
            // 파이어폭스는 데이터가 없으면 끌기 자체가 시작되지 않는다.
            try { event.dataTransfer.setData('text/plain', String(index)); } catch (err) { /* 무시 */ }
          }
        });
        tile.addEventListener('dragend', () => {
          dragIndex = null;
          renderImageGrid();
        });
        tile.addEventListener('dragover', (event) => {
          if (dragIndex === null || dragIndex === index) return;
          event.preventDefault();
          if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
          tile.classList.add('drop');
        });
        tile.addEventListener('dragleave', () => tile.classList.remove('drop'));
        tile.addEventListener('drop', (event) => {
          event.preventDefault();
          tile.classList.remove('drop');
          if (dragIndex === null || dragIndex === index) return;
          const [moved] = imageItems.splice(dragIndex, 1);
          imageItems.splice(index, 0, moved);
          dragIndex = null;
          renderImageGrid();
        });

        imageGrid.appendChild(tile);
      });
      const mainCount = imageItems.filter((item) => item.mainFor).length;
      imageCountEl.textContent = `${pickedImageUrls().length}장 선택${mainCount > 0 ? ` · 대표 ${mainCount}장` : ''}`;
      persistWork();
    };

    // 창이 열리면 바로 한 번 돌린다(아래 scanImages 호출). 버튼은 다시 찾을 때만 쓴다.
    const scanImages = async () => {
      if (imageScanBtn.disabled) return;
      imageScanBtn.disabled = true;
      imageStatusEl.textContent = '페이지를 훑어 사진을 찾는 중입니다...';
      try {
        await loadLazyImages();
        const frameItems = await collectFrameImages(5000);
        // 대표 이미지는 기본으로 골라두고, 상세·기타는 배너나 추천상품이 섞여 있어 직접 고르게 둔다.
        const candidates = mergeImages([collectPageImages(), frameItems]);
        imageStatusEl.textContent = `사진 ${candidates.length}장의 크기를 확인하는 중입니다...`;
        const bigEnough = await keepBigImages(candidates, (done, total) => {
          imageStatusEl.textContent = `사진 크기 확인 중 ${done}/${total}...`;
        });
        imageItems = bigEnough.map((item) => ({ ...item, checked: item.kind === 'main' }));
        if (imageItems.length === 0) {
          imageArea.hidden = true;
          imageStatusEl.textContent = '이 페이지에서 사진을 찾지 못했습니다.';
        } else {
          imageArea.hidden = false;
          renderImageGrid();
          const count = (kind) => imageItems.filter((item) => item.kind === kind).length;
          imageStatusEl.textContent =
            `대표 ${count('main')} · 상세 ${count('detail')} · 기타 ${count('etc')}장 (가로 ${MIN_IMAGE_WIDTH}px 미만은 뺐습니다). 쓸 사진만 남기세요.`;
        }
      } finally {
        imageScanBtn.disabled = false;
      }
    };

    imageScanBtn.addEventListener('click', () => { void scanImages(); });

    box.querySelector('#rc-image-all').addEventListener('click', () => {
      imageItems.forEach((item) => { item.checked = true; });
      renderImageGrid();
    });

    box.querySelector('#rc-image-none').addEventListener('click', () => {
      imageItems.forEach((item) => { item.checked = false; });
      renderImageGrid();
    });

    // "등록하기"는 이 창에서 만든 것을 한 번에 앱으로 넘긴다 — 상품 값(복붙과 같은 처리), 고른
    // 사진, 받아둔 견적서까지. 앱 화면은 창으로 띄워 그대로 쓴다(background.js가 연다).
    const detailEditorBtn = box.querySelector('#rc-copy');

    const openDetailEditor = async () => {
      const urls = pickedImageUrls();
      let images = [];

      if (urls.length > 0) {
        const label = detailEditorBtn.textContent;
        detailEditorBtn.disabled = true;
        try {
          images = await downloadImages(urls, (done, total) => {
            detailEditorBtn.textContent = `사진 받는 중... ${done}/${total}`;
            imageStatusEl.textContent = `사진 ${done}/${total}장 받는 중입니다...`;
          });
        } finally {
          detailEditorBtn.disabled = false;
          detailEditorBtn.textContent = label;
        }
        // 어느 사진이 어느 옵션의 대표인지 앱에 알려준다. 앱은 옵션 순서대로 상품 행을 만들므로
        // 체크된 옵션 중 몇 번째인지(mainForIndex)로 넘긴다.
        const labels = optionLabels();
        images = images.map(({ name, dataUrl, url }) => {
          const item = imageItems.find((candidate) => candidate.url === url);
          const index = item && item.mainFor ? labels.indexOf(item.mainFor) : -1;
          return { name, dataUrl, ...(index >= 0 ? { mainForIndex: index, mainForLabel: item.mainFor } : {}) };
        });
        imageStatusEl.textContent = `사진 ${images.length}장을 담아 보냅니다.`;
        if (images.length < urls.length) {
          showToast(`사진 ${urls.length - images.length}장은 받지 못해 빼고 보냅니다.`, true);
        }
      }

      // 에디터를 복붙보다 먼저 열기 때문에, 지금 입력해둔 값을 통째로 들려 보낸다.
      // 앱은 이 값으로 상품 행을 채우고(복붙과 같은 처리) 사진까지 담은 에디터를 연다.
      const payload = { ...(buildPayload({ silent: true }) || {}), images };
      console.log('[로켓제안] 에디터로 보낼 값', { ...payload, images: `${images.length}장` });

      const saved = await savePendingDetailCopy(payload);
      if (!saved.ok) {
        showToast(`값을 넘기지 못했습니다: ${saved.error}`, true);
        return;
      }

      const response = await askExtension({
        type: 'OPEN_APP_DETAIL',
        screenWidth: window.screen.availWidth,
        screenHeight: window.screen.availHeight,
      });
      if (!response || !response.ok) {
        showToast(`앱 창을 열지 못했습니다: ${(response && response.error) || '확장을 새로고침해주세요.'}`, true);
      }
    };

    box.querySelector('#rc-copy-prompt').addEventListener('click', async () => {
      const prompt = buildDetailPageCopyPrompt({
        productName: box.querySelector('#rc-title').value.trim(),
        category: '',
        material: box.querySelector('#rc-material').value.trim(),
        sellingPoints: box.querySelector('#rc-selling-points').value.trim(),
      });
      try {
        await navigator.clipboard.writeText(prompt);
        showToast('프롬프트를 복사했어요. AI에 붙여넣고 받은 답을 아래 칸에 넣어주세요.');
      } catch (err) {
        showToast('클립보드 복사에 실패했습니다: ' + err.message, true);
      }
    });

    box.querySelector('#rc-add-option').addEventListener('click', () => {
      rows.push(makeRow('', true));
      renderOptionRows();
      persistWork();
    });

    box.querySelector('#rc-pick-options').addEventListener('click', async () => {
      box.style.display = 'none';
      const added = [];
      const { cancelled } = await startPickMode((text) => {
        const row = makeRow(text, true);
        added.push(row.id);
        rows.push(row);
      });
      if (cancelled) rows = rows.filter(r => !added.includes(r.id));
      box.style.display = '';
      renderOptionRows();
      persistWork();
    });

    // 상품명/제조사/SKU/중량은 상품이 바뀌어도 계속 재사용하고 싶어하는 값이라 draft를 그대로
    // 유지한다. 다만 상품명/제조사/SKU는 상품마다 고유해서 이전 "다른" 상품의 draft가 그대로
    // 남으면 잘못된 값이 되므로, 이 페이지가 이전에 draft를 저장했던 상품과 다른 상품일 때만
    // 새로 읽어온 값을 우선한다. 같은 상품 페이지에서 모달을 다시 열 때(사용자가 값을 직접 고친
    // 뒤 나갔다 돌아오는 경우 포함)는 매번 페이지에서 재추출한 값이 사용자가 고친 값을 덮어써
    // 버리는 문제가 있었으므로, 이때는 draft 값을 그대로 쓴다.
    const draft = await loadDraft();
    const guessed = valuesFromGuess(initial);
    const sameProduct = !!(draft && draft.guessedSku && initial.sku && draft.guessedSku === initial.sku);
    const merged = !draft
      ? guessed
      : sameProduct
        ? draft
        : {
            ...draft,
            title: guessed.title || draft.title,
            manufacturer: guessed.manufacturer || draft.manufacturer,
            sku: draft.sku,
          };
    applyValues(box, merged);

    // 상품명이 채워진 뒤에 견적서 검색어 기본값을 다시 깐다(applyValues는 input 이벤트를
    // 내지 않아서, 위에서 건 리스너로는 반영되지 않는다).
    if (quoteKeywordInput.dataset.rcTouched !== '1') {
      quoteKeywordInput.value = guessCategoryKeyword(titleInput.value);
    }
    renderKeywordWords();

    const isOptionRowInput = (el) => el.classList && (el.classList.contains('rc-option-label') || el.classList.contains('rc-option-dim') || el.classList.contains('rc-option-price'));

    // draft에는 편집된 값과 함께, 이 값이 어느 상품 페이지에서 저장된 것인지(guessedSku)도 같이
    // 남겨서, 다음에 모달을 열 때 "같은 상품으로 돌아온 것"인지 판별할 수 있게 한다.
    const persistDraft = () => saveDraft({ ...readFormValues(box), guessedSku: initial.sku });

    box.querySelector('.rc-fields').addEventListener('input', (e) => {
      if (e.target.classList && e.target.classList.contains('rc-input') && !isOptionRowInput(e.target)) {
        e.target.dataset.rcPristine = '0';
      }
      persistDraft();
    });

    // 이전 값이 그대로 남아있는 필드를 처음 클릭하면 그 값을 지워서, 지우지 않고 바로 새 값을 입력할 수 있게 한다.
    box.querySelector('.rc-fields').addEventListener('mousedown', (e) => {
      const target = e.target;
      if (target.tagName === 'INPUT' && target.dataset.rcPristine === '1' && target.value !== '' && !isOptionRowInput(target)) {
        target.value = '';
        target.dataset.rcPristine = '0';
        persistDraft();
      }
    });

    const close = () => {
      persistDraft();
      persistWork();
      overlay.remove();
      if (currentBox === box) currentBox = null;
      categoryHandlers = null;
    };
    // 배경이 더 이상 클릭을 가로채지 않아(뒤 페이지를 자유롭게 조작할 수 있게) 바깥 클릭으로는
    // 닫히지 않는다. 취소/복사하기 버튼으로만 닫는다.
    box.querySelector('#rc-cancel').addEventListener('click', close);
    box.querySelector('#rc-reset').addEventListener('click', () => {
      clearDraft();
      clearWorkDraft();
      // 고른 사진과 받아둔 견적서도 여기서만 지운다.
      imageItems = [];
      categoryQuote = null;
      imageArea.hidden = true;
      imageGrid.innerHTML = '';
      imageStatusEl.textContent = '';
      quoteResultsEl.innerHTML = '';
      quoteStatusEl.textContent = '';
      try {
        chrome.storage.local.remove(QUOTE_KEY);
      } catch (err) {
        /* 확장이 새로 로드된 경우 무시 */
      }
      applyValues(box, valuesFromGuess(initial));
      rows = initial.colorRaw ? [makeRow(initial.colorRaw, true)] : [];
      cnyPreviewInput.value = defaultPrice;
      widthPreviewInput.value = defaultWidth;
      heightPreviewInput.value = defaultHeight;
      depthPreviewInput.value = defaultDepth;
      updateMainResult();
      renderOptionRows();
    });

    // 복사하기와 "상세페이지 에디터 열기"가 같은 값을 쓰도록, payload 만드는 부분을 함수로 둔다.
    // silent면 옵션이 없어도 경고 없이 null을 돌려준다(에디터만 열 때는 옵션이 없을 수 있다).
    const buildPayload = ({ silent } = {}) => {
      const num = (id) => {
        const v = box.querySelector(id).value;
        return v === '' ? null : parseFloat(v);
      };

      const checkedRows = rows.filter(r => r.checked);
      if (checkedRows.length === 0 && !silent) {
        showToast('옵션을 최소 1개는 선택해주세요.', true);
        return null;
      }

      // 1번 섹션(기본 정보)의 가로/세로/높이는 "↑ 옵션에 적용하기"를 눌러야 옵션 행에 반영되는데,
      // 상품명/중량처럼 바로 반영되는 필드로 오해하기 쉽다. 그래서 옵션 행 자체에 값이 없을 때는
      // "적용"을 안 눌렀더라도 이 기본 정보 칸의 값을 그대로 사용해 복사되게 한다.
      const topWidth = num('#rc-margin-width');
      const topHeight = num('#rc-margin-height');
      const topDepth = num('#rc-margin-depth');

      return {
        source: '1688-import',
        url: location.href,
        // 확장에서 받아둔 카테고리 견적서. 파일 자체는 확장 저장소에 있고, 앱이 그걸 가져가
        // 이 상품에 등록한다(사진과 같은 방식).
        ...(categoryQuote ? { categoryQuote } : {}),
        titleRaw: box.querySelector('#rc-title').value.trim(),
        manufacturerRaw: box.querySelector('#rc-manufacturer').value.trim(),
        sku: box.querySelector('#rc-sku').value.trim(),
        materialRaw: box.querySelector('#rc-material').value.trim(),
        weightG: num('#rc-weight'),
        // 상세페이지 문구(AI 답변 원문). 앱이 이 글을 파싱해서 상세페이지 에디터에 채워 넣는다.
        detailCopyText: box.querySelector('#rc-detail-copy').value.trim(),
        sellingPoints: box.querySelector('#rc-selling-points').value.trim(),
        variants: checkedRows.map((r) => {
          const { exchangeRate, supplyMarginPercent, sellingMarginPercent } = getMarginInputs();
          const calc = computeMargin(r.price, exchangeRate, supplyMarginPercent, sellingMarginPercent, r.supplyPriceOverride, r.sellingPriceOverride);
          return {
            colorRaw: r.label.trim(),
            priceCny: r.price === '' || r.price === null || isNaN(r.price) ? null : r.price,
            sizeCm: {
              width: r.width === '' || r.width === null || isNaN(r.width) ? topWidth : r.width,
              height: r.height === '' || r.height === null || isNaN(r.height) ? topHeight : r.height,
              depth: r.depth === '' || r.depth === null || isNaN(r.depth) ? topDepth : r.depth,
            },
            // 수익 계산기 입력(환율/마진율)을 채운 경우에만 포함. 앱에서는 이 값이 있으면
            // priceCny×환율 대신 이 값을 그대로 원가/공급가/판매가/마진에 채워 넣는다.
            ...(calc && calc.supplyPriceKrw > 0 ? {
              costPriceKrw: calc.costPriceKrw,
              supplyPriceKrw: calc.supplyPriceKrw,
              sellingPriceKrw: calc.sellingPriceKrw > 0 ? calc.sellingPriceKrw : null,
              marginKrw: calc.marginKrw,
            } : {}),
          };
        }),
      };
    };

    detailEditorBtn.addEventListener('click', async () => {
      // 옵션을 하나도 고르지 않았으면 여기서 멈춘다(경고는 buildPayload가 띄운다).
      const payload = buildPayload();
      if (!payload) return;

      // 앱이 이미 열려 있어 직접 붙여넣고 싶을 때를 위해 값은 클립보드에도 남겨둔다
      // (사진·견적서 파일은 무거워서 클립보드에 싣지 않는다).
      try {
        await navigator.clipboard.writeText(JSON.stringify(payload));
      } catch (err) {
        /* 클립보드를 못 써도 아래 등록은 그대로 진행한다 */
      }

      try {
        await openDetailEditor();
        close();
      } catch (err) {
        console.error('[로켓제안] 등록 실패', err);
        showToast(`등록하지 못했습니다: ${(err && err.message) || err}`, true);
        detailEditorBtn.disabled = false;
        detailEditorBtn.textContent = '🚀 등록하기';
      }
    });

    // 지난번에 고른 사진과 받아둔 견적서를 되살린다. "초기화"를 누르기 전까지는 창을 닫았다
    // 열어도, 페이지를 오갔다 와도 그대로 있어야 한다.
    if (workDraft && Array.isArray(workDraft.images) && workDraft.images.length > 0) {
      imageItems = workDraft.images.map((item) => ({
        url: item.url,
        kind: item.kind || 'main',
        checked: !!item.checked,
        mainFor: item.mainFor || null,
      }));
      imageArea.hidden = false;
      renderImageGrid();
      imageStatusEl.textContent = `지난번에 고른 사진 ${imageItems.length}장입니다. 다시 찾으려면 아래 버튼을 누르세요.`;
    }

    if (workDraft && workDraft.categoryQuote) {
      categoryQuote = workDraft.categoryQuote;
      searchedKeyword = categoryQuote.keyword || '';
      showQuoteDone();
    }

    // 사진 찾기는 사람이 누르지 않아도 되게, 창이 뜨자마자 자동으로 돌린다(지난 작업이 있으면
    // 그대로 두고 건너뛴다). 페이지를 위아래로 훑느라 몇 초 걸리므로 기다리지 않고 진행한다.
    if (imageItems.length === 0) void scanImages();
  }

  function showToast(message, isError) {
    const toast = document.createElement('div');
    toast.className = 'rc-toast';
    toast.style.background = isError ? '#dc2626' : '#16a34a';
    toast.textContent = message;
    root.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
  }

  function injectButton() {
    const btn = document.createElement('button');
    btn.className = 'rc-fab';
    btn.textContent = '📋 1688 캡처';
    btn.addEventListener('click', async () => {
      // 캡처를 누르면 곧바로 옵션 고르기부터 시작한다. "완료"를 누르면 고른 옵션이 이미 채워진
      // 상태로 입력 창이 열린다(창을 열었다 나갔다 다시 들어오는 수고를 없앤다).
      const picked = [];
      const { cancelled } = await startPickMode((text) => picked.push(text));
      if (cancelled) return;

      const sizeWeight = guessSizeAndWeight();
      const titleRaw = guessTitle();
      const manufacturerRaw = guessManufacturer();
      buildModal({
        // 상품명 추출이 실패해서 제조사명과 같은 값으로 겹치면 잘못된 값이므로 비운다.
        titleRaw: titleRaw && titleRaw === manufacturerRaw ? '' : titleRaw,
        manufacturerRaw,
        sku: guessSku(),
        colorRaw: guessColor(),
        priceCny: guessPriceCny(),
        sizeCm: { width: sizeWeight.width, height: sizeWeight.height, depth: sizeWeight.depth },
        weightG: sizeWeight.weight,
      }, picked);
    });
    root.appendChild(btn);
  }

  if (window.top !== window.self) {
    // iframe 안에서는 사진 모으기만 돕는다(버튼·창은 맨 위 창에만).
    setUpFrameCollector();
  } else if (document.readyState === 'complete' || document.readyState === 'interactive') {
    injectButton();
  } else {
    document.addEventListener('DOMContentLoaded', injectButton);
  }
})();
