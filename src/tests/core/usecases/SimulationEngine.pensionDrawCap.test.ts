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

  // 잔액이 작으면 균등분할액이 필요액을 넘지 못해 상한 자체가 발동하지 않는다. 그래서
  // 「잉여가 없다」는 상한과 무관하게 성립하고, 이 테스트만으로는 상한을 검증하지 못한다.
  // 검증하는 것은 그 옆의 성질이다: 잔액이 모자라면 «있는 만큼만» 나가고, 없는 돈을
  // 인출한 것처럼 세지 않는다(총 인출액이 초기 잔액을 넘지 않는다).
  test('연금 잔액이 필요액에 못 미치면 있는 만큼만 쓰고 인출을 부풀리지 않는다', () => {
    const balance = 30_000_000;
    const result = engine.runSingle(params({
      privatePensions: [
        { id: 'irp', type: 'irp', balance, monthlyContribution: 0, annualReturn: 4, currency: 'KRW' },
      ],
    }));

    const cashPeak = Math.max(...result.yearlyResults.map((row) => row.cashAssets));
    expect(cashPeak).toBeLessThan(1_000_000);

    // 연 4% 수익이 붙으므로 인출 총액은 초기 잔액보다 클 수 있지만, 무한정은 아니다.
    // 잔액이 다 나가고 나면 인출도 멈춰야 한다.
    const totalDrawn = result.yearlyResults.reduce((sum, row) => sum + row.privatePensionIncome, 0);
    expect(totalDrawn).toBeGreaterThan(0);
    expect(totalDrawn).toBeLessThan(balance * 3);
    const lastYear = result.yearlyResults[result.yearlyResults.length - 1];
    expect(lastYear.pensionAssets).toBeGreaterThanOrEqual(0);
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

  // **상한이 하한을 침범하지 않는다는 것을 «생활비»로 확인한다.**
  //
  // 위 세 테스트는 전부 「잉여가 없다」(cashPeak가 작다)를 본다. 그 방향만 보면 상한을 너무
  // 세게 걸어 «덜 빼는» 쪽으로 틀렸을 때 전부 통과한다 — 잉여는 더 줄어들 뿐이다. 그래서
  // 반대 방향을 따로 잠근다: 사적연금이 유일한 재원인 계획에서도 목표 생활비가 채워지는가.
  //
  // 다만 이 단언이 세금 그로스업(`필요액 ÷ (1 - 세율)`)의 회귀 가드는 «아니다». 확인해 보면
  // 그 나눗셈을 지워도 생활비는 그대로 채워진다 — Funding Gap 경로가 부족분을 다시 메우기
  // 때문이다. 그로스업이 실제로 바꾸는 것은 잉여와 세금이며, 그쪽은 아래 다계좌 테스트가
  // 잡는다(그로스업을 지우면 그 테스트가 깨진다).
  test('상한을 걸어도 목표 생활비가 모자라지 않는다', () => {
    const result = engine.runSingle(params({
      assets: [],
      // 균등분할액이 필요액을 넘어야 상한 구간에 들어간다. 넘지 않으면 상한 자체가 돌지 않는다.
      privatePensions: [
        { id: 'irp', type: 'irp', balance: 2_000_000_000, monthlyContribution: 0, annualReturn: 4, currency: 'KRW' },
      ],
    }));

    const retired = result.yearlyResults.filter((row) => row.age >= 60);
    expect(retired.length).toBeGreaterThan(0);
    for (const row of retired) {
      // 목표 3,500,000 × 12. 물가 0%·실질 모드라 전 구간 같은 금액이다.
      expect(row.spending).toBeCloseTo(42_000_000, -4);
    }
  });

  // **여러 계좌가 필요액을 «공유»한다.** 계좌마다 필요액을 새로 주면 계좌 수만큼 중복
  // 인출되어, 같은 6억이라도 계좌를 쪼갠 사용자만 연금을 두 배로 빼게 된다.
  // 기존 테스트는 전부 계좌 1개짜리라 이 갈래를 한 번도 지나지 않는다(기본 시나리오는 2개다).
  test('계좌를 쪼개도 합계 인출액이 같다', () => {
    const one = engine.runSingle(params());
    const two = engine.runSingle(params({
      privatePensions: [
        { id: 'irp-a', type: 'irp', balance: 300_000_000, monthlyContribution: 0, annualReturn: 4, currency: 'KRW' },
        { id: 'irp-b', type: 'irp', balance: 300_000_000, monthlyContribution: 0, annualReturn: 4, currency: 'KRW' },
      ],
    }));

    for (const [index, row] of one.yearlyResults.entries()) {
      expect(two.yearlyResults[index].privatePensionIncome).toBeCloseTo(row.privatePensionIncome, -3);
    }
    expect(two.endingAssets).toBeCloseTo(one.endingAssets, -3);
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
