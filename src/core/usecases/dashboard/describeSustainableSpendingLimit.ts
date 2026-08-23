import type { SustainableSpendingFloorOverride } from '../../entities/types';
import { RETIREMENT_GOAL_CONSTRAINT_LABELS } from '../../entities/retirementGoal';
import { SHORTFALL_EPSILON_MONTHLY } from '../metrics/SimulationMetricsCalculator';
import { OVERSPENDING_RATIO } from './computeSustainableSpendingAdvice';

/**
 * 「지속가능 생활비」가 HARD 생활비 바닥을 존중해 다시 계산된 계획의 **고지문**.
 *
 * 이 파일이 있는 이유는 숫자가 아니라 «얼굴»이다. 엔진은 이제 바닥을 존중해 지급하므로
 * 같은 픽스처에서 월 1,181,250 → 3,446,597로 오르고 기말자산은 3.35억 → 5원이 된다.
 * 숫자만 바꾸고 화면을 그대로 두면 **3.35억이 남던 계획과 0원 계획이 같은 얼굴로 보인다.**
 * 「월 3,446,597원」을 권장액으로 읽은 사용자는 자산을 소진하는 계획을 세우게 된다.
 *
 * 스펙(「표시 요구 — 네 가지를 반드시 밝힌다」)이 요구하는 넷을 각각 «한 문장»으로 낸다:
 *   1. 왜 인출이 늘었는가            → reason
 *   2. 기말 잔여자산이 0이거나 매우 낮다 → terminalAssets
 *   3. 권장액이 아니라 한계값이다      → limit
 *   4. 고갈 여유가 매우 작다           → depletionRisk
 *
 * **화면과 PDF가 이 함수의 문장을 그대로 찍는다.** describeGoalConflict·explainGoalShortfall과
 * 같은 방식이다 — 문구를 두 벌로 두면 반드시 갈라지고, 리포트는 화면보다 오래 남아 그대로
 * 인용된다.
 */
export interface SustainableSpendingLimitNotice {
  title: string;
  /** 1. HARD 생활비를 우선한 결과 인출이 늘었다는 사실과 그 폭. 언제나 있다. */
  reason: string;
  /** 3. 「권장 생활비가 아니라 한계 수준」. 언제나 있다 — 이 계획의 성격 자체이므로 조건이 없다. */
  limit: string;
  /** 2. 기말 잔여자산 경고. 잔여자산이 표시상 0과 구별되지 않을 때만. */
  terminalAssets?: string;
  /** 4. 고갈 여유 경고. 바닥이 이 계획의 한계에 닿았거나 넘었을 때만. */
  depletionRisk?: string;
}

export interface SustainableSpendingLimitInput {
  /**
   * 탐색값과 전달 계획이 갈라진 기록(SimulationResult.sustainableSpendingOverride).
   * **없으면 고지 자체가 서지 않는다** — 바닥이 구속하지 않은 계획은 종전과 한 발도 다르지
   * 않고, 달라지지 않은 것을 설명하면 소음만 는다.
   */
  override: SustainableSpendingFloorOverride | undefined;
  /** 기대수명 시점 잔여자산. 엔진 산출값이라 원화가 아니라 표시 통화 기준이다(types.ts). */
  endingAssets: number;
  /** 기대수명 전에 자산이 바닥나는 나이. 바닥나지 않으면 null. */
  depletionAge: number | null;
  expectancy: number;
  /** 표시 통화 서식기. 화면·PDF가 다른 금액에 쓰는 것과 «같은» 함수를 넘긴다. */
  formatValue: (value: number) => string;
}

/**
 * 「기말 잔여자산이 0이거나 매우 낮다」의 경계.
 *
 * **새 기준을 만들지 않는다**(AGENTS.md). 이 저장소에 이미 있는 두 값이 같은 자리를 가리켜
 * 그것을 그대로 쓴다:
 *
 *   · `SHORTFALL_EPSILON_MONTHLY`(1만원)는 이 저장소의 «유일한» 금액 허용오차다. 목표 달성
 *     판정(GoalEvaluationEngine)·몬테카를로·부족 요약이 모두 「이 이하는 없는 것으로 친다」에
 *     이 값을 쓴다.
 *   · `formatManwon`의 반올림 단위도 1만원이다. 그래서 이 선 아래의 잔여자산은 화면과
 *     리포트에 「0만원」으로 **찍힌다** — 0으로 끝나는 계획과 표시상 구별되지 않는다.
 *     실측 픽스처의 기말자산 5원이 정확히 여기 해당한다.
 *
 * 이 선보다 «넓은» 「매우 낮음」을 세울 근거는 코드베이스에 없다. 적정 상속 자산 기준
 * (월 목표생활비 × `appropriateBequestMonths`)이 후보였지만 그것은 `utilityConfig`에 매여
 * 있고, 화면과 리포트가 서로 다른 `utilityConfig`를 넘기는 기존 결함이 남아 있어 같은
 * 계획의 두 문서가 다른 경고를 낼 수 있다. 근거 없이 넓히는 대신 가장 좁은 선을 고른다.
 *
 * 표시 통화가 원화가 아니면 이 선은 «더 관대해진다»($10,000 ≈ 1,400만원). 틀리는 방향이
 * 경고를 더 내는 쪽이라 침묵으로 놓치지는 않는다.
 */
