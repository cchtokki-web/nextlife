import { describe, expect, test } from 'vitest';
import { LegacySimulationAdapter } from '@/core/domain/input/LegacySimulationAdapter';
import { DefaultGoalEvaluationEngine } from '@/core/evaluation/GoalEvaluationEngine';
import { LegacySimulationEngine } from '@/core/simulation/LegacySimulationEngine';
import { initialParams } from '@/infrastructure/storage/localStore';

describe('DefaultGoalEvaluationEngine', () => {
  test('기존 lifetime utility를 재사용하고 정량 HARD 목표 위반을 별도로 반환한다', () => {
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

    expect(evaluated.score).toBe(evaluated.utility.score);
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
  });
});
