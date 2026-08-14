import { describe, expect, test } from 'vitest';
import type { AssetAccount } from '@/core/usecases/withdrawal/WithdrawalEngine';
import { WithdrawalEngine } from '@/core/usecases/withdrawal/WithdrawalEngine';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { retirementParams } from './fixtures';

describe('retirement-domain-invariants / withdrawal', () => {
  test('계좌 잔액보다 많은 금액을 인출하지 않고 미충족액으로 남긴다', () => {
    let balance = 1_000_000;
    const account: AssetAccount = {
      id: 'bounded-account',
      type: 'GENERAL',
      balance,
      currentBalance: () => balance,
      withdrawForNet: (netRequested, grossLimit) => {
        const gross = Math.min(balance, netRequested, grossLimit);
        balance -= gross;
        return { gross, tax: 0, net: gross };
      },
    };

    const result = new WithdrawalEngine().withdraw({
      age: 65,
      year: 2040,
      netCashRequired: 1_500_000,
      accounts: [account],
      strategy: { policy: 'GENERAL_FIRST' },
    });

    expect(result.grossWithdrawal).toBe(1_000_000);
    expect(result.unfulfilledAmount).toBe(500_000);
    expect(balance).toBe(0);
    expect(result.remainingAccounts[0].balance).toBe(0);
  });

  test('부채 모델이 없는 투자·ISA·연금·현금 계좌 잔액은 음수가 되지 않는다', () => {
    const result = new SimulationEngine().run(retirementParams({
      userProfile: {
        currentAge: 60,
        retirementAge: 60,
        expectancy: 75,
        targetMonthlySpending: 100_000_000,
      },
      assets: [{ ...retirementParams().assets[0], quantity: 100 }],
      nationalPension: { expectedMonthlyAmount: 0 },
    }));

    for (const year of result.yearlyResults) {
      expect(year.stockAssets).toBeGreaterThanOrEqual(0);
      expect(year.isaAssets).toBeGreaterThanOrEqual(0);
      expect(year.pensionAssets).toBeGreaterThanOrEqual(0);
      expect(year.cashAssets).toBeGreaterThanOrEqual(0);
      expect(year.totalAssets).toBeGreaterThanOrEqual(0);
    }
  });
});
