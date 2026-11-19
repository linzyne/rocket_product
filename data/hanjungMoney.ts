// 한중발주 한 건의 돈 계산. 한중발주 화면과 장부가 같이 쓴다(두 화면 숫자가 늘 같게).
//  매출(revenueOf) = 쿠팡에 입고(정산)된 금액만, 부가세 포함(통장에 들어오는 돈 기준). 입고 전은 입고대기로 따로
//  매입(buyOf)     = 이 건에 쓴 돈 전부(제품비 + 부대비용, 여유분 포함)
//  차액 = 매출 − 매입
import { HanjungOrder, HanjungLine, productSummary, productUnitCost, orderTotals, lineAlloc, sameName, FEE_KEYS, remainingFee, receiptFee, isHoldingOrder } from './hanjungStore';
import { ReceiveRow, settlementOf } from './receiveStore';
import type { ReturnMark } from './returnStore';
import { PriceBook, priceOf } from './coupangPriceStore';

// 쿠팡 발주금액(발주단가 × 이 건에 배정한 수량). 발주단가를 모르면 undefined.
export const lineAmountOf = (prices: PriceBook, l: HanjungLine) => {
  const p = priceOf(prices, l.발주번호, l.상품이름);
  return p ? p * lineAlloc(l) : undefined;
};

// 매출: 쿠팡에 실제로 입고(물류창고입고로 정산)된 금액만. 부가세 포함. 줄마다 이 건 몫의 정산금액.
//  · 아직 입고 전인 수량은 매출이 아니다 → pending(수량)·pendingAmt(쿠팡 발주금액 개당 값)으로 따로 센다
//  · 쿠팡발송에서 분실·미입고로 처리한 수량은 돈이 안 들어온다 → lost·lostAmt (입고대기에서도 빠진다)
//  · sold = 배정 − 회송. 그중 unsent(아직 안 보낸 것)는 사무실 재고, 나머지는 나간 것(입고·입고대기·분실·미입고)
//  · missing = 입고 전인데 발주단가를 몰라 입고대기 금액에 못 넣은 수량
//  byProduct: 상품마다 입고된 수량·금액(매출), est = 입고 + 입고대기(발주단가)로 본 수량·금액(개당 값 추정용)
//  sentNos(발송완료한 발주번호)를 주면: 배정만 하고 아직 안 보낸 수량(unsent)은 사무실에 있는 재고로 따로 센다.
//   쿠팡 입고나 분실·미입고 기록이 있는 줄은 출고 기록이 없어도 보낸 것으로 본다(출고 기록 전 예전 건).
export const revenueOf = (o: HanjungOrder, settle: ReturnType<typeof settlementOf>, prices: PriceBook, sentNos?: Set<string>) => {
  let total = 0;
  let qty = 0;
  let missing = 0;
  let sold = 0;
  let pending = 0;
  let pendingAmt = 0;
  let lost = 0;
  let lostAmt = 0;
  let unsent = 0;
  let unsentAmt = 0;
  const byProduct: { 상품이름: string; qty: number; total: number; estQty: number; estTotal: number; shipped: number }[] = [];
  for (const l of o.lines) {
    const alloc = lineAlloc(l);
    if (alloc <= 0) continue;
    // 쿠팡에서 회송된 수량은 사무실 재고로 돌아온 것이라 나간 것에서 뺀다.
    const eff = Math.max(0, alloc - (l.회송 || 0));
    sold += eff;
    const got = settle.byLine.get(l.key);
    const take = Math.min(eff, got?.qty || 0);
    const gotTotal = got?.total || 0;
    const gone = Math.min(eff - take, settle.lost?.get(l.key) || 0);
    const wait = eff - take - gone;
    const unitPrice = (lineAmountOf(prices, l) || 0) / alloc;
    total += gotTotal;
    qty += take;
    pending += wait;
    pendingAmt += unitPrice * wait;
    lost += gone;
    lostAmt += unitPrice * gone;
    if (!unitPrice && wait > 0) missing += wait;
    const notSent = sentNos && wait > 0 && take <= 0 && gone <= 0 && !sentNos.has(String(l.발주번호 || '').trim()) ? wait : 0;
    unsent += notSent;
    unsentAmt += unitPrice * notSent;
    let e = byProduct.find(x => sameName(x.상품이름, l.상품이름));
    if (!e) byProduct.push(e = { 상품이름: l.상품이름, qty: 0, total: 0, estQty: 0, estTotal: 0, shipped: 0 });
    e.shipped += eff - notSent;
    e.qty += take;
    e.total += gotTotal;
    if (take > 0 && gotTotal > 0) { e.estQty += take; e.estTotal += gotTotal; }
    if (unitPrice && wait > 0) { e.estQty += wait; e.estTotal += unitPrice * wait; }
  }
  return { total: Math.round(total), qty, missing, sold, byProduct, pending, pendingAmt: Math.round(pendingAmt), lost, lostAmt: Math.round(lostAmt), unsent, unsentAmt: Math.round(unsentAmt) };
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
  // 상품마다 개당 매입가(제품비 + 부대비용 n분의 1)
  const unitCost: { 상품이름: string; unit: number }[] = [];
  ps.forEach((p, i) => {
    const units = Math.max(p.ordered, p.received);
    if (!units) return;
    const withFee = full[i] + feePerUnit * units;
    unitCost.push({ 상품이름: p.상품이름, unit: withFee / units });
    total += withFee;
    const left = Math.max(0, units - p.allocated);
    spareQty += left;
    spareCost += withFee * (left / units);
  });
  return { total: Math.round(total), goods: Math.round(goods), fees: Math.round(fees), spareQty, spareCost: Math.round(spareCost), unitCost };
};

