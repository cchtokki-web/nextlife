import type { RetirementGoalType } from '../entities/retirementGoal';
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
import {
  RecommendationEngine,
  type FinalStrategyRecommendations,
} from '../recommendation/RecommendationEngine';
import {
  HardConstraintFilter,
  type PreSimulationRejectionCode,
} from './HardConstraintFilter';

export type { PreSimulationRejectionCode } from './HardConstraintFilter';


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
  /** Monte Carlo 검증 후보를 안정형·균형형·여유형으로 변환한 최종 추천. */
  recommendations: FinalStrategyRecommendations;
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
    private readonly hardConstraintFilter = new HardConstraintFilter(),
    private readonly recommendationEngine = new RecommendationEngine(),
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
      const hardFailures = this.hardConstraintFilter.beforeSimulation(candidate, goals);
      if (hardFailures.length > 0) {
        hardConstraintRejectedCount += 1;
        hardFailures.forEach((failure) => increment(rejectionReasons, failure.code));
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
        const evaluationHardFailures = this.hardConstraintFilter.afterEvaluation(evaluation);
        // 기존 GoalEvaluationEngine 계약의 boolean도 계속 존중한다. 커스텀 구현이 실패 상세를
        // 비워 둔 경우에도 예전처럼 후보를 통과시키지 않는다.
        if (!evaluation.hardConstraintsSatisfied) {
          postSimulationRejectedCount += 1;
          evaluationHardFailures.forEach((failure) =>
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
    let recommendations: FinalStrategyRecommendations = { recommendations: [], primary: null };

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
      recommendations = this.recommendationEngine.recommend(
        validated.map((item, index) => ({ ...item, rank: index + 1 }))
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
      recommendations,
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
