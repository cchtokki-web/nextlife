import type { RetirementGoal, RetirementGoalType } from '../entities/retirementGoal';
import { hardSpendingFloorTarget, normalizeRetirementGoals } from '../entities/retirementGoal';
import type {
  SimulationResult,
  SimulationParams,
  SimulationYearlyResult,
  StrategySimulationResult,
  UtilityBreakdown,
  UtilityRaws,
} from '../entities/types';
import type {
  RetirementGoals,
  RetirementProfile,
  RetirementStrategy,
} from '../domain/input/retirement';
import { LegacySimulationAdapter } from '../domain/input/LegacySimulationAdapter';
import { SHORTFALL_EPSILON_MONTHLY } from '../usecases/metrics/SimulationMetricsCalculator';
import { hasSpendingShortfall } from '../usecases/spending/spendingShortfall';
import {
  annualAmountForYear,
  computeConsumptionRaw,
  computeLifetimeUtility,
  computeUtilityRaws,
  targetAnnualSpendingForYear,
} from '../usecases/utility/UtilityEngine';

export type HardConstraintFailureCode =
  | 'HARD_RETIREMENT_AGE'
  | 'HARD_SPENDING_SHORTFALL'
  | 'HARD_ASSET_SURVIVAL'
  | 'HARD_MINIMUM_ENDING_ASSETS'
  /**
   * A custom engine rejected the candidate through the deprecated boolean without naming a
   * constraint. Synthesised so a rejection always carries a reason — never invented for a
   * candidate that was not actually rejected.
   */
  | 'HARD_UNSPECIFIED';

/**
 * 사유 문장에 들어가는 금액. 원 단위 정수 + 천 단위 구분자 + 단위까지 붙여야 사람이 읽을 수
 * 있다 — `HARD 목표 3000000`은 300만원인지 30만원인지 눈으로 세어야 한다. 형식만 바꿀 뿐
 * 값을 환산하지 않는다(만원·억원 접기는 표시 계층의 일이다).
 */
function krw(amount: number): string {
  return `${Math.round(amount).toLocaleString('ko-KR')}원`;
}

export interface HardConstraintFailure {
  code: HardConstraintFailureCode;
  /** Absent only for HARD_UNSPECIFIED, where no goal was named by the rejecting engine. */
  goalType?: RetirementGoalType;
  reason: string;
}

/**
 * The single definition of the HARD early-retirement rule.
 *
 * It is checked twice — once before simulation by HardConstraintFilter on static strategy facts,
 * once after evaluation here — so the predicate and its reason string must exist in one place.
 * Two copies would let a pre-simulation rejection disagree with a post-evaluation pass.
 */
export function retirementAgeHardFailure(
  retirementAge: number,
  goal: RetirementGoal,
): HardConstraintFailure | null {
  if (goal.targetValue === undefined || retirementAge <= goal.targetValue) return null;
  return {
    code: 'HARD_RETIREMENT_AGE',
    goalType: goal.type,
    reason: `전략 은퇴 나이 ${retirementAge}세가 HARD 목표 ${goal.targetValue}세보다 늦습니다.`,
  };
}

/**
 * 목표별 실측치와 목표치, **그리고 그 단위**.
 *
 * 예전에는 `actualValue`/`targetValue`가 맨 number였고 의미가 goalType에 따라 달라졌다 —
 * EARLY_RETIREMENT와 ASSET_SURVIVAL에서는 나이, INHERITANCE·ASSET_GROWTH에서는 금액,
 * 생활비 목표에서는 월 금액. 그래서 이 값을 표시하려면 표시 계층이 goalType을 다시 분기해
 * 단위를 추측해야 했다. AGENTS.md는 나이와 연도, 금액 단위를 섞지 말라고 못박는데, 그
 * 혼용이 한 인터페이스 안에 들어 있던 셈이다.
 *
 * 단위를 판별자로 올리면 표시 계층은 `switch (measurement.unit)` 하나로 끝나고, 새 단위가
 * 생기면 컴파일러가 누락된 분기를 잡아 준다.
 */
export type GoalMeasurement =
  | { unit: 'NONE' }
  | { unit: 'AGE' | 'MONEY' | 'MONTHLY_MONEY'; actual?: number; target?: number };

/**
 * 목표 충돌에서 한 목표가 «얼마나» 미달했는가. 단위를 값에 실어 표시 계층이 goalType으로
 * 단위를 되짚지 않게 한다(GoalMeasurement 주석과 같은 이유).
 *
 * GoalMeasurement의 'AGE'와 달리 'YEARS'를 쓰는 자리가 있다. 여기 amount는 «차이»이기
 * 때문이다 — 「78세」와 「계획보다 12년 이르다」는 다른 것이고, 한 이름으로 부르면 화면이
 * 기간을 나이로 찍는다.
 */
