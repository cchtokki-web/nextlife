import { SimulationParams, SimulationResult } from '../../entities/types';

export interface ExpertAnalytics {
  avgPreTaxIncome: number;
  avgTotalTax: number;
  avgHealthInsurance: number;
  avgNetIncome: number;
  firstAgeWithNationalPension: number;
  pensionGapYears: number;
  everComprehensiveTax: boolean;
  hasHighPrivatePensionRisk: boolean;
  hasSignificantDividends: boolean;
}

// DashboardSection.tsx에서 계산만 되고 화면에 렌더링되지 않던 세금/건보료/연금 리스크 분석을
// ExpertDetailsPanel이 소비할 수 있는 usecase 함수로 승격한 것. 계산 로직은 원본과 동일하다.
export function computeExpertAnalytics(result: SimulationResult, params: SimulationParams): ExpertAnalytics {
  const { yearlyResults } = result;
  const { retirementAge } = params.userProfile;

  const retirementYearsResults = yearlyResults.filter((r) => r.age >= retirementAge);
  const avg = (pick: (r: (typeof yearlyResults)[number]) => number): number =>
    retirementYearsResults.length > 0
      ? retirementYearsResults.reduce((sum, r) => sum + pick(r), 0) / retirementYearsResults.length
      : 0;

  const avgPreTaxIncome = avg((r) => r.preTaxTotalIncome);
  const avgTotalTax = avg((r) => r.dividendTaxPaid + r.pensionTaxPaid + r.nationalPensionTaxPaid + r.comprehensiveTaxPaid);
  const avgHealthInsurance = avg((r) => r.healthInsurancePaid);
  const avgNetIncome = avg((r) => r.totalIncome);
  const avgYearlyDividend = avg((r) => r.dividendIncome);

  const firstAgeWithNationalPension = yearlyResults.find((r) => r.nationalPensionIncome > 0)?.age ?? 65;
  const pensionGapYears = Math.max(0, firstAgeWithNationalPension - retirementAge);

  const everComprehensiveTax = yearlyResults.some((r) => r.comprehensiveTaxPaid > 0 || r.hasTaxWarning);

  const pensionLimit = params.taxSettings?.privatePensionLimit ?? 15000000;
  const hasHighPrivatePensionRisk = yearlyResults.some((r) => r.privatePensionIncome + r.pensionTaxPaid > pensionLimit);

  const hasSignificantDividends = avgYearlyDividend > 5000000;

  return {
    avgPreTaxIncome,
    avgTotalTax,
    avgHealthInsurance,
    avgNetIncome,
    firstAgeWithNationalPension,
    pensionGapYears,
    everComprehensiveTax,
    hasHighPrivatePensionRisk,
    hasSignificantDividends,
  };
}
