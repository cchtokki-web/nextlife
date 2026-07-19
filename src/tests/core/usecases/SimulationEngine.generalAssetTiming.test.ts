import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { SimulationParams } from '@/core/entities/types';

describe('SimulationEngine 일반계좌(자산) 인출 시점 지연', () => {
  const delayedWithdrawalParams: SimulationParams = {
    userProfile: {
      currentAge: 60,
      retirementAge: 60,
      expectancy: 75,
      targetMonthlySpending: 1000000, // 100만 원 (배당/기타소득이 없어 매달 전액 shortfall)
    },
    assets: [
      {
        id: 'asset-1',
        type: 'etf',
        ticker: 'ASSET',
        name: '일반자산',
        quantity: 1,
        averagePrice: 50000000, // 5천만 원
        annualGrowthRate: 0,
        dividendYield: 0,
        monthlyContribution: 0,
        reinvestDividend: false,
        currency: 'KRW',
      },
    ],
    nationalPension: { expectedMonthlyAmount: 0 },
    privatePensions: [
      {
        id: 'pension-1',
        type: 'irp',
        balance: 200000000, // 2억 원 (자산이 잠긴 동안 shortfall을 충당할 여유)
        monthlyContribution: 0,
        annualReturn: 0,
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

  test('generalAssetWithdrawalStartAge 이전에는 자산을 건드리지 않고 사적연금으로 shortfall을 충당한다', () => {
    const engine = new SimulationEngine();
    const result = engine.run({
      ...delayedWithdrawalParams,
      withdrawalPlan: { generalAssetWithdrawalStartAge: 70 },
    });

    const resultAt65 = result.yearlyResults.find((r) => r.age === 65);
    expect(resultAt65).toBeDefined();
    expect(resultAt65!.stockAssets).toBe(50000000); // 성장/배당 없음 + 인출 없음 -> 정확히 그대로
    expect(resultAt65!.privatePensionIncome).toBeGreaterThan(0); // 대신 연금이 충당
  });

  test('generalAssetWithdrawalStartAge 이후에는 자산 인출이 재개된다', () => {
    const engine = new SimulationEngine();
    const result = engine.run({
      ...delayedWithdrawalParams,
      withdrawalPlan: { generalAssetWithdrawalStartAge: 70 },
    });

    const resultAt74 = result.yearlyResults.find((r) => r.age === 74);
    expect(resultAt74).toBeDefined();
    expect(resultAt74!.stockAssets).toBeLessThan(50000000);
  });

  test('generalAssetWithdrawalStartAge 미지정 시 retirementAge를 명시한 것과 동일하게 동작한다', () => {
    const engine = new SimulationEngine();
    const unspecified = engine.run(delayedWithdrawalParams);
    const explicitRetirementAge = engine.run({
      ...delayedWithdrawalParams,
      withdrawalPlan: { generalAssetWithdrawalStartAge: delayedWithdrawalParams.userProfile.retirementAge },
    });

    expect(unspecified.yearlyResults).toEqual(explicitRetirementAge.yearlyResults);
  });
});
