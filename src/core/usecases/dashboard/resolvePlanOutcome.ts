import { SimulationParams, SimulationResult } from '../../entities/types';
import { PlanAssetStatus, resolvePlanAssetStatus } from './resolvePlanAssetStatus';
import { SpendingShortfallSpan, summarizeSpendingShortfall } from '../spending/spendingShortfall';

// 계획에서 실제로 일어난 **서로 다른 세 가지 사건**을 한 객체에 모은다.
//
// 화면은 오랫동안 이 셋을 "고갈했는가 / 안 했는가" 하나로 접어 놓았고, 그래서 다음 두
// 상태를 똑같이 "안정적인 노후 자산 유지됨"이라고 말했다:
//
//   (1) 79세에 주식/ETF가 전부 팔려 나가고 이후에는 국민연금 잉여로 현금만 쌓이는 계획.
//       총자산이 0을 찍지 않으므로 depletionAge는 null이다. 하지만 그 사용자에게 79세는
//       "이제 인출할 투자자산이 없다"는 분명한 사건이고, 시장 대응 여지가 사라지는 시점이다.
//   (2) 자산은 끝까지 남지만 매년 계획한 생활비의 70%로 버틴 계획. 인출 경로가 잔액을
//       넘겨 인출하지 않으므로(모든 매도가 Math.min으로 막혀 있다) 총자산은 0이 되지 않고,
//       결손은 unmetSpending에만 남는다(types.ts SimulationYearlyResult.unmetSpending 주석).
//
// 자산 고갈과 생활비 부족은 전혀 다른 사건이며, 처방도 다르다. 이 객체는 그 구분을 화면
// 전체가 공유하도록 한 곳에 둔다.
export interface PlanOutcome {
  // 기존 3값 판정(미보유 / 총자산 고갈 / 유지). 소비처가 많아 그대로 유지한다.
  assetStatus: PlanAssetStatus;
  // 인출 가능한 **투자자산**(주식/ETF + 연금 + ISA)이 0이 된 첫 나이. 현금은 제외한다 —
  // 여기서 쌓이는 현금은 굴리는 자산이 아니라 연금 잉여의 침전물이고, 그것을 포함하면
  // 바로 위 (1)의 사건이 다시 보이지 않게 된다.
  //
  // 은퇴 나이 이후만 본다. 은퇴 전에는 잔액 0에서 월 납입으로 쌓아 올리는 적립 구간이
  // 정상이므로, 그것까지 "소진"으로 부르면 모든 적립식 계획에 없는 사건이 생긴다.
  investableDepletionAge: number | null;
  // 계획한 생활비조차 채우지 못한 해의 집계(엔진 원장 unmetSpending 기준).
  //
  // computeShortfallSummary의 ShortfallReport와 혼동 금지: 저쪽은 **목표 대비** 분석이라
  // 물가·연령 배수·의료비로 필요액을 다시 구성해 goal/plan 두 기준으로 비교한다(그래서
  // 이진탐색 잔차를 거르는 엡실론이 필요하다). 이쪽은 엔진이 실제로 못 채운 금액의 원장이다.
  spendingShortfall: SpendingShortfallSpan | null;
}

export function resolvePlanOutcome(result: SimulationResult, params: SimulationParams): PlanOutcome {
  const assetStatus = resolvePlanAssetStatus(result, params);

  return {
    assetStatus,
    investableDepletionAge: findInvestableDepletionAge(result, params, assetStatus),
    spendingShortfall: summarizeSpendingShortfall(result.yearlyResults),
  };
}

function findInvestableDepletionAge(
  result: SimulationResult,
  params: SimulationParams,
  assetStatus: PlanAssetStatus
): number | null {
  // 소진시킬 투자자산이 애초에 없던 계획에서 "소진"은 성립하지 않는다
  // (resolvePlanAssetStatus가 이미 같은 판단을 내려 두었다).
  if (assetStatus === 'no_investable_asset') return null;

  const { retirementAge } = params.userProfile;
  const investable = (year: SimulationResult['yearlyResults'][number]) =>
    year.stockAssets + year.pensionAssets + year.isaAssets;

  // **가진 적 없는 것은 소진되지 않는다.**
  //
  // 현금만 들고 있는 계획(주식/연금/ISA가 전 구간 0)은 총자산이 넉넉해도 이 합이 늘 0이다.
  // 그 계획에 "60세에 투자자산이 모두 소진"이라고 말하면, 일어난 적 없는 사건을 알리는 것이다 —
  // resolvePlanAssetStatus가 'no_investable_asset'으로 막으려는 것과 같은 종류의 오보다.
  // 그래서 소진 시점 이전에 실제로 잔액이 있었던 해가 있어야만 사건으로 인정한다.
  let hadInvestableAsset = false;
  for (const year of result.yearlyResults) {
    if (investable(year) > 0) {
      hadInvestableAsset = true;
      continue;
    }
    if (hadInvestableAsset && year.age >= retirementAge) return year.age;
  }
  return null;
}
