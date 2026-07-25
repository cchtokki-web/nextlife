import { AssetSellOrderStrategy, CompleteWithdrawalPlan, IsaMaturityDestination, SimulationParams } from '../../entities/types';
import { NATIONAL_PENSION_NORMAL_START_AGE } from '../pension/nationalPensionRules';

// 각 그리드는 3점(또는 이진) 수준으로 유지한다 — 5개 차원의 완전 조합(cartesian product)이라
// 그리드 하나를 늘릴 때마다 후보 수가 곱셈으로 증가하기 때문이다(privatePensionStartAge를
// 포함해 6개 차원이던 시절, 5점 그리드로 실측한 결과 5×5×5×3×2×5=3750개 조합에서
// recommendStrategy가 약 8초 소요되어 실사용에 부적합했다). 3점 그리드 기준으로도,
// generalAssetWithdrawalStartAgeCandidates는 `[retirementAge, ...GRID]`를 `age >= retirementAge`로
// 필터링하는 방식이라, retirementAge가 그리드 최솟값(62)보다 작을 때만 seed가 추가로 살아남아
// 4개가 된다(그리드 점들 사이/이후에 있으면 오히려 3개 이하로 줄어든다). 따라서 최악의 경우는
// 3×3×3×2×3=162개가 아니라 3×3×3×2×4=216개다(retirementAge가 62 미만인 경우). 이 최악
// 시나리오 기준 성능은 RecommendationEngine.performance.test.ts에서 검증한다.
const MONTHLY_TARGET_MULTIPLIERS = [0.8, 1.0, 1.3];
const NATIONAL_PENSION_START_AGE_GRID = [60, 65, 70]; // 조기~기본~연기수령
const ASSET_SELL_ORDER_GRID: AssetSellOrderStrategy[] = ['input_order', 'low_dividend_first', 'high_dividend_first'];
const ISA_MATURITY_DESTINATION_GRID: IsaMaturityDestination[] = ['pension', 'asset'];
const GENERAL_ASSET_WITHDRAWAL_START_AGE_GRID = [62, 65, 70];
export function generateCandidatePlans(params: SimulationParams): CompleteWithdrawalPlan[] {
  const { userProfile, privatePensions = [], nationalPension, assets = [], isaAccounts = [] } = params;
  const { retirementAge, expectancy, targetMonthlySpending } = userProfile;

  const hasPrivatePension = privatePensions.length > 0 && targetMonthlySpending > 0;

  const monthlyTargetCandidates = hasPrivatePension
    ? MONTHLY_TARGET_MULTIPLIERS.map((m) => Math.round(targetMonthlySpending * m))
    : [0];

  // 국민연금 수령액이 0이면 시점을 바꿔도 의미가 없으므로 기본값(65세) 단일 후보만 사용해
  // 불필요한 후보 폭증을 막는다.
  const nationalPensionStartAgeCandidates = (nationalPension?.expectedMonthlyAmount ?? 0) > 0
    ? NATIONAL_PENSION_START_AGE_GRID
    : [NATIONAL_PENSION_NORMAL_START_AGE];

  // 자산이 2개 이상이어야 매도 "순서"가 의미를 가진다.
  const assetSellOrderCandidates: AssetSellOrderStrategy[] = assets.length >= 2
    ? ASSET_SELL_ORDER_GRID
    : ['input_order'];

  // ISA·사적연금·일반자산이 모두 있어야 "어느 쪽으로 보낼지" 선택할 대상이 둘 다 존재한다.
  const isaMaturityDestinationCandidates: IsaMaturityDestination[] =
    isaAccounts.length > 0 && privatePensions.length > 0 && assets.length > 0
      ? ISA_MATURITY_DESTINATION_GRID
      : ['pension'];

  // 자산이 없으면 인출을 지연시킬 대상 자체가 없다.
  const generalAssetWithdrawalStartAgeCandidates = assets.length > 0
    ? (() => {
        const grid = Array.from(
          new Set([retirementAge, ...GENERAL_ASSET_WITHDRAWAL_START_AGE_GRID].filter((age) => age >= retirementAge && age < expectancy))
        );
        return grid.length > 0 ? grid : [retirementAge];
      })()
    : [retirementAge];

  const totalCombinations =
    monthlyTargetCandidates.length * nationalPensionStartAgeCandidates.length *
    assetSellOrderCandidates.length * isaMaturityDestinationCandidates.length * generalAssetWithdrawalStartAgeCandidates.length;
  if (totalCombinations <= 1) return []; // 탐색할 만한 차원이 전혀 없는 시나리오

  const candidates: CompleteWithdrawalPlan[] = [];
  for (const nationalPensionStartAge of nationalPensionStartAgeCandidates) {
    for (const privatePensionMonthlyTarget of monthlyTargetCandidates) {
      for (const assetSellOrderStrategy of assetSellOrderCandidates) {
        for (const isaMaturityDestination of isaMaturityDestinationCandidates) {
          for (const generalAssetWithdrawalStartAge of generalAssetWithdrawalStartAgeCandidates) {
            candidates.push({
              privatePensionMonthlyTarget,
              nationalPensionStartAge,
              assetSellOrderStrategy,
              isaMaturityDestination,
              generalAssetWithdrawalStartAge,
              monthlySpendingMultiplier: 1, // 생활비 배수는 이 cartesian product에 포함되지 않는다 (별도의
              // generateSpendingAdjustmentCandidates가 담당). 여기서 곱셈 차원으로 끼워 넣으면
              // 후보 수가 그리드 크기만큼 배로 늘어나므로 절대 이 루프에 추가하지 않는다.
            });
          }
        }
      }
    }
  }
  return candidates;
}

