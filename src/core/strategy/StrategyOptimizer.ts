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
  RECOMMENDATION_PERSONAS,
  RecommendationEngine,
  noRecommendationReachesGoal,
  type CandidateRecommendation,
  type FinalStrategyRecommendations,
  type ValidatedStrategyCandidate,
} from '../recommendation/RecommendationEngine';
import {
  HardConstraintFilter,
  type HardConstraintRejectionCode,
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
  /** Candidates that survived every filter. Not the size of `rankedCandidates`, which is capped. */
  acceptedCandidateCount: number;
  rejectionReasons: Partial<Record<PreSimulationRejectionCode | GoalEvaluationResult['hardConstraintFailures'][number]['code'], number>>;
  unsupportedHardGoals: RetirementGoalType[];
  simulationFailures: Array<{ candidateId: string; reason: string }>;
  deterministicShortlistCount: number;
  /** Candidates screened at the reduced trial count. */
  monteCarloValidatedCount: number;
  /** Persona winners re-run at the full trial count. These are the numbers shown to the user. */
  monteCarloConfirmedCount: number;
  monteCarloFailures: Array<{ candidateId: string; reason: string }>;
}

/**
 * Why the run produced what it produced.
 *
 * An empty `recommendations` has several genuinely different causes, and they call for opposite
 * responses from the user: "목표가 서로 충돌한다"(목표를 조정), "계산이 실패했다"(우리 문제),
 * "후보는 있는데 페르소나 특성이 없다"(설명이 필요). Reporting them all as one empty list told
 * the user their goals were unachievable even when the engine had simply crashed on every
 * candidate. The counts travel with the kind so the UI never has to read `debug` to explain itself.
 */
export type OptimizationOutcome =
  | { kind: 'ok' }
  /** The generator produced nothing — no strategy axis had a usable value. */
  | { kind: 'no_candidate_generated' }
  /** Candidates existed but none reached the end: rejected, crashed, or both. */
  | {
      kind: 'no_candidate_survived';
      hardConstraintRejectedCount: number;
      failedCount: number;
      blockedBy: HardConstraintRejectionCode[];
      firstFailureReason?: string;
    }
  /** Validated candidates exist, but none carries any persona's defining trait. */
  | { kind: 'no_persona_matched'; validatedCount: number }
  /**
   * 추천은 만들어졌지만 전부 목표 달성 확률 0% — 고를 이유가 없는 선택지다.
   *
   * 이것은 실패가 아니라 «답»이다: 어떤 전략으로도 이 목표에 도달하지 못한다. 카드로 내면
   * 존재하지 않는 선택을 고르라는 화면이 되므로 다른 갈래로 분리한다.
   */
  | { kind: 'no_candidate_reaches_goal'; validatedCount: number; personaCount: number };

export interface StrategyOptimizationResult {
  best: RankedStrategyCandidate | null;
  rankedCandidates: RankedStrategyCandidate[];
  outcome: OptimizationOutcome;
  /**
   * Monte Carlo 검증 후보를 안정형·균형형·여유형으로 변환한 최종 추천.
   * `options.monteCarlo`가 없으면 항상 비어 있고, 있어도 해당 특성을 가진 후보가 없는
   * 페르소나는 빠지므로 3개 미만일 수 있다.
   */
  recommendations: FinalStrategyRecommendations;
  debug: StrategyOptimizerDebug;
}

