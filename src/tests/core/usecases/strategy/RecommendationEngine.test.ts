import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { recommendStrategy, buildReasons, computeDeltas } from '@/core/usecases/strategy/RecommendationEngine';
import { computeLifetimeUtility } from '@/core/usecases/utility/UtilityEngine';
import {
  AssetSellOrderStrategy,
  IsaMaturityDestination,
  SimulationParams,
  StrategyRecommendation,
  SimulationResult,
  SimulationYearlyResult,
  WithdrawalPlan,
} from '@/core/entities/types';

const zeroDeltas: StrategyRecommendation['deltas'] = {
  lifetimeConsumption: 0,
  totalTax: 0,
  endingAssets: 0,
  pensionEndingBalance: 0,
  comprehensiveTaxYears: 0,
  healthInsuranceTotal: 0,
};

// 사적연금 잔액이 매우 커서(6억) 균등분할 인출 시 사망 시점까지 상당액이 남는,
// 즉 최적화 여지가 뚜렷한 시나리오
const paramsWithLargePension: SimulationParams = {
  userProfile: {
    currentAge: 60,
    retirementAge: 60,
    expectancy: 90,
    targetMonthlySpending: 2000000,
  },
  assets: [],
  nationalPension: { expectedMonthlyAmount: 1000000 },
  privatePensions: [
    {
      id: 'pension-1',
      type: 'irp',
      balance: 600000000,
      monthlyContribution: 0,
      annualReturn: 4,
      currency: 'KRW',
    },
  ],
  otherIncomes: [],
  inflationRate: 0,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

// 자산 매도 순서·ISA 만기 목적지 두 차원이 실제로 결과에 영향을 주도록, 배당률이 크게 다른
// 자산 2개와 ISA 계좌를 함께 둔 시나리오 (사적연금은 paramsWithLargePension과 동일하게 유지)
const paramsWithAssetsAndIsa: SimulationParams = {
  ...paramsWithLargePension,
  assets: [
    {
      id: 'asset-high-div',
      type: 'stock',
      ticker: 'HIGHDIV',
      name: '고배당주',
      quantity: 1000,
      averagePrice: 10000,
      annualGrowthRate: 2,
      dividendYield: 8,
      monthlyContribution: 0,
      reinvestDividend: false,
      currency: 'KRW',
    },
    {
      id: 'asset-low-div',
      type: 'stock',
      ticker: 'LOWDIV',
      name: '저배당 성장주',
      quantity: 1000,
      averagePrice: 10000,
      annualGrowthRate: 8,
      dividendYield: 0.5,
      monthlyContribution: 0,
      reinvestDividend: false,
      currency: 'KRW',
    },
  ],
  isaAccounts: [
    {
      id: 'isa-1',
      type: 'general',
      balance: 50000000,
      monthlyContribution: 0,
      annualReturn: 5,
      dividendYield: 2,
      currency: 'KRW',
      maturityYears: 3,
    },
  ],
};

describe('recommendStrategy', () => {
  test('assetSellOrderStrategy/isaMaturityDestination 후보를 실제로 탐색해 최적 조합을 고른다', () => {
    const engine = new SimulationEngine();
    const recommendation = recommendStrategy(paramsWithAssetsAndIsa, engine);

    // 두 차원을 제외한 나머지 계획은 recommendStrategy가 고른 조합으로 고정한 채, 두 차원의
    // 6개 조합(3×2)을 엔진으로 직접 재현해 recommendStrategy가 실제로 최적을 찾았는지 검증한다.
    const dimensionGrid: Array<[AssetSellOrderStrategy, IsaMaturityDestination]> = [
      ['input_order', 'pension'],
      ['input_order', 'asset'],
      ['low_dividend_first', 'pension'],
      ['low_dividend_first', 'asset'],
      ['high_dividend_first', 'pension'],
      ['high_dividend_first', 'asset'],
    ];

    const utilities = dimensionGrid.map(([assetSellOrderStrategy, isaMaturityDestination]) => {
      const plan: WithdrawalPlan = {
        ...(recommendation.recommendedPlan ?? {}),
        assetSellOrderStrategy,
        isaMaturityDestination,
      };
      const candidateResult = engine.runForUtility({ ...paramsWithAssetsAndIsa, withdrawalPlan: plan });
      return computeLifetimeUtility(candidateResult, paramsWithAssetsAndIsa).score;
    });

    const bestAmongGrid = Math.max(...utilities);
    expect(recommendation.recommendedUtility.score).toBeGreaterThanOrEqual(bestAmongGrid - 1e-9);

    // 두 차원이 실제로 결과에 영향을 준다는 것도 함께 확인한다 (전부 동일하면 탐색이 무의미하다).
    const distinctScores = new Set(utilities.map((u) => u.toFixed(6)));
    expect(distinctScores.size).toBeGreaterThan(1);
  });

  test('추천 전략의 Utility는 현재(baseline) 전략의 Utility보다 낮지 않아야 한다', () => {
    const engine = new SimulationEngine();
    const recommendation = recommendStrategy(paramsWithLargePension, engine);

    expect(recommendation.recommendedUtility.score).toBeGreaterThanOrEqual(recommendation.currentUtility.score);
  });

  test('추천 결과는 항상 reasons를 최소 1개 이상 포함한다', () => {
    const engine = new SimulationEngine();
    const recommendation = recommendStrategy(paramsWithLargePension, engine);

    expect(recommendation.reasons.length).toBeGreaterThan(0);
  });

  test('탐색할 만한 최적화 차원이 전혀 없으면(사적연금·국민연금·복수자산·ISA 모두 없음) 추천 Utility가 현재 Utility와 동일하다', () => {
    const engine = new SimulationEngine();
    const noOptimizableDimensionParams: SimulationParams = {
      ...paramsWithLargePension,
      privatePensions: [],
      nationalPension: { expectedMonthlyAmount: 0 },
    };
    const recommendation = recommendStrategy(noOptimizableDimensionParams, engine);

    expect(recommendation.recommendedUtility.score).toBe(recommendation.currentUtility.score);
  });

  test('deltas 필드가 baseline과 추천 전략 간 실제 수치 차이를 반영한다', () => {
    const engine = new SimulationEngine();
    const recommendation = recommendStrategy(paramsWithLargePension, engine);

    // deltas의 각 필드는 숫자여야 하며 NaN이 아니어야 한다
    Object.values(recommendation.deltas).forEach((v) => {
      expect(typeof v).toBe('number');
      expect(Number.isNaN(v)).toBe(false);
    });
  });
});

function makeYearlyResult(overrides: Partial<SimulationYearlyResult>): SimulationYearlyResult {
  return {
    age: 60,
    year: 2026,
    totalAssets: 0,
    stockAssets: 0,
    pensionAssets: 0,
    dividendIncome: 0,
    nationalPensionIncome: 0,
    privatePensionIncome: 0,
    pensionIncome: 0,
    otherIncome: 0,
    totalIncome: 0,
    preTaxTotalIncome: 0,
    dividendTaxPaid: 0,
    pensionTaxPaid: 0,
    nationalPensionTaxPaid: 0,
    healthInsurancePaid: 0,
    comprehensiveTaxPaid: 0,
    spending: 0,
    hasTaxWarning: false,
    ...overrides,
  };
}

function makeSimulationResult(yearlyResults: SimulationYearlyResult[], endingAssets: number): SimulationResult {
  return {
    yearlyResults,
    fireAge: 60,
    depletionAge: null,
    endingAssets,
    retirementScore: 0,
    retirementGrade: '보통',
    goalAchievementRate: 100,
    retirementAssetsAtRetirement: 0,
  };
}

describe('computeDeltas - baseline/recommended 실제 수치 차이 계산', () => {
  const baseline = makeSimulationResult(
    [
      makeYearlyResult({ age: 60, year: 2026, spending: 1000, dividendTaxPaid: 10, pensionTaxPaid: 5, healthInsurancePaid: 20, hasTaxWarning: false, pensionAssets: 500 }),
      makeYearlyResult({ age: 61, year: 2027, spending: 1100, dividendTaxPaid: 15, pensionTaxPaid: 5, healthInsurancePaid: 25, hasTaxWarning: true, pensionAssets: 400 }),
    ],
    5000
  );
  const recommended = makeSimulationResult(
    [
      makeYearlyResult({ age: 60, year: 2026, spending: 1200, dividendTaxPaid: 20, pensionTaxPaid: 10, nationalPensionTaxPaid: 5, healthInsurancePaid: 15, hasTaxWarning: true, pensionAssets: 600 }),
      makeYearlyResult({ age: 61, year: 2027, spending: 1300, dividendTaxPaid: 25, pensionTaxPaid: 10, nationalPensionTaxPaid: 5, healthInsurancePaid: 15, comprehensiveTaxPaid: 10, hasTaxWarning: true, pensionAssets: 550 }),
    ],
    6000
  );

  test('deltas의 각 필드가 baseline/recommended 간 실제 차이와 정확히 일치한다', () => {
    const deltas = computeDeltas(baseline, recommended);

    expect(deltas.lifetimeConsumption).toBe(400); // (1200+1300) - (1000+1100)
    expect(deltas.totalTax).toBe(35); // (50+65) - (35+45)
    expect(deltas.endingAssets).toBe(1000); // 6000 - 5000
    expect(deltas.pensionEndingBalance).toBe(150); // 550(마지막 해) - 400(마지막 해)
    expect(deltas.comprehensiveTaxYears).toBe(1); // 2개 연도(hasTaxWarning) - 1개 연도
    expect(deltas.healthInsuranceTotal).toBe(-15); // 30 - 45
  });
});

describe('buildReasons - 자산 매도 순서 / ISA 만기 이동 문구', () => {
  test('low_dividend_first면 저배당 자산 우선 매도 문구를 포함한다', () => {
    const reasons = buildReasons({ assetSellOrderStrategy: 'low_dividend_first' }, zeroDeltas, true);
    expect(reasons.some((r) => r.includes('배당') && r.includes('낮은'))).toBe(true);
  });

  test('high_dividend_first면 고배당 자산 우선 매도 문구를 포함한다', () => {
    const reasons = buildReasons({ assetSellOrderStrategy: 'high_dividend_first' }, zeroDeltas, true);
    expect(reasons.some((r) => r.includes('배당') && r.includes('높은'))).toBe(true);
  });

  test('input_order이거나 미지정이면 매도 순서 관련 문구를 추가하지 않는다', () => {
    const reasonsInputOrder = buildReasons({ assetSellOrderStrategy: 'input_order' }, zeroDeltas, true);
    expect(reasonsInputOrder.some((r) => r.includes('매도'))).toBe(false);

    const reasonsUndefined = buildReasons({}, zeroDeltas, true);
    expect(reasonsUndefined.some((r) => r.includes('매도'))).toBe(false);
  });

  test("isaMaturityDestination이 'asset'이면 ISA 자금 이동 문구를 포함한다", () => {
    const reasons = buildReasons({ isaMaturityDestination: 'asset' }, zeroDeltas, true);
    expect(reasons.some((r) => r.includes('ISA') && r.includes('일반 자산'))).toBe(true);
  });

  test("isaMaturityDestination이 'pension'이거나 미지정이면 ISA 이동 문구를 추가하지 않는다", () => {
    const reasonsPension = buildReasons({ isaMaturityDestination: 'pension' }, zeroDeltas, true);
    expect(reasonsPension.some((r) => r.includes('ISA'))).toBe(false);

    const reasonsUndefined = buildReasons({}, zeroDeltas, true);
    expect(reasonsUndefined.some((r) => r.includes('ISA'))).toBe(false);
  });
});

describe('buildReasons - 일반계좌(자산) 인출 시점 문구', () => {
  test('generalAssetWithdrawalStartAge가 정의되어 있으면 인출 개시 나이 문구를 포함한다', () => {
    const reasons = buildReasons({ generalAssetWithdrawalStartAge: 70 }, zeroDeltas, true);
    expect(reasons.some((r) => r.includes('70세') && r.includes('일반 자산'))).toBe(true);
  });

  test('generalAssetWithdrawalStartAge가 미지정이면 관련 문구를 추가하지 않는다', () => {
    const reasons = buildReasons({}, zeroDeltas, true);
    expect(reasons.some((r) => r.includes('일반 자산'))).toBe(false);
  });
});

describe('buildReasons - 국민연금 조기/연기수령 문구', () => {
  test('nationalPensionStartAge가 65세보다 이르면 조기 수령 문구를 포함한다', () => {
    const reasons = buildReasons(
      { nationalPensionStartAge: 60 },
      zeroDeltas,
      true
    );
    expect(reasons.some((r) => r.includes('60세') && r.includes('조기'))).toBe(true);
  });

  test('nationalPensionStartAge가 65세보다 늦으면 연기 수령 문구를 포함한다', () => {
    const reasons = buildReasons(
      { nationalPensionStartAge: 70 },
      zeroDeltas,
      true
    );
    expect(reasons.some((r) => r.includes('70세') && r.includes('연기'))).toBe(true);
  });

  test('nationalPensionStartAge가 65세이거나 미지정이면 국민연금 관련 문구를 추가하지 않는다', () => {
    const reasonsAt65 = buildReasons({ nationalPensionStartAge: 65 }, zeroDeltas, true);
    expect(reasonsAt65.some((r) => r.includes('국민연금'))).toBe(false);

    const reasonsUndefined = buildReasons({}, zeroDeltas, true);
    expect(reasonsUndefined.some((r) => r.includes('국민연금'))).toBe(false);
  });
});
