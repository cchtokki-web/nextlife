import type { SimulationParams } from '@/core/entities/types';

export function retirementParams(
  overrides: Partial<SimulationParams> = {},
): SimulationParams {
  return {
    userProfile: {
      currentAge: 60,
      retirementAge: 60,
      expectancy: 90,
      targetMonthlySpending: 5_000_000,
    },
    assets: [{
      id: 'liquid-investment',
      type: 'etf',
      ticker: 'LIQUID',
      name: '매도 가능한 투자자산',
      quantity: 100_000,
      averagePrice: 100_000,
      acquisitionCostBasis: 5_000_000_000,
      annualGrowthRate: 0,
      dividendYield: 0,
      monthlyContribution: 0,
      reinvestDividend: false,
      currency: 'KRW',
      assetMarket: 'US_ETF',
    }],
    isaAccounts: [],
    nationalPension: { expectedMonthlyAmount: 1_000_000 },
    privatePensions: [],
    otherIncomes: [],
    inflationRate: 0,
    inflationMode: 'real',
    baseExchangeRate: 1_350,
    exchangeScenario: 'base',
    displayCurrency: 'KRW',
    ...overrides,
  };
}

/**
 * 회귀: 매도 가능한 대규모 투자자산이 남아 있는데도 인출 경로가 그것을 쓰지 않아 장기간
 * shortfall이 나던 버그.
 *
 * 재현 조건(60세 은퇴 / 월 500만원 목표 / 50억 매도 가능 투자자산 / 성장률 0)을 여기서 다시
 * 명시한다. retirementParams() 기본값이 나중에 바뀌어도 이 시나리오가 조용히 다른 것으로
 * 변하지 않게 하려는 것이다 — 그렇게 되면 regression.test.ts는 계속 통과하면서 원래 버그를
 * 더 이상 재현하지 않는다.
 */
export function unusedAssetsRegressionParams(): SimulationParams {
  const base = retirementParams();
  return {
    ...base,
    userProfile: {
      ...base.userProfile,
      currentAge: 60,
      retirementAge: 60,
      expectancy: 90,
      targetMonthlySpending: 5_000_000,
    },
    assets: [{ ...base.assets[0], quantity: 100_000, averagePrice: 100_000, annualGrowthRate: 0 }],
  };
}
