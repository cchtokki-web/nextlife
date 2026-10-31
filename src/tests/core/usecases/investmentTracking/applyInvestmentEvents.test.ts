import { describe, expect, it } from 'vitest';
import { applyInvestmentEvents, type InvestmentEventInput } from '@/core/usecases/investmentTracking/applyInvestmentEvents';

const baseline: InvestmentEventInput = {
  baselineDate: '2026-01-01', baselineQuantity: 10,
  valuationDate: '2026-03-31', valuationPrice: 120, events: [],
};

describe('투자 사건 원장', () => {
  it('명시된 적립·분할·재투자·현금 배당을 순서대로 분리한다', () => {
    const result = applyInvestmentEvents({ ...baseline, events: [
      { id: '1', date: '2026-01-10', type: 'purchase', amount: 100, price: 100 },
      { id: '2', date: '2026-02-01', type: 'split', ratio: 2 },
      { id: '3', date: '2026-02-10', type: 'reinvestment', amount: 60, price: 60 },
      { id: '4', date: '2026-03-01', type: 'cashDividend', amount: 12 },
    ] });
    expect(result).toEqual({ quantity: 23, marketValue: 2760, contributions: 100, reinvestedDividends: 60, cashDividends: 12 });
  });

  it('입력을 변경하지 않고 기준점부터 반복 계산해도 결과가 같다', () => {
    const input: InvestmentEventInput = { ...baseline, events: [
      { id: '1', date: '2026-02-10', type: 'purchase', amount: 10, price: 4 },
    ] };
    const copy = structuredClone(input);
    expect(applyInvestmentEvents(input)).toEqual(applyInvestmentEvents(input));
    expect(input).toEqual(copy);
    expect(applyInvestmentEvents(input).quantity).toBe(12.5);
  });

  it('중복, 역순, 기준일 및 평가일 밖의 사건을 거부한다', () => {
    const event = { id: 'a', date: '2026-02-01', type: 'cashDividend' as const, amount: 1 };
    for (const events of [
      [event, event],
      [event, { ...event, id: 'b', date: '2026-01-02' }],
      [{ ...event, date: baseline.baselineDate }],
      [{ ...event, date: '2026-04-01' }],
      [{ ...event, date: '2026-02-30' }],
    ]) expect(() => applyInvestmentEvents({ ...baseline, events })).toThrow();
  });

  it('누락되거나 유효하지 않은 가격과 금액을 대신 추정하지 않는다', () => {
    for (const price of [0, -1, NaN, Infinity]) {
      expect(() => applyInvestmentEvents({ ...baseline, valuationPrice: price })).toThrow();
      expect(() => applyInvestmentEvents({ ...baseline, events: [
        { id: '1', date: '2026-02-01', type: 'purchase', amount: 10, price },
      ] })).toThrow();
    }
    expect(() => applyInvestmentEvents({ ...baseline, events: [
      { id: '1', date: '2026-02-01', type: 'split', ratio: 0 },
    ] })).toThrow();
  });
});
