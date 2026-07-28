import { describe, test, expect, vi } from 'vitest';
import { optimizePrivatePensionChanneling } from '@/core/usecases/strategy/PrivatePensionChannelingOptimizer';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { DomainError } from '@/core/entities/errors';
import { DEFAULT_UTILITY_CONFIG } from '@/core/usecases/utility/utilityWeights';
import { SimulationParams, SimulationResult, UtilityBreakdown } from '@/core/entities/types';

vi.mock('@/core/usecases/utility/UtilityEngine', () => ({
  computeLifetimeUtility: vi.fn((result: SimulationResult) => ({
    score: result.retirementScore,
    components: { consumption: 0, depletionSafety: 0, pensionUtilization: 0, taxEfficiency: 0, taxationRisk: 0, bequestAdequacy: 0 },
  })),
}));

const zeroComponents = { consumption: 0, depletionSafety: 0, pensionUtilization: 0, taxEfficiency: 0, taxationRisk: 0, bequestAdequacy: 0 };

const baseParams: SimulationParams = {
  userProfile: { currentAge: 50, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3000000 },
  assets: [],
  nationalPension: { expectedMonthlyAmount: 1000000 },
  privatePensions: [],
  isaAccounts: [],
  otherIncomes: [],
  inflationRate: 2,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

function makePension(overrides: Partial<SimulationParams['privatePensions'][number]> = {}) {
  return {
    id: 'p1',
    type: 'irp' as const,
    investmentType: 'deposit' as const,
    balance: 100000000,
    monthlyContribution: 0,
    annualReturn: 4,
    dividendYield: 0,
    currency: 'KRW' as const,
    ...overrides,
  };
}

function makeIsa(overrides: Partial<NonNullable<SimulationParams['isaAccounts']>[number]> = {}) {
  return {
    id: 'isa1',
    type: 'general' as const,
    balance: 0,
    monthlyContribution: 0,
    annualReturn: 5,
    dividendYield: 2,
    currency: 'KRW' as const,
    maturityYears: 3,
    ...overrides,
  };
}

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

describe('optimizePrivatePensionChanneling', () => {
  test('사적연금이 없으면 no-op을 반환하고 시뮬레이션을 전혀 실행하지 않는다', () => {
    const runForUtility = vi.fn((_params: SimulationParams) => makeResult(70));
    const engine = { runForUtility } as unknown as SimulationEngine;
    const params = { ...baseParams, privatePensions: [], isaAccounts: [makeIsa()] };

    const result = optimizePrivatePensionChanneling(params, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    expect(result.recommendedPrivatePensionChanneling).toBeNull();
    expect(result.itemizedContribution).toBeNull();
    expect(result.finalResult).toBe(bestResult);
    expect(result.finalUtility).toBe(bestUtility);
    expect(runForUtility).not.toHaveBeenCalled();
  });

  test('ISA 계좌가 없으면 no-op을 반환한다', () => {
    const runForUtility = vi.fn((_params: SimulationParams) => makeResult(70));
    const engine = { runForUtility } as unknown as SimulationEngine;
    const params = { ...baseParams, privatePensions: [makePension()], isaAccounts: [] };

    const result = optimizePrivatePensionChanneling(params, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    expect(result.recommendedPrivatePensionChanneling).toBeNull();
    expect(runForUtility).not.toHaveBeenCalled();
  });

  test('retirementAge가 55 이하이면(브릿지 구간 없음) no-op을 반환한다', () => {
    const runForUtility = vi.fn((_params: SimulationParams) => makeResult(70));
    const engine = { runForUtility } as unknown as SimulationEngine;
    const params = {
      ...baseParams,
      userProfile: { ...baseParams.userProfile, retirementAge: 55 },
      privatePensions: [makePension()],
      isaAccounts: [makeIsa()],
    };

    const result = optimizePrivatePensionChanneling(params, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    expect(result.recommendedPrivatePensionChanneling).toBeNull();
    expect(runForUtility).not.toHaveBeenCalled();
  });

  test('전제 조건을 충족하고 개선되지 않으면 no-op을 반환하며 시뮬레이션은 1회만 실행한다', () => {
    const runForUtility = vi.fn((_params: SimulationParams) => makeResult(65));
    const engine = { runForUtility } as unknown as SimulationEngine;
    const params = { ...baseParams, privatePensions: [makePension()], isaAccounts: [makeIsa()] };

    const result = optimizePrivatePensionChanneling(params, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    expect(result.recommendedPrivatePensionChanneling).toBeNull();
    expect(result.itemizedContribution).toBeNull();
    expect(result.finalResult).toBe(bestResult);
    expect(result.finalUtility).toBe(bestUtility);
    expect(runForUtility).toHaveBeenCalledTimes(1);
  });

  test('전제 조건을 충족하고 개선되면 채택하고, candidate params에 기존 계좌 채널링+신규 계좌가 반영된다', () => {
    const improvedResult = makeResult(80);
    const runForUtility = vi.fn((_params: SimulationParams) => improvedResult);
    const engine = { runForUtility } as unknown as SimulationEngine;
    const params = {
      ...baseParams,
      privatePensions: [makePension({ id: 'existing-1', annualReturn: 3, investmentType: 'etf' as const, dividendYield: 1 })],
      isaAccounts: [makeIsa()],
    };

    const result = optimizePrivatePensionChanneling(params, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    expect(result.recommendedPrivatePensionChanneling).toBe(true);
    expect(result.finalResult).toBe(improvedResult);
    expect(result.finalUtility.score).toBe(80);
    expect(result.itemizedContribution).not.toBeNull();
    expect(result.itemizedContribution!.utilityDelta).toBe(10);
    expect(runForUtility).toHaveBeenCalledTimes(1);

    const candidateParams = runForUtility.mock.calls[0][0] as SimulationParams;
    expect(candidateParams.privatePensions).toHaveLength(2);
    const existing = candidateParams.privatePensions.find((p) => p.id === 'existing-1');
    expect(existing?.earlyChannelingEnabled).toBe(true);
    const added = candidateParams.privatePensions.find((p) => p.id !== 'existing-1');
    expect(added?.monthlyContribution).toBe(750000);
    expect(added?.earlyChannelingEnabled).toBeFalsy();
    // 신규 계좌는 기존 첫 번째 계좌의 수익률/투자종류를 그대로 복사한다
    expect(added?.annualReturn).toBe(3);
    expect(added?.investmentType).toBe('etf');
    expect(added?.dividendYield).toBe(1);
  });

  test('Fix 1: candidate params는 다른 withdrawalPlan 필드를 보존하면서 isaMaturityDestination을 asset으로 강제한다', () => {
    const improvedResult = makeResult(80);
    const runForUtility = vi.fn((_params: SimulationParams) => improvedResult);
    const engine = { runForUtility } as unknown as SimulationEngine;
    const params: SimulationParams = {
      ...baseParams,
      privatePensions: [makePension()],
      isaAccounts: [makeIsa()],
      withdrawalPlan: { nationalPensionStartAge: 63, isaMaturityDestination: 'pension' },
    };

    optimizePrivatePensionChanneling(params, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    const candidateParams = runForUtility.mock.calls[0][0] as SimulationParams;
    expect(candidateParams.withdrawalPlan?.isaMaturityDestination).toBe('asset');
    // 다른 필드는 보존되어야 한다 (전체 withdrawalPlan을 갈아치우면 안 됨)
    expect(candidateParams.withdrawalPlan?.nationalPensionStartAge).toBe(63);
  });

  test('Fix 3: 채널링 대상 기존 계좌는 monthlyContribution이 0으로 강제된다', () => {
    const improvedResult = makeResult(80);
    const runForUtility = vi.fn((_params: SimulationParams) => improvedResult);
    const engine = { runForUtility } as unknown as SimulationEngine;
    const params: SimulationParams = {
      ...baseParams,
      privatePensions: [makePension({ id: 'existing-1', monthlyContribution: 500000 })],
      isaAccounts: [makeIsa()],
    };

    optimizePrivatePensionChanneling(params, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    const candidateParams = runForUtility.mock.calls[0][0] as SimulationParams;
    const existing = candidateParams.privatePensions.find((p) => p.id === 'existing-1');
    expect(existing?.monthlyContribution).toBe(0);
    // 신규 계좌의 월 750,000원 납입은 그대로 유지되어야 한다
    const added = candidateParams.privatePensions.find((p) => p.id !== 'existing-1');
    expect(added?.monthlyContribution).toBe(750000);
  });

  test('Fix 1 회귀: maturityYears=3(실제 기본값)이고 비-연금 자산이 있을 때, 채널링된 연금 잔액이 브릿지 구간(55~59세) 동안 단조 감소한다(ISA 만기로 인한 잔액 증가 없음)', () => {
    const realEngine = new SimulationEngine();
    // 신규 계좌 합성(2절)이 섞이면 pensionAssets 합계에 새 계좌의 월 납입분이 함께 잡혀 "채널링
    // 대상 계좌만"의 단조 감소를 관찰하기 어려워지므로, 여기서는 SimulationEngine의 브릿지+ISA
    // 만기 라우팅 동작 자체를 사적연금 계좌 1개로 직접 검증한다(optimizer가 만드는 candidateParams와
    // 동일하게 earlyChannelingEnabled: true, monthlyContribution: 0, isaMaturityDestination: 'asset').
    const params: SimulationParams = {
      userProfile: { currentAge: 50, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3000000 },
      assets: [
        {
          id: 'asset-1',
          type: 'etf',
          ticker: 'TEST',
          name: '일반자산',
          quantity: 1,
          averagePrice: 100000000,
          annualGrowthRate: 5,
          dividendYield: 0,
          monthlyContribution: 0,
          reinvestDividend: false,
          currency: 'KRW',
        },
      ],
      nationalPension: { expectedMonthlyAmount: 1000000 },
      privatePensions: [makePension({ id: 'existing-1', balance: 200000000, monthlyContribution: 0, earlyChannelingEnabled: true })],
      isaAccounts: [makeIsa({ maturityYears: 3 })],
      otherIncomes: [],
      inflationRate: 2,
      inflationMode: 'real',
      baseExchangeRate: 1350,
      exchangeScenario: 'base',
      displayCurrency: 'KRW',
      withdrawalPlan: { isaMaturityDestination: 'asset' },
    };

    const candidateResult = realEngine.run(params);

    const bridgeYearBalances = candidateResult.yearlyResults
      .filter((r) => r.age >= 55 && r.age < 60)
      .map((r) => r.pensionAssets);

    expect(bridgeYearBalances.length).toBeGreaterThan(0);
    for (let i = 1; i < bridgeYearBalances.length; i++) {
      expect(bridgeYearBalances[i]).toBeLessThanOrEqual(bridgeYearBalances[i - 1]);
    }
  });

  test('시뮬레이션 중 DomainError가 발생하면 no-op을 반환하고 failed를 true로 표시한다', () => {
    const runForUtility = vi.fn((_params: SimulationParams) => {
      throw new DomainError('평가 실패');
    });
    const engine = { runForUtility } as unknown as SimulationEngine;
    const params = { ...baseParams, privatePensions: [makePension()], isaAccounts: [makeIsa()] };

    const result = optimizePrivatePensionChanneling(params, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG);

    expect(result.recommendedPrivatePensionChanneling).toBeNull();
    expect(result.finalResult).toBe(bestResult);
    expect(result.finalUtility).toBe(bestUtility);
    expect(result.failed).toBe(true);
  });

  test('DomainError가 아닌 예외는 그대로 다시 던진다', () => {
    const runForUtility = vi.fn((_params: SimulationParams) => {
      throw new Error('예상치 못한 버그');
    });
    const engine = { runForUtility } as unknown as SimulationEngine;
    const params = { ...baseParams, privatePensions: [makePension()], isaAccounts: [makeIsa()] };

    expect(() =>
      optimizePrivatePensionChanneling(params, bestResult, bestUtility, engine, DEFAULT_UTILITY_CONFIG)
    ).toThrow('예상치 못한 버그');
  });
});
