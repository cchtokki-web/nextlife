import type { SimulationYearlyResult } from '../../entities/types';

export type HealthInsuranceDependentAssessment = NonNullable<
  SimulationYearlyResult['healthInsuranceDependentAssessment']
>;

const BOUNDARY_LOWER_RATIO = 0.9;

/**
 * 피부양자 위험은 실제 보험료나 세후 현금소득에서 역산하지 않는다.
 *
 * 재산 판정 입력은 production 계약에 없으므로, 소득 기준을 넘으면 탈락(false)을 확정할 수
 * 있지만 기준 이하여도 자격 유지(true)를 확정하지 않고 null로 둔다.
 */
export function assessHealthInsuranceDependent(
  income: number,
  incomeThreshold: number,
): HealthInsuranceDependentAssessment {
  if (!Number.isFinite(income) || !Number.isFinite(incomeThreshold) || incomeThreshold <= 0) {
    return {
      income,
      property: null,
      eligible: null,
      riskLevel: 'unknown',
      incomeThreshold,
      assessmentScope: 'unavailable',
      missingInputs: ['property'],
    };
  }

  const ratio = income / incomeThreshold;
  return {
    income,
    property: null,
    eligible: ratio > 1 ? false : null,
    riskLevel: ratio > 1 ? 'high' : ratio >= BOUNDARY_LOWER_RATIO ? 'boundary' : 'low',
    incomeThreshold,
    assessmentScope: 'income_only',
    missingInputs: ['property'],
  };
}
