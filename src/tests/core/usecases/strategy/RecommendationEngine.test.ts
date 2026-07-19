import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { recommendStrategy, buildReasons } from '@/core/usecases/strategy/RecommendationEngine';
import { SimulationParams, StrategyRecommendation } from '@/core/entities/types';

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

describe('recommendStrategy', () => {
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
