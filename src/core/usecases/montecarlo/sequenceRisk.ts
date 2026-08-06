import { ReturnShockPath, SimulationParams } from '../../entities/types';
import { SimulationEngine } from '../SimulationEngine';
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
}

export interface SequenceRiskResult {
  cases: readonly SequenceRiskCase[];
  // 순서만으로 갈린 기말자산 격차 = bestFirst − worstFirst. 헤드라인 숫자.
  orderingSpread: number;
  // 세 순열이 공유하는 연평균 충격(%p). 화면이 "평균은 같습니다"라고 주장하는 근거를
  // 결과에 실어 보낸다 — 소비처가 다시 유도하게 두면 두 곳이 어긋날 수 있다.
  sharedMeanShock: number;
}

// 은퇴 직후 급락 시나리오의 기본값. 5년 연속 연 −30%p는 닷컴 붕괴·금융위기급 하락에
// 해당하는 크기다.
const EARLY_CRASH_YEARS = 5;
const EARLY_CRASH_PERCENT_POINTS = -30;

const CASE_LABELS: Record<SequenceRiskCase['key'], string> = {
  deterministic: '변동 없음 (기준)',
  bestFirst: '좋은 해가 먼저',
  shuffled: '무작위 순서',
  worstFirst: '나쁜 해가 먼저',
  earlyCrash: '은퇴 직후 5년 급락',
};

// 은퇴 직후 몇 년간 큰 하락이 오는 경로.
//
// 하락분을 나머지 해에 균등 분배해 **산술평균을 보존한다** — 그래야 화면이 "평균은 같은데
// 순서만 다르다"고 말하는 것이 참이 된다. (순열과 달리 기하평균까지 보존되지는 않으므로
// 화면 문구는 "연평균(산술) 수익률"이어야 한다.)
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
  params: SimulationParams,
  engine: SimulationEngine,
  path: ReturnShockPath | undefined
): SequenceRiskCase {
  const result = engine.runSingle(params, path);
  return {
    key,
    label: CASE_LABELS[key],
    endingAssets: result.endingAssets,
    depletionAge: result.depletionAge,
    yearlyTotalAssets: result.yearlyResults.map((y) => ({ age: y.age, totalAssets: y.totalAssets })),
  };
}

export function computeSequenceRisk(
  params: SimulationParams,
  engine: SimulationEngine,
  config: { seed: number; annualStdDev: number }
): SequenceRiskResult {
  const years = simulationYearCount(params);
  const startAge = params.userProfile.currentAge;

  // 경로 하나를 뽑아 그것의 순열들을 만든다. 세 경우가 완전히 같은 원소를 갖는 것이 핵심이다.
  const shuffled = buildReturnShockPath(years, config.annualStdDev, mulberry32(config.seed));
  const worstFirst = [...shuffled].sort((a, b) => a - b);
  const bestFirst = [...shuffled].sort((a, b) => b - a);

  const meanShock = shuffled.length > 0
    ? shuffled.reduce((a, b) => a + b, 0) / shuffled.length
    : 0;

  // 은퇴까지 남은 해. 이미 은퇴했으면 0(지금 당장이 은퇴 직후다).
  const yearsUntilRetirement = Math.max(0, params.userProfile.retirementAge - startAge);
  const earlyCrash = buildEarlyCrashPath(years, yearsUntilRetirement, EARLY_CRASH_YEARS, EARLY_CRASH_PERCENT_POINTS);

  const cases: SequenceRiskCase[] = [
    runCase('deterministic', params, engine, undefined),
    runCase('bestFirst', params, engine, bestFirst),
    runCase('shuffled', params, engine, shuffled),
    runCase('worstFirst', params, engine, worstFirst),
    runCase('earlyCrash', params, engine, earlyCrash),
  ];

  const endingOf = (key: SequenceRiskCase['key']) => cases.find((c) => c.key === key)!.endingAssets;

  return {
    cases,
    orderingSpread: endingOf('bestFirst') - endingOf('worstFirst'),
    sharedMeanShock: meanShock,
  };
}
