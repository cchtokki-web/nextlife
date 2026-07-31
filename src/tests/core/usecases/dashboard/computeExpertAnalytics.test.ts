import { describe, test, expect } from 'vitest';
import { computeExpertAnalytics } from '@/core/usecases/dashboard/computeExpertAnalytics';
import { SimulationParams, SimulationResult, SimulationYearlyResult } from '@/core/entities/types';

function makeYearlyResult(overrides: Partial<SimulationYearlyResult>): SimulationYearlyResult {
  return {
    age: 60,
    year: 2026,
    totalAssets: 0,
    stockAssets: 0,
    pensionAssets: 0,
    dividendIncome: 0,
    nationalPensionIncome: 0,
    privatePensionIncome: 0,
    pensionIncome: 0,
    otherIncome: 0,
    totalIncome: 0,
    preTaxTotalIncome: 0,
    dividendTaxPaid: 0,
    pensionTaxPaid: 0,
    nationalPensionTaxPaid: 0,
    healthInsurancePaid: 0,
    comprehensiveTaxPaid: 0,
    privatePensionTaxMethod: 'none',
    spending: 0,
    healthcareSpending: 0,
    hasTaxWarning: false,
    spouseAlive: false,
    spendingFactor: 1,
    ...overrides,
  };
}

function makeResult(yearlyResults: SimulationYearlyResult[]): SimulationResult {
  return {
    yearlyResults,
    fireAge: 60,
    depletionAge: null,
    endingAssets: 0,
    retirementScore: 0,
    retirementGrade: '보통',
    goalAchievementRate: 100,
    retirementAssetsAtRetirement: 0,
  };
}

const baseParams: SimulationParams = {
  userProfile: { currentAge: 55, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3000000 },
  assets: [],
  nationalPension: { expectedMonthlyAmount: 1000000 },
  privatePensions: [],
  otherIncomes: [],
  inflationRate: 0,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

describe('computeExpertAnalytics', () => {
  test('은퇴 이후 연도의 세금/건보료/소득 평균을 계산한다', () => {
    const yearlyResults = [
      makeYearlyResult({ age: 59, preTaxTotalIncome: 1000, dividendTaxPaid: 100, healthInsurancePaid: 50, totalIncome: 900 }), // 은퇴 전, 제외
      makeYearlyResult({ age: 60, preTaxTotalIncome: 2000, dividendTaxPaid: 100, pensionTaxPaid: 50, healthInsurancePaid: 30, totalIncome: 1800 }),
      makeYearlyResult({ age: 61, preTaxTotalIncome: 3000, dividendTaxPaid: 200, comprehensiveTaxPaid: 50, healthInsurancePaid: 40, totalIncome: 2700 }),
    ];
    const analytics = computeExpertAnalytics(makeResult(yearlyResults), baseParams);

    expect(analytics.avgPreTaxIncome).toBe(2500); // (2000+3000)/2
    expect(analytics.avgTotalTax).toBe(200); // ((100+50)+(200+50))/2
    expect(analytics.avgHealthInsurance).toBe(35); // (30+40)/2
    expect(analytics.avgNetIncome).toBe(2250); // (1800+2700)/2
  });

  test('국민연금 수령 개시 연령과 은퇴 나이 사이의 공백 연수를 계산한다', () => {
    const yearlyResults = [
      makeYearlyResult({ age: 60, nationalPensionIncome: 0 }),
      makeYearlyResult({ age: 65, nationalPensionIncome: 12000000 }),
    ];
    const analytics = computeExpertAnalytics(makeResult(yearlyResults), baseParams);

    expect(analytics.firstAgeWithNationalPension).toBe(65);
    expect(analytics.pensionGapYears).toBe(5);
  });

  test('국민연금 수령 이력이 전혀 없으면 null이고(65세로 임의 가정하지 않음) 공백 연수도 0이다', () => {
    const analytics = computeExpertAnalytics(makeResult([makeYearlyResult({ age: 60 })]), baseParams);
    expect(analytics.firstAgeWithNationalPension).toBeNull();
    expect(analytics.pensionGapYears).toBe(0);
  });

  test('은퇴 이후 평균 배당소득이 연 500만원을 초과하면 hasSignificantDividends가 true다', () => {
    const analytics = computeExpertAnalytics(
      makeResult([makeYearlyResult({ age: 65, dividendIncome: 6000000 })]),
      baseParams
    );
    expect(analytics.hasSignificantDividends).toBe(true);
  });

  test('은퇴 이후 연도가 전혀 없으면 평균값들은 모두 0이다', () => {
    const analytics = computeExpertAnalytics(makeResult([makeYearlyResult({ age: 50 })]), baseParams);
    expect(analytics.avgPreTaxIncome).toBe(0);
    expect(analytics.avgTotalTax).toBe(0);
    expect(analytics.avgHealthInsurance).toBe(0);
    expect(analytics.avgNetIncome).toBe(0);
    expect(analytics.hasSignificantDividends).toBe(false);
  });
});
