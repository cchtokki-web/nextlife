import { SimulationParams, SimulationResult } from '../../entities/types';
import { PlanOutcome, resolvePlanOutcome } from './resolvePlanOutcome';

export interface ChartCaptions {
  assetGrowth: string; // 자산 추이 차트 위에 표시할 한 줄 요약
  incomeComposition: string; // 연령별 소득원 구성 차트 위에 표시할 한 줄 요약
  spendingComposition: string; // 월 생활비 재원 구성 차트 위에 표시할 한 줄 요약
}

// 이미 DashboardSection에서 계산만 되고 화면에 렌더링되지 않던 값들(firstAgeWithNationalPension/
// pensionGapYears/everComprehensiveTax/hasHighPrivatePensionRisk 등)과 동일한 규칙으로 캡션을
// 생성한다. 새 LLM 호출을 추가하지 않고 이미 계산된 yearlyResults만으로 rule-based하게 만든다.
export function generateChartCaptions(result: SimulationResult, params: SimulationParams): ChartCaptions {
  const { yearlyResults, depletionAge } = result;
  const { expectancy } = params.userProfile;

  // 고갈 판정 규칙을 여기서 재유도하지 않고 resolvePlanAssetStatus 한 곳에 맡긴다 —
  // 같은 result에서 파생되므로 화면의 다른 조각(헤드라인·로드맵)과 반드시 같은 상태를 본다.
  const outcome = resolvePlanOutcome(result, params);
  const firstAgeWithNationalPension = yearlyResults.find((y) => y.nationalPensionIncome > 0)?.age ?? null;

  const pensionLimit = params.taxSettings?.privatePensionLimit ?? 15000000;
  const hasHighPrivatePensionRisk = yearlyResults.some(
    (y) => y.privatePensionIncome + y.pensionTaxPaid > pensionLimit
  );

  return {
    assetGrowth: buildAssetGrowthCaption(
      outcome, depletionAge, result.endingAssets, firstAgeWithNationalPension, expectancy
    ),
    incomeComposition: buildIncomeCompositionCaption(firstAgeWithNationalPension),
    spendingComposition: buildSpendingCompositionCaption(hasHighPrivatePensionRisk, outcome),
  };
}

function buildAssetGrowthCaption(
  outcome: PlanOutcome,
  depletionAge: number | null,
  endingAssets: number,
  firstAgeWithNationalPension: number | null,
  expectancy: number
): string {
  // 자산이 하나도 없으면 "고갈"도 "유지"도 성립하지 않는다. 예전에는 엔진이 첫 해에 잡은
  // depletionAge가 그대로 "51세에 자산이 고갈될 것으로 예상됩니다"로 나갔다.
  if (outcome.assetStatus === 'no_investable_asset') {
    return '등록된 투자자산이 없어 자산 잔액은 0원으로 유지됩니다.';
  }

  // **차트의 V자를 설명한다.** 총자산이 0을 찍고도 기말 잔액이 남아 있으면, 그 사이에
  // 연금 잉여가 현금으로 쌓인 것이다. 이 문장이 없으면 사용자는 그래프를 계산 오류로 읽는다
  // (리뷰에서 실제로 지적된 지점 — 79세 0원 → 90세 1,396만원).
  if (depletionAge !== null && endingAssets > 0) {
    return (
      `${depletionAge}세에 총자산이 0원까지 내려가지만, 국민연금이 생활비를 넘어서는 구간의 ` +
      '잉여가 현금으로 쌓여 이후 잔액이 다시 늘어납니다.'
    );
  }

  if (outcome.assetStatus === 'depleted' && depletionAge !== null) {
    return `${depletionAge}세에 자산이 고갈될 것으로 예상됩니다.`;
  }

  // 총자산은 유지돼도 «인출할 투자자산»이 사라지는 시점은 따로 있다. 그 시점 이후에는
  // 시장이 어떻게 움직이든 계획을 조정할 여지가 없어지므로 사용자가 알아야 한다.
  if (outcome.investableDepletionAge !== null) {
    return (
      `${outcome.investableDepletionAge}세에 투자자산이 모두 소진되어, 이후에는 연금과 현금으로 ` +
      '생활합니다.'
    );
  }

  if (firstAgeWithNationalPension !== null) {
    return `${firstAgeWithNationalPension}세부터 국민연금 수령이 시작되며 자산 감소세가 완화됩니다.`;
  }
  return `기대수명(${expectancy}세)까지 자산이 고갈되지 않고 유지됩니다.`;
}

function buildIncomeCompositionCaption(firstAgeWithNationalPension: number | null): string {
  if (firstAgeWithNationalPension !== null) {
    return `${firstAgeWithNationalPension}세 이후 국민연금 수령이 시작되며 생활비의 상당 부분을 연금이 충당해 소득이 안정됩니다.`;
  }
  return '국민연금 없이 사적연금·배당·기타소득으로 생활비를 충당합니다.';
}

function buildSpendingCompositionCaption(
  hasHighPrivatePensionRisk: boolean,
  outcome: PlanOutcome
): string {
  // 부족 구간이 있는데 "안정적으로 충당됩니다"라고 말하면, 바로 아래 차트의 빨간 띠와
  // 캡션이 정면으로 모순된다. 부족을 가장 먼저 말한다.
  if (outcome.spendingShortfall) {
    return (
      `${outcome.spendingShortfall.firstAge}세부터 ${outcome.spendingShortfall.years}년간 계획한 ` +
      '생활비를 재원으로 채우지 못하는 구간이 있습니다.'
    );
  }
  if (hasHighPrivatePensionRisk) {
    return '사적연금 저율과세 한도를 초과하는 구간이 있어 세금 부담이 늘어날 수 있습니다.';
  }
  return '은퇴 후 생활비는 연금과 배당소득으로 안정적으로 충당됩니다.';
}