export type GoalShortfall =
  | { unit: 'MONEY' | 'MONTHLY_MONEY'; amount: number }
  | { unit: 'YEARS'; amount: number };

/** 충돌에 «참가한» 목표 하나. 이긴 쪽과 진 쪽을 계층 번호로 가른다. */
export interface ConflictingGoal {
  goalType: RetirementGoalType;
  /**
   * 스펙 「제약 계층」의 번호. 1 = HARD 생활비 바닥, 2 = 그 밖의 HARD 목표(상속 하한선·자산
   * 고갈 방지). 낮은 계층이 이기고 높은 계층이 양보한다.
   */
  constraintLayer: 1 | 2;
  /** 그 목표의 미달액. 이긴 쪽도 0이 아닐 수 있다 — 이겼는데도 못 채운 해가 있으면 남는다. */
  shortfall: GoalShortfall;
}

export interface GoalEvaluation {
  goalType: RetirementGoalType;
  score: number;
  achieved: boolean;
  measurement: GoalMeasurement;
  reason: string;
}

export interface StrategyEvaluation {
  /**
   * @deprecated `hardConstraintFailures`가 판정의 단일 근거다. 이 불리언은 상세 목록과
   * 모순될 수 있어(양쪽을 각자 채울 수 있으므로) 더 이상 단독으로 읽지 않는다.
   * 예전 계약을 구현한 외부 엔진이 상세 없이 이 값만 false로 주는 경우를 계속 존중하기
   * 위해 남겨 두며, 그 조정은 `HardConstraintFilter.afterEvaluation` 한 곳에서만 한다.
   */
  hardConstraintsSatisfied?: boolean;
  goalEvaluations: GoalEvaluation[];
  weightedScore: number;
}

/**
 * Compatibility result for callers introduced before per-goal evaluation.
 * `score` and `utility` remain available, but new recommendation ranking uses `weightedScore`.
 */
export interface GoalEvaluationResult extends StrategyEvaluation {
  /** @deprecated Legacy lifetime-utility score. Use weightedScore for goal-based ranking. */
  score: number;
  /** Auxiliary lifetime-utility metric; it is not the primary recommendation score. */
  utility: UtilityBreakdown;
  hardConstraintFailures: HardConstraintFailure[];
  /** HARD goals that current facts/results cannot quantify are exposed, never silently claimed. */
  unsupportedHardGoals: RetirementGoalType[];
  /**
   * 목표끼리 다퉜고 계층이 그것을 해소했는가. 엔진이 조용히 하나를 포기하지 않게 하는 값이다.
   *
   * 기존 hardConstraintFailures를 «대체하지 않는다». 그쪽은 「어느 목표가 미달했는가」이고
   * 이쪽은 「왜 미달했는가 — 사용자가 고른 다른 목표가 이겼기 때문인가」다. 호출부는 지금처럼
   * hardConstraintFailures만 읽어도 계속 동작한다.
   *
   * `undefined`는 «false»가 아니라 «이 엔진은 판정하지 않았다»는 뜻이다. hardConstraintsSatisfied와
   * 같은 이유로 옛 계약을 구현한 외부 엔진이 채우지 않아도 계약이 깨지지 않게 둔다 —
   * DefaultGoalEvaluationEngine은 언제나 셋을 함께 채운다.
   */
  goalConflict?: boolean;
  /** 충돌한 목표들과 각자의 미달액. 충돌이 없으면 빈 배열이다. */
  conflictingGoals?: ConflictingGoal[];
  /**
   * 양보한 목표. 계층이 «다를» 때만 존재한다 — 같은 계층의 HARD 목표끼리는 어느 하나를
   * 고르지 않으므로(스펙 「동일 계층 HARD 충돌 — 임의 희생 금지」) 언제나 undefined다.
   *
   * 계층 2의 여러 목표가 «함께» 양보한 경우에도 undefined다. 그중 하나를 임의로 고르면
   * 나머지가 조용히 사라지므로, 전부는 conflictingGoals가 말한다.
   */
  yieldedGoal?: RetirementGoalType;
}

export interface GoalEvaluationEngine {
  evaluate(
    profile: RetirementProfile,
    goals: RetirementGoals,
    strategy: RetirementStrategy,
    result: StrategySimulationResult,
  ): GoalEvaluationResult;
}

