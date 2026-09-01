import {
  RETIREMENT_GOAL_CONSTRAINT_LABELS,
  confirmedTargetValue,
  hardGoalAwaitsTargetConfirmation,
  normalizeRetirementGoals,
  type RetirementGoal,
  type RetirementGoalType,
} from '../../entities/retirementGoal';
import type { SimulationParams } from '../../entities/types';

// 목표 달성 확률이 무엇을 근거로 조건을 골랐는지.
//   selected_goals    = 사용자가 고른 목표에서 조건을 유도했다
//   plan_defaults     = 고른 목표에서 «활성 조건»이 하나도 나오지 않아 계획의 기본
//                       조건(생활비 유지·자산 고갈)으로 계산했다. 판정 가능한 목표를 아예
//                       고르지 않은 경우와, 골랐지만 그 목표가 조건을 만들지 못한 경우
//                       (목표액 없는 「자산 성장」 단독)가 모두 여기로 온다
//   legacy_plan       = 목표를 한 번도 고른 적 없는 시나리오다. 목표 도입 이전과 같은
//                       조건(생활비·고갈·기말자산)을 그대로 쓴다
export type GoalConditionBasis = 'selected_goals' | 'plan_defaults' | 'legacy_plan';

export interface GoalSuccessConditions {
  basis: GoalConditionBasis;
  // 은퇴 후 모든 해에 목표 생활비를 채웠는지 판정할 것인가.
  requireSpendingTarget: boolean;
  // 기대수명까지 자산이 고갈되지 않았는지 판정할 것인가.
  requireAssetSurvival: boolean;
  // 기말자산 하한. 0이면 이 조건을 판정하지 않는다.
  terminalAssetGoal: number;
  // 고르긴 했지만 이 확률로는 판정할 수 없는 목표. 화면이 "반영되지 않았다"고 밝히는 데 쓴다.
  // 숨기면 "판정하지 않음"이 "판정해서 통과함"으로 읽힌다.
  unmeasuredGoals: RetirementGoalType[];

  /**
   * 위 세 조건 중 어느 것이 «확정된 HARD 목표»에서 왔는가.
   *
   * legacy_plan과 plan_defaults 갈래에서는 전부 false다 — 그 갈래의 조건은 계획 기본값이지
   * 사용자가 못박은 것이 아니다. 여기서 true를 주면 HARD 성공률이 「사용자가 요구한 적 없는
   * 조건」을 요구로 보고하게 된다.
   *
   * 「확정된」의 뜻은 retirementGoal.ts와 같다 — 강도만 고르고 기준이 씨앗이면 HARD가
   * 성립하지 않는다(hardGoalAwaitsTargetConfirmation). terminalAssetGoalOf가 이미
   * confirmedTargetValue로 같은 게이트를 걸고 있어, 여기서만 다른 술어를 쓰면 갈라진다.
   */
  hardRequirements: {
    spendingTarget: boolean;
    assetSurvival: boolean;
    terminalAsset: boolean;
  };

  /**
   * 위 hardRequirements 각 축을 «켠» 확정 HARD 목표. 축이 꺼져 있으면 빈 배열이다.
   *
   * **판별 기준은 유형 멤버십이 아니라 이 목록이다.** resolveSimulationVerdict의 `judged`는
   * `isQuantitativelyJudgedGoal()`(유형)이 아니라 여기서 나온다 — 「자산 성장」은 판정
   * 가능한 «유형»이지만 목표액을 묻는 UI가 없어 terminalAsset 축에 기여하지 못하는 한
   * 이 목록에 들어가지 않는다(위 hardRequirements.terminalAsset 주석과 같은 이유). 유형만
   * 보면 구멍이 생긴다 — 그 구멍이 실제로 화면에 닿았던 사고가 known-issues 1번이다.
   */
  hardRequirementGoals: {
    spendingTarget: RetirementGoalType[];
    assetSurvival: RetirementGoalType[];
    terminalAsset: RetirementGoalType[];
  };
}

const NO_HARD_REQUIREMENTS = {
  spendingTarget: false, assetSurvival: false, terminalAsset: false,
} as const;

const noHardRequirementGoals = (): GoalSuccessConditions['hardRequirementGoals'] => ({
  spendingTarget: [], assetSurvival: [], terminalAsset: [],
});

