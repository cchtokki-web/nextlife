import { SimulationResult } from '../../entities/types';

// 계획이 놓인 자산 상태. 화면 문구·차트·추천 카드가 전부 이 하나의 판정을 근거로 삼는다.
//
// 'no_investable_asset'이 별도 상태로 필요한 이유:
// 엔진은 `totalAssets <= 0`인 첫 해를 고갈로 판정한다(SimulationEngine의 depletionAge 대입).
// 그래서 투자자산·사적연금·ISA를 하나도 등록하지 않은 사용자는 시뮬레이션 **첫 해**에
// depletionAge가 잡히고, 화면 전체가 "51세에 자산이 고갈될 위험이 있습니다"라고 말한다.
// 그 사용자에게는 고갈시킬 자산 자체가 없다 — 고갈이 아니라 미보유이고, 처방도 다르다
// (인출 전략 조정이 아니라 저축·생활비·은퇴 시점이다).
export type PlanAssetStatus = 'no_investable_asset' | 'depleted' | 'sustained';

export function resolvePlanAssetStatus(result: SimulationResult): PlanAssetStatus {
  const { yearlyResults, depletionAge, householdEndAge } = result;

  // 판정 근거를 "시작 시점 자산이 0인가"가 아니라 시뮬레이션이 실제로 돈 결과 전체로 둔다.
  // 시작 시점만 보면 잔액 0에서 월 납입으로 자산을 쌓다가 나중에 고갈되는 적립식 계획까지
  // 미보유로 잘못 분류된다. 비교 대상 필드(totalAssets)와 연산자(<= 0)는 엔진의 고갈 판정과
  // 같은 것을 쓴다 — 두 판정이 어긋날 수 없게 하기 위해서다.
  //
  // 빈 배열을 제외하는 이유: `every`는 공허하게 참이라, 엔진이 조기 반환한 결과
  // (yearlyResults: [])가 자산 유무와 무관하게 미보유로 뒤집힌다.
  if (yearlyResults.length > 0 && yearlyResults.every((y) => y.totalAssets <= 0)) {
    return 'no_investable_asset';
  }

  // 고갈 여부는 본인 기대수명이 아니라 가구 종료 나이와 비교한다(heroHeadline·
  // generateChartCaptions와 같은 관례). 가구 종료 나이에 이르러서야 잔액이 0이 된 것은
  // 계획대로 다 쓰고 간 것이지 실패가 아니다.
  if (depletionAge !== null && depletionAge < householdEndAge) return 'depleted';

  return 'sustained';
}
