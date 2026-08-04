// 세법 버전별 세율·한도 프로필. taxRates.ts에 흩어져 있던 상수들의 단일 소스다.
//
// 이 파일을 따로 둔 이유: "현행 세법"과 "개정안"을 나란히 두고 비교하려면 값이 버전별로
// 묶여 있어야 한다. 상수가 모듈 최상단에 평평하게 흩어져 있으면 버전 축을 나중에
// 끼워 넣을 자리가 없다.

import { TaxLawVersion } from '../../entities/types';

export interface ProgressiveTaxBracket {
  minKRW: number; // 이 구간의 하한(초과 시 적용, 미포함)
  rate: number; // 세율 (0~1)
  deductionKRW: number; // 누진공제액
}

export interface PrivatePensionTaxBracket {
  minAge: number;
  maxAge: number;
  rate: number;
}

// 연금소득공제(소득세법 §47의2) 구간.
// 공제액 = baseDeductionKRW + (총연금액 − minKRW) × rate, 단 pensionIncomeDeductionCapKRW 한도.
export interface PensionIncomeDeductionBracket {
  minKRW: number; // 이 구간의 하한(이상)
  baseDeductionKRW: number; // 하한까지 누적된 공제액
  rate: number; // 하한 초과분에 적용되는 공제율
}

// 한 세법 버전이 정하는 세율·한도의 전체 집합.
// 개정안이 확정되면 이 인터페이스를 만족하는 프로필을 하나 더 추가하면 된다.
export interface TaxLawProfile {
  financialIncomeThresholdKRW: number;
  isaAnnualLimitKRW: number;
  isaExemptionGeneralKRW: number;
  isaExemptionLowIncomeKRW: number;
  isaMaturityTaxRate: number;
  nationalPensionTaxRate: number;
  privatePensionBrackets: PrivatePensionTaxBracket[];
  privatePensionLimitKRW: number;
  privatePensionExcessTaxRate: number;
  comprehensiveIncomeBrackets: ProgressiveTaxBracket[];
  localIncomeTaxRate: number;
  pensionIncomeDeductionBrackets: PensionIncomeDeductionBracket[];
  pensionIncomeDeductionCapKRW: number;
  basicIncomeDeductionKRW: number;
  healthInsuranceRateRegional: number; // %
  healthInsurancePublicPensionInclusionRate: number; // 0~1
  overseasCapitalGainsTaxRate: number; // 0~1
  overseasCapitalGainsDeductionKRW: number; // 연간 기본공제
}

