import { describe, test, expect } from 'vitest';
import { computeSequenceRisk, buildEarlyCrashPath } from '@/core/usecases/montecarlo/sequenceRisk';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { SimulationParams } from '@/core/entities/types';

// **수익률 시퀀스 리스크(Sequence of Returns Risk).**
//
// 몬테카를로 안에 녹여 "최악 10% 경로"로 보여주면 사용자는 그것이 *평균이 나빠서인지
// 순서가 나빠서인지* 구분할 수 없다. 요구는 정확히 그 구분("평균은 같지만 초반에 큰
// 하락이 오면")이므로, 같은 수익률 **집합**을 순서만 바꿔 돌린다.
//
// 순열이면 산술평균도 기하평균도 완전히 같으므로 "평균이 달라서 그런 것 아니냐"는 반론이
// 원천 봉쇄된다. 이 스위트의 첫 테스트가 그 성질을 증명한다.
const engine = new SimulationEngine();

function params(overrides: Partial<SimulationParams> = {}): SimulationParams {
  return {
    userProfile: { currentAge: 55, retirementAge: 60, expectancy: 85, targetMonthlySpending: 2500000 },
    assets: [
      { id: 'a1', type: 'etf', ticker: 'SPY', name: 'S&P500', quantity: 400, averagePrice: 500000,
        totalReturn: 7, dividendYield: 2, monthlyContribution: 500000, reinvestDividend: true, currency: 'KRW' },
    ],
    isaAccounts: [],
    nationalPension: { expectedMonthlyAmount: 1000000 },
    privatePensions: [
      { id: 'p1', type: 'irp', balance: 50000000, monthlyContribution: 300000, totalReturn: 4, currency: 'KRW' },
    ],
    otherIncomes: [],
    inflationRate: 2,
    inflationMode: 'real',
    baseExchangeRate: 1350,
    exchangeScenario: 'base',
    displayCurrency: 'KRW',
    ...overrides,
  };
}

const config = { seed: 2026, annualStdDev: 15 };

