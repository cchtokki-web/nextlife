import { describe, test, expect } from 'vitest';
import {
  SINGLE_SURVIVOR_SPENDING_FACTOR, SURVIVOR_PENSION_INHERIT_RATE,
  computeHouseholdEndAge, computeSpendingFactor, inheritSurvivorPension, resolveSpouse,
} from '@/core/usecases/spouse/spouseRules';
import { SpouseProfile, UserProfile } from '@/core/entities/types';

const userProfile: UserProfile = {
  currentAge: 50, retirementAge: 60, expectancy: 85, targetMonthlySpending: 3000000,
};

const spouse: SpouseProfile = {
  enabled: true, currentAge: 48, expectancy: 90,
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

// 배우자 명의 국민연금을 다루지 않게 되면서 "본인 것 vs 사망자 것 × 지급률" 비교가
// 사라졌다. 남는 규칙은 승계 하나뿐이다 — 이것까지 지우면 본인 사후 배우자 단독 생존
// 구간의 국민연금 소득이 통째로 0이 되므로 유지한다.
describe('inheritSurvivorPension', () => {
  test('사망자 연금에 지급률을 곱한 금액을 이어받는다', () => {
    expect(inheritSurvivorPension(1000000)).toBe(1000000 * SURVIVOR_PENSION_INHERIT_RATE);
  });

  test('사망자 연금이 없으면 이어받을 것도 없다', () => {
    expect(inheritSurvivorPension(0)).toBe(0);
  });
});
