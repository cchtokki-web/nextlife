import { AssetSellOrderStrategy, IsaMaturityDestination, SimulationParams, WithdrawalPlan } from '../../entities/types';
import { NATIONAL_PENSION_NORMAL_START_AGE } from '../pension/nationalPensionRules';

const START_AGE_GRID = [60, 62, 65, 67, 70];
const MONTHLY_TARGET_MULTIPLIERS = [0.6, 0.8, 1.0, 1.2, 1.5];
const NATIONAL_PENSION_START_AGE_GRID = [60, 63, 65, 67, 70]; // 조기~연기수령 그리드
const ASSET_SELL_ORDER_GRID: AssetSellOrderStrategy[] = ['input_order', 'low_dividend_first', 'high_dividend_first'];
const ISA_MATURITY_DESTINATION_GRID: IsaMaturityDestination[] = ['pension', 'asset'];

// 사적연금 인출 정책 + 국민연금 수령 시점 + 자산 매도 순서 + ISA 만기 이동 목적지 후보를 유한 grid로
// 생성한다. 각 차원은 해당 시나리오에 실제로 의미가 있을 때만 확장되고, 그렇지 않으면 단일값으로
// 축소되어 후보 폭증을 막는다(전형적인 시나리오는 기존과 동일한 최대 125개, 자산·ISA가 모두 있는
// 시나리오에서 최대 5×5×5×3×2=750개까지 늘어날 수 있음).
export function generateCandidatePlans(params: SimulationParams): WithdrawalPlan[] {
  const { userProfile, privatePensions = [], nationalPension, assets = [], isaAccounts = [] } = params;
  const { retirementAge, expectancy, targetMonthlySpending } = userProfile;

  const hasPrivatePension = privatePensions.length > 0 && targetMonthlySpending > 0;

  const startAgeCandidates = hasPrivatePension
    ? (() => {
        const grid = Array.from(
          new Set([retirementAge, ...START_AGE_GRID].filter((age) => age >= retirementAge && age < expectancy))
        );
        return grid.length > 0 ? grid : [retirementAge];
      })()
    : [retirementAge];

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

  const totalCombinations =
    startAgeCandidates.length * monthlyTargetCandidates.length * nationalPensionStartAgeCandidates.length *
    assetSellOrderCandidates.length * isaMaturityDestinationCandidates.length;
  if (totalCombinations <= 1) return []; // 탐색할 만한 차원이 전혀 없는 시나리오

  const candidates: WithdrawalPlan[] = [];
  for (const nationalPensionStartAge of nationalPensionStartAgeCandidates) {
    for (const privatePensionStartAge of startAgeCandidates) {
      for (const privatePensionMonthlyTarget of monthlyTargetCandidates) {
        for (const assetSellOrderStrategy of assetSellOrderCandidates) {
          for (const isaMaturityDestination of isaMaturityDestinationCandidates) {
            candidates.push({
              privatePensionStartAge,
              privatePensionMonthlyTarget,
              nationalPensionStartAge,
              assetSellOrderStrategy,
              isaMaturityDestination,
            });
          }
        }
      }
    }
  }
  return candidates;
}
