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

  // 위 첫 테스트는 fake가 스스로 Math.min(balance, netRequested, grossLimit)로 잘라서
  // 돌려주기 때문에, 엔진의 상한 클램프를 제거해도 통과했다(mutation 검증됨).
  // 계좌가 **한도를 지키지 않는 값**을 돌려주는 경우로 엔진의 방어를 직접 본다.
  test('계좌가 한도를 초과해 돌려줘도 엔진이 gross를 잘라낸다', () => {
    let balance = 1_000_000;
    const greedy: AssetAccount = {
      id: 'greedy',
      type: 'GENERAL',
      balance,
      currentBalance: () => balance,
      // 요청·한도와 무관하게 훨씬 큰 금액을 보고한다.
      withdrawForNet: () => {
        balance = 0;
        return { gross: 9_999_999, tax: 0, net: 9_999_999 };
      },
    };

    const result = new WithdrawalEngine().withdraw({
      age: 65,
      year: 2040,
      netCashRequired: 500_000,
      accounts: [greedy],
      strategy: { policy: 'GENERAL_FIRST' },
    });

    // 잔액(1,000,000)도, 요청액(500,000)도 넘어서는 안 된다.
    expect(result.grossWithdrawal).toBeLessThanOrEqual(1_000_000);
    expect(result.netWithdrawal).toBeLessThanOrEqual(500_000);
    expect(result.withdrawalsByAccount[0].gross).toBeLessThanOrEqual(1_000_000);
  });

  // 참고(mutation 분석용): 보호 잔액은 WithdrawalEngine 안에서 **두 곳**이 각각 막는다 —
  // 후보 준비 단계(availableGross 산정)와 실제 인출 단계(grossLimit 산정). 그래서 한쪽만
  // 무력화하면 다른 쪽이 여전히 막아 이 테스트가 통과한다. 양쪽을 모두 무력화하면 실패한다.
  // 커버리지 공백이 아니라 의도된 이중 방어이므로, 단일 지점 생존을 보고 테스트가 약하다고
  // 판단하지 말 것.
  test('보호 잔액 아래로는 인출하지 않는다', () => {
    let balance = 1_000_000;
    const account: AssetAccount = {
      id: 'protected',
      type: 'GENERAL',
      balance,
      currentBalance: () => balance,
      protectedMinimumBalance: 600_000,
      withdrawForNet: (netRequested, grossLimit) => {
        const gross = Math.min(netRequested, grossLimit);
        balance -= gross;
        return { gross, tax: 0, net: gross };
      },
    };

    const result = new WithdrawalEngine().withdraw({
      age: 65,
      year: 2040,
      netCashRequired: 1_000_000,
      accounts: [account],
      strategy: { policy: 'GENERAL_FIRST' },
    });

    // 인출 가능액은 1,000,000 - 600,000 = 400,000뿐이다.
    expect(result.grossWithdrawal).toBeCloseTo(400_000, 6);
    expect(result.unfulfilledAmount).toBeCloseTo(600_000, 6);
    expect(balance).toBeGreaterThanOrEqual(600_000);
  });
});
