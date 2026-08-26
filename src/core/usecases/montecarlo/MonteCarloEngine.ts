import { SimulationParams, StrategySimulationResult } from '../../entities/types';
import {
  MonteCarloAssetBandYear,
  MonteCarloConfig,
  MonteCarloResult,
  StrategyMonteCarloValidationResult,
} from '../../entities/montecarlo';
import type { RetirementGoals, RetirementProfile, RetirementStrategy } from '../../domain/input/retirement';
import { LegacySimulationAdapter } from '../../domain/input/LegacySimulationAdapter';
import { SimulationEngine } from '../SimulationEngine';
import { freezeSpendingPlan, runFrozenPlan } from '../spending/freezeSpendingPlan';
import { hasSpendingShortfall } from '../spending/spendingShortfall';
import { mulberry32, deriveSeed } from './rng';
import { buildReturnShockPath } from './returnPath';
import { percentileOfSorted } from './statistics';
import { simulationYearCount } from './horizon';
import { computeMonthlySpendingComposition } from '../MonthlySpendingComposition';
import { resolveGoalSuccessConditions } from '../goals/goalSuccessConditions';
import { SHORTFALL_EPSILON_MONTHLY } from '../metrics/SimulationMetricsCalculator';
import { resolveStrategy } from '../strategy/compileStrategy';

// 한 시행에서 보관하는 것. 전 시행의 yearlyResults를 통째로 들면(1000 × 55년 × 30필드)
// 수십 MB가 되므로 스칼라 두 개와 연도별 총자산만 남긴다.
interface TrialSummary {
  endingAssets: number;
  depletionAge: number | null;
  hasUnmetSpending: boolean;
  // 목표 생활비를 처음 채우지 못한 나이. null이면 전 기간 목표를 채웠다.
  // boolean이 아니라 나이를 드는 이유: "몇 %가 실패했는가"만으로는 원인을 지목할 수 없고,
  // 실패가 **언제부터** 시작되는지가 곧 원인의 종류를 가른다(GoalFailureBreakdown 주석).
  firstGoalShortfallAge: number | null;
  // 전 은퇴기간 목표 생활비 총액 중 실제 충당 비율. 엄격한 성공/실패 판정을 보완한다.
  spendingFulfillmentRate: number;
  totalAssetsByYear: number[];
}

function summarize(
  result: StrategySimulationResult,
  goalParams: SimulationParams,
): TrialSummary {
  const composition = computeMonthlySpendingComposition(
    result.yearlyResults,
    goalParams,
    result,
  );
  const firstShortfallRow = composition
    .find((row) => row.goalShortfall >= SHORTFALL_EPSILON_MONTHLY);
  const totalGoal = composition.reduce((sum, row) => sum + row.goalMonthly, 0);
  const totalShortfall = composition.reduce((sum, row) => sum + row.goalShortfall, 0);
  const spendingFulfillmentRate = totalGoal > 0
    ? Math.max(0, Math.min(1, 1 - totalShortfall / totalGoal))
    : 1;

  return {
    endingAssets: result.endingAssets,
    depletionAge: result.depletionAge,
    hasUnmetSpending: result.yearlyResults.some(hasSpendingShortfall),
    firstGoalShortfallAge: firstShortfallRow?.age ?? null,
    spendingFulfillmentRate,
    totalAssetsByYear: result.yearlyResults.map((y) => y.totalAssets),
  };
}

// 지정한 시행 인덱스의 수익률 경로. 시드가 (기준 시드, 인덱스)로만 결정되므로 같은
// 인덱스는 언제 호출해도 같은 경로를 준다 — 선별·확정 두 단계가 같은 난수를 쓰는 근거다.
function pathForTrial(years: number, config: MonteCarloConfig, index: number) {
  return buildReturnShockPath(years, config.annualStdDev, mulberry32(deriveSeed(config.seed, index)));
}

// 한 시행의 성공 판정. runMonteCarlo와 estimateSuccessRate가 **반드시** 같은 식을 써야 하므로
// 함수로 뽑는다 — 두 곳에 복사해 두면 한쪽만 바뀐 채로 조용히 갈라진다.
//
// depletionAge > successAge 조건은 지금은 도달할 수 없다: 시뮬레이션 루프가 expectancy에서
// 끝나므로 depletionAge는 successAge를 넘을 수 없다. 루프 종료 나이와 successAge가 다시
// 갈라지는 날을 대비한 방어선으로만 남겨 둔다.
export function isSuccessfulTrial(depletionAge: number | null, successAge: number): boolean {
  return depletionAge === null || depletionAge > successAge;
}

