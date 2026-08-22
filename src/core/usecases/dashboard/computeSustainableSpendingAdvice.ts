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
    }
  | {
      // 어떤 생활비로도 HARD 생활비 바닥에 닿지 못한다. difference = 월 미달액.
      //
      // 위 둘과 달리 «계획이 겨냥한 금액»이 아니라 사용자가 「반드시 지키기」로 못박은
      // 바닥과 견준 결과다. 그래서 조언(줄이세요/늘리세요)이 아니라 사실 보고에 가깝다.
      kind: 'below_hard_floor';
      sustainableMonthly: number;
      hardFloorMonthly: number;
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
  calculatedTargetSpending: number | undefined,
  // HARD 생활비 목표에서 유도된 월 바닥(SimulationParams.hardSpendingFloor). 없으면 undefined —
  // 그때는 견줄 기준이 없으므로 바닥 판정 자체가 서지 않는다.
  hardSpendingFloor?: number
): SustainableSpendingAdvice | null {
  const strategy = spendingStrategy || 'target';

  // 바닥 미달은 «전략 게이트 앞»에서 판정한다.
  //
  // 아래 두 조언은 「계획이 겨냥한 금액과 견주어 어떻게 조정할까」라서 고정 생활비 계획에서만
  // 뜻이 있지만, 이것은 「어떤 생활비로도 사용자가 못박은 바닥에 닿지 못한다」는 탐색 결과
  // 자체의 성질이라 전략과 무관하게 참이다. 특히 max_sustainable에서는 탐색값이 곧 실제
  // 생활비가 되므로, 여기서 침묵하면 바닥 미달을 말할 자리가 사라진다.
  //
  // 엔진은 이 비교를 하지 못한다. 탐색이 정직하려면 바닥을 떼고 돌아야 하고
  // (SimulationEngine.sustainabilityTrialParams), 그래서 바닥과의 대조는 탐색이 끝난 뒤
  // 결과와 params를 «둘 다» 보는 이 자리의 몫이다.
  if (calculatedTargetSpending !== undefined
    && hardSpendingFloor !== undefined
    && hardSpendingFloor > 0
    && calculatedTargetSpending < hardSpendingFloor) {
    // 탐색이 0으로 수렴한 계획에서도 말한다. 아래 can_spend_more가 0을 침묵으로 처리하는 것과
    // 다른 이유다 — 저쪽은 「월 0원까지 쓸 수 있습니다」라는 무의미한 권유가 되지만, 이쪽은
    // HARD 제약이 100% 미달이라는 가장 강한 사실이고 미달액(=바닥 전액)도 지어낸 값이 아니다.
    return {
      kind: 'below_hard_floor',
      sustainableMonthly: calculatedTargetSpending,
      hardFloorMonthly: hardSpendingFloor,
      difference: hardSpendingFloor - calculatedTargetSpending,
    };
  }

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
