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

  nationalPensionTaxRate: 0.02, // 국민연금 세율(고정, 단순화)

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
};

export const TAX_LAW_PROFILES: Record<TaxLawVersion, TaxLawProfile> = {
  current: CURRENT_PROFILE,
};

// 저장된 시나리오에 taxLawVersion이 없거나(구 데이터) 알 수 없는 값이 들어 있어도
// 계산이 멈추지 않도록 항상 현행 프로필로 떨어진다.
export function resolveTaxLawProfile(version?: TaxLawVersion): TaxLawProfile {
  return TAX_LAW_PROFILES[version ?? 'current'] ?? CURRENT_PROFILE;
}
