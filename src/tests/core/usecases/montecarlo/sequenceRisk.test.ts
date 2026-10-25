import { describe, test, expect } from 'vitest';
import {
  computeSequenceRisk,
  buildEarlyCrashPath,
  orderRetirementReturnPaths,
} from '@/core/usecases/montecarlo/sequenceRisk';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { SimulationParams } from '@/core/entities/types';
import { ledgerTolerance } from '@/core/usecases/ledger/YearLedger';

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

  test('각 경우가 수익률 인덱스와 현금흐름을 연도별 debug result로 함께 준다', () => {
    const result = computeSequenceRisk(params(), engine, config);
    const worst = result.cases.find((c) => c.key === 'worstFirst')!;

    expect(worst.yearlyDebug).toHaveLength(85 - 55 + 1);
    expect(worst.yearlyDebug?.[0]).toEqual(expect.objectContaining({
      age: 55,
      beginningAssets: expect.any(Number),
      appliedReturnShock: expect.any(Number),
      investmentReturn: expect.any(Number),
      nationalPensionIncome: expect.any(Number),
      privatePensionIncome: expect.any(Number),
      livingExpense: expect.any(Number),
      tax: expect.any(Number),
      assetWithdrawal: expect.any(Number),
      endingAssets: expect.any(Number),
    }));
  });

  test('변동성이 0이면 순서 격차가 사라진다', () => {
    const result = computeSequenceRisk(params(), engine, { seed: 2026, annualStdDev: 0 });

    expect(result.orderingSpread).toBeCloseTo(0, 6);
  });
});

describe('명시적 5년 수익률 순서 회귀', () => {
  const withdrawalParams: SimulationParams = {
    userProfile: { currentAge: 65, retirementAge: 65, expectancy: 69, targetMonthlySpending: 1_000_000 },
    assets: [{
      id: 'a', type: 'etf', ticker: 'A', name: 'A', quantity: 1, averagePrice: 100_000_000,
      totalReturn: 0, dividendYield: 0, monthlyContribution: 0,
      reinvestDividend: true, currency: 'KRW',
    }],
    isaAccounts: [], privatePensions: [], otherIncomes: [],
    nationalPension: { expectedMonthlyAmount: 0 },
    inflationRate: 0, inflationMode: 'nominal', baseExchangeRate: 1,
    exchangeScenario: 'base', displayCurrency: 'KRW',
  };
  const caseA = [20, 10, 0, -10, -20];
  const caseB = [-20, -10, 0, 10, 20];

  test('Case B(나쁜 해 먼저)는 지속 인출 조건에서 Case A보다 불리하다', () => {
    const a = engine.runSingle(withdrawalParams, caseA);
    const b = engine.runSingle(withdrawalParams, caseB);

    expect(b.endingAssets).toBeLessThan(a.endingAssets);
  });

  test('두 Case는 산술평균과 CAGR이 완전히 같다', () => {
    const arithmetic = (path: number[]) => path.reduce((sum, value) => sum + value, 0) / path.length;
    const cagr = (path: number[]) => (
      Math.pow(path.reduce((product, value) => product * (1 + value / 100), 1), 1 / path.length) - 1
    );

    expect(arithmetic(caseA)).toBe(arithmetic(caseB));
    expect(cagr(caseA)).toBeCloseTo(cagr(caseB), 14);
  });

  test('연도별 원장에서 시작자산·수익·생활비·인출·기말자산을 추적할 수 있다', () => {
    const result = engine.runSingle(withdrawalParams, caseB);

    expect(result.yearlyResults.map((year, index) => ({
      beginningAssets: year.openingAssets,
      appliedReturn: caseB[index],
      investmentReturn: year.ledger?.investmentReturn.total,
      pensionIncome: year.pensionIncome,
      livingExpense: year.spending,
      tax: year.taxes,
      assetWithdrawal: year.generalAssetWithdrawal + year.isaWithdrawal,
      endingAssets: year.totalAssets,
    }))).toHaveLength(5);
    for (const year of result.yearlyResults) {
      expect(Math.abs(year.ledger!.residual)).toBeLessThanOrEqual(ledgerTolerance(year.ledger!));
    }
  });
});

