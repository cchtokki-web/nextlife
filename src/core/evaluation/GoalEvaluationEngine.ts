import type { RetirementGoal, RetirementGoalType } from '../entities/retirementGoal';
import { normalizeRetirementGoals } from '../entities/retirementGoal';
import type {
  SimulationResult,
  SimulationParams,
  StrategySimulationResult,
  UtilityBreakdown,
  UtilityRaws,
} from '../entities/types';
import type {
  RetirementGoals,
  RetirementProfile,
  RetirementStrategy,
} from '../domain/input/retirement';
import { LegacySimulationAdapter } from '../domain/input/LegacySimulationAdapter';
import { hasSpendingShortfall } from '../usecases/spending/spendingShortfall';
import {
  computeConsumptionRaw,
  computeLifetimeUtility,
  computeUtilityRaws,
  targetAnnualSpendingForYear,
} from '../usecases/utility/UtilityEngine';

export type HardConstraintFailureCode =
  | 'HARD_RETIREMENT_AGE'
  | 'HARD_SPENDING_SHORTFALL'
  | 'HARD_ASSET_SURVIVAL'
  | 'HARD_MINIMUM_ENDING_ASSETS'
  /**
   * A custom engine rejected the candidate through the deprecated boolean without naming a
   * constraint. Synthesised so a rejection always carries a reason — never invented for a
   * candidate that was not actually rejected.
   */
  | 'HARD_UNSPECIFIED';

export interface HardConstraintFailure {
  code: HardConstraintFailureCode;
  /** Absent only for HARD_UNSPECIFIED, where no goal was named by the rejecting engine. */
  goalType?: RetirementGoalType;
  reason: string;
}

/**
 * The single definition of the HARD early-retirement rule.
 *
 * It is checked twice — once before simulation by HardConstraintFilter on static strategy facts,
 * once after evaluation here — so the predicate and its reason string must exist in one place.
 * Two copies would let a pre-simulation rejection disagree with a post-evaluation pass.
 */
export function retirementAgeHardFailure(
  retirementAge: number,
  goal: RetirementGoal,
): HardConstraintFailure | null {
  if (goal.targetValue === undefined || retirementAge <= goal.targetValue) return null;
  return {
    code: 'HARD_RETIREMENT_AGE',
    goalType: goal.type,
    reason: `전략 은퇴 나이 ${retirementAge}세가 HARD 목표 ${goal.targetValue}세보다 늦습니다.`,
  };
}

/**
 * 목표별 실측치와 목표치, **그리고 그 단위**.
 *
 * 예전에는 `actualValue`/`targetValue`가 맨 number였고 의미가 goalType에 따라 달라졌다 —
 * EARLY_RETIREMENT와 ASSET_SURVIVAL에서는 나이, INHERITANCE·ASSET_GROWTH에서는 금액,
 * 생활비 목표에서는 월 금액. 그래서 이 값을 표시하려면 표시 계층이 goalType을 다시 분기해
 * 단위를 추측해야 했다. AGENTS.md는 나이와 연도, 금액 단위를 섞지 말라고 못박는데, 그
 * 혼용이 한 인터페이스 안에 들어 있던 셈이다.
 *
 * 단위를 판별자로 올리면 표시 계층은 `switch (measurement.unit)` 하나로 끝나고, 새 단위가
 * 생기면 컴파일러가 누락된 분기를 잡아 준다.
 */
export type GoalMeasurement =
  | { unit: 'NONE' }
  | { unit: 'AGE' | 'MONEY' | 'MONTHLY_MONEY'; actual?: number; target?: number };

export interface GoalEvaluation {
  goalType: RetirementGoalType;
  score: number;
  achieved: boolean;
  measurement: GoalMeasurement;
  reason: string;
}

