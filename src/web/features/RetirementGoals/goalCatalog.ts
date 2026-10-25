import type { HardConstraintFailureCode } from '../../../core/evaluation/GoalEvaluationEngine';
import {
  RETIREMENT_GOAL_LABELS,
  type RetirementGoalConstraintType,
  type RetirementGoalType,
} from '../../../core/entities/retirementGoal';

export interface RetirementGoalDefinition {
  type: RetirementGoalType;
  label: string;
  description: string;
  defaultConstraintType: RetirementGoalConstraintType;
  target?: {
    label: string;
    unit: 'age' | 'currency';
    /**
     * 금액을 «비워 둔 채로도» 이 목표가 성립하는가.
     *
     * 기본은 필수다 — 금액을 묻는 목표는 대개 그 금액이 없으면 기준이 무너진다. 상속이
     * 그렇다: 확정 금액이 없으면 `terminalAssetGoalOf`가 `targetBequest ?? 0`으로 떨어져
     * 목표액이 0이 된다. 그래서 RetirementInputFlow가 「목표값을 입력해 주세요」로 막는다.
     *
     * 「자산 성장」만 다르다. 금액이 없어도 잴 기준이 «자기 안에» 있다 —
     * `assetGrowthEvaluation`이 기말자산을 «은퇴 시점 자산»과 비교한다. 그러니 금액을
     * 필수로 만들면, 지금까지 금액 없이 잘 굴러가던 계획(저장된 시나리오 포함)이
     * 입력칸이 생겼다는 이유만으로 분석 자체를 거부당한다.
     *
     * **비운 상태가 곧 종전 동작이다.** 미확정 금액은 `confirmedTargetValue`에서 걸러지므로
     * 화면이 입력칸을 더해도 계산은 달라지지 않는다. 달라지는 것은 사용자가 금액을
     * «확정한» 경우뿐이다.
     */
    optional?: true;
  };
}

export const RETIREMENT_GOAL_CATALOG: readonly RetirementGoalDefinition[] = [
  {
    type: 'LIVING_EXPENSE_STABILITY', label: RETIREMENT_GOAL_LABELS.LIVING_EXPENSE_STABILITY,
    description: '원하는 생활비를 꾸준히 유지해요.', defaultConstraintType: 'SOFT',
    target: { label: '목표 월 생활비', unit: 'currency' },
  },
  {
    type: 'EARLY_RETIREMENT', label: RETIREMENT_GOAL_LABELS.EARLY_RETIREMENT,
    description: '희망하는 나이에 일을 마쳐요.', defaultConstraintType: 'HARD',
    target: { label: '희망 은퇴 나이', unit: 'age' },
  },
  {
    type: 'ASSET_SURVIVAL', label: RETIREMENT_GOAL_LABELS.ASSET_SURVIVAL,
    description: '기대수명까지 자산을 지켜요.', defaultConstraintType: 'HARD',
  },
  {
    type: 'COMFORTABLE_SPENDING', label: RETIREMENT_GOAL_LABELS.COMFORTABLE_SPENDING,
    description: '여행과 취미를 위한 여유를 확보해요.', defaultConstraintType: 'SOFT',
    target: { label: '희망 월 생활비', unit: 'currency' },
  },
  {
    // 씨앗 강도가 SOFT인 이유: 이 목표에는 달성·미달을 잴 정량 기준이 없어 화면이 HARD를
    // 고르지 못하게 막는다(RetirementGoalSelector). 기본값만 HARD로 남겨 두면 사용자가
    // 고를 수 없는 값이 «자동으로» 박혀, 계산이 지키지 않는 조건을 못박은 것으로 읽힌다 —
    // known-issues 1번이 정확히 그 상태였다. 나머지 판정 밖 목표 셋은 이미 SOFT다.
    type: 'HOUSING_STABILITY', label: RETIREMENT_GOAL_LABELS.HOUSING_STABILITY,
    description: '노후의 안정적인 주거를 우선해요.', defaultConstraintType: 'SOFT',
  },
  {
    type: 'PENSION_OPTIMIZATION', label: RETIREMENT_GOAL_LABELS.PENSION_OPTIMIZATION,
    description: '공적·사적연금의 활용도를 높여요.', defaultConstraintType: 'SOFT',
  },
  {
    type: 'TAX_OPTIMIZATION', label: RETIREMENT_GOAL_LABELS.TAX_OPTIMIZATION,
    description: '은퇴 기간의 세금 부담을 줄여요.', defaultConstraintType: 'SOFT',
  },
  {
    type: 'RISK_REDUCTION', label: RETIREMENT_GOAL_LABELS.RISK_REDUCTION,
    description: '시장 변동에 덜 흔들리는 계획을 원해요.', defaultConstraintType: 'SOFT',
  },
  {
    type: 'INHERITANCE', label: RETIREMENT_GOAL_LABELS.INHERITANCE,
    description: '가족에게 남길 최소 자산을 지켜요.', defaultConstraintType: 'HARD',
    target: { label: '남기고 싶은 최소 자산', unit: 'currency' },
  },
  {
    // 상속과 «같은 양»(기말자산)을 재지만 뜻이 다르다 — 남기는 것이 아니라 지키는 것이다.
    // 라벨의 동사가 그 차이를 진다.
    //
    // 씨앗을 깔지 않는 이유: 이 목표의 자연스러운 기준선은 「은퇴 시점 자산」인데 그 값은
    // 시뮬레이션을 돌려야 나오고, 화면은 갖고 있지 않다. 대신 현재 총자산 같은 값을 깔면
    // 사용자가 «목표로 말한 적 없는» 숫자가 카드에 찍힌다 — known-issues 2번이 그것이다.
    // 비워 두면 종전대로 은퇴 시점 자산 대비 성장 여부로 평가한다(optional 주석).
    type: 'ASSET_GROWTH', label: RETIREMENT_GOAL_LABELS.ASSET_GROWTH,
    description: '은퇴 후에도 자산의 성장 가능성을 추구해요.', defaultConstraintType: 'SOFT',
    target: { label: '유지하고 싶은 최소 자산', unit: 'currency', optional: true },
  },
];

export function retirementGoalDefinition(type: RetirementGoalType): RetirementGoalDefinition {
  return RETIREMENT_GOAL_CATALOG.find((goal) => goal.type === type)!;
}

/**
 * 후보를 막은 필수(HARD) 조건의 표시 이름. **여기가 유일한 출처다** — 추천 카드와 PDF가
 * 각각 같은 표를 들고 있었고, 코드가 하나 늘면 한쪽만 갱신돼 다른 쪽은 원문 코드를
 * (`HARD_MINIMUM_ENDING_ASSETS`) 그대로 노출했다.
 */
const HARD_CONSTRAINT_LABELS: Record<HardConstraintFailureCode, string> = {
  HARD_RETIREMENT_AGE: '희망 은퇴 나이',
  HARD_SPENDING_SHORTFALL: '목표 생활비 유지',
  HARD_ASSET_SURVIVAL: '자산 고갈 방지',
  HARD_MINIMUM_ENDING_ASSETS: '최소 기말자산',
  HARD_UNSPECIFIED: '사유가 기록되지 않은 필수 조건',
};

/** 모르는 코드는 원문 그대로 보여 준다 — 침묵하면 「막힌 이유가 없다」로 읽힌다. */
export function hardConstraintLabel(code: string): string {
  return HARD_CONSTRAINT_LABELS[code as HardConstraintFailureCode] ?? code;
}
