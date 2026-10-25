import { describe, expect, test } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import {
  getNationalPensionAdjustmentFactor,
  NATIONAL_PENSION_DEFERRED_MAX_AGE,
  NATIONAL_PENSION_EARLY_MIN_AGE,
  NATIONAL_PENSION_NORMAL_START_AGE,
} from '@/core/usecases/pension/nationalPensionRules';
import { calculateStatutoryPensionWithdrawalLimit } from '@/core/usecases/pension/privatePensionRules';
import { retirementParams } from './fixtures';

describe('retirement-domain-invariants / national pension', () => {
  test('수령 시작 전 국민연금 소득은 0이다', () => {
    const result = new SimulationEngine().run(retirementParams({
      userProfile: {
        currentAge: 60,
        retirementAge: 60,
        expectancy: 66,
        targetMonthlySpending: 2_000_000,
      },
      withdrawalPlan: { nationalPensionStartAge: 65 },
    }));

    expect(result.yearlyResults
      .filter((year) => year.age < 65)
      .every((year) => year.nationalPensionIncome === 0)).toBe(true);
    expect(result.yearlyResults.find((year) => year.age === 65)?.nationalPensionIncome)
      .toBeGreaterThan(0);
  });

  // 예전 이 테스트는 `factor(조기) <= factor(65)`만 확인했다. 그 부등식은 감액을 **전부
  // 없애도**(모든 계수가 1.0) 성립하므로, 조기수령 규칙을 통째로 지워도 통과했다.
  // 계수를 실제 값과 단조성으로 고정한다.
  test('정상 개시 나이의 계수는 정확히 1이다', () => {
    expect(getNationalPensionAdjustmentFactor(NATIONAL_PENSION_NORMAL_START_AGE)).toBe(1);
  });

  test('조기수령은 1개월당 0.5%씩 실제로 감액된다', () => {
    // 5년(60개월) 조기 = 30% 감액.
    expect(getNationalPensionAdjustmentFactor(NATIONAL_PENSION_EARLY_MIN_AGE))
      .toBeCloseTo(1 - 0.005 * 60, 10);

    // 나이가 이를수록 계수는 **엄격히** 작아져야 한다.
    for (let age = NATIONAL_PENSION_EARLY_MIN_AGE; age < NATIONAL_PENSION_NORMAL_START_AGE; age += 1) {
      expect(getNationalPensionAdjustmentFactor(age))
        .toBeLessThan(getNationalPensionAdjustmentFactor(age + 1));
    }
  });

  test('연기수령은 1개월당 0.6%씩 실제로 가산된다', () => {
    // 5년(60개월) 연기 = 36% 가산.
    expect(getNationalPensionAdjustmentFactor(NATIONAL_PENSION_DEFERRED_MAX_AGE))
      .toBeCloseTo(1 + 0.006 * 60, 10);

    for (let age = NATIONAL_PENSION_NORMAL_START_AGE; age < NATIONAL_PENSION_DEFERRED_MAX_AGE; age += 1) {
      expect(getNationalPensionAdjustmentFactor(age))
        .toBeLessThan(getNationalPensionAdjustmentFactor(age + 1));
    }
  });

  test('법정 범위를 벗어난 청구 나이는 경계 계수로 고정된다', () => {
    expect(getNationalPensionAdjustmentFactor(55))
      .toBe(getNationalPensionAdjustmentFactor(NATIONAL_PENSION_EARLY_MIN_AGE));
    expect(getNationalPensionAdjustmentFactor(80))
      .toBe(getNationalPensionAdjustmentFactor(NATIONAL_PENSION_DEFERRED_MAX_AGE));
  });

  test('조기수령 계수는 시뮬레이션의 실제 연금액에 반영된다', () => {
    // 계수 함수만 맞고 엔진이 그것을 쓰지 않으면 의미가 없다. 두 시나리오의 실제 수령액을 본다.
    const base = {
      currentAge: 60, retirementAge: 60, expectancy: 72, targetMonthlySpending: 2_000_000,
    };
    const engine = new SimulationEngine();
    const early = engine.run(retirementParams({
      userProfile: base, withdrawalPlan: { nationalPensionStartAge: 60 },
    }));
    const normal = engine.run(retirementParams({
      userProfile: base, withdrawalPlan: { nationalPensionStartAge: 65 },
    }));

    const at = (r: ReturnType<SimulationEngine['run']>, age: number) =>
      r.yearlyResults.find((year) => year.age === age)!.nationalPensionIncome;

    expect(at(early, 66)).toBeGreaterThan(0);
    expect(at(normal, 66)).toBeGreaterThan(0);
    // 60세 개시는 30% 감액되므로 65세 개시보다 확실히 적어야 한다.
    expect(at(early, 66)).toBeLessThan(at(normal, 66));

    // **세후 비율은 계수(0.70)보다 반드시 크다.**
    //
    // nationalPensionIncome은 세후 금액인데(types.ts: "연간 세후 국민연금 수령액")
    // 연금소득세는 연금소득공제와 누진세율을 쓰므로, 금액이 작은 조기수령 쪽의 실효세율이
    // 더 낮다. 실측(현행 세법 기준): 세전 8,400,000 / 12,000,000 = 정확히 0.700,
    // 실효세율 1.351% vs 2.530%, 세후 8,286,480 / 11,696,400 = 0.7085.
    //
    // 즉 "조기수령하면 30% 깎인다"는 세전 기준이고, 손에 쥐는 돈 기준으로는 약 29.2%다.
    // 이 부등식 자체는 세법 수치가 바뀌어도 누진성이 유지되는 한 성립한다.
    const afterTaxRatio = at(early, 66) / at(normal, 66);
    expect(afterTaxRatio).toBeGreaterThan(1 - 0.005 * 60);
    expect(afterTaxRatio).toBeCloseTo(0.7085, 3);
  });
});

describe('retirement-domain-invariants / statutory private-pension limit', () => {
  test('연금수령 1년차 한도는 과세기간 개시일 평가액의 12%다', () => {
    const result = calculateStatutoryPensionWithdrawalLimit(100_000_000, 1);

    expect(result.status).toBe('limited');
    expect(result.annualLimit).toBeCloseTo(12_000_000, 6);
  });

  test('연금수령 10년차까지 법정 공식을 적용한다', () => {
    const result = calculateStatutoryPensionWithdrawalLimit(100_000_000, 10);

    expect(result.status).toBe('limited');
    expect(result.annualLimit).toBeCloseTo(120_000_000, 6);
  });

  test('연금수령연차가 11년 이상이면 공식상 한도를 적용하지 않는다', () => {
    expect(calculateStatutoryPensionWithdrawalLimit(100_000_000, 11)).toEqual({
      status: 'not_limited',
      annualLimit: null,
    });
  });

  test('평가액과 연금수령연차를 임의 보정하지 않는다', () => {
    expect(() => calculateStatutoryPensionWithdrawalLimit(-1, 1)).toThrow(RangeError);
    expect(() => calculateStatutoryPensionWithdrawalLimit(100_000_000, 0)).toThrow(RangeError);
  });
});