export interface StrategyEvaluation {
  /**
   * @deprecated `hardConstraintFailures`가 판정의 단일 근거다. 이 불리언은 상세 목록과
   * 모순될 수 있어(양쪽을 각자 채울 수 있으므로) 더 이상 단독으로 읽지 않는다.
   * 예전 계약을 구현한 외부 엔진이 상세 없이 이 값만 false로 주는 경우를 계속 존중하기
   * 위해 남겨 두며, 그 조정은 `HardConstraintFilter.afterEvaluation` 한 곳에서만 한다.
   */
  hardConstraintsSatisfied?: boolean;
  goalEvaluations: GoalEvaluation[];
  weightedScore: number;
}

/**
 * Compatibility result for callers introduced before per-goal evaluation.
 * `score` and `utility` remain available, but new recommendation ranking uses `weightedScore`.
 */
export interface GoalEvaluationResult extends StrategyEvaluation {
  /** @deprecated Legacy lifetime-utility score. Use weightedScore for goal-based ranking. */
  score: number;
  /** Auxiliary lifetime-utility metric; it is not the primary recommendation score. */
  utility: UtilityBreakdown;
  hardConstraintFailures: HardConstraintFailure[];
  /** HARD goals that current facts/results cannot quantify are exposed, never silently claimed. */
  unsupportedHardGoals: RetirementGoalType[];
}

export interface GoalEvaluationEngine {
  evaluate(
    profile: RetirementProfile,
    goals: RetirementGoals,
    strategy: RetirementStrategy,
    result: StrategySimulationResult,
  ): GoalEvaluationResult;
}

/**
 * `Math.max(0, NaN)` is `NaN`, so the obvious clamp silently passes non-finite values straight
 * through. A `NaN` score reaches the ranking comparators, where `NaN - NaN` makes the sort order
 * arbitrary while every consumer still treats position 0 as "the best strategy for you".
 * A non-finite score is a bug in the calculation upstream, not a value to render.
 */
function clampScore(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error(`Goal score must be a finite number, received ${value}`);
  }
  return Math.round(Math.min(100, Math.max(0, value)));
}

function asUtilityResult(
  strategy: RetirementStrategy,
  result: StrategySimulationResult,
): SimulationResult {
  const retirementYear = result.yearlyResults.find((year) => year.age >= strategy.retirementAge);
  return {
    ...result,
    fireAge: null,
    retirementScore: 0,
    retirementGrade: '보통',
    goalAchievementRate: 0,
    retirementAssetsAtRetirement: retirementYear?.openingAssets ?? 0,
  };
}

function rawScore(raw: number): number {
  return clampScore(raw * 100);
}

function minimumTargetScore(actual: number, target: number): number {
  if (target <= 0) return 100;
  return clampScore(actual / target * 100);
}

function minimumEndingAssetEvaluation(
  goal: RetirementGoal,
  result: StrategySimulationResult,
  targetValue: number,
): GoalEvaluation {
  const achieved = result.endingAssets >= targetValue;
  return {
    goalType: goal.type,
    score: minimumTargetScore(result.endingAssets, targetValue),
    achieved,
    measurement: { unit: 'MONEY', actual: result.endingAssets, target: targetValue },
    reason: achieved
      ? `기말 자산이 목표 금액 ${targetValue}을 충족합니다.`
      : `기말 자산 ${result.endingAssets}이 목표 ${targetValue}에 미달합니다.`,
  };
}

function retirementAgeEvaluation(goal: RetirementGoal, strategy: RetirementStrategy): GoalEvaluation {
  const targetValue = goal.targetValue;
  if (targetValue === undefined) {
    return {
      goalType: goal.type,
      score: 0,
      achieved: false,
      measurement: { unit: 'AGE', actual: strategy.retirementAge },
      reason: '희망 은퇴 나이가 없어 달성도를 계산할 수 없습니다.',
    };
  }

  const achieved = strategy.retirementAge <= targetValue;
  return {
    goalType: goal.type,
    score: achieved ? 100 : clampScore(targetValue / strategy.retirementAge * 100),
    achieved,
    measurement: { unit: 'AGE', actual: strategy.retirementAge, target: targetValue },
    reason: achieved
      ? `${targetValue}세 이하 은퇴 목표를 충족합니다.`
      : `전략 은퇴 나이 ${strategy.retirementAge}세가 목표 ${targetValue}세보다 늦습니다.`,
  };
}

