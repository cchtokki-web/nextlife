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

export interface SimulationMetrics {
  /** 은퇴 기간의 물가·소비곡선·의료비를 반영한 평균 월 목표 생활비. */
  targetSpending: number;
  /** 은퇴 기간에 실제로 지출할 수 있었던 평균 월 생활비. */
  actualSpending: number;
  /** actualSpending / targetSpending. 퍼센트가 아닌 0~n 비율이다. */
  spendingAchievementRate: number;
  /**
   * 현재 전략의 제약을 만족하도록 역산된 평균 월 지속가능 생활비.
   *
   * **이 값은 언제나 결정론 이진탐색의 결과다**(`SimulationEngine.searchSustainable`).
   * 그 사실을 사용자에게 말하는 문장은 `describeSustainableSpendingBasis`가 소유한다.
   *
   * 한때 이 옆에 `sustainableSpendingBasis: 'deterministic' | 'probabilistic'`과
   * `sustainableSpendingTargetProbability`가 있었다. 그 값을 «만드는 코드는 없었고»
   * (EvaluationContext.sustainableSpendingEstimate를 채우는 호출부가 저장소에 없었다),
   * 그래서 basis는 언제나 'deterministic'이고 확률은 언제나 null이었다. 타입만 「확률
   * 기준으로 역산한 한도가 있을 수 있다」고 말하고 실제로는 그런 값이 없었던 셈이다.
   * 지어낼 수 없는 값을 타입이 약속하지 않도록 걷어냈다(known-issues 17번).
   */
  sustainableSpending: number;
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
  ): SimulationMetrics {
    const yearlySpending = computeMonthlySpendingComposition(
      result.yearlyResults,
      params,
      result,
    );
    const targetSpending = average(yearlySpending.map((row) => row.goalMonthly));
    const actualSpending = average(yearlySpending.map((row) => row.actualMonthly));
    const sustainableSpending = this.averageSustainableSpending(params, result);
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

  // baseOverride 인자가 함께 사라졌다. 그 값을 주던 유일한 출처가
  // SustainableSpendingEstimate.amount였고, 그것을 만드는 호출부가 없었다 —
  // 남겨 두면 「밑값을 바꿀 수 있다」는 또 하나의 없는 약속이 된다(known-issues 17번).
  private averageSustainableSpending(
    params: SimulationParams,
    result: SimulationResult,
  ): number {
    const base = result.calculatedTargetSpending
      ?? params.userProfile.targetMonthlySpending;
    const syntheticResult: SimulationResult = {
      ...result,
      calculatedTargetSpending: base,
    };
    // **이 'max_sustainable'은 «전략 선택»이 아니다.** computeMonthlySpendingComposition이
    // 「목표선의 밑값으로 calculatedTargetSpending을 써라」를 이 플래그로 읽기 때문에
    // (MonthlySpendingComposition.ts의 planBase) 지표 계산 안에서만 세우는 합성 입력이며,
    // 이 함수 밖으로 나가지 않는다 — 시뮬레이션도 저장도 하지 않는다.
    //
    // 그 전략 자체는 오늘 제품에서 도달 불가한 내부 전용이지만(SpendingStrategy 주석),
    // 여기서 재는 「지속가능 생활비」는 'target' 계획의 지표다. 둘을 같은 것으로 읽고 이
    // 줄을 지우면 모든 계획의 지표가 목표 금액으로 되돌아간다.
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
  // 사적연금 인출은 고정소득이 아니다. 이 지표의 목적은 "자산 매도·인출분을 제외하고
  // 고정소득이 목표를 얼마나 덮는가"인데(SimulationEngine의 은퇴점수 오버라이드 주석 참고),
  // 연금계좌 인출은 일반자산 매도와 경제적 실질이 같고 세제만 다르다. 일반자산 매도는
  // 빼면서 연금계좌 인출만 넣으면 같은 성격의 두 흐름을 다르게 세는 셈이다.
  //
  // 국민연금·배당·기타소득은 남긴다 — 종신 지급이거나 원금을 유지한 채 나오는 흐름이라
  // 계좌가 비어 멈추지 않는다. fireAge 판정도 같은 기준을 쓴다.
  const averageMonthlyIncome = average(
    retirementYears.map((row) => (row.totalIncome - row.privatePensionIncome) / 12)
  );
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
