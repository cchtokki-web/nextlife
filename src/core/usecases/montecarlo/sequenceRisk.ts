import { ReturnShockPath, SimulationParams } from '../../entities/types';
import { SimulationEngine } from '../SimulationEngine';
import { freezeSpendingPlan, runFrozenPlan, type FrozenSpendingPlan } from '../spending/freezeSpendingPlan';
import { mulberry32 } from './rng';
import { buildReturnShockPath } from './returnPath';
import { simulationYearCount } from './horizon';

// **수익률 시퀀스 리스크(Sequence of Returns Risk).**
//
// 몬테카를로 안에 녹여 "최악 10% 경로"로 보여주면 사용자는 그것이 *평균이 나빠서인지
// 순서가 나빠서인지* 구분할 수 없다. 요구는 정확히 그 구분("평균은 같지만 초반에 큰 하락이
// 오면 결과가 어떻게 달라지는지")이므로, 같은 수익률 **집합**을 순서만 바꿔 돌린다.
//
// 순열이면 산술평균도 기하평균도 완전히 같다(원소가 같으므로). "평균이 달라서 그런 것
// 아니냐"는 반론이 원천 봉쇄된다. 무작위 두 경로를 비교하는 방식으로는 그 반론을 막을 수 없다.
//
// 검증 가능한 성질(테스트가 고정한다): 인출도 적립도 없는 포트폴리오라면 세 순서의
// 기말자산이 부동소수 오차 내에서 **같아야** 한다 — 곱셈의 교환법칙이다.
export interface SequenceRiskCase {
  key: 'bestFirst' | 'shuffled' | 'worstFirst' | 'earlyCrash' | 'deterministic';
  label: string;
  endingAssets: number;
  depletionAge: number | null;
  yearlyTotalAssets: readonly { age: number; totalAssets: number }[];
  /** 연도별 계산 추적. 순서·인덱스 오류를 숫자 하나가 아니라 원장으로 검증한다. */
  yearlyDebug?: readonly SequenceRiskYearDebug[];
}

export interface SequenceRiskYearDebug {
  age: number;
  year: number;
  beginningAssets: number;
  appliedReturnShock: number;
  investmentReturn: number;
  nationalPensionIncome: number;
  privatePensionIncome: number;
  livingExpense: number;
  tax: number;
  assetWithdrawal: number;
  endingAssets: number;
}

export interface SequenceRiskResult {
  cases: readonly SequenceRiskCase[];
  // 순서만으로 갈린 기말자산 격차 = bestFirst − worstFirst. 헤드라인 숫자.
  orderingSpread: number;
  // 세 순열이 공유하는 연평균 충격(%p). 화면이 "평균은 같습니다"라고 주장하는 근거를
  // 결과에 실어 보낸다 — 소비처가 다시 유도하게 두면 두 곳이 어긋날 수 있다.
  sharedMeanShock: number;
  /** 동일한 충격 집합의 복리수익률. -100% 이하 원소가 있으면 정의할 수 없어 null이다. */
  sharedCagrShock?: number | null;
}

// 은퇴 직후 최악 구간으로 묶어 보여줄 연수.
const EARLY_CRASH_YEARS = 5;

const CASE_LABELS: Record<SequenceRiskCase['key'], string> = {
  deterministic: '변동 없음 (기준)',
  bestFirst: '좋은 해가 먼저',
  shuffled: '무작위 순서',
  worstFirst: '나쁜 해가 먼저',
  earlyCrash: '은퇴 직후 최악 5년',
};

export interface OrderedSequencePaths {
  bestFirst: ReturnShockPath;
  shuffled: ReturnShockPath;
  worstFirst: ReturnShockPath;
  earlyCrash: ReturnShockPath;
}

/**
 * 적립기 경로는 모든 경우에 그대로 두고, 은퇴 이후 구간만 순열한다.
 *
 * 전체 경로를 정렬하면 나쁜 수익률이 적립기 앞쪽으로 이동하고 좋은 수익률이 인출기 뒤쪽으로
 * 이동한다. 적립기에는 아직 잔액이 작고 계속 납입하므로 그 조합이 오히려 가장 유리할 수 있다.
 * Sequence Risk가 묻는 것은 은퇴 후 인출 중의 순서이므로 경계 앞쪽은 건드리지 않는다.
 */
export function orderRetirementReturnPaths(
  path: ReturnShockPath,
  retirementYearIndex: number,
): OrderedSequencePaths {
  const split = Math.min(path.length, Math.max(0, retirementYearIndex));
  const accumulation = path.slice(0, split);
  const retirement = path.slice(split);
  const bestRetirementFirst = [...retirement].sort((a, b) => b - a);
  const worstRetirementFirst = [...retirement].sort((a, b) => a - b);

  // 별도 스트레스 수익률을 새로 만들지 않는다. 은퇴 후 실제 표본의 최악 5개만 앞으로 옮겨
  // 산술평균과 CAGR을 포함한 수익률 집합 전체를 보존한다.
  const worstFive = worstRetirementFirst.slice(0, Math.min(EARLY_CRASH_YEARS, retirement.length));
  const remaining = [...retirement];
  for (const shock of worstFive) {
    const index = remaining.indexOf(shock);
    if (index >= 0) remaining.splice(index, 1);
  }

  return {
    bestFirst: [...accumulation, ...bestRetirementFirst],
    shuffled: [...path],
    worstFirst: [...accumulation, ...worstRetirementFirst],
    earlyCrash: [...accumulation, ...worstFive, ...remaining],
  };
}

function compoundedRate(path: ReturnShockPath): number | null {
  if (path.length === 0) return 0;
  if (path.some((value) => value <= -100)) return null;
  const product = path.reduce((acc, value) => acc * (1 + value / 100), 1);
  return (Math.pow(product, 1 / path.length) - 1) * 100;
}

