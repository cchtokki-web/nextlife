import { SimulationParams, SimulationResult } from '../../entities/types';
import { sumYearTaxes } from '../tax/annualTaxTotals';
import { findFirstAgeWithNationalPension } from './computePensionGapRisk';

export interface ExpertAnalytics {
  avgPreTaxIncome: number;
  avgTotalTax: number;
  avgHealthInsurance: number;
  avgNetIncome: number;
  // 국민연금 수령 이력이 전혀 없으면(예: expectedMonthlyAmount=0) null — generateChartCaptions와
  // 동일하게, "국민연금 없음"과 "65세부터 수령"을 구분하기 위해 임의 기본값(65)을 쓰지 않는다.
  firstAgeWithNationalPension: number | null;
  pensionGapYears: number;
  hasSignificantDividends: boolean;
}

// DashboardSection.tsx에서 계산만 되고 화면에 렌더링되지 않던 세금/건보료/연금 리스크 분석을
// ExpertDetailsPanel이 소비할 수 있는 usecase 함수로 승격한 것. 대부분 원본과 동일하되,
// firstAgeWithNationalPension은 원본의 `?? 65` 기본값 대신 null을 반환하도록 고쳤다 —
// 국민연금이 아예 없는 사용자에게 "65세부터 수령 시작"이라는 잘못된 문구가 나가는 것을 막기 위해서다.
export function computeExpertAnalytics(result: SimulationResult, params: SimulationParams): ExpertAnalytics {
  const { yearlyResults } = result;
  const { retirementAge } = params.userProfile;

  const retirementYearsResults = yearlyResults.filter((r) => r.age >= retirementAge);
  const avg = (pick: (r: (typeof yearlyResults)[number]) => number): number =>
    retirementYearsResults.length > 0
      ? retirementYearsResults.reduce((sum, r) => sum + pick(r), 0) / retirementYearsResults.length
      : 0;

  const avgPreTaxIncome = avg((r) => r.preTaxTotalIncome);
  // 여기만 건강보험료를 제외한다 — 바로 아래 avgHealthInsurance로 따로 보여주기 때문이다.
  const avgTotalTax = avg(sumYearTaxes);
  const avgHealthInsurance = avg((r) => r.healthInsurancePaid);
  const avgNetIncome = avg((r) => r.totalIncome);
  const avgYearlyDividend = avg((r) => r.dividendIncome);

  // 공백 구간 판정은 computePensionGapRisk와 **같은 함수**를 쓴다. 예전에는 두 곳이 각자
  // `find(nationalPensionIncome > 0)`을 적고 있었는데, 그 규칙이 갈라지면 전문가 패널의
  // "5년 공백"과 위험 카드의 "60~64세"가 서로 다른 나이를 말하게 된다.
  const firstAgeWithNationalPension = findFirstAgeWithNationalPension(result);
  const pensionGapYears = firstAgeWithNationalPension === null ? 0 : Math.max(0, firstAgeWithNationalPension - retirementAge);

  const hasSignificantDividends = avgYearlyDividend > 5000000;

  return {
    avgPreTaxIncome,
    avgTotalTax,
    avgHealthInsurance,
    avgNetIncome,
    firstAgeWithNationalPension,
    pensionGapYears,
    hasSignificantDividends,
  };
}
