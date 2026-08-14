import { describe, expect, test } from 'vitest';
import type { SimulationParams, SimulationResult } from '@/core/entities/types';
import { SimulationMetricsCalculator } from '@/core/usecases/metrics/SimulationMetricsCalculator';
import { makeYearlyResult } from '@/tests/fixtures/yearlyResult';

const params: SimulationParams = {
  userProfile: {
    currentAge: 50,
    retirementAge: 60,
    expectancy: 62,
    targetMonthlySpending: 3_500_000,
  },
  assets: [],
  nationalPension: { expectedMonthlyAmount: 0 },
  privatePensions: [],
  otherIncomes: [],
  inflationRate: 2,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
  spendingStrategy: 'target',
};

function result(): SimulationResult {
  return {
    yearlyResults: [
      makeYearlyResult({ age: 60, year: 2036, spending: 3_500_000 * 12, totalAssets: 200_000_000 }),
      makeYearlyResult({ age: 61, year: 2037, spending: 3_150_000 * 12, totalAssets: 100_000_000 }),
      makeYearlyResult({ age: 62, year: 2038, spending: 2_800_000 * 12, totalAssets: 50_000_000 }),
    ],
    fireAge: null,
    depletionAge: null,
    endingAssets: 50_000_000,
    retirementScore: 70,
    retirementGrade: '보통',
    goalAchievementRate: 0,
    retirementAssetsAtRetirement: 200_000_000,
    calculatedTargetSpending: 3_200_000,
  };
}

describe('SimulationMetricsCalculator', () => {
  test('목표·실제·달성률·지속가능 소비를 같은 월 기준으로 계산한다', () => {
    const metrics = new SimulationMetricsCalculator().calculate(params, result());

    expect(metrics.targetSpending).toBe(3_500_000);
    expect(metrics.actualSpending).toBe(3_150_000);
    expect(metrics.spendingAchievementRate).toBeCloseTo(0.9);
    expect(metrics.sustainableSpending).toBe(3_200_000);
    expect(metrics.sustainableSpendingBasis).toBe('deterministic');
    expect(metrics.sustainableSpendingTargetProbability).toBeNull();
  });

  test('부족액과 발생 연도를 age/year와 함께 한 번만 집계한다', () => {
    const metrics = new SimulationMetricsCalculator().calculate(params, result());

    expect(metrics.shortfall.shortfallAmount).toBe((350_000 + 700_000) * 12);
    expect(metrics.shortfall.averageMonthlyShortfall).toBe(525_000);
    expect(metrics.shortfall.shortfallYears).toEqual([
      { age: 61, year: 2037, monthlyAmount: 350_000 },
      { age: 62, year: 2038, monthlyAmount: 700_000 },
    ]);
  });

  test('자산 생존·기말자산을 기대수명 판정과 같은 기준으로 노출한다', () => {
    const metrics = new SimulationMetricsCalculator().calculate(params, result());

    expect(metrics.assetSurvival).toBe(true);
    expect(metrics.terminalAssets).toBe(50_000_000);
  });

  test('기대수명 당해 자산 고갈은 Monte Carlo와 동일하게 생존 실패로 판정한다', () => {
    const depletedAtExpectancy = {
      ...result(),
      depletionAge: params.userProfile.expectancy,
      endingAssets: 0,
    };

    const metrics = new SimulationMetricsCalculator().calculate(params, depletedAtExpectancy);

    expect(metrics.assetSurvival).toBe(false);
  });

  test('최대 지속가능 전략의 고정소득 커버율은 역산 생활비를 분모로 사용한다', () => {
    const optimizedParams: SimulationParams = {
      ...params,
      spendingStrategy: 'max_sustainable',
    };
    const optimizedResult: SimulationResult = {
      ...result(),
      calculatedTargetSpending: 2_000_000,
      yearlyResults: result().yearlyResults.map((row) => ({
        ...row,
        spending: 2_000_000 * 12,
        totalIncome: 1_000_000 * 12,
      })),
    };

    const metrics = new SimulationMetricsCalculator().calculate(
      optimizedParams,
      optimizedResult,
    );

    expect(metrics.yearlySpending.every((row) => row.targetMonthly === 2_000_000)).toBe(true);
    expect(metrics.averageMonthlyFixedIncome).toBe(1_000_000);
    expect(metrics.fixedIncomeCoverageRate).toBe(50);
  });

  test('전체 목표 성공확률이 없는 레거시 Monte Carlo 결과는 추정하지 않는다', () => {
    const metrics = new SimulationMetricsCalculator().calculate(params, result());

    expect(metrics.goalSuccessProbability).toBeNull();
  });

  test('StrategyOptimizer가 목표 확률별 역산액을 주면 확률 기준 지속가능 소비로 구분한다', () => {
    const metrics = new SimulationMetricsCalculator().calculate(
      params,
      result(),
      undefined,
      { amount: 2_900_000, targetSuccessProbability: 0.9 },
    );

    expect(metrics.sustainableSpending).toBe(2_900_000);
    expect(metrics.sustainableSpendingBasis).toBe('probabilistic');
    expect(metrics.sustainableSpendingTargetProbability).toBe(0.9);
  });
});
