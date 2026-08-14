import { normalizeRetirementGoals, type RetirementGoalType } from '../entities/retirementGoal';
import type { StrategySimulationResult } from '../entities/types';
import type {
  RetirementGoals,
  RetirementProfile,
  RetirementStrategy,
} from '../domain/input/retirement';
import type { SimulationEngine } from '../simulation/SimulationEngine';
import {
  DefaultGoalEvaluationEngine,
  type GoalEvaluationEngine,
  type GoalEvaluationResult,
} from '../evaluation/GoalEvaluationEngine';
import {
  StrategyGenerator,
  type StrategyCandidate,
  type StrategyGenerationDebug,
  type StrategyGenerationOptions,
} from './StrategyGenerator';

export type PreSimulationRejectionCode = 'HARD_RETIREMENT_AGE';

export interface RankedStrategyCandidate {
  rank: number;
  candidate: StrategyCandidate;
  simulation: StrategySimulationResult;
  evaluation: GoalEvaluationResult;
}

export interface StrategyOptimizerDebug {
  generation: StrategyGenerationDebug;
  generatedCandidateCount: number;
  hardConstraintRejectedCount: number;
  simulatedCandidateCount: number;
  postSimulationRejectedCount: number;
  failedCandidateCount: number;
  rankedCandidateCount: number;
  rejectionReasons: Partial<Record<PreSimulationRejectionCode | GoalEvaluationResult['hardConstraintFailures'][number]['code'], number>>;
  unsupportedHardGoals: RetirementGoalType[];
  simulationFailures: Array<{ candidateId: string; reason: string }>;
}

export interface StrategyOptimizationResult {
  best: RankedStrategyCandidate | null;
  rankedCandidates: RankedStrategyCandidate[];
  debug: StrategyOptimizerDebug;
}

export interface StrategyOptimizerOptions extends StrategyGenerationOptions {
  /** Limits returned ranking size without reducing how many generated candidates are evaluated. */
  rankingLimit?: number;
}

function preSimulationHardFailure(
  candidate: StrategyCandidate,
  goals: RetirementGoals,
): PreSimulationRejectionCode | null {
  const hardRetirementGoal = normalizeRetirementGoals(goals.selectedGoals ?? []).find((goal) =>
    goal.type === 'EARLY_RETIREMENT'
      && goal.constraintType === 'HARD'
      && goal.targetValue !== undefined
  );
  return hardRetirementGoal?.targetValue !== undefined
    && candidate.strategy.retirementAge > hardRetirementGoal.targetValue
    ? 'HARD_RETIREMENT_AGE'
    : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function increment<T extends string>(record: Partial<Record<T, number>>, key: T): void {
  record[key] = (record[key] ?? 0) + 1;
}

/** Coordinates generation → HARD pruning → simulation → goal evaluation → deterministic ranking. */
export class StrategyOptimizer {
  constructor(
    private readonly simulationEngine: SimulationEngine,
    private readonly goalEvaluationEngine: GoalEvaluationEngine = new DefaultGoalEvaluationEngine(),
    private readonly generator: StrategyGenerator = new StrategyGenerator(),
  ) {}

  optimize(
    profile: RetirementProfile,
    goals: RetirementGoals,
    seed: RetirementStrategy,
    options: StrategyOptimizerOptions = {},
  ): StrategyOptimizationResult {
    const generated = this.generator.generate(profile, goals, seed, options);
    const accepted: Omit<RankedStrategyCandidate, 'rank'>[] = [];
    const rejectionReasons: StrategyOptimizerDebug['rejectionReasons'] = {};
    const unsupportedHardGoals = new Set<RetirementGoalType>();
    const simulationFailures: StrategyOptimizerDebug['simulationFailures'] = [];
    let hardConstraintRejectedCount = 0;
    let simulatedCandidateCount = 0;
    let postSimulationRejectedCount = 0;

    for (const candidate of generated.candidates) {
      const hardFailure = preSimulationHardFailure(candidate, goals);
      if (hardFailure) {
        hardConstraintRejectedCount += 1;
        increment(rejectionReasons, hardFailure);
        continue;
      }

      try {
        const simulation = this.simulationEngine.simulate(profile, candidate.strategy);
        simulatedCandidateCount += 1;
        const evaluation = this.goalEvaluationEngine.evaluate(
          profile,
          goals,
          candidate.strategy,
          simulation,
        );
        evaluation.unsupportedHardGoals.forEach((goal) => unsupportedHardGoals.add(goal));
        if (evaluation.hardConstraintFailures.length > 0) {
          postSimulationRejectedCount += 1;
          evaluation.hardConstraintFailures.forEach((failure) =>
            increment(rejectionReasons, failure.code)
          );
          continue;
        }
        accepted.push({ candidate, simulation, evaluation });
      } catch (error) {
        simulationFailures.push({ candidateId: candidate.id, reason: errorMessage(error) });
      }
    }

    accepted.sort((left, right) =>
      right.evaluation.score - left.evaluation.score
      || right.simulation.endingAssets - left.simulation.endingAssets
      || left.candidate.id.localeCompare(right.candidate.id)
    );
    const rankingLimit = Math.max(1, Math.floor(options.rankingLimit ?? (accepted.length || 1)));
    const rankedCandidates = accepted.slice(0, rankingLimit).map((item, index) => ({
      ...item,
      rank: index + 1,
    }));

    return {
      best: rankedCandidates[0] ?? null,
      rankedCandidates,
      debug: {
        generation: generated.debug,
        generatedCandidateCount: generated.candidates.length,
        hardConstraintRejectedCount,
        simulatedCandidateCount,
        postSimulationRejectedCount,
        failedCandidateCount: simulationFailures.length,
        rankedCandidateCount: accepted.length,
        rejectionReasons,
        unsupportedHardGoals: [...unsupportedHardGoals],
        simulationFailures,
      },
    };
  }
}
