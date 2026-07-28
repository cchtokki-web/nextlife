import { describe, test, expect, vi } from 'vitest';
import { optimizeDividendReinvestment } from '@/core/usecases/strategy/DividendReinvestmentOptimizer';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { DomainError } from '@/core/entities/errors';
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

  test('자산 하나뿐이고 뒤집으면 개선되면 추천한다(유리한 자산이 하나뿐이므로 통합 검증을 생략하고 시뮬레이션은 1회만 실행한다)', () => {
    const params = { ...baseParams, assets: [makeAsset({ id: 'a1', reinvestDividend: true })] };
    const individualResult = makeResult(75);
    // 유리한 자산이 하나뿐일 때는 자산별 루프에서 이미 돌린 단일 override 시뮬레이션을 그대로
    // 통합 결과로 재사용하므로 runForUtility는 총 1회만 호출된다(중복 재시뮬레이션 제거).
    const runForUtility = vi.fn().mockReturnValueOnce(individualResult);
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
    expect(result.finalResult).toBe(individualResult);
    expect(result.finalUtility.score).toBe(75);
    expect(runForUtility).toHaveBeenCalledTimes(1);
  });

  test('여러 자산 중 하나만 유리하면 그 자산만 뒤집고, 유리한 자산이 하나뿐이라 통합 검증은 생략한다', () => {
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
      .mockReturnValueOnce(makeResult(68)); // a2 뒤집기: 악화
    const engine = { runForUtility } as unknown as SimulationEngine;

    const result = optimizeDividendReinvestment(params, null, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    expect(result.recommendedAssetReinvestment).toEqual({ a1: false });
    expect(result.perAssetResults).toHaveLength(1);
    expect(result.perAssetResults[0].assetId).toBe('a1');
    // a1, a2 자산별 평가 2회만 실행되고 통합 검증 재시뮬레이션은 생략된다.
    expect(runForUtility).toHaveBeenCalledTimes(2);
    expect(result.finalUtility.score).toBe(72);
  });

  test('≥2개 자산이 동시에 유리하면 통합 검증 호출에 두 자산의 뒤집힌 값이 모두 반영된다', () => {
    const params = {
      ...baseParams,
      assets: [
        makeAsset({ id: 'a1', name: 'Asset A', reinvestDividend: true }),
        makeAsset({ id: 'a2', name: 'Asset B', reinvestDividend: true }),
      ],
    };
    const runForUtility = vi
      .fn((_params: SimulationParams) => makeResult(0))
      .mockReturnValueOnce(makeResult(72)) // a1 뒤집기: 개선
      .mockReturnValueOnce(makeResult(71)) // a2 뒤집기: 개선
      .mockReturnValueOnce(makeResult(73)); // 통합 검증(a1+a2)
    const engine = { runForUtility } as unknown as SimulationEngine;

    const result = optimizeDividendReinvestment(params, null, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    expect(result.recommendedAssetReinvestment).toEqual({ a1: false, a2: false });
    expect(runForUtility).toHaveBeenCalledTimes(3);
    // 마지막(3번째) 호출이 통합 검증 — 두 자산 모두 뒤집힌 값(false)이 params에 들어 있어야 한다
    // ("마지막 유리한 자산만" 버그 클래스를 잡는다).
    const combinedParams = runForUtility.mock.calls[2][0] as SimulationParams;
    const a1 = combinedParams.assets.find((a) => a.id === 'a1');
    const a2 = combinedParams.assets.find((a) => a.id === 'a2');
    expect(a1?.reinvestDividend).toBe(false);
    expect(a2?.reinvestDividend).toBe(false);
  });

  test('통합 검증의 Utility가 bestUtility와 정확히 같으면(<= 경계) 개선으로 보지 않고 no-op을 반환한다', () => {
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
      .mockReturnValueOnce(makeResult(70)); // 통합 검증: bestUtility(70)와 정확히 동일
    const engine = { runForUtility } as unknown as SimulationEngine;

    const result = optimizeDividendReinvestment(params, null, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    expect(result.recommendedAssetReinvestment).toBeNull();
    expect(result.perAssetResults).toEqual([]);
    expect(result.finalResult).toBe(bestResult);
    expect(result.finalUtility).toBe(bestUtility);
  });

  test('buildParamsWithReinvestmentOverrides는 override 대상이 아닌 자산의 reinvestDividend는 건드리지 않는다', () => {
    const params = {
      ...baseParams,
      assets: [
        makeAsset({ id: 'a1', name: 'Asset A', reinvestDividend: true }),
        makeAsset({ id: 'a2', name: 'Asset B', reinvestDividend: true }),
      ],
    };
    const runForUtility = vi.fn((_params: SimulationParams) => makeResult(65)); // 아무 것도 개선되지 않게
    const engine = { runForUtility } as unknown as SimulationEngine;

    optimizeDividendReinvestment(params, null, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    // 첫 호출은 a1만 override(true->false)한 params — a2는 원래 값(true) 그대로여야 한다.
    const firstCallParams = runForUtility.mock.calls[0][0] as SimulationParams;
    expect(firstCallParams.assets.find((a) => a.id === 'a1')?.reinvestDividend).toBe(false);
    expect(firstCallParams.assets.find((a) => a.id === 'a2')?.reinvestDividend).toBe(true);
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
    expect(calledParams.withdrawalPlan?.generalAssetWithdrawalStartAge).toBe(params.userProfile.retirementAge);
  });

  test('bestPlan이 주어지면 그 계획을 그대로 사용한다', () => {
    const params = { ...baseParams, assets: [makeAsset({ id: 'a1', reinvestDividend: true })] };
    const plan: CompleteWithdrawalPlan = {
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

  test('특정 자산 평가 중 DomainError가 발생하면 그 후보만 건너뛰고 나머지는 계속 평가하며 failedAssetCount를 센다', () => {
    const params = {
      ...baseParams,
      assets: [
        makeAsset({ id: 'a1', reinvestDividend: true }),
        makeAsset({ id: 'a2', reinvestDividend: true }),
      ],
    };
    // a1 평가는 DomainError로 실패, a2 평가는 개선. 유리한 자산이 a2 하나뿐이라 통합 검증은 생략된다.
    const runForUtility = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new DomainError('시뮬레이션 실패');
      })
      .mockReturnValueOnce(makeResult(72));
    const engine = { runForUtility } as unknown as SimulationEngine;

    const result = optimizeDividendReinvestment(params, null, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    expect(result.recommendedAssetReinvestment).toEqual({ a2: false });
    expect(result.failedAssetCount).toBe(1);
  });

  test('자산별 루프에서 DomainError가 아닌 예외가 발생하면(실제 버그) 삼키지 않고 재던진다', () => {
    const params = { ...baseParams, assets: [makeAsset({ id: 'a1', reinvestDividend: true })] };
    const runForUtility = vi.fn().mockImplementationOnce(() => {
      throw new Error('예상치 못한 버그');
    });
    const engine = { runForUtility } as unknown as SimulationEngine;

    expect(() =>
      optimizeDividendReinvestment(params, null, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG)
    ).toThrow('예상치 못한 버그');
  });

  test('통합 검증 단계에서 DomainError가 발생하면(개별 자산은 유리했더라도) 완전한 no-op으로 폴백한다', () => {
    const params = {
      ...baseParams,
      assets: [
        makeAsset({ id: 'a1', reinvestDividend: true }),
        makeAsset({ id: 'a2', reinvestDividend: true }),
      ],
    };
    // a1, a2 모두 개별적으로는 유리(72, 71)하지만 통합 검증에서 DomainError 발생 -> no-op.
    const runForUtility = vi
      .fn()
      .mockReturnValueOnce(makeResult(72))
      .mockReturnValueOnce(makeResult(71))
      .mockImplementationOnce(() => {
        throw new DomainError('통합 검증 실패');
      });
    const engine = { runForUtility } as unknown as SimulationEngine;

    const result = optimizeDividendReinvestment(params, null, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    expect(result.recommendedAssetReinvestment).toBeNull();
    expect(result.perAssetResults).toEqual([]);
    expect(result.finalResult).toBe(bestResult);
    expect(result.finalUtility).toBe(bestUtility);
    expect(result.failedAssetCount).toBe(1);
  });

  test('통합 검증 단계에서 DomainError가 아닌 예외가 발생하면(실제 버그) 삼키지 않고 재던진다', () => {
    const params = {
      ...baseParams,
      assets: [
        makeAsset({ id: 'a1', reinvestDividend: true }),
        makeAsset({ id: 'a2', reinvestDividend: true }),
      ],
    };
    const runForUtility = vi
      .fn()
      .mockReturnValueOnce(makeResult(72))
      .mockReturnValueOnce(makeResult(71))
      .mockImplementationOnce(() => {
        throw new Error('예상치 못한 버그');
      });
    const engine = { runForUtility } as unknown as SimulationEngine;

    expect(() =>
      optimizeDividendReinvestment(params, null, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG)
    ).toThrow('예상치 못한 버그');
  });
});
