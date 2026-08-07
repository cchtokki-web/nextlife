import { describe, test, expect } from 'vitest';
import { generateChartCaptions } from '@/core/usecases/dashboard/generateChartCaptions';
import { SimulationParams, SimulationResult, SimulationYearlyResult } from '@/core/entities/types';
import { makeYearlyResult } from '@/tests/fixtures/yearlyResult';

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
    householdEndAge: 90,
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

// 캡션은 "고갈 / 미보유 / 유지"를 가르는데, 그 판정은 연도별 totalAssets를 근거로 한다
// (resolvePlanAssetStatus). makeYearlyResult의 기본값이 0이라, 자산이 있는 계획을 다루는
// 테스트는 반드시 그 값을 명시해야 한다 — 그러지 않으면 전부 '투자자산 미보유'가 된다.
const HAS_ASSETS = 100000000;

describe('generateChartCaptions - 자산 추이 캡션', () => {
  test('자산이 기대수명 전에 고갈되면 고갈 연령을 언급한다', () => {
    const result = makeResult(
      [makeYearlyResult({ age: 60, totalAssets: HAS_ASSETS }), makeYearlyResult({ age: 80, totalAssets: 0 })],
      { depletionAge: 80 }
    );
    const captions = generateChartCaptions(result, baseParams);

    expect(captions.assetGrowth).toContain('80세');
    expect(captions.assetGrowth).toContain('고갈');
  });

  test('고갈 없이 국민연금 수령이 시작되면 그 연령을 언급한다', () => {
    const yearlyResults = [
      makeYearlyResult({ age: 60, nationalPensionIncome: 0, totalAssets: HAS_ASSETS }),
      makeYearlyResult({ age: 65, nationalPensionIncome: 12000000, totalAssets: HAS_ASSETS }),
    ];
    const result = makeResult(yearlyResults, { depletionAge: null });
    const captions = generateChartCaptions(result, baseParams);

    expect(captions.assetGrowth).toContain('65세');
    expect(captions.assetGrowth).toContain('국민연금');
  });

  test('고갈도 없고 국민연금도 전혀 없으면 기대수명까지 유지된다는 문구를 반환한다', () => {
    const params: SimulationParams = { ...baseParams, nationalPension: { expectedMonthlyAmount: 0 } };
    const result = makeResult(
      [makeYearlyResult({ age: 60, nationalPensionIncome: 0, totalAssets: HAS_ASSETS })],
      { depletionAge: null }
    );
    const captions = generateChartCaptions(result, params);

    expect(captions.assetGrowth).toContain('90세');
    expect(captions.assetGrowth).toContain('고갈되지 않');
  });

  // 시뮬레이션은 "둘 중 늦게 사망하는 쪽"까지 돌기 때문에 depletionAge가 본인 기대수명보다
  // 클 수 있다. 본인 기대수명과 비교하면 배우자 단독 생존 구간의 파산이 통째로 숨는다.
  test('본인 기대수명 이후·가구 종료 나이 이전에 고갈되면 고갈 연령을 언급한다', () => {
    const params: SimulationParams = {
      ...baseParams,
      userProfile: { ...baseParams.userProfile, expectancy: 75 },
    };
    const result = makeResult(
      [makeYearlyResult({ age: 60, totalAssets: HAS_ASSETS }), makeYearlyResult({ age: 76, totalAssets: 0 })],
      { depletionAge: 76, householdEndAge: 100 }
    );
    const captions = generateChartCaptions(result, params);

    expect(captions.assetGrowth).toContain('76세');
    expect(captions.assetGrowth).toContain('고갈');
    expect(captions.assetGrowth).not.toContain('고갈되지 않');
  });

  test('배우자가 더 오래 살면 유지 문구도 가구 종료 나이를 기준으로 말한다', () => {
    const params: SimulationParams = {
      ...baseParams,
      nationalPension: { expectedMonthlyAmount: 0 },
      userProfile: { ...baseParams.userProfile, expectancy: 75 },
    };
    const result = makeResult(
      [makeYearlyResult({ age: 60, nationalPensionIncome: 0, totalAssets: HAS_ASSETS })],
      { depletionAge: null, householdEndAge: 100 }
    );
    const captions = generateChartCaptions(result, params);

    expect(captions.assetGrowth).toContain('100세');
    expect(captions.assetGrowth).not.toContain('75세');
  });

  // 투자자산을 하나도 등록하지 않은 계획. 엔진이 첫 해에 depletionAge를 잡으므로
  // 예전에는 "51세에 자산이 고갈될 것으로 예상됩니다"가 차트 위에 붙었다.
  test('투자자산이 없으면 고갈이 아니라 잔액 0원 유지로 설명한다', () => {
    const result = makeResult(
      [makeYearlyResult({ age: 51, totalAssets: 0 }), makeYearlyResult({ age: 90, totalAssets: 0 })],
      { depletionAge: 51 }
    );
    const captions = generateChartCaptions(result, baseParams);

    expect(captions.assetGrowth).toContain('투자자산이 없어');
    expect(captions.assetGrowth).not.toContain('고갈');
    expect(captions.assetGrowth).not.toContain('51세');
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
