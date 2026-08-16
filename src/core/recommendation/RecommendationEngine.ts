import type { StrategyRecommendation } from '../entities/types';
import type { StrategyMonteCarloValidationResult } from '../entities/montecarlo';
import type { RetirementGoals, RetirementProfile, RetirementStrategy } from '../domain/input/retirement';
import type { RankedStrategyCandidate } from '../strategy/StrategyOptimizer';
import { normalizeRetirementGoals } from '../entities/retirementGoal';
import { goalPriorityWeight } from '../evaluation/GoalEvaluationEngine';

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

/**
 * 모든 추천이 목표 달성 확률 0%인가.
 *
 * 0%뿐인 후보군에서는 세 비교자의 1·2순위 키가 모두 동률이라 승자를 정하는 것은
 * `candidate.id.localeCompare` — 사실상 후보 id 알파벳 순이다. 그렇게 뽑힌 카드에 ☆추천을
 * 붙이면 근거 없는 선택을 근거 있는 것처럼 보여준다. 고를 이유가 없는 선택지는 내지 않는다.
 *
 * 빈 배열은 false다. 「도달하지 못했다」와 「추천이 없다」는 사용자가 할 일이 다른 사건이고,
 * 후자는 이미 no_persona_matched·no_candidate_survived가 원인별로 설명한다.
 */
export function noRecommendationReachesGoal(
  recommendations: readonly CandidateRecommendation[],
): boolean {
  return recommendations.length > 0
    && recommendations.every((item) => item.candidate.monteCarlo.goalSuccessProbability === 0);
}

export interface FinalStrategyRecommendations {
  recommendations: CandidateRecommendation[];
  /** ☆추천 배지가 붙는 카드. 선정 규칙은 `selectPrimary` 참조. */
  primary: CandidateRecommendation | null;
}

/**
 * 후보가 사용자의 선택 목표 중 놓친 것들의 순위 가중치 합. 낮을수록 목표를 지킨 것이다.
 *
 * 개수가 아니라 가중치로 세는 이유는 1순위 목표 하나를 버리는 것이 말순위 둘을 버리는 것보다
 * 나쁘기 때문이다. 저울은 `weightedScore`와 공유한다.
 *
 * 목표를 모르는 호출(goals 미전달)과 목표 미선택은 같게 0을 돌려준다. 무엇을 지켜야 하는지
 * 모르는 상태에서 「목표를 지켰다」를 판정할 수는 없고, 그때 남는 기준은 확률뿐이다.
 */
function missedGoalWeight(
  candidate: ValidatedStrategyCandidate,
  goals: RetirementGoals | undefined,
): number {
  const normalized = normalizeRetirementGoals(goals?.selectedGoals ?? []);
  return normalized.reduce((sum, goal) => {
    // goalType으로 짚는다. normalizeRetirementGoals가 타입을 중복 제거하므로 유일하다.
    // 위치로 짚으면 평가 배열이 다른 순서로 만들어졌을 때 조용히 엉뚱한 목표를 센다.
    const evaluation = candidate.evaluation.goalEvaluations
      .find((item) => item.goalType === goal.type);
    // 평가 항목이 없는 것은 「포기했다」가 아니라 「판정 정보가 없다」이다. 벌하지 않는다.
    if (!evaluation || evaluation.achieved) return sum;
    return sum + goalPriorityWeight(goal, normalized.length);
  }, 0);
}

/**
 * ☆추천 배지가 붙는 카드를 고른다. 「목표를 지키면서 가장 확률 높은 안」이다.
 *
 * 예전에는 균형형 고정이었다. 그래서 안정형 70% / 균형형 47%가 나란히 찍힌 화면에서 47%
 * 카드에 ☆이 붙었고, 사용자에게는 근거 없는 선택으로 보였다. 그렇다고 확률 최고만 고르면
 * 은퇴를 늦추고 보수적으로 굴리는 안이 구조적으로 거의 항상 이긴다 — 안정형 비교자는
 * `weightedScore`를 아예 보지 않아 사용자가 고른 목표를 얼마든지 버릴 수 있기 때문이다.
 * 목표 기반 서비스가 「목표를 포기하세요」를 기본값으로 내보내지 않도록 손실을 먼저 본다.
 */
export function selectPrimary(
  recommendations: readonly CandidateRecommendation[],
  goals: RetirementGoals | undefined,
): CandidateRecommendation | null {
  if (recommendations.length === 0) return null;

  const scored = recommendations.map((recommendation, index) => ({
    recommendation,
    missed: missedGoalWeight(recommendation.candidate, goals),
    // 모든 키가 동률일 때 승자가 후보 id 알파벳 순으로 정해지지 않도록 한다.
    // 균형형을 기본값으로 두는 것이 이 배지의 종전 동작이기도 하다.
    tieBreak: (recommendation.persona === 'BALANCED' ? 0 : 1) * recommendations.length + index,
  }));

  return scored.sort((left, right) =>
    (left.missed - right.missed)
    || compareNumberDescending(
      left.recommendation.candidate.monteCarlo.goalSuccessProbability,
      right.recommendation.candidate.monteCarlo.goalSuccessProbability,
    )
    || compareNumberDescending(
      left.recommendation.candidate.evaluation.weightedScore,
      right.recommendation.candidate.evaluation.weightedScore,
    )
    || (left.tieBreak - right.tieBreak),
  )[0].recommendation;
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
  recommend(
    candidates: readonly RankedStrategyCandidate[],
    goals?: RetirementGoals,
  ): FinalStrategyRecommendations {
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
      primary: selectPrimary(recommendations, goals),
    };
  }
}
