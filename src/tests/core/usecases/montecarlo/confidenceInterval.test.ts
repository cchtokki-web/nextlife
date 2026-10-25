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
  const halfWidthAt = (rate: number, trials: number) => {
    const { lower, upper } = wilsonIntervalFromRate(rate, trials);
    return ((upper - lower) / 2) * 100;
  };

  // **문턱이 아니라 「되돌아가지 않음」을 잠근다.**
  //
  // 한때 이 자리에는 「반폭이 표시 단위 1%p보다 작다」가 있었다. 그 기준은 확률이 «홀로»
  // 찍히던 시절의 것이다 — 지금은 신뢰구간을 함께 인쇄하므로 정밀도가 얼마든 사용자가 그것을
  // 보고 판단한다. 그래서 절대 문턱은 의미가 없고, 남은 것은 정밀도와 실행 시간의 맞바꿈이다
  // (DEFAULT_MONTE_CARLO_TRIALS 주석의 실측표).
  //
  // 그 다음에는 「1000회 대비 0.7배 이하」가 있었다. 그것도 걷어낸다 — 아무도 정한 적 없는
  // 문턱인데다 n으로 치면 약 2,200회여서, 예산을 근거로 2,000회를 고르는 «정당한» 결정이
  // 그 선에 0.007 차이로 걸렸다. 테스트가 결정을 막아서는 안 되는 자리다.
  //
  // 남기는 것은 두 방향의 «범위»뿐이다. 아래 둘은 이 상수를 자유롭게 조율하게 두되, 근거
  // 없이 옛 기본값으로 미끄러지거나 대기시간을 무너뜨리는 것만 멈춰 세운다.
  test('기본 시행 수가 예전 1000회로 되돌아가지 않는다', () => {
    expect(DEFAULT_MONTE_CARLO_TRIALS).toBeGreaterThan(1000);
    expect(halfWidthAt(0.9, DEFAULT_MONTE_CARLO_TRIALS)).toBeLessThan(halfWidthAt(0.9, 1000));
  });

  // 반대 방향의 가드. 시행 수를 올리면 옵티마이저가 그만큼 느려지고, 10000회에서는 12.9초라
  // 「멈춘 것 아닌가」로 읽힌다. 정밀도만 보고 무심코 올리는 것을 여기서 멈춰 세운다.
  test('기본 시행 수가 실행 시간 예산 안에 있다', () => {
    expect(DEFAULT_MONTE_CARLO_TRIALS).toBeLessThanOrEqual(5000);
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
