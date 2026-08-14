import { AssetSellOrderStrategy, BaselineWithdrawalPlan, IsaMaturityDestination, SimulationParams, WithdrawalPlan } from '../../entities/types';
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
export function generateCandidatePlans(params: SimulationParams): BaselineWithdrawalPlan[] {
  const { userProfile, privatePensions = [], nationalPension, assets = [], isaAccounts = [] } = params;
  const { retirementAge, expectancy, targetMonthlySpending } = userProfile;

  const hasPrivatePension = privatePensions.length > 0 && targetMonthlySpending > 0;

  // 사적연금 계좌가 **아예 없으면** 이 필드는 값이 무엇이든 시뮬레이션 결과가 같으므로
  // undefined(= 키 없음, 엔진 기본값)를 쓴다. 예전처럼 0을 명시하면 getIdentityPlan이
  // 저장값 없을 때 키를 넣지 않는 것(undefined)과 `0 !== undefined`로 어긋나,
  // computeItemizedContributions가 이를 "바뀐 필드"로 잡고 "사적연금을 월 약 0만원 수준으로
  // 정액 인출합니다 (효용 +0점)"라는 존재하지 않는 할 일을 체크리스트에 띄운다.
  //
  // 조건이 hasPrivatePension이 아니라 `privatePensions.length === 0`인 것은 의도적이다.
  // 계좌는 있는데 목표 생활비만 0인 경우까지 키를 지우면 "정액 0원"이 엔진 기본값(잔여 개월
  // 균등분할)으로 바뀌어 **시뮬레이션 동작 자체가 달라진다** — 두 값이 결과적으로 동등한 것은
  // 계좌가 하나도 없을 때뿐이다.
  const monthlyTargetCandidates: (number | undefined)[] = privatePensions.length === 0
    ? [undefined]
    : hasPrivatePension
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

  const candidates: BaselineWithdrawalPlan[] = [];
  for (const nationalPensionStartAge of nationalPensionStartAgeCandidates) {
    for (const privatePensionMonthlyTarget of monthlyTargetCandidates) {
      for (const assetSellOrderStrategy of assetSellOrderCandidates) {
        for (const isaMaturityDestination of isaMaturityDestinationCandidates) {
          for (const generalAssetWithdrawalStartAge of generalAssetWithdrawalStartAgeCandidates) {
            const candidate: BaselineWithdrawalPlan = {
              nationalPensionStartAge,
              assetSellOrderStrategy,
              isaMaturityDestination,
              generalAssetWithdrawalStartAge,
              monthlySpendingMultiplier: 1, // 생활비 배수는 이 cartesian product에 포함되지 않는다 (별도의
              // generateSpendingAdjustmentCandidates가 담당). 여기서 곱셈 차원으로 끼워 넣으면
              // 후보 수가 그리드 크기만큼 배로 늘어나므로 절대 이 루프에 추가하지 않는다.
            };
            // undefined면 키 자체를 넣지 않는다 — `privatePensionMonthlyTarget: undefined`를
            // 남기면 getIdentityPlan/paramsWithBaselinePlan이 지키는 "키 없음" 규약과
            // 구조 비교·직렬화에서 미묘하게 달라진다.
            if (privatePensionMonthlyTarget !== undefined) {
              candidate.privatePensionMonthlyTarget = privatePensionMonthlyTarget;
            }
            candidates.push(candidate);
          }
        }
      }
    }
  }
  return candidates;
}

