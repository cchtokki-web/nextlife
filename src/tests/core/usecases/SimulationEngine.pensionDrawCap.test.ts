import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { SimulationParams } from '@/core/entities/types';

// **정책 미지정 경로의 사적연금 정기 인출은 필요액을 넘지 않는다.**
//
// 인출 정책을 지정하지 않은 시나리오에서는 사적연금이 `잔액 ÷ 잔여개월`로 매달 자동
// 인출된다. 이 식은 나이가 들수록 인출률이 오르므로(60세 3.3% → 70세 5% → 80세 10%)
// 어느 시점부터 인출액이 목표 생활비를 넘어선다. 넘은 돈은 갈 곳이 없어 잉여현금이 되고,
// 현금을 자산으로 되돌리는 경로가 없어 기대수명까지 단조 누적된다. 실측으로는 사적연금
// 6억 시나리오에서 69세부터 쌓이기 시작해 90세에 1억이 됐다.
//
// 그 사이 사용자는 연금소득세를 물고, 실질수익률 -2%인 현금 계좌에 돈을 재워 둔다.
// 화면에는 "투자자산 소진" 경고와 억대 현금이 나란히 뜬다.
//
// `잔액 ÷ 잔여개월`은 법정 연금수령한도(`평가액 ÷ (11 - 연금수령연차) × 120%`)가 아니라
// 기대수명까지 균등분할하는 편의 가정이다. 실제 연금저축·IRP는 수령 개시 후에도 수령액을
// 자유롭게 조절할 수 있고 최소 의무 수령액이 없다 — 제도가 두는 것은 상한뿐이다.
// 그래서 필요액까지만 빼는 것은 제도를 왜곡하지 않는다.

const engine = new SimulationEngine();

/**
 * 잉여가 실제로 발생하는 조건.
 *
 * 일반자산이 부족분을 메워 줘야 연금 잔액이 유지되고, 잔액이 유지된 채 잔여개월만 줄면
 * `잔액 ÷ 잔여개월`이 계속 커져 어느 시점에 생활비를 넘어선다. 일반자산이 없으면 연금이
 * 곧바로 소진되며 인출액도 같이 줄어 이 현상 자체가 나타나지 않는다.
 */
function params(overrides: Partial<SimulationParams> = {}): SimulationParams {
  return {
    userProfile: { currentAge: 51, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3_500_000 },
    assets: [
      {
        id: 'etf', type: 'etf', ticker: '069500', name: 'KODEX 200',
        quantity: 3_000, averagePrice: 100_000, annualGrowthRate: 5, dividendYield: 2,
        monthlyContribution: 0, reinvestDividend: true, currency: 'KRW',
      },
    ],
    isaAccounts: [],
    nationalPension: { expectedMonthlyAmount: 1_200_000 },
    privatePensions: [
      { id: 'irp', type: 'irp', balance: 600_000_000, monthlyContribution: 0, annualReturn: 4, currency: 'KRW' },
    ],
    otherIncomes: [],
    inflationRate: 0,
    inflationMode: 'real',
    baseExchangeRate: 1350,
    exchangeScenario: 'base',
    displayCurrency: 'KRW',
    ...overrides,
  };
}

describe('SimulationEngine - 사적연금 정기 인출 상한', () => {
  test('인출액이 필요액을 넘겨 잉여현금으로 쌓이지 않는다', () => {
    const result = engine.runSingle(params());

    const cashPeak = Math.max(...result.yearlyResults.map((row) => row.cashAssets));
    // 월 단위 반올림 잔여는 허용하되, 억대 누적은 허용하지 않는다.
    expect(cashPeak).toBeLessThan(1_000_000);
  });

  test('연금 잔액이 필요액에 못 미치면 있는 만큼만 쓰고 인출을 부풀리지 않는다', () => {
    const result = engine.runSingle(params({
      privatePensions: [
        { id: 'irp', type: 'irp', balance: 30_000_000, monthlyContribution: 0, annualReturn: 4, currency: 'KRW' },
      ],
    }));

    const cashPeak = Math.max(...result.yearlyResults.map((row) => row.cashAssets));
    expect(cashPeak).toBeLessThan(1_000_000);
  });

  // 상한이 하한을 침범하면 안 된다. 필요액이 균등분할액보다 큰 구간에서는 종전과 같이
  // 균등분할액 전액이 인출되어야 하고, 그래야 생활비가 채워진다.
  test('필요액이 균등분할액보다 크면 균등분할액대로 인출한다', () => {
    const result = engine.runSingle(params({
      userProfile: { currentAge: 60, retirementAge: 60, expectancy: 90, targetMonthlySpending: 10_000_000 },
    }));

    const firstYear = result.yearlyResults[0];
    // 6억 ÷ 360개월 ≈ 월 167만원, 연 2,000만원 수준. 상한을 걸어도 이 규모는 그대로 나와야 한다.
    expect(firstYear.privatePensionIncome).toBeGreaterThan(15_000_000);
  });

  // 정책을 지정한 경로는 이 코드가 아예 돌지 않는다. 숫자가 한 자리도 변하면 안 된다.
  // 실제로 사적연금이 인출되는 PENSION_FIRST로 고정해, 상한이 이 경로에 새어 들어오면
  // 값이 달라지도록 한다. 아래 수치는 변경 «전»에 측정한 기준값이다.
  test('인출 정책을 지정한 경로의 결과는 바뀌지 않는다', () => {
    const withPolicy = params({
      withdrawalPlan: { nationalPensionStartAge: 65, accountWithdrawalPolicy: 'PENSION_FIRST' },
    });

    const result = engine.runSingle(withPolicy);
    const at = (age: number) => result.yearlyResults.find((row) => row.age === age)!;

    expect(result.depletionAge).toBeNull();
    expect(Math.round(at(70).privatePensionIncome)).toBe(25_660_315);
    expect(Math.round(at(90).privatePensionIncome)).toBe(25_381_791);
    expect(Math.round(at(90).totalAssets)).toBe(4_728_362_755);
    expect(Math.max(...result.yearlyResults.map((row) => row.cashAssets))).toBe(0);
  });
});
