import type { HardConstraintFailureCode } from '../../../core/evaluation/GoalEvaluationEngine';
import type {
  RetirementGoalConstraintType,
  RetirementGoalType,
} from '../../../core/entities/retirementGoal';

export interface RetirementGoalDefinition {
  type: RetirementGoalType;
  label: string;
  description: string;
  defaultConstraintType: RetirementGoalConstraintType;
  target?: {
    label: string;
    unit: 'age' | 'currency';
  };
}

export const RETIREMENT_GOAL_CATALOG: readonly RetirementGoalDefinition[] = [
  {
    type: 'LIVING_EXPENSE_STABILITY', label: '생활비 안정',
    description: '원하는 생활비를 꾸준히 유지해요.', defaultConstraintType: 'SOFT',
    target: { label: '목표 월 생활비', unit: 'currency' },
  },
  {
    type: 'EARLY_RETIREMENT', label: '빠른 은퇴',
    description: '희망하는 나이에 일을 마쳐요.', defaultConstraintType: 'HARD',
    target: { label: '희망 은퇴 나이', unit: 'age' },
  },
  {
    type: 'ASSET_SURVIVAL', label: '자산 고갈 방지',
    description: '기대수명까지 자산을 지켜요.', defaultConstraintType: 'HARD',
  },
  {
    type: 'COMFORTABLE_SPENDING', label: '여유 있는 소비',
    description: '여행과 취미를 위한 여유를 확보해요.', defaultConstraintType: 'SOFT',
    target: { label: '희망 월 생활비', unit: 'currency' },
  },
  {
    type: 'HOUSING_STABILITY', label: '주거 안정',
    description: '노후의 안정적인 주거를 우선해요.', defaultConstraintType: 'HARD',
  },
  {
    type: 'PENSION_OPTIMIZATION', label: '연금 최대 활용',
    description: '공적·사적연금의 활용도를 높여요.', defaultConstraintType: 'SOFT',
  },
  {
    type: 'TAX_OPTIMIZATION', label: '세금 최소화',
    description: '은퇴 기간의 세금 부담을 줄여요.', defaultConstraintType: 'SOFT',
  },
  {
    type: 'RISK_REDUCTION', label: '투자 위험 최소화',
    description: '시장 변동에 덜 흔들리는 계획을 원해요.', defaultConstraintType: 'SOFT',
  },
  {
    type: 'INHERITANCE', label: '상속 자산 확보',
    description: '가족에게 남길 최소 자산을 지켜요.', defaultConstraintType: 'HARD',
    target: { label: '남기고 싶은 최소 자산', unit: 'currency' },
  },
  {
    type: 'ASSET_GROWTH', label: '자산 성장',
    description: '은퇴 후에도 자산의 성장 가능성을 추구해요.', defaultConstraintType: 'SOFT',
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
