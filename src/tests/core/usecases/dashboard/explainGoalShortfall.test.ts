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
  const merged = {
    spendingShortfall: 0,
    assetDepletion: 0,
    terminalShortfall: 0,
    medianFirstShortfallAge: null,
    terminalAssetGoal: 0,
    ...overrides,
  };
  // 관측 고갈 수를 따로 주지 않으면 「자산 고갈 방지」를 고른 계획으로 본다(관측 = 판정).
  // 게이트가 닫힌 계획은 이 값을 명시적으로 넘겨 두 값을 갈라 놓는다.
  return {
    ...merged,
    observedAssetDepletionCount: overrides.observedAssetDepletionCount ?? merged.assetDepletion,
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

  // 아래 네 개는 「원인은 관측값으로 가른다」를 고정한다.
  //
  // 실제 리포트에서 화면은 「420회에서 목표 생활비를 채우지 못합니다」, PDF는 「자산이 먼저
  // 바닥난 경우가 420회」라고 같은 시행을 다르게 설명했다. 원인 판정이 목표 게이트가 닫힌
  // assetDepletion(=0)을 「고갈이 없었다」로 읽었기 때문이다. 개수까지 함께 고정한다 —
  // cause만 보면 「1,000회 중 0회에서 자산이 고갈됩니다」 같은 문장이 그대로 통과한다.
  test('자산 고갈 방지를 고르지 않아도 실제로 고갈됐으면 고갈을 원인으로 말한다', () => {
    const result = explainGoalShortfall({
      // 게이트가 닫혀 assetDepletion은 0이지만 실제로는 420회 고갈됐다.
      goalFailure: breakdown({
        spendingShortfall: 420, assetDepletion: 0, observedAssetDepletionCount: 420,
        medianFirstShortfallAge: 73,
      }),
      trials: 1000,
      params: params({ withdrawalPlan: { privatePensionMonthlyTarget: 312_500 } }),
      formatValue,
    });
    expect(result.cause).toBe('depletion');
    expect(result.headline).toBe('1,000회 중 420회에서 기대수명 전에 자산이 고갈됩니다.');
    // 고갈이 원인이면 인출 설정을 지목하지 않는다 — 있지도 않은 조치를 유도한다.
    expect(result.hint).toBeUndefined();
  });

  test('자산 고갈 방지를 골랐고 실제로 고갈됐으면 같은 문장을 말한다', () => {
    const result = explainGoalShortfall({
      goalFailure: breakdown({
        spendingShortfall: 420, assetDepletion: 420, observedAssetDepletionCount: 420,
        medianFirstShortfallAge: 73,
      }),
      trials: 1000,
      params: params({ withdrawalPlan: { privatePensionMonthlyTarget: 312_500 } }),
      formatValue,
    });
    expect(result.cause).toBe('depletion');
    expect(result.headline).toBe('1,000회 중 420회에서 기대수명 전에 자산이 고갈됩니다.');
    expect(result.hint).toBeUndefined();
  });

  test('생활비 미달이 관측된 고갈보다 많으면 미달을 원인으로 말한다', () => {
    const result = explainGoalShortfall({
      goalFailure: breakdown({
        spendingShortfall: 700, assetDepletion: 0, observedAssetDepletionCount: 200,
        medianFirstShortfallAge: 78,
      }),
      trials: 1000,
      params: params(),
      formatValue,
    });
    expect(result.cause).toBe('spending');
    expect(result.headline).toBe('1,000회 중 700회에서 목표 생활비를 채우지 못합니다 (평균적으로 78세부터).');
  });

  test('고갈이 한 번도 없으면 미달을 원인으로 말한다', () => {
    const result = explainGoalShortfall({
      goalFailure: breakdown({
        spendingShortfall: 500, assetDepletion: 0, observedAssetDepletionCount: 0,
        medianFirstShortfallAge: 70,
      }),
      trials: 1000,
      params: params({ withdrawalPlan: { privatePensionMonthlyTarget: 312_500 } }),
      formatValue,
    });
    expect(result.cause).toBe('spending');
    expect(result.headline).toBe('1,000회 중 500회에서 목표 생활비를 채우지 못합니다 (평균적으로 70세부터).');
    // 자산이 남는데도 못 쓰는 시행이니 이때는 설정을 지목한다.
    expect(result.hint).toContain('사적연금');
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
