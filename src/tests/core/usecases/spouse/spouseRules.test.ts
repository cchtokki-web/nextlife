import { describe, test, expect } from 'vitest';
import {
  SINGLE_SURVIVOR_SPENDING_FACTOR, SURVIVOR_PENSION_INHERIT_RATE,
  computeHouseholdEndAge, computeSpendingFactor, computeSpouseNationalPensionMonthly,
  computeSurvivorPensionMonthly, resolveSpouse,
} from '@/core/usecases/spouse/spouseRules';
import { SpouseProfile, UserProfile } from '@/core/entities/types';

const userProfile: UserProfile = {
  currentAge: 50, retirementAge: 60, expectancy: 85, targetMonthlySpending: 3000000,
};

const spouse: SpouseProfile = {
  enabled: true, currentAge: 48, expectancy: 90,
  nationalPensionMonthlyAmount: 800000, nationalPensionStartAge: 65,
};

describe('resolveSpouse', () => {
  test('undefined면 null을 반환한다', () => {
    expect(resolveSpouse(undefined, userProfile)).toBeNull();
  });

  test('enabled가 false면 null을 반환한다', () => {
    expect(resolveSpouse({ ...spouse, enabled: false }, userProfile)).toBeNull();
  });

  test('배우자 사망 시점을 본인 나이로 환산한다', () => {
    // 배우자는 48세, 90세까지 → 42년 후. 그때 본인은 50 + 42 = 92세.
    expect(resolveSpouse(spouse, userProfile)?.deathAtSelfAge).toBe(92);
  });

  test('기대수명이 현재 나이보다 작으면 현재 나이로 클램프한다', () => {
    const invalid = { ...spouse, currentAge: 60, expectancy: 55 };

    const resolved = resolveSpouse(invalid, userProfile);

    expect(resolved?.expectancy).toBe(60);
    expect(resolved?.deathAtSelfAge).toBe(50); // 0년 후 = 지금
  });

  test('수령 개시 나이를 60~70으로 클램프한다', () => {
    expect(resolveSpouse({ ...spouse, nationalPensionStartAge: 55 }, userProfile)?.nationalPensionStartAge).toBe(60);
    expect(resolveSpouse({ ...spouse, nationalPensionStartAge: 99 }, userProfile)?.nationalPensionStartAge).toBe(70);
  });
});

describe('computeHouseholdEndAge', () => {
  test('배우자가 없으면 본인 기대수명이다', () => {
    expect(computeHouseholdEndAge(userProfile, null)).toBe(85);
  });

  test('배우자가 더 오래 살면 그 시점까지 연장한다', () => {
    expect(computeHouseholdEndAge(userProfile, resolveSpouse(spouse, userProfile))).toBe(92);
  });

  test('배우자가 먼저 죽으면 본인 기대수명을 유지한다', () => {
    const shortLived = { ...spouse, currentAge: 48, expectancy: 70 }; // 22년 후 = 본인 72세

    expect(computeHouseholdEndAge(userProfile, resolveSpouse(shortLived, userProfile))).toBe(85);
  });
});

describe('computeSpendingFactor', () => {
  test('둘 다 생존이면 1.0이다', () => {
    expect(computeSpendingFactor(true, true)).toBe(1);
  });

  test('한 명만 생존이면 축소 계수를 적용한다', () => {
    expect(computeSpendingFactor(true, false)).toBe(SINGLE_SURVIVOR_SPENDING_FACTOR);
    expect(computeSpendingFactor(false, true)).toBe(SINGLE_SURVIVOR_SPENDING_FACTOR);
  });

  test('둘 다 사망이면 0이다', () => {
    expect(computeSpendingFactor(false, false)).toBe(0);
  });
});

describe('computeSpouseNationalPensionMonthly', () => {
  test('개시 나이 전에는 0이다', () => {
    const resolved = resolveSpouse(spouse, userProfile)!;
    // 배우자 65세 = 본인 67세. 그 전인 본인 66세에는 0.
    expect(computeSpouseNationalPensionMonthly(resolved, 66)).toBe(0);
  });

  test('개시 나이부터 정상 금액을 받는다 (65세 개시 = 조정계수 1)', () => {
    const resolved = resolveSpouse(spouse, userProfile)!;

    expect(computeSpouseNationalPensionMonthly(resolved, 67)).toBe(800000);
  });

  test('연기 수령이면 가산된 금액을 받는다 (70세 = +36%)', () => {
    const deferred = resolveSpouse({ ...spouse, nationalPensionStartAge: 70 }, userProfile)!;
    // 배우자 70세 = 본인 72세.
    expect(computeSpouseNationalPensionMonthly(deferred, 72)).toBeCloseTo(800000 * 1.36, 5);
  });
});

describe('computeSurvivorPensionMonthly', () => {
  test('본인 연금과 유족연금 중 큰 쪽만 받는다', () => {
    // 사망자 연금 100만 * 0.6 = 60만 < 본인 80만 → 본인 것 유지.
    expect(computeSurvivorPensionMonthly(800000, 1000000)).toBe(800000);
  });

  test('유족연금이 더 크면 유족연금을 받는다', () => {
    // 사망자 200만 * 0.6 = 120만 > 본인 80만.
    expect(computeSurvivorPensionMonthly(800000, 2000000)).toBe(2000000 * SURVIVOR_PENSION_INHERIT_RATE);
  });

  test('본인 연금이 0이어도 유족연금은 받는다', () => {
    expect(computeSurvivorPensionMonthly(0, 1000000)).toBe(600000);
  });
});
