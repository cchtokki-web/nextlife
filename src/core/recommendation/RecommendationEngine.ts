import type { StrategyRecommendation } from '../entities/types';
import type { StrategyMonteCarloValidationResult } from '../entities/montecarlo';
import type { RetirementGoals, RetirementProfile, RetirementStrategy } from '../domain/input/retirement';
import type { RankedStrategyCandidate } from '../strategy/StrategyOptimizer';
import { normalizeRetirementGoals } from '../entities/retirementGoal';
import { goalPriorityWeight } from '../evaluation/GoalEvaluationEngine';
import { NATIONAL_PENSION_NORMAL_START_AGE } from '../usecases/pension/nationalPensionRules';

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

/**
 * 이 추천이 «지금 계획보다» 나은가.
 *
 * 세 카드는 「더 나은가」가 아니라 「무엇을 가장 잘 하는가」로 뽑힌다
 * (RECOMMENDATION_PERSONAS). 안정형·균형형은 자격 조건 없이 각자의 비교자 1등을 가져가고,
 * 여유형만 은퇴초기 집중형(FRONT_LOADED)이라는 특성을 요구한다. 페르소나는 배타적이며 배열
 * 순서대로 채워지므로 한 후보가 두 자리를 차지할 수 없다 — 현상 유지 후보가 생성 단계에
 * 있어도 많아야 한 자리다. 나머지 자리는 정의상 «변경»을 제안하고, 그 변경이 이득인지는
 * 선정 기준에 들어 있지 않다. 그래서 세 카드가 모두 지금보다 나쁠 수 있다.
 *
 * 그 사실을 화면이 밝히려면 판정이 필요하고, 판정은 한 곳에만 있어야 한다 — ☆배지와
 * 「유지하는 편이 낫다」 안내와 카드의 증감 표시가 서로 다른 답을 말하면 안 된다.
 *
 * **같으면 개선이 아니다.** 같은 결과를 위한 변경을 권하면 사용자는 이득 없는 조작을 한다.
 *
 * **현재 확률을 모르면 판정하지 않는다**(true를 돌려준다). 몬테카를로가 아직 끝나지 않은
 * 상태에서 「개선이 아니다」라고 하면 측정되지 않은 것이 나쁜 것으로 둔갑한다.
 */
export function improvesOnCurrentPlan(
  candidate: RankedStrategyCandidate,
  currentGoalSuccessProbability: number | undefined,
): boolean {
  if (currentGoalSuccessProbability === undefined) return true;
  if (!isValidatedCandidate(candidate)) return true;
  return candidate.monteCarlo.goalSuccessProbability > currentGoalSuccessProbability;
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
    //
    // 점수 «산식»이 없는 목표(hasGoalScoreFormula가 거짓)는 여기서 걸러내지 않는다. 그
    // 목표의 achieved는 상수 false라 «모든» 후보에 같은 무게가 더해지고, 이 값은 후보 간
    // 차이(`left.missed - right.missed`)로만 쓰이므로 상수 항은 순위를 바꾸지 못한다.
    // 실측으로도 걸러낸 판과 그대로 둔 판의 추천이 완전히 같았다. 관찰 가능한 차이가 없는
    // 변경은 테스트로 붙들 수 없어 넣지 않는다 — weightedGoalScore 쪽은 clampScore의
    // 반올림을 지나며 해상도가 실제로 사라졌기에 사정이 달랐다(known-issues 15번).
    if (!evaluation || evaluation.achieved) return sum;
    return sum + goalPriorityWeight(goal, normalized.length);
  }, 0);
}

/**
 * ☆추천의 종합 점수 가중치. 합은 1이다.
 *
 * **왜 확률 하나로 고르지 않는가.** 목표 달성 확률은 «모든 판정 조건을 한 시행에서 함께
 * 만족했는가»라는 이진값의 평균이라, 한 해라도 목표 생활비를 1원 못 채운 시행과 열 해를
 * 통째로 못 채운 시행을 똑같이 실패로 센다. 그 값만으로 고르면 「거의 다 채우지만 자주
 * 아슬아슬한 계획」이 「가끔 크게 무너지는 계획」에 진다. 실제로 사용자가 살아가는 것은
 * 그 «정도»이므로, 같은 몬테카를로에서 나온 나머지 지표를 함께 본다.
 *
 * 확률에 가장 큰 무게를 남기는 것은 그것이 사용자가 고른 목표 전체를 판정한 유일한 값이기
 * 때문이다(resolveGoalSuccessConditions). 나머지 셋은 그 이진 판정이 못 보는 결을 채운다:
 *   - 평균 목표생활비 충족도: 실패의 «깊이». 비이진 지표라 아슬아슬한 계획과 무너진 계획을 가른다.
 *   - 자산 유지 확률: 고갈 위험. 생활비를 연금이 덮는 계획은 고갈해도 생활은 유지되므로
 *     위 두 값과 독립적인 사실이다(montecarlo.ts의 두 성공률 주석).
 *   - 잔여자산: 남는 완충. 절대액은 계획마다 자릿수가 달라 비교 대상들 중 최댓값 대비
 *     비율로 정규화한다 — 이 함수는 언제나 «한 화면에 함께 선» 카드들만 비교한다.
 *
 * 상수로 두는 이유는 SPENDING_INCREASE_GATE와 같다: 이것은 선호(UtilityConfig)가 아니라
 * 배지 하나를 정하는 규칙이고, 테스트가 이 표를 그대로 베껴 쓰지 않도록 export한다.
 */
