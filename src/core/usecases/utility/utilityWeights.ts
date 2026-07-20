import { UtilityConfig } from '../../entities/types';

// weights 6개 필드의 합이 100이어야 한다는 불변식을 생성 시점에 강제하는 스마트 생성자.
// UtilityConfig 인터페이스 자체는 이 불변식을 표현하지 못하므로(임의의 숫자 6개를 허용),
// computeLifetimeUtility/recommendStrategy에 넘길 UtilityConfig는 항상 이 함수를 거쳐야 한다.
export function createUtilityConfig(
  weights: UtilityConfig['weights'],
  rest: Omit<UtilityConfig, 'weights'>
): UtilityConfig {
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 100) > 1e-9) {
    throw new Error(`UtilityConfig.weights 합은 100이어야 합니다 (현재 ${sum})`);
  }
  return { weights, ...rest };
}

// Lifetime Utility Score의 기본 가중치/적정치. 가중치 순위(생활수준 유지 35 > 고갈 방지 20 >
// 연금 활용도 15 > 세금 효율·과세 위험 관리·상속 자산 적정성 각 10)를 반영한 합리적 기본값이며,
// 향후 튜닝을 위해 별도 모듈로 분리한다. 건강보험료 부담은 독립된 가중치가 아니라 taxationRisk
// 산식(computeTaxationRiskRaw) 내부의 하위 페널티 요소로만 반영된다.
export const DEFAULT_UTILITY_CONFIG: UtilityConfig = createUtilityConfig(
  {
    consumption: 35,
    depletionSafety: 20,
    pensionUtilization: 15,
    taxEfficiency: 10,
    taxationRisk: 10,
    bequestAdequacy: 10,
  },
  {
    appropriatePensionBalanceMonths: 12, // 사망 시 연금잔액 적정치 = 월 목표생활비 * 12개월(1년치)
    appropriateBequestMonths: 24, // 사망 시 총자산 적정치 = 월 목표생활비 * 24개월(2년치)
    taxBurdenCeiling: 0.3, // 평생 세부담률 30%에서 taxEfficiency 0점
    healthInsuranceCeiling: 0.05, // 건강보험료/총소득 비율 5%에서 관련 페널티 최대
  }
);