/**
 * `Math.max(0, NaN)` is `NaN`, so the obvious clamp silently passes non-finite values straight
 * through. A `NaN` score reaches the ranking comparators, where `NaN - NaN` makes the sort order
 * arbitrary while every consumer still treats position 0 as "the best strategy for you".
 * A non-finite score is a bug in the calculation upstream, not a value to render.
 */
function clampScore(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error(`Goal score must be a finite number, received ${value}`);
  }
  return Math.round(Math.min(100, Math.max(0, value)));
}

function asUtilityResult(
  strategy: RetirementStrategy,
  result: StrategySimulationResult,
): SimulationResult {
  const retirementYear = result.yearlyResults.find((year) => year.age >= strategy.retirementAge);
  return {
    ...result,
    fireAge: null,
    retirementScore: 0,
    retirementGrade: '보통',
    goalAchievementRate: 0,
    retirementAssetsAtRetirement: retirementYear?.openingAssets ?? 0,
  };
}

function rawScore(raw: number): number {
  return clampScore(raw * 100);
}

function minimumTargetScore(actual: number, target: number): number {
  if (target <= 0) return 100;
  return clampScore(actual / target * 100);
}

function minimumEndingAssetEvaluation(
  goal: RetirementGoal,
  result: StrategySimulationResult,
  targetValue: number,
): GoalEvaluation {
  const achieved = result.endingAssets >= targetValue;
  return {
    goalType: goal.type,
    score: minimumTargetScore(result.endingAssets, targetValue),
    achieved,
    measurement: { unit: 'MONEY', actual: result.endingAssets, target: targetValue },
    reason: achieved
      ? `기말 자산이 목표 금액 ${targetValue}을 충족합니다.`
      : `기말 자산 ${result.endingAssets}이 목표 ${targetValue}에 미달합니다.`,
  };
}

function retirementAgeEvaluation(goal: RetirementGoal, strategy: RetirementStrategy): GoalEvaluation {
  const targetValue = goal.targetValue;
  if (targetValue === undefined) {
    return {
      goalType: goal.type,
      score: 0,
      achieved: false,
      measurement: { unit: 'AGE', actual: strategy.retirementAge },
      reason: '희망 은퇴 나이가 없어 달성도를 계산할 수 없습니다.',
    };
  }

  const achieved = strategy.retirementAge <= targetValue;
  return {
    goalType: goal.type,
    score: achieved ? 100 : clampScore(targetValue / strategy.retirementAge * 100),
    achieved,
    measurement: { unit: 'AGE', actual: strategy.retirementAge, target: targetValue },
    reason: achieved
      ? `${targetValue}세 이하 은퇴 목표를 충족합니다.`
      : `전략 은퇴 나이 ${strategy.retirementAge}세가 목표 ${targetValue}세보다 늦습니다.`,
  };
}

function spendingEvaluation(
  goal: RetirementGoal,
  strategy: RetirementStrategy,
  result: StrategySimulationResult,
  params: SimulationParams,
): GoalEvaluation {
  const retirementYears = result.yearlyResults.filter((year) => year.age >= strategy.retirementAge);
  const goalParams = spendingGoalParams(goal, strategy, params);
  const shortfallYears = retirementYears.filter(
    (year) => isGoalSpendingShortfall(goal, strategy, goalParams, year),
  ).length;
  const score = rawScore(computeConsumptionRaw(goalParams, retirementYears));
  return {
    goalType: goal.type,
    score,
    achieved: retirementYears.length > 0 && shortfallYears === 0,
    measurement: goal.targetValue === undefined
      ? { unit: 'MONTHLY_MONEY' }
      : { unit: 'MONTHLY_MONEY', target: goal.targetValue },
    reason: retirementYears.length === 0
      ? '은퇴 기간 결과가 없어 소비 목표를 평가할 수 없습니다.'
      : shortfallYears === 0
        ? '은퇴 기간 내내 목표 생활비를 충족합니다.'
        : `은퇴 기간 중 ${shortfallYears}개 연도에 목표 생활비 미달이 있습니다.`,
  };
}

function spendingGoalParams(
  goal: RetirementGoal,
  strategy: RetirementStrategy,
  params: SimulationParams,
): SimulationParams {
  const targetMonthlySpending = goal.targetValue ?? strategy.targetMonthlySpending;
  if (targetMonthlySpending === params.userProfile.targetMonthlySpending) {
    return params;
  }
  return {
    ...params,
    userProfile: {
      ...params.userProfile,
      targetMonthlySpending,
    },
  };
}

