import {
  normalizeRetirementGoals,
  type RetirementGoal,
  type RetirementGoalType,
} from '../../entities/retirementGoal';
import type { UtilityAxis, UtilityConfig } from '../../entities/types';
import { OBJECTIVE_WEIGHT_PRESETS } from '../strategy/objectivePresets';
import { createUtilityConfig } from '../utility/utilityWeights';

type UtilityWeights = UtilityConfig['weights'];

// 기존 목적 함수 프리셋을 최대한 재사용한다. 연금 활용과 위험 축만 기존 ObjectivePriority에
// 대응하는 프리셋이 없어 같은 6개 효용 축 위에 전용 프리셋을 둔다. 금융 수익률·세율 같은
// 가정을 새로 만들지 않고, 후보를 어떤 기준으로 서열화할지만 바꾼다.
const PENSION_OPTIMIZATION_WEIGHTS: UtilityWeights = {
  consumption: 25,
  depletionSafety: 15,
  pensionUtilization: 35,
  taxEfficiency: 10,
  taxationRisk: 10,
  bequestAdequacy: 5,
};

const RISK_REDUCTION_WEIGHTS: UtilityWeights = {
  consumption: 25,
  depletionSafety: 40,
  pensionUtilization: 15,
  taxEfficiency: 5,
  taxationRisk: 10,
  bequestAdequacy: 5,
};

export const RETIREMENT_GOAL_WEIGHT_PRESETS: Record<RetirementGoalType, UtilityWeights> = {
  LIVING_EXPENSE_STABILITY: OBJECTIVE_WEIGHT_PRESETS.lifetime_spending,
  EARLY_RETIREMENT: OBJECTIVE_WEIGHT_PRESETS.lifetime_spending,
  ASSET_SURVIVAL: OBJECTIVE_WEIGHT_PRESETS.wealth_maximization,
  COMFORTABLE_SPENDING: OBJECTIVE_WEIGHT_PRESETS.lifetime_spending,
  HOUSING_STABILITY: OBJECTIVE_WEIGHT_PRESETS.wealth_maximization,
  PENSION_OPTIMIZATION: PENSION_OPTIMIZATION_WEIGHTS,
  TAX_OPTIMIZATION: OBJECTIVE_WEIGHT_PRESETS.tax_minimization,
  RISK_REDUCTION: RISK_REDUCTION_WEIGHTS,
  INHERITANCE: OBJECTIVE_WEIGHT_PRESETS.bequest_maximization,
  ASSET_GROWTH: OBJECTIVE_WEIGHT_PRESETS.wealth_maximization,
};

const AXES = Object.keys(PENSION_OPTIMIZATION_WEIGHTS) as UtilityAxis[];

// 합이 100인 프리셋들의 가중평균을 정수 가중치로 되돌린다. 내림 뒤 남는 점수는 소수부가 큰
// 축부터 배분하여 합계 100 불변식을 유지한다.
function integerWeights(raw: Record<UtilityAxis, number>): UtilityWeights {
  const weights = Object.fromEntries(AXES.map((axis) => [axis, Math.floor(raw[axis])])) as UtilityWeights;
  let remaining = 100 - AXES.reduce((sum, axis) => sum + weights[axis], 0);
  const byFraction = [...AXES].sort((a, b) => (raw[b] % 1) - (raw[a] % 1));
  for (let index = 0; remaining > 0; index++, remaining--) {
    const axis = byFraction[index % byFraction.length];
    weights[axis] += 1;
  }
  return weights;
}

export function createGoalUtilityConfig(
  goals: readonly RetirementGoal[] | undefined,
  baseConfig: UtilityConfig,
): UtilityConfig {
  if (!goals || goals.length === 0) return baseConfig;

  const ordered = normalizeRetirementGoals(goals);
  const count = ordered.length;
  const weightedPresets = [{ preset: baseConfig.weights, coefficient: count }, ...ordered.map((goal) => ({
    preset: RETIREMENT_GOAL_WEIGHT_PRESETS[goal.type],
    // 앞 순위일수록 큰 계수다. HARD는 같은 순위의 SOFT보다 강하게 서열화하되, target이 있는
    // HARD 목표의 실제 불변식은 별도 엔진 입력(은퇴 나이·생활비·assetFloor)이 담당한다.
    coefficient: (count - goal.priority + 1) * (goal.constraintType === 'HARD' ? count + 1 : 1),
  }))];
  const total = weightedPresets.reduce((sum, item) => sum + item.coefficient, 0);
  if (total <= 0) return baseConfig;

  const raw = Object.fromEntries(AXES.map((axis) => [
    axis,
    weightedPresets.reduce(
      (sum, item) => sum + item.preset[axis] * item.coefficient,
      0,
    ) / total,
  ])) as Record<UtilityAxis, number>;
  const { weights: _weights, ...rest } = baseConfig;
  return createUtilityConfig(integerWeights(raw), rest);
}
