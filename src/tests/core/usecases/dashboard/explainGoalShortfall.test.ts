import { describe, test, expect } from 'vitest';
import { explainGoalShortfall } from '@/core/usecases/dashboard/explainGoalShortfall';
import type { GoalFailureBreakdown } from '@/core/entities/montecarlo';
import type { SimulationParams } from '@/core/entities/types';

const formatValue = (value: number) => `${Math.round(value / 10_000).toLocaleString()}만원`;

function params(overrides: Partial<SimulationParams> = {}): SimulationParams {
  return {
    userProfile: { currentAge: 55, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3_500_000 },
    assets: [],
    nationalPension: { expectedMonthlyAmount: 1_000_000 },
    privatePensions: [],
    otherIncomes: [],
    inflationRate: 2,
    inflationMode: 'real',
    baseExchangeRate: 1350,
    exchangeScenario: 'base',
    displayCurrency: 'KRW',
    ...overrides,
  };
}

function breakdown(overrides: Partial<GoalFailureBreakdown> = {}): GoalFailureBreakdown {
  return {
    spendingShortfall: 0,
    assetDepletion: 0,
    terminalShortfall: 0,
    medianFirstShortfallAge: null,
    terminalAssetGoal: 0,
    ...overrides,
  };
}

describe('explainGoalShortfall', () => {
  test('실패 시행이 없으면 none을 돌려준다', () => {
    const result = explainGoalShortfall({ goalFailure: breakdown(), trials: 1000, params: params(), formatValue });
    expect(result.cause).toBe('none');
    expect(result.hint).toBeUndefined();
  });

  test('자산 고갈이 지배적이면 고갈을 원인으로 말한다', () => {
    const result = explainGoalShortfall({
      goalFailure: breakdown({ spendingShortfall: 610, assetDepletion: 610, terminalShortfall: 620, medianFirstShortfallAge: 74 }),
      trials: 1000,
      params: params(),
      formatValue,
    });
    expect(result.cause).toBe('depletion');
    expect(result.headline).toContain('610회');
  });

  test('생활비 미달이 고갈보다 뚜렷이 많으면 미달을 원인으로 말하고 시작 나이를 밝힌다', () => {
    const result = explainGoalShortfall({
      goalFailure: breakdown({ spendingShortfall: 761, assetDepletion: 0, terminalShortfall: 1, medianFirstShortfallAge: 80 }),
      trials: 1000,
      params: params(),
      formatValue,
    });
    expect(result.cause).toBe('spending');
    expect(result.headline).toContain('761회');
    expect(result.headline).toContain('80세부터');
  });

  test('사적연금 인출 상한이 있으면 그 설정을 지목한다', () => {
    const result = explainGoalShortfall({
      goalFailure: breakdown({ spendingShortfall: 761, assetDepletion: 0, medianFirstShortfallAge: 80 }),
      trials: 1000,
      params: params({ withdrawalPlan: { privatePensionMonthlyTarget: 312_500 } }),
      formatValue,
    });
    expect(result.hint).toContain('사적연금');
    expect(result.hint).toContain('31만원');
  });

  test('고갈이 미달의 원인일 때는 인출 설정을 지목하지 않는다', () => {
    // 미달 시행 수가 고갈 시행 수를 넘지 않으면 "자산은 남는데 못 쓴다"가 아니다.
    // 그때 인출 상한을 원인으로 말하면 사실과 다른 조치를 유도한다.
    const result = explainGoalShortfall({
      goalFailure: breakdown({ spendingShortfall: 300, assetDepletion: 300, medianFirstShortfallAge: 78 }),
      trials: 1000,
      params: params({ withdrawalPlan: { privatePensionMonthlyTarget: 312_500 } }),
      formatValue,
    });
    expect(result.cause).toBe('depletion');
    expect(result.hint).toBeUndefined();
  });

  test('인출 상한이 없고 자산 하한선만 있으면 하한선을 지목한다', () => {
    const result = explainGoalShortfall({
      goalFailure: breakdown({ spendingShortfall: 994, assetDepletion: 0, medianFirstShortfallAge: 70 }),
      trials: 1000,
      params: params({ assetFloor: 3_000_000_000 }),
      formatValue,
    });
    expect(result.hint).toContain('자산 하한선');
    expect(result.hint).toContain('300,000만원');
  });

  test('지목할 설정이 없으면 hint를 만들지 않는다', () => {
    const result = explainGoalShortfall({
      goalFailure: breakdown({ spendingShortfall: 500, assetDepletion: 0, medianFirstShortfallAge: 70 }),
      trials: 1000,
      params: params(),
      formatValue,
    });
    expect(result.cause).toBe('spending');
    expect(result.hint).toBeUndefined();
  });

  test('기말자산 미달이 지배적이면 상속 목표액을 원인으로 말한다', () => {
    const result = explainGoalShortfall({
      goalFailure: breakdown({ spendingShortfall: 100, assetDepletion: 50, terminalShortfall: 436, terminalAssetGoal: 3_000_000_000 }),
      trials: 1000,
      params: params(),
      formatValue,
    });
    expect(result.cause).toBe('terminal');
    expect(result.headline).toContain('300,000만원');
  });
});
