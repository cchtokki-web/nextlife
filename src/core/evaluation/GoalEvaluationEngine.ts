import type { RetirementGoalType } from '../entities/retirementGoal';
import { normalizeRetirementGoals } from '../entities/retirementGoal';
import type {
  SimulationResult,
  StrategySimulationResult,
  UtilityBreakdown,
} from '../entities/types';
import type {
  RetirementGoals,
  RetirementProfile,
  RetirementStrategy,
} from '../domain/input/retirement';
import { LegacySimulationAdapter } from '../domain/input/LegacySimulationAdapter';
import { hasSpendingShortfall } from '../usecases/spending/spendingShortfall';
import { computeLifetimeUtility } from '../usecases/utility/UtilityEngine';

export type HardConstraintFailureCode =
  | 'HARD_SPENDING_SHORTFALL'
  | 'HARD_ASSET_SURVIVAL'
  | 'HARD_MINIMUM_ENDING_ASSETS';

export interface HardConstraintFailure {
  code: HardConstraintFailureCode;
  goalType: RetirementGoalType;
  reason: string;
}

export interface GoalEvaluationResult {
  score: number;
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

/** Uses the existing lifetime-utility formula; no second scoring formula is introduced. */
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
    const hardConstraintFailures: HardConstraintFailure[] = [];
    const unsupportedHardGoals: RetirementGoalType[] = [];

    for (const goal of normalizeRetirementGoals(goals.selectedGoals ?? [])) {
      if (goal.constraintType !== 'HARD') continue;

      if (goal.type === 'LIVING_EXPENSE_STABILITY' || goal.type === 'COMFORTABLE_SPENDING') {
        const hasShortfall = result.yearlyResults.some((year) =>
          year.age >= strategy.retirementAge && hasSpendingShortfall(year)
        );
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

      // A targeted EARLY_RETIREMENT goal is filtered before simulation. The remaining qualitative
      // goals (and a malformed targetless retirement goal) have no current hard threshold or fact
      // model, so claiming pass/fail would invent a rule.
      if (goal.type !== 'EARLY_RETIREMENT' || goal.targetValue === undefined) {
        unsupportedHardGoals.push(goal.type);
      }
    }

    return {
      score: utility.score,
      utility,
      hardConstraintFailures,
      unsupportedHardGoals,
    };
  }
}