/** 화면과 PDF의 추천 카드가 목표 달성 확률의 판정 조건을 같은 문장으로 설명한다. */
export function describeGoalSuccessCriteria(
  conditions: GoalSuccessConditions,
  successAge: number,
  formatValue: (value: number) => string,
): string {
  const criteria: string[] = [];
  if (conditions.requireSpendingTarget) criteria.push('목표생활비 완전 충족');
  if (conditions.requireAssetSurvival) criteria.push(`${successAge}세까지 자산 유지`);
  if (conditions.terminalAssetGoal > 0) {
    criteria.push(`기말자산 ${formatValue(conditions.terminalAssetGoal)} 이상`);
  }
  return criteria.join(' · ');
}

// 시행 하나로 판정할 수 있는 목표. 나머지는 세금·연금 활용도처럼 수익률 경로가 아니라
// 제도·전략 선택으로 갈리는 것이라, 시행별 성공/실패를 물을 대상이 아니다.
//
// EARLY_RETIREMENT는 어느 쪽도 아니다: 목표 은퇴 나이는 applyRetirementGoals가 계획의
// userProfile.retirementAge로 직접 옮기므로 모든 시행이 이미 그 나이에 은퇴한다. 조건으로
// 세면 언제나 전 시행 통과라 확률이 부풀고, 미판정 목록에 넣으면 반영된 목표를 반영되지
// 않았다고 말하게 된다.
const MEASURABLE_GOALS: ReadonlySet<RetirementGoalType> = new Set([
  'LIVING_EXPENSE_STABILITY',
  'COMFORTABLE_SPENDING',
  'ASSET_SURVIVAL',
  'INHERITANCE',
  'ASSET_GROWTH',
]);

const PLAN_EMBEDDED_GOALS: ReadonlySet<RetirementGoalType> = new Set(['EARLY_RETIREMENT']);

/**
 * 이 목표가 «정량 판정»의 대상인가. 시행 하나로 성공/실패를 물을 수 있거나
 * (MEASURABLE_GOALS), 계획에 박혀 모든 시행이 이미 만족하거나(PLAN_EMBEDDED_GOALS) 둘 중
 * 하나면 참이다. 나머지 — 주거 안정·연금 최대 활용·세금 최소화·투자 위험 최소화 — 는
 * 오늘 판정 대상이 아니다. 그 목표들을 HARD로 골라도 GoalEvaluationEngine은 미달을
 * 만들지 않고 unsupportedHardGoals로 «드러난 채» 남긴다.
 *
 * **화면이 이 술어를 쓰라고 내보낸다.** 목표 카드가 조건 강도를 판정에 쓰이는 것처럼
 * 내보이면, 사용자는 자기가 못박은 조건을 계산이 지킬 것이라 믿는다(known-issues 1번).
 * 그 목록을 화면이 «따로» 들고 있으면 목표 하나가 분류를 옮기는 날 둘이 갈라지고, 그
 * 순간부터 화면이 조용히 거짓말을 시작한다. 분류의 출처는 위 두 집합 하나뿐이다.
 */
export function isQuantitativelyJudgedGoal(type: RetirementGoalType): boolean {
  return MEASURABLE_GOALS.has(type) || PLAN_EMBEDDED_GOALS.has(type);
}

/**
 * 이 목표가 «계획에 이미 반영되어» 모든 시행이 통과하는 유형인가(오늘은 EARLY_RETIREMENT
 * 하나뿐이다). MEASURABLE_GOALS와 뜻이 다르다 — 이쪽은 조건으로 세면 안 되는 쪽이고,
 * MEASURABLE_GOALS는 조건으로 세워야 하는 쪽이다. `isQuantitativelyJudgedGoal`은 이 둘의
 * 합집합이라 소비처가 「판정됐다」와 「반영은 됐지만 조건이 아니다」를 구별해야 하는 자리
 * (resolveSimulationVerdict의 judged/planEmbedded)에서는 이 술어를 따로 써야 한다.
 */
export function isPlanEmbeddedGoal(type: RetirementGoalType): boolean {
  return PLAN_EMBEDDED_GOALS.has(type);
}

