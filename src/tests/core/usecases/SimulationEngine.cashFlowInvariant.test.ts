import { describe, expect, test } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import type { SimulationParams } from '@/core/entities/types';

const engine = new SimulationEngine();

function params(overrides: Partial<SimulationParams> = {}): SimulationParams {
  return {
    userProfile: {
      currentAge: 60,
      retirementAge: 60,
      expectancy: 90,
      targetMonthlySpending: 5_000_000,
    },
    assets: [{
      id: 'liquid', type: 'etf', ticker: 'LIQUID', name: '매도 가능한 일반자산',
      quantity: 100_000, averagePrice: 100_000,
      acquisitionCostBasis: 5_000_000_000,
      annualGrowthRate: 0, dividendYield: 0, monthlyContribution: 0,
      reinvestDividend: false, currency: 'KRW', assetMarket: 'US_ETF',
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

describe('SimulationEngine - cash-flow shortfall invariant', () => {
  test('연금만으로 부족해도 매도 가능한 일반자산이 충분하면 shortfall은 0이다', () => {
    const result = engine.run(params({
      userProfile: {
        currentAge: 60,
        retirementAge: 60,
        expectancy: 65,
        targetMonthlySpending: 5_000_000,
      },
    }));

    expect(result.yearlyResults.every((year) => year.unmetSpending === 0)).toBe(true);
    expect(result.yearlyResults[0].stockAssets).toBeLessThan(10_000_000_000);
  });

  test('양도세가 발생해도 세후 Funding Gap 전액을 확보한다', () => {
    const result = engine.run(params({
      userProfile: {
        currentAge: 60,
        retirementAge: 60,
        expectancy: 60,
        targetMonthlySpending: 30_000_000,
      },
    }));
    const year = result.yearlyResults[0];

    expect(year.capitalGainsTaxPaid).toBeGreaterThan(0);
    expect(year.unmetSpending).toBe(0);
    expect(year.spending).toBeCloseTo(360_000_000, 2);
  });

  test('기본 인출전략은 90세에 수십억이 남으면서 20년 이상 부족을 만들지 않는다', () => {
    const result = engine.run(params());
    const shortfallYears = result.yearlyResults.filter((year) => year.unmetSpending > 0);

    expect(result.endingAssets).toBeGreaterThan(1_000_000_000);
    expect(shortfallYears).toHaveLength(0);
  });

  test('HARD 보호자산을 제외한 가용액이 Funding Gap보다 크면 shortfall은 0이다', () => {
    const result = engine.run(params({
      assetFloor: 8_000_000_000,
      userProfile: {
        currentAge: 60,
        retirementAge: 60,
        expectancy: 60,
        targetMonthlySpending: 5_000_000,
      },
    }));

    expect(result.yearlyResults[0].unmetSpending).toBe(0);
    expect(result.endingAssets).toBeGreaterThanOrEqual(8_000_000_000);
  });
});
