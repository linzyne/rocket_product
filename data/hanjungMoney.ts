// 한중발주 한 건의 돈 계산. 한중발주 화면과 장부가 같이 쓴다(두 화면 숫자가 늘 같게).
//  매출(revenueOf) = 쿠팡에 판 금액, 부가세 포함(통장에 들어오는 돈 기준)
//  매입(buyOf)     = 이 건에 쓴 돈 전부(제품비 + 부대비용, 여유분 포함)
//  차액 = 매출 − 매입
import { HanjungOrder, HanjungLine, productSummary, productUnitCost, orderTotals, lineAlloc, sameName, FEE_KEYS, remainingFee, receiptFee, isHoldingOrder } from './hanjungStore';
import { ReceiveRow, settlementOf } from './receiveStore';
import { PriceBook, priceOf } from './coupangPriceStore';

// 쿠팡 발주금액(발주단가 × 이 건에 배정한 수량). 발주단가를 모르면 undefined.
export const lineAmountOf = (prices: PriceBook, l: HanjungLine) => {
  const p = priceOf(prices, l.발주번호, l.상품이름);
  return p ? p * lineAlloc(l) : undefined;
};

// 매출: 이 한중발주가 맡은(배정, 회송 뺌) 수량을 쿠팡에 판 금액. 부가세 포함. 줄마다:
//  · 물류창고입고로 정산된 수량은 정산금액(이 건 몫만)
//  · 아직 정산 전인 수량은 쿠팡 발주금액 개당 값으로
//  · 둘 다 없으면 0원(빠진 수량으로 따로 센다)
export const revenueOf = (o: HanjungOrder, settle: ReturnType<typeof settlementOf>, prices: PriceBook) => {
  let total = 0;
  let missing = 0;
  let sold = 0;
  // 상품마다 매출 수량·금액(상품별 표에 씀)
  const byProduct: { 상품이름: string; qty: number; total: number }[] = [];
  for (const l of o.lines) {
    const alloc = lineAlloc(l);
    if (alloc <= 0) continue;
    // 쿠팡에서 회송된 수량은 사무실 재고로 돌아온 것이라 판매에서 뺀다.
    const eff = Math.max(0, alloc - (l.회송 || 0));
    sold += eff;
    const got = settle.byLine.get(l.key);
    const take = Math.min(eff, got?.qty || 0);
    const unitPrice = (lineAmountOf(prices, l) || 0) / alloc;
    const lineTotal = (got?.total || 0) + unitPrice * (eff - take);
    total += lineTotal;
    if (!unitPrice && eff > take) missing += eff - take;
    let e = byProduct.find(x => sameName(x.상품이름, l.상품이름));
    if (!e) byProduct.push(e = { 상품이름: l.상품이름, qty: 0, total: 0 });
    e.qty += eff;
    e.total += lineTotal;
  }
  return { total: Math.round(total), missing, sold, byProduct };
};

// 매입: 이 건에 쓴 돈 전부(여유분 포함). 차액 = 매출 − 매입이라, 안 팔린 여유는 손해로 남고 나중에 배정되면 매출이 늘어 메워진다.
//  상품마다 매입가 = 도착한 만큼은 도착 기록 매입가, 아직 안 온 만큼은 주문 때 적은 단가. 부대비용은 수량으로 n분의 1(개당 같은 금액).
//  goods·fees = 제품비·부대비용 합. spareQty·spareCost = 아직 배정 안 된 여유 수량과 그 매입가(+부대비용 몫).
export const buyOf = (o: HanjungOrder) => {
  const ps = productSummary(o);
  const full = ps.map(p => p.cost + Math.max(0, p.ordered - p.received) * productUnitCost(o, p.상품이름));
  const goods = full.reduce((n, v) => n + v, 0);
  const fees = Math.max(0, orderTotals(o).totalCost - ps.reduce((n, p) => n + p.cost, 0)) + FEE_KEYS.reduce((n, k) => n + remainingFee(o, k), 0);
  const allUnits = ps.reduce((n, p) => n + Math.max(p.ordered, p.received), 0);
  const feePerUnit = allUnits > 0 ? fees / allUnits : 0;
  let total = 0;
  let spareQty = 0;
  let spareCost = 0;
  ps.forEach((p, i) => {
    const units = Math.max(p.ordered, p.received);
    if (!units) return;
    const withFee = full[i] + feePerUnit * units;
    total += withFee;
    const left = Math.max(0, units - p.allocated);
    spareQty += left;
    spareCost += withFee * (left / units);
  });
  return { total: Math.round(total), goods: Math.round(goods), fees: Math.round(fees), spareQty, spareCost: Math.round(spareCost) };
};

// 앞으로 팔릴 금액(추정): 아직 안 팔린 수량 × 그 상품을 지금까지 판 개당 값.
//  그 상품을 아직 하나도 안 팔았으면 이 건 전체 평균 판매가로. 판 게 하나도 없으면 0(모름).
export const spareValueOf = (o: HanjungOrder, rev: ReturnType<typeof revenueOf>) => {
  const known = rev.sold - rev.missing;
  const avg = known > 0 ? rev.total / known : 0;
  let value = 0;
  for (const p of productSummary(o)) {
    const left = Math.max(0, Math.max(p.ordered, p.received) - p.allocated);
    if (!left) continue;
    const s = rev.byProduct.find(x => sameName(x.상품이름, p.상품이름));
    const unit = s && s.qty > 0 && s.total > 0 ? s.total / s.qty : avg;
    value += unit * left;
  }
  return Math.round(value);
};

// 한 건의 매입·매출·차액 한 번에. 매입이나 매출이 0이면 차액은 모름(null).
export const orderMoney = (o: HanjungOrder, receives: ReceiveRow[], prices: PriceBook) => {
  const settle = settlementOf(o, receives);
  const rev = revenueOf(o, settle, prices);
  const buy = buyOf(o);
  return { settle, rev, buy, profit: rev.total && buy.total ? rev.total - buy.total : null };
};

// 통장에서 이 건 돈이 나간 날: 제품비는 1688에 주문한 날(만든 날), 부대비용은 도착 기록 날짜(아직 안 쓴 부대비용은 주문한 날).
//  보유재고(원래 있던 재고를 넣은 건)는 이 앱에서 산 게 아니라 없다. 합은 buyOf(o).total과 같다.
export const buyCashOf = (o: HanjungOrder): { date: string; label: string; amount: number }[] => {
  if (isHoldingOrder(o)) return [];
  const d = new Date(o.createdAt);
  const made = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const b = buyOf(o);
  const receiptFees = o.receipts.map(r => ({ date: r.date, amount: FEE_KEYS.reduce((n, k) => n + receiptFee(r, k), 0) }));
  const receiptFeeSum = receiptFees.reduce((n, x) => n + x.amount, 0);
  const out = [{ date: made, label: `${o.code} 제품비`, amount: b.total - b.fees }];
  for (const x of receiptFees) if (x.amount) out.push({ date: x.date, label: `${o.code} 부대비용`, amount: x.amount });
  // 도착 기록 밖의 부대비용(주문 때 적어 둔 남은 몫 등)은 주문한 날로
  const rest = b.fees - receiptFeeSum;
  if (Math.round(rest)) out.push({ date: made, label: `${o.code} 부대비용`, amount: rest });
  return out.filter(x => Math.round(x.amount));
};