// 고갈로 판정된 시행들 중 가장 이른 고갈 나이. 호출자가 이미 술어로 걸러 온 배열만 받는다 —
// 여기서 다시 거르면 술어가 두 벌이 되어 개수와 나이가 갈라진다.
//
// 걸러진 시행은 정의상 depletionAge가 null이 아니지만(isSuccessfulTrial), 타입은 그 사실을
// 모르므로 null을 걸러 낸 뒤 최솟값을 취한다. 남는 것이 없으면 null이다.
function earliestDepletionAge(depleted: readonly TrialSummary[]): number | null {
  return depleted.reduce<number | null>((earliest, t) => {
    if (t.depletionAge === null) return earliest;
    return earliest === null || t.depletionAge < earliest ? t.depletionAge : earliest;
  }, null);
}

// **자산 보존** 성공률만 필요한 호출자를 위한 경량 진입점(추천 엔진의 생활비 증액 게이트).
//
// 게이트가 자산 보존 기준을 쓰는 것은 의도다 — 그 게이트가 묻는 것은 "더 써도 자산이
// 버티는가"이고, RecommendationEngine.SPENDING_INCREASE_GATE의 실측 임계(0.9/0.8)도
// 그 기준으로 보정됐다. 생활 유지 성공률로 바꾸면 그 실측 근거가 통째로 무효가 된다.
//
// runMonteCarlo가 만드는 것 중 게이트가 쓰지 않는 것 — assetBands(연도별 분위수 정렬),
// 결정론 기준선(추가 runSingle 1회), 시행별 totalAssetsByYear 배열 — 을 전부 만들지 않는다.
// 성능보다 **계약**이 이유다: 게이트가 MonteCarloResult 전체를 받으면 나중에 누군가
// assetBands를 판정에 끌어다 쓰고, 그 순간 게이트의 비용과 의미가 조용히 바뀐다.
//
// 시드와 시행 인덱스 규칙이 runMonteCarlo와 같으므로(pathForTrial이 인덱스로만 결정된다)
// trials가 작아도 이 표본은 화면 패널(1000 시행)의 앞부분 그대로다 — 게이트가 본 확률과
// 화면이 보여주는 확률이 표본오차 이상으로 어긋나지 않는다.
export function estimateSuccessRate(
  params: SimulationParams,
  engine: SimulationEngine,
  config: MonteCarloConfig
): number {
  if (config.trials <= 0) return 0;

  const planned = freezeSpendingPlan(params, engine);
  const years = simulationYearCount(planned.params);
  const successAge = planned.params.userProfile.expectancy;

  let succeeded = 0;
  for (let i = 0; i < config.trials; i++) {
    const { depletionAge } = runFrozenPlan(engine, planned, pathForTrial(years, config, i));
    if (isSuccessfulTrial(depletionAge, successAge)) succeeded++;
  }
  return succeeded / config.trials;
}

