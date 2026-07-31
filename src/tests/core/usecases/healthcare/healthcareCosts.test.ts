import { describe, test, expect } from 'vitest';
import { computeAnnualHealthcareCost } from '@/core/usecases/healthcare/healthcareCosts';
import { HealthcareAssumptions } from '@/core/entities/types';

const healthcare: HealthcareAssumptions = {
  enabled: true,
  costGrowthRate: 5,
  baseMonthlyCost: 300000,
  longTermCareEnabled: false,
  longTermCareStartAge: 80,
  longTermCareMonthlyCost: 1500000,
  shockEnabled: false,
  shockAge: 75,
  shockAmount: 30000000,
};

const call = (patch: Partial<Parameters<typeof computeAnnualHealthcareCost>[0]> = {}) =>
  computeAnnualHealthcareCost({
    healthcare, currentAge: 65, retirementAge: 60, yearsSinceRetirement: 5,
    inflationMode: 'nominal', inflationRate: 2.5, ...patch,
  });

describe('computeAnnualHealthcareCost', () => {
  test('healthcare가 없으면 0이다', () => {
    expect(call({ healthcare: undefined })).toBe(0);
  });

  test('enabled가 false면 0이다', () => {
    expect(call({ healthcare: { ...healthcare, enabled: false } })).toBe(0);
  });

  test('은퇴 전에는 0이다', () => {
    expect(call({ currentAge: 55, yearsSinceRetirement: -5 })).toBe(0);
  });

  test('은퇴 시점에는 기본 월 의료비의 12배다', () => {
    expect(call({ currentAge: 60, yearsSinceRetirement: 0 })).toBe(300000 * 12);
  });

  test('명목 모드에서는 의료비 증가율 전체가 복리로 적용된다', () => {
    // 5년 경과, 연 5% → 300000 * 12 * 1.05^5
    expect(call()).toBeCloseTo(300000 * 12 * Math.pow(1.05, 5), 0);
  });

  test('실질 모드에서는 물가 초과분만 적용된다', () => {
    // 의료비 5% - 물가 2.5% = 초과 2.5%
    const result = call({ inflationMode: 'real' });

    expect(result).toBeCloseTo(300000 * 12 * Math.pow(1.025, 5), 0);
  });

  test('실질 모드에서 의료비 증가율이 물가보다 낮으면 감소한다', () => {
    const result = call({
      inflationMode: 'real',
      healthcare: { ...healthcare, costGrowthRate: 1 }, // 1% - 2.5% = -1.5%
    });

    expect(result).toBeLessThan(300000 * 12);
  });

  test('장기요양 시작 나이 전에는 장기요양비가 붙지 않는다', () => {
    const withLtc = { ...healthcare, longTermCareEnabled: true, longTermCareStartAge: 80 };

    expect(call({ healthcare: withLtc, currentAge: 79, yearsSinceRetirement: 19 }))
      .toBeCloseTo(300000 * 12 * Math.pow(1.05, 19), 0);
  });

  test('장기요양 시작 나이부터 장기요양비가 더해진다', () => {
    const withLtc = { ...healthcare, longTermCareEnabled: true, longTermCareStartAge: 80 };
    const base = 300000 * 12 * Math.pow(1.05, 20);
    const ltc = 1500000 * 12 * Math.pow(1.05, 20);

    expect(call({ healthcare: withLtc, currentAge: 80, yearsSinceRetirement: 20 }))
      .toBeCloseTo(base + ltc, 0);
  });

  test('쇼크는 지정한 나이 한 해에만 발생한다', () => {
    const withShock = { ...healthcare, shockEnabled: true, shockAge: 70 };
    const baseAt10 = 300000 * 12 * Math.pow(1.05, 10);

    expect(call({ healthcare: withShock, currentAge: 70, yearsSinceRetirement: 10 }))
      .toBeCloseTo(baseAt10 + 30000000, 0);
    expect(call({ healthcare: withShock, currentAge: 71, yearsSinceRetirement: 11 }))
      .toBeCloseTo(300000 * 12 * Math.pow(1.05, 11), 0);
  });

  test('쇼크 금액에는 증가율을 적용하지 않는다 (오늘 화폐가치 목돈)', () => {
    const withShock = {
      ...healthcare, shockEnabled: true, shockAge: 70,
      baseMonthlyCost: 0, longTermCareEnabled: false,
    };

    expect(call({ healthcare: withShock, currentAge: 70, yearsSinceRetirement: 10 }))
      .toBe(30000000);
  });
});
