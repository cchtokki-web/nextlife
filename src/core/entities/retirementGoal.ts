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
