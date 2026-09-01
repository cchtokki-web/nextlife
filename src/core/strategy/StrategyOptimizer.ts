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
  type StrategyDimensions,
  type StrategyGenerationDebug,
  type StrategyGenerationOptions,
} from './StrategyGenerator';
import type { StrategyMonteCarloEngine } from '../usecases/montecarlo/MonteCarloEngine';
import {
  RECOMMENDATION_PERSONAS,
  RecommendationEngine,
  noRecommendationReachesGoal,
  selectPrimary,
  type CandidateRecommendation,
  type FinalStrategyRecommendations,
  type ValidatedStrategyCandidate,
} from '../recommendation/RecommendationEngine';
import {
  HardConstraintFilter,
  type HardConstraintRejectionCode,
  type PreSimulationRejectionCode,
} from './HardConstraintFilter';
import { summarizePlanOutcome, type StrategyPlanOutcome } from '../usecases/dashboard/summarizePlanOutcome';

export type { PreSimulationRejectionCode } from './HardConstraintFilter';


export interface RankedStrategyCandidate {
  rank: number;
  candidate: StrategyCandidate;
  simulation: StrategySimulationResult;
  evaluation: GoalEvaluationResult;
  /** Present only when this candidate reached final Monte Carlo validation. */
  monteCarlo?: StrategyMonteCarloValidationResult;
  /**
   * 이 후보의 결정론 원장을 접은 요약(국민연금 실수령액·인출액·세부담).
   *
   * 「국민연금 65세 → 60세」 같은 축 변경이 실제 금액을 얼마나 바꾸는지 카드가 말하려면
   * 필요하다. 옵티마이저 경로에서만 채워지므로 optional이다 — 후보를 손으로 만드는
   * 테스트·픽스처가 이 필드 없이도 유효해야 한다(monteCarlo와 같은 이유).
   */
  outcome?: StrategyPlanOutcome;
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
  /**
   * 결정론 결과가 앞선 후보와 «완전히 같아» 접힌 후보의 수. Monte Carlo 경로에서만 센다.
   *
   * 0이 아니라는 것은 격자의 어떤 축이 이 계획에서 아무 일도 하지 않는다는 뜻이다 —
   * 예컨대 인출기 내내 잔액이 0인 ISA에 대한 ISA_FIRST가 그렇다. 진단에 쓰려고 남긴다.
   */
  duplicateOutcomeCount: number;
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
  /**
   * 현상 유지(= 현재 계획) 후보의 결정론 요약. 카드의 「적용 후 달라지는 수치」에서 «전» 쪽이다.
   *
   * 화면이 들고 있는 현재 계획 실행 결과를 쓰지 않고 여기서 함께 내는 이유: 그쪽은
   * 화면 파이프라인(compileStrategy → applyAiSentinels → engine.run)이 만든 것이고
   * 후보 쪽은 StrategyGenerator가 만든 전략을 SimulationEngine.simulate로 돌린 것이라,
   * 두 경로가 미세하게 달라지면 «아무것도 바꾸지 않는» 후보에도 0이 아닌 차이가 찍힌다.
   * 전·후를 같은 경로에서 뽑아야 차이가 곧 «변경의 효과»가 된다.
   *
   * 현상 유지 후보가 HARD 제약에 걸려 시뮬레이션까지 가지 못하면 undefined다. 그때는
   * 비교할 「전」이 없으므로 화면이 이 블록을 통째로 그리지 않는다.
   */
  baselineOutcome?: StrategyPlanOutcome;
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
     * Screening then confirming is what keeps this affordable. Measured cost is ~0.44ms per
     * projection, so one flat pass of 20 candidates at the default `config.trials` (3,000)
     * would be 60,000 projections (~26s). Screening at 200 and re-running only the three
     * persona winners costs 20 × 200 + 3 × 3,000 = 13,000 projections — measured end to end
     * at 4.7s. The confirmation pass dominates; screening is noise.
     *
     * This term is also what caps the default. At 10,000 trials the same shape measured 13.3s,
     * which reads as "did it freeze?" to someone waiting on a recommendation — that, not any
     * precision threshold, is why the default settled at 3,000 (DEFAULT_MONTE_CARLO_TRIALS).
     *
     * This is why raising `screeningTrials` alongside the default would be a mistake: it buys
     * no displayed precision (see below) and is the one term that multiplies by candidate
     * count rather than by three.
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
 * Keeps the shortlist able to answer every persona — and to answer "keep your current plan".
 *
 * Ranking by deterministic score alone systematically eliminates the traits a persona needs before
 * the persona stage — 여유형이 요구하는 FRONT_LOADED 후보가 대표적이다. 결정론 점수만으로
 * 자르면 그 축을 가진 후보가 한 장도 남지 않아 카드 자체가 사라진다. 페르소나가 내세우는
 * 특성의 자리를 먼저 예약하고, 나머지를 점수순으로 채운다.
 *
 * **현상 유지 후보를 가장 먼저 담는다.** 생성 단계는 같은 이유로 이미 그것을 보호한다
 * (StrategyGenerator가 baseline을 격자보다 먼저 넣어 maxCandidates 상한에 잘리지 않게 한다).
 * 선별 단계에는 그 보호가 없어서, 결정론 점수가 뒤로 밀린 「지금 계획」은 몬테카를로를 받지
 * 못했다. 그러면 균형형 슬롯에서 지금보다 나쁜 안이 이기고, 이미 최선인 계획을 쓰는
 * 사용자에게도 화면이 바꾸라고 말한다 — 현상 유지 후보를 만든 목적 자체가 무너진다.
 *
 * 자리를 예약할 뿐 이기게 하지 않는다. 페르소나 비교자가 여전히 승자를 정하므로, 더 나은
 * 후보가 있으면 현상 유지는 정당하게 진다.
 *
 * 테스트를 위해 export한다 — 이 보호는 `optimize` 전체를 돌리지 않고는 관측할 수 없는데,
 * 그 경로는 결정론 점수 순서에 의존해 "밀린 baseline"을 재현하기 어렵다.
 */
export function personaAwareShortlist(
  accepted: readonly Omit<RankedStrategyCandidate, 'rank'>[],
  limit: number,
  baselineCandidateId?: string,
): Omit<RankedStrategyCandidate, 'rank'>[] {
  const reservedPerPersona = 2;
  const picked = new Set<string>();
  const shortlist: Omit<RankedStrategyCandidate, 'rank'>[] = [];

  const take = (item: Omit<RankedStrategyCandidate, 'rank'>): void => {
    if (picked.has(item.candidate.id) || shortlist.length >= limit) return;
    picked.add(item.candidate.id);
    shortlist.push(item);
  };

  // 현상 유지가 먼저다. 격자 조합과 같은 id를 갖게 된 경우(generator가 중복을 걷어낸 경우)도
  // 그 id로 짚으므로 같은 전략이 두 번 담기지 않는다.
  const baseline = baselineCandidateId === undefined
    ? undefined
    : accepted.find((item) => item.candidate.id === baselineCandidateId);
  if (baseline) take(baseline);

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

/**
 * 사용자가 실제로 조정하게 되는 축. 「현재 계획에 얼마나 가까운가」를 이 축들로만 잰다.
 * `nationalPensionTiming`은 개시 나이에서 파생되므로 세면 같은 차이를 두 번 세게 된다.
 */
const ADJUSTABLE_AXES = [
  'retirementAge',
  'nationalPensionStartAge',
  'withdrawalPolicy',
  'spendingPattern',
] as const satisfies ReadonlyArray<keyof StrategyDimensions>;

/** 중복 판정에 쓸 「현재 계획」. 후보 목록에서 그것을 짚는 id와, 축 비교용 좌표다. */
export interface CurrentPlanReference {
  candidateId: string;
  dimensions: StrategyDimensions;
}

/**
 * 접힌 후보들 중 누구를 남길지 정하는 거리. 작을수록 현재 계획에 가깝다.
 *
 * 현상 유지 후보 자신은 언제나 0이고 나머지는 최소 1이다 — 축 라벨이 우연히 모두 같아도
 * 실제 전략을 들고 있는 쪽이 이겨야 한다.
 *
 * 인출 정책 축은 «미지정»도 값으로 센다. 미지정을 GENERAL_FIRST로 읽어 두면 이 거리가
 * 「현재 계획과 같다」고 답하면서 실제로는 다른 계획인 후보를 대표로 남긴다.
 */
function distanceFromCurrentPlan(
  candidate: StrategyCandidate,
  currentPlan: CurrentPlanReference | undefined,
): number {
  // 현재 계획을 짚을 수 없으면 아무도 우대하지 않는다. 그 경우의 대표는 예전과 같이
  // 결정론 정렬(점수 → 기말자산 → id)의 첫 번째다.
  if (!currentPlan) return 0;
  if (candidate.id === currentPlan.candidateId) return 0;
  return 1 + ADJUSTABLE_AXES
    .filter((axis) => candidate.dimensions[axis] !== currentPlan.dimensions[axis]).length;
}

/**
 * 결과가 같은 후보끼리는 이 키가 같다. 반대는 성립하지 않으므로 «후보군»으로만 쓴다.
 *
 * 전체 원장을 직렬화하는 것은 후보 수백 개에 대해 공짜가 아니다. 대부분의 후보는 기말자산
 * 하나로 이미 갈리므로, 이 싼 키가 겹치는 무리에 대해서만 전체 비교를 한다.
 */
function outcomeBucketKey(item: Omit<RankedStrategyCandidate, 'rank'>): string {
  return `${item.simulation.endingAssets}|${item.simulation.depletionAge}|${item.evaluation.weightedScore}`;
}

/**
 * 「같은 계획인가」의 판정. **결정론 원장 전체와 목표 판정 전체**를 본다.
 *
 * 기말자산만 보면 고갈하는 계획들이 전부 0으로 수렴해 서로 다른 계획까지 접힌다. 반대로
 * 요약 지표 몇 개만 고르면 새 원장 필드가 생겼을 때 조용히 판정이 약해진다. 원장을 통째로
 * 넣으면 필드가 늘어도 판정이 따라온다.
 *
 * 목표 판정(evaluation)까지 넣는 이유는, 원장이 같아도 목표 달성 여부가 다르면 사용자에게
 * 다른 답이기 때문이다. 카드가 파는 것은 숫자가 아니라 「목표를 지키는가」다.
 *
 * **오차 허용치를 두지 않는다.** 실측된 중복은 17자리까지 비트 단위로 같았으므로 허용치가
 * 벌어 주는 것이 없고, 「몇 원까지 같은 것으로 볼까」는 우리가 새로 만들어서는 안 되는
 * 금융적 판단이다(AGENTS.md). 게다가 허용치 비교는 추이적이지 않아 무리 짓기가 순서에
 * 따라 달라진다 — 결정론 파이프라인이 잃어서는 안 되는 성질이다.
 *
 * **남는 오차를 밝혀 둔다.** 결정론 원장이 같아도 몬테카를로가 갈릴 수 있다 — 충격 경로에서는
 * 잔액이 달라 ISA_FIRST의 재정렬이 실제로 작동하는 해가 생긴다. 54 페르소나 실측에서 그런
 * 무리는 360개 중 16개였고, 차이는 목표 확률 0.001(1,000회 중 1회)과 기말 중앙값 0.37%
 * 이내였다. 이 잔차를 없애려면 후보마다 몬테카를로를 한 번 더 돌려야 하는데(전체 비용의
 * 98%가 그것이다), 「1,000회 중 1회」를 위해 지불할 값이 아니다. 사용자가 카드에서 비교하는
 * 계획 자체는 원장이 같은 순간 이미 같은 계획이다.
 */
function outcomeSignature(item: Omit<RankedStrategyCandidate, 'rank'>): string {
  return JSON.stringify([item.simulation, item.evaluation]);
}

/**
 * 결정론 결과가 같은 후보를 하나로 접는다. **Monte Carlo 전에** 한다.
 *
 * 세 장의 카드는 서로 다른 후보 id를 갖도록 배정되지만(RecommendationEngine), id가 다르다고
 * 계획이 다른 것은 아니다. 격자 축의 어떤 값이 이 사용자의 계획에서 아무 일도 하지 않으면
 * (인출기 내내 잔액이 0인 ISA에 대한 ISA_FIRST가 그렇다) 서로 다른 두 후보가 «한 해도
 * 빠짐없이» 같은 원장을 낸다. 그대로 두면 카드 세 장이 실은 두 개를 뜻하고, 접힌 쪽 카드에는
 * 아무것도 바꾸지 않는 「달라지는 점」이 붙는다.
 *
 * 카드마다 시뮬레이션을 한 번 더 돌려 「이 변경이 효과가 있는가」를 묻는 대신 여기서 접는다.
 * 결정론 결과는 이미 손에 있으므로 추가 계산이 없다.
 *
 * 대표는 **현재 계획에 가장 가까운 후보**로 남긴다. 그러면 존재하지 않는 변경점이 문구에서
 * 저절로 사라진다 — 살아남은 후보가 바로 「그 축을 바꾸지 않는」 후보이기 때문이다.
 * 예전에는 마지막 결정자가 `id.localeCompare`였고, 그래서 남는 대표를 알파벳이 정했다.
 *
 * 순서는 입력 순서를 지킨다. 무리의 첫 자리에 대표를 놓으므로, 결정론 정렬이 매겨 둔
 * 순위가 접기 때문에 흔들리지 않는다.
 */
export function dedupeByDeterministicOutcome(
  accepted: readonly Omit<RankedStrategyCandidate, 'rank'>[],
  currentPlan?: CurrentPlanReference,
): { kept: Omit<RankedStrategyCandidate, 'rank'>[]; collapsedCount: number } {
  const bucketCounts = new Map<string, number>();
  for (const item of accepted) {
    const key = outcomeBucketKey(item);
    bucketCounts.set(key, (bucketCounts.get(key) ?? 0) + 1);
  }

  const kept: Omit<RankedStrategyCandidate, 'rank'>[] = [];
  const positionBySignature = new Map<string, number>();
  let collapsedCount = 0;

  for (const item of accepted) {
    const bucket = outcomeBucketKey(item);
    // 싼 키가 유일하면 전체 비교를 할 이유가 없다. 같은 결과라면 이 키도 같았을 것이다.
    if ((bucketCounts.get(bucket) ?? 0) < 2) {
      kept.push(item);
      continue;
    }
    const signature = `${bucket}|${outcomeSignature(item)}`;
    const position = positionBySignature.get(signature);
    if (position === undefined) {
      positionBySignature.set(signature, kept.length);
      kept.push(item);
      continue;
    }
    collapsedCount += 1;
    const incumbent = kept[position];
    if (
      distanceFromCurrentPlan(item.candidate, currentPlan)
      < distanceFromCurrentPlan(incumbent.candidate, currentPlan)
    ) {
      kept[position] = item;
    }
  }

  return { kept, collapsedCount };
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
    let baselineOutcome: StrategyPlanOutcome | undefined;

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
        const outcome = summarizePlanOutcome(simulation.yearlyResults, candidate.strategy.retirementAge);
        // 현상 유지 후보의 요약은 «평가 이전»에 잡는다. 목표 평가에서 탈락하는 계획이라도
        // 그 계획의 원장은 사실이고, 사용자가 지금 살고 있는 것이 바로 그 계획이다 —
        // 「목표를 못 지켜서」 비교 기준이 사라지면 카드는 개선폭을 말할 수 없게 된다.
        if (candidate.id === generated.debug.baselineCandidateId) baselineOutcome = outcome;
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
        accepted.push({ candidate, simulation, evaluation, outcome });
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
    let duplicateOutcomeCount = 0;
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
      // 같은 계획을 두 번 검증하지 않는다. 결정론 결과가 같은 후보를 먼저 접어야
      // shortlistLimit 자리가 «서로 다른» 계획으로 채워지고, 세 카드가 서로 다른 계획이라는
      // RecommendationEngine의 약속이 id 수준이 아니라 결과 수준에서 지켜진다.
      const currentPlanCandidate = generated.candidates
        .find((item) => item.id === generated.debug.baselineCandidateId);
      const deduped = dedupeByDeterministicOutcome(
        accepted,
        currentPlanCandidate
          ? { candidateId: currentPlanCandidate.id, dimensions: currentPlanCandidate.dimensions }
          : undefined,
      );
      duplicateOutcomeCount = deduped.collapsedCount;
      const shortlist = personaAwareShortlist(
        deduped.kept, shortlistLimit, generated.debug.baselineCandidateId,
      );
      deterministicShortlistCount = shortlist.length;

      // **모든 후보가 같은 σ를 쓴다.** 예전에는 후보의 yieldPreset으로 σ를 다시 정했다 —
      // 후보마다 수익률 가정이 달랐을 때, 높은 수익률 후보가 다른 자산배분의 낮은 변동성을
      // 빌려 쓰는 것을 막기 위해서였다. 자산배분 축이 사라져 후보들의 수익률이 모두 같아진
      // 지금은 그 덮어쓰기가 해로울 뿐이다: 채점은 프리셋 σ로, 적용 후 재채점(몬테카를로는
      // 이제 실제 입력 수익률에서 σ를 유도한다)은 다른 σ로 돌아, 카드가 약속한 확률을
      // 적용된 계획이 재현하지 못한다.
      const configFor = (trials: number): MonteCarloConfig => ({ ...fullConfig, trials });

      const validate = (
        item: Omit<RankedStrategyCandidate, 'rank'>,
        trials: number,
      ): Omit<ValidatedStrategyCandidate, 'rank'> | null => {
        try {
          const monteCarlo = engine.validate(profile, goals, item.candidate.strategy, configFor(trials));
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
        screened.map((item, index) => ({ ...item, rank: index + 1 })),
        goals,
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
      // 확정 확률로 다시 고른다. 선별 단계의 primary를 그대로 두면 화면의 ☆이 화면에 나가지
      // 않는 200회 숫자를 근거로 붙는다.
      recommendations.primary = selectPrimary(recommendations.recommendations, goals);

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
      ...(baselineOutcome ? { baselineOutcome } : {}),
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
        duplicateOutcomeCount,
        deterministicShortlistCount,
        monteCarloValidatedCount,
        monteCarloConfirmedCount,
        monteCarloFailures,
      },
    };
  }
}