function isGoalSpendingShortfall(
  goal: RetirementGoal,
  strategy: RetirementStrategy,
  goalParams: SimulationParams,
  year: SimulationResult['yearlyResults'][number],
): boolean {
  // The shortfall ledger belongs to the concrete strategy target. For a different selected goal,
  // compare actual spending with that goal directly so a higher shared target cannot incorrectly
  // fail a lower goal (or a lower shared target pass a higher one).
  const usesStrategyTarget = goal.targetValue === undefined
    || goal.targetValue === strategy.targetMonthlySpending;
  return (usesStrategyTarget && hasSpendingShortfall(year))
    || year.spending < targetAnnualSpendingForYear(goalParams, year);
}

function hasGoalSpendingShortfall(
  goal: RetirementGoal,
  strategy: RetirementStrategy,
  result: StrategySimulationResult,
  params: SimulationParams,
): boolean {
  const goalParams = spendingGoalParams(goal, strategy, params);
  return result.yearlyResults.some((year) =>
    year.age >= strategy.retirementAge
    && isGoalSpendingShortfall(goal, strategy, goalParams, year)
  );
}

/**
 * 그 해에 HARD 생활비 바닥이 얼마나 모자랐는가(연 금액). 바닥을 세우지 않는 목표는 0이다.
 *
 * **엔진의 unmetHardSpending과 다른 것을 잰다.** 엔진의 1단계는 계획이 겨냥한 금액
 * (fundingGap)까지만 채우므로, 계획 자체가 바닥보다 «낮게» 겨냥한 해는 엔진 기준으로 미달이
 * 0이다 — 그리고 그것이 옳다. 런타임에 더 인출해서 고칠 수 있는 집행 실패가 아니라 계획
 * 실패이기 때문이다(SimulationEngine의 annualUnmetHardSpending 주석이 그 판정을 이 계층의
 * 몫으로 남겨 두었다). 목표와 결과를 «둘 다» 보는 이 계층만 그것을 볼 수 있다.
 *
 * 자는 엔진의 바닥과 같다. 물가는 태우고(명목 모드), 연령대 배수(spendingCurve)는 곱하지
 * 않는다 — 곡선은 「이만큼 쓰겠다」는 선호이지 「이만큼은 반드시 쓴다」가 아니다. 실제
 * 지출(year.spending)에 의료비가 포함되고 엔진도 바닥을 그 총액과 비교하므로
 * (min(바닥, targetMonthlyCashNeed) - actualSpending) 여기서도 의료비를 따로 더하지 않는다.
 */
function hardSpendingFloorAnnualShortfall(
  goal: RetirementGoal,
  params: SimulationParams,
  year: SimulationYearlyResult,
): number {
  const floorMonthly = hardSpendingFloorTarget(goal);
  if (floorMonthly === undefined) return 0;
  return Math.max(0, annualAmountForYear(params, floorMonthly, year.age) - year.spending);
}

/**
 * 은퇴 기간 중 가장 크게 모자랐던 해의 월 미달액. 미달이 없으면 0이다.
 *
 * 엡실론을 두는 이유는 unmetSpending과 «재는 방식»이 다르기 때문이다. 저쪽은 인출 경로가
 * 정확히 0으로 닫아 두는 원장값이라 잔차가 없지만(spendingShortfall.ts 주석), 이쪽은 목표와
 * 결과를 각자 계산해 빼는 「목표 대비 재구성 비교」다. 그 비교에 이미 쓰이는 값을 그대로
 * 쓴다 — 새 기준을 만들지 않는다(SHORTFALL_EPSILON_MONTHLY).
 */
function worstMonthlyHardSpendingShortfall(
  goal: RetirementGoal,
  strategy: RetirementStrategy,
  result: StrategySimulationResult,
  params: SimulationParams,
): number {
  let worst = 0;
  for (const year of result.yearlyResults) {
    if (year.age < strategy.retirementAge) continue;
    worst = Math.max(worst, hardSpendingFloorAnnualShortfall(goal, params, year) / 12);
  }
  return worst >= SHORTFALL_EPSILON_MONTHLY ? worst : 0;
}

function assetSurvivalEvaluation(
  goal: RetirementGoal,
  strategy: RetirementStrategy,
  result: StrategySimulationResult,
  raws: UtilityRaws,
): GoalEvaluation {
  const survives = result.depletionAge === null || result.depletionAge > strategy.planHorizonAge;
  return {
    goalType: goal.type,
    score: rawScore(raws.depletionSafety),
    achieved: survives,
    measurement: {
      unit: 'AGE',
      actual: result.depletionAge ?? strategy.planHorizonAge,
      target: strategy.planHorizonAge,
    },
    reason: survives
      ? `계획 종료 나이 ${strategy.planHorizonAge}세까지 자산이 고갈되지 않습니다.`
      : `${result.depletionAge}세에 자산이 고갈됩니다.`,
  };
}

