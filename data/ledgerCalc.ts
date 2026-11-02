// 장부·세금 페이지가 같이 쓰는 계산.
//  · 입고 줄 원가: 한중발주와 짝이 맞으면 그 건의 개당 원가, 아니면 직접 적은 개당 원가(ledgerUnitCosts)
//  · 달 순익(입고일 기준): 정산 공급가 + 기타입금 − 입고 수량 원가 − 직접 적은 비용
//  · 부가세(반기): 매출세액(입고일 기준 정산 부가세) − 매입세액(수입 부가세 + 세금계산서·카드 받은 비용의 1/11)
import type { LedgerEntry, UnitCost } from './ledgerStore';
import { HanjungOrder, unitLandedCost, isHoldingOrder } from './hanjungStore';
import { ReceiveRow, sign, matchLine } from './receiveStore';

export const ucId = (sku: string) => sku.replace(/\//g, '_');

export const costOf = (orders: HanjungOrder[], unitCosts: Record<string, UnitCost>, r: ReceiveRow) => {
  for (const o of orders) {
    const line = matchLine(o, r);
    if (!line) continue;
    const unit = unitLandedCost(o, line.상품이름);
    if (unit > 0) return { code: o.code, unit, manual: false };
    const m = unitCosts[ucId(r.sku)];
    return { code: o.code, unit: m?.unit || 0, manual: !!m };
  }
  const m = unitCosts[ucId(r.sku)];
  return { code: null as string | null, unit: m?.unit || 0, manual: !!m };
};

// 기간(YYYY-MM 또는 YYYY) 안의 순익. prefix로 거른다.
export const profitOf = (
  prefix: string,
  receives: ReceiveRow[],
  orders: HanjungOrder[],
  unitCosts: Record<string, UnitCost>,
  entries: LedgerEntry[],
) => {
  const rows = receives.filter(r => String(r.date || '').startsWith(prefix));
  let salesSupply = 0;
  let cogs = 0;
  let unknownRows = 0;
  for (const r of rows) {
    const k = sign(r);
    const c = costOf(orders, unitCosts, r);
    salesSupply += k * r.totalSupply;
    cogs += k * r.qty * c.unit;
    if (!c.unit) unknownRows += 1;
  }
  const mine = entries.filter(e => e.date.startsWith(prefix));
  const otherIn = mine.filter(e => e.kind === 'in').reduce((s, e) => s + e.amount, 0);
  const expense = mine.filter(e => e.kind === 'out').reduce((s, e) => s + e.amount, 0);
  return { rows: rows.length, salesSupply, cogs, otherIn, expense, unknownRows, profit: salesSupply + otherIn - cogs - expense };
};

// ---- 부가세 ----
// 일반과세자 개인: 1기 1~6월(7/25까지 신고), 2기 7~12월(다음 해 1/25까지 신고).
export type VatHalf = 1 | 2;
export const halfMonths = (year: number, half: VatHalf) =>
  Array.from({ length: 6 }, (_, i) => `${year}-${String((half === 1 ? 1 : 7) + i).padStart(2, '0')}`);
export const halfOf = (ym: string): { year: number; half: VatHalf } => {
  const [y, m] = ym.split('-').map(Number);
  return { year: y, half: m <= 6 ? 1 : 2 };
};
export const vatDeadline = (year: number, half: VatHalf) => (half === 1 ? `${year}-07-25` : `${year + 1}-01-25`);
export const vatOfAmount = (amount: number) => Math.round(amount / 11);
export const importVatKey = (code: string, receiptId: string) => `${code}|${receiptId}`;

export const vatOf = (
  year: number,
  half: VatHalf,
  receives: ReceiveRow[],
  orders: HanjungOrder[],
  entries: LedgerEntry[],
  importVat: Record<string, number>,
) => {
  const months = halfMonths(year, half);
  const inHalf = (d: string) => months.includes(String(d || '').slice(0, 7));
  const salesTax = receives.filter(r => inHalf(r.date)).reduce((s, r) => s + sign(r) * r.totalTax, 0);
  const receipts = orders
    .filter(o => !isHoldingOrder(o))
    .flatMap(o => o.receipts.filter(r => inHalf(r.date)).map(r => ({ code: o.code, r, vat: importVat[importVatKey(o.code, r.id)] || 0 })));
  const importTax = receipts.reduce((s, x) => s + x.vat, 0);
  const expenses = entries.filter(e => e.kind === 'out' && inHalf(e.date));
  const expenseTax = expenses.filter(e => e.vatOk).reduce((s, e) => s + vatOfAmount(e.amount), 0);
  return { months, salesTax, receipts, importTax, expenses, expenseTax, buyTax: importTax + expenseTax, due: salesTax - importTax - expenseTax };
};

// ---- 종합소득세(대략) ----
// 과세표준 구간(2023년 귀속부터). 지방소득세는 소득세의 10%.
const BRACKETS: [number, number, number][] = [
  [14_000_000, 0.06, 0],
  [50_000_000, 0.15, 1_260_000],
  [88_000_000, 0.24, 5_760_000],
  [150_000_000, 0.35, 15_440_000],
  [300_000_000, 0.38, 19_940_000],
  [500_000_000, 0.4, 25_940_000],
  [1_000_000_000, 0.42, 35_940_000],
  [Infinity, 0.45, 65_940_000],
];
export const BASIC_DEDUCTION = 1_500_000; // 본인 기본공제
export const incomeTaxOf = (taxBase: number) => {
  if (taxBase <= 0) return { rate: 0, tax: 0, local: 0 };
  const [, rate, minus] = BRACKETS.find(([limit]) => taxBase <= limit)!;
  const tax = Math.max(0, Math.round(taxBase * rate - minus));
  return { rate, tax, local: Math.round(tax / 10) };
};
