import type { StrategyRecommendation } from '../entities/types';
import type { StrategyMonteCarloValidationResult } from '../entities/montecarlo';
import type { RetirementGoals, RetirementProfile, RetirementStrategy } from '../domain/input/retirement';
import type { RankedStrategyCandidate } from '../strategy/StrategyOptimizer';

/** Backward-compatible contract used by the existing sentinel/checklist recommendation path. */
export interface LegacyRecommendationEngineContract {
  recommend(
    profile: RetirementProfile,
    goals: RetirementGoals,
    strategy: RetirementStrategy
  ): StrategyRecommendation;
}

export type RecommendationPersona = 'STABLE' | 'BALANCED' | 'COMFORTABLE';

/**
 * A candidate that provably reached Monte Carlo validation.
 *
 * Narrowing once here is what lets every downstream reader use `monteCarlo` directly. The previous
 * wide type forced `?? 0` fallbacks at each use site, which rendered "not measured" as a confident
 * 0% — the worst possible default for a success probability.
 */
export type ValidatedStrategyCandidate =
  RankedStrategyCandidate & { monteCarlo: StrategyMonteCarloValidationResult };

export function isValidatedCandidate(
  candidate: RankedStrategyCandidate,
): candidate is ValidatedStrategyCandidate {
  return candidate.monteCarlo !== undefined;
}

export interface CandidateRecommendation {
  persona: RecommendationPersona;
  label: '안정형' | '균형형' | '여유형';
  candidate: ValidatedStrategyCandidate;
  reason: string;
}

export interface FinalStrategyRecommendations {
  recommendations: CandidateRecommendation[];
  /** 균형형을 기본 제안으로 삼되 후보 부족 시 첫 추천으로 대체한다. */
  primary: CandidateRecommendation | null;
}

type CandidateComparator = (
  left: ValidatedStrategyCandidate,
  right: ValidatedStrategyCandidate,
) => number;

function compareNumberDescending(left: number, right: number): number {
  return right - left;
}

function stableComparator(left: ValidatedStrategyCandidate, right: ValidatedStrategyCandidate): number {
  return compareNumberDescending(left.monteCarlo.assetSurvivalProbability, right.monteCarlo.assetSurvivalProbability)
    || compareNumberDescending(left.monteCarlo.terminalAssetP10, right.monteCarlo.terminalAssetP10)
    || compareNumberDescending(left.monteCarlo.spendingSuccessProbability, right.monteCarlo.spendingSuccessProbability)
    || left.candidate.id.localeCompare(right.candidate.id);
}

function balancedComparator(left: ValidatedStrategyCandidate, right: ValidatedStrategyCandidate): number {
  return compareNumberDescending(left.monteCarlo.goalSuccessProbability, right.monteCarlo.goalSuccessProbability)
    || compareNumberDescending(left.evaluation.weightedScore, right.evaluation.weightedScore)
    || compareNumberDescending(left.monteCarlo.spendingSuccessProbability, right.monteCarlo.spendingSuccessProbability)
    || left.candidate.id.localeCompare(right.candidate.id);
}

function comfortableComparator(left: ValidatedStrategyCandidate, right: ValidatedStrategyCandidate): number {
  return compareNumberDescending(left.monteCarlo.spendingSuccessProbability, right.monteCarlo.spendingSuccessProbability)
    || compareNumberDescending(left.monteCarlo.goalSuccessProbability, right.monteCarlo.goalSuccessProbability)
    || compareNumberDescending(left.evaluation.weightedScore, right.evaluation.weightedScore)
    || left.candidate.id.localeCompare(right.candidate.id);
}

export interface PersonaDefinition {
  persona: RecommendationPersona;
  label: CandidateRecommendation['label'];
  reason: string;
  /**
   * The trait the persona's copy actually claims. It is a filter, not a sort preference: a card
   * labelled 안정형 must hold a CONSERVATIVE strategy or it must not be shown at all.
   */
  qualifies(candidate: RankedStrategyCandidate): boolean;
  compare: CandidateComparator;
}

/**
 * Exported so the optimizer can reserve shortlist room for each persona. The defining trait must
 * live in exactly one place, or the shortlist and the labelling can disagree about what 안정형 is.
 */
export const RECOMMENDATION_PERSONAS: ReadonlyArray<PersonaDefinition> = [
  {
    persona: 'STABLE',
    label: '안정형',
    reason: '보수적 자산배분과 하방 자산·생활비 방어력을 우선했습니다.',
    qualifies: (candidate) => candidate.candidate.dimensions.assetAllocation === 'CONSERVATIVE',
    compare: stableComparator,
  },
  {
    persona: 'BALANCED',
    label: '균형형',
    reason: '목표 성공확률과 목표 적합도, 자산배분의 균형을 우선했습니다.',
    qualifies: (candidate) => candidate.candidate.dimensions.assetAllocation === 'BALANCED',
    compare: balancedComparator,
  },
  {
    persona: 'COMFORTABLE',
    label: '여유형',
    reason: '은퇴 초반 소비 여력과 생활비 유지 가능성을 우선했습니다.',
    qualifies: (candidate) => candidate.candidate.dimensions.spendingPattern === 'FRONT_LOADED',
    compare: comfortableComparator,
  },
];

/**
 * Converts Monte Carlo-validated candidates into the user-facing recommendation personas.
 *
 * A persona is emitted only when a candidate genuinely carries its defining trait, so fewer than
 * three cards is a normal outcome. Each persona previously took the best of *all* candidates with
 * the trait as a mere tiebreak, which labelled growth strategies 안정형 and printed
 * "보수적 자산배분을 우선했습니다" beside them. Personas are exclusive and filled in array order.
 */
export class RecommendationEngine {
  recommend(candidates: readonly RankedStrategyCandidate[]): FinalStrategyRecommendations {
    const eligible = candidates.filter(isValidatedCandidate);
    const used = new Set<string>();
    const recommendations: CandidateRecommendation[] = [];

    for (const definition of RECOMMENDATION_PERSONAS) {
      const candidate = eligible
        .filter((item) => !used.has(item.candidate.id) && definition.qualifies(item))
        .sort(definition.compare)[0];
      if (!candidate) continue;
      used.add(candidate.candidate.id);
      recommendations.push({
        persona: definition.persona,
        label: definition.label,
        candidate,
        reason: definition.reason,
      });
    }

    return {
      recommendations,
      primary: recommendations.find((item) => item.persona === 'BALANCED')
        ?? recommendations[0]
        ?? null,
    };
  }
}
