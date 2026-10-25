import { describe, test, expect } from 'vitest';
import { PRIVATE_PENSION_MIN_START_AGE, clampPrivatePensionStartAge } from '@/core/usecases/pension/privatePensionRules';

describe('clampPrivatePensionStartAge', () => {
  test('55세 미만은 55세로 올림 clamp된다', () => {
    expect(clampPrivatePensionStartAge(54)).toBe(55);
    expect(clampPrivatePensionStartAge(0)).toBe(55);
  });

  test('55세는 그대로 55세다', () => {
    expect(clampPrivatePensionStartAge(55)).toBe(55);
  });

  test('55세 초과 값은 그대로 유지된다', () => {
    expect(clampPrivatePensionStartAge(60)).toBe(60);
    expect(clampPrivatePensionStartAge(70)).toBe(70);
  });

  test('PRIVATE_PENSION_MIN_START_AGE는 55다', () => {
    expect(PRIVATE_PENSION_MIN_START_AGE).toBe(55);
  });
});