function spendingEvaluation(
  goal: RetirementGoal,
  strategy: RetirementStrategy,
  result: StrategySimulationResult,
  params: SimulationParams,
): GoalEvaluation {
  const retirementYears = result.yearlyResults.filter((year) => year.age >= strategy.retirementAge);
  const goalParams = spendingGoalParams(goal, strategy, params);
  const shortfallYears = retirementYears.filter(
    (year) => isGoalSpendingShortfall(goal, strategy, goalParams, year),
  ).length;
  const score = rawScore(computeConsumptionRaw(goalParams, retirementYears));
  return {
    goalType: goal.type,
    score,
    achieved: retirementYears.length > 0 && shortfallYears === 0,
    measurement: goal.targetValue === undefined
      ? { unit: 'MONTHLY_MONEY' }
      : { unit: 'MONTHLY_MONEY', target: goal.targetValue },
    reason: retirementYears.length === 0
      ? '은퇴 기간 결과가 없어 소비 목표를 평가할 수 없습니다.'
      : shortfallYears === 0
        ? '은퇴 기간 내내 목표 생활비를 충족합니다.'
        : `은퇴 기간 중 ${shortfallYears}개 연도에 목표 생활비 미달이 있습니다.`,
  };
}

function spendingGoalParams(
  goal: RetirementGoal,
  strategy: RetirementStrategy,
  params: SimulationParams,
): SimulationParams {
  const targetMonthlySpending = goal.targetValue ?? strategy.targetMonthlySpending;
  if (targetMonthlySpending === params.userProfile.targetMonthlySpending) {
    return params;
  }
  return {
    ...params,
    userProfile: {
      ...params.userProfile,
      targetMonthlySpending,
    },
  };
}

function isGoalSpendingShortfall(
  goal: RetirementGoal,
  strategy: RetirementStrategy,
  goalParams: SimulationParams,
  year: SimulationResult['yearlyResults'][number],
): boolean {
  // The shortfall ledger belongs to the concrete strategy target. For a different selected goal,
  // compare actual spending with that goal directly so a higher shared target cannot incorrectly
  // fail a lower goal (or a lower shared target pass a higher one).
  const usesStrategyTarget = goal.targetValue === undefined
    || goal.targetValue === strategy.targetMonthlySpending;
  return (usesStrategyTarget && hasSpendingShortfall(year))
    || year.spending < targetAnnualSpendingForYear(goalParams, year);
}

function hasGoalSpendingShortfall(
  goal: RetirementGoal,
  strategy: RetirementStrategy,
  result: StrategySimulationResult,
  params: SimulationParams,
): boolean {
  const goalParams = spendingGoalParams(goal, strategy, params);
  return result.yearlyResults.some((year) =>
    year.age >= strategy.retirementAge
    && isGoalSpendingShortfall(goal, strategy, goalParams, year)
  );
}

function assetSurvivalEvaluation(
  goal: RetirementGoal,
  strategy: RetirementStrategy,
  result: StrategySimulationResult,
  raws: UtilityRaws,
): GoalEvaluation {
  const survives = result.depletionAge === null || result.depletionAge > strategy.planHorizonAge;
  return {
    goalType: goal.type,
    score: rawScore(raws.depletionSafety),
    achieved: survives,
    measurement: {
      unit: 'AGE',
      actual: result.depletionAge ?? strategy.planHorizonAge,
      target: strategy.planHorizonAge,
    },
    reason: survives
      ? `계획 종료 나이 ${strategy.planHorizonAge}세까지 자산이 고갈되지 않습니다.`
      : `${result.depletionAge}세에 자산이 고갈됩니다.`,
  };
}

