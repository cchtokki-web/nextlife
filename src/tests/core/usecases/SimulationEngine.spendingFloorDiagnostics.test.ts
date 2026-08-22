import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { SimulationParams } from '@/core/entities/types';

// 연금만 있고 55세 미만이라 «법적으로» 인출할 수 없는 해를 만든다.
function tooYoungForPension(): SimulationParams {
  return {
    userProfile: { currentAge: 50, retirementAge: 50, expectancy: 52, targetMonthlySpending: 3_000_000 },
    assets: [], isaAccounts: [], otherIncomes: [],
    privatePensions: [{
      id: 'p', type: 'irp', investmentType: 'etf', name: 'IRP',
      balance: 500_000_000, monthlyContribution: 0,
      totalReturn: 0, dividendYield: 0, currency: 'KRW',
    }],
    nationalPension: { expectedMonthlyAmount: 0 },
    inflationRate: 0, inflationMode: 'nominal', baseExchangeRate: 1400,
    exchangeScenario: 'base', displayCurrency: 'KRW',
    hardSpendingFloor: 3_000_000,
  } as unknown as SimulationParams;
}

describe('설명되지 않는 부족은 남지 않는다', () => {
  test('법정 나이에 막힌 해는 사유가 남는다', () => {
    const result = new SimulationEngine().runSingle(tooYoungForPension());

    for (const year of result.yearlyResults) {
      const d = year.ledger!.diagnostics;
      if (d.unmetHardSpending > 0) {
        expect(d.blockedWithdrawalReason, `${year.age}세`).toBe('legalAge');
      }
    }
  });

  test('바닥을 채우려고 선호를 깬 해는 그 사실이 남는다', () => {
    const result = new SimulationEngine().runSingle({
      ...tooYoungForPension(),
      userProfile: { currentAge: 60, retirementAge: 60, expectancy: 62, targetMonthlySpending: 5_000_000 },
      taxSettings: { limitPrivatePensionToTaxLimit: true },
      hardSpendingFloor: 4_000_000,
    } as unknown as SimulationParams);

    const first = result.yearlyResults[0];
    expect(first.ledger!.diagnostics.brokenPreferences).toContain('pensionTaxLimit');
    expect(first.ledger!.diagnostics.overrideReason).toBe('hardSpendingFloor');
  });

  test('바닥이 없으면 진단이 비어 있다', () => {
    const params = tooYoungForPension();
    delete (params as unknown as Record<string, unknown>).hardSpendingFloor;

    const result = new SimulationEngine().runSingle(params);

    for (const year of result.yearlyResults) {
      expect(year.ledger!.diagnostics.brokenPreferences).toEqual([]);
      expect(year.ledger!.diagnostics.unmetHardSpending).toBe(0);
    }
  });
});
