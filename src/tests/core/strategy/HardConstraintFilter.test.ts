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

  // afterEvaluation이 사후 HARD 판정의 단일 근거다. 아래 세 경우가 그 계약 전체다.
  describe('afterEvaluation 조정', () => {
    const base = {
      goalEvaluations: [],
      weightedScore: 0,
      score: 0,
      utility: {
        score: 0,
        components: {
          consumption: 0, depletionSafety: 0, pensionUtilization: 0,
          taxEfficiency: 0, taxationRisk: 0, bequestAdequacy: 0,
        },
      },
      unsupportedHardGoals: [],
    };

    test('상세 없이 불리언만 false면 사유를 합성해 빈 탈락을 만들지 않는다', () => {
      const failures = new HardConstraintFilter().afterEvaluation({
        ...base, hardConstraintsSatisfied: false, hardConstraintFailures: [],
      });

      expect(failures).toEqual([
        expect.objectContaining({ code: 'HARD_UNSPECIFIED' }),
      ]);
      expect(failures[0].reason).not.toBe('');
    });

    test('상세가 있으면 불리언이 true여도 상세를 따른다', () => {
      const failures = new HardConstraintFilter().afterEvaluation({
        ...base,
        hardConstraintsSatisfied: true,
        hardConstraintFailures: [{
          code: 'HARD_ASSET_SURVIVAL', goalType: 'ASSET_SURVIVAL', reason: 'depleted',
        }],
      });

      expect(failures).toEqual([expect.objectContaining({ code: 'HARD_ASSET_SURVIVAL' })]);
    });

    test('불리언이 없고 상세도 없으면 탈락시키지 않는다', () => {
      expect(new HardConstraintFilter().afterEvaluation({
        ...base, hardConstraintFailures: [],
      })).toEqual([]);
    });
  });

  // C10: 사전 필터는 HARD 목표만 막는다. constraintType 검사가 사라지면 SOFT 조기은퇴 목표가
  // 후보를 전부 탈락시켜, 사용자가 "선호"로 고른 목표가 "필수"처럼 동작한다.
  test('SOFT 조기은퇴 목표는 시뮬레이션 전에 후보를 탈락시키지 않는다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    input.goals.selectedGoals = [{
      type: 'EARLY_RETIREMENT', priority: 1, targetValue: 60, constraintType: 'SOFT',
    }];
    const filter = new HardConstraintFilter();

    // 목표(60)보다 늦은 61세 후보도 SOFT라면 통과해야 한다.
    expect(filter.beforeSimulation(candidate(61), input.goals)).toEqual([]);
  });
});
