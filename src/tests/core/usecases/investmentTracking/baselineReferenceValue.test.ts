import { describe, expect, it } from 'vitest';
import { baselineReferenceValue } from '@/core/usecases/investmentTracking/baselineReferenceValue';

describe('기준 수량 시세 참고값', () => {
  it('동일 통화의 수량과 단가만 곱한다', () => {
    expect(baselineReferenceValue(2.5, 'USD', 100, 'USD')).toBe(250);
    expect(baselineReferenceValue(0, 'KRW', 100, 'KRW')).toBe(0);
  });
  it('통화가 다르거나 유효하지 않은 값은 계산하지 않는다', () => {
    expect(baselineReferenceValue(10, 'USD', 100, 'KRW')).toBeNull();
    expect(baselineReferenceValue(-1, 'USD', 100, 'USD')).toBeNull();
    expect(baselineReferenceValue(1, 'USD', 0, 'USD')).toBeNull();
    expect(baselineReferenceValue(Infinity, 'USD', 100, 'USD')).toBeNull();
    expect(baselineReferenceValue(Number.MAX_VALUE, 'USD', Number.MAX_VALUE, 'USD')).toBeNull();
  });
});
