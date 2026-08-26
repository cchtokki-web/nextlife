import { describe, expect, test } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { calculatePensionIncomeTaxKRW, getPrivatePensionIncomeTaxRate } from '@/core/usecases/tax/TaxEngine';
import { resolveTaxContext } from '@/core/usecases/tax/taxContext';
import type { SimulationParams } from '@/core/entities/types';

/**
 * 리포트가 「사적연금 60~61세 연 2,697만원」이라고 적은 그 숫자가 어디서 오는지 고정한다.
 *
 * 사슬은 네 단계다.
 *   1. 월 정액 인출 상한(withdrawalPlan.privatePensionMonthlyTarget) 240만원
 *   2. × 12개월 = 세전 2,880만원 — 저율과세 한도(연 1,500만원)를 넘는다
 *   3. 초과 구간의 세부담은 「전액 16.5% 분리과세」와 「연금소득공제·기본공제를 반영한
 *      종합과세」 중 «작은 쪽»이다(calculatePrivatePensionExcessTaxNeededKRW)
 *   4. 세전 − 세액 = 세후 수령액
 *
 * 이 사슬 어디가 끊겨도 화면의 소득 막대와 「세금 급증 구간」 경고가 서로 다른 이야기를 하고,
 * 사용자는 두 숫자의 차이를 계산 오류로 읽는다. 세액은 상수로 박지 않고 세법 함수에서
 * 유도한다 — 이 테스트의 주제는 세율표가 아니라 «사슬이 이어져 있는가»다.
 */