/**
 * 이 목표가 «확정된 HARD»인가 — 강도가 HARD이고 기준이 씨앗이 아닌 경우.
 *
 * 이 술어의 출처는 여기 하나뿐이어야 한다. resolveSimulationVerdict가 같은 뜻을 다시 쓰면
 * (hardGoalAwaitsTargetConfirmation을 직접 불러 같은 식을 반복하면) 두 파일이 «확정»의
 * 정의를 각자 들고 있는 셈이 되고, 그 정의가 바뀌는 날 한쪽만 따라간다.
 */
export function isConfirmedHardGoal(goal: RetirementGoal): boolean {
  return goal.constraintType === 'HARD' && !hardGoalAwaitsTargetConfirmation(goal);
}

// 목표 달성 확률이 판정할 조건을 정한다.
//
// **이 함수가 필요한 이유.** 예전에는 조건이 세 개로 고정되어 있었다 — 목표 생활비, 자산
// 고갈, 기말자산 ≥ (targetBequest ?? assetFloor). 그래서 두 방향으로 모두 틀렸다.
//   - 고르지 않은 목표가 확률을 깎았다. 상속을 한 번도 고르지 않아도 compileStrategy가
//     기본 전략('일부 남기기')으로 실체화한 24개월치 생활비가 기말자산 조건이 됐고,
//     구 UI에서 상속 목표액을 넣어 둔 시나리오는 그 금액이 조건으로 살아 있었다.
//   - 고른 목표는 확률을 바꾸지 못했다. 자산 고갈 방지를 HARD로 골라도, 아예 고르지 않아도
//     같은 값이 나왔다.
//
// **레거시 시나리오는 목표를 «지어내지» 않는다.** retirementGoals 키가 없으면 목표 화면을
// 거친 적이 없다는 뜻이므로 판정 조건을 목표에서 만들지 않고 예전 세 조건을 그대로 쓴다.
//
// 다만 «값»까지 예전 그대로인 것은 아니다. migrateRetirementGoals가 로드 시점에 목표가 정하는
// 축을 정규화하므로(normalizeGoalDrivenParams), 상속 목표가 없는 시나리오는 targetBequest 키가
// 지워진 채 여기 도착한다 — 즉 아래 legacyTerminalGoal은 assetFloor나 0으로 떨어진다.
// 그것이 새 규칙이다: 고르지 않은 상속 목표는 기말자산 조건이 되지 않는다.
export function resolveGoalSuccessConditions(params: SimulationParams): GoalSuccessConditions {
  const legacyTerminalGoal = Math.max(0, params.userProfile.targetBequest ?? params.assetFloor ?? 0);

  if (!Array.isArray(params.retirementGoals)) {
    return {
      basis: 'legacy_plan',
      requireSpendingTarget: true,
      requireAssetSurvival: true,
      terminalAssetGoal: legacyTerminalGoal,
      unmeasuredGoals: [],
      hardRequirements: { ...NO_HARD_REQUIREMENTS },
      hardRequirementGoals: noHardRequirementGoals(),
    };
  }

  const goals = normalizeRetirementGoals(params.retirementGoals);
  const measurable = goals.filter((goal) => MEASURABLE_GOALS.has(goal.type));
  const unmeasuredGoals = goals
    .filter((goal) => !MEASURABLE_GOALS.has(goal.type) && !PLAN_EMBEDDED_GOALS.has(goal.type))
    .map((goal) => goal.type);

  const requireSpendingTarget = measurable.some((goal) =>
    goal.type === 'LIVING_EXPENSE_STABILITY' || goal.type === 'COMFORTABLE_SPENDING');
  const requireAssetSurvival = measurable.some((goal) => goal.type === 'ASSET_SURVIVAL');
  const { value: terminalAssetGoal, source: terminalAssetSource } = terminalAssetGoalOf(measurable, params);

  // **판별 기준은 「판정 가능한 «유형»을 골랐는가」가 아니라 「활성 «조건»이 남았는가」다.**
  // 유형만 보면 구멍이 생긴다: 「자산 성장」은 판정 가능한 유형이지만 목표액을 묻는 UI가
  // 없어(goalCatalog에 target 필드가 없다) 상속 목표를 함께 고르지 않으면 terminalAssetGoal이
  // 0으로 풀린다. 그러면 세 조건이 모두 비어 있는데도 'selected_goals'로 빠져나가, 62세에
  // 자산이 바닥나는 계획조차 «판정할 것이 없다»는 이유로 언제나 100%를 받는다.
  //
  // 판정할 조건이 없다고 해서 100%를 줄 수는 없다. "계획대로 굴러가는가"라는 최소한의
  // 질문(생활비를 계획대로 쓰며 기대수명까지 자산이 버티는가)으로 되돌아간다.
  // 기말자산 조건은 넣지 않는다 — 사용자가 요구한 적 없는 금액이기 때문이다.
  //
  // 판정 가능한 목표를 «하나도» 고르지 않은 경우도 세 조건이 모두 비므로 이 한 분기가
  // 함께 덮는다. 두 벌로 두면 같은 뜻의 가드가 갈라진다.
  //
  // unmeasuredGoals는 여기서도 «유형» 기준 그대로다. 그 필드가 답하는 질문은 「고른 목표 중
  // 이 확률이 판정하지 못한 것이 무엇인가」이고, 「자산 성장」은 조건이 비었을 뿐 판정 대상
  // 유형이므로 미반영 목록에 넣으면 다른 사실을 말하게 된다.
  if (!requireSpendingTarget && !requireAssetSurvival && terminalAssetGoal <= 0) {
    return {
      basis: 'plan_defaults',
      requireSpendingTarget: true,
      requireAssetSurvival: true,
      terminalAssetGoal: 0,
      unmeasuredGoals,
      hardRequirements: { ...NO_HARD_REQUIREMENTS },
      hardRequirementGoals: noHardRequirementGoals(),
    };
  }

  // 「어떤 판정 가능한 자산 목표가 HARD인가」가 아니라 「기말자산 금액을 «실제로 준»
  // 목표가 HARD인가」를 묻는다. ASSET_GROWTH는 목표액 입력 UI가 없어 targetValue가 항상
  // undefined이고, 그러면 isSuggestedTargetValue·hardGoalAwaitsTargetConfirmation이 모두
  // 거짓이라 「확정을 기다리는 씨앗이 없다」가 「이미 확정했다」로 잘못 읽힌다. 유형만 보면
  // SOFT 상속이 확정한 금액을 나란히 고른 HARD 자산성장 목표(또는 targetBequest 폴백)가
  // 가로채 HARD 요구로 둔갑한다. terminalAssetSource가 null이면(폴백값) 그 값을 «준» 목표가
  // 아예 없으므로도 항상 false다.
  const spendingTargetGoals = measurable
    .filter((goal) =>
      (goal.type === 'LIVING_EXPENSE_STABILITY' || goal.type === 'COMFORTABLE_SPENDING')
      && isConfirmedHardGoal(goal))
    .map((goal) => goal.type);
  const assetSurvivalGoals = measurable
    .filter((goal) => goal.type === 'ASSET_SURVIVAL' && isConfirmedHardGoal(goal))
    .map((goal) => goal.type);
  const terminalAssetGoals = terminalAssetSource !== null && isConfirmedHardGoal(terminalAssetSource)
    ? [terminalAssetSource.type]
    : [];

  const hardRequirementGoals = {
    spendingTarget: spendingTargetGoals,
    assetSurvival: assetSurvivalGoals,
    terminalAsset: terminalAssetGoals,
  };
  const hardRequirements = {
    spendingTarget: spendingTargetGoals.length > 0,
    assetSurvival: assetSurvivalGoals.length > 0,
    terminalAsset: terminalAssetGoals.length > 0,
  };

  return {
    basis: 'selected_goals',
    requireSpendingTarget,
    requireAssetSurvival,
    terminalAssetGoal,
    unmeasuredGoals,
    hardRequirements,
    hardRequirementGoals,
  };
}

