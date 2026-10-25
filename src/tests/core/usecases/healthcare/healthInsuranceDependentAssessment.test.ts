import { describe, expect, test } from 'vitest';
import { assessHealthInsuranceDependent } from '@/core/usecases/healthcare/healthInsuranceDependentAssessment';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import type { SimulationParams } from '@/core/entities/types';

describe('assessHealthInsuranceDependent', () => {
  test('보험료나 세후소득 없이 판정용 세전소득만 평가한다', () => {
    const assessment = assessHealthInsuranceDependent(19_100_000, 20_000_000);

    expect(assessment).toEqual({
      income: 19_100_000,
      property: null,
      eligible: null,
      riskLevel: 'boundary',
      incomeThreshold: 20_000_000,
      assessmentScope: 'income_only',
      missingInputs: ['property'],
    });
  });

  test('소득 기준을 넘으면 재산 정보가 없어도 소득 사유 탈락을 판정한다', () => {
    const assessment = assessHealthInsuranceDependent(20_000_001, 20_000_000);

    expect(assessment.eligible).toBe(false);
    expect(assessment.riskLevel).toBe('high');
  });

  test('소득 기준 이하여도 재산 입력이 없으므로 자격 유지를 확정하지 않는다', () => {
    expect(assessHealthInsuranceDependent(10_000_000, 20_000_000).eligible).toBeNull();
  });
});

describe('SimulationEngine 건강보험 값 분리', () => {
  test('국민연금 실수령액과 피부양자 판정용 소득은 별도 값이다', () => {
    const params: SimulationParams = {
      userProfile: { currentAge: 65, retirementAge: 65, expectancy: 65, targetMonthlySpending: 0 },
      assets: [], isaAccounts: [], privatePensions: [], otherIncomes: [],
      nationalPension: { expectedMonthlyAmount: 2_000_000 },
      inflationRate: 0, inflationMode: 'nominal', baseExchangeRate: 1,
      exchangeScenario: 'base', displayCurrency: 'KRW',
    };

    const year = new SimulationEngine().runSingle(params).yearlyResults[0];

    expect(year.nationalPensionIncome).not.toBe(year.healthInsuranceDependentAssessment?.income);
    expect(year.cashFlowIncome?.healthInsurancePremium).toBe(year.healthInsurancePaid);
    expect(year.healthInsuranceDependentAssessment?.income).toBe(year.healthInsuranceIncomeBasis);
    expect(year.healthInsuranceDependentAssessment?.property).toBeNull();
    expect(year.healthInsuranceDependentAssessment?.assessmentScope).toBe('income_only');
    expect(year.healthInsuranceDependentAssessment?.missingInputs).toEqual(['property']);
  });
});