function endingAssetEvaluation(
  goal: RetirementGoal,
  result: StrategySimulationResult,
  raws: UtilityRaws,
): GoalEvaluation {
  const targetValue = goal.targetValue;
  if (targetValue !== undefined) {
    return minimumEndingAssetEvaluation(goal, result, targetValue);
  }

  const score = rawScore(raws.bequestAdequacy);
  return {
    goalType: goal.type,
    score,
    achieved: score === 100,
    measurement: { unit: 'MONEY', actual: result.endingAssets },
    reason: '명시된 목표 금액이 없어 기존 적정 잔여자산 기준으로 평가했습니다.',
  };
}

function assetGrowthEvaluation(
  goal: RetirementGoal,
  strategy: RetirementStrategy,
  result: StrategySimulationResult,
): GoalEvaluation {
  if (goal.targetValue !== undefined) {
    return minimumEndingAssetEvaluation(goal, result, goal.targetValue);
  }

  const retirementYear = result.yearlyResults.find((year) => year.age >= strategy.retirementAge);
  if (retirementYear === undefined) {
    // Falling back to 0 here would make the comparison "endingAssets >= 0" — trivially true, and
    // minimumTargetScore(x, 0) returns a perfect 100. An unevaluable goal must never score as met.
    return {
      goalType: goal.type,
      score: 0,
      achieved: false,
      measurement: { unit: 'MONEY', actual: result.endingAssets },
      reason: '은퇴 시점 이후 결과가 없어 자산 성장 목표를 평가할 수 없습니다.',
    };
  }

  const retirementAssets = retirementYear.openingAssets;
  const achieved = result.endingAssets >= retirementAssets;
  return {
    goalType: goal.type,
    score: minimumTargetScore(result.endingAssets, retirementAssets),
    achieved,
    measurement: { unit: 'MONEY', actual: result.endingAssets, target: retirementAssets },
    reason: achieved
      ? '기말 자산이 은퇴 시점 자산 이상으로 유지됩니다.'
      : '기말 자산이 은퇴 시점 자산보다 줄어듭니다.',
  };
}

function evaluateGoal(
  goal: RetirementGoal,
  strategy: RetirementStrategy,
  result: StrategySimulationResult,
  raws: UtilityRaws,
  params: SimulationParams,
): GoalEvaluation {
  switch (goal.type) {
    case 'EARLY_RETIREMENT':
      return retirementAgeEvaluation(goal, strategy);
    case 'LIVING_EXPENSE_STABILITY':
    case 'COMFORTABLE_SPENDING':
      return spendingEvaluation(goal, strategy, result, params);
    case 'ASSET_SURVIVAL':
      return assetSurvivalEvaluation(goal, strategy, result, raws);
    case 'PENSION_OPTIMIZATION': {
      const score = rawScore(raws.pensionUtilization);
      return {
        goalType: goal.type,
        score,
        achieved: score === 100,
        measurement: { unit: 'NONE' },
        reason: '공적·사적연금 수령 기간과 연금 세금 효율을 평가했습니다.',
      };
    }
    case 'TAX_OPTIMIZATION': {
      const score = rawScore(raws.taxEfficiency);
      return {
        goalType: goal.type,
        score,
        achieved: score === 100,
        measurement: { unit: 'NONE' },
        reason: '기존 세부담률 기준으로 세금 효율을 평가했습니다.',
      };
    }
    case 'RISK_REDUCTION': {
      const score = rawScore(raws.depletionSafety);
      return {
        goalType: goal.type,
        score,
        achieved: score === 100,
        measurement: { unit: 'NONE' },
        reason: '현재 결정론 결과에서 자산 고갈 안전성을 위험 대리지표로 평가했습니다.',
      };
    }
    case 'INHERITANCE':
      return endingAssetEvaluation(goal, result, raws);
    case 'ASSET_GROWTH':
      return assetGrowthEvaluation(goal, strategy, result);
    case 'HOUSING_STABILITY':
      return {
        goalType: goal.type,
        score: 0,
        achieved: false,
        measurement: { unit: 'NONE' },
        reason: '현재 프로필과 시뮬레이션 결과에 주거 안정을 정량화할 정보가 없습니다.',
      };
  }
}

