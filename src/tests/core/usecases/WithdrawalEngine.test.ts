import { describe, expect, test } from 'vitest';
import { WithdrawalEngine } from '@/core/usecases/withdrawal/WithdrawalEngine';

describe('WithdrawalEngine', () => {
  test('세후 필요액을 확보하도록 gross withdrawal을 역산한다', () => {
    let balance = 2_000_000;
    const result = new WithdrawalEngine().withdraw({
      requiredNetCash: 1_000_000,
      liquidatableHeadroom: 2_000_000,
      sources: [{
        availableGross: () => balance,
        withdrawForNet: (netRequested, grossLimit) => {
          const gross = Math.min(grossLimit, netRequested / 0.8);
          balance -= gross;
          return { gross, tax: gross * 0.2, net: gross * 0.8 };
        },
      }],
    });

    expect(result.gross).toBe(1_250_000);
    expect(result.tax).toBe(250_000);
    expect(result.net).toBe(1_000_000);
    expect(result.unmetNetCash).toBe(0);
  });

  test('HARD 보호자산을 침범해야만 하는 금액은 미충족으로 남긴다', () => {
    let balance = 2_000_000;
    const result = new WithdrawalEngine().withdraw({
      requiredNetCash: 1_000_000,
      liquidatableHeadroom: 600_000,
      sources: [{
        availableGross: () => balance,
        withdrawForNet: (netRequested, grossLimit) => {
          const gross = Math.min(netRequested, grossLimit);
          balance -= gross;
          return { gross, tax: 0, net: gross };
        },
      }],
    });

    expect(result.net).toBe(600_000);
    expect(result.unmetNetCash).toBe(400_000);
    expect(balance).toBe(1_400_000);
  });
});