// 현행 세법(2024년 기준). taxRates.ts에 있던 값을 그대로 옮긴 것이며 값 변경은 없다
// (taxLawProfiles.test.ts가 기존 상수와의 일치를 검증한다).
//
// '예정 법령' 프로필은 아직 만들지 않았다 — 비워 둔 슬롯이 아니라 슬롯 자체가 없다
// (TaxLawVersion에 'planned' 같은 멤버를 추가하는 것이 첫 단계다). 확정된 개정안이
// 없는 상태에서 허구의 숫자를 넣으면 사용자가 그것을 사실로 받아들이기 때문이다.
const CURRENT_PROFILE: TaxLawProfile = {
  financialIncomeThresholdKRW: 20000000, // 금융소득종합과세 기준(연)

  isaAnnualLimitKRW: 20000000, // ISA 연간 납입한도
  isaExemptionGeneralKRW: 2000000, // ISA 일반형 비과세 한도
  isaExemptionLowIncomeKRW: 4000000, // ISA 서민형 비과세 한도
  isaMaturityTaxRate: 0.099, // ISA 만기 비과세 한도 초과분 분리과세율

  // 국민연금 세율(고정 2%). 지금은 쓰이지 않는다 — 연금소득공제 기반 종합과세로 대체됐다.
  // 저장된 옛 시나리오와의 호환을 위해 필드는 남기지만, 계산 경로에는 연결되어 있지 않다.
  //
  // 왜 대체했나: 고정 세율은 정확도만의 문제가 아니었다. 이 앱은 국민연금 개시 나이를
  // 60~70에서 최적화해 추천하는데, 연기수령으로 연금액이 36% 늘어도 세부담이 선형으로만
  // 늘면 연기 전략이 체계적으로 과대평가된다. 실제 실효세율은 월 100만원 수령 시 약 2.5%,
  // 월 300만원 수령 시 약 8.1%로 크게 달라진다.
  nationalPensionTaxRate: 0.02,

  // 연금소득공제(소득세법 §47의2). 공적연금·사적연금을 **합산한** 총연금액에 한 번만 적용된다.
  //   350만원 이하        → 전액
  //   350만 ~ 700만       → 350만 + 초과분 × 40%
  //   700만 ~ 1,400만     → 490만 + 초과분 × 20%
  //   1,400만 초과        → 630만 + 초과분 × 10%   (한도 900만원)
  pensionIncomeDeductionBrackets: [
    { minKRW: 0, baseDeductionKRW: 0, rate: 1 },
    { minKRW: 3500000, baseDeductionKRW: 3500000, rate: 0.4 },
    { minKRW: 7000000, baseDeductionKRW: 4900000, rate: 0.2 },
    { minKRW: 14000000, baseDeductionKRW: 6300000, rate: 0.1 },
  ],
  pensionIncomeDeductionCapKRW: 9000000,

  // 종합소득 기본공제(본인 1인분). 연금소득공제와 마찬가지로 합산 소득에 한 번만 적용된다.
  // 부양가족·추가공제는 입력이 없어 반영하지 않는다(실제보다 세금이 높게 나오는 방향).
  basicIncomeDeductionKRW: 1500000,

  // 건강보험료(지역가입자 소득분) 요율.
  //
  // 예전에는 이 앱이 임의로 고른 5%였고 "세법이 정한 값이 아니라 단순화 계수"라 프로필 밖에
  // 두었다. 실제 지역가입자 요율(7%대)에 맞추면 더 이상 임의 계수가 아니므로 프로필로 옮긴다.
  //
  // **불확실**: 2026년 실제 요율, 장기요양보험료(건보료의 12.95%) 포함 여부는 확인이 필요하다.
  // 요율이 프로필에 있으므로 개정 시 이 값만 갈아 끼우면 된다.
  healthInsuranceRateRegional: 7.09,

  // 건강보험료 부과 시 공적연금(국민연금) 소득의 반영 비율.
  // 지역가입자 소득월액 산정에서 연금소득은 50%만 반영된다.
  healthInsurancePublicPensionInclusionRate: 0.5,

  // 해외주식·ETF 양도소득세. 22%는 지방소득세를 포함한 값이고, 연 250만원 기본공제가
  // 손익통산 후에 적용된다.
  //
  // 국내상장 주식·국내주식형 ETF의 매매차익은 대주주가 아닌 개인에게 비과세이므로
  // KR_ETF는 과세하지 않는다(getMarketTaxTreatment.capitalGainsTaxable).
  //
  // **불확실**: 국내상장 해외지수·채권형·파생형 ETF는 매매차익이 배당소득(15.4%)으로
  // 과세되고 금융소득종합과세 대상이지만, 이를 구분하려면 새 시장 분류와 입력 폼·마이그레이션이
  // 필요해 이번 범위에서 제외했다.
  //
  // 증권거래세(0.18%대)와 금융투자소득세는 넣지 않는다 — 전자는 22%에 비해 유의미하지 않고,
  // 후자는 2024년 말 폐지가 확정됐다.
  overseasCapitalGainsTaxRate: 0.22,
  overseasCapitalGainsDeductionKRW: 2500000,

  // 사적연금 소득세 연령별 슬라이딩 세율 구간. 상한 미포함(다음 구간의 하한부터 적용).
  // minAge:0인 첫 구간은 "55세 이상" 전용이 아니라 55세 미만 호출까지 포함하는 캐치올이다
  // (이 함수는 55세 미만 나이로는 호출되지 않는다는 불변식을 호출부가 보장해야 한다).
  privatePensionBrackets: [
    { minAge: 0, maxAge: 70, rate: 0.055 }, // 55~69세 (하한 0은 55세 미만 호출에 대한 캐치올)
    { minAge: 70, maxAge: 80, rate: 0.044 }, // 70~79세
    { minAge: 80, maxAge: Infinity, rate: 0.033 }, // 80세 이상
  ],
  privatePensionLimitKRW: 15000000, // 사적연금 저율과세 한도(연)
  privatePensionExcessTaxRate: 16.5, // 한도 초과 시 세율(%)

  // 한국 종합소득세 누진세율표(2024년 기준, 단순화). 사적연금 저율과세 초과분 "단순 비교 모델"
  // 전용으로만 쓰인다. 실제 종합소득세는 근로/사업/기타 소득과 합산되고 각종 소득공제가 적용되지만,
  // 이 앱은 은퇴 후 연금소득만 있다고 가정하는 근사치이므로 사적연금 인출액 자체를 그대로 과세표준으로
  // 취급한다(연금소득공제 등 다른 공제는 반영하지 않음 — 실제보다 세금이 다소 높게 계산될 수 있음).
  comprehensiveIncomeBrackets: [
    { minKRW: 0, rate: 0.06, deductionKRW: 0 },
    { minKRW: 14000000, rate: 0.15, deductionKRW: 1260000 },
    { minKRW: 50000000, rate: 0.24, deductionKRW: 5760000 },
    { minKRW: 88000000, rate: 0.35, deductionKRW: 15440000 },
    { minKRW: 150000000, rate: 0.38, deductionKRW: 19940000 },
    { minKRW: 300000000, rate: 0.40, deductionKRW: 25940000 },
    { minKRW: 500000000, rate: 0.42, deductionKRW: 35940000 },
    { minKRW: 1000000000, rate: 0.45, deductionKRW: 65940000 },
  ],

  // 지방소득세(소득분). 소득세액의 10%가 별도로 붙는다.
  //
  // comprehensiveIncomeBrackets는 국세만 담고 있는데, 배당 원천징수율 15.4%는 국세 14% +
  // 지방세 1.4%를 합한 값이다. 비교과세에서 누진세액과 원천징수액을 견주려면 두 값의 기준이
  // 같아야 하므로, 누진세액 쪽에 이 비율을 곱해 세후 총부담 기준으로 맞춘다.
  localIncomeTaxRate: 0.1,
};

export const TAX_LAW_PROFILES: Record<TaxLawVersion, TaxLawProfile> = {
  current: CURRENT_PROFILE,
};

// 저장된 시나리오에 taxLawVersion이 없거나(구 데이터) 알 수 없는 값이 들어 있어도
// 계산이 멈추지 않도록 항상 현행 프로필로 떨어진다.
export function resolveTaxLawProfile(version?: TaxLawVersion): TaxLawProfile {
  return TAX_LAW_PROFILES[version ?? 'current'] ?? CURRENT_PROFILE;
}
