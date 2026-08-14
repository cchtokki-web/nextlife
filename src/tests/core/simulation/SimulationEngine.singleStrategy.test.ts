import { describe, expect, test } from 'vitest';
import type { AccountWithdrawalPolicy, SimulationParams } from '@/core/entities/types';
import { LegacySimulationAdapter } from '@/core/domain/input/LegacySimulationAdapter';
import type { SimulationEngine } from '@/core/simulation/SimulationEngine';
import { LegacySimulationEngine } from '@/core/simulation/LegacySimulationEngine';

function config(policy: AccountWithdrawalPolicy): SimulationParams {
  return {
    userProfile: {
      currentAge: 60,
      retirementAge: 60,
      expectancy: 60,
      targetMonthlySpending: 10_000_000,
    },
    assets: [{
      id: 'general', type: 'etf', ticker: 'GENERAL', name: '일반자산',
      quantity: 10_000, averagePrice: 100_000, annualGrowthRate: 0,
      dividendYield: 0, monthlyContribution: 0, reinvestDividend: false,
      currency: 'KRW',
    }],
    isaAccounts: [{
      id: 'isa', type: 'general', balance: 1_000_000_000,
      monthlyContribution: 0, annualReturn: 0, dividendYield: 0,
      currency: 'KRW', maturityYears: 100,
    }],
    nationalPension: { expectedMonthlyAmount: 0 },
    privatePensions: [{
      id: 'pension', type: 'irp', balance: 1_000_000_000,
      monthlyContribution: 0, annualReturn: 0, currency: 'KRW',
    }],
    otherIncomes: [],
    inflationRate: 0,
    inflationMode: 'real',
    baseExchangeRate: 1_350,
    exchangeScenario: 'base',
    displayCurrency: 'KRW',
    withdrawalPlan: { accountWithdrawalPolicy: policy },
  };
}

describe('SimulationEngine single-strategy boundary', () => {
  test('same profile and strategy produce the same result with an explicit year anchor', () => {
    const input = LegacySimulationAdapter.fromLegacy(config('GENERAL_FIRST'));
    input.strategy.simulationStartYear = 2042;
    const engine: SimulationEngine = new LegacySimulationEngine();

    const first = engine.simulate(input.profile, input.strategy);
    const second = engine.simulate(input.profile, input.strategy);

    expect(second).toEqual(first);
    expect(first.yearlyResults[0].year).toBe(2042);
    expect(first).not.toHaveProperty('utility');
    expect(first).not.toHaveProperty('recommendation');
    expect(first).not.toHaveProperty('calculatedTargetSpending');
    expect(first).not.toHaveProperty('retirementScore');
    expect(first).not.toHaveProperty('retirementGrade');
    expect(first).not.toHaveProperty('goalAchievementRate');
    expect(first).not.toHaveProperty('fireAge');
    expect(first).not.toHaveProperty('avgRetirementMonthlyIncome');
    expect(first).not.toHaveProperty('avgTargetMonthlySpending');
    expect(first).not.toHaveProperty('retirementAssetsAtRetirement');
  });

  test.each([
    ['GENERAL_FIRST', 'generalAssetWithdrawal'],
    ['ISA_FIRST', 'isaWithdrawal'],
    ['PENSION_FIRST', 'privatePensionWithdrawal'],
  ] as const)('%s records the account-class withdrawal in the annual result', (policy, field) => {
    const input = LegacySimulationAdapter.fromLegacy(config(policy));
    const engine: SimulationEngine = new LegacySimulationEngine();
    const year = engine.simulate(input.profile, input.strategy).yearlyResults[0];

    expect(year[field]).toBeGreaterThan(0);
    expect(year.targetSpending).toBeCloseTo(year.actualSpending + year.shortfall, 6);
    expect(year.actualSpending).toBe(year.spending);
    expect(year.shortfall).toBe(year.unmetSpending);
    expect(year.closingAssets).toBe(year.totalAssets);
    expect(year.withdrawal).toBeGreaterThanOrEqual(
      year.generalAssetWithdrawal + year.isaWithdrawal + year.privatePensionWithdrawal
    );
    expect(year.taxes).toBeCloseTo(
      year.dividendTaxPaid
        + year.pensionTaxPaid
        + year.nationalPensionTaxPaid
        + year.comprehensiveTaxPaid
        + year.healthInsurancePaid
        + year.capitalGainsTaxPaid,
      6
    );
  });
});
