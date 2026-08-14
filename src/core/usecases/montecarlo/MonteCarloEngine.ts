import { SimulationParams, SimulationYearlyResult, StrategySimulationResult } from '../../entities/types';
import {
  MonteCarloBandYear,
  MonteCarloConfig,
  MonteCarloResult,
  StrategyMonteCarloValidationResult,
} from '../../entities/montecarlo';
import type { RetirementGoals, RetirementProfile, RetirementStrategy } from '../../domain/input/retirement';
import { LegacySimulationAdapter } from '../../domain/input/LegacySimulationAdapter';
import { SimulationEngine } from '../SimulationEngine';
import { FrozenSpendingPlan, freezeSpendingPlan, runFrozenPlan } from '../spending/freezeSpendingPlan';
import { hasSpendingShortfall } from '../spending/spendingShortfall';
import { mulberry32, deriveSeed } from './rng';
import { buildReturnShockPath } from './returnPath';
import { percentileOfSorted } from './statistics';
import { simulationYearCount } from './horizon';
import { computeMonthlySpendingComposition } from '../MonthlySpendingComposition';
import { SHORTFALL_EPSILON_MONTHLY } from '../metrics/SimulationMetricsCalculator';

// 한 시행에서 보관하는 것. 전 시행의 yearlyResults를 통째로 들면(1000 × 55년 × 30필드)
// 수십 MB가 되므로 스칼라 두 개와 연도별 총자산만 남긴다. 최악 경로의 상세는 그 시행의
// 시드로 한 번 더 돌려 얻는다(deriveSeed가 인덱스로 결정되므로 언제든 재현 가능하다).
interface TrialSummary {
  index: number;
  endingAssets: number;
  depletionAge: number | null;
  hasUnmetSpending: boolean;
  hasGoalSpendingShortfall: boolean;
  totalAssetsByYear: number[];
}

function summarize(
  index: number,
  result: StrategySimulationResult,
  goalParams: SimulationParams,
): TrialSummary {
  return {
    index,
    endingAssets: result.endingAssets,
    depletionAge: result.depletionAge,
    hasUnmetSpending: result.yearlyResults.some(hasSpendingShortfall),
    hasGoalSpendingShortfall: computeMonthlySpendingComposition(
      result.yearlyResults,
      goalParams,
      result,
    ).some((row) => row.goalShortfall >= SHORTFALL_EPSILON_MONTHLY),
    totalAssetsByYear: result.yearlyResults.map((y) => y.totalAssets),
  };
}

// 지정한 시행 인덱스의 수익률 경로. 시드가 (기준 시드, 인덱스)로만 결정되므로 같은
// 인덱스는 언제 호출해도 같은 경로를 준다 — 최악 경로 재실행이 이 성질에 기댄다.
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

