import { describe, test, expect, vi } from 'vitest';
import { optimizeDividendReinvestment } from '@/core/usecases/strategy/DividendReinvestmentOptimizer';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { DEFAULT_UTILITY_CONFIG } from '@/core/usecases/utility/utilityWeights';
import {
  CompleteWithdrawalPlan,
  InvestmentAsset,
  SimulationParams,
  SimulationResult,
  UtilityBreakdown,
} from '@/core/entities/types';

vi.mock('@/core/usecases/utility/UtilityEngine', () => ({
  computeLifetimeUtility: vi.fn((result: SimulationResult) => ({
    score: result.retirementScore,
    components: { consumption: 0, depletionSafety: 0, pensionUtilization: 0, taxEfficiency: 0, taxationRisk: 0, bequestAdequacy: 0 },
  })),
}));

const zeroComponents = { consumption: 0, depletionSafety: 0, pensionUtilization: 0, taxEfficiency: 0, taxationRisk: 0, bequestAdequacy: 0 };

function makeAsset(overrides: Partial<InvestmentAsset>): InvestmentAsset {
  return {
    id: 'a1',
    type: 'etf',
    ticker: 'SPY',
    name: 'S&P500',
    quantity: 10,
    averagePrice: 400000,
    annualGrowthRate: 7,
    dividendYield: 3,
    monthlyContribution: 0,
    reinvestDividend: true,
    currency: 'KRW',
    ...overrides,
  };
}