// 추천 엔진의 기준선. 개선 여부 판정, 항목별 기여도 계산, Phase 3/4의 baseline이 전부
// 이 계획 위에 세워지므로 사용자의 실제 계획과 정확히 같은 결과를 내야 한다
// (identityPlan.test.ts가 결과 전체 동일성을 증명한다).
//
// 예전에는 params.withdrawalPlan을 **통째로 무시**하고 고정값을 반환했다:
//   - nationalPensionStartAge를 항상 65로 두어, 「최대 연기(70세)」를 고른 사용자의
//     기준선이 65세였다. compileStrategy가 이 필드를 항상 채우므로 전략 패널을 쓴
//     모든 사용자에게 해당됐다.
//   - privatePensionMonthlyTarget을 targetMonthlySpending으로 채워, 엔진 기본값(균등분할)과
//     전혀 다른 계획을 기준선으로 삼았다. "동일 params에서 72점 vs 65점으로 갈린다"는
//     실측이 RecommendationEngine에 기록돼 있고, 그 어긋남을 피하려는 예외 분기가
//     세 곳에 흩어져 있었다.
export function getIdentityPlan(params: SimulationParams): BaselineWithdrawalPlan {
  const { userProfile, withdrawalPlan, privatePensions = [] } = params;
  const { retirementAge } = userProfile;

  const plan: BaselineWithdrawalPlan = {
    nationalPensionStartAge: withdrawalPlan?.nationalPensionStartAge ?? NATIONAL_PENSION_NORMAL_START_AGE,
    assetSellOrderStrategy: withdrawalPlan?.assetSellOrderStrategy ?? 'input_order',
    isaMaturityDestination: withdrawalPlan?.isaMaturityDestination ?? 'pension',
    generalAssetWithdrawalStartAge: withdrawalPlan?.generalAssetWithdrawalStartAge ?? retirementAge,
    monthlySpendingMultiplier: withdrawalPlan?.monthlySpendingMultiplier ?? 1,
  };

  // 저장된 값이 있을 때만 키를 넣는다. undefined를 남기면 JSON 직렬화·구조 비교에서
  // "키가 없는 것"과 미묘하게 달라진다(compileStrategy가 같은 이유로 delete를 쓴다).
  //
  // 사적연금 계좌가 하나도 없으면 저장된 값이 있어도 넣지 않는다 — generateCandidatePlans와
  // 같은 규칙이다. compileStrategy는 계좌 유무를 보지 않고 이 필드를 채우므로(저율과세 한도 ×
  // 전략 비율), 계좌가 없는 사용자의 기준선에도 값이 들어간다. 그 값은 시뮬레이션에 아무
  // 영향도 주지 않지만, 키를 넣지 않는 후보와 비교하면 "바뀐 필드"로 잡혀 AI 추천
  // 체크리스트에 "사적연금을 정액 인출 대신 균등하게 인출합니다 (효용 +0점)"라는 존재하지
  // 않는 할 일이 뜬다. 두 곳이 같은 규칙을 써야 방향과 무관하게 그 소음이 사라진다.
  if (privatePensions.length > 0 && withdrawalPlan?.privatePensionMonthlyTarget !== undefined) {
    plan.privatePensionMonthlyTarget = withdrawalPlan.privatePensionMonthlyTarget;
  }

  return plan;
}

// baseline plan을 params에 얹는다. privatePensionMonthlyTarget이 없으면 키 자체를 넣지
// 않아야 엔진이 기본 동작(잔여 개월 균등분할)을 그대로 쓴다 — undefined 값을 가진 키를
// 남기면 `!== undefined` 검사는 통과시키지 않지만, 구조 비교·직렬화에서 차이를 만든다.
export function paramsWithBaselinePlan(
  params: SimulationParams,
  plan: BaselineWithdrawalPlan
): SimulationParams {
  const withdrawalPlan: WithdrawalPlan = { ...plan };
  if (plan.privatePensionMonthlyTarget === undefined) {
    delete withdrawalPlan.privatePensionMonthlyTarget;
  }
  return { ...params, withdrawalPlan };
}

// 생활비 배수는 5차원 cartesian product에 곱해 넣지 않고(그리드 크기만큼 후보가 배증하므로),
// 5차원 탐색 결과(또는 개선안이 없으면 identity plan) 위에 배수만 얹은 별도의 소규모 후보로 평가한다.
// 추가 비용은 그리드 크기가 아니라 고정 O(그리드 크기)다.
// 1.0(현행)은 baseline/basePlan으로 이미 평가되므로 양쪽 격자에서 모두 제외한다.
const SPENDING_INCREASE_GRID = [1.1, 1.2];

// 하강 후보. 예전에는 증가 방향만 있어서 「자산 최대화」·「상속 최대화」를 고른 사용자에게
// **최적일 수 있는 후보가 아예 생성되지 않았다** — 목표를 바꿔도 argmax가 움직일 여지가 없었다.
//
// 목표별로 분기하지 않고 항상 생성한다. 어느 목표에서든 "덜 쓰는 대신 오래 버틴다"는
// 맞바꿈은 평가할 가치가 있고, 채택 여부는 점수가 정한다. 분기를 두면 목표 개수만큼
// 규칙이 늘고 그 규칙들이 objectivePresets와 조용히 어긋난다.
const SPENDING_DECREASE_GRID = [0.8, 0.9];

export function generateSpendingAdjustmentCandidates(
  params: SimulationParams,
  basePlan: BaselineWithdrawalPlan,
  options: { allowIncrease: boolean; allowDecrease?: boolean }
): BaselineWithdrawalPlan[] {
  // 목표 생활비가 인출액을 결정하지 않는 전략에서는 배수 자체가 무의미하다.
  if ((params.spendingStrategy ?? 'target') !== 'target') return [];
  if (params.userProfile.targetMonthlySpending <= 0) return [];

  const decreaseGrid = options.allowDecrease === false ? [] : SPENDING_DECREASE_GRID;
  const grid = options.allowIncrease
    ? [...decreaseGrid, ...SPENDING_INCREASE_GRID]
    : decreaseGrid;

  return grid.map((multiplier) => ({ ...basePlan, monthlySpendingMultiplier: multiplier }));
}