export const PRIMARY_SELECTION_WEIGHTS = {
  goalSuccessProbability: 0.4,
  averageSpendingFulfillment: 0.25,
  assetSurvivalProbability: 0.25,
  terminalAsset: 0.1,
} as const;

/**
 * ☆이 무엇을 근거로 붙었는지 밝히는 한 줄. 화면과 PDF가 같은 문장을 쓴다.
 *
 * 규칙을 바꾸면 이 문장도 함께 바뀌어야 하므로 규칙 옆에 둔다 — 문구를 화면에 두면
 * 가중치를 조정한 날 배지의 근거만 옛 설명으로 남는다(RECOMMENDATION_PERSONAS.reason과
 * 같은 이유로 core가 소유한다).
 */
export const PRIMARY_SELECTION_NOTE =
  '☆추천은 고른 목표를 가장 적게 놓치는 안을 먼저 고르고, 그중에서 목표 달성 확률·평균 '
  + '목표생활비 충족도·자산 유지 확률·예상 잔여자산을 함께 평가해 정합니다. 성공률만 가장 '
  + '높은 안이 아닙니다.';

/**
 * ☆추천 배지가 붙는 카드를 고른다. 「고른 목표를 가장 적게 버리면서, 몬테카를로 결과가
 * 전반적으로 가장 나은 안」이다.
 *
 * 예전에는 균형형 고정이었다. 그래서 안정형 70% / 균형형 47%가 나란히 찍힌 화면에서 47%
 * 카드에 ☆이 붙었고, 사용자에게는 근거 없는 선택으로 보였다. 그렇다고 확률 최고만 고르면
 * 은퇴를 늦추고 보수적으로 굴리는 안이 구조적으로 거의 항상 이긴다 — 안정형 비교자는
 * `weightedScore`를 아예 보지 않아 사용자가 고른 목표를 얼마든지 버릴 수 있기 때문이다.
 * 목표 기반 서비스가 「목표를 포기하세요」를 기본값으로 내보내지 않도록 손실을 먼저 본다.
 *
 * 그래서 순서는 «목표 보존이 먼저, 그다음 종합 점수»다. 종합 점수의 구성은
 * PRIMARY_SELECTION_WEIGHTS에 있다.
 */
export function selectPrimary(
  recommendations: readonly CandidateRecommendation[],
  goals: RetirementGoals | undefined,
): CandidateRecommendation | null {
  if (recommendations.length === 0) return null;

  // 잔여자산 정규화의 분모. 음수(계획상 있을 수 없지만 타입은 모른다)와 0은 축 자체를
  // 끄는 쪽으로 접는다 — 0으로 나누느니 「이 축으로는 아무도 앞서지 않는다」가 옳다.
  const maxTerminalAsset = Math.max(
    0,
    ...recommendations.map((item) => item.candidate.monteCarlo.terminalAssetMedian),
  );

  const scored = recommendations.map((recommendation, index) => ({
    recommendation,
    missed: missedGoalWeight(recommendation.candidate, goals),
    composite: compositeScore(recommendation.candidate, maxTerminalAsset),
    // 모든 키가 동률일 때 승자가 후보 id 알파벳 순으로 정해지지 않도록 한다.
    // 균형형을 기본값으로 두는 것이 이 배지의 종전 동작이기도 하다.
    tieBreak: (recommendation.persona === 'BALANCED' ? 0 : 1) * recommendations.length + index,
  }));

  return scored.sort((left, right) =>
    (left.missed - right.missed)
    || compareNumberDescending(left.composite, right.composite)
    || compareNumberDescending(
      left.recommendation.candidate.evaluation.weightedScore,
      right.recommendation.candidate.evaluation.weightedScore,
    )
    || (left.tieBreak - right.tieBreak),
  )[0].recommendation;
}

