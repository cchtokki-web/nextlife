import { describe, expect, test } from 'vitest';
import {
  calculateFundingGap,
  completeCashFlow,
} from '@/core/usecases/cashflow/CashFlowPipeline';

describe('CashFlowPipeline', () => {
  test('모든 소득을 먼저 차감한 금액만 Funding Gap이다', () => {
    const gap = calculateFundingGap(5_000_000, {
      employment: 100_000,
      nationalPension: 1_000_000,
      privatePension: 500_000,
      dividend: 300_000,
      other: 100_000,
    });

    expect(gap).toEqual({
      targetSpending: 5_000_000,
      availableIncome: 2_000_000,
      fundingGap: 3_000_000,
      surplus: 0,
    });
  });

  test('Shortfall은 세후 인출 가능액을 반영한 마지막 단계에서만 확정된다', () => {
    const gap = calculateFundingGap(5_000_000, {
      employment: 0,
      nationalPension: 1_000_000,
      privatePension: 0,
      dividend: 0,
      other: 0,
    });

    expect(completeCashFlow(gap, 4_000_000).shortfall).toBe(0);
    expect(completeCashFlow(gap, 2_500_000)).toMatchObject({
      actualSpending: 3_500_000,
      shortfall: 1_500_000,
    });
  });
});
