import { describe, test, expect } from 'vitest';
import { percentileOfSorted } from '@/core/usecases/montecarlo/statistics';

describe('percentileOfSorted', () => {
  test('0분위는 최소값, 1분위는 최대값이다', () => {
    const sorted = [1, 2, 3, 4, 5];

    expect(percentileOfSorted(sorted, 0)).toBe(1);
    expect(percentileOfSorted(sorted, 1)).toBe(5);
  });

  test('중앙값을 선형보간으로 구한다', () => {
    expect(percentileOfSorted([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentileOfSorted([1, 2, 3, 4], 0.5)).toBe(2.5);
  });

  test('임의 분위를 선형보간한다', () => {
    // 인덱스 = q × (n − 1) = 0.25 × 4 = 1 → 정확히 두 번째 원소
    expect(percentileOfSorted([0, 10, 20, 30, 40], 0.25)).toBe(10);
    // 인덱스 = 0.1 × 4 = 0.4 → 0과 10 사이의 40%
    expect(percentileOfSorted([0, 10, 20, 30, 40], 0.1)).toBeCloseTo(4, 10);
  });

  test('원소가 하나면 항상 그 값이다', () => {
    expect(percentileOfSorted([7], 0)).toBe(7);
    expect(percentileOfSorted([7], 0.5)).toBe(7);
    expect(percentileOfSorted([7], 1)).toBe(7);
  });

  test('빈 배열은 NaN을 준다', () => {
    // 던지지 않는 이유: 시행이 전부 실패한 경우에도 화면이 죽는 대신 "값 없음"으로
    // 표현될 수 있어야 한다. 호출부가 Number.isFinite로 거른다.
    expect(percentileOfSorted([], 0.5)).toBeNaN();
  });

  test('분위가 범위를 벗어나면 양 끝으로 clamp한다', () => {
    expect(percentileOfSorted([1, 2, 3], -0.5)).toBe(1);
    expect(percentileOfSorted([1, 2, 3], 1.5)).toBe(3);
  });

  test('p10 ≤ p50 ≤ p90이 항상 성립한다', () => {
    const sorted = Array.from({ length: 1000 }, (_, i) => i * 3);

    const p10 = percentileOfSorted(sorted, 0.1);
    const p50 = percentileOfSorted(sorted, 0.5);
    const p90 = percentileOfSorted(sorted, 0.9);

    expect(p10).toBeLessThanOrEqual(p50);
    expect(p50).toBeLessThanOrEqual(p90);
  });
});