// 기말자산 조건은 상속·자산 성장 목표에서만 나온다. 목표에 «확정된» 금액이 없으면 계획이
// 실체화한 targetBequest로 대신한다 — 그 값은 사용자가 목표를 고른 결과로 만들어진 것이라
// (applyRetirementGoals → compileStrategy) 고르지 않은 조건을 새로 만드는 것이 아니다.
//
// 확정 여부를 여기서 다시 묻는 이유: 이 값은 시행마다 「성공인가」를 가르는 판정 조건이다.
// 미확정 씨앗을 그대로 쓰면 사용자가 말한 적 없는 금액이 목표 달성 확률을 깎는다.
//
// **source를 함께 돌려주는 이유.** hardRequirements.terminalAsset은 「판정 가능한 자산 목표
// 중 HARD가 있는가」가 아니라 「이 금액을 «실제로 준» 목표가 HARD인가」를 물어야 한다. 유형만
// 보면 목표액 입력 UI가 없는 ASSET_GROWTH(targetValue가 늘 undefined라
// hardGoalAwaitsTargetConfirmation이 늘 거짓)가 나란히 고른 다른 목표의 확정 금액을 가로채
// HARD 요구로 둔갑시킨다. source가 그 값을 만든 «단 하나의» 목표(또는 폴백이면 null)를
// 가리키면, 값을 준 적 없는 목표는 그 값에 대해 HARD임을 주장할 수 없다.
function terminalAssetGoalOf(
  measurable: readonly RetirementGoal[],
  params: SimulationParams,
): { value: number; source: RetirementGoal | null } {
  const assetGoals = measurable.filter((goal) =>
    goal.type === 'INHERITANCE' || goal.type === 'ASSET_GROWTH');
  if (assetGoals.length === 0) return { value: 0, source: null };

  const explicit = assetGoals
    .map((goal) => ({ goal, value: confirmedTargetValue(goal) }))
    .filter((entry): entry is { goal: RetirementGoal; value: number } =>
      entry.value !== undefined && Number.isFinite(entry.value));
  if (explicit.length > 0) {
    const winner = explicit.reduce((max, entry) => (entry.value > max.value ? entry : max));
    return { value: Math.max(0, winner.value), source: winner.goal };
  }

  return { value: Math.max(0, params.userProfile.targetBequest ?? 0), source: null };
}