function endingAssetEvaluation(
  goal: RetirementGoal,
  result: StrategySimulationResult,
  raws: UtilityRaws,
): GoalEvaluation {
  const targetValue = goal.targetValue;
  if (targetValue !== undefined) {
    return minimumEndingAssetEvaluation(goal, result, targetValue);
  }

  const score = rawScore(raws.bequestAdequacy);
  return {
    goalType: goal.type,
    score,
    achieved: score === 100,
    measurement: { unit: 'MONEY', actual: result.endingAssets },
    reason: '명시된 목표 금액이 없어 기존 적정 잔여자산 기준으로 평가했습니다.',
  };
}

function assetGrowthEvaluation(
  goal: RetirementGoal,
  strategy: RetirementStrategy,
  result: StrategySimulationResult,
): GoalEvaluation {
  if (goal.targetValue !== undefined) {
    return minimumEndingAssetEvaluation(goal, result, goal.targetValue);
  }

  const retirementYear = result.yearlyResults.find((year) => year.age >= strategy.retirementAge);
  if (retirementYear === undefined) {
    // Falling back to 0 here would make the comparison "endingAssets >= 0" — trivially true, and
    // minimumTargetScore(x, 0) returns a perfect 100. An unevaluable goal must never score as met.
    return {
      goalType: goal.type,
      score: 0,
      achieved: false,
      measurement: { unit: 'MONEY', actual: result.endingAssets },
      reason: '은퇴 시점 이후 결과가 없어 자산 성장 목표를 평가할 수 없습니다.',
    };
  }

  const retirementAssets = retirementYear.openingAssets;
  const achieved = result.endingAssets >= retirementAssets;
  return {
    goalType: goal.type,
    score: minimumTargetScore(result.endingAssets, retirementAssets),
    achieved,
    measurement: { unit: 'MONEY', actual: result.endingAssets, target: retirementAssets },
    reason: achieved
      ? '기말 자산이 은퇴 시점 자산 이상으로 유지됩니다.'
      : '기말 자산이 은퇴 시점 자산보다 줄어듭니다.',
  };
}

function evaluateGoal(
  goal: RetirementGoal,
  strategy: RetirementStrategy,
  result: StrategySimulationResult,
  raws: UtilityRaws,
  params: SimulationParams,
): GoalEvaluation {
  switch (goal.type) {
    case 'EARLY_RETIREMENT':
      return retirementAgeEvaluation(goal, strategy);
    case 'LIVING_EXPENSE_STABILITY':
    case 'COMFORTABLE_SPENDING':
      return spendingEvaluation(goal, strategy, result, params);
    case 'ASSET_SURVIVAL':
      return assetSurvivalEvaluation(goal, strategy, result, raws);
    case 'PENSION_OPTIMIZATION': {
      const score = rawScore(raws.pensionUtilization);
      return {
        goalType: goal.type,
        score,
        achieved: score === 100,
        measurement: { unit: 'NONE' },
        reason: '공적·사적연금 수령 기간과 연금 세금 효율을 평가했습니다.',
      };
    }
    case 'TAX_OPTIMIZATION': {
      const score = rawScore(raws.taxEfficiency);
      return {
        goalType: goal.type,
        score,
        achieved: score === 100,
        measurement: { unit: 'NONE' },
        reason: '기존 세부담률 기준으로 세금 효율을 평가했습니다.',
      };
    }
    case 'RISK_REDUCTION': {
      const score = rawScore(raws.depletionSafety);
      return {
        goalType: goal.type,
        score,
        achieved: score === 100,
        measurement: { unit: 'NONE' },
        reason: '현재 결정론 결과에서 자산 고갈 안전성을 위험 대리지표로 평가했습니다.',
      };
    }
    case 'INHERITANCE':
      return endingAssetEvaluation(goal, result, raws);
    case 'ASSET_GROWTH':
      return assetGrowthEvaluation(goal, strategy, result);
    case 'HOUSING_STABILITY':
      return {
        goalType: goal.type,
        score: 0,
        achieved: false,
        measurement: { unit: 'NONE' },
        reason: '현재 프로필과 시뮬레이션 결과에 주거 안정을 정량화할 정보가 없습니다.',
      };
  }
}

