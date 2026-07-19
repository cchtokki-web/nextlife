import { describe, test, expect } from 'vitest';
import { computeLifetimeUtility } from '@/core/usecases/utility/UtilityEngine';
import { SimulationParams, SimulationResult, SimulationYearlyResult } from '@/core/entities/types';

// 60세 은퇴, 95세 기대수명, 월 목표생활비 300만 원 공통 프로필
const userProfile = {
  currentAge: 60,
  retirementAge: 60,
  expectancy: 95,
  targetMonthlySpending: 3000000,
};

const baseParams: SimulationParams = {
  userProfile,
  assets: [],
  nationalPension: { expectedMonthlyAmount: 0 },
  privatePensions: [],
  otherIncomes: [],
  inflationRate: 0,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

const ANNUAL_TARGET = userProfile.targetMonthlySpending * 12; // 3,600만 원

function makeYear(
  age: number,
  overrides: Partial<SimulationYearlyResult> = {}
): SimulationYearlyResult {
  return {
    age,
    year: 2026 + (age - userProfile.currentAge),
    totalAssets: 0,
    stockAssets: 0,
    pensionAssets: 0,
    dividendIncome: 0,
    nationalPensionIncome: 0,
    privatePensionIncome: 0,
    pensionIncome: 0,
    otherIncome: 0,
    totalIncome: ANNUAL_TARGET,
    preTaxTotalIncome: ANNUAL_TARGET,
    dividendTaxPaid: 0,
    pensionTaxPaid: 0,
    nationalPensionTaxPaid: 0,
    healthInsurancePaid: 0,
    comprehensiveTaxPaid: 0,
    spending: ANNUAL_TARGET,
    hasTaxWarning: false,
    ...overrides,
  };
}

function makeResult(yearlyResults: SimulationYearlyResult[], depletionAge: number | null): SimulationResult {
  const last = yearlyResults[yearlyResults.length - 1];
  return {
    yearlyResults,
    fireAge: 60,
    depletionAge,
    endingAssets: last.totalAssets,
    retirementScore: 0,
    retirementGrade: '보통',
    goalAchievementRate: 100,
    retirementAssetsAtRetirement: 0,
  };
}

// 시나리오 A: 고갈형 - 80세에 자산 완전 고갈, 이후 생활비 0
function buildDepletionScenario(): SimulationResult {
  const years: SimulationYearlyResult[] = [];
  for (let age = 60; age <= 95; age++) {
    if (age < 80) {
      years.push(makeYear(age, { totalAssets: 100000000, pensionAssets: 0 }));
    } else {
      years.push(
        makeYear(age, {
          totalAssets: 0,
          pensionAssets: 0,
          spending: 0,
          totalIncome: 0,
          preTaxTotalIncome: 0,
        })
      );
    }
  }
  return makeResult(years, 80);
}

// 시나리오 B: 과다잔여형 - 생활비는 항상 충족하지만 사망 시 연금·자산이 과도하게 남음
function buildExcessLeftoverScenario(): SimulationResult {
  const years: SimulationYearlyResult[] = [];
  for (let age = 60; age <= 95; age++) {
    years.push(makeYear(age, { totalAssets: 600000000, pensionAssets: 600000000 }));
  }
  return makeResult(years, null);
}

// 시나리오 C: 균형형 - 생활비를 항상 충족하고, 사망 시 적정 수준(연금 1년치, 총자산 2년치)만 남음
function buildBalancedScenario(): SimulationResult {
  const years: SimulationYearlyResult[] = [];
  for (let age = 60; age <= 95; age++) {
    years.push(makeYear(age, { totalAssets: ANNUAL_TARGET * 2, pensionAssets: ANNUAL_TARGET }));
  }
  return makeResult(years, null);
}

describe('UtilityEngine.computeLifetimeUtility', () => {
  test('빈 yearlyResults에는 점수와 모든 구성요소가 0이어야 한다', () => {
    const emptyResult = makeResult([makeYear(60)], null);
    emptyResult.yearlyResults = [];
    const utility = computeLifetimeUtility(emptyResult, baseParams);

    expect(utility.score).toBe(0);
    Object.values(utility.components).forEach((v) => expect(v).toBe(0));
  });

  test('균형형(적정 잔액) 전략이 과다잔여형과 고갈형보다 Utility가 높아야 한다', () => {
    const depletion = computeLifetimeUtility(buildDepletionScenario(), baseParams);
    const excessLeftover = computeLifetimeUtility(buildExcessLeftoverScenario(), baseParams);
    const balanced = computeLifetimeUtility(buildBalancedScenario(), baseParams);

    expect(balanced.score).toBeGreaterThan(excessLeftover.score);
    expect(balanced.score).toBeGreaterThan(depletion.score);
  });

  test('사망 시 연금잔액이 과다할수록 pensionUtilization 점수가 낮아진다 (예: 6억 남는 전략 < 1억 남는 전략)', () => {
    const hugeLeftoverResult = makeResult(
      Array.from({ length: 36 }, (_, i) => makeYear(60 + i, { pensionAssets: 600000000, totalAssets: 600000000 })),
      null
    );
    const modestLeftoverResult = makeResult(
      Array.from({ length: 36 }, (_, i) => makeYear(60 + i, { pensionAssets: 100000000, totalAssets: 100000000 })),
      null
    );

    const huge = computeLifetimeUtility(hugeLeftoverResult, baseParams);
    const modest = computeLifetimeUtility(modestLeftoverResult, baseParams);

    expect(modest.components.pensionUtilization).toBeGreaterThan(huge.components.pensionUtilization);
  });

  test('자산 고갈이 없으면 depletionSafety가 만점, 조기 고갈되면 만점보다 낮다', () => {
    const noDepletion = computeLifetimeUtility(buildBalancedScenario(), baseParams);
    const depletion = computeLifetimeUtility(buildDepletionScenario(), baseParams);

    expect(noDepletion.components.depletionSafety).toBeGreaterThan(depletion.components.depletionSafety);
  });

  test('생활비 충족률이 낮을수록(지속적 부족) consumption 점수가 낮아진다', () => {
    const fullyFundedResult = buildBalancedScenario();
    const underfundedResult = makeResult(
      Array.from({ length: 36 }, (_, i) => makeYear(60 + i, { spending: ANNUAL_TARGET * 0.4, totalAssets: ANNUAL_TARGET * 2, pensionAssets: ANNUAL_TARGET })),
      null
    );

    const fullyFunded = computeLifetimeUtility(fullyFundedResult, baseParams);
    const underfunded = computeLifetimeUtility(underfundedResult, baseParams);

    expect(fullyFunded.components.consumption).toBeGreaterThan(underfunded.components.consumption);
  });

  test('구성요소 점수의 합은 score와 일치해야 한다', () => {
    const utility = computeLifetimeUtility(buildBalancedScenario(), baseParams);
    const sum = Object.values(utility.components).reduce((a, b) => a + b, 0);
    expect(utility.score).toBe(sum);
  });

  test('score는 0~100 범위를 벗어나지 않는다', () => {
    const scenarios = [buildDepletionScenario(), buildExcessLeftoverScenario(), buildBalancedScenario()];
    for (const s of scenarios) {
      const utility = computeLifetimeUtility(s, baseParams);
      expect(utility.score).toBeGreaterThanOrEqual(0);
      expect(utility.score).toBeLessThanOrEqual(100);
    }
  });
});
