import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { SimulationParams } from '@/core/entities/types';

function pensionOnly(over: Partial<SimulationParams> = {}): SimulationParams {
  return {
    userProfile: { currentAge: 60, retirementAge: 60, expectancy: 62, targetMonthlySpending: 5_000_000 },
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
    ...over,
  } as unknown as SimulationParams;
}

describe('HARD 바닥은 전략 선호와 세제 최적화를 깬다', () => {
  test('저율과세 한도가 바닥을 막지 못한다', () => {
    // 한도(연 1,500만원)를 켠 채 바닥 월 400만원(연 4,800만원)을 요구한다.
    const result = new SimulationEngine().runSingle(
      pensionOnly({ hardSpendingFloor: 4_000_000 } as Partial<SimulationParams>)
    );

    for (const year of result.yearlyResults) {
      expect(year.spending, `${year.age}세`).toBeGreaterThanOrEqual(48_000_000 - 1);
    }
  });

  test('월 인출 목표가 바닥을 막지 못한다', () => {
    const result = new SimulationEngine().runSingle(pensionOnly({
      hardSpendingFloor: 4_000_000,
      withdrawalPlan: { privatePensionMonthlyTarget: 300_000 },
    } as Partial<SimulationParams>));

    for (const year of result.yearlyResults) {
      expect(year.spending, `${year.age}세`).toBeGreaterThanOrEqual(48_000_000 - 1);
    }
  });

  test('일반자산 인출 개시 나이가 바닥을 막지 못한다', () => {
    const result = new SimulationEngine().runSingle({
      ...pensionOnly(),
      privatePensions: [],
      assets: [{
        id: 'a', type: 'etf', ticker: 'X', name: 'X', quantity: 1, averagePrice: 500_000_000,
        totalReturn: 0, dividendYield: 0, monthlyContribution: 0,
        reinvestDividend: true, currency: 'KRW', assetMarket: 'OTHER',
      }],
      withdrawalPlan: { generalAssetWithdrawalStartAge: 80 },
      hardSpendingFloor: 4_000_000,
    } as unknown as SimulationParams);

    for (const year of result.yearlyResults) {
      expect(year.spending, `${year.age}세`).toBeGreaterThanOrEqual(48_000_000 - 1);
    }
  });
});

describe('2단계는 선호를 지킨다', () => {
  test('바닥을 넘는 몫에는 저율과세 한도가 그대로 걸린다', () => {
    // 바닥 100만원/월(연 1,200만원), 목표 500만원/월(연 6,000만원), 한도 연 1,500만원.
    // 1단계가 1,200만원을 꺼내고, 2단계는 한도 잔량 300만원까지만 더 꺼낸다.
    const result = new SimulationEngine().runSingle(
      pensionOnly({ hardSpendingFloor: 1_000_000 } as Partial<SimulationParams>)
    );

    const first = result.yearlyResults[0];
    expect(first.spending).toBeGreaterThanOrEqual(12_000_000 - 1);
    expect(first.spending).toBeLessThan(60_000_000);
    expect(first.unmetSpending).toBeGreaterThan(0);
  });
});

describe('바닥이 없으면 아무것도 바뀌지 않는다', () => {
  test('hardSpendingFloor 미지정 시 한도가 그대로 인출을 막는다', () => {
    const result = new SimulationEngine().runSingle(pensionOnly());

    for (const year of result.yearlyResults) {
      expect(year.unmetSpending, `${year.age}세`).toBeGreaterThan(0);
    }
  });
});
