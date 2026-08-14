import { describe, expect, test } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import {
  getNationalPensionAdjustmentFactor,
  NATIONAL_PENSION_EARLY_MIN_AGE,
  NATIONAL_PENSION_NORMAL_START_AGE,
} from '@/core/usecases/pension/nationalPensionRules';
import { retirementParams } from './fixtures';

describe('retirement-domain-invariants / national pension', () => {
  test('수령 시작 전 국민연금 소득은 0이다', () => {
    const result = new SimulationEngine().run(retirementParams({
      userProfile: {
        currentAge: 60,
        retirementAge: 60,
        expectancy: 66,
        targetMonthlySpending: 2_000_000,
      },
      withdrawalPlan: { nationalPensionStartAge: 65 },
    }));

    expect(result.yearlyResults
      .filter((year) => year.age < 65)
      .every((year) => year.nationalPensionIncome === 0)).toBe(true);
    expect(result.yearlyResults.find((year) => year.age === 65)?.nationalPensionIncome)
      .toBeGreaterThan(0);
  });

  test('조기 수령액 계수는 동일 조건의 정상 수령액 계수보다 높지 않다', () => {
    for (let age = NATIONAL_PENSION_EARLY_MIN_AGE;
      age < NATIONAL_PENSION_NORMAL_START_AGE;
      age += 1) {
      expect(getNationalPensionAdjustmentFactor(age)).toBeLessThanOrEqual(
        getNationalPensionAdjustmentFactor(NATIONAL_PENSION_NORMAL_START_AGE)
      );
    }
  });
});
