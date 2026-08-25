import { describe, expect, test } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import type { SimulationParams } from '@/core/entities/types';

function pensionScenario(overrides: Partial<SimulationParams> = {}): SimulationParams {
  return {
    userProfile: { currentAge: 65, retirementAge: 65, expectancy: 90, targetMonthlySpending: 3_000_000 },
    assets: [], isaAccounts: [], otherIncomes: [],
    privatePensions: [
      { id: 'irp', name: 'IRP', type: 'irp', balance: 180_000_000, monthlyContribution: 0, totalReturn: 4, currency: 'KRW' },
      { id: 'savings', name: '연금저축', type: 'savings', balance: 120_000_000, monthlyContribution: 0, totalReturn: 4, currency: 'KRW' },
    ],
    nationalPension: { expectedMonthlyAmount: 1_910_000 },
    inflationRate: 0, inflationMode: 'nominal', baseExchangeRate: 1,
    exchangeScenario: 'base', displayCurrency: 'KRW',
    ...overrides,
  };
}

describe('사적연금 계좌별 원장', () => {
  test('매년 기초 + 납입 + 이전 + 수익 - 순인출 - 세금 = 기말 잔액이다', () => {
    const result = new SimulationEngine().runSingle(pensionScenario());

    for (const year of result.yearlyResults) {
      expect(year.privatePensionAccountLedgers).toHaveLength(2);
      for (const account of year.privatePensionAccountLedgers!) {
        const expected = account.beginningBalance
          + account.contribution
          + account.transferIn
          + account.investmentReturn
          - account.withdrawal
          - account.tax;
        expect(account.endingBalance).toBeCloseTo(expected, 5);
        expect(account.endingBalance).toBeGreaterThanOrEqual(0);
        expect(account.statutoryLimitAssessment).toEqual({
          status: 'not_assessable',
          annualLimit: null,
          withinLimit: null,
          missingInputs: [
            'pensionCommencementYear',
            'taxPeriodOpeningBalance',
            'pre2013Exception',
          ],
        });
      }
    }
  });

  test('계좌 원장 기말 합계가 화면의 사적연금 자산과 일치한다', () => {
    const result = new SimulationEngine().runSingle(pensionScenario());

    for (const year of result.yearlyResults) {
      const accountTotal = year.privatePensionAccountLedgers!
        .reduce((sum, account) => sum + account.endingBalance, 0);
      expect(accountTotal).toBeCloseTo(year.pensionAssets, 6);
    }
  });

  test('잔액을 넘겨 인출하지 않고 소진 뒤에는 해당 계좌 소득이 생기지 않는다', () => {
    const result = new SimulationEngine().runSingle(pensionScenario({
      userProfile: { currentAge: 65, retirementAge: 65, expectancy: 90, targetMonthlySpending: 10_000_000 },
      privatePensions: [{
        id: 'small', name: '소액 IRP', type: 'irp', balance: 10_000_000,
        monthlyContribution: 0, totalReturn: 0, currency: 'KRW',
      }],
      nationalPension: { expectedMonthlyAmount: 0 },
    }));

    for (const year of result.yearlyResults) {
      const account = year.privatePensionAccountLedgers![0];
      expect(account.withdrawal + account.tax)
        .toBeLessThanOrEqual(account.beginningBalance + account.contribution + account.transferIn + account.investmentReturn + 1);
    }
    const exhaustedIndex = result.yearlyResults.findIndex(
      (year) => year.privatePensionAccountLedgers![0].endingBalance <= 1
    );
    expect(exhaustedIndex).toBeGreaterThanOrEqual(0);
    for (const year of result.yearlyResults.slice(exhaustedIndex + 1)) {
      expect(year.privatePensionIncome).toBe(0);
      expect(year.privatePensionWithdrawal).toBe(0);
    }
  });

  test('90세까지 지급된 사적연금은 매년 실제 잔액에서 나온다', () => {
    const result = new SimulationEngine().runSingle(pensionScenario());
    const lateYears = result.yearlyResults.filter((year) => year.age >= 80);

    expect(lateYears).toHaveLength(11);
    for (const year of lateYears) {
      const financedByAccounts = year.privatePensionAccountLedgers!
        .reduce((sum, account) => sum + account.withdrawal, 0);
      expect(year.privatePensionIncome).toBeCloseTo(financedByAccounts, 5);
    }
  });
});
