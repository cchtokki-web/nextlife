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
  const subWeightSum = Object.values(rest.pensionUtilizationSubWeights).reduce((a, b) => a + b, 0);
  if (Math.abs(subWeightSum - 1) > 1e-9) {
    throw new Error(`UtilityConfig.pensionUtilizationSubWeights 합은 1이어야 합니다 (현재 ${subWeightSum})`);
  }
  // 아래 값들은 전부 UtilityEngine에서 «나눗셈의 분모»로 쓰인다. 0이나 음수가 들어오면
  // 몫이 Infinity가 되고, 그 뒤의 clamp(…, 0, 1)가 그것을 조용히 만점으로 바꾼다 —
  // 예컨대 fullBufferYears가 0이면 살아남은 모든 계획이 depletionSafety 만점을 받아,
  // 이 축을 넣은 목적(완충자본을 태운 계획과 남긴 계획의 구분)이 오류 없이 사라진다.
  // 설정값은 사용자 입력이 아니라 프로그래머 입력이므로 조용히 보정하지 않고 즉시 터뜨린다.
  const positives = {
    fullBufferYears: rest.fullBufferYears,
    appropriateBequestMonths: rest.appropriateBequestMonths,
    privatePensionEffectiveTaxCeiling: rest.privatePensionEffectiveTaxCeiling,
  };
  for (const [name, value] of Object.entries(positives)) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`UtilityConfig.${name}은 0보다 큰 유한수여야 합니다 (현재 ${value})`);
    }
  }
  if (!Number.isFinite(rest.survivalBaseScore) || rest.survivalBaseScore < 0 || rest.survivalBaseScore > 1) {
    throw new Error(`UtilityConfig.survivalBaseScore는 0~1이어야 합니다 (현재 ${rest.survivalBaseScore})`);
  }
  return { weights, ...rest };
}

// Lifetime Utility Score의 기본 가중치/적정치. 가중치 순위(생활수준 유지 35 > 고갈 방지 20 >
// 연금 활용도 15 > 세금 효율·과세 위험 관리·상속 자산 적정성 각 10)를 반영한 합리적 기본값이며,
// 향후 튜닝을 위해 별도 모듈로 분리한다. 건강보험료 부담은 독립된 가중치가 아니라 taxationRisk
// 산식(computeTaxationRiskRaw) 내부의 하위 페널티 요소로만 반영된다.
//
// **consumption 35 / depletionSafety 20을 옮기는 실험을 했고, 옮기지 않기로 했다.**
// (하니스 54인, depletionSafety를 연속화한 뒤 측정)
//
//   depletionSafety  consumption   corr(효용, MC성공률)   추천가능   악화   비증액 악화
//         20             35              0.640              37       6        1   ← 유지
//         25             30              0.660              36       6        1
//         30             25              0.681              36       6        1
//
// 배점을 옮기면 corr는 오르지만 **악화 건수는 전혀 줄지 않는다** — 즉 실제로 해로운 추천을
// 막아 주지 않는다. 얻는 것이 상관계수 0.04뿐인데, 치르는 값은 「생활수준 유지가 덜 중요하다」는
// 제품 차원의 선언과 모든 사용자의 점수 변경이다. corr은 목적함수가 생존율과 같은 방향을 보는지
// 확인하는 «진단»이지 최대화할 «목표»가 아니다. 이 앱은 생존확률 최대화기가 아니라 은퇴 «생활»
// 설계 도구다.
//
// 참고로 완충연수 단독의 corr은 0.846으로 효용 총점(0.640)보다 높다. 그것은 결함이 아니라
// 정의상 당연하다 — 총점은 소비·세금·연금 활용도까지 함께 재는 «다른 질문»이다.
//
// **새 축을 하나 더 넣는 안도 같이 재 보고 접었다.** 「안정소득(국민연금+배당) 충당률」을
// 독립 축 후보로 측정했더니 corr 0.545로 효용 총점(0.640)보다 «낮았다». 축을 늘리면 모든
// 가중치를 다시 배분해야 하는데, 그 대가로 목적함수가 생존율과 더 어긋나는 셈이라 근거가
// 없다. 배점 재조정과 함께 이 질문도 다시 열지 않기 위해 남긴다.
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
    pensionUtilizationSubWeights: {
      nationalPension: 0.4, // 국민연금 수급 연도 비율
      privatePensionWithdrawal: 0.4, // 사적연금 실인출 연도 비율
      privatePensionTaxEfficiency: 0.2, // 사적연금 저율과세 한도 준수도
    },
    privatePensionEffectiveTaxCeiling: 0.1, // 사적연금 실효세율 10%에서 해당 서브점수 0점
    appropriateBequestMonths: 24, // 사망 시 총자산 적정치 = 월 목표생활비 * 24개월(2년치)
    // 아래 두 값은 감이 아니라 하니스 실측으로 골랐다(`npm run harness:personas`, 54인).
    // 재는 것은 corr(효용, MC 성공률) — 목적함수가 계획의 생존율과 같은 방향을 보는가 —
    // 과 「비증액 악화」, 즉 더 쓰라고 하지도 않았는데 성공률을 떨어뜨린 추천의 수다.
    //
    //   S    B    corr    추천가능   악화   비증액 악화
    //   0.7  3    0.629      38       7        2
    //   0.7  5    0.640      37       6        1   ← 채택
    //   0.7  8    0.645      36       6        1
    //   0.6  5    0.664      36       6        1
    //   0.8  5    0.612      37       7        2
    //
    // S를 낮추거나 B를 늘리면 corr는 조금 더 오르지만 추천 가능 건수가 함께 줄어든다.
    // 목표였던 비증액 악화를 1건까지 줄이면서 추천 손실이 가장 적은 지점을 택했다.
    // 남은 악화 6건 중 5건은 SPENDING_INCREASE_GATE가 승인한 의도된 증액이다.
    survivalBaseScore: 0.7, // 완충 0으로 기대수명에 도달한 계획의 원점수
    fullBufferYears: 5, // 완충 여유 5년치면 depletionSafety 만점
    taxBurdenCeiling: 0.3, // 평생 세부담률 30%에서 taxEfficiency 0점
    healthInsuranceCeiling: 0.05, // 건강보험료/총소득 비율 5%에서 관련 페널티 최대
  }
);
