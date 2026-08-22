export const RETIREMENT_GOAL_TYPES = [
  'LIVING_EXPENSE_STABILITY',
  'EARLY_RETIREMENT',
  'ASSET_SURVIVAL',
  'COMFORTABLE_SPENDING',
  'HOUSING_STABILITY',
  'PENSION_OPTIMIZATION',
  'TAX_OPTIMIZATION',
  'RISK_REDUCTION',
  'INHERITANCE',
  'ASSET_GROWTH',
] as const;

export type RetirementGoalType = (typeof RETIREMENT_GOAL_TYPES)[number];

export type RetirementGoalConstraintType = 'HARD' | 'SOFT';

export interface RetirementGoal {
  type: RetirementGoalType;
  priority: number;
  targetValue?: number;
  constraintType: RetirementGoalConstraintType;
}

export const MAX_RETIREMENT_GOALS = 5;

/**
 * 조건 강도의 표시 이름. **여기가 유일한 출처다** — 목표 선택 화면·대시보드 안내·추천 카드·
 * PDF가 같은 말을 쓴다. 저장되는 값은 언제나 `'HARD' | 'SOFT'`이고, 사람이 읽는 자리에서만
 * 이 이름으로 바꾼다.
 *
 * 한 곳에 두는 이유는 라벨 자체가 계약이기 때문이다. 화면이 「반드시 지키기」라 부른 것을
 * 다른 화면이 「필수」라 부르면, 사용자는 자기가 못박은 조건이 어디서 깨졌는지 추적할 수 없다.
 */
export const RETIREMENT_GOAL_CONSTRAINT_LABELS: Record<RetirementGoalConstraintType, string> = {
  HARD: '반드시 지키기',
  SOFT: '가능하면 달성',
};

/**
 * 생활비에 «관한» 목표 유형. 유형은 「무엇에 관한 목표인가」만 말하고, 얼마나 구속력이
 * 있는지는 constraintType이 따로 정한다(스펙 「유형과 강도를 분리한다」).
 */
export const SPENDING_GOAL_TYPES: readonly RetirementGoalType[] = [
  'LIVING_EXPENSE_STABILITY',
  'COMFORTABLE_SPENDING',
];

/**
 * 이 목표가 세우는 런타임 생활비 바닥(월 금액). 바닥을 세우지 않는 목표는 undefined다.
 *
 * **단일 출처인 이유.** 같은 규칙을 두 곳이 본다 — compileStrategy는 이 값들의 max로
 * `params.hardSpendingFloor`를 유도하고(엔진이 인출로 «채우는» 금액), GoalEvaluationEngine은
 * 결과가 그 바닥에 닿았는지 «판정»한다. 두 벌로 갈라지면 엔진이 세운 바닥과 평가가 재는
 * 바닥이 어긋나 「반드시 지키기」가 이름만 남는다. retirementAgeHardFailure가 한 곳에 있는
 * 것과 같은 이유다.
 *
 * `targetValue > 0` 가드는 normalizeGoalDrivenParams.firstGoalWithTarget의 것과 같다:
 * 0은 「입력창을 비웠다」이지 「생활비 0원이 목표」가 아니다.
 */
export function hardSpendingFloorTarget(goal: RetirementGoal): number | undefined {
  if (goal.constraintType !== 'HARD') return undefined;
  if (!SPENDING_GOAL_TYPES.includes(goal.type)) return undefined;
  if (goal.targetValue === undefined || !(goal.targetValue > 0)) return undefined;
  return goal.targetValue;
}

function normalizeTargetValue(goal: RetirementGoal): number | undefined {
  if (goal.targetValue === undefined || !Number.isFinite(goal.targetValue)) return undefined;
  if (goal.type === 'EARLY_RETIREMENT') {
    return Math.min(120, Math.max(1, goal.targetValue));
  }
  return Math.max(0, goal.targetValue);
}

export function normalizeRetirementGoals(
  goals: readonly RetirementGoal[],
): RetirementGoal[] {
  const seen = new Set<RetirementGoalType>();

  return [...goals]
    .sort((a, b) => a.priority - b.priority)
    .filter((goal) => {
      if (!RETIREMENT_GOAL_TYPES.includes(goal.type) || seen.has(goal.type)) return false;
      seen.add(goal.type);
      return true;
    })
    .slice(0, MAX_RETIREMENT_GOALS)
    .map((goal, index) => ({
      ...goal,
      priority: index + 1,
      targetValue: normalizeTargetValue(goal),
    }));
}

export function moveRetirementGoal(
  goals: readonly RetirementGoal[],
  type: RetirementGoalType,
  direction: -1 | 1,
): RetirementGoal[] {
  const normalized = normalizeRetirementGoals(goals);
  const from = normalized.findIndex((goal) => goal.type === type);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= normalized.length) return normalized;

  const reordered = [...normalized];
  [reordered[from], reordered[to]] = [reordered[to], reordered[from]];
  return reordered.map((goal, index) => ({ ...goal, priority: index + 1 }));
}