// 앞으로 팔릴 금액(추정): 아직 안 팔린 수량 × 그 상품을 지금까지 판 개당 값.
//  그 상품을 아직 하나도 안 팔았으면 이 건 전체 평균 판매가로. 판 게 하나도 없으면 0(모름).
export const spareValueOf = (o: HanjungOrder, rev: ReturnType<typeof revenueOf>) => {
  const estQ = rev.byProduct.reduce((n, x) => n + x.estQty, 0);
  const avg = estQ > 0 ? rev.byProduct.reduce((n, x) => n + x.estTotal, 0) / estQ : 0;
  let value = 0;
  for (const p of productSummary(o)) {
    const left = Math.max(0, Math.max(p.ordered, p.received) - p.allocated);
    if (!left) continue;
    const s = rev.byProduct.find(x => sameName(x.상품이름, p.상품이름));
    const unit = s && s.estQty > 0 && s.estTotal > 0 ? s.estTotal / s.estQty : avg;
    value += unit * left;
  }
  return Math.round(value);
};

// 한 건의 매입·매출·차액 한 번에. 매입이나 매출이 0이면 차액은 모름(null).
export const orderMoney = (o: HanjungOrder, receives: ReceiveRow[], prices: PriceBook, orders: HanjungOrder[] = [], marks: ReturnMark[] = []) => {
  const settle = settlementOf(o, receives, orders, marks);
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

// 입고분 마진: 쿠팡에 입고된 수량만큼의 정산금 − 그 수량 × 개당 매입가(부대비용 포함). 상품마다 계산해서 더한다.
export const realizedMarginOf = (rev: ReturnType<typeof revenueOf>, buy: ReturnType<typeof buyOf>) => {
  let sale = 0;
  let cost = 0;
  for (const x of rev.byProduct) {
    if (!x.qty) continue;
    const u = buy.unitCost.find(c => sameName(c.상품이름, x.상품이름))?.unit || 0;
    sale += x.total;
    cost += u * x.qty;
  }
  return { sale: Math.round(sale), cost: Math.round(cost), margin: Math.round(sale - cost) };
};