/**
 * 목표 하나의 순위 가중치. 1순위가 가장 무겁고 마지막 순위가 1이다.
 *
 * `weightedScore`와 추천 배지(RecommendationEngine)가 같은 저울을 써야 한다. 두 곳이 각자
 * 가중치를 계산하면 「점수는 이 카드가 높은데 배지는 저 카드」가 설명 불가능해진다.
 * 인자는 정규화된 목표 배열(`normalizeRetirementGoals`)의 것이어야 priority가 1..N이다.
 */
export function goalPriorityWeight(goal: RetirementGoal, goalCount: number): number {
  return goalCount - goal.priority + 1;
}

function weightedGoalScore(
  goals: readonly RetirementGoal[],
  evaluations: readonly GoalEvaluation[],
  fallbackScore: number,
): number {
  if (goals.length === 0) return fallbackScore;
  const totalWeight = goals.reduce((sum, goal) => sum + goalPriorityWeight(goal, goals.length), 0);
  const total = evaluations.reduce(
    (sum, evaluation, index) => sum + evaluation.score * goalPriorityWeight(goals[index], goals.length),
    0,
  );
  return totalWeight > 0 ? clampScore(total / totalWeight) : 0;
}

/**
 * 1단계(HARD 생활비 바닥)가 계층 2의 하한선을 «깬» 해가 있는가.
 *
 * 엔진이 자기 말로 남긴 사실만 읽는다. 엔진은 목표를 모르고 「assetFloor를 깼다」까지만
 * 적으며, 그것을 「HARD 생활비 목표가 HARD 상속 목표를 이겼다」로 옮기는 것이 이 계층의 일이다.
 *
 * `assetFloorBreachedBy: 'taxObligation'`은 «읽지 않는다». 납세는 계층 밖이라 어떤 목표도
 * 이기지 못하며, 세금이 하한선을 넘겨 징수된 해는 목표끼리 다툰 것이 아니라 법적 의무가
 * 이긴 것이다. 그 해를 충돌로 세면 conflictingGoals의 숫자가 「어느 목표에 얼마를 양보했나」를
 * 뜻하지 못하게 된다. 엔진이 두 사실을 다른 자리에 적어 두는 이유가 그것이다.
 */
function brokeAssetFloorForHardSpendingFloor(result: StrategySimulationResult): boolean {
  return result.yearlyResults.some((year) => {
    const diagnostics = year.ledger?.diagnostics;
    return diagnostics !== undefined
      && diagnostics.overrideReason === 'hardSpendingFloor'
      && diagnostics.brokenPreferences.includes('assetFloor');
  });
}

/**
 * 계층 2에서 «실제로» 잃은 목표들. assetFloor는 상속 하한선과 자산 고갈 방지가 합쳐진 하나의
 * 스칼라라(compileStrategy) 어느 목표가 얼마를 잃었는지는 결과에서 되읽어야 한다.
 *
 * 하한선을 깬 사실만으로는 참가자가 되지 않는다. `brokenPreferences`의 'assetFloor'는
 * 「기말 자산이 하한선 아래로 내려갔다」가 아니라 «계층 2 클램프가 물렸을 것이다»를 뜻하고,
 * 양도세 준비금이 대차대조표에 남는 해에는 자산이 실제로 하한선을 넘기 «직전»에 선다.
 * 목표가 끝내 충족됐다면 아무도 양보하지 않은 것이므로 충돌로 적지 않는다.
 *
 * 정량 목표만 참가한다 — 미달액을 말할 수 없는 목표(targetValue 없는 HARD 상속)는 이미
 * unsupportedHardGoals로 드러나 있고, 여기에 숫자를 지어내면 충돌 보고가 근거를 잃는다.
 */
function yieldedLayerTwoGoals(
  goals: readonly RetirementGoal[],
  strategy: RetirementStrategy,
  result: StrategySimulationResult,
  failures: readonly HardConstraintFailure[],
): ConflictingGoal[] {
  const failedTypes = new Set(failures.map((failure) => failure.goalType));
  const conflicting: ConflictingGoal[] = [];

  for (const goal of goals) {
    if (goal.constraintType !== 'HARD' || !failedTypes.has(goal.type)) continue;

    // 상속 하한선. assetFloor의 «크기»를 정하는 목표다.
    if (goal.type === 'INHERITANCE' && goal.targetValue !== undefined) {
      conflicting.push({
        goalType: goal.type,
        constraintLayer: 2,
        shortfall: { unit: 'MONEY', amount: Math.max(0, goal.targetValue - result.endingAssets) },
      });
      continue;
    }

    // 자산 고갈 방지. 없던 하한선을 0에서 올릴 뿐이라 미달을 금액으로 말할 수 없다 —
    // 이 목표가 재는 것은 「계획 종료까지 버텼는가」이므로 미달도 기간으로 적는다.
    if (goal.type === 'ASSET_SURVIVAL' && result.depletionAge !== null) {
      conflicting.push({
        goalType: goal.type,
        constraintLayer: 2,
        shortfall: { unit: 'YEARS', amount: Math.max(0, strategy.planHorizonAge - result.depletionAge) },
      });
    }
  }

  return conflicting;
}

