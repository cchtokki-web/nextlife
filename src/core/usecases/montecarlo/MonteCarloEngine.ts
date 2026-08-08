import { SimulationParams, SimulationResult, SimulationYearlyResult } from '../../entities/types';
import { MonteCarloBandYear, MonteCarloConfig, MonteCarloResult } from '../../entities/montecarlo';
import { SimulationEngine } from '../SimulationEngine';
import { mulberry32, deriveSeed } from './rng';
import { buildReturnShockPath } from './returnPath';
import { percentileOfSorted } from './statistics';
import { simulationYearCount } from './horizon';

// 한 시행에서 보관하는 것. 전 시행의 yearlyResults를 통째로 들면(1000 × 55년 × 30필드)
// 수십 MB가 되므로 스칼라 두 개와 연도별 총자산만 남긴다. 최악 경로의 상세는 그 시행의
// 시드로 한 번 더 돌려 얻는다(deriveSeed가 인덱스로 결정되므로 언제든 재현 가능하다).
interface TrialSummary {
  index: number;
  endingAssets: number;
  depletionAge: number | null;
  hasUnmetSpending: boolean;
  totalAssetsByYear: number[];
}

// max_sustainable 전략을 시행 전에 **한 번만** 해소해 'target'으로 고정한다.
//
// 시행마다 이진탐색을 다시 돌리면 두 가지가 잘못된다:
//   1. 비용이 30배가 된다(시행당 runSingle 30회 추가).
//   2. 더 중요하게, **계획 자체가 시행마다 달라진다.** 그 시행이 겪을 미래를 미리 알고
//      생활비를 정하는 셈이라(완벽한 예지력) 성공률이 구조적으로 100%에 붙는다.
//      MC가 묻는 것은 "이 계획이 여러 미래에서 얼마나 견디는가"지 "미래를 알았다면 얼마나
//      썼을까"가 아니다.
function resolvePlannedParams(params: SimulationParams, engine: SimulationEngine): SimulationParams {
  if ((params.spendingStrategy ?? 'target') !== 'max_sustainable') return params;

  const sustainable = engine.run(params).calculatedTargetSpending ?? 0;
  return {
    ...params,
    spendingStrategy: 'target',
    userProfile: { ...params.userProfile, targetMonthlySpending: sustainable },
  };
}

function summarize(index: number, result: SimulationResult): TrialSummary {
  return {
    index,
    endingAssets: result.endingAssets,
    depletionAge: result.depletionAge,
    hasUnmetSpending: result.yearlyResults.some((y) => y.unmetSpending > 0),
    totalAssetsByYear: result.yearlyResults.map((y) => y.totalAssets),
  };
}

// 지정한 시행 인덱스의 수익률 경로. 시드가 (기준 시드, 인덱스)로만 결정되므로 같은
// 인덱스는 언제 호출해도 같은 경로를 준다 — 최악 경로 재실행이 이 성질에 기댄다.
function pathForTrial(years: number, config: MonteCarloConfig, index: number) {
  return buildReturnShockPath(years, config.annualStdDev, mulberry32(deriveSeed(config.seed, index)));
}

export function runMonteCarlo(
  params: SimulationParams,
  engine: SimulationEngine,
  config: MonteCarloConfig
): MonteCarloResult {
  const planned = resolvePlannedParams(params, engine);
  const years = simulationYearCount(planned);

  // 결정론 기준선. 팬 차트에 겹쳐 그려 변동성 손실을 드러내는 데 쓴다.
  //
  // run()이 아니라 runSingle을 부른다 — run()은 이진탐색 30회를 더 돌지만 여기서 필요한
  // 것은 기말자산뿐이다.
  const deterministic = engine.runSingle(planned);
  const successAge = planned.userProfile.expectancy;

  const trials: TrialSummary[] = [];
  for (let i = 0; i < config.trials; i++) {
    // runSingle만 부른다. run()이면 시행당 31회가 되어 1000시행이 31,000회가 된다
    // (RecommendationEngine이 runForUtility를 도입한 것과 같은 판단).
    trials.push(summarize(i, engine.runSingle(planned, pathForTrial(years, config, i))));
  }

  const endingSorted = trials.map((t) => t.endingAssets).sort((a, b) => a - b);
  const mean = endingSorted.reduce((a, b) => a + b, 0) / (endingSorted.length || 1);

  // 성공 = successAge까지 고갈되지 않음. depletionAge가 그 나이보다 뒤면 시뮬레이션이
  // 끝난 뒤의 일이므로 성공으로 본다.
  const succeeded = trials.filter((t) => t.depletionAge === null || t.depletionAge > successAge);
  // 목표 생활비를 온전히 쓴 시행 = 고갈도 없고 결손도 없는 시행.
  const fullSpending = succeeded.filter((t) => !t.hasUnmetSpending);

  const depletedAges = trials
    .map((t) => t.depletionAge)
    .filter((age): age is number => age !== null)
    .sort((a, b) => a - b);

  // 연도별 분위수. 각 해마다 전 시행의 총자산을 모아 정렬한다.
  const assetBand: MonteCarloBandYear[] = [];
  const startAge = planned.userProfile.currentAge;
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
    successAge,
    successRate: trials.length > 0 ? succeeded.length / trials.length : 0,
    fullSpendingRate: trials.length > 0 ? fullSpending.length / trials.length : 0,
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

// 기말자산 기준 최악 10분위에 해당하는 대표 시행 하나를 골라 상세를 재실행한다.
//
// 밴드(p10/p50/p90)만으로는 "실제로 이런 인생"이 보이지 않는다 — 각 해의 분위수는 서로 다른
// 시행에서 온 값이라 그것을 이은 선은 어느 시행의 경로도 아니다. 실제 경로 하나가 필요하다.
function extractWorstDecilePath(
  trials: readonly TrialSummary[],
  planned: SimulationParams,
  engine: SimulationEngine,
  config: MonteCarloConfig,
  years: number
): SimulationYearlyResult[] {
  if (trials.length === 0) return [];

  const byEndingAssets = [...trials].sort((a, b) => a.endingAssets - b.endingAssets);
  // 10분위 경계에 가장 가까운 시행. 최악 1개(이상치)가 아니라 "나쁜 축에 속하는 전형"을
  // 보여주려는 것이므로 최소값이 아니라 10% 지점을 고른다.
  const pick = byEndingAssets[Math.min(byEndingAssets.length - 1, Math.floor(byEndingAssets.length * 0.1))];

  return engine.runSingle(planned, pathForTrial(years, config, pick.index)).yearlyResults;
}