export interface StrategyOptimizerOptions extends StrategyGenerationOptions {
  /**
   * Limits returned ranking size without reducing how many generated candidates are evaluated.
   * Ignored when `monteCarlo` is set; `finalistLimit` governs that path instead.
   */
  rankingLimit?: number;
  /** Enables final-stage validation. Monte Carlo is never run when this option is absent. */
  monteCarlo?: {
    config: MonteCarloConfig;
    /** Number retained by deterministic goal scoring before Monte Carlo. Default: 12. */
    shortlistLimit?: number;
    /**
     * Trials used to *screen* the shortlist. Default: 200.
     *
     * Screening then confirming is what keeps this affordable. Measured cost is ~0.6ms per
     * projection, so one flat pass of 20 candidates × 1,000 trials is 20,000 projections (~12s)
     * — and 98% of the optimizer's total runtime. Screening at 200 and re-running only the
     * persona winners at `config.trials` cuts that by roughly two thirds.
     *
     * Screening is sound because every candidate is scored on the *same* shock paths (common
     * random numbers, seeded by `config.seed`), so differences between candidates are estimated
     * far more precisely than absolute levels. Only the ordering matters here; every number the
     * user is shown comes from the full-trial confirmation pass.
     *
     * Set equal to (or above) `config.trials` to skip screening and run a single pass.
     */
    screeningTrials?: number;
    /** Number returned after confirmation. Default: 3, one per persona. */
    finalistLimit?: number;
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function increment<T extends string>(record: Partial<Record<T, number>>, key: T): void {
  record[key] = (record[key] ?? 0) + 1;
}

/**
 * `Math.max(1, NaN)` is `NaN`, and `slice(0, NaN)` silently yields an empty list — a malformed
 * limit would produce "no strategy meets your goals" rather than an error. Reject it outright.
 */
function positiveIntOption(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number, received ${value}`);
  }
  return Math.max(1, Math.floor(value));
}

/**
 * Keeps the shortlist able to answer every persona.
 *
 * Ranking by deterministic score alone systematically eliminates CONSERVATIVE allocations before
 * the persona stage — a higher assumed return always scores better in a projection with no
 * variance — so 안정형 had no conservative candidate left to describe. Reserve room for each
 * persona's defining trait first, then fill the remainder by score.
 */
function personaAwareShortlist(
  accepted: readonly Omit<RankedStrategyCandidate, 'rank'>[],
  limit: number,
): Omit<RankedStrategyCandidate, 'rank'>[] {
  const reservedPerPersona = 2;
  const picked = new Set<string>();
  const shortlist: Omit<RankedStrategyCandidate, 'rank'>[] = [];

  const take = (item: Omit<RankedStrategyCandidate, 'rank'>): void => {
    if (picked.has(item.candidate.id) || shortlist.length >= limit) return;
    picked.add(item.candidate.id);
    shortlist.push(item);
  };

  // `accepted` is already sorted by deterministic score, so "first match" is "best match".
  for (const definition of RECOMMENDATION_PERSONAS) {
    accepted
      .filter((item) => definition.qualifies({ ...item, rank: 0 }))
      .slice(0, reservedPerPersona)
      .forEach(take);
  }
  accepted.forEach(take);

  return shortlist;
}

function byProbabilityDescending(
  left: Omit<ValidatedStrategyCandidate, 'rank'>,
  right: Omit<ValidatedStrategyCandidate, 'rank'>,
): number {
  return right.monteCarlo.goalSuccessProbability - left.monteCarlo.goalSuccessProbability
    || right.monteCarlo.spendingSuccessProbability - left.monteCarlo.spendingSuccessProbability
    || right.monteCarlo.assetSurvivalProbability - left.monteCarlo.assetSurvivalProbability
    || right.monteCarlo.terminalAssetMedian - left.monteCarlo.terminalAssetMedian
    || right.evaluation.weightedScore - left.evaluation.weightedScore
    || left.candidate.id.localeCompare(right.candidate.id);
}

interface OutcomeInputs {
  generatedCount: number;
  acceptedCount: number;
  rejectedCount: number;
  simulationFailures: ReadonlyArray<{ candidateId: string; reason: string }>;
  rejectionReasons: StrategyOptimizerDebug['rejectionReasons'];
  monteCarloRequested: boolean;
  monteCarloValidatedCount: number;
  monteCarloFailures: ReadonlyArray<{ candidateId: string; reason: string }>;
  recommendationCount: number;
  /** 확정된 추천이 전부 목표 달성 확률 0%인가. 판정은 noRecommendationReachesGoal이 소유한다. */
  allRecommendationsZeroGoal: boolean;
  rankedCount: number;
}

function resolveOutcome(input: OutcomeInputs): OptimizationOutcome {
  if (input.generatedCount === 0) return { kind: 'no_candidate_generated' };

  if (input.acceptedCount === 0) {
    return {
      kind: 'no_candidate_survived',
      hardConstraintRejectedCount: input.rejectedCount,
      failedCount: input.simulationFailures.length,
      blockedBy: Object.keys(input.rejectionReasons) as HardConstraintRejectionCode[],
      ...(input.simulationFailures[0]
        ? { firstFailureReason: input.simulationFailures[0].reason }
        : {}),
    };
  }

  if (!input.monteCarloRequested) {
    return input.rankedCount > 0 ? { kind: 'ok' } : { kind: 'no_candidate_survived',
      hardConstraintRejectedCount: input.rejectedCount,
      failedCount: input.simulationFailures.length,
      blockedBy: Object.keys(input.rejectionReasons) as HardConstraintRejectionCode[] };
  }

  // 결정론 단계는 통과했지만 확률 검증이 한 건도 성공하지 못한 경우. 목표가 불가능해서가
  // 아니라 계산이 깨진 것이므로, HARD 탈락과 같은 문구로 뭉뚱그리면 안 된다.
  if (input.monteCarloValidatedCount === 0) {
    return {
      kind: 'no_candidate_survived',
      hardConstraintRejectedCount: 0,
      failedCount: input.monteCarloFailures.length,
      blockedBy: [],
      ...(input.monteCarloFailures[0]
        ? { firstFailureReason: input.monteCarloFailures[0].reason }
        : {}),
    };
  }

  if (input.recommendationCount === 0) {
    return { kind: 'no_persona_matched', validatedCount: input.monteCarloValidatedCount };
  }

  // 추천이 «있는» 경우만 여기 온다. 순서가 중요하다 — 추천이 없으면 위의 no_persona_matched가
  // 먼저 맞고, 그것은 "특성이 없다"라는 다른 사건이다.
  if (input.allRecommendationsZeroGoal) {
    return {
      kind: 'no_candidate_reaches_goal',
      validatedCount: input.monteCarloValidatedCount,
      personaCount: input.recommendationCount,
    };
  }

  return { kind: 'ok' };
}

/**
 * Coordinates generation → HARD pruning → simulation → goal evaluation → deterministic ranking →
 * (only when `options.monteCarlo` is set) Monte Carlo validation → 안정형·균형형·여유형 추천.
 */
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
    // Fail before the work, not after it. Discovering the missing engine below would throw away a
    // full generate + simulate + evaluate sweep over every candidate.
    if (options.monteCarlo && !this.monteCarloEngine) {
      throw new Error('Monte Carlo validation requested without a StrategyMonteCarloEngine');
    }
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
        // 탈락 여부와 그 사유가 같은 값에서 나온다. 둘을 따로 읽으면 "사유 없는 탈락"이 생긴다.
        // 예전 계약의 boolean 존중은 afterEvaluation 안에서 이뤄진다.
        const evaluationHardFailures = this.hardConstraintFilter.afterEvaluation(evaluation);
        if (evaluationHardFailures.length > 0) {
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
    let monteCarloConfirmedCount = 0;
    let rankedCandidates: RankedStrategyCandidate[];
    let recommendations: FinalStrategyRecommendations = { recommendations: [], primary: null };

    if (options.monteCarlo && this.monteCarloEngine) {
      const engine = this.monteCarloEngine;
      const fullConfig = options.monteCarlo.config;
      const shortlistLimit = positiveIntOption(options.monteCarlo.shortlistLimit, 12, 'shortlistLimit');
      const screeningTrials = positiveIntOption(
        options.monteCarlo.screeningTrials,
        200,
        'screeningTrials',
      );
      const shortlist = personaAwareShortlist(accepted, shortlistLimit);
      deterministicShortlistCount = shortlist.length;

      // Candidate allocations already carry the project's conservative/base/aggressive risk
      // preset. Keep common random numbers (seed), but do not grant a higher expected-return
      // candidate the lower volatility supplied for another allocation.
      const configFor = (
        item: Omit<RankedStrategyCandidate, 'rank'>,
        trials: number,
      ): MonteCarloConfig => ({
        ...fullConfig,
        trials,
        annualStdDev: annualStdDevForYieldPreset(
          item.candidate.strategy.legacySettings.yieldPreset,
          fullConfig.annualStdDev,
        ),
      });

      const validate = (
        item: Omit<RankedStrategyCandidate, 'rank'>,
        trials: number,
      ): Omit<ValidatedStrategyCandidate, 'rank'> | null => {
        try {
          const monteCarlo = engine.validate(profile, goals, item.candidate.strategy, configFor(item, trials));
          return { ...item, monteCarlo };
        } catch (error) {
          monteCarloFailures.push({ candidateId: item.candidate.id, reason: errorMessage(error) });
          return null;
        }
      };

      // 1단계: 선별. 시행 수를 줄여 후보 순서만 가린다.
      const useScreening = screeningTrials < fullConfig.trials;
      const screened = shortlist
        .map((item) => validate(item, useScreening ? screeningTrials : fullConfig.trials))
        .filter((item): item is Omit<ValidatedStrategyCandidate, 'rank'> => item !== null);
      monteCarloValidatedCount = screened.length;
      screened.sort(byProbabilityDescending);

      // 2단계: 확정. 페르소나 승자만 전체 시행으로 다시 돌려, 사용자에게 보이는 숫자는
      // 언제나 config.trials 기준이 되게 한다. 선별 단계의 값은 화면에 나가지 않는다.
      const screenedRecommendations = this.recommendationEngine.recommend(
        screened.map((item, index) => ({ ...item, rank: index + 1 }))
      );
      const confirmedById = new Map<string, Omit<ValidatedStrategyCandidate, 'rank'>>();
      if (useScreening) {
        for (const recommendation of screenedRecommendations.recommendations) {
          const confirmed = validate(recommendation.candidate, fullConfig.trials);
          if (confirmed) confirmedById.set(confirmed.candidate.id, confirmed);
        }
      } else {
        screened.forEach((item) => confirmedById.set(item.candidate.id, item));
      }
      monteCarloConfirmedCount = confirmedById.size;

      recommendations = {
        recommendations: screenedRecommendations.recommendations
          .map((recommendation) => {
            const confirmed = confirmedById.get(recommendation.candidate.candidate.id);
            return confirmed
              ? { ...recommendation, candidate: { ...confirmed, rank: recommendation.candidate.rank } }
              : null;
          })
          .filter((item): item is CandidateRecommendation => item !== null),
        primary: null,
      };
      recommendations.primary = recommendations.recommendations
        .find((item) => item.persona === 'BALANCED')
        ?? recommendations.recommendations[0]
        ?? null;

      // 확정된 후보만 순위에 올린다. 선별 정밀도와 확정 정밀도의 숫자를 한 목록에 섞지 않는다.
      const finalistLimit = positiveIntOption(options.monteCarlo.finalistLimit, 3, 'finalistLimit');
      rankedCandidates = [...confirmedById.values()]
        .sort(byProbabilityDescending)
        .slice(0, finalistLimit)
        .map((item, index) => ({ ...item, rank: index + 1 }));
    } else {
      const rankingLimit = positiveIntOption(
        options.rankingLimit,
        accepted.length || 1,
        'rankingLimit',
      );
      rankedCandidates = accepted.slice(0, rankingLimit).map((item, index) => ({
        ...item,
        rank: index + 1,
      }));
    }

    const outcome = resolveOutcome({
      generatedCount: generated.candidates.length,
      acceptedCount: accepted.length,
      rejectedCount: hardConstraintRejectedCount + postSimulationRejectedCount,
      simulationFailures,
      rejectionReasons,
      // Monte Carlo가 꺼져 있으면 페르소나 추천 자체를 만들지 않으므로, 그 경우의 성공 기준은
      // rankedCandidates가 비어 있지 않은 것이다.
      monteCarloRequested: Boolean(options.monteCarlo),
      monteCarloValidatedCount,
      monteCarloFailures,
      recommendationCount: recommendations.recommendations.length,
      // 확정 패스를 통과한 «최종» 목록으로 판정한다. 선별 단계 목록으로 세면 확정 후 사라진
      // 후보까지 포함되고, 화면에 나가는 숫자와 다른 근거로 판정하게 된다.
      allRecommendationsZeroGoal: noRecommendationReachesGoal(recommendations.recommendations),
      rankedCount: rankedCandidates.length,
    });

    return {
      best: rankedCandidates[0] ?? null,
      rankedCandidates,
      outcome,
      recommendations,
      debug: {
        generation: generated.debug,
        generatedCandidateCount: generated.candidates.length,
        hardConstraintRejectedCount,
        simulatedCandidateCount,
        postSimulationRejectedCount,
        failedCandidateCount: simulationFailures.length,
        acceptedCandidateCount: accepted.length,
        rejectionReasons,
        unsupportedHardGoals: [...unsupportedHardGoals],
        simulationFailures,
        deterministicShortlistCount,
        monteCarloValidatedCount,
        monteCarloConfirmedCount,
        monteCarloFailures,
      },
    };
  }
}