function weightedGoalScore(
  goals: readonly RetirementGoal[],
  evaluations: readonly GoalEvaluation[],
  fallbackScore: number,
): number {
  if (goals.length === 0) return fallbackScore;
  const totalWeight = goals.reduce((sum, goal) => sum + goals.length - goal.priority + 1, 0);
  const total = evaluations.reduce(
    (sum, evaluation, index) => sum + evaluation.score * (goals.length - goals[index].priority + 1),
    0,
  );
  return totalWeight > 0 ? clampScore(total / totalWeight) : 0;
}

/** Evaluates every selected goal independently; lifetime utility remains an auxiliary metric. */
export class DefaultGoalEvaluationEngine implements GoalEvaluationEngine {
  evaluate(
    profile: RetirementProfile,
    goals: RetirementGoals,
    strategy: RetirementStrategy,
    result: StrategySimulationResult,
  ): GoalEvaluationResult {
    const params = LegacySimulationAdapter.toLegacy(profile, goals, strategy);
    const utilityResult = asUtilityResult(strategy, result);
    const utility = computeLifetimeUtility(utilityResult, params, strategy.utilityConfig);
    const raws = computeUtilityRaws(utilityResult, params, strategy.utilityConfig);
    const normalizedGoals = normalizeRetirementGoals(goals.selectedGoals ?? []);
    const goalEvaluations = normalizedGoals.map(
      (goal) => evaluateGoal(goal, strategy, result, raws, params),
    );
    const hardConstraintFailures: HardConstraintFailure[] = [];
    const unsupportedHardGoals: RetirementGoalType[] = [];

    for (const goal of normalizedGoals) {
      if (goal.constraintType !== 'HARD') continue;

      if (goal.type === 'EARLY_RETIREMENT' && goal.targetValue !== undefined) {
        const failure = retirementAgeHardFailure(strategy.retirementAge, goal);
        if (failure) hardConstraintFailures.push(failure);
        continue;
      }

      if (goal.type === 'LIVING_EXPENSE_STABILITY' || goal.type === 'COMFORTABLE_SPENDING') {
        const hasShortfall = hasGoalSpendingShortfall(goal, strategy, result, params);
        if (hasShortfall) {
          hardConstraintFailures.push({
            code: 'HARD_SPENDING_SHORTFALL',
            goalType: goal.type,
            reason: '은퇴 기간 중 목표 생활비 미충족 연도가 있습니다.',
          });
        }
        continue;
      }

      if (goal.type === 'ASSET_SURVIVAL') {
        if (result.depletionAge !== null && result.depletionAge <= strategy.planHorizonAge) {
          hardConstraintFailures.push({
            code: 'HARD_ASSET_SURVIVAL',
            goalType: goal.type,
            reason: `계획 종료 나이 ${strategy.planHorizonAge}세 전에 자산이 고갈됩니다.`,
          });
        }
        continue;
      }

      if ((goal.type === 'INHERITANCE' || goal.type === 'ASSET_GROWTH')
        && goal.targetValue !== undefined) {
        if (result.endingAssets < goal.targetValue) {
          hardConstraintFailures.push({
            code: 'HARD_MINIMUM_ENDING_ASSETS',
            goalType: goal.type,
            reason: `기말 자산이 HARD 목표 ${goal.targetValue}에 미달합니다.`,
          });
        }
        continue;
      }

      // No current fact/result can prove these qualitative HARD constraints. Keep them visible
      // instead of inventing a pass/fail rule. A targetless retirement/asset goal is malformed too.
      unsupportedHardGoals.push(goal.type);
    }

    const weightedScore = weightedGoalScore(normalizedGoals, goalEvaluations, utility.score);
    return {
      hardConstraintsSatisfied: hardConstraintFailures.length === 0,
      goalEvaluations,
      weightedScore,
      // Preserve the former lifetime-utility contract. New ranking code intentionally does not
      // consume this compatibility field.
      score: utility.score,
      utility,
      hardConstraintFailures,
      unsupportedHardGoals,
    };
  }
}
