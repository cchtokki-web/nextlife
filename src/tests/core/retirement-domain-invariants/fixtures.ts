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

/** 실제 발견된 "큰 자산이 남는데 생활비가 장기간 부족" 회귀 시나리오. */
export function unusedAssetsRegressionParams(): SimulationParams {
  return retirementParams();
}
