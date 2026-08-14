import { normalizeRetirementGoals, type RetirementGoalType } from '../entities/retirementGoal';
import type { StrategySimulationResult } from '../entities/types';
import type {
  MonteCarloConfig,
  StrategyMonteCarloValidationResult,
} from '../entities/montecarlo';
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
import type { StrategyMonteCarloEngine } from '../usecases/montecarlo/MonteCarloEngine';
import { annualStdDevForYieldPreset } from '../usecases/montecarlo/volatilityPresets';

export type PreSimulationRejectionCode = 'HARD_RETIREMENT_AGE';

export interface RankedStrategyCandidate {
  rank: number;
  candidate: StrategyCandidate;
  simulation: StrategySimulationResult;
  evaluation: GoalEvaluationResult;
  /** Present only when this candidate reached final Monte Carlo validation. */
  monteCarlo?: StrategyMonteCarloValidationResult;
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
  deterministicShortlistCount: number;
  monteCarloValidatedCount: number;
  monteCarloFailures: Array<{ candidateId: string; reason: string }>;
}

export interface StrategyOptimizationResult {
  best: RankedStrategyCandidate | null;
  rankedCandidates: RankedStrategyCandidate[];
  debug: StrategyOptimizerDebug;
}

export interface StrategyOptimizerOptions extends StrategyGenerationOptions {
  /** Limits returned ranking size without reducing how many generated candidates are evaluated. */
  rankingLimit?: number;
  /** Enables final-stage validation. Monte Carlo is never run when this option is absent. */
  monteCarlo?: {
    config: MonteCarloConfig;
    /** Number retained by deterministic goal scoring before Monte Carlo. Default: 20. */
    shortlistLimit?: number;
    /** Number returned after probabilistic re-ranking. Default: 3. */
    finalistLimit?: number;
  };
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
    private readonly monteCarloEngine?: StrategyMonteCarloEngine,
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
        if (!evaluation.hardConstraintsSatisfied) {
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
      right.evaluation.weightedScore - left.evaluation.weightedScore
      || right.simulation.endingAssets - left.simulation.endingAssets
      || left.candidate.id.localeCompare(right.candidate.id)
    );
    const monteCarloFailures: StrategyOptimizerDebug['monteCarloFailures'] = [];
    let deterministicShortlistCount = 0;
    let monteCarloValidatedCount = 0;
    let rankedCandidates: RankedStrategyCandidate[];

    if (options.monteCarlo) {
      if (!this.monteCarloEngine) {
        throw new Error('Monte Carlo validation requested without a StrategyMonteCarloEngine');
      }
      const shortlistLimit = Math.max(1, Math.floor(options.monteCarlo.shortlistLimit ?? 20));
      const shortlist = accepted.slice(0, shortlistLimit);
      deterministicShortlistCount = shortlist.length;
      const validated: Array<Omit<RankedStrategyCandidate, 'rank'>> = [];

      for (const item of shortlist) {
        try {
          const candidateConfig: MonteCarloConfig = {
            ...options.monteCarlo.config,
            // Candidate allocations already carry the project's conservative/base/aggressive
            // risk preset. Keep common random numbers (trials + seed), but do not grant a higher
            // expected-return candidate the lower volatility supplied for another allocation.
            annualStdDev: annualStdDevForYieldPreset(
              item.candidate.strategy.legacySettings.yieldPreset,
              options.monteCarlo.config.annualStdDev,
            ),
          };
          const monteCarlo = this.monteCarloEngine.validate(
            profile,
            goals,
            item.candidate.strategy,
            candidateConfig,
          );
          monteCarloValidatedCount += 1;
          validated.push({ ...item, monteCarlo });
        } catch (error) {
          monteCarloFailures.push({
            candidateId: item.candidate.id,
            reason: errorMessage(error),
          });
        }
      }

      validated.sort((left, right) =>
        (right.monteCarlo?.goalSuccessProbability ?? 0)
          - (left.monteCarlo?.goalSuccessProbability ?? 0)
        || (right.monteCarlo?.spendingSuccessProbability ?? 0)
          - (left.monteCarlo?.spendingSuccessProbability ?? 0)
        || (right.monteCarlo?.assetSurvivalProbability ?? 0)
          - (left.monteCarlo?.assetSurvivalProbability ?? 0)
        || (right.monteCarlo?.terminalAssetMedian ?? 0)
          - (left.monteCarlo?.terminalAssetMedian ?? 0)
        || right.evaluation.weightedScore - left.evaluation.weightedScore
        || left.candidate.id.localeCompare(right.candidate.id)
      );
      const finalistLimit = Math.max(1, Math.floor(options.monteCarlo.finalistLimit ?? 3));
      rankedCandidates = validated.slice(0, finalistLimit).map((item, index) => ({
        ...item,
        rank: index + 1,
      }));
    } else {
      const rankingLimit = Math.max(1, Math.floor(options.rankingLimit ?? (accepted.length || 1)));
      rankedCandidates = accepted.slice(0, rankingLimit).map((item, index) => ({
        ...item,
        rank: index + 1,
      }));
    }

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
        deterministicShortlistCount,
        monteCarloValidatedCount,
        monteCarloFailures,
      },
    };
  }
}