describe('computeSequenceRisk', () => {
  test('결정론을 포함한 다섯 경우를 모두 보고한다', () => {
    const result = computeSequenceRisk(params(), engine, config);

    expect(result.cases.map((c) => c.key).sort()).toEqual(
      ['bestFirst', 'deterministic', 'earlyCrash', 'shuffled', 'worstFirst'].sort()
    );
  });

  // **이 테스트가 SoRR의 정의 그 자체다.**
  //
  // 인출도 적립도 없으면 순서는 결과에 영향을 줄 수 없다 — 곱셈은 교환법칙이 성립하므로
  // 같은 원소를 어떤 순서로 곱해도 같은 값이 나온다. 인출이 섞이는 순간에만 갈린다.
  // 이 성질이 깨지면 순열 구현이 틀렸거나 엔진이 순서에 부당하게 반응하는 것이다.
  test('인출도 적립도 없으면 순서가 결과를 바꾸지 못한다', () => {
    const noFlow = params({
      // 은퇴 전에 끝나는 계획 = 생활비 인출이 없다. 적립도 0으로 둔다.
      userProfile: { currentAge: 55, retirementAge: 90, expectancy: 70, targetMonthlySpending: 0 },
      assets: [
        { id: 'a1', type: 'etf', ticker: 'SPY', name: 'S&P500', quantity: 400, averagePrice: 500000,
          totalReturn: 7, dividendYield: 0, monthlyContribution: 0, reinvestDividend: true, currency: 'KRW' },
      ],
      privatePensions: [],
      nationalPension: { expectedMonthlyAmount: 0 },
    });

    const result = computeSequenceRisk(noFlow, engine, config);
    const endingOf = (key: string) => result.cases.find((c) => c.key === key)!.endingAssets;

    expect(endingOf('worstFirst') / endingOf('bestFirst')).toBeCloseTo(1, 9);
    expect(endingOf('shuffled') / endingOf('bestFirst')).toBeCloseTo(1, 9);
  });

  test('인출이 있으면 나쁜 해가 먼저 오는 쪽이 불리하다', () => {
    const result = computeSequenceRisk(params(), engine, config);
    const endingOf = (key: string) => result.cases.find((c) => c.key === key)!.endingAssets;

    expect(endingOf('worstFirst')).toBeLessThan(endingOf('bestFirst'));
  });

  test('순서만으로 갈린 기말자산 격차를 보고한다', () => {
    const result = computeSequenceRisk(params(), engine, config);
    const endingOf = (key: string) => result.cases.find((c) => c.key === key)!.endingAssets;

    expect(result.orderingSpread).toBeCloseTo(endingOf('bestFirst') - endingOf('worstFirst'), 6);
    expect(result.orderingSpread).toBeGreaterThan(0);
  });

  // 화면이 "평균은 같습니다"라고 주장하려면 그 근거가 결과에 실려 있어야 한다.
  // 소비처가 다시 유도하게 두면 두 곳이 어긋날 수 있다.
  test('세 순열의 연평균 충격이 완전히 같다는 사실을 결과에 싣는다', () => {
    const result = computeSequenceRisk(params(), engine, config);

    expect(Number.isFinite(result.sharedMeanShock)).toBe(true);
  });

  test('같은 시드는 같은 결과를 준다', () => {
    expect(JSON.stringify(computeSequenceRisk(params(), engine, config)))
      .toBe(JSON.stringify(computeSequenceRisk(params(), engine, config)));
  });

  test('결정론 경우는 충격 없는 실행과 일치한다', () => {
    const result = computeSequenceRisk(params(), engine, config);
    const deterministic = result.cases.find((c) => c.key === 'deterministic')!;

    expect(deterministic.endingAssets).toBeCloseTo(engine.runSingle(params()).endingAssets, 6);
  });

  test('각 경우가 연도별 총자산 추이를 함께 준다', () => {
    const result = computeSequenceRisk(params(), engine, config);

    for (const c of result.cases) {
      expect(c.yearlyTotalAssets.length).toBe(85 - 55 + 1);
      expect(c.yearlyTotalAssets[0].age).toBe(55);
    }
  });

  test('변동성이 0이면 순서 격차가 사라진다', () => {
    const result = computeSequenceRisk(params(), engine, { seed: 2026, annualStdDev: 0 });

    expect(result.orderingSpread).toBeCloseTo(0, 6);
  });
});

describe('buildEarlyCrashPath', () => {
  test('은퇴 직후 지정한 해에 하락 충격을 넣는다', () => {
    const path = buildEarlyCrashPath(30, 5, 5, -30);

    for (let i = 5; i < 10; i++) expect(path[i]).toBe(-30);
  });

  // 산술평균을 보존해야 화면이 "평균은 같은데 순서만 다르다"고 말할 수 있다.
  // 하락분을 나머지 해에 균등 분배한다.
  test('하락분을 나머지 해에 분배해 산술평균을 0으로 유지한다', () => {
    const path = buildEarlyCrashPath(30, 5, 5, -30);
    const mean = path.reduce((a, b) => a + b, 0) / path.length;

    expect(mean).toBeCloseTo(0, 9);
  });

  test('하락 구간이 전체 기간을 덮으면 분배할 곳이 없어 평균이 하락폭과 같다', () => {
    const path = buildEarlyCrashPath(5, 0, 5, -30);

    expect(path.every((v) => v === -30)).toBe(true);
  });

  test('시작 인덱스가 기간을 넘으면 충격이 없다', () => {
    expect(buildEarlyCrashPath(10, 20, 5, -30).every((v) => v === 0)).toBe(true);
  });

  test('길이가 0이면 빈 경로다', () => {
    expect(buildEarlyCrashPath(0, 0, 5, -30)).toEqual([]);
  });
});
