import { describe, expect, test } from 'vitest';
import type { AssetAccount } from '@/core/usecases/withdrawal/WithdrawalEngine';
import { WithdrawalEngine } from '@/core/usecases/withdrawal/WithdrawalEngine';

describe('retirement-domain-invariants / tax', () => {
  test('모든 인출 영수증에서 Gross Withdrawal - Tax = Net Withdrawal이다', () => {
    let balance = 2_000_000;
    const taxRate = 0.2;
    const account: AssetAccount = {
      id: 'taxed-account',
      type: 'GENERAL',
      balance,
      currentBalance: () => balance,
      withdrawForNet: (netRequested, grossLimit) => {
        const gross = Math.min(grossLimit, netRequested / (1 - taxRate));
        const tax = gross * taxRate;
        balance -= gross;
        return { gross, tax, net: gross - tax };
      },
    };
    const result = new WithdrawalEngine().withdraw({
      age: 65,
      year: 2040,
      netCashRequired: 1_000_000,
      accounts: [account],
      strategy: { policy: 'GENERAL_FIRST' },
    });

    expect(result.grossWithdrawal - result.tax).toBeCloseTo(result.netWithdrawal, 8);
    for (const receipt of result.withdrawalsByAccount) {
      expect(receipt.gross - receipt.tax).toBeCloseTo(receipt.net, 8);
    }
  });
});
