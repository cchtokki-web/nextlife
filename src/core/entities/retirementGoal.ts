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
 * 목표의 표시 이름. **여기가 유일한 출처다** — 목표 선택 화면·추천 카드·PDF·충돌 문구가
 * 같은 말을 쓴다.
 *
 * 강도 라벨 바로 옆에 두는 이유: 예전에는 이름이 web의 goalCatalog에만 있어서,
 * core가 목표 이름을 말해야 할 때(describeGoalConflict) core → web import가 생겼다.
 * 계산 계층이 화면 계층을 향하는 그 방향은 AGENTS.md가 금지한다. 이름은 도메인의 것이고
 * 설명문·입력 라벨 같은 «화면의» 메타데이터만 goalCatalog에 남는다.
 */
export const RETIREMENT_GOAL_LABELS: Record<RetirementGoalType, string> = {
  LIVING_EXPENSE_STABILITY: '생활비 안정',
  EARLY_RETIREMENT: '빠른 은퇴',
  ASSET_SURVIVAL: '자산 고갈 방지',
  COMFORTABLE_SPENDING: '여유 있는 소비',
  HOUSING_STABILITY: '주거 안정',
  PENSION_OPTIMIZATION: '연금 최대 활용',
  TAX_OPTIMIZATION: '세금 최소화',
  RISK_REDUCTION: '투자 위험 최소화',
  INHERITANCE: '상속 자산 확보',
  ASSET_GROWTH: '자산 성장',
};

/**
 * 생활비에 «관한» 목표 유형. 유형은 「무엇에 관한 목표인가」만 말하고, 얼마나 구속력이
 * 있는지는 constraintType이 따로 정한다(스펙 「유형과 강도를 분리한다」).
 */
export const SPENDING_GOAL_TYPES = [
  'LIVING_EXPENSE_STABILITY',
  'COMFORTABLE_SPENDING',
] as const satisfies readonly RetirementGoalType[];

/**
 * 위 배열이 «유형 수준에서» 말하는 것. 배열에서 유도하므로 둘은 갈라질 수 없다.
 *
 * 필요한 이유는 hardSpendingFloorTarget의 반환값(number | undefined)에 「어느 유형이
 * 통과했는가」가 실리지 않기 때문이다. 그 사실을 호출부가 다시 쓰면 규칙이 두 벌이 되고,
 * 여기서 유도해 두면 생활비 유형이 하나 늘 때 그 사실이 타입을 타고 호출부까지 흘러간다.
 */
export type SpendingGoalType = (typeof SPENDING_GOAL_TYPES)[number];

/**
 * 유형이 생활비에 관한 것인가. `includes` 대신 이 술어를 쓰면 `goal.type`이 실제로 좁혀져,
 * 「생활비 목표만 담는다」는 약속을 tsc가 검사할 수 있게 된다.
 */
export function isSpendingGoalType(type: RetirementGoalType): type is SpendingGoalType {
  return SPENDING_GOAL_TYPES.some((spendingType) => spendingType === type);
}

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
  if (!isSpendingGoalType(goal.type)) return undefined;
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
