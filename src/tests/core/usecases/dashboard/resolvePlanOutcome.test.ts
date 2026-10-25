import { describe, test, expect } from 'vitest';
import { resolvePlanOutcome } from '@/core/usecases/dashboard/resolvePlanOutcome';
import { SimulationParams, SimulationResult, SimulationYearlyResult } from '@/core/entities/types';
import { makeYearlyResult } from '@/tests/fixtures/yearlyResult';

const params: SimulationParams = {
  userProfile: { currentAge: 51, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3500000 },
  assets: [],
  isaAccounts: [],
  nationalPension: { expectedMonthlyAmount: 2000000 },
  privatePensions: [],
  otherIncomes: [],
  inflationRate: 2,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

function makeResult(yearlyResults: SimulationYearlyResult[], depletionAge: number | null = null): SimulationResult {
  return {
    yearlyResults,
    fireAge: null,
    depletionAge,
    endingAssets: yearlyResults[yearlyResults.length - 1]?.totalAssets ?? 0,
    retirementScore: 70,
    retirementGrade: '보통',
    goalAchievementRate: 80,
    retirementAssetsAtRetirement: 0,
  };
}

// 투자자산(주식/ETF + 연금 + ISA)과 현금을 나눠 채운다. 이 분리가 이 usecase의 전부다.
const year = (age: number, investable: number, cash: number): SimulationYearlyResult =>
  makeYearlyResult({ age, stockAssets: investable, cashAssets: cash, totalAssets: investable + cash });

describe('resolvePlanOutcome - 투자자산 소진', () => {
  // **리뷰에서 지적된 그래프의 V자.** 79세에 투자자산이 모두 팔려 나가고, 이후에는 국민연금이
  // 생활비를 넘어서는 만큼의 잉여가 현금으로 쌓여 총자산이 다시 올라간다. 총자산은 0을 찍지
  // 않으므로 depletionAge는 null이고, 예전 화면은 이 계획을 "안정적인 노후 자산 유지됨"이라
  // 불렀다.
  test('총자산이 유지돼도 투자자산이 0이 된 나이를 잡는다', () => {
    const outcome = resolvePlanOutcome(
      makeResult([
        year(60, 200_000_000, 0),
        year(78, 3_770_000, 0),
        year(79, 0, 100_000),
        year(90, 0, 13_960_000),
      ]),
      params
    );

    expect(outcome.assetStatus).toBe('sustained');
    expect(outcome.investableDepletionAge).toBe(79);
  });

  // 현금만 들고 있는 계획은 이 합이 전 구간 0이다. 가진 적 없는 것은 소진되지 않는다 —
  // 그렇게 판정하면 일어난 적 없는 사건을 알리게 된다.
  test('투자자산을 가진 적이 없으면 소진으로 보지 않는다', () => {
    const outcome = resolvePlanOutcome(
      makeResult([year(60, 0, 300_000_000), year(90, 0, 100_000_000)]),
      params
    );

    expect(outcome.investableDepletionAge).toBeNull();
  });

  // 은퇴 전에는 잔액 0에서 월 납입으로 쌓아 올리는 적립 구간이 정상이다.
  test('은퇴 전 0원 구간은 소진으로 보지 않는다', () => {
    const outcome = resolvePlanOutcome(
      makeResult([
        year(51, 10_000_000, 0),
        year(52, 0, 0), // 은퇴 전 — 소진이 아니다
        year(60, 200_000_000, 0),
        year(90, 100_000_000, 0),
      ]),
      params
    );

    expect(outcome.investableDepletionAge).toBeNull();
  });

  test('투자자산 미보유 계획에서는 소진 나이를 만들지 않는다', () => {
    // 전 구간 0원이면 resolvePlanAssetStatus가 'no_investable_asset'으로 판정한다.
    const outcome = resolvePlanOutcome(makeResult([year(60, 0, 0), year(90, 0, 0)], 60), params);

    expect(outcome.assetStatus).toBe('no_investable_asset');
    expect(outcome.investableDepletionAge).toBeNull();
  });
});

describe('resolvePlanOutcome - 생활비 부족', () => {
  // 자산 고갈과 생활비 부족은 전혀 다른 사건이다. 인출 경로가 잔액을 넘겨 인출하지 않으므로
  // (모든 매도가 Math.min으로 막혀 있다) 매년 굶는 계획도 totalAssets는 0이 되지 않는다.
  test('자산이 남아도 계획한 생활비를 못 채운 구간을 잡는다', () => {
    const outcome = resolvePlanOutcome(
      makeResult([
        year(60, 100_000_000, 0),
        { ...year(67, 90_000_000, 0), unmetSpending: 6_000_000 },
        { ...year(68, 80_000_000, 0), unmetSpending: 6_000_000 },
        year(90, 50_000_000, 0),
      ]),
      params
    );

    expect(outcome.assetStatus).toBe('sustained');
    expect(outcome.investableDepletionAge).toBeNull();
    expect(outcome.spendingShortfall).toEqual({ years: 2, firstAge: 67, lastAge: 68 });
  });

  test('부족한 해가 없으면 null이다', () => {
    const outcome = resolvePlanOutcome(makeResult([year(60, 100_000_000, 0)]), params);

    expect(outcome.spendingShortfall).toBeNull();
  });
});
