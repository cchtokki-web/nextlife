import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { SINGLE_SURVIVOR_SPENDING_FACTOR } from '@/core/usecases/spouse/spouseRules';
import { SimulationParams } from '@/core/entities/types';

const baseParams: SimulationParams = {
  userProfile: { currentAge: 60, retirementAge: 60, expectancy: 80, targetMonthlySpending: 2000000 },
  assets: [],
  nationalPension: { expectedMonthlyAmount: 1000000 },
  privatePensions: [
    { id: 'p1', type: 'irp', balance: 500000000, monthlyContribution: 0, annualReturn: 0, currency: 'KRW' },
  ],
  otherIncomes: [],
  inflationRate: 0,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

describe('SimulationEngine 배우자 통합', () => {
  test('spouse가 없으면 결과가 기존과 완전히 동일하다', () => {
    const engine = new SimulationEngine();

    const withoutField = engine.run(baseParams);
    const withUndefined = engine.run({ ...baseParams, spouse: undefined });

    expect(withUndefined).toEqual(withoutField);
  });

  test('spouse.enabled가 false면 결과가 기존과 완전히 동일하다', () => {
    const engine = new SimulationEngine();

    const baseline = engine.run(baseParams);
    const disabled = engine.run({
      ...baseParams,
      spouse: {
        enabled: false, currentAge: 58, expectancy: 95,
        nationalPensionMonthlyAmount: 900000, nationalPensionStartAge: 65,
      },
    });

    expect(disabled).toEqual(baseline);
  });

  test('배우자가 더 오래 살면 시뮬레이션이 그 시점까지 연장된다', () => {
    const engine = new SimulationEngine();

    const result = engine.run({
      ...baseParams,
      spouse: {
        enabled: true, currentAge: 60, expectancy: 90, // 30년 후 = 본인 90세
        nationalPensionMonthlyAmount: 0, nationalPensionStartAge: 65,
      },
    });

    expect(result.yearlyResults[result.yearlyResults.length - 1].age).toBe(90);
  });

  test('배우자 국민연금이 본인 것과 합산된다', () => {
    const engine = new SimulationEngine();

    const solo = engine.run(baseParams);
    const couple = engine.run({
      ...baseParams,
      spouse: {
        enabled: true, currentAge: 60, expectancy: 80,
        nationalPensionMonthlyAmount: 500000, nationalPensionStartAge: 65,
      },
    });

    const at70 = (r: typeof solo) => r.yearlyResults.find((y) => y.age === 70)!;
    expect(at70(couple).nationalPensionIncome).toBeGreaterThan(at70(solo).nationalPensionIncome);
  });

  test('본인이 아직 수령 개시 전이어도 이미 개시한 배우자 국민연금은 지급된다', () => {
    const engine = new SimulationEngine();

    // 본인은 60세(개시 나이 65 전)지만 배우자는 68세로 이미 수령 중이다.
    const result = engine.run({
      ...baseParams,
      spouse: {
        enabled: true, currentAge: 68, expectancy: 88,
        nationalPensionMonthlyAmount: 500000, nationalPensionStartAge: 65,
      },
    });

    const at62 = result.yearlyResults.find((y) => y.age === 62)!;

    expect(at62.nationalPensionIncome).toBeGreaterThan(0);
  });

  test('배우자 사망 후 생활비가 축소 계수만큼 줄어든다', () => {
    const engine = new SimulationEngine();

    const result = engine.run({
      ...baseParams,
      userProfile: { ...baseParams.userProfile, expectancy: 80 },
      spouse: {
        enabled: true, currentAge: 60, expectancy: 70, // 10년 후 = 본인 70세 사망
        nationalPensionMonthlyAmount: 0, nationalPensionStartAge: 65,
      },
    });

    const before = result.yearlyResults.find((y) => y.age === 69)!;
    const after = result.yearlyResults.find((y) => y.age === 75)!;

    expect(before.spouseAlive).toBe(true);
    expect(after.spouseAlive).toBe(false);
    expect(after.spending).toBeCloseTo(before.spending * SINGLE_SURVIVOR_SPENDING_FACTOR, 0);
  });

  test('본인 사망 후에도 배우자 생존 기간에는 생활비가 계속 발생한다', () => {
    const engine = new SimulationEngine();

    const result = engine.run({
      ...baseParams,
      userProfile: { ...baseParams.userProfile, expectancy: 70 },
      spouse: {
        enabled: true, currentAge: 60, expectancy: 85, // 25년 후 = 본인 85세
        nationalPensionMonthlyAmount: 0, nationalPensionStartAge: 65,
      },
    });

    const afterSelfDeath = result.yearlyResults.find((y) => y.age === 80)!;

    expect(afterSelfDeath.spending).toBeGreaterThan(0);
    expect(afterSelfDeath.spouseAlive).toBe(true);
  });
});
