import { describe, test, expect } from 'vitest';
import {
  getNationalPensionAdjustmentFactor,
  NATIONAL_PENSION_NORMAL_START_AGE,
  NATIONAL_PENSION_EARLY_MIN_AGE,
  NATIONAL_PENSION_DEFERRED_MAX_AGE,
} from '@/core/usecases/pension/nationalPensionRules';

describe('getNationalPensionAdjustmentFactor', () => {
  test('정상수급개시연령(65세)은 계수 1.0', () => {
    expect(getNationalPensionAdjustmentFactor(NATIONAL_PENSION_NORMAL_START_AGE)).toBeCloseTo(1.0);
  });

  test('최대 조기수령(60세)은 30% 감액(계수 0.7)', () => {
    expect(getNationalPensionAdjustmentFactor(NATIONAL_PENSION_EARLY_MIN_AGE)).toBeCloseTo(0.7);
  });

  test('최대 연기수령(70세)은 36% 가산(계수 1.36)', () => {
    expect(getNationalPensionAdjustmentFactor(NATIONAL_PENSION_DEFERRED_MAX_AGE)).toBeCloseTo(1.36);
  });

  test('조기수령 중간값(62세)은 월 0.5%씩 36개월 감액(계수 0.82)', () => {
    expect(getNationalPensionAdjustmentFactor(62)).toBeCloseTo(0.82);
  });

  test('연기수령 중간값(68세)은 월 0.6%씩 36개월 가산(계수 1.216)', () => {
    expect(getNationalPensionAdjustmentFactor(68)).toBeCloseTo(1.216);
  });

  test('유효 범위(60~70) 밖의 값은 경계값으로 클램프된다', () => {
    expect(getNationalPensionAdjustmentFactor(55)).toBeCloseTo(0.7);
    expect(getNationalPensionAdjustmentFactor(75)).toBeCloseTo(1.36);
  });
});