/**
 * 엔진이 남긴 사실을 «목표 언어»로 옮긴다.
 *
 * 오늘 이 자리에서 성립하는 충돌은 교차 계층 하나뿐이다 — 계층 1(HARD 생활비 바닥)이
 * 계층 2(assetFloor)를 깬 경우. 계층이 다르므로 자동으로 해소되고, 이긴 쪽과 진 쪽을 함께
 * 적는다.
 *
 * **동일 계층은 오늘 충돌하지 않는다.** 계층 2의 두 런타임 제약(상속 하한선·자산 고갈 방지)이
 * `Math.max`로 합쳐져 언제나 하나의 바닥이 되기 때문이다(compileStrategy). 자산 고갈 방지는
 * 없던 바닥을 1로 올릴 뿐 상속 하한선을 «낮추지» 못하므로 순수하게 단조롭다. 그래서 둘이
 * 함께 양보하는 일은 있어도 서로 다투지는 않는다. 그런 제약이 계층 2에 추가되는 날을 위해
 * 규칙만 적어 둔다: 같은 계층이면 어느 하나를 고르지 않고 둘 다 conflictingGoals에 남기며
 * yieldedGoal은 비운다.
 *
 * 계층 3(SOFT) 이하는 여기서 세지 않는다. 2단계에서 전략 선호나 연금 한도에 막혀 SOFT 목표가
 * 못 채워진 해는 «아무 제약도 깨지지 않은» 정상적인 우선순위 적용이고, 그 미달은 이미 그
 * 목표의 점수와 unmetSpending으로 드러난다. 그것까지 「목표 충돌」이라 부르면 평범한 계획이
 * 전부 충돌로 보고되어 진짜 충돌이 묻힌다.
 */
function detectGoalConflict(
  goals: readonly RetirementGoal[],
  strategy: RetirementStrategy,
  result: StrategySimulationResult,
  params: SimulationParams,
  failures: readonly HardConstraintFailure[],
): Pick<GoalEvaluationResult, 'goalConflict' | 'conflictingGoals' | 'yieldedGoal'> {
  const quiet = { goalConflict: false, conflictingGoals: [] };
  if (!brokeAssetFloorForHardSpendingFloor(result)) return quiet;

  // 이긴 쪽 — 바닥의 «근거»가 된 목표들. 엔진이 받은 바닥은 이들의 max 하나뿐이므로
  // (compileStrategy) 하한선을 깬 것은 이들 전부의 몫이다.
  const winners: ConflictingGoal[] = goals
    .filter((goal) => hardSpendingFloorTarget(goal) !== undefined)
    .map((goal) => ({
      goalType: goal.type,
      constraintLayer: 1 as const,
      shortfall: {
        unit: 'MONTHLY_MONEY' as const,
        amount: worstMonthlyHardSpendingShortfall(goal, strategy, result, params),
      },
    }));
  const yielded = yieldedLayerTwoGoals(goals, strategy, result, failures);
  if (winners.length === 0 || yielded.length === 0) return quiet;

  return {
    goalConflict: true,
    conflictingGoals: [...winners, ...yielded],
    // 여럿이 함께 양보했으면 비운다 — 하나를 골라 적으면 나머지가 조용히 사라진다.
    ...(yielded.length === 1 ? { yieldedGoal: yielded[0].goalType } : {}),
  };
}