const LOW_TERMINAL_ASSETS = SHORTFALL_EPSILON_MONTHLY;

const TITLE = `「${RETIREMENT_GOAL_CONSTRAINT_LABELS.HARD}」로 정한 생활비를 우선한 한계 계획입니다`;

export function describeSustainableSpendingLimit(
  input: SustainableSpendingLimitInput
): SustainableSpendingLimitNotice | undefined {
  const { override, endingAssets, depletionAge, expectancy, formatValue } = input;
  if (override === undefined) return undefined;

  const hard = RETIREMENT_GOAL_CONSTRAINT_LABELS.HARD;
  const floor = formatValue(override.hardSpendingFloor);
  const honoring = formatValue(override.floorHonoringMonthly);

  // 1. 왜 인출이 늘었는가. 「올랐습니다」는 언제나 참이다 — 이 기록은 바닥이 탐색값을
  //    «넘을 때만» 만들어지고(findMaxSustainable), 전달값은 max(바닥, 바닥 존중 용량)이라
  //    반드시 탐색값보다 크다.
  //
  //    깨진 선호를 이름으로 밝힌다. 「우선했습니다」만 적으면 무엇을 대가로 치렀는지가
  //    사라지고, 사용자는 늘어난 세금(실측 890만 → 4,505만)을 계산 오류로 읽는다.
  const reason = `설정한 생활비를 반드시 충족하도록 인출한 결과, 지속 가능한 생활비가 `
    + `월 ${formatValue(override.preferenceRespectingMonthly)}에서 `
    + `월 ${formatValue(override.deliveredMonthly)}으로 올랐습니다. `
    + `「${hard}」로 정한 월 ${floor}이 세제 최적화·계좌 인출 순서·월 인출 목표보다 `
    + `우선하기 때문입니다.`;

  // 3. 승인된 예시 문구를 그대로 쓴다(스펙). 조건을 달지 않는다 — 이 계획의 금액은 언제나
  //    「버틸 수 있는 한계」이지 권장액이 아니고, 그 성격은 잔여자산이 얼마든 변하지 않는다.
  const limit = '이 금액은 권장 생활비가 아니라 자산을 거의 소진하는 한계 수준입니다.';

  const notice: SustainableSpendingLimitNotice = { title: TITLE, reason, limit };

  // 2. 잔여자산이 표시상 0과 구별되지 않는 계획. 스펙의 예시 문장이 이 자리다.
  if (endingAssets < LOW_TERMINAL_ASSETS) {
    notice.terminalAssets = `기대수명 ${expectancy}세 시점 잔여자산은 `
      + `${formatValue(Math.max(0, endingAssets))}입니다. `
      + '예상치 못한 지출이나 상속에 쓸 여유가 남지 않습니다.';
  }

  // 4. 고갈 여유. 두 방향을 한 조건으로 묶는다 — 이미 바닥난 계획(바닥 > 한계)과 아직
  //    버티지만 코앞인 계획(바닥 ≈ 한계)은 사용자에게 같은 위험이다.
  //
  //    경계는 OVERSPENDING_RATIO(95%)다. 새로 정하지 않고 같은 도메인에서 이미 쓰는 폭을
  //    가져온다 — 그쪽도 「지속 가능한 한도 대 요구 생활비」의 비율이고, 그 5%를 「지속하기
  //    어렵다」로 부르기로 이미 정해 두었다. 바닥 > 한계면 비율이 1을 넘으므로 이 조건이
  //    고갈 계획을 자동으로 포함한다.
  const marginTight = override.floorHonoringMonthly <= 0
    || override.hardSpendingFloor >= OVERSPENDING_RATIO * override.floorHonoringMonthly;
  if (marginTight) {
    notice.depletionRisk = depletionAge !== null
      ? `자산이 ${depletionAge}세에 바닥나 기대수명 ${expectancy}세까지 버티지 못합니다. `
        + `「${hard}」로 정한 월 ${floor}이 이 계획이 감당하는 한계(월 ${honoring})를 `
        + '넘기 때문입니다.'
      : `「${hard}」로 정한 월 ${floor}이 이 계획이 감당하는 한계(월 ${honoring})에 `
        + '거의 닿아 있습니다. 수익률이 조금만 낮아져도 기대수명 전에 자산이 바닥납니다.';
  }

  return notice;
}
