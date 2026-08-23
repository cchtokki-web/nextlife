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
/**
 * 지속가능액이 목표의 95%에 못 미칠 때.
 *
 * **내보내는 이유**: describeSustainableSpendingLimit이 「HARD 바닥이 이 계획의 한계에
 * 얼마나 가까운가」를 재는 데 같은 폭을 쓴다. 두 자리가 각자 5%를 적어 두면 한쪽만 바뀌는
 * 날 화면이 「지속하기 어렵다」와 「여유가 있다」를 동시에 말한다. 재는 두 값의 «종류»가
 * 같으므로(지속 가능한 한도 대 요구 생활비) 폭도 하나여야 한다.
 */
export const OVERSPENDING_RATIO = 0.95;

export function computeSustainableSpendingAdvice(
  // SimulationEngine이 `params.spendingStrategy || 'target'`으로 폴백하는 것과 같은 규칙으로
  // undefined를 다룬다.
  spendingStrategy: SpendingStrategy | undefined,
  targetMonthlySpending: number,
  calculatedTargetSpending: number | undefined,
): SustainableSpendingAdvice | null {
  const strategy = spendingStrategy || 'target';

  // **이 함수는 'target' 계획에만 조언한다.**
  //
  // max_sustainable: 탐색값이 «곧» 이 계획의 생활비이므로 「더 쓰세요/덜 쓰세요」라고 할
  //   대상이 없다. 이 계획에 대해 말해야 할 것은 조언이 아니라 «그 금액의 성격»이고
  //   (권장액이 아니라 한계값, 기말자산 0, 고갈 여유), 그것은 원장과 탐색 기록을 함께 보는
  //   describeSustainableSpendingLimit의 몫이다.
  //
  //   예전에는 여기에 `below_hard_floor`가 있어 「탐색값이 HARD 바닥에 못 미친다」를 알렸다.
  //   지금은 엔진이 그 상태를 만들지 않는다 — findMaxSustainable이 전달하는 생활비는
  //   max(바닥, 바닥 존중 용량)이라 «언제나» 바닥 이상이다. 도달할 수 없는 분기를 남겨 두면
  //   그것을 지키는 테스트도 아무것도 지키지 않게 되므로 함께 걷어냈다.
  // target: 탐색값은 참고치일 뿐 계획이 쓰는 금액이 아니다. 엔진은 1단계에서 선호를 깨면서
  //   해마다 바닥을 실제로 채우므로(원장의 actualSpending), 탐색값을 바닥과 견주면 같은
  //   실행의 원장이 반증하는 말을 하게 된다 — 「월 131만원 부족」인데 원장에는 연 3,000만원이
  //   찍혀 있는 식이다. 이 전략의 바닥 미달은 «원장»으로 재야 하고, 그것은 task 4의
  //   diagnostics(unmetHardSpending·brokenPreferences·blockedWithdrawalReason)의 몫이다.
  // dividend_only: 목표 생활비를 쓰지 않고 그달 소득만큼만 쓰므로 어느 비교도 성립하지 않는다.
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
