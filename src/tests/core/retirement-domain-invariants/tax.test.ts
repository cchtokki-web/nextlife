import { describe, expect, test } from 'vitest';
import type { AssetAccount } from '@/core/usecases/withdrawal/WithdrawalEngine';
import { WithdrawalEngine } from '@/core/usecases/withdrawal/WithdrawalEngine';

// 예전 이 파일의 유일한 테스트는 `gross - tax === net`을 단언했는데, 그 항등식은 테스트가
// 직접 만든 fake 계좌가 `net: gross - tax`로 돌려주기 때문에 항상 성립했다. 실제로
// WithdrawalEngine의 세금 처리를 두 배로 망가뜨려도 이 파일은 통과했다(11개 파일이 실패하는
// 동안). fake가 지키는 항등식이 아니라 **엔진이 책임지는 것**을 검증하도록 바꾼다.
function taxedAccount(options: {
  id?: string;
  balance: number;
  taxRate: number;
  /** 계좌가 모순된 영수증을 돌려주는 경우를 재현한다. */
  lieNet?: number;
}): { account: AssetAccount; remaining: () => number } {
  let balance = options.balance;
  return {
    remaining: () => balance,
    account: {
      id: options.id ?? 'taxed',
      type: 'GENERAL',
      balance,
      currentBalance: () => balance,
      withdrawForNet: (netRequested, grossLimit) => {
        const gross = Math.min(grossLimit, netRequested / (1 - options.taxRate));
        const tax = gross * options.taxRate;
        balance -= gross;
        return { gross, tax, net: options.lieNet ?? gross - tax };
      },
    },
  };
}

describe('retirement-domain-invariants / tax', () => {
  // 이것이 세금의 핵심 불변식이다: 필요한 것은 "세후" 생활비이므로, 엔진은 세금만큼 더
  // 인출해야 한다. 세금을 잘못 다루면 사용자는 계획한 생활비를 받지 못한다.
  test('세후 필요액을 채우기 위해 세금만큼 더 인출한다', () => {
    const taxRate = 0.2;
    const { account } = taxedAccount({ balance: 10_000_000, taxRate });

    const result = new WithdrawalEngine().withdraw({
      age: 65,
      year: 2040,
      netCashRequired: 1_000_000,
      accounts: [account],
      strategy: { policy: 'GENERAL_FIRST' },
    });

    // 세후 1,000,000을 만들려면 세전 1,250,000을 빼야 한다.
    expect(result.netWithdrawal).toBeCloseTo(1_000_000, 6);
    expect(result.grossWithdrawal).toBeCloseTo(1_250_000, 6);
    expect(result.tax).toBeCloseTo(250_000, 6);
  });

  test('세금을 감당할 잔액이 부족하면 세후 금액이 요구액에 미달한다', () => {
    // 잔액 1,000,000 전액을 빼도 세후로는 800,000뿐이다. 이 부족분을 숨기면
    // 상위 현금흐름이 "충당했다"고 잘못 판단한다.
    const { account } = taxedAccount({ balance: 1_000_000, taxRate: 0.2 });

    const result = new WithdrawalEngine().withdraw({
      age: 65,
      year: 2040,
      netCashRequired: 1_000_000,
      accounts: [account],
      strategy: { policy: 'GENERAL_FIRST' },
    });

    expect(result.grossWithdrawal).toBeCloseTo(1_000_000, 6);
    expect(result.netWithdrawal).toBeCloseTo(800_000, 6);
    expect(result.netWithdrawal).toBeLessThan(1_000_000);
  });

  test('계좌가 모순된 영수증을 줘도 net은 gross - tax를 넘지 못한다', () => {
    // 이 단언은 fake가 아니라 엔진의 방어 로직(net = min(gross - tax, raw.net, 요구액))을 본다.
    const { account } = taxedAccount({ balance: 10_000_000, taxRate: 0.2, lieNet: 999_999_999 });

    const result = new WithdrawalEngine().withdraw({
      age: 65,
      year: 2040,
      netCashRequired: 1_000_000,
      accounts: [account],
      strategy: { policy: 'GENERAL_FIRST' },
    });

    expect(result.netWithdrawal).toBeLessThanOrEqual(result.grossWithdrawal - result.tax + 1e-6);
    expect(result.netWithdrawal).toBeLessThanOrEqual(1_000_000 + 1e-6);
  });

  test('합계는 계좌별 영수증의 합과 일치한다', () => {
    const first = taxedAccount({ id: 'a', balance: 600_000, taxRate: 0.2 });
    const second = taxedAccount({ id: 'b', balance: 5_000_000, taxRate: 0.1 });

    const result = new WithdrawalEngine().withdraw({
      age: 65,
      year: 2040,
      netCashRequired: 1_000_000,
      accounts: [first.account, second.account],
      strategy: { policy: 'GENERAL_FIRST' },
    });

    const sum = (pick: (r: { gross: number; tax: number; net: number }) => number) =>
      result.withdrawalsByAccount.reduce((total, receipt) => total + pick(receipt), 0);

    expect(result.grossWithdrawal).toBeCloseTo(sum((r) => r.gross), 6);
    expect(result.tax).toBeCloseTo(sum((r) => r.tax), 6);
    expect(result.netWithdrawal).toBeCloseTo(sum((r) => r.net), 6);
    // 두 계좌의 세율이 다르므로 합계 세금은 단일 세율로 설명되지 않는다.
    expect(result.withdrawalsByAccount.length).toBeGreaterThan(1);
  });
});
