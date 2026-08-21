import type { ItemizedContributionField } from '../../../core/entities/types';

// 자동 채움(AI 센티널)이 계산에 넣은 축의 사람이 읽는 이름.
//
// **이 표가 필요한 이유.** applyAiSentinels는 사용자가 미정으로 둔 축을 추천값으로 채워
// engine.run에 넘긴다 — 즉 화면에 찍힌 숫자는 사용자가 입력한 적 없는 값을 포함한다.
// 예전에는 추천 체크리스트의 "이미 반영됨" 블록이 그 사실을 말했다. 그 블록을 없앤 뒤에도
// 진단 카드가 같은 사실을 말해야 "화면이 말하는 값 ≠ 엔진이 쓴 값" 상태로 돌아가지 않는다.
//
// SENTINEL_AXES(verifiedSentinelPlan.ts)가 채울 수 있는 축과 같은 집합을 덮는다. appliedFields의
// 타입은 그보다 넓은 ItemizedContributionField라 표에 없는 값이 올 수 있고, 그때는 이름을
// 지어내지 않고 조용히 생략한다 — 틀린 이름을 붙이는 것보다 낫다.
const SENTINEL_AXIS_LABELS: Partial<Record<ItemizedContributionField, string>> = {
  nationalPensionStartAge: '국민연금 개시 나이',
  privatePensionMonthlyTarget: '사적연금 월 인출액',
  isaMaturityDestination: 'ISA 만기 자금 이전처',
  assetSellOrderStrategy: '자산 매도 순서',
  generalAssetWithdrawalStartAge: '일반계좌 인출 개시 나이',
  // 인출계획 축이 아니라 자산 배열 안의 값이지만, 자동 채움이 계산에 넣는다는 점은 같다.
  assetReinvestment: '배당 재투자',
};

export function describeSentinelAxes(
  appliedFields: ReadonlyArray<ItemizedContributionField>
): string[] {
  return appliedFields
    .map((field) => SENTINEL_AXIS_LABELS[field])
    .filter((label): label is string => label !== undefined);
}
