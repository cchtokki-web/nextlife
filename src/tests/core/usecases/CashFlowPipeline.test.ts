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

  // 회귀: known-issues 4번. 인출 엔진이 요청을 «전부» 채우고도(unfulfilledAmount = 0) 세후
  // 현금을 1 ulp 모자라게 돌려주는 달이 있다 — 계좌별 몫은 요청액에서 «빼서» 정하는데
  // 세후 현금은 영수증을 «더해서» 만들기 때문이다. 아래 숫자는 그 달의 실측값이다
  // (기대수명 68 / 목표 월 600만 / tax_first, 61세).
  test('세후 현금의 1 ulp 잔돈은 미달이 아니다', () => {
    const gap = calculateFundingGap(6_000_000, {
      employment: 0,
      nationalPension: 1_181_250.4677100563,
      privatePension: 0,
      dividend: 0,
      other: 0,
    });
    const netOneUlpShort = 4_818_749.532289943;

    // 전제부터 고정한다 — 이 시험이 재현하는 것은 «요청보다 10억분의 1원 적게» 돌아온 현금이다.
    expect(netOneUlpShort).toBeLessThan(gap.fundingGap);
    expect(gap.fundingGap - netOneUlpShort).toBeLessThan(0.000_001);

    expect(completeCashFlow(gap, netOneUlpShort).shortfall).toBe(0);
  });

  test('원 단위로 반올림할 뿐, 실제 미달을 내림해 숨기지 않는다', () => {
    const gap = calculateFundingGap(3_000_000.6, {
      employment: 0,
      nationalPension: 3_000_000,
      privatePension: 0,
      dividend: 0,
      other: 0,
    });

    // 0.6원은 0으로 내려가지 않는다(내림이면 매달 최대 1원씩 진짜 미달이 사라진다).
    expect(completeCashFlow(gap, 0).shortfall).toBe(1);
    // 반면 실제로 오간 금액은 반올림하지 않는다 — 원장 항등식이 그 위에 서 있다.
    expect(completeCashFlow(gap, 0).actualSpending).toBe(3_000_000);
    expect(completeCashFlow(gap, 0.25)).toMatchObject({
      withdrawalNetCash: 0.25,
      actualSpending: 3_000_000.25,
      shortfall: 0,
    });
  });
});