/**
 * ☆추천 종합 점수(0~1). 가중치는 PRIMARY_SELECTION_WEIGHTS가 소유한다.
 *
 * `averageSpendingFulfillmentRate`가 없는 결과(옛 워커 응답)는 완전 충족률로 폴백한다.
 * 폴백은 이진 지표라 이 축의 뜻이 「깊이」에서 「빈도」로 좁아지지만, 그 값이 없다고 축을
 * 0으로 두면 옛 결과의 모든 후보가 이 항목에서 최하점을 받아 나머지 축의 비중이 조용히
 * 커진다 — 비교자들(stableComparator 등)이 같은 폴백을 쓰는 것과 같은 이유다.
 */
export function compositeScore(
  candidate: ValidatedStrategyCandidate,
  maxTerminalAsset: number,
): number {
  const monteCarlo = candidate.monteCarlo;
  const fulfillment = monteCarlo.averageSpendingFulfillmentRate
    ?? monteCarlo.spendingSuccessProbability;
  const terminal = maxTerminalAsset > 0
    ? Math.max(0, Math.min(1, monteCarlo.terminalAssetMedian / maxTerminalAsset))
    : 0;

  return PRIMARY_SELECTION_WEIGHTS.goalSuccessProbability * monteCarlo.goalSuccessProbability
    + PRIMARY_SELECTION_WEIGHTS.averageSpendingFulfillment * fulfillment
    + PRIMARY_SELECTION_WEIGHTS.assetSurvivalProbability * monteCarlo.assetSurvivalProbability
    + PRIMARY_SELECTION_WEIGHTS.terminalAsset * terminal;
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
    || compareNumberDescending(
      left.monteCarlo.averageSpendingFulfillmentRate ?? left.monteCarlo.spendingSuccessProbability,
      right.monteCarlo.averageSpendingFulfillmentRate ?? right.monteCarlo.spendingSuccessProbability,
    )
    || compareNumberDescending(left.monteCarlo.spendingSuccessProbability, right.monteCarlo.spendingSuccessProbability)
    || left.candidate.id.localeCompare(right.candidate.id);
}

function balancedComparator(left: ValidatedStrategyCandidate, right: ValidatedStrategyCandidate): number {
  return compareNumberDescending(left.monteCarlo.goalSuccessProbability, right.monteCarlo.goalSuccessProbability)
    || compareNumberDescending(
      left.monteCarlo.averageSpendingFulfillmentRate ?? left.monteCarlo.spendingSuccessProbability,
      right.monteCarlo.averageSpendingFulfillmentRate ?? right.monteCarlo.spendingSuccessProbability,
    )
    || compareNumberDescending(left.monteCarlo.assetSurvivalProbability, right.monteCarlo.assetSurvivalProbability)
    || compareNumberDescending(left.monteCarlo.terminalAssetMedian, right.monteCarlo.terminalAssetMedian)
    || compareNumberDescending(left.evaluation.weightedScore, right.evaluation.weightedScore)
    || compareNumberDescending(left.monteCarlo.spendingSuccessProbability, right.monteCarlo.spendingSuccessProbability)
    || left.candidate.id.localeCompare(right.candidate.id);
}

