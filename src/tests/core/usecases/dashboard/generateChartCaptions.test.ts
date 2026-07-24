import { describe, test, expect } from 'vitest';
import { generateChartCaptions } from '@/core/usecases/dashboard/generateChartCaptions';
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
    hasTaxWarning: false,
    ...overrides,
  };
}

function makeResult(yearlyResults: SimulationYearlyResult[], overrides: Partial<SimulationResult> = {}): SimulationResult {
  return {
    yearlyResults,
    fireAge: 60,
    depletionAge: null,
    endingAssets: 0,
    retirementScore: 0,
    retirementGrade: '보통',
    goalAchievementRate: 100,
    retirementAssetsAtRetirement: 0,
    ...overrides,
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

describe('generateChartCaptions - 자산 추이 캡션', () => {
  test('자산이 기대수명 전에 고갈되면 고갈 연령을 언급한다', () => {
    const result = makeResult([makeYearlyResult({ age: 80 })], { depletionAge: 80 });
    const captions = generateChartCaptions(result, baseParams);

    expect(captions.assetGrowth).toContain('80세');
    expect(captions.assetGrowth).toContain('고갈');
  });

  test('고갈 없이 국민연금 수령이 시작되면 그 연령을 언급한다', () => {
    const yearlyResults = [
      makeYearlyResult({ age: 60, nationalPensionIncome: 0 }),
      makeYearlyResult({ age: 65, nationalPensionIncome: 12000000 }),
    ];
    const result = makeResult(yearlyResults, { depletionAge: null });
    const captions = generateChartCaptions(result, baseParams);

    expect(captions.assetGrowth).toContain('65세');
    expect(captions.assetGrowth).toContain('국민연금');
  });

  test('고갈도 없고 국민연금도 전혀 없으면 기대수명까지 유지된다는 문구를 반환한다', () => {
    const params: SimulationParams = { ...baseParams, nationalPension: { expectedMonthlyAmount: 0 } };
    const result = makeResult([makeYearlyResult({ age: 60, nationalPensionIncome: 0 })], { depletionAge: null });
    const captions = generateChartCaptions(result, params);

    expect(captions.assetGrowth).toContain('90세');
    expect(captions.assetGrowth).toContain('고갈되지 않');
  });
});

describe('generateChartCaptions - 소득원 구성 캡션', () => {
  test('국민연금 수령이 시작되면 해당 연령과 함께 소득 안정화를 언급한다', () => {
    const yearlyResults = [
      makeYearlyResult({ age: 60, nationalPensionIncome: 0 }),
      makeYearlyResult({ age: 65, nationalPensionIncome: 12000000 }),
    ];
    const result = makeResult(yearlyResults);
    const captions = generateChartCaptions(result, baseParams);

    expect(captions.incomeComposition).toContain('65세');
    expect(captions.incomeComposition).toContain('국민연금');
  });

  test('국민연금이 전혀 없으면 사적연금/배당 등으로 충당한다는 문구를 반환한다', () => {
    const params: SimulationParams = { ...baseParams, nationalPension: { expectedMonthlyAmount: 0 } };
    const result = makeResult([makeYearlyResult({ age: 60, nationalPensionIncome: 0 })]);
    const captions = generateChartCaptions(result, params);

    expect(captions.incomeComposition).toContain('국민연금 없이');
  });
});

describe('generateChartCaptions - 생활비 재원 구성 캡션', () => {
  test('사적연금이 저율과세 한도를 초과하는 연도가 있으면 세금 부담 경고를 반환한다', () => {
    const params: SimulationParams = {
      ...baseParams,
      taxSettings: {
        enableComprehensiveTax: true,
        enableHealthInsurance: true,
        usDividendTaxRate: 15,
        domesticDividendTaxRate: 15.4,
        comprehensiveTaxRate: 15,
        healthInsuranceRate: 5,
        privatePensionLimit: 15000000,
      },
    };
    const result = makeResult([
      makeYearlyResult({ age: 65, privatePensionIncome: 20000000, pensionTaxPaid: 2000000 }),
    ]);
    const captions = generateChartCaptions(result, params);

    expect(captions.spendingComposition).toContain('저율과세');
    expect(captions.spendingComposition).toContain('한도');
  });

  test('한도 초과 위험이 없으면 안정적으로 충당된다는 문구를 반환한다', () => {
    const result = makeResult([makeYearlyResult({ age: 65, privatePensionIncome: 5000000, pensionTaxPaid: 0 })]);
    const captions = generateChartCaptions(result, baseParams);

    expect(captions.spendingComposition).toContain('안정적');
  });
});
