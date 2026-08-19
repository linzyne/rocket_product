(function () {
  'use strict';

  // 로켓제안서 앱의 MarginCalculatorModal과 동일한 계산식을 사용한다(공급가/판매가가 앱과
  // 다르게 나오면 혼란스러우므로 상수/공식을 그대로 맞춘다).
  const CNY_BASE_RATE_DEFAULT = 210;
  const CNY_RATE_STORAGE_KEY = 'cnyExchangeRate';
  const FEE_RATE = 0.1;
  const VAT_RATE = 0.1;
  const COMPREHENSIVE_INCOME_TAX_RATE = 0.06;
  const LOCAL_INCOME_TAX_RATE = 0.1;

  const roundupToNearest100 = (num) => {
    if (isNaN(num) || !isFinite(num)) return 0;
    return Math.ceil(num / 100) * 100;
  };

  const fmt = (n) => `₩ ${Math.round(n || 0).toLocaleString('ko-KR')}`;

  const el = (id) => document.getElementById(id);
  const exchangeRateInput = el('exchangeRate');
  const cnyInput = el('cny');
  const supplyMarginInput = el('supplyMargin');
  const sellingMarginInput = el('sellingMargin');
  const copyBtn = el('copyBtn');
  const toast = el('toast');
  const taxToggle = el('taxToggle');
  const taxDetails = el('taxDetails');
  const taxToggleArrow = el('taxToggleArrow');

  let lastResult = null;

  function recalc() {
    const exchangeRate = parseFloat(exchangeRateInput.value) || 0;
    const cny = parseFloat(cnyInput.value);

    let krw = 0;
    if (!isNaN(cny) && cny > 0 && exchangeRate > 0) {
      const costInKrw = cny * exchangeRate;
      const costWithFee = costInKrw * (1 + FEE_RATE);
      krw = Math.round(costWithFee * (1 + VAT_RATE));
    }
    el('krwOut').textContent = fmt(krw);

    const supplyMarginValue = parseFloat(supplyMarginInput.value);
    const supplyPrice = !isNaN(supplyMarginValue) && supplyMarginValue < 100 && krw > 0
      ? roundupToNearest100(krw / (1 - supplyMarginValue / 100))
      : 0;
    el('supplyPriceOut').textContent = fmt(supplyPrice);

    const sellingMarginValue = parseFloat(sellingMarginInput.value);
    const sellingPrice = !isNaN(sellingMarginValue) && sellingMarginValue < 100 && supplyPrice > 0
      ? roundupToNearest100(supplyPrice / (1 - sellingMarginValue / 100))
      : 0;
    el('sellingPriceOut').textContent = fmt(sellingPrice);
    const sellingMarginAmount = sellingPrice > 0 && supplyPrice > 0 ? sellingPrice - supplyPrice : 0;
    el('sellingMarginAmountOut').textContent = fmt(sellingMarginAmount);

    const inputVat = krw > 0 ? Math.round(krw - (krw / (1 + VAT_RATE))) : 0;
    const outputVat = supplyPrice > 0 ? Math.round(supplyPrice - (supplyPrice / (1 + VAT_RATE))) : 0;
    const vatPayable = outputVat > inputVat ? outputVat - inputVat : 0;
    const grossMargin = supplyPrice > 0 ? supplyPrice - krw : 0;
    const marginAfterVat = grossMargin - vatPayable;

    const effectiveIncomeTaxRate = COMPREHENSIVE_INCOME_TAX_RATE * (1 + LOCAL_INCOME_TAX_RATE);
    const comprehensiveIncomeTax = marginAfterVat > 0 ? Math.round(marginAfterVat * effectiveIncomeTaxRate) : 0;
    const netProfit = marginAfterVat - comprehensiveIncomeTax;

    el('outputVatOut').textContent = fmt(outputVat);
    el('inputVatOut').textContent = fmt(inputVat);
    el('vatPayableOut').textContent = fmt(vatPayable);
    el('marginAfterVatOut').textContent = fmt(marginAfterVat);
    el('incomeTaxOut').textContent = fmt(comprehensiveIncomeTax);

    el('grossMarginOut').textContent = fmt(grossMargin);
    el('vatPayableOut2').textContent = `- ${fmt(vatPayable)}`;
    el('incomeTaxOut2').textContent = `- ${fmt(comprehensiveIncomeTax)}`;
    el('netProfitOut').textContent = fmt(netProfit);

    lastResult = { costPrice: krw, supplyPrice, sellingPrice, margin: netProfit };
    copyBtn.disabled = !(krw > 0 && supplyPrice > 0);

    if (exchangeRate > 0) {
      chrome.storage.local.set({ [CNY_RATE_STORAGE_KEY]: exchangeRate });
    }
  }

  function showToast(message, isError) {
    toast.textContent = message;
    toast.className = `toast show ${isError ? 'err' : 'ok'}`;
    setTimeout(() => { toast.className = 'toast'; }, 3000);
  }

  chrome.storage.local.get(CNY_RATE_STORAGE_KEY, (result) => {
    const saved = parseFloat(result[CNY_RATE_STORAGE_KEY]);
    exchangeRateInput.value = !isNaN(saved) && saved > 0 ? saved : CNY_BASE_RATE_DEFAULT;
    recalc();
  });

  [exchangeRateInput, cnyInput, supplyMarginInput, sellingMarginInput].forEach((input) => {
    input.addEventListener('input', recalc);
  });

  taxToggle.addEventListener('click', () => {
    const open = taxDetails.classList.toggle('open');
    taxToggleArrow.textContent = open ? '▴' : '▾';
  });

  copyBtn.addEventListener('click', async () => {
    if (!lastResult) return;
    const payload = {
      source: 'margin-calc',
      costPrice: String(lastResult.costPrice),
      supplyPrice: String(lastResult.supplyPrice),
      sellingPrice: String(lastResult.sellingPrice),
      margin: String(lastResult.margin),
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload));
      showToast('복사됐어요! 로켓제안서 앱에서 "마진 붙여넣기" 버튼을 누르세요.', false);
    } catch (err) {
      showToast('클립보드 복사에 실패했습니다: ' + err.message, true);
    }
  });
})();
