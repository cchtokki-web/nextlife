import type { MonteCarloResult } from '../../entities/montecarlo';
import type {
  SimulationParams,
  SimulationResult,
  SimulationYearlyResult,
} from '../../entities/types';
import {
  computeMonthlySpendingComposition,
  type MonthlySpendingComposition,
} from '../MonthlySpendingComposition';

export const SHORTFALL_EPSILON_MONTHLY = 10_000;

export interface ShortfallYearMetric {
  age: number;
  year: number;
  monthlyAmount: number;
}

export interface SpendingShortfallMetric {
  shortfallAmount: number;
  shortfallYears: ShortfallYearMetric[];
  averageMonthlyShortfall: number;
}

export interface SustainableSpendingEstimate {
  amount: number;
  targetSuccessProbability: number;
}

export interface SimulationMetrics {
  /** 은퇴 기간의 물가·소비곡선·의료비를 반영한 평균 월 목표 생활비. */
  targetSpending: number;
  /** 은퇴 기간에 실제로 지출할 수 있었던 평균 월 생활비. */
  actualSpending: number;
  /** actualSpending / targetSpending. 퍼센트가 아닌 0~n 비율이다. */
  spendingAchievementRate: number;
  /** 현재 전략의 제약을 만족하도록 역산된 평균 월 지속가능 생활비. */
  sustainableSpending: number;
  /** 현재 엔진은 확률 역산기가 없으므로 기준 수익률 경로임을 명시한다. */
  sustainableSpendingBasis: 'deterministic' | 'probabilistic';
  sustainableSpendingTargetProbability: number | null;
  /** 사용자 목표 생활비 기준 부족 지표. */
  shortfall: SpendingShortfallMetric;
  /** 기대수명 전에 자산이 고갈되지 않았는지 여부. */
  assetSurvival: boolean;
  /** 기대수명 시점 잔여자산. */
  terminalAssets: number;
  /** 정량 판정 가능한 사용자 목표의 공동 성공확률. 미산출이면 null이며 추정하지 않는다. */
  goalSuccessProbability: number | null;
  /** 기존 goalAchievementRate의 명확한 이름: 자산 매도 제외 고정소득 커버율. */
  fixedIncomeCoverageRate: number;
  averageMonthlyFixedIncome: number;
  yearlySpending: MonthlySpendingComposition[];
}

export interface RetirementIncomeMetrics {
  averageMonthlyIncome: number;
  averageMonthlyTarget: number;
  fixedIncomeCoverageRate: number;
}

export class SimulationMetricsCalculator {
  calculate(
    params: SimulationParams,
    result: SimulationResult,
    monteCarlo?: MonteCarloResult,
    sustainableEstimate?: SustainableSpendingEstimate,
  ): SimulationMetrics {
    const yearlySpending = computeMonthlySpendingComposition(
      result.yearlyResults,
      params,
      result,
    );
    const targetSpending = average(yearlySpending.map((row) => row.goalMonthly));
    const actualSpending = average(yearlySpending.map((row) => row.actualMonthly));
    const sustainableSpending = this.averageSustainableSpending(
      params,
      result,
      sustainableEstimate?.amount,
    );
    const shortfallYears = yearlySpending
      .filter((row) => row.goalShortfall >= SHORTFALL_EPSILON_MONTHLY)
      .map((row) => ({
        age: row.age,
        year: row.year,
        monthlyAmount: row.goalShortfall,
      }));
    const shortfallAmount = shortfallYears.reduce(
      (sum, row) => sum + row.monthlyAmount * 12,
      0,
    );
    const income = calculateRetirementIncomeMetrics(
      result.yearlyResults,
      params,
      result.calculatedTargetSpending,
    );

    return {
      targetSpending,
      actualSpending,
      spendingAchievementRate: targetSpending > 0 ? actualSpending / targetSpending : 0,
      sustainableSpending,
      sustainableSpendingBasis: sustainableEstimate ? 'probabilistic' : 'deterministic',
      sustainableSpendingTargetProbability: sustainableEstimate
        ? Math.min(1, Math.max(0, sustainableEstimate.targetSuccessProbability))
        : null,
      shortfall: {
        shortfallAmount,
        shortfallYears,
        averageMonthlyShortfall: average(shortfallYears.map((row) => row.monthlyAmount)),
      },
      assetSurvival: result.depletionAge === null
        || result.depletionAge > params.userProfile.expectancy,
      terminalAssets: result.endingAssets,
      goalSuccessProbability: monteCarlo?.goalSuccessProbability ?? null,
      fixedIncomeCoverageRate: income.fixedIncomeCoverageRate,
      averageMonthlyFixedIncome: income.averageMonthlyIncome,
      yearlySpending,
    };
  }

  private averageSustainableSpending(
    params: SimulationParams,
    result: SimulationResult,
    baseOverride?: number,
  ): number {
    const base = baseOverride
      ?? result.calculatedTargetSpending
      ?? params.userProfile.targetMonthlySpending;
    const syntheticResult: SimulationResult = {
      ...result,
      calculatedTargetSpending: base,
    };
    const syntheticParams: SimulationParams = {
      ...params,
      spendingStrategy: 'max_sustainable',
    };
    const rows = computeMonthlySpendingComposition(
      result.yearlyResults,
      syntheticParams,
      syntheticResult,
    );
    return average(rows.map((row) => row.targetMonthly));
  }
}

export function calculateRetirementIncomeMetrics(
  yearlyResults: readonly SimulationYearlyResult[],
  params: SimulationParams,
  calculatedTargetSpending?: number,
): RetirementIncomeMetrics {
  const retirementYears = yearlyResults.filter(
    (row) => row.age >= params.userProfile.retirementAge,
  );
  if (retirementYears.length === 0) {
    return {
      averageMonthlyIncome: 0,
      averageMonthlyTarget: 0,
      fixedIncomeCoverageRate: 0,
    };
  }

  const placeholder: SimulationResult = {
    yearlyResults: [...yearlyResults],
    fireAge: null,
    depletionAge: null,
    endingAssets: 0,
    retirementScore: 0,
    retirementGrade: '보통',
    goalAchievementRate: 0,
    retirementAssetsAtRetirement: 0,
    calculatedTargetSpending,
  };
  const composition = computeMonthlySpendingComposition(
    [...yearlyResults],
    params,
    placeholder,
  );
  const averageMonthlyIncome = average(retirementYears.map((row) => row.totalIncome / 12));
  const averageMonthlyTarget = average(composition.map((row) => row.targetMonthly));

  return {
    averageMonthlyIncome,
    averageMonthlyTarget,
    fixedIncomeCoverageRate: averageMonthlyTarget > 0
      ? Math.min(200, Math.max(0, Math.round(
        (averageMonthlyIncome / averageMonthlyTarget) * 100,
      )))
      : 0,
  };
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
