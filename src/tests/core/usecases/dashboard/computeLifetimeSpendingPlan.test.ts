import { describe, test, expect } from 'vitest';
import { computeLifetimeSpendingPlan } from '@/core/usecases/dashboard/computeLifetimeSpendingPlan';
import { resolveSpendingCurve } from '@/core/usecases/spending/spendingCurve';
import { DEFAULT_RETIREMENT_STRATEGY } from '@/core/usecases/strategy/compileStrategy';
import { SimulationParams, SimulationResult } from '@/core/entities/types';

const baseParams = {
  userProfile: { currentAge: 60, retirementAge: 65, expectancy: 90, targetMonthlySpending: 3_000_000 },
  assets: [],
  nationalPension: { expectedMonthlyAmount: 0 },
  privatePensions: [],
  otherIncomes: [],
  spendingStrategy: 'max_sustainable',
  displayCurrency: 'KRW',
  baseExchangeRate: 1350,
} as unknown as SimulationParams;

const resultWith = (calculatedTargetSpending: number | undefined): SimulationResult =>
  ({ calculatedTargetSpending, yearlyResults: [] } as unknown as SimulationResult);

const params = (patch: Partial<SimulationParams>): SimulationParams => ({ ...baseParams, ...patch });

describe('computeLifetimeSpendingPlan', () => {
  test('평생 소비 최적화가 아니면 null이다', () => {
    // 기능 부재이지 계산 실패가 아니다 — 호출부는 배너를 그리지 않는 것이 정답이다.
    for (const strategy of ['target', 'dividend_only', undefined] as const) {
      expect(computeLifetimeSpendingPlan(params({ spendingStrategy: strategy }), resultWith(5_000_000)))
        .toBeNull();
    }
  });

  test('이진탐색이 0으로 수렴하면 null이다', () => {
    // "월 0원까지 쓸 수 있습니다"는 조언이 아니라 소음이다. 이 가드를 지우면 붕괴한 계획에
    // 대해 금액 0짜리 배너가 뜬다(그 상황은 고갈 경고가 이미 담당한다).
    expect(computeLifetimeSpendingPlan(baseParams, resultWith(0))).toBeNull();
    expect(computeLifetimeSpendingPlan(baseParams, resultWith(undefined))).toBeNull();
    // 붕괴값이 정확히 0이 아니라 0.37원인 경우도 있다 — 그래도 배너를 띄울 금액은 아니다.
    expect(computeLifetimeSpendingPlan(baseParams, resultWith(0.37))?.baseMonthly).toBe(0.37);
  });

  test('곡선이 없으면 구간 목록이 비고, 그것은 오류가 아니다', () => {
    const plan = computeLifetimeSpendingPlan(baseParams, resultWith(5_000_000));

    expect(plan).not.toBeNull();
    expect(plan!.segments).toEqual([]);
    expect(plan!.baseMonthly).toBe(5_000_000);
  });

  test('곡선이 있으면 은퇴 나이부터 구간을 펼친다', () => {
    const plan = computeLifetimeSpendingPlan(
      params({ spendingCurve: resolveSpendingCurve('front_loaded') }),
      resultWith(5_000_000)
    );

    // 경계 [70, 80], 은퇴 65세 → 65~69 / 70~79 / 80~
    expect(plan!.segments.map((s) => [s.fromAge, s.toAge])).toEqual([[65, 69], [70, 79], [80, null]]);
    expect(plan!.segments[0].monthlyAmount).toBeGreaterThan(plan!.segments[2].monthlyAmount);
  });

  test('최소 생활비 경고는 기준액이 아니라 구간 최저액으로 판정한다', () => {
    // 활동기 집중형에서 60대는 넉넉해도 80대가 최소선 아래로 내려갈 수 있다. 사용자가
    // 걱정하는 것은 그 구간이므로, 기준액으로 판정하면 정작 문제인 경우를 놓친다.
    // 기준액 500만 → 80대는 400만이다. 최소 생활비 450만이면 경고해야 한다.
    const withMinimum = params({
      spendingCurve: resolveSpendingCurve('front_loaded'),
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, minMonthlySpending: 4_500_000 },
    });

    const plan = computeLifetimeSpendingPlan(withMinimum, resultWith(5_000_000));

    expect(plan!.belowMinimum).toEqual({ minMonthlySpending: 4_500_000, lowestMonthly: 4_000_000 });
  });

  test('모든 구간이 최소 생활비 이상이면 경고하지 않는다', () => {
    const plan = computeLifetimeSpendingPlan(
      params({
        spendingCurve: resolveSpendingCurve('front_loaded'),
        strategy: { ...DEFAULT_RETIREMENT_STRATEGY, minMonthlySpending: 3_000_000 },
      }),
      resultWith(5_000_000)
    );

    expect(plan!.belowMinimum).toBeUndefined();
  });

  test('최소 생활비 미지정·0은 경고 없음이다', () => {
    // undefined가 "경고 없음"이라는 유효한 상태다(DEFAULT_RETIREMENT_STRATEGY가 일부러
    // 메우지 않는다). 0으로 폴백해 판정하면 "월 0원 미만"이라는 무의미한 비교가 된다.
    for (const min of [undefined, 0]) {
      const plan = computeLifetimeSpendingPlan(
        params({ strategy: { ...DEFAULT_RETIREMENT_STRATEGY, minMonthlySpending: min } }),
        resultWith(1)
      );

      expect(plan!.belowMinimum).toBeUndefined();
    }
  });
});
