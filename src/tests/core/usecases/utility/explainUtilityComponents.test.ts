import { describe, test, expect } from 'vitest';
import { explainUtilityComponents } from '@/core/usecases/utility/explainUtilityComponents';
import { SimulationParams, SimulationResult, SimulationYearlyResult } from '@/core/entities/types';
import { makeYearlyResult } from '@/tests/fixtures/yearlyResult';

// 효용 막대는 `6/25`, `0/15`처럼 점수만 보여줄 뿐 왜 그 점수인지 말하지 않았다.
// 이 함수는 그 숫자를 만든 입력을 문장으로 옮긴다 — 반드시 근거 수치를 포함해야 한다.
function makeParams(overrides: Partial<SimulationParams> = {}): SimulationParams {
  return {
    userProfile: { currentAge: 50, retirementAge: 60, expectancy: 62, targetMonthlySpending: 3500000 },
    assets: [],
    nationalPension: { expectedMonthlyAmount: 1800000 },
    privatePensions: [],
    otherIncomes: [],
    inflationRate: 0,
    inflationMode: 'real',
    baseExchangeRate: 1350,
    exchangeScenario: 'base',
    displayCurrency: 'KRW',
    ...overrides,
  };
}

function makeResult(
  yearlyResults: SimulationYearlyResult[],
  overrides: Partial<SimulationResult> = {}
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
    householdEndAge: 62,
    ...overrides,
  };
}

describe('explainUtilityComponents - 소비 만족도', () => {
  test('목표와 실제 소비를 월 단위 금액과 비율로 밝힌다', () => {
    const yearly = [60, 61, 62].map((age) => makeYearlyResult({ age, spending: 1910000 * 12 }));

    const { consumption } = explainUtilityComponents(makeParams(), makeResult(yearly));

    expect(consumption).toContain('350만원');
    expect(consumption).toContain('191만원');
    expect(consumption).toContain('55%');
  });

});

describe('explainUtilityComponents - 자산 고갈 방지', () => {
  test('고갈이 없으면 만점인 이유를 밝힌다', () => {
    const result = makeResult([makeYearlyResult({ age: 60 })], { depletionAge: null });

    expect(explainUtilityComponents(makeParams(), result).depletionSafety).toContain('62세까지');
  });

  // 투자자산이 없는 계획: 엔진이 첫 해에 고갈로 판정하므로 depletionAge <= retirementAge다.
  test('은퇴 전에 이미 자산이 없으면 메울 기간이 없다고 말한다', () => {
    const yearly = [60, 61, 62].map((age) => makeYearlyResult({ age }));
    const result = makeResult(yearly, { depletionAge: 51 });

    const { depletionSafety } = explainUtilityComponents(makeParams(), result);

    expect(depletionSafety).toContain('은퇴 시점에 이미 인출할 자산이 없어');
    expect(depletionSafety).toContain('3년');
  });

  test('은퇴 후 중간에 고갈되면 몇 년까지 버티는지 말한다', () => {
    const params = makeParams({
      userProfile: { currentAge: 50, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3500000 },
    });
    const result = makeResult([makeYearlyResult({ age: 60 })], { depletionAge: 82, householdEndAge: 90 });

    const { depletionSafety } = explainUtilityComponents(params, result);

    expect(depletionSafety).toContain('30년 중 22년');
    expect(depletionSafety).toContain('82세');
  });
});

describe('explainUtilityComponents - 연금 활용도', () => {
  test('국민연금 수급 연수와 사적연금 인출 연수를 함께 말한다', () => {
    const yearly = [
      makeYearlyResult({ age: 60, nationalPensionIncome: 0 }),
      makeYearlyResult({ age: 61, nationalPensionIncome: 21600000 }),
      makeYearlyResult({ age: 62, nationalPensionIncome: 21600000 }),
    ];

    const { pensionUtilization } = explainUtilityComponents(makeParams(), makeResult(yearly));

    expect(pensionUtilization).toContain('3년 중 2년 국민연금');
    expect(pensionUtilization).toContain('사적연금은 등록돼 있지 않습니다');
  });

  test('국민연금 수령액이 없으면 그 사실을 밝힌다', () => {
    const params = makeParams({ nationalPension: { expectedMonthlyAmount: 0 } });
    const yearly = [makeYearlyResult({ age: 60 })];

    expect(explainUtilityComponents(params, makeResult(yearly)).pensionUtilization)
      .toContain('국민연금 수령액이 등록돼 있지 않습니다');
  });
});

describe('explainUtilityComponents - 세금 효율 / 과세 위험 관리', () => {
  test('세전 소득 대비 세금 비율을 밝힌다', () => {
    const yearly = [
      makeYearlyResult({ age: 60, preTaxTotalIncome: 20000000, nationalPensionTaxPaid: 1000000 }),
    ];

    const { taxEfficiency } = explainUtilityComponents(makeParams(), makeResult(yearly));

    expect(taxEfficiency).toContain('2,000만원');
    expect(taxEfficiency).toContain('5.0%');
  });

  // 기타소득은 세후 실수령액으로 입력받으므로 분모에서 뺀다(computeTaxEfficiencyRaw와 같은 규칙).
  test('과세 대상 소득이 없으면 비율을 지어내지 않는다', () => {
    const yearly = [makeYearlyResult({ age: 60, preTaxTotalIncome: 5000000, otherIncome: 5000000 })];

    expect(explainUtilityComponents(makeParams(), makeResult(yearly)).taxEfficiency)
      .toContain('과세 대상 소득이 없어');
  });

  test('금융소득종합과세 위험 연도가 있으면 그 연수를 밝힌다', () => {
    const yearly = [
      makeYearlyResult({ age: 60, hasTaxWarning: true }),
      makeYearlyResult({ age: 61, hasTaxWarning: false }),
    ];

    expect(explainUtilityComponents(makeParams(), makeResult(yearly)).taxationRisk).toContain('1년');
  });

  test('위험 연도도 건강보험료도 없으면 그 사실을 밝힌다', () => {
    const yearly = [makeYearlyResult({ age: 60 })];

    expect(explainUtilityComponents(makeParams(), makeResult(yearly)).taxationRisk)
      .toContain('위험 연도가 없고');
  });
});
