import { describe, test, expect } from 'vitest';
import {
  DEFAULT_SPENDING_BREAKPOINT_AGES,
  describeSpendingCurve,
  resolveSpendingCurve,
  spendingMultiplierForAge,
} from '@/core/usecases/spending/spendingCurve';

describe('resolveSpendingCurve', () => {
  test("'flat'과 미지정은 undefined로 해소된다", () => {
    // 배수 1.0을 곱하는 코드 경로조차 타지 않아야 곡선을 설정한 적 없는 시나리오의 숫자가
    // 비트 단위로 그대로 남는다. 이 계약이 깨지면 회귀는 조용히 일어난다.
    expect(resolveSpendingCurve('flat')).toBeUndefined();
    expect(resolveSpendingCurve(undefined)).toBeUndefined();
  });

  test('배수 개수는 언제나 경계 수 + 1이다', () => {
    for (const shape of ['front_loaded', 'care_heavy'] as const) {
      const curve = resolveSpendingCurve(shape);
      expect(curve).toBeDefined();
      expect(curve!.multipliers.length).toBe(curve!.breakpointAges.length + 1);
    }
  });

  test('활동기 집중형은 감소, 의료·돌봄 대비형은 증가 방향이다', () => {
    const front = resolveSpendingCurve('front_loaded')!;
    expect(front.multipliers[0]).toBeGreaterThan(front.multipliers[front.multipliers.length - 1]);

    const care = resolveSpendingCurve('care_heavy')!;
    expect(care.multipliers[0]).toBeLessThan(care.multipliers[care.multipliers.length - 1]);
  });
});

describe('spendingMultiplierForAge', () => {
  const curve = resolveSpendingCurve('front_loaded')!; // 경계 [70, 80], 배수 [1.2, 1.0, 0.8]

  test('곡선이 없으면 언제나 1이다', () => {
    expect(spendingMultiplierForAge(undefined, 60)).toBe(1);
    expect(spendingMultiplierForAge(undefined, 95)).toBe(1);
  });

  test('경계 나이는 다음 구간의 첫 해다', () => {
    // healthcareCosts의 longTermCareStartAge가 `age >= start`로 판정하는 것과 같은 규약.
    // 두 연령 스케줄이 다른 경계 규칙을 쓰면 같은 나이에 하나만 켜지는 상태가 생긴다.
    expect(spendingMultiplierForAge(curve, 69)).toBe(1.2);
    expect(spendingMultiplierForAge(curve, 70)).toBe(1.0);
    expect(spendingMultiplierForAge(curve, 79)).toBe(1.0);
    expect(spendingMultiplierForAge(curve, 80)).toBe(0.8);
  });

  test('모든 경계보다 큰 나이는 마지막 구간이다', () => {
    expect(spendingMultiplierForAge(curve, 100)).toBe(0.8);
  });

  test('첫 경계보다 이른 나이는 첫 구간이다', () => {
    expect(spendingMultiplierForAge(curve, 55)).toBe(1.2);
  });
});

describe('describeSpendingCurve', () => {
  test('곡선이 없으면 나열할 구간이 없다', () => {
    expect(describeSpendingCurve(undefined, 3_000_000, 60, 90)).toEqual([]);
  });

  test('은퇴 나이부터 시작하는 구간 목록을 만든다', () => {
    const curve = resolveSpendingCurve('front_loaded')!;
    const segments = describeSpendingCurve(curve, 5_000_000, 60, 90);

    expect(segments).toEqual([
      { fromAge: 60, toAge: 69, multiplier: 1.2, monthlyAmount: 6_000_000 },
      { fromAge: 70, toAge: 79, multiplier: 1.0, monthlyAmount: 5_000_000 },
      { fromAge: 80, toAge: null, multiplier: 0.8, monthlyAmount: 4_000_000 },
    ]);
  });

  test('은퇴 나이가 늦으면 이미 지난 경계는 나열하지 않는다', () => {
    // 75세 은퇴자에게 "60대에는 얼마"를 보여줄 이유가 없다.
    const curve = resolveSpendingCurve('front_loaded')!;
    const segments = describeSpendingCurve(curve, 5_000_000, 75, 90);

    expect(segments.map((s) => s.fromAge)).toEqual([75, 80]);
    // 75세는 두 번째 구간(70~79)에 속하므로 배수 1.0이다.
    expect(segments[0].multiplier).toBe(1.0);
  });

  test('기대수명이 마지막 경계보다 이르면 그 경계는 나열하지 않는다', () => {
    const curve = resolveSpendingCurve('front_loaded')!;
    const segments = describeSpendingCurve(curve, 5_000_000, 60, 75);

    expect(segments.map((s) => s.fromAge)).toEqual([60, 70]);
  });

  test('기본 경계는 70·80세다', () => {
    expect(DEFAULT_SPENDING_BREAKPOINT_AGES).toEqual([70, 80]);
  });
});
