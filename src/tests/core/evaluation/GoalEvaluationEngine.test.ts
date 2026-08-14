import { describe, expect, test } from 'vitest';
import { LegacySimulationAdapter } from '@/core/domain/input/LegacySimulationAdapter';
import { DefaultGoalEvaluationEngine } from '@/core/evaluation/GoalEvaluationEngine';
import { LegacySimulationEngine } from '@/core/simulation/LegacySimulationEngine';
import { initialParams } from '@/infrastructure/storage/localStore';

describe('DefaultGoalEvaluationEngine', () => {
  test('목표별 달성도를 반환하고 정량 HARD 목표 위반을 점수와 분리한다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    input.goals.selectedGoals = [
      { type: 'ASSET_SURVIVAL', priority: 1, constraintType: 'HARD' },
      { type: 'INHERITANCE', priority: 2, constraintType: 'HARD', targetValue: 1_000_000_000 },
      { type: 'LIVING_EXPENSE_STABILITY', priority: 3, constraintType: 'HARD' },
    ];
    const simulated = new LegacySimulationEngine().simulate(input.profile, input.strategy);
    const firstRetirementYear = simulated.yearlyResults.findIndex(
      (year) => year.age >= input.strategy.retirementAge,
    );
    const result = {
      ...simulated,
      depletionAge: input.strategy.planHorizonAge - 1,
      endingAssets: 0,
      yearlyResults: simulated.yearlyResults.map((year, index) =>
        index === firstRetirementYear ? { ...year, shortfall: 1, unmetSpending: 1 } : year
      ),
    };

    const evaluated = new DefaultGoalEvaluationEngine().evaluate(
      input.profile,
      input.goals,
      input.strategy,
      result,
    );

    expect(evaluated.hardConstraintsSatisfied).toBe(false);
    expect(evaluated.goalEvaluations.map((goal) => goal.goalType)).toEqual([
      'ASSET_SURVIVAL',
      'INHERITANCE',
      'LIVING_EXPENSE_STABILITY',
    ]);
    expect(evaluated.goalEvaluations.every((goal) =>
      goal.score >= 0 && goal.score <= 100 && typeof goal.reason === 'string'
    )).toBe(true);
    expect(evaluated.score).toBe(evaluated.utility.score);
    expect(evaluated.weightedScore).toBeGreaterThanOrEqual(0);
    expect(evaluated.hardConstraintFailures.map((failure) => failure.code)).toEqual([
      'HARD_ASSET_SURVIVAL',
      'HARD_MINIMUM_ENDING_ASSETS',
      'HARD_SPENDING_SHORTFALL',
    ]);
  });

  test('현재 모델로 정량 판정할 수 없는 HARD 목표는 통과로 꾸미지 않고 노출한다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    input.goals.selectedGoals = [
      { type: 'HOUSING_STABILITY', priority: 1, constraintType: 'HARD' },
    ];
    const result = new LegacySimulationEngine().simulate(input.profile, input.strategy);

    const evaluated = new DefaultGoalEvaluationEngine().evaluate(
      input.profile,
      input.goals,
      input.strategy,
      result,
    );

    expect(evaluated.hardConstraintFailures).toEqual([]);
    expect(evaluated.unsupportedHardGoals).toEqual(['HOUSING_STABILITY']);
    expect(evaluated.hardConstraintsSatisfied).toBe(true);
    expect(evaluated.goalEvaluations).toEqual([{
      goalType: 'HOUSING_STABILITY',
      score: 0,
      achieved: false,
      reason: '현재 프로필과 시뮬레이션 결과에 주거 안정을 정량화할 정보가 없습니다.',
    }]);
  });

  test('HARD 은퇴 나이는 점수 감점이 아니라 전략 탈락으로 표시한다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    input.goals.selectedGoals = [{
      type: 'EARLY_RETIREMENT', priority: 1, constraintType: 'HARD', targetValue: 60,
    }];
    input.strategy.retirementAge = 61;
    const result = new LegacySimulationEngine().simulate(input.profile, input.strategy);

    const evaluated = new DefaultGoalEvaluationEngine().evaluate(
      input.profile,
      input.goals,
      input.strategy,
      result,
    );

    expect(evaluated.goalEvaluations[0]).toMatchObject({
      goalType: 'EARLY_RETIREMENT',
      score: 98,
      achieved: false,
      actualValue: 61,
      targetValue: 60,
    });
    expect(evaluated.hardConstraintsSatisfied).toBe(false);
    expect(evaluated.hardConstraintFailures).toEqual([expect.objectContaining({
      code: 'HARD_RETIREMENT_AGE',
      goalType: 'EARLY_RETIREMENT',
    })]);
  });

  test('우선순위가 높은 목표에 더 큰 가중치를 주어 종합 적합도를 계산한다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    input.goals.selectedGoals = [
      { type: 'EARLY_RETIREMENT', priority: 1, constraintType: 'SOFT', targetValue: 60 },
      { type: 'TAX_OPTIMIZATION', priority: 2, constraintType: 'SOFT' },
    ];
    input.strategy.retirementAge = 60;
    const result = new LegacySimulationEngine().simulate(input.profile, input.strategy);

    const evaluated = new DefaultGoalEvaluationEngine().evaluate(
      input.profile,
      input.goals,
      input.strategy,
      result,
    );
    const [retirement, tax] = evaluated.goalEvaluations;

    expect(retirement.score).toBe(100);
    expect(evaluated.weightedScore).toBe(Math.round((retirement.score * 2 + tax.score) / 3));
  });

  test('서로 다른 소비 목표를 각 목표 금액으로 평가하고 HARD 미달을 탈락 처리한다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    input.strategy.targetMonthlySpending = 3_000_000;
    input.goals.selectedGoals = [
      {
        type: 'LIVING_EXPENSE_STABILITY',
        priority: 1,
        constraintType: 'SOFT',
        targetValue: 3_000_000,
      },
      {
        type: 'COMFORTABLE_SPENDING',
        priority: 2,
        constraintType: 'HARD',
        targetValue: 5_000_000,
      },
    ];
    const result = new LegacySimulationEngine().simulate(input.profile, input.strategy);

    const evaluated = new DefaultGoalEvaluationEngine().evaluate(
      input.profile,
      input.goals,
      input.strategy,
      result,
    );
    const [stability, comfortable] = evaluated.goalEvaluations;

    expect(stability).toMatchObject({ achieved: true, score: 100, targetValue: 3_000_000 });
    expect(comfortable).toMatchObject({ achieved: false, targetValue: 5_000_000 });
    expect(comfortable.score).toBeLessThan(100);
    expect(evaluated.hardConstraintsSatisfied).toBe(false);
    expect(evaluated.hardConstraintFailures).toEqual([expect.objectContaining({
      code: 'HARD_SPENDING_SHORTFALL',
      goalType: 'COMFORTABLE_SPENDING',
    })]);
  });

  test('전략 소비보다 낮은 개별 HARD 목표는 전략 부족 원장과 분리해 판정한다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    input.strategy.targetMonthlySpending = 5_000_000;
    input.goals.selectedGoals = [{
      type: 'LIVING_EXPENSE_STABILITY',
      priority: 1,
      constraintType: 'HARD',
      targetValue: 3_000_000,
    }];
    const simulated = new LegacySimulationEngine().simulate(input.profile, input.strategy);
    const firstRetirementYear = simulated.yearlyResults.findIndex(
      (year) => year.age >= input.strategy.retirementAge,
    );
    const result = {
      ...simulated,
      yearlyResults: simulated.yearlyResults.map((year, index) =>
        year.age >= input.strategy.retirementAge
          ? {
              ...year,
              spending: 4_000_000 * 12 + year.healthcareSpending,
              actualSpending: 4_000_000 * 12 + year.healthcareSpending,
              unmetSpending: index === firstRetirementYear ? 1 : 0,
              shortfall: index === firstRetirementYear ? 1 : 0,
            }
          : year),
    };

    const evaluated = new DefaultGoalEvaluationEngine().evaluate(
      input.profile,
      input.goals,
      input.strategy,
      result,
    );

    expect(evaluated.goalEvaluations[0]).toMatchObject({
      achieved: true,
      score: 100,
      targetValue: 3_000_000,
    });
    expect(evaluated.hardConstraintsSatisfied).toBe(true);
    expect(evaluated.hardConstraintFailures).toEqual([]);
  });
});