describe('은퇴 경계 기준 순열', () => {
  test('적립기 경로는 고정하고 은퇴 이후만 정렬한다', () => {
    const paths = orderRetirementReturnPaths([30, -30, 20, 10, 0, -10, -20], 2);

    expect(paths.bestFirst.slice(0, 2)).toEqual([30, -30]);
    expect(paths.worstFirst.slice(0, 2)).toEqual([30, -30]);
    expect(paths.bestFirst.slice(2)).toEqual([20, 10, 0, -10, -20]);
    expect(paths.worstFirst.slice(2)).toEqual([-20, -10, 0, 10, 20]);
  });

  test('모든 비교 경로가 동일한 수익률 multiset을 보존한다', () => {
    const source = [30, -30, 20, 10, 0, -10, -20];
    const paths = orderRetirementReturnPaths(source, 2);
    const sorted = [...source].sort((a, b) => a - b);

    expect([...paths.bestFirst].sort((a, b) => a - b)).toEqual(sorted);
    expect([...paths.shuffled].sort((a, b) => a - b)).toEqual(sorted);
    expect([...paths.worstFirst].sort((a, b) => a - b)).toEqual(sorted);
    expect([...paths.earlyCrash].sort((a, b) => a - b)).toEqual(sorted);
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

// 이 패널이 «기준 시나리오와 같은 계획»을 돌린다는 것.
//
// 예전에는 engine.runSingle(params)를 직접 불렀다. runSingle은 max_sustainable의 이진탐색을
// 돌지 않으므로 사용자가 «입력한» 목표 생활비가 쓰였고, 헤드라인이 「월 344만원까지 쓸 수
// 있습니다」라고 말하는 계획의 「변동 없음 (기준)」 막대가 월 300만원 계획을 그렸다
// (실측: 기말자산 1억 4,505만원 대 5원). 「순서만 바꿨다」는 이 패널의 주장은 «다른 것은
// 전부 같다»를 전제하는데, 계획 자체가 다르면 그 전제가 깨진다.
describe('computeSequenceRisk — 고정된 계획으로 돈다', () => {
  function maxSustainable(over: Partial<SimulationParams> = {}): SimulationParams {
    return {
      userProfile: { currentAge: 60, retirementAge: 60, expectancy: 70, targetMonthlySpending: 3_000_000 },
      assets: [], isaAccounts: [], otherIncomes: [],
      privatePensions: [{
        id: 'p', type: 'irp', investmentType: 'etf', name: 'IRP',
        balance: 500_000_000, monthlyContribution: 0,
        totalReturn: 0, dividendYield: 0, currency: 'KRW',
      }],
      nationalPension: { expectedMonthlyAmount: 0 },
      inflationRate: 0, inflationMode: 'nominal', baseExchangeRate: 1400,
      exchangeScenario: 'base', displayCurrency: 'KRW',
      taxSettings: { limitPrivatePensionToTaxLimit: true },
      spendingStrategy: 'max_sustainable',
      ...over,
    } as unknown as SimulationParams;
  }

  test('HARD 바닥이 있는 max_sustainable 계획의 기준 막대가 헤드라인과 일치한다', () => {
    const p = maxSustainable({ hardSpendingFloor: 2_500_000 } as Partial<SimulationParams>);
    const headline = engine.run(p);
    const deterministic = computeSequenceRisk(p, engine, config).cases
      .find((c) => c.key === 'deterministic')!;

    // 헤드라인은 월 344만원 계획이고 기말자산은 사실상 0이다.
    expect(Math.round(headline.calculatedTargetSpending!)).toBe(3_446_597);
    expect(deterministic.endingAssets).toBeCloseTo(headline.endingAssets, 6);
    expect(deterministic.depletionAge).toBe(headline.depletionAge);
    // 예전 값(사용자 입력 월 300만원으로 돈 결과)으로는 절대 돌아가지 않는다.
    expect(Math.round(deterministic.endingAssets)).not.toBe(145_059_101);
  });

  test('바닥이 없는 max_sustainable 계획도 탐색값 계획으로 돈다', () => {
    const p = maxSustainable();
    const headline = engine.run(p);
    const deterministic = computeSequenceRisk(p, engine, config).cases
      .find((c) => c.key === 'deterministic')!;

    expect(deterministic.endingAssets).toBeCloseTo(headline.endingAssets, 6);
  });

  // 'target' 계획에서는 freezeSpendingPlan이 params를 그대로 돌려주므로 이 변경이 닿지 않는다.
  // 위 스위트의 모든 픽스처가 그쪽이고, 값이 한 발도 움직이지 않았다는 근거다.
  test('고정 생활비 계획은 이 변경이 건드리지 않는다', () => {
    const p = params();
    const deterministic = computeSequenceRisk(p, engine, config).cases
      .find((c) => c.key === 'deterministic')!;

    expect(deterministic.endingAssets).toBeCloseTo(engine.runSingle(p).endingAssets, 6);
  });
});
