import { describe, expect, test } from 'vitest';
import { LegacySimulationAdapter } from '@/core/domain/input/LegacySimulationAdapter';
import { LegacyEvaluationEngine } from '@/core/evaluation/LegacyEvaluationEngine';
import { LegacySimulationEngine } from '@/core/simulation/LegacySimulationEngine';
import type { RetirementGoal } from '@/core/entities/retirementGoal';
import type { SimulationParams } from '@/core/entities/types';

// 화면이 부르는 평가 경로에도 충돌 판정이 실려 오는가.
//
// 판정 «규칙»은 goalConflict.test.ts가 이미 고정한다. 여기서 시험하는 것은 배선이다 —
// 지금까지 이 판정은 StrategyOptimizer 안에서 후보마다만 섰고, 사용자가 실제로 보고 있는
// 「현재 계획」에는 아무데서도 계산되지 않았다.

/** 세금이 한 푼도 붙지 않는 단순 계좌 하나. 자산 곡선이 곧 인출 곡선이 되어 읽기 쉽다. */
function taxFreeAssets(valueKRW: number) {
  return [{
    id: 'a', type: 'etf', ticker: 'X', name: 'X', quantity: 1, averagePrice: valueKRW,
    totalReturn: 0, dividendYield: 0, monthlyContribution: 0,
    reinvestDividend: true, currency: 'KRW', assetMarket: 'OTHER',
  }];
}

function plan(over: Record<string, unknown>): SimulationParams {
  return {
    userProfile: { currentAge: 60, retirementAge: 60, expectancy: 63, targetMonthlySpending: 5_000_000 },
    assets: taxFreeAssets(300_000_000),
    isaAccounts: [], otherIncomes: [], privatePensions: [],
    nationalPension: { expectedMonthlyAmount: 0 },
    inflationRate: 0, inflationMode: 'nominal', baseExchangeRate: 1400,
    exchangeScenario: 'base', displayCurrency: 'KRW',
    ...over,
  } as unknown as SimulationParams;
}

/** 화면과 같은 경로. 시뮬레이션 결과 하나를 그대로 평가에 넘긴다. */
function evaluate(params: SimulationParams) {
  const result = new LegacySimulationEngine().run(params);
  const { profile, goals, strategy } = LegacySimulationAdapter.fromLegacy(params);
  return {
    result,
    evaluation: new LegacyEvaluationEngine().evaluate(profile, goals, strategy, result),
  };
}

const hardSpendingGoal = (targetValue: number): RetirementGoal =>
  ({ type: 'LIVING_EXPENSE_STABILITY', priority: 1, constraintType: 'HARD', targetValue });

describe('현재 계획의 목표 충돌', () => {
  test('HARD 생활비가 HARD 상속을 이긴 계획은 양쪽을 모두 데리고 온다', () => {
    const { result, evaluation } = evaluate(plan({
      assetFloor: 280_000_000,
      hardSpendingFloor: 5_000_000,
      retirementGoals: [
        hardSpendingGoal(5_000_000),
        { type: 'INHERITANCE', priority: 2, constraintType: 'HARD', targetValue: 280_000_000 },
      ],
    }));

    expect(evaluation.goalConflict.goalConflict).toBe(true);
    expect(evaluation.goalConflict.yieldedGoal).toBe('INHERITANCE');
    // 이긴 쪽을 빼고 진 쪽만 담으면 「양보해서 지켜냈다」로 읽힌다. 양쪽이 함께 와야 한다.
    expect(evaluation.goalConflict.conflictingGoals).toEqual([
      {
        goalType: 'LIVING_EXPENSE_STABILITY',
        constraintLayer: 1,
        shortfall: { unit: 'MONTHLY_MONEY', amount: 0 },
      },
      {
        goalType: 'INHERITANCE',
        constraintLayer: 2,
        shortfall: { unit: 'MONEY', amount: 280_000_000 - result.endingAssets },
      },
    ]);
  });

  test('목표가 서로 다투지 않는 계획은 조용하다', () => {
    const { evaluation } = evaluate(plan({
      assets: taxFreeAssets(1_000_000_000),
      hardSpendingFloor: 5_000_000,
      retirementGoals: [
        hardSpendingGoal(5_000_000),
        { type: 'INHERITANCE', priority: 2, constraintType: 'HARD', targetValue: 100_000_000 },
      ],
    }));

    expect(evaluation.goalConflict.goalConflict).toBe(false);
    expect(evaluation.goalConflict.conflictingGoals).toEqual([]);
    expect(evaluation.goalConflict.yieldedGoal).toBeUndefined();
  });

  test('평가가 시뮬레이션 결과를 건드리지 않는다', () => {
    // 표시용 판정이 계산을 되돌려 고치면 화면의 숫자와 리포트의 숫자가 갈라진다.
    const params = plan({
      assetFloor: 280_000_000,
      hardSpendingFloor: 5_000_000,
      retirementGoals: [
        hardSpendingGoal(5_000_000),
        { type: 'INHERITANCE', priority: 2, constraintType: 'HARD', targetValue: 280_000_000 },
      ],
    });
    const result = new LegacySimulationEngine().run(params);
    const before = structuredClone(result);
    const { profile, goals, strategy } = LegacySimulationAdapter.fromLegacy(params);

    new LegacyEvaluationEngine().evaluate(profile, goals, strategy, result);

    expect(result).toEqual(before);
  });
});