export function runMonteCarlo(
  params: SimulationParams,
  engine: SimulationEngine,
  config: MonteCarloConfig
): MonteCarloResult {
  const planned = freezeSpendingPlan(params, engine);
  const years = simulationYearCount(planned.params);

  // 원본 params에서 읽는다. planned.params는 생활비를 고정한 뒤의 것이지만 전략 축은
  // 건드리지 않으므로 같은 값이고, 「사용자가 무엇을 골랐는가」의 출처는 원본이 옳다.
  const strategy = resolveStrategy(params);

  // 결정론 기준선. 팬 차트에 겹쳐 그려 변동성 손실을 드러내는 데 쓴다.
  //
  // run()이 아니라 runSingle을 부른다 — run()은 이진탐색 30회를 더 돌지만 여기서 필요한
  // 것은 기말자산뿐이다.
  const deterministic = runFrozenPlan(engine, planned);
  const successAge = planned.params.userProfile.expectancy;

  const trials: TrialSummary[] = [];
  for (let i = 0; i < config.trials; i++) {
    // runSingle만 부른다. run()이면 시행당 31회가 되어 1000시행이 31,000회가 된다
    // (RecommendationEngine이 runForUtility를 도입한 것과 같은 판단).
    trials.push(summarize(
      runFrozenPlan(engine, planned, pathForTrial(years, config, i)),
      params,
    ));
  }

  const endingSorted = trials.map((t) => t.endingAssets).sort((a, b) => a - b);

  // 자산 보존 성공 = successAge까지 고갈되지 않음. 판정식은 isSuccessfulTrial 한 곳에만 둔다.
  const succeeded = trials.filter((t) => isSuccessfulTrial(t.depletionAge, successAge));
  // 생활 유지 성공 = 계획한 생활비를 한 해도 줄이지 않음. **고갈 여부를 묻지 않는다** —
  // 이유는 MonteCarloResult.spendingSuccessRate 주석에 있다.
  const spendingSucceeded = trials.filter((t) => !t.hasUnmetSpending);
  // **무엇을 판정할지는 선택한 목표가 정한다.** 조건을 여기에 고정하면 두 방향으로 모두
  // 틀린다 — 고르지 않은 상속 목표액이 확률을 깎고, 고른 목표(자산 고갈 방지 HARD 등)는
  // 확률을 바꾸지 못한다. 그 결정은 resolveGoalSuccessConditions 한 곳에만 둔다.
  //
  // 사용자가 고른 INHERITANCE 목표액은 여기까지 **투영을 통해** 도달한다:
  // applyRetirementGoals(선택 목표 → userProfile.targetBequest) → 어댑터 → strategy.targetBequest
  // → validate()가 selectedGoals와 bequest 목표를 함께 넘김 → resolveGoalSuccessConditions.
  // 사슬 어디가 끊겨도 목표액은 조용히 0이 되고, 모든 시행이 기말자산 조건을 통과해
  // 목표 성공확률만 과대평가된다(오류는 나지 않는다).
  // retirement-domain-invariants/monte-carlo.test.ts가 그 사슬 전체를 고정한다.
  const conditions = resolveGoalSuccessConditions(params);
  const { terminalAssetGoal } = conditions;
  const failsSpending = (t: TrialSummary) =>
    conditions.requireSpendingTarget && t.firstGoalShortfallAge !== null;
  // 고갈 **관측** 술어. 여기서 관측값과 목표 판정값을 함께 유도한다 — 두 곳에 같은 식을
  // 복사해 두면 한쪽만 바뀐 채 조용히 갈라진다.
  const depletedTrial = (t: TrialSummary) => !isSuccessfulTrial(t.depletionAge, successAge);
  const failsSurvival = (t: TrialSummary) =>
    conditions.requireAssetSurvival && depletedTrial(t);
  const failsTerminal = (t: TrialSummary) =>
    terminalAssetGoal > 0 && t.endingAssets < terminalAssetGoal;

  const goalSucceeded = trials.filter((t) => !failsSpending(t) && !failsSurvival(t) && !failsTerminal(t));

  // 실패 원인별 집계. 위 판정식의 세 술어를 그대로 재사용한다 — 조건을 여기서 다시 쓰면
  // 판정하지 않은 조건이 사유로만 보고되어 확률과 화면이 어긋난다.
  const shortfallAges = trials
    .filter(failsSpending)
    .map((t) => t.firstGoalShortfallAge)
    .filter((age): age is number => age !== null)
    .sort((a, b) => a - b);
  // 게이트 없는 관측 고갈 시행. 개수와 가장 이른 나이를 **이 한 배열에서** 뽑는다 —
  // 원인 문장이 둘을 나란히 말하므로 술어가 갈리면 한 문장이 조용히 어긋난다
  // (GoalFailureBreakdown.observedEarliestDepletionAge 주석).
  const depletedTrials = trials.filter(depletedTrial);
  const goalFailure = {
    spendingShortfall: shortfallAges.length,
    assetDepletion: trials.filter(failsSurvival).length,
    // 게이트 없는 관측값. 자산 고갈 방지를 고르지 않은 계획에서 위 값은 0이 되므로, 원인
    // 진단이 그 0을 「고갈이 없었다」로 읽지 않도록 실제 개수를 함께 싣는다
    // (GoalFailureBreakdown 주석).
    observedAssetDepletionCount: depletedTrials.length,
    observedEarliestDepletionAge: earliestDepletionAge(depletedTrials),
    terminalShortfall: trials.filter(failsTerminal).length,
    medianFirstShortfallAge: shortfallAges.length > 0 ? percentileOfSorted(shortfallAges, 0.5) : null,
    terminalAssetGoal,
  };

  const depletedAges = trials
    .map((t) => t.depletionAge)
    .filter((age): age is number => age !== null)
    .sort((a, b) => a - b);

  // 연도별 분위수. 각 해마다 전 시행의 총자산을 모아 정렬하고 10%·50% 지점을 취한다.
  // **해마다 다른 시행에서 온 값이라 어느 한 시행의 경로가 아니다**(MonteCarloResult 주석).
  // 그래서 최악 10분위의 실제 경로 하나를 재실행해 함께 담아 봤으나, 화면·PDF 어디에서도
  // 소비되지 않아 시뮬레이션 한 번의 비용만 남기고 걷어냈다. 그 한계는 이제 문구로 밝힌다
  // (AssetGrowthChart의 MEDIAN_NOTE).
  const assetBands: MonteCarloAssetBandYear[] = [];
  const startAge = planned.params.userProfile.currentAge;
  for (let y = 0; y < years; y++) {
    const columnSorted = trials
      .map((t) => t.totalAssetsByYear[y])
      .filter((v): v is number => v !== undefined)
      .sort((a, b) => a - b);
    if (columnSorted.length === 0) continue;
    assetBands.push({
      age: startAge + y,
      p10: percentileOfSorted(columnSorted, 0.1),
      p50: percentileOfSorted(columnSorted, 0.5),
    });
  }

  return {
    trials: config.trials,
    seed: config.seed,
    annualStdDev: config.annualStdDev,
    // 결과가 «어떤 세계에서 나왔는지»를 결과 자신이 들고 다닌다. 화면은 워커 경계 너머에
    // 있어 params를 갖고 있지 않고, 화면과 PDF가 각자 params를 읽어 판정하면 두 곳이
    // 어긋난다(describeMonteCarloAssumptions 주석).
    assumptions: {
      economicScenario: strategy.economicScenario,
      riskProfile: strategy.riskProfile,
    },
    successAge,
    successRate: trials.length > 0 ? succeeded.length / trials.length : 0,
    spendingSuccessRate: trials.length > 0 ? spendingSucceeded.length / trials.length : 0,
    averageSpendingFulfillmentRate: trials.length > 0
      ? trials.reduce((sum, trial) => sum + trial.spendingFulfillmentRate, 0) / trials.length
      : 0,
    goalSuccessProbability: trials.length > 0 ? goalSucceeded.length / trials.length : 0,
    simulationSuccessRate: trials.length > 0 ? goalSucceeded.length / trials.length : 0,
    goalFailure,
    goalConditions: conditions,
    plannedMonthlySpending: planned.monthlyTargetSpending,
    endingAssets: {
      p10: percentileOfSorted(endingSorted, 0.1),
      p50: percentileOfSorted(endingSorted, 0.5),
      p90: percentileOfSorted(endingSorted, 0.9),
    },
    assetBands,
    depletion: {
      count: depletedAges.length,
      earliestAge: depletedAges.length > 0 ? depletedAges[0] : null,
      medianAge: depletedAges.length > 0 ? percentileOfSorted(depletedAges, 0.5) : null,
    },
    deterministicEndingAssets: deterministic.endingAssets,
  };
}