const baseParams: SimulationParams = {
  userProfile: { currentAge: 40, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3000000 },
  assets: [],
  nationalPension: { expectedMonthlyAmount: 1000000 },
  privatePensions: [],
  otherIncomes: [],
  inflationRate: 2,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

function makeResult(retirementScore: number): SimulationResult {
  return {
    yearlyResults: [],
    fireAge: null,
    depletionAge: null,
    endingAssets: 0,
    retirementScore,
    retirementGrade: '보통',
    goalAchievementRate: 100,
    retirementAssetsAtRetirement: 0,
  };
}

const bestUtility: UtilityBreakdown = { score: 70, components: zeroComponents };
const bestResult = makeResult(70);

describe('optimizeDividendReinvestment', () => {
  test('assets가 없으면 그대로 no-op을 반환하고 시뮬레이션을 전혀 실행하지 않는다', () => {
    const runForUtility = vi.fn();
    const engine = { runForUtility } as unknown as SimulationEngine;

    const result = optimizeDividendReinvestment(baseParams, null, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    expect(result.recommendedAssetReinvestment).toBeNull();
    expect(result.perAssetResults).toEqual([]);
    expect(result.finalResult).toBe(bestResult);
    expect(result.finalUtility).toBe(bestUtility);
    expect(runForUtility).not.toHaveBeenCalled();
  });

  test('자산 하나뿐이고 뒤집어도 개선되지 않으면 no-op을 반환한다', () => {
    const params = { ...baseParams, assets: [makeAsset({ id: 'a1', reinvestDividend: true })] };
    const runForUtility = vi.fn(() => makeResult(65));
    const engine = { runForUtility } as unknown as SimulationEngine;

    const result = optimizeDividendReinvestment(params, null, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    expect(result.recommendedAssetReinvestment).toBeNull();
    expect(result.perAssetResults).toEqual([]);
    expect(runForUtility).toHaveBeenCalledTimes(1);
  });

  test('자산 하나뿐이고 뒤집으면 개선되면 추천하고 통합 검증도 통과시킨다', () => {
    const params = { ...baseParams, assets: [makeAsset({ id: 'a1', reinvestDividend: true })] };
    const individualResult = makeResult(75);
    const combinedResult = makeResult(75);
    const runForUtility = vi.fn().mockReturnValueOnce(individualResult).mockReturnValueOnce(combinedResult);
    const engine = { runForUtility } as unknown as SimulationEngine;

    const result = optimizeDividendReinvestment(params, null, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    expect(result.recommendedAssetReinvestment).toEqual({ a1: false });
    expect(result.perAssetResults).toHaveLength(1);
    expect(result.perAssetResults[0]).toMatchObject({
      assetId: 'a1',
      assetName: 'S&P500',
      flippedValue: false,
      utilityDelta: 5,
    });
    expect(result.finalResult).toBe(combinedResult);
    expect(result.finalUtility.score).toBe(75);
    expect(runForUtility).toHaveBeenCalledTimes(2);
  });

  test('여러 자산 중 일부만 개선되면 유리한 자산만 뒤집어 통합 검증한다', () => {
    const params = {
      ...baseParams,
      assets: [
        makeAsset({ id: 'a1', name: 'Asset A', reinvestDividend: true }),
        makeAsset({ id: 'a2', name: 'Asset B', reinvestDividend: false }),
      ],
    };
    const runForUtility = vi
      .fn()
      .mockReturnValueOnce(makeResult(72)) // a1 뒤집기: 개선
      .mockReturnValueOnce(makeResult(68)) // a2 뒤집기: 악화
      .mockReturnValueOnce(makeResult(73)); // 통합 검증(a1만 적용)
    const engine = { runForUtility } as unknown as SimulationEngine;

    const result = optimizeDividendReinvestment(params, null, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    expect(result.recommendedAssetReinvestment).toEqual({ a1: false });
    expect(result.perAssetResults).toHaveLength(1);
    expect(result.perAssetResults[0].assetId).toBe('a1');
    expect(runForUtility).toHaveBeenCalledTimes(3);
  });

  test('개별로는 개선되지만 통합 검증에서 오히려 악화되면 아무 것도 추천하지 않는다', () => {
    const params = {
      ...baseParams,
      assets: [
        makeAsset({ id: 'a1', reinvestDividend: true }),
        makeAsset({ id: 'a2', reinvestDividend: true }),
      ],
    };
    const runForUtility = vi
      .fn()
      .mockReturnValueOnce(makeResult(72)) // a1 뒤집기: 개선
      .mockReturnValueOnce(makeResult(71)) // a2 뒤집기: 개선
      .mockReturnValueOnce(makeResult(69)); // 통합 검증: 상호작용으로 오히려 악화
    const engine = { runForUtility } as unknown as SimulationEngine;

    const result = optimizeDividendReinvestment(params, null, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    expect(result.recommendedAssetReinvestment).toBeNull();
    expect(result.perAssetResults).toEqual([]);
    expect(result.finalResult).toBe(bestResult);
    expect(result.finalUtility).toBe(bestUtility);
  });

  test('bestPlan이 null이면 getIdentityPlan 기반 withdrawalPlan으로 후보를 만든다', () => {
    const params = { ...baseParams, assets: [makeAsset({ id: 'a1', reinvestDividend: true })] };
    const runForUtility = vi.fn((_params: SimulationParams) => makeResult(65));
    const engine = { runForUtility } as unknown as SimulationEngine;

    optimizeDividendReinvestment(params, null, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    const calledParams = runForUtility.mock.calls[0][0] as SimulationParams;
    expect(calledParams.withdrawalPlan?.privatePensionStartAge).toBe(params.userProfile.retirementAge);
  });

  test('bestPlan이 주어지면 그 계획을 그대로 사용한다', () => {
    const params = { ...baseParams, assets: [makeAsset({ id: 'a1', reinvestDividend: true })] };
    const plan: CompleteWithdrawalPlan = {
      privatePensionStartAge: 65,
      privatePensionMonthlyTarget: 0,
      nationalPensionStartAge: 68,
      assetSellOrderStrategy: 'input_order',
      isaMaturityDestination: 'pension',
      generalAssetWithdrawalStartAge: 60,
      monthlySpendingMultiplier: 1,
    };
    const runForUtility = vi.fn((_params: SimulationParams) => makeResult(65));
    const engine = { runForUtility } as unknown as SimulationEngine;

    optimizeDividendReinvestment(params, plan, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    const calledParams = runForUtility.mock.calls[0][0] as SimulationParams;
    expect(calledParams.withdrawalPlan?.nationalPensionStartAge).toBe(68);
  });

  test('특정 자산 평가 중 예외가 발생해도 나머지는 계속 평가된다', () => {
    const params = {
      ...baseParams,
      assets: [
        makeAsset({ id: 'a1', reinvestDividend: true }),
        makeAsset({ id: 'a2', reinvestDividend: true }),
      ],
    };
    const runForUtility = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('시뮬레이션 실패');
      })
      .mockReturnValueOnce(makeResult(72))
      .mockReturnValueOnce(makeResult(73));
    const engine = { runForUtility } as unknown as SimulationEngine;

    const result = optimizeDividendReinvestment(params, null, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    expect(result.recommendedAssetReinvestment).toEqual({ a2: false });
  });
});
