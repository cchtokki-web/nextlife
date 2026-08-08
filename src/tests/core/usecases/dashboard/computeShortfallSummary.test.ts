import { describe, test, expect } from 'vitest';
import { computeShortfallSummary } from '@/core/usecases/dashboard/computeShortfallSummary';
import { SimulationParams, SimulationResult, SimulationYearlyResult } from '@/core/entities/types';
import { makeYearlyResult } from '@/tests/fixtures/yearlyResult';

// "그래서 내가 얼마를 더 준비해야 하는가"에 답하는 요약. 새 시뮬레이션을 돌리지 않고
// computeMonthlySpendingComposition이 이미 계산한 연도별 부족액을 집계한다.
function makeParams(overrides: Partial<SimulationParams> = {}): SimulationParams {
  return {
    userProfile: { currentAge: 50, retirementAge: 60, expectancy: 62, targetMonthlySpending: 3500000 },
    assets: [],
    nationalPension: { expectedMonthlyAmount: 0 },
    privatePensions: [],
    otherIncomes: [],
    inflationRate: 3,
    inflationMode: 'real',
    baseExchangeRate: 1350,
    exchangeScenario: 'base',
    displayCurrency: 'KRW',
    spendingStrategy: 'target',
    ...overrides,
  };
}

function makeResult(yearlyResults: SimulationYearlyResult[]): SimulationResult {
  return {
    yearlyResults,
    fireAge: null,
    depletionAge: null,
    endingAssets: 0,
    retirementScore: 0,
    retirementGrade: '보통',
    goalAchievementRate: 100,
    retirementAssetsAtRetirement: 0,
    householdEndAge: 62,
  };
}

describe('computeShortfallSummary', () => {
  // 목표 월 350만원인데 실제 지출이 월 191만원 → 매년 159만원 부족.
  test('부족 연수·평균 월 부족액·현재 구매력 기준 총액을 집계한다', () => {
    const yearly = [60, 61, 62].map((age) =>
      makeYearlyResult({ age, spending: 1910000 * 12 })
    );

    const summary = computeShortfallSummary(makeParams(), makeResult(yearly));

    expect(summary).not.toBeNull();
    expect(summary!.shortfallYears).toBe(3);
    expect(summary!.firstShortfallAge).toBe(60);
    expect(summary!.lastShortfallAge).toBe(62);
    expect(summary!.averageMonthlyShortfall).toBe(1590000);
    // 159만원 × 12개월 × 3년
    expect(summary!.totalShortfallInTodayValue).toBe(1590000 * 12 * 3);
  });

  test('부족한 해가 하나도 없으면 null을 반환한다', () => {
    const yearly = [60, 61, 62].map((age) => makeYearlyResult({ age, spending: 3500000 * 12 }));

    expect(computeShortfallSummary(makeParams(), makeResult(yearly))).toBeNull();
  });

  // 부족액이 있는 해만 평균의 분모에 넣는다. 은퇴 초반만 부족한 계획에서 전체 은퇴 기간으로
  // 나누면 "월 평균 부족액"이 실제로 겪는 부족보다 작게 보고된다.
  test('부족이 없는 해는 평균과 기간에서 제외한다', () => {
    const yearly = [
      makeYearlyResult({ age: 60, spending: 1500000 * 12 }), // 200만원 부족
      makeYearlyResult({ age: 61, spending: 3500000 * 12 }), // 부족 없음
      makeYearlyResult({ age: 62, spending: 2500000 * 12 }), // 100만원 부족
    ];

    const summary = computeShortfallSummary(makeParams(), makeResult(yearly));

    expect(summary!.shortfallYears).toBe(2);
    expect(summary!.averageMonthlyShortfall).toBe(1500000);
    expect(summary!.firstShortfallAge).toBe(60);
    expect(summary!.lastShortfallAge).toBe(62);
  });

  // 명목가치 계획에서는 먼 미래의 부족액이 물가만큼 부풀려진 금액이라, 그대로 더하면
  // "지금 얼마를 준비해야 하는가"를 크게 과장한다.
  test('명목가치 계획은 현재 구매력으로 환산해 합산한다', () => {
    const params = makeParams({ inflationMode: 'nominal', inflationRate: 10 });
    // 목표는 물가에 따라 커지고(연차 10, 11, 12), 실제 지출은 0 → 부족액 = 목표 전액.
    const yearly = [60, 61, 62].map((age) => makeYearlyResult({ age, spending: 0 }));

    const summary = computeShortfallSummary(params, makeResult(yearly))!;

    // 각 해의 명목 부족액을 (1.1)^연차로 나누면 전부 오늘의 350만원 × 12가 된다.
    expect(summary.totalShortfallInTodayValue).toBeCloseTo(3500000 * 12 * 3, -3);
    // 반면 명목 그대로 더하면 훨씬 크다 — 할인하지 않았다면 이 단정이 깨진다.
    expect(summary.totalShortfallInTodayValue).toBeLessThan(3500000 * 12 * 3 * 2);
  });

  test('은퇴 전 구간은 집계 대상이 아니다', () => {
    const yearly = [
      makeYearlyResult({ age: 55, spending: 0 }), // 은퇴 전
      makeYearlyResult({ age: 60, spending: 1910000 * 12 }),
    ];

    const summary = computeShortfallSummary(makeParams(), makeResult(yearly))!;

    expect(summary.shortfallYears).toBe(1);
    expect(summary.firstShortfallAge).toBe(60);
  });
});
