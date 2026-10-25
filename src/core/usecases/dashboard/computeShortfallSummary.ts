import { SimulationParams, SimulationResult } from '../../entities/types';
import type { MonthlySpendingComposition } from '../MonthlySpendingComposition';
import {
  SHORTFALL_EPSILON_MONTHLY,
  SimulationMetricsCalculator,
  type ShortfallYearMetric,
} from '../metrics/SimulationMetricsCalculator';

export interface ShortfallSummary {
  // 목표 생활비를 채우지 못하는 은퇴 후 연도 수.
  shortfallYears: number;
  firstShortfallAge: number;
  lastShortfallAge: number;
  // 부족한 해들의 평균 월 부족액. 분모는 은퇴 기간 전체가 아니라 **부족한 해**다 —
  // 은퇴 초반만 부족한 계획에서 전체로 나누면 실제로 겪는 부족보다 작게 보고된다.
  averageMonthlyShortfall: number;
  // 부족액 총합을 현재 구매력으로 환산한 금액.
  //
  // "수익률이 물가상승률과 같다"는 중립 가정에서의 필요 자산이다. 특정 수익률로 굴렸을 때
  // 필요한 원금이 아니므로, 화면은 반드시 그 가정을 문장으로 밝혀야 한다. 투자자산이 없는
  // 계획에는 기준으로 삼을 수익률 자체가 없어서 이 가정이 가장 정직하다.
  totalShortfallInTodayValue: number;
}

export interface ShortfallReport {
  // **사용자가 입력한 목표 생활비** 대비 부족. 「평생 소비 최적화」가 생활비를 낮춰 잡은
  // 몫이 여기 잡힌다 — 계산상으로는 성공한 계획이지만 사용자가 세운 목표에는 못 미친다.
  goal: ShortfallSummary | null;
  // **계획이 실제로 쓰기로 한 금액** 대비 부족. 계획한 금액조차 못 쓴 해이므로 자산이
  // 정말 모자란 상태다. 두 기준이 같은 계획(고정 목표 생활비)에서는 goal과 동일하다.
  plan: ShortfallSummary | null;
  // 사용자가 입력한 월 목표 생활비(연령대 배수·물가 적용 전의 기준값).
  goalMonthlySpending: number;
  // 이 계획이 실제로 지속 가능한 월 생활비. 엔진이 전략과 무관하게 항상 이진탐색으로
  // 구해 둔 값(SimulationResult.calculatedTargetSpending)이다.
  sustainableMonthlySpending: number;
}

// 월 단위 부족액이 이 값 미만인 해는 부족으로 세지 않는다.
//
// 이진탐색(findMaxSustainable)은 30회 반복으로 수렴하므로 목표와 실제 지출 사이에 늘
// 수천 원의 잔차가 남는다. 그 잔차를 부족으로 세면 「평생 소비 최적화」 계획에서 은퇴 후
// 전 구간이 "부족한 해"가 되고, 금액은 표시 단위(만원) 아래라 화면에 0원으로 찍힌다.
// 리포트에 "부족 생활비 월 평균 0원 / 부족 기간 31년"이 함께 나온 것이 정확히 이 상태였다.
// 임계값을 화면의 표시 단위(1만원, chartFormatters.formatValue)와 맞춰, 화면이 0원이라고
// 말하는 금액은 집계에도 잡히지 않게 한다.
export { SHORTFALL_EPSILON_MONTHLY } from '../metrics/SimulationMetricsCalculator';

const metricsCalculator = new SimulationMetricsCalculator();

// "현재 계획을 유지하면 얼마가 모자라고, 그걸 메우려면 얼마가 필요한가"를 집계한다.
//
// 새 시뮬레이션을 돌리지 않는다. computeMonthlySpendingComposition이 이미 연도별로 계산해 둔
// shortfall/goalShortfall을 읽을 뿐이다 — 물가·의료비 규칙을 여기서 다시
// 유도하면 화면의 생활비 재원 구성 차트와 반드시 어긋난다.
export function computeShortfallSummary(
  params: SimulationParams,
  result: SimulationResult
): ShortfallReport {
  const metrics = metricsCalculator.calculate(params, result);

  return {
    goal: summarizeGoalShortfall(metrics.shortfall.shortfallYears, params),
    plan: summarize(metrics.yearlySpending, (row) => row.shortfall, params),
    goalMonthlySpending: params.userProfile.targetMonthlySpending,
    sustainableMonthlySpending:
      result.calculatedTargetSpending ?? params.userProfile.targetMonthlySpending,
  };
}

function summarizeGoalShortfall(
  shortfallYears: readonly ShortfallYearMetric[],
  params: SimulationParams,
): ShortfallSummary | null {
  if (shortfallYears.length === 0) return null;

  const totalMonthlyShortfall = shortfallYears.reduce(
    (sum, row) => sum + row.monthlyAmount,
    0,
  );
  return {
    shortfallYears: shortfallYears.length,
    firstShortfallAge: shortfallYears[0].age,
    lastShortfallAge: shortfallYears[shortfallYears.length - 1].age,
    averageMonthlyShortfall: Math.round(totalMonthlyShortfall / shortfallYears.length),
    totalShortfallInTodayValue: totalInTodayValue(
      shortfallYears.map((row) => ({ age: row.age, monthlyAmount: row.monthlyAmount })),
      params,
    ),
  };
}

function summarize(
  composition: readonly MonthlySpendingComposition[],
  shortfallOf: (row: MonthlySpendingComposition) => number,
  params: SimulationParams
): ShortfallSummary | null {
  const shortfallYears = composition.filter((row) => shortfallOf(row) >= SHORTFALL_EPSILON_MONTHLY);
  if (shortfallYears.length === 0) return null;

  const totalMonthlyShortfall = shortfallYears.reduce((sum, row) => sum + shortfallOf(row), 0);

  return {
    shortfallYears: shortfallYears.length,
    firstShortfallAge: shortfallYears[0].age,
    lastShortfallAge: shortfallYears[shortfallYears.length - 1].age,
    averageMonthlyShortfall: Math.round(totalMonthlyShortfall / shortfallYears.length),
    totalShortfallInTodayValue: totalInTodayValue(
      shortfallYears.map((row) => ({ age: row.age, monthlyAmount: shortfallOf(row) })),
      params,
    ),
  };
}

function totalInTodayValue(
  shortfalls: readonly { age: number; monthlyAmount: number }[],
  params: SimulationParams,
): number {
  const { currentAge } = params.userProfile;
  const inflationRate = params.inflationRate ?? 2;
  const isNominal = params.inflationMode === 'nominal';
  const total = shortfalls.reduce((sum, row) => {
    const annual = row.monthlyAmount * 12;
    if (!isNominal) return sum + annual;
    return sum + annual / Math.pow(1 + inflationRate / 100, row.age - currentAge);
  }, 0);
  return Math.round(total);
}
