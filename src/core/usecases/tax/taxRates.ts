// 세율/한도 상수 단일 소스. 기존 SimulationEngine.ts에 흩어져 있던 하드코딩 값을
// 그대로(값 변경 없이) 상수화한 것으로, 여기 값을 바꾸면 시뮬레이션 결과가 바뀐다.

import { TaxSettings } from '../../entities/types';

export const FINANCIAL_INCOME_COMPREHENSIVE_TAX_THRESHOLD_KRW = 20000000; // 금융소득종합과세 기준(연)

export const ISA_ANNUAL_CONTRIBUTION_LIMIT_KRW = 20000000; // ISA 연간 납입한도
export const ISA_EXEMPTION_LIMIT_GENERAL_KRW = 2000000; // ISA 일반형 비과세 한도
export const ISA_EXEMPTION_LIMIT_LOW_INCOME_KRW = 4000000; // ISA 서민형 비과세 한도
export const ISA_MATURITY_TAX_RATE = 0.099; // ISA 만기 비과세 한도 초과분 분리과세율

export const NATIONAL_PENSION_TAX_RATE = 0.02; // 국민연금 세율(고정, 단순화)

// 사적연금 소득세 연령별 슬라이딩 세율 구간. 상한 미포함(다음 구간의 하한부터 적용).
// minAge:0인 첫 구간은 "55세 이상" 전용이 아니라 55세 미만 호출까지 포함하는 캐치올이다
// (이 함수는 55세 미만 나이로는 호출되지 않는다는 불변식을 호출부가 보장해야 한다).
export const PRIVATE_PENSION_TAX_BRACKETS: { minAge: number; maxAge: number; rate: number }[] = [
  { minAge: 0, maxAge: 70, rate: 0.055 }, // 55~69세 (하한 0은 55세 미만 호출에 대한 캐치올)
  { minAge: 70, maxAge: 80, rate: 0.044 }, // 70~79세
  { minAge: 80, maxAge: Infinity, rate: 0.033 }, // 80세 이상
];

export const DEFAULT_PRIVATE_PENSION_LIMIT_KRW = 15000000; // 사적연금 저율과세 한도(연)
export const DEFAULT_PRIVATE_PENSION_EXCESS_TAX_RATE = 16.5; // 한도 초과 시 세율(%)
export const DEFAULT_COMPREHENSIVE_TAX_RATE = 15; // 금융소득종합과세 초과분 단순화 세율(%)
export const DEFAULT_HEALTH_INSURANCE_RATE = 5; // 초과분 건강보험료 비율(%)

export interface ProgressiveTaxBracket {
  minKRW: number; // 이 구간의 하한(초과 시 적용, 미포함)
  rate: number; // 세율 (0~1)
  deductionKRW: number; // 누진공제액
}

// 한국 종합소득세 누진세율표(2024년 기준, 단순화). 사적연금 저율과세 초과분 "단순 비교 모델"
// 전용으로만 쓰인다. 실제 종합소득세는 근로/사업/기타 소득과 합산되고 각종 소득공제가 적용되지만,
// 이 앱은 은퇴 후 연금소득만 있다고 가정하는 근사치이므로 사적연금 인출액 자체를 그대로 과세표준으로
// 취급한다(연금소득공제 등 다른 공제는 반영하지 않음 — 실제보다 세금이 다소 높게 계산될 수 있음).
export const KOREA_COMPREHENSIVE_INCOME_TAX_BRACKETS_2024: ProgressiveTaxBracket[] = [
  { minKRW: 0, rate: 0.06, deductionKRW: 0 },
  { minKRW: 14000000, rate: 0.15, deductionKRW: 1260000 },
  { minKRW: 50000000, rate: 0.24, deductionKRW: 5760000 },
  { minKRW: 88000000, rate: 0.35, deductionKRW: 15440000 },
  { minKRW: 150000000, rate: 0.38, deductionKRW: 19940000 },
  { minKRW: 300000000, rate: 0.40, deductionKRW: 25940000 },
  { minKRW: 500000000, rate: 0.42, deductionKRW: 35940000 },
  { minKRW: 1000000000, rate: 0.45, deductionKRW: 65940000 },
];

// TaxSettings 기본값 단일 소스. 과거 SimulationEngine.ts/simulator/page.tsx/
// TaxSettingsSection.tsx/SimpleSimulationAdapter.ts 네 곳에 이 기본값 객체가 각각
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
