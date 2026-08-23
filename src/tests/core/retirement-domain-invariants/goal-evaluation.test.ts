import { describe, expect, test } from 'vitest';
import { LegacySimulationAdapter } from '@/core/domain/input/LegacySimulationAdapter';
import { DefaultGoalEvaluationEngine } from '@/core/evaluation/GoalEvaluationEngine';
import { LegacySimulationEngine } from '@/core/simulation/LegacySimulationEngine';
import { retirementParams } from './fixtures';

describe('retirement-domain-invariants / goal evaluation', () => {
  test('큰 상속자산 점수가 생활비 HARD shortfall을 상쇄하지 못한다', () => {
    const input = LegacySimulationAdapter.fromLegacy(retirementParams());
    input.goals.selectedGoals = [
      {
        type: 'LIVING_EXPENSE_STABILITY',
        priority: 1,
        constraintType: 'HARD',
      },
      {
        type: 'INHERITANCE',
        priority: 2,
        constraintType: 'SOFT',
        targetValue: 500_000_000,
        targetValueSource: 'user',
      },
    ];
    const simulated = new LegacySimulationEngine().simulate(input.profile, input.strategy);
    const firstRetirementYear = simulated.yearlyResults.findIndex(
      (year) => year.age >= input.strategy.retirementAge
    );
    const result = {
      ...simulated,
      endingAssets: 100_000_000_000,
      yearlyResults: simulated.yearlyResults.map((year, index) => index === firstRetirementYear
        ? {
            ...year,
            actualSpending: Math.max(0, year.actualSpending - 1),
            spending: Math.max(0, year.spending - 1),
            shortfall: 1,
            unmetSpending: 1,
          }
        : year),
    };

    const evaluated = new DefaultGoalEvaluationEngine().evaluate(
      input.profile,
      input.goals,
      input.strategy,
      result,
    );

    expect(evaluated.goalEvaluations.find((goal) => goal.goalType === 'INHERITANCE'))
      .toMatchObject({ achieved: true, score: 100 });
    expect(evaluated.hardConstraintsSatisfied).toBe(false);
    expect(evaluated.hardConstraintFailures).toEqual([
      expect.objectContaining({ code: 'HARD_SPENDING_SHORTFALL' }),
    ]);
  });
});
