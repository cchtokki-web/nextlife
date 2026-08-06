import { SpendingStrategy } from '../../entities/types';

// 엔진은 'target' 전략에서도 findMaxSustainableValue로 "월 얼마까지 쓸 수 있는가"를 항상
// 계산해 result.calculatedTargetSpending에 담아 둔다(SimulationEngine.run). 그런데 화면은
// 그 값을 max_sustainable 전략일 때만 보여줬다(DashboardSection의 배너 조건).
//
// 그 결과 고정 생활비로 계획한 사용자는 두 방향 모두에서 침묵을 겪었다:
//   - 상속 목표가 0원인데 기대수명 시점에 수억이 남는다 (덜 쓰고 있다)
//   - 자산이 중간에 고갈되는데 목표 생활비는 그대로다 (더 쓰고 있다)
//
// 이 함수는 이미 계산된 그 값을 조언으로 번역한다. 새로운 시뮬레이션을 돌리지 않는다.
export type SustainableSpendingAdvice =
  | {
      // 목표보다 더 쓸 수 있다. difference = 늘릴 수 있는 월 금액.
      kind: 'can_spend_more';
      sustainableMonthly: number;
      currentMonthly: number;
      difference: number;
    }
  | {
      // 목표가 지속 불가능하다. difference = 줄여야 하는 월 금액.
      kind: 'overspending';
      sustainableMonthly: number;
      currentMonthly: number;
      difference: number;
    };

// 조언을 시작하는 비율 경계.
//
// 임계값이 없으면 이진탐색(findMaxSustainableValue는 30회 반복해 수렴한다)의 마지막
// 자릿수 차이만으로 배너가 떴다 사라진다.
//
// 비대칭인 이유: 과소비는 자산 고갈로 직결되므로 더 민감하게 잡고, 절약은 "여유를 두고
// 싶다"는 정당한 선택이 섞여 있으므로 더 관대하게 잡는다.
const CAN_SPEND_MORE_RATIO = 1.1; // 지속가능액이 목표의 110%를 넘을 때
const OVERSPENDING_RATIO = 0.95; // 지속가능액이 목표의 95%에 못 미칠 때

export function computeSustainableSpendingAdvice(
  // SimulationEngine이 `params.spendingStrategy || 'target'`으로 폴백하는 것과 같은 규칙으로
  // undefined를 다룬다.
  spendingStrategy: SpendingStrategy | undefined,
  targetMonthlySpending: number,
  calculatedTargetSpending: number | undefined
): SustainableSpendingAdvice | null {
  const strategy = spendingStrategy || 'target';

  // max_sustainable: 이 값이 이미 실제 생활비로 적용된 상태라 제안할 것이 없다.
  //   기존 "최대 고정 생활비 산출 완료" 배너가 그 사실을 이미 알린다.
  // dividend_only: 목표 생활비를 쓰지 않고 그달 소득만큼만 쓰므로 목표와의 비교가
  //   성립하지 않는다.
  if (strategy !== 'target') return null;

  // 이진탐색이 0으로 수렴한 계획(어떤 생활비로도 목표를 만족하지 못함)에서 "월 0원까지 쓸 수
  // 있습니다"는 조언이 아니라 소음이다. 그 상황은 자산 고갈 경고가 이미 담당한다.
  if (calculatedTargetSpending === undefined || calculatedTargetSpending <= 0) return null;
  if (targetMonthlySpending <= 0) return null;

  // 비율을 곱셈(current * 1.1)이 아니라 나눗셈으로 구한다. 곱셈은 경계값에서 부동소수
  // 오차가 한쪽으로 쏠려(1000000 * 0.95 > 950000) 정확히 임계값인 입력이 임계값을 넘은
  // 것으로 판정된다.
  const ratio = calculatedTargetSpending / targetMonthlySpending;

  if (ratio > CAN_SPEND_MORE_RATIO) {
    return {
      kind: 'can_spend_more',
      sustainableMonthly: calculatedTargetSpending,
      currentMonthly: targetMonthlySpending,
      difference: calculatedTargetSpending - targetMonthlySpending,
    };
  }

  if (ratio < OVERSPENDING_RATIO) {
    return {
      kind: 'overspending',
      sustainableMonthly: calculatedTargetSpending,
      currentMonthly: targetMonthlySpending,
      difference: targetMonthlySpending - calculatedTargetSpending,
    };
  }

  return null;
}
