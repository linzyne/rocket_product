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
    .rc-overlay { position:fixed; inset:0; z-index:2147483647; display:flex; align-items:center; justify-content:center; pointer-events:none; }
    .rc-box { pointer-events:auto; background:#ffffff; color:#1e293b; width:330px; max-width:94vw; max-height:88vh; overflow-y:auto; overflow-x:hidden; border-radius:12px; padding:14px; border:1px solid #e2e8f0; box-shadow:0 25px 50px -12px rgba(0,0,0,0.35); }
    .rc-box h2 { margin:0; font-size:15px; font-weight:700; cursor:move; user-select:none; color:#0f172a; }
    .rc-box h2::after { content:'✥ 드래그해서 옮기기'; display:block; font-size:10px; font-weight:400; color:#94a3b8; margin-top:1px; }
    .rc-hint { margin:6px 0 0; font-size:11px; color:#64748b; line-height:1.4; }
    .rc-fields { display:flex; flex-direction:column; gap:10px; margin-top:10px; }
    .rc-section {
      background:#e2e8f0; border:1px solid #94a3b8; border-radius:12px; padding:11px 12px;
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
    .rc-pick-bar { position:fixed; top:16px; left:50%; transform:translateX(-50%); z-index:2147483647; background:#ffffff; color:#0f172a; padding:10px 16px; border-radius:9999px; border:1px solid #e2e8f0; box-shadow:0 10px 25px -5px rgba(0,0,0,0.25); font-size:13px; display:flex; align-items:center; gap:10px; max-width:90vw; }
    .rc-pick-bar span { min-width:0; }
    .rc-pick-bar button { flex:0 0 auto; padding:5px 14px; border-radius:9999px; border:none; background:#f97316; color:#fff; font-weight:600; cursor:pointer; font-size:12px; }
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
    .rc-image-work-btn { width:100%; padding:10px 14px; border-radius:10px; border:none; background:linear-gradient(135deg,#60a5fa,#3b82f6); color:#fff; cursor:pointer; font-size:13px; font-weight:700; margin-top:8px; box-shadow:0 6px 16px -4px rgba(59,130,246,0.55); transition:transform .12s ease, box-shadow .12s ease; }
    .rc-image-work-btn:hover { transform:translateY(-1px); box-shadow:0 8px 20px -4px rgba(59,130,246,0.65); }
    .rc-image-work-btn:active { transform:translateY(0); }
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

  // 로켓제안서 앱의 수익 계산기(MarginCalculatorModal)와 동일한 계산식. 옵션별 위안화 가격에
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
      material: box.querySelector('#rc-material').value,
      weight: box.querySelector('#rc-weight').value,
    };
  }

  function applyValues(box, values) {
    box.querySelector('#rc-title').value = values.title ?? '';
    box.querySelector('#rc-manufacturer').value = values.manufacturer ?? '';
    box.querySelector('#rc-sku').value = values.sku ?? '';
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
      sku: initial.sku || '',
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
  function startPickMode(onAdd) {
    return new Promise((resolve) => {
      const highlight = document.createElement('div');
      highlight.className = 'rc-pick-highlight';
      root.appendChild(highlight);

      const bar = document.createElement('div');
      bar.className = 'rc-pick-bar';
      bar.innerHTML = `<span>옵션 요소를 클릭하세요 (<span id="rc-pick-count">0</span>개 선택됨)</span><button type="button" id="rc-pick-done">완료</button>`;
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

      const onClick = (e) => {
        const target = e.target;
        if (target === shadowHost) return; // 완료 버튼 등 우리 UI 클릭은 그대로 통과시킨다.
        e.preventDefault();
        e.stopPropagation();
        const text = (target.getAttribute('title') || target.textContent || '').replace(/\s+/g, ' ').trim();
        if (!text || text.length > 60) return;
        count += 1;
        countEl.textContent = String(count);
        onAdd(text);
      };

      const onKeyDown = (e) => {
        if (e.key === 'Escape') finish();
      };

      const finish = () => {
        document.removeEventListener('mouseover', onMouseOver, true);
        document.removeEventListener('click', onClick, true);
        document.removeEventListener('keydown', onKeyDown, true);
        highlight.remove();
        bar.remove();
        resolve();
      };

      bar.querySelector('#rc-pick-done').addEventListener('click', finish);
      document.addEventListener('mouseover', onMouseOver, true);
      document.addEventListener('click', onClick, true);
      document.addEventListener('keydown', onKeyDown, true);
    });
  }

  async function buildModal(initial) {
    const overlay = document.createElement('div');
    overlay.className = 'rc-overlay';

    const box = document.createElement('div');
    box.className = 'rc-box';

    box.innerHTML = `
      <div class="rc-header-row">
        <h2>로켓제안서로 보낼 값 확인</h2>
        <div class="rc-header-actions">
          <button id="rc-reset" class="rc-btn-secondary" title="저장된 값을 지우고 이 페이지에서 다시 읽어옵니다">초기화</button>
          <button id="rc-cancel" class="rc-btn-secondary">취소</button>
        </div>
      </div>
      <div class="rc-fields">
        <div class="rc-section">
          <p class="rc-section-heading"><span class="rc-step-num">1</span>📝 기본 정보</p>
          <div class="rc-field-group">
            <label class="rc-label">제조사/공급사(원문)
              <input id="rc-manufacturer" class="rc-input" />
            </label>
            <label class="rc-label rc-label-red">상품명(원문)
              <input id="rc-title" class="rc-input" />
            </label>
            <label class="rc-label rc-label-red">SKU
              <input id="rc-sku" class="rc-input" />
            </label>
            <label class="rc-label">재질
              <input id="rc-material" class="rc-input" />
            </label>
            <label class="rc-label rc-label-red">중량 (g)
              <input id="rc-weight" class="rc-input" type="number" step="1" />
            </label>
            <div class="rc-row">
              <label class="rc-label rc-label-red">가로(cm)
                <input id="rc-margin-width" class="rc-input" type="number" step="0.1" placeholder="가로" />
              </label>
              <label class="rc-label rc-label-red">세로(cm)
                <input id="rc-margin-height" class="rc-input" type="number" step="0.1" placeholder="세로" />
              </label>
              <label class="rc-label rc-label-red">높이(cm)
                <input id="rc-margin-depth" class="rc-input" type="number" step="0.1" placeholder="높이" />
              </label>
            </div>
          </div>
        </div>
        <div class="rc-section">
          <p class="rc-section-heading"><span class="rc-step-num">2</span>🎨 옵션(색상 등)</p>
          <div id="rc-option-rows" class="rc-option-rows"></div>
          <div class="rc-option-buttons">
            <button type="button" id="rc-pick-options" class="rc-pick-option">🎯 클릭해서 옵션 선택</button>
            <button type="button" id="rc-add-option" class="rc-add-option">+ 직접 입력</button>
          </div>
        </div>
        <div class="rc-section">
          <p class="rc-section-heading"><span class="rc-step-num">3</span>💰 수익 계산기 (선택)</p>
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
          <button type="button" id="rc-image-work" class="rc-image-work-btn">🖼 이미지작업하기</button>
        </div>
      </div>
      <div class="rc-actions">
        <button id="rc-copy" class="rc-btn-primary">복사하기</button>
      </div>
    `;

    overlay.appendChild(box);
    root.appendChild(overlay);
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
    if (workDraft && Array.isArray(workDraft.rows) && workDraft.rows.length > 0) {
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

    // 옵션 카드의 🧮 아이콘을 누르면 뜨는 팝업. 로켓제안서 앱의 MarginCalculatorModal과 동일한
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

    [widthPreviewInput, heightPreviewInput, depthPreviewInput].forEach((input) => {
      input.addEventListener('input', () => { persistWork(); });
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
              <input type="number" step="0.1" class="rc-input rc-option-dim" placeholder="가로" value="${numVal(row.width)}" title="가로(cm)" />
              <span class="rc-option-dim-sep">×</span>
              <input type="number" step="0.1" class="rc-input rc-option-dim" placeholder="세로" value="${numVal(row.height)}" title="세로(cm)" />
              <span class="rc-option-dim-sep">×</span>
              <input type="number" step="0.1" class="rc-input rc-option-dim" placeholder="높이" value="${numVal(row.depth)}" title="높이(cm)" />
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

    box.querySelector('#rc-image-work').addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    box.querySelector('#rc-add-option').addEventListener('click', () => {
      rows.push(makeRow('', true));
      renderOptionRows();
      persistWork();
    });

    box.querySelector('#rc-pick-options').addEventListener('click', async () => {
      box.style.display = 'none';
      await startPickMode((text) => {
        rows.push(makeRow(text, true));
      });
      box.style.display = '';
      renderOptionRows();
      persistWork();
    });

    // 상품명/제조사/SKU/중량은 상품이 바뀌어도 계속 재사용하고 싶어하는 값이라 draft를 그대로
    // 유지한다. 다만 상품명/제조사/SKU는 상품마다 고유해서 이전 상품 draft가 그대로 남으면 잘못된
    // 값이 되므로, 이 페이지에서 새로 읽어오는 데 성공했을 때는 항상 그 값을 우선한다.
    const draft = await loadDraft();
    const guessed = valuesFromGuess(initial);
    const merged = draft
      ? {
          ...draft,
          title: guessed.title || draft.title,
          manufacturer: guessed.manufacturer || draft.manufacturer,
          sku: guessed.sku || draft.sku,
        }
      : guessed;
    applyValues(box, merged);

    const isOptionRowInput = (el) => el.classList && (el.classList.contains('rc-option-label') || el.classList.contains('rc-option-dim') || el.classList.contains('rc-option-price'));

    box.querySelector('.rc-fields').addEventListener('input', (e) => {
      if (e.target.classList && e.target.classList.contains('rc-input') && !isOptionRowInput(e.target)) {
        e.target.dataset.rcPristine = '0';
      }
      saveDraft(readFormValues(box));
    });

    // 이전 값이 그대로 남아있는 필드를 처음 클릭하면 그 값을 지워서, 지우지 않고 바로 새 값을 입력할 수 있게 한다.
    box.querySelector('.rc-fields').addEventListener('mousedown', (e) => {
      const target = e.target;
      if (target.tagName === 'INPUT' && target.dataset.rcPristine === '1' && target.value !== '' && !isOptionRowInput(target)) {
        target.value = '';
        target.dataset.rcPristine = '0';
        saveDraft(readFormValues(box));
      }
    });

    const close = () => {
      saveDraft(readFormValues(box));
      persistWork();
      overlay.remove();
    };
    // 배경이 더 이상 클릭을 가로채지 않아(뒤 페이지를 자유롭게 조작할 수 있게) 바깥 클릭으로는
    // 닫히지 않는다. 취소/복사하기 버튼으로만 닫는다.
    box.querySelector('#rc-cancel').addEventListener('click', close);
    box.querySelector('#rc-reset').addEventListener('click', () => {
      clearDraft();
      clearWorkDraft();
      applyValues(box, valuesFromGuess(initial));
      rows = initial.colorRaw ? [makeRow(initial.colorRaw, true)] : [];
      cnyPreviewInput.value = defaultPrice;
      widthPreviewInput.value = defaultWidth;
      heightPreviewInput.value = defaultHeight;
      depthPreviewInput.value = defaultDepth;
      updateMainResult();
      renderOptionRows();
    });

    box.querySelector('#rc-copy').addEventListener('click', async () => {
      const num = (id) => {
        const v = box.querySelector(id).value;
        return v === '' ? null : parseFloat(v);
      };

      const checkedRows = rows.filter(r => r.checked);
      if (checkedRows.length === 0) {
        showToast('옵션을 최소 1개는 선택해주세요.', true);
        return;
      }

      const payload = {
        source: '1688-import',
        url: location.href,
        titleRaw: box.querySelector('#rc-title').value.trim(),
        manufacturerRaw: box.querySelector('#rc-manufacturer').value.trim(),
        sku: box.querySelector('#rc-sku').value.trim(),
        materialRaw: box.querySelector('#rc-material').value.trim(),
        weightG: num('#rc-weight'),
        variants: checkedRows.map((r) => {
          const { exchangeRate, supplyMarginPercent, sellingMarginPercent } = getMarginInputs();
          const calc = computeMargin(r.price, exchangeRate, supplyMarginPercent, sellingMarginPercent, r.supplyPriceOverride, r.sellingPriceOverride);
          return {
            colorRaw: r.label.trim(),
            priceCny: r.price === '' || r.price === null || isNaN(r.price) ? null : r.price,
            sizeCm: {
              width: r.width === '' || r.width === null || isNaN(r.width) ? null : r.width,
              height: r.height === '' || r.height === null || isNaN(r.height) ? null : r.height,
              depth: r.depth === '' || r.depth === null || isNaN(r.depth) ? null : r.depth,
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

      try {
        await navigator.clipboard.writeText(JSON.stringify(payload));
        const suffix = payload.variants.length > 1 ? ` (옵션 ${payload.variants.length}개)` : '';
        showToast(`복사됐어요${suffix}! 로켓제안서 앱에서 "1688 붙여넣기" 버튼을 누르세요.`);
      } catch (err) {
        showToast('클립보드 복사에 실패했습니다: ' + err.message, true);
      }
      close();
    });
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
    btn.addEventListener('click', () => {
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
      });
    });
    root.appendChild(btn);
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    injectButton();
  } else {
    document.addEventListener('DOMContentLoaded', injectButton);
  }
})();
