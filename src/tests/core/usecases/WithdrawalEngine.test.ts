import { describe, expect, test } from 'vitest';
import {
  AssetAccount,
  WithdrawalEngine,
} from '@/core/usecases/withdrawal/WithdrawalEngine';

function taxedAccount(
  id: string,
  type: AssetAccount['type'],
  initialBalance: number,
  taxRate: number,
  options: Partial<AssetAccount> = {}
) {
  let balance = initialBalance;
  const account: AssetAccount = {
    id,
    type,
    balance,
    availableGross: () => balance,
    estimatedTaxRate: taxRate,
    withdrawForNet: (netRequested, grossLimit) => {
      const gross = Math.min(grossLimit, netRequested / (1 - taxRate));
      balance -= gross;
      return { gross, tax: gross * taxRate, net: gross * (1 - taxRate) };
    },
    ...options,
  };
  return { account, balance: () => balance };
}

describe('WithdrawalEngine', () => {
  test('세후 필요액을 확보하도록 gross withdrawal을 역산한다', () => {
    const source = taxedAccount('general', 'GENERAL', 2_000_000, 0.2);
    const result = new WithdrawalEngine().withdraw({
      age: 65,
      year: 2040,
      netCashRequired: 1_000_000,
      liquidatableHeadroom: 2_000_000,
      accounts: [source.account],
      strategy: { policy: 'GENERAL_FIRST' },
    });

    expect(result.grossWithdrawal).toBe(1_250_000);
    expect(result.tax).toBe(250_000);
    expect(result.netWithdrawal).toBe(1_000_000);
    expect(result.unfulfilledAmount).toBe(0);
    expect(result.withdrawalsByAccount[0]).toMatchObject({ accountId: 'general', accountType: 'GENERAL' });
    expect(result.remainingAccounts[0].balance).toBe(750_000);
  });

  test('HARD 보호자산을 침범해야만 하는 금액은 미충족으로 남긴다', () => {
    const source = taxedAccount('general', 'GENERAL', 2_000_000, 0);
    const result = new WithdrawalEngine().withdraw({
      age: 65,
      year: 2040,
      netCashRequired: 1_000_000,
      liquidatableHeadroom: 600_000,
      accounts: [source.account],
      strategy: { policy: 'GENERAL_FIRST' },
    });

    expect(result.netWithdrawal).toBe(600_000);
    expect(result.unfulfilledAmount).toBe(400_000);
    expect(source.balance()).toBe(1_400_000);
  });

  test.each([
    ['GENERAL_FIRST', ['GENERAL', 'PENSION_SAVINGS', 'ISA']],
    ['ISA_FIRST', ['ISA', 'GENERAL', 'PENSION_SAVINGS']],
    ['PENSION_FIRST', ['PENSION_SAVINGS', 'GENERAL', 'ISA']],
  ] as const)('%s 정책 순서로 계좌를 인출한다', (policy, expectedOrder) => {
    const actualOrder: string[] = [];
    const account = (id: string, type: AssetAccount['type']): AssetAccount => ({
      id,
      type,
      balance: 40,
      withdrawForNet: (netRequested, grossLimit) => {
        const gross = Math.min(netRequested, grossLimit);
        actualOrder.push(type);
        return { gross, tax: 0, net: gross };
      },
    });

    new WithdrawalEngine().withdraw({
      age: 65,
      year: 2040,
      netCashRequired: 100,
      accounts: [account('isa', 'ISA'), account('pension', 'PENSION_SAVINGS'), account('general', 'GENERAL')],
      strategy: { policy },
    });

    expect(actualOrder).toEqual(expectedOrder);
  });

  test('TAX_OPTIMIZED는 추천 없이 전달받은 예상 세율이 낮은 계좌부터 사용한다', () => {
    const pension = taxedAccount('pension', 'IRP', 100, 0.05);
    const general = taxedAccount('general', 'GENERAL', 100, 0.2);
    const result = new WithdrawalEngine().withdraw({
      age: 65,
      year: 2040,
      netCashRequired: 50,
      accounts: [general.account, pension.account],
      strategy: { policy: 'TAX_OPTIMIZED' },
    });

    expect(result.withdrawalsByAccount.map((item) => item.accountId)).toEqual(['pension']);
  });

  test('PROPORTIONAL은 인출 가능 잔액 비율대로 나눈다', () => {
    const first = taxedAccount('first', 'GENERAL', 300, 0);
    const second = taxedAccount('second', 'ISA', 100, 0);
    const result = new WithdrawalEngine().withdraw({
      age: 65,
      year: 2040,
      netCashRequired: 200,
      accounts: [first.account, second.account],
      strategy: { policy: 'PROPORTIONAL' },
    });

    expect(result.withdrawalsByAccount).toEqual([
      { accountId: 'first', accountType: 'GENERAL', gross: 150, tax: 0, net: 150 },
      { accountId: 'second', accountType: 'ISA', gross: 50, tax: 0, net: 50 },
    ]);
  });

  test('PROPORTIONAL은 보호자산 headroom만 계좌별 잔액 비율로 나눈다', () => {
    const first = taxedAccount('first', 'GENERAL', 100, 0);
    const second = taxedAccount('second', 'ISA', 100, 0);
    const result = new WithdrawalEngine().withdraw({
      age: 65,
      year: 2040,
      netCashRequired: 100,
      liquidatableHeadroom: 50,
      accounts: [first.account, second.account],
      strategy: { policy: 'PROPORTIONAL' },
    });

    expect(result.withdrawalsByAccount).toEqual([
      { accountId: 'first', accountType: 'GENERAL', gross: 25, tax: 0, net: 25 },
      { accountId: 'second', accountType: 'ISA', gross: 25, tax: 0, net: 25 },
    ]);
    expect(result.unfulfilledAmount).toBe(50);
  });

  test('잔액 콜백이 없는 계좌도 실제 gross 인출액을 차감한 잔액을 반환한다', () => {
    const result = new WithdrawalEngine().withdraw({
      age: 65,
      year: 2040,
      netCashRequired: 30,
      accounts: [{
        id: 'plain',
        type: 'GENERAL',
        balance: 100,
        withdrawForNet: (netRequested, grossLimit) => {
          const gross = Math.min(netRequested, grossLimit);
          return { gross, tax: 0, net: gross };
        },
      }],
      strategy: { policy: 'GENERAL_FIRST' },
    });

    expect(result.remainingAccounts).toEqual([{ id: 'plain', type: 'GENERAL', balance: 70 }]);
  });

  test('CUSTOM은 계좌 id 우선순위를 그대로 따른다', () => {
    const first = taxedAccount('first', 'GENERAL', 100, 0);
    const second = taxedAccount('second', 'GENERAL', 100, 0);
    const result = new WithdrawalEngine().withdraw({
      age: 65,
      year: 2040,
      netCashRequired: 50,
      accounts: [first.account, second.account],
      strategy: { policy: 'CUSTOM', customOrder: ['second', 'first'] },
    });

    expect(result.withdrawalsByAccount.map((item) => item.accountId)).toEqual(['second']);
  });

  test('인출 가능 여부·최소 연령·계좌 한도·보호 최소잔액을 함께 적용한다', () => {
    const locked = taxedAccount('locked', 'ISA', 100, 0, { withdrawable: false });
    const tooYoung = taxedAccount('too-young', 'IRP', 100, 0, { minimumWithdrawalAge: 65 });
    const limited = taxedAccount('limited', 'GENERAL', 100, 0, {
      withdrawalLimit: 30,
      protectedMinimumBalance: 40,
    });
    const result = new WithdrawalEngine().withdraw({
      age: 60,
      year: 2040,
      netCashRequired: 100,
      accounts: [locked.account, tooYoung.account, limited.account],
      strategy: { policy: 'GENERAL_FIRST' },
    });

    expect(result.netWithdrawal).toBe(30);
    expect(result.unfulfilledAmount).toBe(70);
    expect(result.withdrawalsByAccount.map((item) => item.accountId)).toEqual(['limited']);
    expect(limited.balance()).toBe(70);
  });
});
