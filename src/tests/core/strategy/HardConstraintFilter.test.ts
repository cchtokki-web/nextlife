import { describe, expect, test } from 'vitest';
import { LegacySimulationAdapter } from '@/core/domain/input/LegacySimulationAdapter';
import { HardConstraintFilter } from '@/core/strategy/HardConstraintFilter';
import type { StrategyCandidate } from '@/core/strategy/StrategyGenerator';
import { initialParams } from '@/infrastructure/storage/localStore';

function candidate(retirementAge: number): StrategyCandidate {
  const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
  return {
    id: `retire-${retirementAge}`,
    strategy: { ...input.strategy, retirementAge },
    dimensions: {
      retirementAge,
      nationalPensionTiming: 'NORMAL',
      nationalPensionStartAge: 65,
      withdrawalPolicy: 'GENERAL_FIRST',
      spendingPattern: 'FIXED',
      assetAllocation: 'BALANCED',
    },
  };
}

describe('HardConstraintFilter', () => {
  test('정적으로 알 수 있는 HARD 은퇴 나이는 시뮬레이션 전에 거른다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    input.goals.selectedGoals = [{
      type: 'EARLY_RETIREMENT', priority: 1, targetValue: 60, constraintType: 'HARD',
    }];
    const filter = new HardConstraintFilter();

    expect(filter.beforeSimulation(candidate(60), input.goals)).toEqual([]);
    expect(filter.beforeSimulation(candidate(61), input.goals)).toEqual([
      expect.objectContaining({ code: 'HARD_RETIREMENT_AGE' }),
    ]);
  });

  test('결과가 필요한 HARD 실패는 GoalEvaluation 결과에서 분리해 전달한다', () => {
    const filter = new HardConstraintFilter();
    const failures = filter.afterEvaluation({
      hardConstraintsSatisfied: false,
      goalEvaluations: [],
      weightedScore: 0,
      score: 0,
      utility: {
        score: 0,
        components: {
          consumption: 0,
          depletionSafety: 0,
          pensionUtilization: 0,
          taxEfficiency: 0,
          taxationRisk: 0,
          bequestAdequacy: 0,
        },
      },
      hardConstraintFailures: [{
        code: 'HARD_SPENDING_SHORTFALL',
        goalType: 'LIVING_EXPENSE_STABILITY',
        reason: 'shortfall',
      }],
      unsupportedHardGoals: [],
    });

    expect(failures).toEqual([expect.objectContaining({ code: 'HARD_SPENDING_SHORTFALL' })]);
  });
});
