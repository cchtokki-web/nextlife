import { describe, test, expect } from 'vitest';
import {
  computeShortfallSummary, SHORTFALL_EPSILON_MONTHLY,
} from '@/core/usecases/dashboard/computeShortfallSummary';
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

function makeResult(
  yearlyResults: SimulationYearlyResult[],
  calculatedTargetSpending?: number
): SimulationResult {
  return {
    yearlyResults,
    fireAge: null,
    depletionAge: null,
    endingAssets: 0,
    retirementScore: 0,
    retirementGrade: '보통',
    goalAchievementRate: 100,
    retirementAssetsAtRetirement: 0,
    calculatedTargetSpending,
  };
}

describe('computeShortfallSummary', () => {
  // 목표 월 350만원인데 실제 지출이 월 191만원 → 매년 159만원 부족.
  test('부족 연수·평균 월 부족액·현재 구매력 기준 총액을 집계한다', () => {
    const yearly = [60, 61, 62].map((age) =>
      makeYearlyResult({ age, spending: 1910000 * 12 })
    );

    const { plan } = computeShortfallSummary(makeParams(), makeResult(yearly));

    expect(plan).not.toBeNull();
    expect(plan!.shortfallYears).toBe(3);
    expect(plan!.firstShortfallAge).toBe(60);
    expect(plan!.lastShortfallAge).toBe(62);
    expect(plan!.averageMonthlyShortfall).toBe(1590000);
    // 159만원 × 12개월 × 3년
    expect(plan!.totalShortfallInTodayValue).toBe(1590000 * 12 * 3);
  });

  test('부족한 해가 하나도 없으면 null을 반환한다', () => {
    const yearly = [60, 61, 62].map((age) => makeYearlyResult({ age, spending: 3500000 * 12 }));

    const report = computeShortfallSummary(makeParams(), makeResult(yearly));

    expect(report.plan).toBeNull();
    expect(report.goal).toBeNull();
  });

  // 부족액이 있는 해만 평균의 분모에 넣는다. 은퇴 초반만 부족한 계획에서 전체 은퇴 기간으로
  // 나누면 "월 평균 부족액"이 실제로 겪는 부족보다 작게 보고된다.
  test('부족이 없는 해는 평균과 기간에서 제외한다', () => {
    const yearly = [
      makeYearlyResult({ age: 60, spending: 1500000 * 12 }), // 200만원 부족
      makeYearlyResult({ age: 61, spending: 3500000 * 12 }), // 부족 없음
      makeYearlyResult({ age: 62, spending: 2500000 * 12 }), // 100만원 부족
    ];

    const { plan } = computeShortfallSummary(makeParams(), makeResult(yearly));

    expect(plan!.shortfallYears).toBe(2);
    expect(plan!.averageMonthlyShortfall).toBe(1500000);
    expect(plan!.firstShortfallAge).toBe(60);
    expect(plan!.lastShortfallAge).toBe(62);
  });

  // 명목가치 계획에서는 먼 미래의 부족액이 물가만큼 부풀려진 금액이라, 그대로 더하면
  // "지금 얼마를 준비해야 하는가"를 크게 과장한다.
  test('명목가치 계획은 현재 구매력으로 환산해 합산한다', () => {
    const params = makeParams({ inflationMode: 'nominal', inflationRate: 10 });
    // 목표는 물가에 따라 커지고(연차 10, 11, 12), 실제 지출은 0 → 부족액 = 목표 전액.
    const yearly = [60, 61, 62].map((age) => makeYearlyResult({ age, spending: 0 }));

    const { plan } = computeShortfallSummary(params, makeResult(yearly));

    // 각 해의 명목 부족액을 (1.1)^연차로 나누면 전부 오늘의 350만원 × 12가 된다.
    expect(plan!.totalShortfallInTodayValue).toBeCloseTo(3500000 * 12 * 3, -3);
    // 반면 명목 그대로 더하면 훨씬 크다 — 할인하지 않았다면 이 단정이 깨진다.
    expect(plan!.totalShortfallInTodayValue).toBeLessThan(3500000 * 12 * 3 * 2);
  });

  test('은퇴 전 구간은 집계 대상이 아니다', () => {
    const yearly = [
      makeYearlyResult({ age: 55, spending: 0 }), // 은퇴 전
      makeYearlyResult({ age: 60, spending: 1910000 * 12 }),
    ];

    const { plan } = computeShortfallSummary(makeParams(), makeResult(yearly));

    expect(plan!.shortfallYears).toBe(1);
    expect(plan!.firstShortfallAge).toBe(60);
  });

  // **리포트가 "부족 생활비 월 평균 0원 / 부족 기간 31년"을 찍은 이유.**
  //
  // 이진탐색은 30회 반복으로 수렴하므로 목표와 실제 지출 사이에 늘 수천 원의 잔차가 남는다.
  // 그 잔차를 부족으로 세면 최적화 계획의 은퇴 후 전 구간이 "부족한 해"가 되고, 금액은
  // 표시 단위(만원) 아래라 화면에는 0원으로 찍힌다.
  describe('반올림 잔차', () => {
    test('월 1만원 미만의 부족은 부족한 해로 세지 않는다', () => {
      const params = makeParams({ userProfile: { ...makeParams().userProfile, targetMonthlySpending: 2320000 } });
      // 목표보다 월 3,000원 모자란 지출 — 이진탐색 잔차 수준.
      const yearly = [60, 61, 62].map((age) => makeYearlyResult({ age, spending: 2317000 * 12 }));

      const report = computeShortfallSummary(params, makeResult(yearly));

      expect(report.plan).toBeNull();
      expect(report.goal).toBeNull();
    });

    test('임계값 이상의 부족은 그대로 집계한다', () => {
      const params = makeParams({ userProfile: { ...makeParams().userProfile, targetMonthlySpending: 2320000 } });
      const yearly = [60, 61, 62].map((age) =>
        makeYearlyResult({ age, spending: (2320000 - SHORTFALL_EPSILON_MONTHLY) * 12 })
      );

      const { plan } = computeShortfallSummary(params, makeResult(yearly));

      expect(plan!.shortfallYears).toBe(3);
      expect(plan!.averageMonthlyShortfall).toBe(SHORTFALL_EPSILON_MONTHLY);
    });
  });

  // **목표 기준과 계획 기준을 나눠야 하는 이유.**
  //
  // 「평생 소비 최적화」는 목표 월 350만원을 지속가능한 232만원으로 낮춰 잡는다. 계획 기준으로만
  // 보면 부족이 0이라 "문제 없음"으로 읽히지만, 사용자가 세운 목표에는 월 118만원이 모자란다.
  describe('목표 기준 / 계획 기준 분리', () => {
    const optimizedParams = makeParams({
      spendingStrategy: 'max_sustainable',
      userProfile: { currentAge: 50, retirementAge: 60, expectancy: 62, targetMonthlySpending: 3500000 },
    });

    test('계획대로 쓴 최적화 계획은 계획 기준 부족이 없고 목표 기준 부족만 남는다', () => {
      // 지속가능액 232만원을 그대로 소비 → 계획 기준 부족 0, 목표(350만) 기준 118만원 부족.
      const yearly = [60, 61, 62].map((age) => makeYearlyResult({ age, spending: 2320000 * 12 }));

      const report = computeShortfallSummary(optimizedParams, makeResult(yearly, 2320000));

      expect(report.plan).toBeNull();
      expect(report.goal).not.toBeNull();
      expect(report.goal!.shortfallYears).toBe(3);
      expect(report.goal!.averageMonthlyShortfall).toBe(3500000 - 2320000);
      expect(report.goalMonthlySpending).toBe(3500000);
      expect(report.sustainableMonthlySpending).toBe(2320000);
    });

    test('고정 목표 생활비 계획에서는 두 기준이 같은 값을 낸다', () => {
      const yearly = [60, 61, 62].map((age) => makeYearlyResult({ age, spending: 1910000 * 12 }));

      const report = computeShortfallSummary(makeParams(), makeResult(yearly));

      expect(report.goal).toEqual(report.plan);
    });

    test('지속가능액이 없으면 목표 생활비로 폴백한다', () => {
      const yearly = [60].map((age) => makeYearlyResult({ age, spending: 3500000 * 12 }));

      const report = computeShortfallSummary(makeParams(), makeResult(yearly));

      expect(report.sustainableMonthlySpending).toBe(3500000);
    });
  });
});