// **자산 보존** 성공률만 필요한 호출자를 위한 경량 진입점(추천 엔진의 생활비 증액 게이트).
//
// 게이트가 자산 보존 기준을 쓰는 것은 의도다 — 그 게이트가 묻는 것은 "더 써도 자산이
// 버티는가"이고, RecommendationEngine.SPENDING_INCREASE_GATE의 실측 임계(0.9/0.8)도
// 그 기준으로 보정됐다. 생활 유지 성공률로 바꾸면 그 실측 근거가 통째로 무효가 된다.
//
// runMonteCarlo가 만드는 것 중 게이트가 쓰지 않는 것 — assetBand(연도별 분위수 정렬),
// worstDecilePath(추가 runSingle 1회), 결정론 기준선(추가 runSingle 1회), 시행별
// totalAssetsByYear 배열 — 을 전부 만들지 않는다. 성능보다 **계약**이 이유다: 게이트가
// MonteCarloResult 전체를 받으면 나중에 누군가 assetBand나 worstDecilePath를 판정에
// 끌어다 쓰고, 그 순간 게이트의 비용과 의미가 조용히 바뀐다.
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
      i,
      runFrozenPlan(engine, planned, pathForTrial(years, config, i)),
      params,
    ));
  }

  const endingSorted = trials.map((t) => t.endingAssets).sort((a, b) => a - b);
  const mean = endingSorted.reduce((a, b) => a + b, 0) / (endingSorted.length || 1);

  // 자산 보존 성공 = successAge까지 고갈되지 않음. 판정식은 isSuccessfulTrial 한 곳에만 둔다.
  const succeeded = trials.filter((t) => isSuccessfulTrial(t.depletionAge, successAge));
  // 생활 유지 성공 = 계획한 생활비를 한 해도 줄이지 않음. **고갈 여부를 묻지 않는다** —
  // 이유는 MonteCarloResult.spendingSuccessRate 주석에 있다.
  const spendingSucceeded = trials.filter((t) => !t.hasUnmetSpending);
  const terminalAssetGoal = Math.max(
    0,
    params.userProfile.targetBequest ?? params.assetFloor ?? 0,
  );
  const goalSucceeded = trials.filter((t) => (
    !t.hasGoalSpendingShortfall
    && isSuccessfulTrial(t.depletionAge, successAge)
    && t.endingAssets >= terminalAssetGoal
  ));

  const depletedAges = trials
    .map((t) => t.depletionAge)
    .filter((age): age is number => age !== null)
    .sort((a, b) => a - b);

  // 연도별 분위수. 각 해마다 전 시행의 총자산을 모아 정렬한다.
  const assetBand: MonteCarloBandYear[] = [];
  const startAge = planned.params.userProfile.currentAge;
  for (let y = 0; y < years; y++) {
    const columnSorted = trials
      .map((t) => t.totalAssetsByYear[y])
      .filter((v): v is number => v !== undefined)
      .sort((a, b) => a - b);
    if (columnSorted.length === 0) continue;
    assetBand.push({
      age: startAge + y,
      p10: percentileOfSorted(columnSorted, 0.1),
      p50: percentileOfSorted(columnSorted, 0.5),
      p90: percentileOfSorted(columnSorted, 0.9),
    });
  }

  return {
    trials: config.trials,
    seed: config.seed,
    annualStdDev: config.annualStdDev,
    successAge,
    successRate: trials.length > 0 ? succeeded.length / trials.length : 0,
    spendingSuccessRate: trials.length > 0 ? spendingSucceeded.length / trials.length : 0,
    goalSuccessProbability: trials.length > 0 ? goalSucceeded.length / trials.length : 0,
    spendingSuccessProbability: trials.length > 0 ? spendingSucceeded.length / trials.length : 0,
    assetSurvivalProbability: trials.length > 0 ? succeeded.length / trials.length : 0,
    terminalAssetMedian: percentileOfSorted(endingSorted, 0.5),
    terminalAssetP10: percentileOfSorted(endingSorted, 0.1),
    terminalAssetP90: percentileOfSorted(endingSorted, 0.9),
    shortfallProbability: trials.length > 0
      ? 1 - spendingSucceeded.length / trials.length
      : 0,
    plannedMonthlySpending: planned.monthlyTargetSpending,
    endingAssets: {
      p10: percentileOfSorted(endingSorted, 0.1),
      p50: percentileOfSorted(endingSorted, 0.5),
      p90: percentileOfSorted(endingSorted, 0.9),
      mean,
    },
    assetBand,
    depletion: {
      count: depletedAges.length,
      earliestAge: depletedAges.length > 0 ? depletedAges[0] : null,
      medianAge: depletedAges.length > 0 ? percentileOfSorted(depletedAges, 0.5) : null,
    },
    deterministicEndingAssets: deterministic.endingAssets,
    worstDecilePath: extractWorstDecilePath(trials, planned, engine, config, years),
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
    const spendingSuccessProbability = result.spendingSuccessProbability
      ?? result.spendingSuccessRate;

    return {
      trials: result.trials,
      seed: result.seed,
      goalSuccessProbability: result.goalSuccessProbability ?? 0,
      spendingSuccessProbability,
      assetSurvivalProbability: result.assetSurvivalProbability ?? result.successRate,
      terminalAssetMedian: result.terminalAssetMedian ?? result.endingAssets.p50,
      terminalAssetP10: result.terminalAssetP10 ?? result.endingAssets.p10,
      terminalAssetP90: result.terminalAssetP90 ?? result.endingAssets.p90,
      shortfallProbability: result.shortfallProbability ?? 1 - spendingSuccessProbability,
    };
  }
}

// 기말자산 기준 최악 10분위에 해당하는 대표 시행 하나를 골라 상세를 재실행한다.
//
// 밴드(p10/p50/p90)만으로는 "실제로 이런 인생"이 보이지 않는다 — 각 해의 분위수는 서로 다른
// 시행에서 온 값이라 그것을 이은 선은 어느 시행의 경로도 아니다. 실제 경로 하나가 필요하다.
function extractWorstDecilePath(
  trials: readonly TrialSummary[],
  planned: FrozenSpendingPlan,
  engine: SimulationEngine,
  config: MonteCarloConfig,
  years: number
): SimulationYearlyResult[] {
  if (trials.length === 0) return [];

  const byEndingAssets = [...trials].sort((a, b) => a.endingAssets - b.endingAssets);
  // 10분위 경계에 가장 가까운 시행. 최악 1개(이상치)가 아니라 "나쁜 축에 속하는 전형"을
  // 보여주려는 것이므로 최소값이 아니라 10% 지점을 고른다.
  const pick = byEndingAssets[Math.min(byEndingAssets.length - 1, Math.floor(byEndingAssets.length * 0.1))];

  return runFrozenPlan(engine, planned, pathForTrial(years, config, pick.index)).yearlyResults;
}
