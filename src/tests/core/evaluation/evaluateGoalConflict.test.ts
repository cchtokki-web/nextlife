import { describe, expect, test, vi } from 'vitest';
import { LegacySimulationAdapter } from '@/core/domain/input/LegacySimulationAdapter';
import { LegacyEvaluationEngine } from '@/core/evaluation/LegacyEvaluationEngine';
import { evaluateGoalConflict } from '@/core/evaluation/evaluateGoalConflict';
import type { GoalEvaluationEngine, GoalEvaluationResult } from '@/core/evaluation/GoalEvaluationEngine';
import { LegacySimulationEngine } from '@/core/simulation/LegacySimulationEngine';
import type { RetirementGoal } from '@/core/entities/retirementGoal';
import type { SimulationParams } from '@/core/entities/types';

// 충돌만 묻는 좁은 진입점.
//
// 판정 «규칙»은 goalConflict.test.ts가, 화면 경로의 배선은 legacyGoalConflict.test.ts가 이미
// 고정한다. 여기서 시험하는 것은 두 가지다 — 이 진입점이 «스스로 판정하지 않는다»는 것과,
// 전체 평가(LegacyEvaluationEngine)와 «같은 답»을 준다는 것. 둘째가 무너지면 같은 계획에
// 대해 화면과 리포트가 다른 충돌을 말하게 된다.

/** 세금이 한 푼도 붙지 않는 단순 계좌 하나. legacyGoalConflict.test.ts와 같은 모양이다. */
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

const hardSpendingGoal = (targetValue: number): RetirementGoal =>
  ({ type: 'LIVING_EXPENSE_STABILITY', priority: 1, constraintType: 'HARD', targetValue });

const conflictingPlan = plan({
  assetFloor: 280_000_000,
  hardSpendingFloor: 5_000_000,
  retirementGoals: [
    hardSpendingGoal(5_000_000),
    { type: 'INHERITANCE', priority: 2, constraintType: 'HARD', targetValue: 280_000_000 },
  ],
});

const quietPlan = plan({
  assets: taxFreeAssets(1_000_000_000),
  hardSpendingFloor: 5_000_000,
  retirementGoals: [
    hardSpendingGoal(5_000_000),
    { type: 'INHERITANCE', priority: 2, constraintType: 'HARD', targetValue: 100_000_000 },
  ],
});

function domainInputFor(params: SimulationParams) {
  const result = new LegacySimulationEngine().run(params);
  const { profile, goals, strategy } = LegacySimulationAdapter.fromLegacy(params);
  return { result, profile, goals, strategy };
}

describe('evaluateGoalConflict', () => {
  test('규칙을 세우지 않는다 — 엔진에게 한 번 묻고 그 답을 그대로 옮긴다', () => {
    // 엔진이 «사실과 무관한» 판정을 내놓게 해 둔다. 이 진입점이 스스로 계산하는 부분이
    // 조금이라도 있으면 답이 이 값과 갈라진다.
    const fabricated = {
      goalConflict: true,
      conflictingGoals: [
        { goalType: 'COMFORTABLE_SPENDING', constraintLayer: 1, shortfall: { unit: 'MONTHLY_MONEY', amount: 123 } },
      ],
      yieldedGoal: 'ASSET_SURVIVAL',
      // 판정에 딸린 나머지는 최적화기의 재료다. 함께 새어 나오면 표시 계층이 순위 없는
      // 점수를 그리게 된다(GoalConflictVerdict 주석).
      weightedScore: 42,
      hardConstraintsSatisfied: false,
    } as unknown as GoalEvaluationResult;
    const stub: GoalEvaluationEngine = { evaluate: vi.fn(() => fabricated) };
    const { result, profile, goals, strategy } = domainInputFor(quietPlan);

    const verdict = evaluateGoalConflict(profile, goals, strategy, result, stub);

    expect(stub.evaluate).toHaveBeenCalledTimes(1);
    expect(verdict.goalConflict).toBe(true);
    expect(verdict.conflictingGoals).toEqual(fabricated.conflictingGoals);
    expect(verdict.yieldedGoal).toBe('ASSET_SURVIVAL');
    expect(Object.keys(verdict).sort()).toEqual(['conflictingGoals', 'goalConflict', 'yieldedGoal']);
  });

  test('충돌하는 계획에서 전체 평가와 한 글자도 다르지 않은 판정을 준다', () => {
    const { result, profile, goals, strategy } = domainInputFor(conflictingPlan);

    const narrow = evaluateGoalConflict(profile, goals, strategy, result);

    // 리포트가 이 값을 그대로 인쇄한다. 이긴 쪽·진 쪽·부족액까지 같아야 화면과 문서가
    // 같은 충돌을 말한다.
    expect(narrow.goalConflict).toBe(true);
    expect(narrow.yieldedGoal).toBe('INHERITANCE');
    expect(narrow.conflictingGoals).toEqual([
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
    expect(narrow).toEqual(
      new LegacyEvaluationEngine().evaluate(profile, goals, strategy, result).goalConflict,
    );
  });

  test('조용한 계획에서도 전체 평가와 같은 답을 준다', () => {
    // 「충돌 없음」이 두 경로에서 같아야 한다. 한쪽만 조용해지면 리포트에서 고지가 사라져도
    // 화면은 멀쩡해 보이고, 그 어긋남은 아무도 알아채지 못한다.
    const { result, profile, goals, strategy } = domainInputFor(quietPlan);

    const narrow = evaluateGoalConflict(profile, goals, strategy, result);

    expect(narrow.goalConflict).toBe(false);
    expect(narrow.conflictingGoals).toEqual([]);
    expect(narrow.yieldedGoal).toBeUndefined();
    expect(narrow).toEqual(
      new LegacyEvaluationEngine().evaluate(profile, goals, strategy, result).goalConflict,
    );
  });
});
