// 세율/한도 상수 단일 소스. 기존 SimulationEngine.ts에 흩어져 있던 하드코딩 값을
// 그대로(값 변경 없이) 상수화한 것으로, 여기 값을 바꾸면 시뮬레이션 결과가 바뀐다.
//
// 세법이 정하는 값(세율표·한도)의 실제 단일 소스는 taxLawProfiles.ts로 옮겼다.
// 이 파일은 그 프로필에서 파생된 이름들을 기존 이름 그대로 재노출해, 이미 이 모듈을
// import하고 있는 호출부가 세법 버전 구조를 몰라도 되게 한다.
// 값을 고치려면 taxLawProfiles.ts를 고쳐야 한다.

import { TaxSettings } from '../../entities/types';
import { TAX_LAW_PROFILES } from './taxLawProfiles';

export type { ProgressiveTaxBracket } from './taxLawProfiles';

const CURRENT = TAX_LAW_PROFILES.current;

export const FINANCIAL_INCOME_COMPREHENSIVE_TAX_THRESHOLD_KRW = CURRENT.financialIncomeThresholdKRW; // 금융소득종합과세 기준(연)

export const ISA_ANNUAL_CONTRIBUTION_LIMIT_KRW = CURRENT.isaAnnualLimitKRW; // ISA 연간 납입한도
export const ISA_EXEMPTION_LIMIT_GENERAL_KRW = CURRENT.isaExemptionGeneralKRW; // ISA 일반형 비과세 한도
export const ISA_EXEMPTION_LIMIT_LOW_INCOME_KRW = CURRENT.isaExemptionLowIncomeKRW; // ISA 서민형 비과세 한도
export const ISA_MATURITY_TAX_RATE = CURRENT.isaMaturityTaxRate; // ISA 만기 비과세 한도 초과분 분리과세율

export const NATIONAL_PENSION_TAX_RATE = CURRENT.nationalPensionTaxRate; // 국민연금 세율(고정, 단순화)

// 사적연금 소득세 연령별 슬라이딩 세율 구간(상세 주석은 taxLawProfiles.ts 참고).
export const PRIVATE_PENSION_TAX_BRACKETS: { minAge: number; maxAge: number; rate: number }[] =
  CURRENT.privatePensionBrackets;

export const DEFAULT_PRIVATE_PENSION_LIMIT_KRW = CURRENT.privatePensionLimitKRW; // 사적연금 저율과세 한도(연)
export const DEFAULT_PRIVATE_PENSION_EXCESS_TAX_RATE = CURRENT.privatePensionExcessTaxRate; // 한도 초과 시 세율(%)

// 아래 둘은 세법이 정한 값이 아니라 이 앱이 고른 단순화 계수라 프로필에 넣지 않는다.
export const DEFAULT_COMPREHENSIVE_TAX_RATE = 15; // 금융소득종합과세 초과분 단순화 세율(%)
export const DEFAULT_HEALTH_INSURANCE_RATE = 5; // 초과분 건강보험료 비율(%)

// 한국 종합소득세 누진세율표(2024년 기준, 단순화. 상세 주석은 taxLawProfiles.ts 참고).
export const KOREA_COMPREHENSIVE_INCOME_TAX_BRACKETS_2024 = CURRENT.comprehensiveIncomeBrackets;

// TaxSettings 기본값 단일 소스. 과거 SimulationEngine.ts/simulator/page.tsx/
// 고급 세금 설정 UI/SimpleSimulationAdapter.ts 네 곳에 이 기본값 객체가 각각
// 하드코딩되어 있었고, 그중 일부는 이미 서로 어긋나 있었다(limitPrivatePensionToTaxLimit
// 누락). resolveTaxSettings()를 통해서만 완전한 TaxSettings를 만들도록 통일한다.
export const DEFAULT_TAX_SETTINGS: Required<TaxSettings> = {
  enableComprehensiveTax: true,
  enableHealthInsurance: true,
  usDividendTaxRate: 15,
  domesticDividendTaxRate: 15.4,
  comprehensiveTaxRate: DEFAULT_COMPREHENSIVE_TAX_RATE,
  healthInsuranceRate: DEFAULT_HEALTH_INSURANCE_RATE,
  enablePrivatePensionTax: true,
  privatePensionLimit: DEFAULT_PRIVATE_PENSION_LIMIT_KRW,
  privatePensionExcessTaxRate: DEFAULT_PRIVATE_PENSION_EXCESS_TAX_RATE,
  limitPrivatePensionToTaxLimit: false,
  enablePensionComprehensiveComparison: true,
};

export function resolveTaxSettings(partial?: Partial<TaxSettings>): Required<TaxSettings> {
  return { ...DEFAULT_TAX_SETTINGS, ...(partial || {}) };
}