// successAge까지 자산이 고갈되지 않았는가.
//
// runMonteCarlo·estimateSuccessRate·computeSensitivityAnalysis(민감도 시나리오·기준선)가
// **반드시** 같은 식을 써야 하므로 여기 하나에만 둔다 — 복사해 두면 한쪽만 바뀐 채로
// 조용히 갈라진다. (예전에는 MonteCarloEngine.ts에만 있었다. 민감도 분석의 HARD 위반
// 판정이 같은 「고갈 여부」를 물어야 하면서 그쪽으로 옮겼다 — MonteCarloEngine이 이 파일을
// 이미 import하고 있어 방향을 뒤집으면 순환 참조가 생긴다.)
//
// depletionAge > successAge 조건은 지금은 도달할 수 없다: 시뮬레이션 루프가 expectancy에서
// 끝나므로 depletionAge는 successAge를 넘을 수 없다. 루프 종료 나이와 successAge가 다시
// 갈라지는 날을 대비한 방어선으로만 남겨 둔다.
export function isSuccessfulTrial(depletionAge: number | null, successAge: number): boolean {
  return depletionAge === null || depletionAge > successAge;
}

/**
 * 확정 HARD 요구 판정에 필요한 최소 입력.
 *
 * 몬테카를로 시행(MonteCarloEngine.TrialSummary)과 민감도 분석 시나리오
 * (computeSensitivityAnalysis가 runFrozenPlan으로 이미 얻은 결과) 둘 다 이 세 필드로
 * 표현할 수 있다 — 어느 쪽도 상대를 위해 자기 자료구조를 다시 빚지 않는다. 시행은
 * TrialSummary에서, 시나리오는 StrategySimulationResult에서 값을 그대로 옮겨 채운다.
 */
export interface HardGoalOutcome {
  depletionAge: number | null;
  endingAssets: number;
  /**
   * 생활비 목표를 채우지 못한 순간이 있었는가. **그 기준은 호출자가 정한다.**
   *
   * 몬테카를로는 목표 재구성(computeMonthlySpendingComposition) 기준의 firstGoalShortfallAge
   * (엡실론 있음, 사용자의 targetMonthlySpending 대비)를 쓰고, 민감도 분석은 원장 기준의
   * unmetSpendingYears(엡실론 없음, spendingShortfall.hasSpendingShortfall)를 쓴다. 두
   * 정의가 서로 다른 질문에 답한다는 것은 spendingShortfall.ts가 이미 문서화했다 —
   * 여기서 하나로 합치면 둘 중 하나가 답하던 질문이 바뀐다.
   */
  hasSpendingShortfall: boolean;
}