/** Evaluates every selected goal independently; lifetime utility remains an auxiliary metric. */
export class DefaultGoalEvaluationEngine implements GoalEvaluationEngine {
  evaluate(
    profile: RetirementProfile,
    goals: RetirementGoals,
    strategy: RetirementStrategy,
    result: StrategySimulationResult,
  ): GoalEvaluationResult {
    const params = LegacySimulationAdapter.toLegacy(profile, goals, strategy);
    const utilityResult = asUtilityResult(strategy, result);
    const utility = computeLifetimeUtility(utilityResult, params, strategy.utilityConfig);
    const raws = computeUtilityRaws(utilityResult, params, strategy.utilityConfig);
    const normalizedGoals = normalizeRetirementGoals(goals.selectedGoals ?? []);
    const goalEvaluations = normalizedGoals.map(
      (goal) => evaluateGoal(goal, strategy, result, raws, params),
    );
    const hardConstraintFailures: HardConstraintFailure[] = [];
    const unsupportedHardGoals: RetirementGoalType[] = [];

    for (const goal of normalizedGoals) {
      if (goal.constraintType !== 'HARD') continue;

      if (goal.type === 'EARLY_RETIREMENT' && goal.targetValue !== undefined) {
        const failure = retirementAgeHardFailure(strategy.retirementAge, goal);
        if (failure) hardConstraintFailures.push(failure);
        continue;
      }

      if (goal.type === 'LIVING_EXPENSE_STABILITY' || goal.type === 'COMFORTABLE_SPENDING') {
        const hasShortfall = hasGoalSpendingShortfall(goal, strategy, result, params);
        // 계획이 겨냥한 금액 자체가 이 목표의 바닥보다 낮은 경우(연령대 배수로 목표가
        // 내려간 해, dividend_only, 목표 유도의 어긋남)는 위 판정이 잡지 못한다 — 그쪽은
        // 계획의 목표를 자로 쓰고 그 자에는 같은 배수가 이미 곱해져 있기 때문이다.
        // 엔진도 잡지 못한다(hardSpendingFloorAnnualShortfall 주석). 그대로 두면
        // 「반드시 월 300만원」이 250만원으로 조용히 달성 처리된다.
        const floorShortfall = worstMonthlyHardSpendingShortfall(goal, strategy, result, params);
        if (hasShortfall || floorShortfall > 0) {
          // 부족이 잡혔다면 이 목표가 바닥을 세웠다는 뜻이라 목표치가 반드시 있다. 사유에
          // 적는 금액도 엔진이 실제로 세운 바닥과 같은 함수에서 뽑는다 — targetValue를
          // 직접 읽으면 가드(0·undefined)가 갈라진다.
          const floorMonthly = hardSpendingFloorTarget(goal) ?? 0;
          hardConstraintFailures.push({
            code: 'HARD_SPENDING_SHORTFALL',
            goalType: goal.type,
            reason: hasShortfall
              ? '은퇴 기간 중 목표 생활비 미충족 연도가 있습니다.'
              : `계획이 겨냥한 생활비가 HARD 목표 월 ${krw(floorMonthly)}에 못 미쳐 `
                + `월 ${krw(floorShortfall)}이 모자랍니다.`,
          });
        }
        continue;
      }

      if (goal.type === 'ASSET_SURVIVAL') {
        if (result.depletionAge !== null && result.depletionAge <= strategy.planHorizonAge) {
          hardConstraintFailures.push({
            code: 'HARD_ASSET_SURVIVAL',
            goalType: goal.type,
            reason: `계획 종료 나이 ${strategy.planHorizonAge}세 전에 자산이 고갈됩니다.`,
          });
        }
        continue;
      }

      if ((goal.type === 'INHERITANCE' || goal.type === 'ASSET_GROWTH')
        && goal.targetValue !== undefined) {
        if (result.endingAssets < goal.targetValue) {
          hardConstraintFailures.push({
            code: 'HARD_MINIMUM_ENDING_ASSETS',
            goalType: goal.type,
            reason: `기말 자산이 HARD 목표 ${krw(goal.targetValue)}에 미달합니다.`,
          });
        }
        continue;
      }

      // No current fact/result can prove these qualitative HARD constraints. Keep them visible
      // instead of inventing a pass/fail rule. A targetless retirement/asset goal is malformed too.
      unsupportedHardGoals.push(goal.type);
    }

    const weightedScore = weightedGoalScore(normalizedGoals, goalEvaluations, utility.score);
    // 엔진이 남긴 사실을 목표 언어로 옮긴다. 엔진을 다시 돌리지도, 목표를 엔진에 넘기지도
    // 않는다 — 원장의 진단만 읽는다.
    const conflict = detectGoalConflict(
      normalizedGoals, strategy, result, params, hardConstraintFailures,
    );
    return {
      hardConstraintsSatisfied: hardConstraintFailures.length === 0,
      goalEvaluations,
      weightedScore,
      // Preserve the former lifetime-utility contract. New ranking code intentionally does not
      // consume this compatibility field.
      score: utility.score,
      utility,
      hardConstraintFailures,
      unsupportedHardGoals,
      ...conflict,
    };
  }
}
