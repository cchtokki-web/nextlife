import { describe, test, expect } from 'vitest';
import { describeSuccessRates } from '@/core/usecases/montecarlo/describeSuccessRates';
import { resolveSpendingCurve } from '@/core/usecases/spending/spendingCurve';
import type { SimulationParams } from '@/core/entities/types';
import type { MonteCarloResult } from '@/core/entities/montecarlo';
import { LEGACY_GOAL_CONDITIONS } from '@/tests/fixtures/goalFailure';

type Input = Parameters<typeof describeSuccessRates>[0];
type MonteCarloInput = Input['monteCarlo'];

const formatValue = (value: number) => `${Math.round(value / 10000).toLocaleString()}만원`;

function makeParams(overrides: Partial<SimulationParams> = {}): SimulationParams {
  return {
    userProfile: { currentAge: 50, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3000000 },
    assets: [],
    nationalPension: { expectedMonthlyAmount: 0 },
    privatePensions: [],
    otherIncomes: [],
    inflationRate: 2,
    inflationMode: 'real',
    baseExchangeRate: 1350,
    exchangeScenario: 'base',
    displayCurrency: 'KRW',
    spendingCurve: resolveSpendingCurve('front_loaded'),
    ...overrides,
  };
}

function makeMonteCarlo(overrides: Partial<MonteCarloResult> = {}): MonteCarloInput {
  return {
    plannedMonthlySpending: 3000000,
    successAge: 90,
    goalSuccessProbability: 0.71,
    goalConditions: LEGACY_GOAL_CONDITIONS,
    ...overrides,
  };
}

describe('describeSuccessRates - 생활 유지 성공률 캡션', () => {
  // 이 파일이 생긴 이유. 예전 문구는 「계획 생활비(월 300만원)를 한 해도 줄이지 않은
  // 경우입니다」였는데, 엔진은 연령대별 배수를 곱한 값으로 판정한다. 문구가 기준액 하나만
  // 말해 사용자가 확률을 「300만원을 30년 내내 유지한 비율」로 읽었다.
  test('연령대별 목표 생활비를 구간별로 밝힌다', () => {
    const copy = describeSuccessRates({ monteCarlo: makeMonteCarlo(), params: makeParams(), formatValue });

    // front_loaded = [1, 0.86, 0.76], 경계 [70, 80] → 300 / 258 / 228만원.
    expect(copy.spendingCaption).toBe(
      '설정한 연령별 목표 생활비(60~69세 300만원 · 70~79세 258만원 · 80~90세 228만원)를 한 해도 부족 없이 충당한 경우입니다.'
    );
  });

  // 곡선이 없으면 나열할 구간이 없다 — 오류가 아니라 그 계획에서는 종전 문장이 참이다.
  test('생활비 곡선이 없으면 기준액 한 줄로 말한다', () => {
    const copy = describeSuccessRates({
      monteCarlo: makeMonteCarlo(),
      params: makeParams({ spendingCurve: undefined }),
      formatValue,
    });

    expect(copy.spendingCaption).toBe('계획 생활비(월 300만원)를 한 해도 줄이지 않은 경우입니다.');
  });

  // **기준액은 params가 아니라 결과에서 온다.** 「평생 소비 최적화」 계획에서 판정 기준은
  // 사용자가 입력한 목표가 아니라 엔진이 역산해 고정한 금액이다(freezeSpendingPlan).
  // params의 목표를 쓰면 판정에 쓰이지 않은 금액을 판정 기준이라고 말하게 된다.
  test('기준액은 params의 목표가 아니라 고정된 계획 생활비다', () => {
    const copy = describeSuccessRates({
      monteCarlo: makeMonteCarlo({ plannedMonthlySpending: 2230000 }),
      params: makeParams({ userProfile: { currentAge: 50, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3500000 } }),
      formatValue,
    });

    expect(copy.spendingCaption).toContain('60~69세 223만원');
    expect(copy.spendingCaption).not.toContain('350만원');
  });

  // 은퇴 전에 끝나는 구간은 나열하지 않는다(describeSpendingCurve의 규약). 은퇴가 70세면
  // 첫 구간은 70세부터다.
  test('은퇴 나이가 늦으면 그 뒤 구간만 나열한다', () => {
    const copy = describeSuccessRates({
      monteCarlo: makeMonteCarlo(),
      params: makeParams({ userProfile: { currentAge: 50, retirementAge: 72, expectancy: 90, targetMonthlySpending: 3000000 } }),
      formatValue,
    });

    expect(copy.spendingCaption).toContain('72~79세');
    expect(copy.spendingCaption).not.toContain('60~');
  });
});

