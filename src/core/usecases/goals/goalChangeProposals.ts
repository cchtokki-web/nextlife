import type { SimulationParams } from '../../entities/types';
import { normalizeRetirementGoals } from '../../entities/retirementGoal';
import { applyRetirementGoals } from './retirementGoalAdapter';

export interface GoalChangeProposal {
  id: string;
  kind: 'retirement' | 'spending';
  before: number;
  after: number;
  params: SimulationParams;
}

/** 선택된 목표만 바꾼 별도 비교안. 미확정 금액을 사용자 확정값으로 바꾸지 않는다. */
export function generateGoalChangeProposals(params: SimulationParams): GoalChangeProposal[] {
  const goals = normalizeRetirementGoals(params.retirementGoals ?? []);
  const result: GoalChangeProposal[] = [];
  const retirement = goals.find((goal) => goal.type === 'EARLY_RETIREMENT');
  if (retirement?.targetValue !== undefined) {
    for (const years of [1, 2]) {
      const after = retirement.targetValue + years;
      if (after > params.userProfile.expectancy || after <= params.userProfile.retirementAge) continue;
      const changed = goals.map((goal) => goal === retirement ? { ...goal, targetValue: after } : goal);
      result.push({ id: `retirement-${after}`, kind: 'retirement', before: retirement.targetValue, after,
        params: applyRetirementGoals(params, changed) });
    }
  }
  const spending = goals.filter((goal) => goal.type === 'LIVING_EXPENSE_STABILITY' || goal.type === 'COMFORTABLE_SPENDING');
  // 두 목표의 최댓값이 기준이므로 하나만 바꾸면 표시와 실제 계획이 달라진다.
  if (spending.length === 1 && spending[0].targetValueSource === 'user' && spending[0].targetValue
    && spending[0].targetValue === params.userProfile.targetMonthlySpending) {
    const goal = spending[0];
    for (const ratio of [0.9, 0.8]) {
      const unit = params.displayCurrency === 'USD' ? 1 : 10000;
      const after = Math.round(goal.targetValue! * ratio / unit) * unit;
      if (after <= 0 || after >= goal.targetValue! || result.some((item) => item.id === `spending-${after}`)) continue;
      const changed = goals.map((item) => item === goal ? { ...item, targetValue: after } : item);
      result.push({ id: `spending-${after}`, kind: 'spending', before: goal.targetValue!, after,
        params: applyRetirementGoals(params, changed) });
    }
  }
  return result;
}
