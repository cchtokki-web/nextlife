import { describe, test, expect } from 'vitest';
import { applyYieldPreset } from '@/core/usecases/scenario/applyYieldPreset';
import { SimulationParams } from '@/core/entities/types';

const baseParams: SimulationParams = {
  userProfile: { currentAge: 55, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3000000 },
  assets: [
    {
      id: 'a1',
      type: 'stock',
      ticker: 'AAA',
      name: '자산1',
      quantity: 10,
      averagePrice: 1000,
      annualGrowthRate: 1,
      dividendYield: 2,
      monthlyContribution: 0,
      reinvestDividend: false,
      currency: 'KRW',
    },
  ],
  nationalPension: { expectedMonthlyAmount: 0 },
  privatePensions: [
    { id: 'p1', type: 'irp', balance: 10000000, monthlyContribution: 0, annualReturn: 1, currency: 'KRW' },
  ],
  otherIncomes: [],
  inflationRate: 0,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

describe('applyYieldPreset', () => {
  test('conservative 프리셋은 자산 annualGrowthRate를 5, 연금 annualReturn을 3으로 설정한다', () => {
    const result = applyYieldPreset(baseParams, 'conservative');
    expect(result.assets[0].annualGrowthRate).toBe(5);
    expect(result.privatePensions[0].annualReturn).toBe(3);
    expect(result.yieldPreset).toBe('conservative');
  });

  test('base 프리셋은 자산 annualGrowthRate를 7, 연금 annualReturn을 4로 설정한다', () => {
    const result = applyYieldPreset(baseParams, 'base');
    expect(result.assets[0].annualGrowthRate).toBe(7);
    expect(result.privatePensions[0].annualReturn).toBe(4);
    expect(result.yieldPreset).toBe('base');
  });

  test('aggressive 프리셋은 자산 annualGrowthRate를 9, 연금 annualReturn을 6으로 설정한다', () => {
    const result = applyYieldPreset(baseParams, 'aggressive');
    expect(result.assets[0].annualGrowthRate).toBe(9);
    expect(result.privatePensions[0].annualReturn).toBe(6);
    expect(result.yieldPreset).toBe('aggressive');
  });

  test('자산/연금이 여러 개면 모두 동일한 값으로 매핑한다', () => {
    const params: SimulationParams = {
      ...baseParams,
      assets: [
        { ...baseParams.assets[0], id: 'a1' },
        { ...baseParams.assets[0], id: 'a2' },
      ],
      privatePensions: [
        { ...baseParams.privatePensions[0], id: 'p1' },
        { ...baseParams.privatePensions[0], id: 'p2' },
      ],
    };
    const result = applyYieldPreset(params, 'aggressive');
    expect(result.assets.map((a) => a.annualGrowthRate)).toEqual([9, 9]);
    expect(result.privatePensions.map((p) => p.annualReturn)).toEqual([6, 6]);
  });

  test('assets/privatePensions가 undefined여도 크래시 없이 빈 배열로 처리한다', () => {
    const params = { ...baseParams, assets: undefined, privatePensions: undefined } as unknown as SimulationParams;
    const result = applyYieldPreset(params, 'base');
    expect(result.assets).toEqual([]);
    expect(result.privatePensions).toEqual([]);
  });

  test('userProfile 등 자산/연금/yieldPreset 이외의 필드는 변경하지 않는다', () => {
    const result = applyYieldPreset(baseParams, 'conservative');
    expect(result.userProfile).toEqual(baseParams.userProfile);
    expect(result.displayCurrency).toBe(baseParams.displayCurrency);
    expect(result.inflationRate).toBe(baseParams.inflationRate);
  });
});