function comfortableComparator(left: ValidatedStrategyCandidate, right: ValidatedStrategyCandidate): number {
  return compareNumberDescending(
    left.monteCarlo.averageSpendingFulfillmentRate ?? left.monteCarlo.spendingSuccessProbability,
    right.monteCarlo.averageSpendingFulfillmentRate ?? right.monteCarlo.spendingSuccessProbability,
  )
    || compareNumberDescending(left.monteCarlo.spendingSuccessProbability, right.monteCarlo.spendingSuccessProbability)
    || compareNumberDescending(left.monteCarlo.assetSurvivalProbability, right.monteCarlo.assetSurvivalProbability)
    || compareNumberDescending(left.monteCarlo.terminalAssetMedian, right.monteCarlo.terminalAssetMedian)
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
   * labelled 여유형 must hold a FRONT_LOADED plan or it must not be shown at all.
   *
   * 안정형·균형형은 이제 «축»이 아니라 «비교자»가 정의한다. 예전에는 자산배분 축
   * (CONSERVATIVE/BALANCED)을 자격 조건으로 썼지만, 그 축은 사용자가 입력한 수익률을
   * 5/7/9%로 갈아끼우는 가정 변경일 뿐이어서 없앴다(2026-08-22 수익률 가정 축 분리).
   * 남은 후보들은 모두 같은 수익률 가정을 쓰므로 걸러 낼 자산배분 자체가 없고, 두
   * 페르소나가 무엇을 우선했는지는 compare가 온전히 말한다.
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
    reason: '하방 자산·생활비 방어력을 우선했습니다.',
    // 자격 조건이 아니라 비교자가 이 페르소나를 정의한다(PersonaDefinition.qualifies 주석).
    qualifies: () => true,
    compare: stableComparator,
  },
  {
    persona: 'BALANCED',
    label: '균형형',
    reason: '목표 성공확률과 목표 적합도의 균형을 우선했습니다.',
    qualifies: () => true,
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
 * 조기 국민연금은 연금 공백을 메울 필요가 확인될 때만 사용자 추천에 포함한다.
 *
 * 결정론 후보를 같은 은퇴 나이·소비 패턴으로 짝지어 정상 개시 후보의 60~64세 생활비
 * 부족액을 확인한다. 정상 개시 후보가 공백을 전부 충당할 수 있거나, 비교 후보/연도별 원장이
 * 없어 필요성을 입증하지 못하면 조기수령안을 추천하지 않는다. 후보 생성과 결정론 평가에는
 * 남기고 최종 페르소나 추천 자격만 제한한다.
 */
function prePensionShortfall(candidate: RankedStrategyCandidate): number | null {
  const retirementAge = candidate.candidate.dimensions.retirementAge;
  const bridgeYearCount = NATIONAL_PENSION_NORMAL_START_AGE - retirementAge;
  if (bridgeYearCount <= 0) return null;

  const bridgeYears = candidate.simulation.yearlyResults
    .filter((year) => year.age >= retirementAge && year.age < NATIONAL_PENSION_NORMAL_START_AGE)
    .sort((left, right) => left.age - right.age);
  if (bridgeYears.length !== bridgeYearCount) return null;

  for (let index = 0; index < bridgeYears.length; index += 1) {
    if (bridgeYears[index].age !== retirementAge + index
      || !Number.isFinite(bridgeYears[index].unmetSpending)) return null;
  }
  return bridgeYears.reduce((sum, year) => sum + year.unmetSpending, 0);
}

function hasJustifiedEarlyNationalPension(
  candidate: RankedStrategyCandidate,
  eligible: readonly ValidatedStrategyCandidate[],
): boolean {
  const { dimensions } = candidate.candidate;
  const claimAge = dimensions.nationalPensionStartAge;
  if (claimAge >= NATIONAL_PENSION_NORMAL_START_AGE) return true;

  const earlyShortfall = prePensionShortfall(candidate);
  if (earlyShortfall === null) return false;

  const normalAlternatives = eligible.filter((alternative) => {
    const other = alternative.candidate.dimensions;
    return other.nationalPensionStartAge === NATIONAL_PENSION_NORMAL_START_AGE
      && other.retirementAge === dimensions.retirementAge
      && other.spendingPattern === dimensions.spendingPattern;
  });
  if (normalAlternatives.length === 0) return false;

  // If even one validated normal-start plan covers this bridge, the early claim is not necessary
  // to protect the selected retirement age and spending pattern.
  const normalShortfalls = normalAlternatives.map(prePensionShortfall);
  if (normalShortfalls.some((shortfall) => shortfall === null)) return false;
  const completeNormalShortfalls = normalShortfalls.filter(
    (shortfall): shortfall is number => shortfall !== null,
  );
  const bestNormalShortfall = Math.min(...completeNormalShortfalls);

  return bestNormalShortfall > earlyShortfall;
}

/**
 * Converts Monte Carlo-validated candidates into the user-facing recommendation personas.
 *
 * A persona is emitted only when a candidate genuinely carries its defining trait, so fewer than
 * three cards is a normal outcome — 여유형은 FRONT_LOADED 후보가 없으면 나오지 않는다.
 * Personas are exclusive and filled in array order: 안정형이 먼저 자기 비교자의 1등을 가져가고,
 * 균형형은 남은 것 중에서, 여유형은 다시 남은 것 중에서 고른다. 그래서 세 카드는 언제나
 * 서로 다른 계획이다.
 *
 * **다만 이 배타성은 후보 id로만 잰다.** id가 다른데 결정론 결과는 한 해도 빠짐없이 같은
 * 후보들이 실제로 있었고(빈 ISA에 대한 ISA_FIRST), 그때 세 카드는 실은 두 개를 뜻했다.
 * 그래서 결과 수준의 중복은 여기 오기 «전에» 접힌다 — StrategyOptimizer의
 * dedupeByDeterministicOutcome. 두 곳이 함께 있어야 위 문장이 참이 된다.
 */
export class RecommendationEngine {
  recommend(
    candidates: readonly RankedStrategyCandidate[],
    goals?: RetirementGoals,
  ): FinalStrategyRecommendations {
    const eligible = candidates.filter(isValidatedCandidate);
    const recommendationCandidates = eligible.filter((candidate) =>
      hasJustifiedEarlyNationalPension(candidate, eligible));
    const used = new Set<string>();
    const recommendations: CandidateRecommendation[] = [];

    for (const definition of RECOMMENDATION_PERSONAS) {
      const candidate = recommendationCandidates
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
