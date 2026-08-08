import { SimulationYearlyResult } from '@/core/entities/types';

// SimulationYearlyResult 테스트 픽스처 팩토리.
//
// 이 파일이 있는 이유: 결과 타입에 필수 필드를 하나 추가할 때마다 전체 리터럴을 만드는
// 모든 테스트가 컴파일 에러로 깨진다(tsconfig가 테스트를 포함하므로 `next build`까지
// 깨진다). 예전에는 같은 기본값 객체가 여러 테스트 파일에 그대로 복제돼 있어서, 필드
// 하나를 추가하면 그 복제본을 전부 찾아 고쳐야 했다.
//
// 여기에 모아 두면 새 필드는 이 파일 한 곳만 고치면 되고, 각 테스트는 자기가 관심 있는
// 필드만 overrides로 지정한다 — 그 자체로 "이 테스트가 무엇을 보는가"가 드러난다.
export function makeYearlyResult(
  overrides: Partial<SimulationYearlyResult> = {}
): SimulationYearlyResult {
  return {
    age: 60,
    year: 2026,
    totalAssets: 0,
    stockAssets: 0,
    pensionAssets: 0,
    isaAssets: 0,
    cashAssets: 0,
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
    healthInsuranceIncomeBasis: 0,
    capitalGainsTaxPaid: 0,
    comprehensiveTaxPaid: 0,
    privatePensionTaxMethod: 'none',
    spending: 0,
    unmetSpending: 0,
    healthcareSpending: 0,
    hasTaxWarning: false,
    ...overrides,
  };
}
