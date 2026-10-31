import { describe, expect, it } from 'vitest';
import { refreshAgeFromBirthYear } from '@/core/usecases/investmentTracking/refreshAgeFromBirthYear';
import { initialParams } from '@/infrastructure/storage/defaultParams';

describe('출생연도 기준 나이', () => {
  it('연도가 바뀌면 나이를 갱신하고 기준 계획은 그대로 둔다', () => {
    const baseline = { capturedAt: '2026-01-01T00:00:00.000Z', params: structuredClone(initialParams) };
    const params = { ...initialParams, birthYear: 1980, investmentBaseline: baseline };
    expect(refreshAgeFromBirthYear(params, 2026).userProfile.currentAge).toBe(46);
    const next = refreshAgeFromBirthYear(params, 2027);
    expect(next.userProfile.currentAge).toBe(47);
    expect(next.investmentBaseline).toBe(baseline);
  });

  it('출생연도가 없거나 범위가 올바르지 않으면 기존 나이를 유지한다', () => {
    expect(refreshAgeFromBirthYear(initialParams, 2026)).toBe(initialParams);
    for (const birthYear of [2027, 1800, NaN, 1980.5]) {
      const params = { ...initialParams, birthYear };
      expect(refreshAgeFromBirthYear(params, 2026)).toBe(params);
    }
  });
});
