import { UtilityConfig } from '../../entities/types';

// Lifetime Utility Score의 기본 가중치/적정치. 사용자 우선순위
// (생활수준 유지 > 효용 극대화 > 고갈 방지 > 세금 최소화 > 종합과세 > 건보료 > 상속 최적화)를
// 반영한 합리적 기본값이며, 향후 튜닝을 위해 별도 모듈로 분리한다.
export const DEFAULT_UTILITY_CONFIG: UtilityConfig = {
  weights: {
    consumption: 35,
    depletionSafety: 20,
    pensionUtilization: 15,
    taxEfficiency: 10,
    taxationRisk: 10,
    bequestAdequacy: 10,
  },
  appropriatePensionBalanceMonths: 12, // 사망 시 연금잔액 적정치 = 월 목표생활비 * 12개월(1년치)
  appropriateBequestMonths: 24, // 사망 시 총자산 적정치 = 월 목표생활비 * 24개월(2년치)
  taxBurdenCeiling: 0.3, // 평생 세부담률 30%에서 taxEfficiency 0점
  healthInsuranceCeiling: 0.05, // 건강보험료/총소득 비율 5%에서 관련 페널티 최대
};
