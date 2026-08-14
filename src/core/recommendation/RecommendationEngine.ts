import type { StrategyRecommendation } from '../entities/types';
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

export interface CandidateRecommendation {
  persona: RecommendationPersona;
  label: '안정형' | '균형형' | '여유형';
  candidate: RankedStrategyCandidate;
  reason: string;
}

export interface FinalStrategyRecommendations {
  recommendations: CandidateRecommendation[];
  /** 균형형을 기본 제안으로 삼되 후보 부족 시 첫 추천으로 대체한다. */
  primary: CandidateRecommendation | null;
}

type CandidateComparator = (
  left: RankedStrategyCandidate,
  right: RankedStrategyCandidate,
) => number;

function compareNumberDescending(left: number, right: number): number {
  return right - left;
}

function probability(
  candidate: RankedStrategyCandidate,
  key: 'goalSuccessProbability' | 'spendingSuccessProbability' | 'assetSurvivalProbability',
): number {
  return candidate.monteCarlo?.[key] ?? 0;
}

function stableComparator(left: RankedStrategyCandidate, right: RankedStrategyCandidate): number {
  return compareNumberDescending(
    Number(left.candidate.dimensions.assetAllocation === 'CONSERVATIVE'),
    Number(right.candidate.dimensions.assetAllocation === 'CONSERVATIVE'),
  )
    || compareNumberDescending(probability(left, 'assetSurvivalProbability'), probability(right, 'assetSurvivalProbability'))
    || compareNumberDescending(left.monteCarlo?.terminalAssetP10 ?? 0, right.monteCarlo?.terminalAssetP10 ?? 0)
    || compareNumberDescending(probability(left, 'spendingSuccessProbability'), probability(right, 'spendingSuccessProbability'))
    || left.candidate.id.localeCompare(right.candidate.id);
}

function balancedComparator(left: RankedStrategyCandidate, right: RankedStrategyCandidate): number {
  return compareNumberDescending(
    Number(left.candidate.dimensions.assetAllocation === 'BALANCED'),
    Number(right.candidate.dimensions.assetAllocation === 'BALANCED'),
  )
    || compareNumberDescending(probability(left, 'goalSuccessProbability'), probability(right, 'goalSuccessProbability'))
    || compareNumberDescending(left.evaluation.weightedScore, right.evaluation.weightedScore)
    || compareNumberDescending(probability(left, 'spendingSuccessProbability'), probability(right, 'spendingSuccessProbability'))
    || left.candidate.id.localeCompare(right.candidate.id);
}

function comfortableComparator(left: RankedStrategyCandidate, right: RankedStrategyCandidate): number {
  return compareNumberDescending(
    Number(left.candidate.dimensions.spendingPattern === 'FRONT_LOADED'),
    Number(right.candidate.dimensions.spendingPattern === 'FRONT_LOADED'),
  )
    || compareNumberDescending(probability(left, 'spendingSuccessProbability'), probability(right, 'spendingSuccessProbability'))
    || compareNumberDescending(probability(left, 'goalSuccessProbability'), probability(right, 'goalSuccessProbability'))
    || compareNumberDescending(left.evaluation.weightedScore, right.evaluation.weightedScore)
    || left.candidate.id.localeCompare(right.candidate.id);
}

const PERSONAS: ReadonlyArray<{
  persona: RecommendationPersona;
  label: CandidateRecommendation['label'];
  reason: string;
  compare: CandidateComparator;
}> = [
  {
    persona: 'STABLE',
    label: '안정형',
    reason: '보수적 자산배분과 하방 자산·생활비 방어력을 우선했습니다.',
    compare: stableComparator,
  },
  {
    persona: 'BALANCED',
    label: '균형형',
    reason: '목표 성공확률과 목표 적합도, 자산배분의 균형을 우선했습니다.',
    compare: balancedComparator,
  },
  {
    persona: 'COMFORTABLE',
    label: '여유형',
    reason: '은퇴 초반 소비 여력과 생활비 유지 가능성을 우선했습니다.',
    compare: comfortableComparator,
  },
];

/** Converts Monte Carlo-validated candidates into the three user-facing recommendation personas. */
export class RecommendationEngine {
  recommend(candidates: readonly RankedStrategyCandidate[]): FinalStrategyRecommendations {
    const eligible = candidates.filter((candidate) => candidate.monteCarlo !== undefined);
    const used = new Set<string>();
    const recommendations: CandidateRecommendation[] = [];

    for (const definition of PERSONAS) {
      const candidate = [...eligible]
        .filter((item) => !used.has(item.candidate.id))
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