export function failsSpendingTarget(outcome: HardGoalOutcome, conditions: GoalSuccessConditions): boolean {
  return conditions.requireSpendingTarget && outcome.hasSpendingShortfall;
}

export function failsAssetSurvival(
  outcome: HardGoalOutcome,
  conditions: GoalSuccessConditions,
  successAge: number,
): boolean {
  return conditions.requireAssetSurvival && !isSuccessfulTrial(outcome.depletionAge, successAge);
}

export function failsTerminalAsset(outcome: HardGoalOutcome, conditions: GoalSuccessConditions): boolean {
  return conditions.terminalAssetGoal > 0 && outcome.endingAssets < conditions.terminalAssetGoal;
}

/** hardRequirements의 세 축과 같은 키. */
export type HardRequirementAxis = 'spendingTarget' | 'assetSurvival' | 'terminalAsset';

/**
 * outcome이 «확정 HARD 요구» 중 실제로 어긴 축의 목록. 비어 있으면 위반이 없다.
 *
 * **HARD로 걸리지 않은 축은 실패해도 여기 담기지 않는다.** failsX 술어는
 * requireX(«판정할 것인가»)로만 걸리지만, 이 함수는 그 위에 hardRequirements(«확정 HARD가
 * 요구했는가»)를 한 번 더 건다 — SOFT로 고르거나 아예 고르지 않은 조건까지 위반으로 세면,
 * 사용자가 요구한 적 없는 조건이 「경고」로 표시된다.
 */
export function resolveHardViolations(
  outcome: HardGoalOutcome,
  conditions: GoalSuccessConditions,
  successAge: number,
): HardRequirementAxis[] {
  const { hardRequirements } = conditions;
  const violations: HardRequirementAxis[] = [];
  if (hardRequirements.spendingTarget && failsSpendingTarget(outcome, conditions)) {
    violations.push('spendingTarget');
  }
  if (hardRequirements.assetSurvival && failsAssetSurvival(outcome, conditions, successAge)) {
    violations.push('assetSurvival');
  }
  if (hardRequirements.terminalAsset && failsTerminalAsset(outcome, conditions)) {
    violations.push('terminalAsset');
  }
  return violations;
}

/**
 * 위반한 HARD 축들을 «그 축을 켠» 목표 유형 목록으로 바꾼다. 화면·PDF가 "무엇을 어겼는가"를
 * 사람이 읽는 이름으로 보여줄 때 쓴다 — 축 이름('assetSurvival')을 그대로 보여주면 사용자가
 * 목표 화면에서 고른 이름(「자산 고갈 방지」)과 어긋난다.
 *
 * 여러 축이 같은 목표에서 왔거나(오늘은 일어나지 않지만 hardRequirementGoals의 계약이
 * 그 가능성을 막지 않는다) 한 목표가 여러 축에 걸치는 경우를 대비해 중복은 제거한다.
 */
export function hardViolationGoalTypes(
  axes: readonly HardRequirementAxis[],
  hardRequirementGoals: GoalSuccessConditions['hardRequirementGoals'],
): RetirementGoalType[] {
  const types = axes.flatMap((axis) => hardRequirementGoals[axis]);
  return Array.from(new Set(types));
}

