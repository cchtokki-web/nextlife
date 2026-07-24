import { SimulationParams, SimulationResult } from '../../entities/types';

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

  const isDepleted = depletionAge !== null && depletionAge < expectancy;
  const firstAgeWithNationalPension = yearlyResults.find((y) => y.nationalPensionIncome > 0)?.age ?? null;

  const pensionLimit = params.taxSettings?.privatePensionLimit ?? 15000000;
  const hasHighPrivatePensionRisk = yearlyResults.some(
    (y) => y.privatePensionIncome + y.pensionTaxPaid > pensionLimit
  );

  return {
    assetGrowth: buildAssetGrowthCaption(isDepleted, depletionAge, firstAgeWithNationalPension, expectancy),
    incomeComposition: buildIncomeCompositionCaption(firstAgeWithNationalPension),
    spendingComposition: buildSpendingCompositionCaption(hasHighPrivatePensionRisk),
  };
}

function buildAssetGrowthCaption(
  isDepleted: boolean,
  depletionAge: number | null,
  firstAgeWithNationalPension: number | null,
  expectancy: number
): string {
  if (isDepleted && depletionAge !== null) {
    return `${depletionAge}세에 자산이 고갈될 것으로 예상됩니다.`;
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

function buildSpendingCompositionCaption(hasHighPrivatePensionRisk: boolean): string {
  if (hasHighPrivatePensionRisk) {
    return '사적연금 저율과세 한도를 초과하는 구간이 있어 세금 부담이 늘어날 수 있습니다.';
  }
  return '은퇴 후 생활비는 연금과 배당소득으로 안정적으로 충당됩니다.';
}
