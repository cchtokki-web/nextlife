/**
 * 거래소·증권사에서 확인했거나 명시적으로 추정한 사건만 받는 단일 자산 원장.
 * 적립일, 가격, 세금, 통화와 배당 재투자 시점을 이 함수가 추측하지 않는다.
 * 현재 production 시뮬레이션에는 연결되어 있지 않다.
 */
export type InvestmentEvent =
  | { id: string; date: string; type: 'purchase'; amount: number; price: number }
  | { id: string; date: string; type: 'reinvestment'; amount: number; price: number }
  | { id: string; date: string; type: 'cashDividend'; amount: number }
  | { id: string; date: string; type: 'split'; ratio: number };

export interface InvestmentEventInput {
  baselineDate: string;
  baselineQuantity: number;
  valuationDate: string;
  valuationPrice: number;
  events: readonly InvestmentEvent[];
}

export interface InvestmentEventResult {
  quantity: number;
  marketValue: number;
  contributions: number;
  reinvestedDividends: number;
  cashDividends: number;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/** 날짜는 거래소 현지 달력 날짜이며, 사건은 기준일 다음 날부터 평가일까지 순서대로 전달한다. */
export function applyInvestmentEvents(input: InvestmentEventInput): InvestmentEventResult {
  if (!validDate(input.baselineDate) || !validDate(input.valuationDate)
    || input.valuationDate < input.baselineDate
    || !Number.isFinite(input.baselineQuantity) || input.baselineQuantity < 0
    || !finitePositive(input.valuationPrice)) {
    throw new Error('투자 기준 또는 평가 정보가 올바르지 않습니다.');
  }

  let quantity = input.baselineQuantity;
  let contributions = 0;
  let reinvestedDividends = 0;
  let cashDividends = 0;
  let previousDate = input.baselineDate;
  const ids = new Set<string>();

  for (const event of input.events) {
    if (!event.id.trim() || ids.has(event.id) || !validDate(event.date)
      || event.date <= input.baselineDate || event.date > input.valuationDate
      || event.date < previousDate) {
      throw new Error('투자 사건의 식별자 또는 날짜가 올바르지 않습니다.');
    }
    ids.add(event.id);
    previousDate = event.date;
    if (event.type === 'split') {
      if (!finitePositive(event.ratio)) throw new Error('분할 비율이 올바르지 않습니다.');
      quantity *= event.ratio;
    } else if (event.type === 'cashDividend') {
      if (!finitePositive(event.amount)) throw new Error('현금 배당액이 올바르지 않습니다.');
      cashDividends += event.amount;
    } else {
      if ((event.type !== 'purchase' && event.type !== 'reinvestment')
        || !finitePositive(event.amount) || !finitePositive(event.price)) {
        throw new Error('매수 금액 또는 가격이 올바르지 않습니다.');
      }
      quantity += event.amount / event.price;
      if (event.type === 'purchase') contributions += event.amount;
      else reinvestedDividends += event.amount;
    }
    if (![quantity, contributions, reinvestedDividends, cashDividends].every(Number.isFinite)) {
      throw new Error('투자 사건 계산 결과가 유효하지 않습니다.');
    }
  }
  const marketValue = quantity * input.valuationPrice;
  if (!Number.isFinite(marketValue)) throw new Error('평가금 계산 결과가 유효하지 않습니다.');
  return { quantity, marketValue, contributions, reinvestedDividends, cashDividends };
}