/**
 * 위반한 HARD 축들을 사람이 읽는 «짧은 라벨»로 바꾼다. 판정 근거(결정론·1회 실행)는 여기
 * 넣지 않는다 — describeHardViolationBasis()가 그 역할이다.
 *
 * **세 소비처가 모두 같은 라벨을 쓴다** — 화면(SensitivityAnalysisSection),
 * PDF(renderSensitivityTableSection), 「무엇부터 바꿔야 하나」 카드(computeKeyLevers →
 * KeyLeversCard·renderKeyLeversSection). 처음 이 기능을 만들 때는 소비처가 둘인 줄 알고
 * 화면·PDF에 각자 문장을 심었는데, 세 번째 소비처(computeKeyLevers)가 나타나자 그 카드는
 * endingAssetsDelta만 보고 위반 시나리오를 "기대수명 시점 자산 +N원"이라는 순수 개선 문구로
 * 표시했다 — 바로 아래 민감도 표는 같은 시나리오를 위반으로 표시하는데도. 문장을 한 곳에
 * 모아야 이런 부분적 반영이 다시 생기지 않는다.
 *
 * **판정 근거 문장을 라벨에서 떼어낸 이유.** 민감도 표는 시나리오·기준선까지 최대 8행을
 * 그리고, 그 옆의 「무엇부터 바꿔야 하나」 카드도 레버마다 위반을 적을 수 있다 — 위반이
 * 넓게 퍼진 계획은 같은 25어 안팎의 괄호가 한 페이지에 열 번 가까이 반복됐다. 두 번째부터는
 * 읽히지 않으니, 문구를 추가한 목적(판정 근거를 밝힌다) 자체가 무효가 된다. 그래서 라벨은
 * 항목마다, 근거 문장(describeHardViolationBasis)은 표·카드마다 «한 번만» 쓴다.
 *
 * **목표 이름 조회는 호출자가 넘긴다.** 이 파일은 core라 web의 goalCatalog을 참조할 수
 * 없다(AGENTS.md의 계층 분리 원칙). computeKeyLevers.ts(core)는 RETIREMENT_GOAL_LABELS를
 * 직접 쓰고, 화면·PDF는 각자의 표준 조회 창구(retirementGoalDefinition·goalLabel)를
 * 넘긴다 — 셋 다 결국 RETIREMENT_GOAL_LABELS 하나로 귀결되는 값이라 이름이 갈리지 않는다.
 */
export function describeHardViolation(
  axes: readonly HardRequirementAxis[],
  hardRequirementGoals: GoalSuccessConditions['hardRequirementGoals'],
  labelOf: (type: RetirementGoalType) => string,
): string | null {
  if (axes.length === 0) return null;
  const labels = hardViolationGoalTypes(axes, hardRequirementGoals).map(labelOf);
  if (labels.length === 0) return null;
  return `「${RETIREMENT_GOAL_CONSTRAINT_LABELS.HARD}」 위반: ${labels.join(', ')}`;
}

/**
 * describeHardViolation 라벨이 무엇을 근거로 하는지 밝히는 한 문장. **위반이 하나라도 있는
 * 표·카드마다 정확히 한 번만** 인쇄한다 — 위반 행마다 반복하지 않는다(위 describeHardViolation
 * 주석 참고). 화면·PDF·「무엇부터 바꿔야 하나」 카드가 모두 이 문장을 그대로 쓴다.
 *
 * **"결정론 1회 실행 판정"이라고 스스로 밝히는 이유.** 이 라벨은 몬테카를로의
 * hardGoalSuccessProbability(1,000회 확률)와 같은 화면·같은 계획에 나란히 놓일 수 있다.
 * 두 판정은 기준이 다르다 — hasSpendingShortfall(이 라벨의 근거)은 원장 기준(엡실론 없음),
 * 몬테카를로의 firstGoalShortfallAge는 재구성 기준(월 1만원 엡실론)이다
 * (spendingShortfall.ts의 AUDIT-003). 그래서 생활비가 엡실론 미만으로만 모자란 해가 있는
 * 계획은 몬테카를로에서 "HARD 목표 판정 확률 100%"이면서 이 라벨에서는 "위반"으로 보일 수
 * 있다. 그것을 "같은 질문에 다른 답"으로 읽지 않도록, 이 문장은 스스로 «그 시나리오 하나를
 * 결정론으로 1회 실행한 판정»이라고 밝힌다 — 몬테카를로처럼 여러 시행을 모은 확률이 아니다.
 * 두 술어를 하나로 합치는 것은 이 함수의 범위가 아니다(spendingShortfall.ts와 같은 이유로,
 * 그러면 기존 지표 중 하나가 답하는 질문이 바뀐다).
 */
export function describeHardViolationBasis(): string {
  return '위 「반드시 지키기」 위반 표시는 그 시나리오를 결정론으로 1회 실행한 판정입니다 '
    + '— 몬테카를로처럼 여러 시행을 모은 확률이 아닙니다.';
}