describe('describeSuccessRates - 자산 보존 성공률 캡션', () => {
  test('판정 나이와 두 확률이 다른 실패를 센다는 사실을 함께 말한다', () => {
    const copy = describeSuccessRates({ monteCarlo: makeMonteCarlo(), params: makeParams(), formatValue });

    expect(copy.assetCaption).toContain('90세 이전에 금융자산이 0원이 되지 않은 경우입니다.');
    expect(copy.assetCaption).toContain('서로 다른 실패를 셉니다');
  });

  test('판정 나이는 결과의 successAge를 따른다', () => {
    const copy = describeSuccessRates({
      monteCarlo: makeMonteCarlo({ successAge: 100 }),
      params: makeParams(),
      formatValue,
    });

    expect(copy.assetCaption).toContain('100세 이전에');
  });
});

describe('describeSuccessRates - 종합 확률 관계 문장', () => {
  test('두 조건을 함께 판정했으면 그 관계를 밝힌다', () => {
    const copy = describeSuccessRates({ monteCarlo: makeMonteCarlo(), params: makeParams(), formatValue });

    expect(copy.compositeNote).toBe(
      '위 「목표 달성 확률 71%」는 생활비·자산 생존을 «같은 시행에서» 함께 판정한 값입니다 — '
      + '아래 두 비율을 곱하거나 더한 값이 아닙니다.'
    );
  });

  test('기말자산 조건이 있으면 함께 나열한다', () => {
    const copy = describeSuccessRates({
      monteCarlo: makeMonteCarlo({
        goalConditions: { ...LEGACY_GOAL_CONDITIONS, basis: 'selected_goals', terminalAssetGoal: 100000000 },
      }),
      params: makeParams(),
      formatValue,
    });

    expect(copy.compositeNote).toContain('생활비·자산 생존·목표 잔여자산');
  });

  // 조건이 하나뿐이면 「함께 판정했다」는 말이 성립하지 않는다. 없는 관계를 지어내지 않는다.
  test('판정 조건이 하나뿐이면 관계를 말하지 않는다', () => {
    const copy = describeSuccessRates({
      monteCarlo: makeMonteCarlo({
        goalConditions: {
          ...LEGACY_GOAL_CONDITIONS,
          basis: 'selected_goals',
          requireSpendingTarget: true,
          requireAssetSurvival: false,
        },
      }),
      params: makeParams(),
      formatValue,
    });

    expect(copy.compositeNote).toBeNull();
  });

  // **「아래 두 조건을 모두 만족한 비율」이라고 쓰지 않는다.** goalSuccessProbability의
  // 생활비 조건(재구성값 + 월 1만원 엡실론)과 spendingSuccessRate(엔진 원장, 엡실론 없음)
  // 사이에 포함관계가 없다는 것이 spendingShortfall.ts에 실측과 함께 기록돼 있다(AUDIT-003).
  test('두 비율과 판정 술어가 같다고 주장하지 않는다', () => {
    const copy = describeSuccessRates({ monteCarlo: makeMonteCarlo(), params: makeParams(), formatValue });

    expect(copy.compositeNote).not.toContain('모두 만족한 비율');
  });
});