/** Optimizer-facing Monte Carlo boundary. Deterministic candidate generation never depends on it. */
export interface StrategyMonteCarloEngine {
  validate(
    profile: RetirementProfile,
    goals: RetirementGoals,
    strategy: RetirementStrategy,
    config: MonteCarloConfig,
  ): StrategyMonteCarloValidationResult;
}

/**
 * Final-stage validator that reuses the deterministic cash-flow engine and varies only its return
 * path. The adapter keeps the goal-based domain model out of the legacy Monte Carlo entry point.
 */
export class MonteCarloEngine implements StrategyMonteCarloEngine {
  constructor(private readonly simulationEngine: SimulationEngine) {}

  validate(
    profile: RetirementProfile,
    goals: RetirementGoals,
    strategy: RetirementStrategy,
    config: MonteCarloConfig,
  ): StrategyMonteCarloValidationResult {
    const params = LegacySimulationAdapter.toLegacy(profile, {
      goals: [
        { type: 'retirement_age', targetAge: strategy.retirementAge },
        { type: 'monthly_spending', monthlyAmount: strategy.targetMonthlySpending },
        { type: 'plan_horizon', targetAge: strategy.planHorizonAge },
        ...(strategy.targetBequest === undefined
          ? []
          : [{ type: 'bequest' as const, targetAmount: strategy.targetBequest }]),
      ],
      ...(goals.selectedGoals ? { selectedGoals: goals.selectedGoals } : {}),
    }, strategy);
    const result = runMonteCarlo(params, this.simulationEngine, config);

    // 순수한 이름 변환이다. `?? 0` 같은 폴백을 두지 않는다 — 값이 없다는 사실이 "성공확률 0%"로
    // 둔갑하면, 측정되지 않은 계획이 가장 나쁜 계획으로 표시되고 화면에는 0%가 찍힌다.
    return {
      trials: result.trials,
      seed: result.seed,
      goalSuccessProbability: result.goalSuccessProbability,
      spendingSuccessProbability: result.spendingSuccessRate,
      averageSpendingFulfillmentRate: result.averageSpendingFulfillmentRate,
      assetSurvivalProbability: result.successRate,
      terminalAssetMedian: result.endingAssets.p50,
      terminalAssetP10: result.endingAssets.p10,
      terminalAssetP90: result.endingAssets.p90,
      shortfallProbability: 1 - result.spendingSuccessRate,
      goalConditions: result.goalConditions,
    };
  }
}
