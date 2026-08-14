import { describe, expect, test } from 'vitest';
import type { RetirementGoal } from '@/core/entities/retirementGoal';
import { createGoalUtilityConfig } from '@/core/usecases/goals/goalUtilityConfig';
import { DEFAULT_UTILITY_CONFIG } from '@/core/usecases/utility/utilityWeights';

const goal = (
  type: RetirementGoal['type'],
  priority: number,
  constraintType: RetirementGoal['constraintType'] = 'SOFT',
): RetirementGoal => ({ type, priority, constraintType });

describe('createGoalUtilityConfig', () => {
  test('세금·위험·연금 목표가 서로 다른 실제 평가 가중치를 만든다', () => {
    const tax = createGoalUtilityConfig([goal('TAX_OPTIMIZATION', 1)], DEFAULT_UTILITY_CONFIG);
    const risk = createGoalUtilityConfig([goal('RISK_REDUCTION', 1)], DEFAULT_UTILITY_CONFIG);
    const pension = createGoalUtilityConfig([goal('PENSION_OPTIMIZATION', 1)], DEFAULT_UTILITY_CONFIG);

    expect(tax.weights.taxEfficiency).toBeGreaterThan(risk.weights.taxEfficiency);
    expect(risk.weights.depletionSafety).toBeGreaterThan(tax.weights.depletionSafety);
    expect(pension.weights.pensionUtilization).toBeGreaterThan(tax.weights.pensionUtilization);
  });

  test('우선순위를 바꾸면 추천과 평가에 전달될 가중치도 바뀐다', () => {
    const taxFirst = createGoalUtilityConfig([
      goal('TAX_OPTIMIZATION', 1), goal('ASSET_SURVIVAL', 2),
    ], DEFAULT_UTILITY_CONFIG);
    const survivalFirst = createGoalUtilityConfig([
      goal('ASSET_SURVIVAL', 1), goal('TAX_OPTIMIZATION', 2),
    ], DEFAULT_UTILITY_CONFIG);

    expect(taxFirst.weights.taxEfficiency).toBeGreaterThan(survivalFirst.weights.taxEfficiency);
    expect(survivalFirst.weights.depletionSafety).toBeGreaterThan(taxFirst.weights.depletionSafety);
  });

  test('단일 목표에서도 HARD는 SOFT보다 더 강하게 반영된다', () => {
    const hardTax = createGoalUtilityConfig([
      goal('TAX_OPTIMIZATION', 1, 'HARD'),
    ], DEFAULT_UTILITY_CONFIG);
    const softTax = createGoalUtilityConfig([
      goal('TAX_OPTIMIZATION', 1, 'SOFT'),
    ], DEFAULT_UTILITY_CONFIG);

    expect(hardTax.weights.taxEfficiency).toBeGreaterThan(softTax.weights.taxEfficiency);
    expect(Object.values(hardTax.weights).reduce((sum, value) => sum + value, 0)).toBe(100);
  });
});
