import { describe, test, expect } from 'vitest';
import { computeRiskAlerts } from '@/core/usecases/dashboard/computeRiskAlerts';
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
    spouseAlive: false,
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

const paramsWithPensionLimit: SimulationParams = {
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

describe('computeRiskAlerts', () => {
  test('금융소득종합과세 위험이 있으면 첫 발생 연령을 포함한 알림을 반환한다', () => {
    const yearlyResults = [
      makeYearlyResult({ age: 65, hasTaxWarning: false }),
      makeYearlyResult({ age: 70, hasTaxWarning: true }),
    ];
    const alerts = computeRiskAlerts(makeResult(yearlyResults), baseParams);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].key).toBe('comprehensiveTax');
    expect(alerts[0].message).toContain('70세');
    expect(alerts[0].message).toContain('2,000만원');
  });

  test('사적연금이 저율과세 한도를 초과하는 연속 구간이 있으면 연령대와 한도 금액을 포함한 알림을 반환한다', () => {
    const yearlyResults = [
      makeYearlyResult({ age: 65, privatePensionIncome: 20000000, pensionTaxPaid: 1000000 }),
      makeYearlyResult({ age: 66, privatePensionIncome: 20000000, pensionTaxPaid: 1000000 }),
      makeYearlyResult({ age: 67, privatePensionIncome: 5000000, pensionTaxPaid: 0 }),
    ];
    const alerts = computeRiskAlerts(makeResult(yearlyResults), paramsWithPensionLimit);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].key).toBe('privatePensionLimit');
    expect(alerts[0].message).toContain('65~66세');
    expect(alerts[0].message).toContain('1,500만원');
  });

  test('건강보험료가 소득 대비 임계값(5%)을 초과하는 연도가 있으면 알림을 반환한다', () => {
    const yearlyResults = [makeYearlyResult({ age: 70, totalIncome: 10000000, healthInsurancePaid: 600000 })];
    const alerts = computeRiskAlerts(makeResult(yearlyResults), baseParams);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].key).toBe('healthInsurance');
    expect(alerts[0].message).toContain('70세');
    expect(alerts[0].message).toContain('5%');
  });

  test('건강보험료 비율이 정확히 임계값과 같으면 포함한다(>=)', () => {
    const yearlyResults = [makeYearlyResult({ age: 70, totalIncome: 10000000, healthInsurancePaid: 500000 })];
    const alerts = computeRiskAlerts(makeResult(yearlyResults), baseParams);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].key).toBe('healthInsurance');
  });

  test('totalIncome이 0인 해는 건강보험료 비율 계산에서 제외한다(0으로 나누기 방지)', () => {
    const yearlyResults = [makeYearlyResult({ age: 70, totalIncome: 0, healthInsurancePaid: 100 })];
    const alerts = computeRiskAlerts(makeResult(yearlyResults), baseParams);

    expect(alerts).toHaveLength(0);
  });

  test('여러 리스크가 동시에 발생하면 시작 연령이 이른 순으로 정렬한다', () => {
    const yearlyResults = [
      makeYearlyResult({ age: 65, totalIncome: 10000000, healthInsurancePaid: 600000 }),
      makeYearlyResult({ age: 70, hasTaxWarning: true, totalIncome: 10000000, healthInsurancePaid: 0 }),
      makeYearlyResult({
        age: 75,
        privatePensionIncome: 20000000,
        pensionTaxPaid: 1000000,
        totalIncome: 10000000,
        healthInsurancePaid: 0,
      }),
    ];
    const alerts = computeRiskAlerts(makeResult(yearlyResults), paramsWithPensionLimit);

    expect(alerts.map((a) => a.key)).toEqual(['healthInsurance', 'comprehensiveTax', 'privatePensionLimit']);
  });

  test('아무 리스크도 없으면 빈 배열을 반환한다', () => {
    const yearlyResults = [makeYearlyResult({ age: 65, totalIncome: 10000000, healthInsurancePaid: 100000 })];
    const alerts = computeRiskAlerts(makeResult(yearlyResults), baseParams);

    expect(alerts).toEqual([]);
  });

  describe('목표 상속자산 미달 알림 (userProfile.targetBequest)', () => {
    test('targetBequest가 설정되지 않으면 잔여자산이 얼마든 알림이 없다', () => {
      const result = { ...makeResult([]), endingAssets: 0 };
      const alerts = computeRiskAlerts(result, baseParams);
      expect(alerts).toEqual([]);
    });

    test('targetBequest가 0원(다 쓰고 가기)이면 잔여자산이 얼마든 알림이 없다', () => {
      const params: SimulationParams = { ...baseParams, userProfile: { ...baseParams.userProfile, targetBequest: 0 } };
      const result = { ...makeResult([]), endingAssets: 0 };
      const alerts = computeRiskAlerts(result, params);
      expect(alerts).toEqual([]);
    });

    test('예상 잔여자산이 목표 상속자산에 못 미치면 알림이 발생하고 두 금액을 모두 언급한다', () => {
      const params: SimulationParams = { ...baseParams, userProfile: { ...baseParams.userProfile, targetBequest: 200000000 } };
      const result = { ...makeResult([]), endingAssets: 50000000 };
      const alerts = computeRiskAlerts(result, params);

      expect(alerts).toHaveLength(1);
      expect(alerts[0].key).toBe('bequestShortfall');
      expect(alerts[0].message).toContain('5,000만원');
      expect(alerts[0].message).toContain('2억원');
    });

    test('예상 잔여자산이 목표 상속자산 이상이면 알림이 없다', () => {
      const params: SimulationParams = { ...baseParams, userProfile: { ...baseParams.userProfile, targetBequest: 200000000 } };
      const result = { ...makeResult([]), endingAssets: 200000000 };
      const alerts = computeRiskAlerts(result, params);
      expect(alerts).toEqual([]);
    });

    test('다른 리스크와 함께 발생하면 기대수명 시점 이벤트라 가장 나중(가장 늦은 나이)으로 정렬된다', () => {
      const params: SimulationParams = { ...baseParams, userProfile: { ...baseParams.userProfile, targetBequest: 200000000 } };
      const yearlyResults = [makeYearlyResult({ age: 65, hasTaxWarning: true })];
      const result = { ...makeResult(yearlyResults), endingAssets: 50000000 };
      const alerts = computeRiskAlerts(result, params);

      expect(alerts.map((a) => a.key)).toEqual(['comprehensiveTax', 'bequestShortfall']);
    });
  });
});
