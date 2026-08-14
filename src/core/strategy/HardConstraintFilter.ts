import { normalizeRetirementGoals, type RetirementGoalType } from '../entities/retirementGoal';
import type { RetirementGoals } from '../domain/input/retirement';
import type { GoalEvaluationResult } from '../evaluation/GoalEvaluationEngine';
import type { StrategyCandidate } from './StrategyGenerator';

export type PreSimulationRejectionCode = 'HARD_RETIREMENT_AGE';
export type HardConstraintRejectionCode =
  | PreSimulationRejectionCode
  | GoalEvaluationResult['hardConstraintFailures'][number]['code'];

export interface HardConstraintRejection {
  code: HardConstraintRejectionCode;
  goalType: RetirementGoalType;
  reason: string;
}

/**
 * Keeps HARD filtering explicit without pretending every constraint is knowable before projection.
 * Static strategy facts are checked before simulation; cash-flow and terminal-asset constraints are
 * checked from GoalEvaluationEngine output afterwards.
 */
export class HardConstraintFilter {
  beforeSimulation(
    candidate: StrategyCandidate,
    goals: RetirementGoals,
  ): HardConstraintRejection[] {
    const hardRetirementGoal = normalizeRetirementGoals(goals.selectedGoals ?? []).find((goal) =>
      goal.type === 'EARLY_RETIREMENT'
      && goal.constraintType === 'HARD'
      && goal.targetValue !== undefined
    );

    if (hardRetirementGoal?.targetValue === undefined
      || candidate.strategy.retirementAge <= hardRetirementGoal.targetValue) {
      return [];
    }

    return [{
      code: 'HARD_RETIREMENT_AGE',
      goalType: hardRetirementGoal.type,
      reason: `전략 은퇴 나이 ${candidate.strategy.retirementAge}세가 HARD 목표 ${hardRetirementGoal.targetValue}세보다 늦습니다.`,
    }];
  }

  afterEvaluation(evaluation: GoalEvaluationResult): HardConstraintRejection[] {
    return evaluation.hardConstraintFailures.map((failure) => ({ ...failure }));
  }
}
