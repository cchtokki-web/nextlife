import { describe, test, expect } from 'vitest';
import { applyYieldPreset, restoreCustomYieldPreset } from '@/core/usecases/scenario/applyYieldPreset';
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

  // B1: ISA도 annualReturn을 가진 투자 계좌다. 리스크 성향 프리셋에서만 빼두면
  // "보수적"을 골라도 ISA만 홀로 높은 수익률을 유지해 계좌 간 서열이 뒤집힌다.
  test('ISA 계좌 annualReturn도 주식과 같은 값으로 설정한다', () => {
    const withIsa: SimulationParams = {
      ...baseParams,
      isaAccounts: [{
        id: 'i1', type: 'general', balance: 1000, monthlyContribution: 0,
        annualReturn: 12, dividendYield: 1.5, currency: 'KRW', maturityYears: 3,
      }],
    };

    expect(applyYieldPreset(withIsa, 'conservative').isaAccounts![0].annualReturn).toBe(5);
    expect(applyYieldPreset(withIsa, 'aggressive').isaAccounts![0].annualReturn).toBe(9);
  });

  test('yieldPreset이 custom이면 ISA 직접입력 값도 스냅샷에 보관하고 복원한다', () => {
    const customParams: SimulationParams = {
      ...baseParams,
      yieldPreset: 'custom',
      isaAccounts: [{
        id: 'i1', type: 'general', balance: 1000, monthlyContribution: 0,
        annualReturn: 12.5, dividendYield: 1.5, currency: 'KRW', maturityYears: 3,
      }],
    };

    const applied = applyYieldPreset(customParams, 'aggressive');
    expect(applied.customYieldSnapshot?.isaAccounts).toEqual({ i1: 12.5 });

    expect(restoreCustomYieldPreset(applied).isaAccounts![0].annualReturn).toBe(12.5);
  });

  // 과거에 저장된 스냅샷에는 isaAccounts 키가 없다. 복원이 그 위에서 터지면 안 된다.
  test('isaAccounts가 없는 옛 스냅샷으로도 복원할 수 있다', () => {
    const params: SimulationParams = {
      ...baseParams,
      yieldPreset: 'aggressive',
      isaAccounts: [{
        id: 'i1', type: 'general', balance: 1000, monthlyContribution: 0,
        annualReturn: 9, dividendYield: 1.5, currency: 'KRW', maturityYears: 3,
      }],
      customYieldSnapshot: { assets: { a1: 12.5 }, privatePensions: { p1: 2.5 } },
    };

    const result = restoreCustomYieldPreset(params);

    expect(result.isaAccounts![0].annualReturn).toBe(9);
    expect(result.assets[0].annualGrowthRate).toBe(12.5);
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

  test('yieldPreset이 custom일 때 다른 프리셋을 적용하면 직전 직접입력 값을 customYieldSnapshot에 저장한다', () => {
    const customParams: SimulationParams = {
      ...baseParams,
      yieldPreset: 'custom',
      assets: [{ ...baseParams.assets[0], id: 'a1', annualGrowthRate: 12.5 }],
      privatePensions: [{ ...baseParams.privatePensions[0], id: 'p1', annualReturn: 2.5 }],
    };
    const result = applyYieldPreset(customParams, 'aggressive');
    // ISA가 없는 시나리오도 assets/privatePensions와 같은 관례로 빈 맵을 남긴다.
    expect(result.customYieldSnapshot).toEqual({ assets: { a1: 12.5 }, privatePensions: { p1: 2.5 }, isaAccounts: {} });
    expect(result.assets[0].annualGrowthRate).toBe(9);
  });

  test('이미 프리셋 상태에서 다른 프리셋으로 바꾸면 기존 customYieldSnapshot을 유지한다', () => {
    const snapshot = { assets: { a1: 12.5 }, privatePensions: { p1: 2.5 } };
    const params: SimulationParams = { ...baseParams, yieldPreset: 'conservative', customYieldSnapshot: snapshot };
    const result = applyYieldPreset(params, 'aggressive');
    expect(result.customYieldSnapshot).toEqual(snapshot);
  });
});

describe('restoreCustomYieldPreset', () => {
  test('customYieldSnapshot이 있으면 id 기준으로 자산/연금 값을 복원하고 yieldPreset을 custom으로 되돌린다', () => {
    const params: SimulationParams = {
      ...baseParams,
      yieldPreset: 'aggressive',
      assets: [{ ...baseParams.assets[0], id: 'a1', annualGrowthRate: 9 }],
      privatePensions: [{ ...baseParams.privatePensions[0], id: 'p1', annualReturn: 6 }],
      customYieldSnapshot: { assets: { a1: 12.5 }, privatePensions: { p1: 2.5 } },
    };
    const result = restoreCustomYieldPreset(params);
    expect(result.assets[0].annualGrowthRate).toBe(12.5);
    expect(result.privatePensions[0].annualReturn).toBe(2.5);
    expect(result.yieldPreset).toBe('custom');
  });

  test('스냅샷에 없는 자산 id는 현재 값을 그대로 유지한다', () => {
    const params: SimulationParams = {
      ...baseParams,
      yieldPreset: 'aggressive',
      assets: [{ ...baseParams.assets[0], id: 'a2', annualGrowthRate: 9 }],
      customYieldSnapshot: { assets: { a1: 12.5 }, privatePensions: {} },
    };
    const result = restoreCustomYieldPreset(params);
    expect(result.assets[0].annualGrowthRate).toBe(9);
  });

  test('customYieldSnapshot이 없으면 값은 그대로 두고 yieldPreset만 custom으로 바꾼다', () => {
    const params: SimulationParams = { ...baseParams, yieldPreset: 'base' };
    const result = restoreCustomYieldPreset(params);
    expect(result.assets[0].annualGrowthRate).toBe(baseParams.assets[0].annualGrowthRate);
    expect(result.yieldPreset).toBe('custom');
  });
});