// 5차원 그리드가 전혀 개선안을 찾지 못했을 때, 생활비 배수 후보(아래 generateSpendingAdjustmentCandidates)의
// 베이스로 쓰기 위한 "baseline과 동등한" 완결 plan. 각 필드는 SimulationEngine이 WithdrawalPlan 필드
// 미지정 시 쓰는 기본값과 동일하다.
export function getIdentityPlan(params: SimulationParams): CompleteWithdrawalPlan {
  const { userProfile, privatePensions = [] } = params;
  const { retirementAge, targetMonthlySpending } = userProfile;
  const hasPrivatePension = privatePensions.length > 0 && targetMonthlySpending > 0;

  return {
    privatePensionMonthlyTarget: hasPrivatePension ? targetMonthlySpending : 0,
    nationalPensionStartAge: NATIONAL_PENSION_NORMAL_START_AGE,
    assetSellOrderStrategy: 'input_order',
    isaMaturityDestination: 'pension',
    generalAssetWithdrawalStartAge: retirementAge,
    monthlySpendingMultiplier: 1,
  };
}

// 생활비 배수는 5차원 cartesian product에 곱해 넣지 않고(그리드 크기만큼 후보가 배증하므로),
// 5차원 탐색 결과(또는 개선안이 없으면 identity plan) 위에 배수만 얹은 별도의 소규모 후보로 평가한다.
// 추가 비용은 그리드 크기가 아니라 고정 O(그리드 크기)다.
const MONTHLY_SPENDING_MULTIPLIER_GRID = [1.1, 1.2]; // 1.0(현행)은 baseline/basePlan으로 이미 평가되므로 제외

export function generateSpendingAdjustmentCandidates(
  params: SimulationParams,
  basePlan: CompleteWithdrawalPlan,
  options: { allowIncrease: boolean }
): CompleteWithdrawalPlan[] {
  if (!options.allowIncrease) return [];
  if ((params.spendingStrategy ?? 'target') !== 'target') return [];
  if (params.userProfile.targetMonthlySpending <= 0) return [];

  return MONTHLY_SPENDING_MULTIPLIER_GRID.map((multiplier) => ({ ...basePlan, monthlySpendingMultiplier: multiplier }));
}