describe('사적연금 저율과세 한도 초과 과세', () => {
  const MONTHLY_CAP = 2_400_000;

  function params(): SimulationParams {
    return {
      userProfile: {
        currentAge: 59,
        retirementAge: 60,
        expectancy: 70,
        targetMonthlySpending: 3_000_000,
      },
      // 일반자산이 없어야 이 해의 사적연금 인출액이 상한 하나로만 결정된다.
      assets: [],
      nationalPension: { expectedMonthlyAmount: 0 },
      privatePensions: [{
        id: 'irp',
        type: 'irp',
        name: 'IRP',
        balance: 500_000_000,
        monthlyContribution: 0,
        totalReturn: 0,
        investmentType: 'etf',
        dividendYield: 0,
        currency: 'KRW',
      }],
      otherIncomes: [],
      inflationRate: 0,
      inflationMode: 'real',
      baseExchangeRate: 1350,
      exchangeScenario: 'base',
      displayCurrency: 'KRW',
      withdrawalPlan: { privatePensionMonthlyTarget: MONTHLY_CAP },
    };
  }

  test('월 상한 240만원은 세전 2,880만원 인출과 그 해의 연금 종합과세로 이어진다', () => {
    const result = new SimulationEngine().run(params());
    const at60 = result.yearlyResults.find((year) => year.age === 60)!;

    const grossAnnual = MONTHLY_CAP * 12;
    expect(at60.privatePensionWithdrawal).toBeCloseTo(grossAnnual, 0);

    // 국민연금이 0이므로 이 해의 연금 과세표준은 사적연금 단독이다.
    const ctx = resolveTaxContext();
    const comprehensive = calculatePensionIncomeTaxKRW(grossAnnual, ctx);
    const separate = grossAnnual * (ctx.profile.privatePensionExcessTaxRate / 100);
    // 이 금액대에서는 종합과세가 유리해야 한다 — 그 비교 자체가 사슬의 3단계다.
    expect(comprehensive).toBeLessThan(separate);

    expect(at60.pensionTaxPaid).toBeCloseTo(comprehensive, 0);
    expect(at60.privatePensionIncome).toBeCloseTo(grossAnnual - comprehensive, 0);
    // 리포트에 찍힌 세후 2,697만원. 만원 단위로 굳힌다.
    expect(Math.round(at60.privatePensionIncome / 10_000)).toBe(2_697);
  });

  /**
   * 「월 평균 73만원 부족」과 「연 2,697만원 수령」은 같은 계획의 두 숫자지만 **서로 뺄 수
   * 없다.** 그 차이를 여기서 굳혀 둔다.
   *
   * 생활비에 쓸 수 있었던 돈은 인출 시점에 원천징수 세율(연금소득세 5.5%)만 뗀 금액이다.
   * 저율과세 한도를 넘긴 부분의 세금은 연말에 «자산에서» 따로 걷힌다
   * (SimulationEngine의 Private pension high tax threshold adjustment). 화면의 소득 막대는
   * 그 연말 정산까지 반영한 «최종» 세후 소득이라, 생활비 충당에 실제로 쓰인 금액보다 작다.
   *
   * 그래서 3,600 − 2,697 = 903만원(월 75만원)이 아니라 3,600 − 2,721.6 = 878.4만원
   * (월 73만원)이 부족분이다. 두 값의 차이는 정확히 연말 추가징수액이다.
   */
  test('부족분은 인출 시점 세후 금액 기준이고, 연말 추가징수액만큼 표시 소득과 벌어진다', () => {
    const result = new SimulationEngine().run(params());
    const at60 = result.yearlyResults.find((year) => year.age === 60)!;

    const grossAnnual = MONTHLY_CAP * 12;
    const ctx = resolveTaxContext();
    const withheld = grossAnnual * getPrivatePensionIncomeTaxRate(60, ctx);
    const yearEndAdjustment = calculatePensionIncomeTaxKRW(grossAnnual, ctx) - withheld;

    expect(yearEndAdjustment).toBeGreaterThan(0);
    expect(at60.shortfall).toBeCloseTo(at60.targetSpending - (grossAnnual - withheld), 0);
    expect(Math.round(at60.shortfall / 12 / 10_000)).toBe(73);
    // 표시 소득과의 격차가 곧 연말 추가징수액이다.
    expect((at60.targetSpending - at60.privatePensionIncome) - at60.shortfall)
      .toBeCloseTo(yearEndAdjustment, 0);
  });

  // 위 격차를 화면이 설명하려면 그 금액이 결과에 실려 나와야 한다. 세법 함수에서 유도한
  // 값과 원장이 실은 값이 같아야 하고, 그 값은 pensionTaxPaid 안에 «이미» 들어 있어야 한다
  // (밖에 있으면 화면의 세금 합계가 이 금액만큼 빈다).
  test('연말 추가징수액이 결과에 실려 나오고 사적연금 세금 합계 안에 들어 있다', () => {
    const result = new SimulationEngine().run(params());
    const at60 = result.yearlyResults.find((year) => year.age === 60)!;

    const grossAnnual = MONTHLY_CAP * 12;
    const ctx = resolveTaxContext();
    const withheld = grossAnnual * getPrivatePensionIncomeTaxRate(60, ctx);
    const expected = calculatePensionIncomeTaxKRW(grossAnnual, ctx) - withheld;

    expect(at60.privatePensionYearEndTaxAdjustment).toBeCloseTo(expected, 0);
    expect(at60.pensionTaxPaid).toBeGreaterThan(at60.privatePensionYearEndTaxAdjustment!);
    expect(at60.pensionTaxPaid - at60.privatePensionYearEndTaxAdjustment!).toBeCloseTo(withheld, 0);
  });

  test('한도를 넘지 않는 해에는 정산액이 0이다', () => {
    const result = new SimulationEngine().run({
      ...params(),
      // 월 100만원 × 12 = 1,200만원 < 저율과세 한도 1,500만원.
      withdrawalPlan: { privatePensionMonthlyTarget: 1_000_000 },
    });
    const at60 = result.yearlyResults.find((year) => year.age === 60)!;

    expect(at60.privatePensionWithdrawal).toBeCloseTo(12_000_000, 0);
    expect(at60.privatePensionYearEndTaxAdjustment).toBe(0);
  });
});
