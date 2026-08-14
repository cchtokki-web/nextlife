import type { SimulationParams } from '../../entities/types';
import {
  normalizeRetirementGoals,
  type RetirementGoal,
  type RetirementGoalType,
} from '../../entities/retirementGoal';
import { resolveStrategy } from '../strategy/compileStrategy';

export function resolveRetirementGoals(params: SimulationParams): RetirementGoal[] {
  // 기존 시나리오의 은퇴 나이·생활비는 그대로 보존하지만 사용자가 고르지 않은 목표를
  // 선택된 것으로 꾸미지 않는다. 카드를 처음 선택할 때 그 레거시 값을 target 기본값으로 쓴다.
  if (!Array.isArray(params.retirementGoals)) return [];
  return normalizeRetirementGoals(params.retirementGoals);
}

export function migrateRetirementGoals(params: SimulationParams): SimulationParams {
  if (Array.isArray(params.retirementGoals)) {
    const normalized = normalizeRetirementGoals(params.retirementGoals);
    return JSON.stringify(normalized) === JSON.stringify(params.retirementGoals)
      ? params
      : { ...params, retirementGoals: normalized };
  }
  // 기존 시나리오에는 필드를 새로 쓰지 않는다. UI는 resolveRetirementGoals로 레거시 값을
  // 보여주되, 사용자가 실제로 목표를 편집하기 전까지 기존 분석 목적 함수를 보존한다.
  return params;
}

export function applyRetirementGoals(
  params: SimulationParams,
  goals: readonly RetirementGoal[],
): SimulationParams {
  const normalized = normalizeRetirementGoals(goals);
  let userProfile = params.userProfile;
  let strategy = params.strategy;

  const firstWithTarget = (...types: RetirementGoalType[]) =>
    normalized.find((goal) => types.includes(goal.type) && goal.targetValue !== undefined);

  const retirementAge = firstWithTarget('EARLY_RETIREMENT');
  if (retirementAge?.targetValue !== undefined) {
    userProfile = { ...userProfile, retirementAge: retirementAge.targetValue };
  }

  const spending = firstWithTarget('LIVING_EXPENSE_STABILITY', 'COMFORTABLE_SPENDING');
  if (spending?.targetValue !== undefined) {
    userProfile = { ...userProfile, targetMonthlySpending: spending.targetValue };
  }

  const inheritance = firstWithTarget('INHERITANCE');
  if (inheritance?.targetValue !== undefined) {
    userProfile = { ...userProfile, targetBequest: inheritance.targetValue };
    strategy = { ...resolveStrategy(params), bequestStrategy: 'target_amount' };
  } else if (params.retirementGoals?.some((goal) => goal.type === 'INHERITANCE')) {
    const { targetBequest: _targetBequest, ...withoutTargetBequest } = userProfile;
    userProfile = withoutTargetBequest;
    if (strategy?.bequestStrategy === 'target_amount') {
      strategy = { ...strategy, bequestStrategy: 'leave_some' };
    }
  }

  return {
    ...params,
    userProfile,
    ...(strategy ? { strategy } : {}),
    retirementGoals: normalized,
  };
}
