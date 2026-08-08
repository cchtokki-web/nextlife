import { SimulationParams, SimulationResult } from '../../entities/types';
import { computeMonthlySpendingComposition } from '../MonthlySpendingComposition';

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

// "현재 계획을 유지하면 얼마가 모자라고, 그걸 메우려면 얼마가 필요한가"를 집계한다.
//
// 새 시뮬레이션을 돌리지 않는다. computeMonthlySpendingComposition이 이미 연도별로 계산해 둔
// shortfall/targetMonthly를 읽을 뿐이다 — 물가·가구 규모 계수·의료비 규칙을 여기서 다시
// 유도하면 화면의 생활비 재원 구성 차트와 반드시 어긋난다.
export function computeShortfallSummary(
  params: SimulationParams,
  result: SimulationResult
): ShortfallSummary | null {
  const composition = computeMonthlySpendingComposition(result.yearlyResults, params, result);
  const shortfallYears = composition.filter((row) => row.shortfall > 0);
  if (shortfallYears.length === 0) return null;

  const { currentAge } = params.userProfile;
  const inflationRate = params.inflationRate ?? 2;
  const isNominal = params.inflationMode === 'nominal';

  const totalShortfallInTodayValue = shortfallYears.reduce((sum, row) => {
    const annual = row.shortfall * 12;
    // 명목가치 계획의 미래 금액은 물가만큼 부풀려져 있다. 그대로 더하면 "지금 얼마를
    // 준비해야 하는가"를 크게 과장한다. 실질가치 계획은 이미 현재 구매력이라 손대지 않는다.
    if (!isNominal) return sum + annual;
    return sum + annual / Math.pow(1 + inflationRate / 100, row.age - currentAge);
  }, 0);

  const totalMonthlyShortfall = shortfallYears.reduce((sum, row) => sum + row.shortfall, 0);

  return {
    shortfallYears: shortfallYears.length,
    firstShortfallAge: shortfallYears[0].age,
    lastShortfallAge: shortfallYears[shortfallYears.length - 1].age,
    averageMonthlyShortfall: Math.round(totalMonthlyShortfall / shortfallYears.length),
    totalShortfallInTodayValue: Math.round(totalShortfallInTodayValue),
  };
}