// 은퇴 직후 몇 년간 큰 하락이 오는 독립 스트레스 경로.
//
// 하락분을 나머지 해에 균등 분배해 **산술평균을 보존한다** — 그래야 화면이 "평균은 같은데
// 순서만 다르다"고 말하는 것이 참이 된다. (순열과 달리 기하평균까지 보존되지는 않으므로
// 화면 문구는 "연평균(산술) 수익률"이어야 한다.)
//
// @deprecated Sequence Risk 비교에는 쓰지 않는다. 기존 import 호환을 위해 남겨 두며,
// computeSequenceRisk는 동일 수익률 집합을 보존하는 orderRetirementReturnPaths를 사용한다.
export function buildEarlyCrashPath(
  years: number,
  startYearIndex: number,
  crashYears: number,
  crashPercentPoints: number
): ReturnShockPath {
  if (years <= 0) return [];

  const path = new Array<number>(years).fill(0);
  const start = Math.max(0, startYearIndex);
  const end = Math.min(years, start + crashYears);
  if (start >= years) return path;

  for (let i = start; i < end; i++) path[i] = crashPercentPoints;

  // 하락 구간이 전체를 덮으면 분배할 곳이 없다. 그 경우 평균 보존을 포기한다 —
  // 없는 해에 나눠 담을 수는 없다.
  const crashedCount = end - start;
  const remainingCount = years - crashedCount;
  if (remainingCount <= 0) return path;

  const compensation = (-crashPercentPoints * crashedCount) / remainingCount;
  for (let i = 0; i < years; i++) {
    if (i < start || i >= end) path[i] = compensation;
  }

  return path;
}

function runCase(
  key: SequenceRiskCase['key'],
  plan: FrozenSpendingPlan,
  engine: SimulationEngine,
  path: ReturnShockPath | undefined
): SequenceRiskCase {
  const result = runFrozenPlan(engine, plan, path);
  return {
    key,
    label: CASE_LABELS[key],
    endingAssets: result.endingAssets,
    depletionAge: result.depletionAge,
    yearlyTotalAssets: result.yearlyResults.map((y) => ({ age: y.age, totalAssets: y.totalAssets })),
    yearlyDebug: result.yearlyResults.map((year, index) => ({
      age: year.age,
      year: year.year,
      beginningAssets: year.openingAssets,
      appliedReturnShock: path?.[index] ?? 0,
      investmentReturn: year.ledger?.investmentReturn.total ?? year.investmentReturn,
      nationalPensionIncome: year.nationalPensionIncome,
      privatePensionIncome: year.privatePensionIncome,
      livingExpense: year.spending,
      tax: year.taxes,
      assetWithdrawal: year.generalAssetWithdrawal + year.isaWithdrawal,
      endingAssets: year.totalAssets,
    })),
  };
}

export function computeSequenceRisk(
  params: SimulationParams,
  engine: SimulationEngine,
  config: { seed: number; annualStdDev: number }
): SequenceRiskResult {
  const years = simulationYearCount(params);
  const startAge = params.userProfile.currentAge;

  // **기준 시나리오와 «같은 계획»을 돌린다.** 예전에는 engine.runSingle(params)를 직접 불렀는데,
  // runSingle은 max_sustainable의 이진탐색을 돌지 않으므로 사용자가 입력한 목표 생활비를
  // 그대로 썼다. 그 결과 헤드라인이 「월 344만원까지 쓸 수 있습니다」라고 말하는 계획의
  // 시퀀스 리스크 패널이 월 300만원 계획을 그렸다(실측: 결정론 기말자산 1.45억 대 5원).
  // 「순서만 바꿨다」는 이 패널의 주장은 «다른 것은 전부 같다»를 전제하는데, 계획 자체가
  // 다르면 그 전제가 깨진다.
  //
  // 몬테카를로(MonteCarloEngine)와 민감도(computeSensitivityAnalysis)가 이미 같은 이유로
  // 같은 통로를 쓴다. 'target' 계획에서는 freezeSpendingPlan이 params를 그대로 돌려주므로
  // 이 변경이 닿지 않는다.
  const plan = freezeSpendingPlan(params, engine);

  // 경로 하나를 뽑아 그것의 순열들을 만든다. 세 경우가 완전히 같은 원소를 갖는 것이 핵심이다.
  const shuffled = buildReturnShockPath(years, config.annualStdDev, mulberry32(config.seed));
  const meanShock = shuffled.length > 0
    ? shuffled.reduce((a, b) => a + b, 0) / shuffled.length
    : 0;

  // 은퇴까지 남은 해. 이미 은퇴했으면 0(지금 당장이 은퇴 직후다).
  const yearsUntilRetirement = Math.max(0, params.userProfile.retirementAge - startAge);
  const orderedPaths = orderRetirementReturnPaths(shuffled, yearsUntilRetirement);

  const cases: SequenceRiskCase[] = [
    runCase('deterministic', plan, engine, undefined),
    runCase('bestFirst', plan, engine, orderedPaths.bestFirst),
    runCase('shuffled', plan, engine, orderedPaths.shuffled),
    runCase('worstFirst', plan, engine, orderedPaths.worstFirst),
    runCase('earlyCrash', plan, engine, orderedPaths.earlyCrash),
  ];

  const endingOf = (key: SequenceRiskCase['key']) => cases.find((c) => c.key === key)!.endingAssets;

  return {
    cases,
    orderingSpread: endingOf('bestFirst') - endingOf('worstFirst'),
    sharedMeanShock: meanShock,
    sharedCagrShock: compoundedRate(shuffled),
  };
}
