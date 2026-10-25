import { SimulationParams, SimulationResult } from '../../entities/types';
import { describeSpendingCurve, SpendingCurveSegment } from '../spending/spendingCurve';
import { resolveStrategy } from '../strategy/compileStrategy';

// 「평생 소비 최적화」의 결과를 사용자 문장으로 옮기기 위한 재료.
//
// 엔진은 이미 목표 잔여자산을 남기면서 쓸 수 있는 최대 기준액을 역산해
// result.calculatedTargetSpending에 담아 둔다(SimulationEngine.findMaxSustainable). 이 함수는
// **새 시뮬레이션을 돌리지 않고** 그 값을 연령 구간으로 펼치고 경고 조건을 판정한다
// (computeSustainableSpendingAdvice와 같은 방침).
export interface LifetimeSpendingPlan {
  // 곡선의 기준액(배수 1.0). 구간이 하나뿐이면 이 값이 곧 매달 쓸 금액이다.
  baseMonthly: number;
  // 연령 구간별 금액. 곡선이 없으면 빈 배열이다 — 나열할 구간이 없다는 뜻이지 오류가 아니다.
  segments: SpendingCurveSegment[];
  // 목표 잔여자산(엔진 하한선). 없으면 undefined.
  assetFloor: number | undefined;
  // 사용자가 정한 최소 생활비에 못 미치는 구간이 있으면 그 최저 금액. 없으면 undefined.
  //
  // 기준액이 아니라 **구간 최저액**을 본다: 활동기 집중형에서 60대는 넉넉해도 80대가
  // 최소선 아래로 내려갈 수 있고, 사용자가 걱정하는 것은 바로 그 구간이다.
  belowMinimum: { minMonthlySpending: number; lowestMonthly: number } | undefined;
}

export function computeLifetimeSpendingPlan(
  params: SimulationParams,
  result: SimulationResult
): LifetimeSpendingPlan | null {
  // 이 모드에서만 의미가 있다. 다른 전략에서는 인출액을 목표 생활비나 배당액이 정하므로
  // "역산된 금액"이라는 개념 자체가 없다.
  if ((params.spendingStrategy ?? 'target') !== 'max_sustainable') return null;

  const baseMonthly = result.calculatedTargetSpending;
  // 이진탐색이 0으로 수렴한 계획(어떤 생활비로도 목표를 만족하지 못함)에서 "월 0원까지 쓸 수
  // 있습니다"는 조언이 아니라 소음이다. 그 상황은 자산 고갈 경고가 이미 담당한다.
  if (baseMonthly === undefined || baseMonthly <= 0) return null;

  const { retirementAge, expectancy } = params.userProfile;
  const segments = describeSpendingCurve(params.spendingCurve, baseMonthly, retirementAge, expectancy);

  const minMonthlySpending = resolveStrategy(params).minMonthlySpending;
  const lowestMonthly = segments.length > 0
    ? Math.min(...segments.map((s) => s.monthlyAmount))
    : baseMonthly;

  return {
    baseMonthly,
    segments,
    assetFloor: params.assetFloor,
    belowMinimum:
      minMonthlySpending !== undefined && minMonthlySpending > 0 && lowestMonthly < minMonthlySpending
        ? { minMonthlySpending, lowestMonthly }
        : undefined,
  };
}
