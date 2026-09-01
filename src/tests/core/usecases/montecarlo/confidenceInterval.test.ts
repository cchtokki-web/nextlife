import { describe, expect, test } from 'vitest';
import {
  CONFIDENCE_LEVEL,
  formatConfidenceInterval,
  wilsonInterval,
  wilsonIntervalFromRate,
} from '@/core/usecases/montecarlo/confidenceInterval';
import { DEFAULT_MONTE_CARLO_TRIALS } from '@/core/usecases/montecarlo/volatilityPresets';

// 기대값은 구현이 아니라 Wilson score 공식에서 «독립적으로» 계산했다. 구현이 낸 값을
// 그대로 적어 두면 공식을 잘못 옮겨도 테스트는 통과한다.
describe('wilsonInterval', () => {
  test('10000회 8500성공의 95% 구간은 84.29~85.69%다', () => {
    const { lower, upper } = wilsonInterval(8500, 10000);
    expect(lower).toBeCloseTo(0.842867, 5);
    expect(upper).toBeCloseTo(0.856864, 5);
  });

  test('시행 수가 10배면 폭이 약 √10배 좁아진다', () => {
    const few = wilsonInterval(850, 1000);
    const many = wilsonInterval(8500, 10000);
    const ratio = (few.upper - few.lower) / (many.upper - many.lower);
    // 4.4259%p / 1.3997%p = 3.162 ≈ √10
    expect(ratio).toBeCloseTo(Math.sqrt(10), 1);
  });

  // **이 테스트가 Wald를 막는다.** Wald(p ± z√(p(1−p)/n))는 전 시행 성공에서 폭이 정확히
  // 0이 되어 「100%, 오차 없음」을 주장한다. 누가 공식을 Wald로 바꾸면 여기서 걸린다.
  test('전 시행 성공이어도 폭이 0이 아니다', () => {
    const { lower, upper } = wilsonInterval(10000, 10000);
    expect(upper).toBe(1);
    expect(lower).toBeCloseTo(0.999616, 5);
    expect(upper - lower).toBeGreaterThan(0);
  });

  test('전 시행 실패에서도 대칭으로 동작한다', () => {
    const { lower, upper } = wilsonInterval(0, 10000);
    expect(lower).toBe(0);
    expect(upper).toBeCloseTo(1 - 0.999616, 5);
  });

  test('구간은 언제나 [0, 1] 안에 있다', () => {
    for (const [k, n] of [[1, 10], [9, 10], [0, 5], [5, 5], [3, 7]]) {
      const { lower, upper } = wilsonInterval(k, n);
      expect(lower).toBeGreaterThanOrEqual(0);
      expect(upper).toBeLessThanOrEqual(1);
      expect(lower).toBeLessThanOrEqual(upper);
    }
  });

  test('시행 수가 없거나 값이 유한하지 않으면 NaN을 낸다 — 0이 아니다', () => {
    for (const [k, n] of [[0, 0], [5, -1], [Number.NaN, 100], [5, Number.NaN]]) {
      const { lower, upper } = wilsonInterval(k, n);
      expect(Number.isNaN(lower)).toBe(true);
      expect(Number.isNaN(upper)).toBe(true);
    }
  });

  test('비율로 받아도 같은 구간을 낸다', () => {
    expect(wilsonIntervalFromRate(0.85, 10000)).toEqual(wilsonInterval(8500, 10000));
  });
});

describe('DEFAULT_MONTE_CARLO_TRIALS와 표시 정밀도', () => {
  // 상수를 「10000이다」로 다시 적는 대신, 그 상수를 «고른 이유»를 검사한다. 상수를 되돌리면
  // 이 테스트가 깨지고, 깨진 이유가 곧 되돌리면 안 되는 이유다.
  test('기본 시행 수에서 95% 구간의 반폭이 표시 단위 1%p보다 작다', () => {
    const { lower, upper } = wilsonIntervalFromRate(0.9, DEFAULT_MONTE_CARLO_TRIALS);
    expect(((upper - lower) / 2) * 100).toBeLessThan(1);
  });

  test('예전 기본값 1000회에서는 반폭이 1%p를 넘었다', () => {
    const { lower, upper } = wilsonIntervalFromRate(0.9, 1000);
    expect(((upper - lower) / 2) * 100).toBeGreaterThan(1);
  });
});

describe('formatConfidenceInterval', () => {
  test('신뢰수준과 양 끝을 정수 퍼센트로 인쇄한다', () => {
    expect(formatConfidenceInterval(wilsonInterval(8500, 10000)))
      .toBe('95% 신뢰구간 84~86%');
  });

  test('구간이 한 정수로 뭉개지면 한 자리를 더 보여 준다', () => {
    // 99.9616~100%. 정수로 반올림하면 「100~100%」가 되어 폭이 0이라고 거짓말한다.
    expect(formatConfidenceInterval(wilsonInterval(10000, 10000)))
      .toBe('95% 신뢰구간 100.0~100.0%');
  });

  test('판정 불가면 빈 문자열이 아니라 null이다', () => {
    expect(formatConfidenceInterval({ lower: Number.NaN, upper: Number.NaN })).toBeNull();
  });

  test('신뢰수준 상수가 문구에 실제로 반영된다', () => {
    expect(CONFIDENCE_LEVEL).toBe(0.95);
    expect(formatConfidenceInterval(wilsonInterval(8500, 10000), 0.99)).toContain('99% 신뢰구간');
  });
});
