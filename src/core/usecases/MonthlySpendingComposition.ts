import { SimulationParams, SimulationResult, SimulationYearlyResult } from '../entities/types';
import { spendingMultiplierForAge } from './spending/spendingCurve';

export interface MonthlySpendingComposition {
  age: number;
  // 그해에 필요한 월 생활비(물가·의료비까지 반영한 최종값). 아래 재원들의
  // 합계가 이 값에 못 미친 몫이 shortfall이다.
  //
  // 이 필드가 필요한 이유: 차트는 재원을 쌓아 보여줄 뿐 "얼마 중 얼마"인지는 말하지 않아,
  // 사용자가 빨간 '자산부족' 띠를 봐도 그게 몇 %인지 알 수 없었다. 화면이 목표 금액을
  // 직접 다시 계산하면(물가·의료비 규칙을 복제하면) 반드시 이 함수와 어긋난다.
  targetMonthly: number;
  // **사용자가 입력한 목표 생활비** 기준의 그해 필요액(물가·연령대 배수·의료비 반영).
  //
  // targetMonthly와 갈리는 경우가 「평생 소비 최적화」다. 그때 targetMonthly는 이진탐색이
  // 산출한 지속가능액이라, 사용자가 목표로 세운 금액은 화면 어디에도 남지 않았다. 그래서
  // 리포트에 "목표 월 350만원"과 "부족 생활비 월 0원"이 나란히 찍혔다 — 실제로는 목표보다
  // 월 118만원을 덜 쓰는 계획인데도. 두 기준을 모두 들고 있어야 그 차이를 말할 수 있다.
  goalMonthly: number;
  nationalUsed: number;
  privatePenUsed: number;
  dividendUsed: number;
  otherUsed: number;
  assetWithdrawal: number;
  // 계획(targetMonthly) 대비 부족액. 계획한 금액조차 쓰지 못한 몫이라 자산이 정말 모자란 상태다.
  shortfall: number;
  // 목표(goalMonthly) 대비 부족액. 최적화가 생활비를 낮춰 잡은 몫까지 포함한다.
  goalShortfall: number;
}

// 은퇴 후 연령별 월 생활비를 어떤 재원으로 충당하는지 계산한다.
// 국민연금은 항상 전액, 사적연금은 실제 시뮬레이션 인출액(raw)을 그대로 반영하며(저율과세 한도로
// 인위적으로 자르지 않음 — 초과세 부담 여부는 comprehensiveTaxPaid/healthInsurancePaid 등 별도
// 필드로 확인 가능), 남는 필요분은 배당소득/기타소득 -> 자산인출 -> 자산부족 순으로 채운다.
// 대시보드 차트와 PDF 리포트가 동일한 결과를 보여줘야 하므로 계산 로직을 이 함수 하나로 공유한다.
export function computeMonthlySpendingComposition(
  yearlyResults: SimulationYearlyResult[],
  params: SimulationParams,
  result: SimulationResult
): MonthlySpendingComposition[] {
  const retirementYearsResults = yearlyResults.filter(r => r.age >= params.userProfile.retirementAge);

  return retirementYearsResults.map((r) => {
    const age = r.age;
    const y = age - params.userProfile.currentAge;
    const infRateAnnual = params.inflationRate / 100;

    // 그해 필요액을 만드는 규칙은 하나뿐이다 — 기준 금액만 바꿔 두 번 적용한다.
    // 물가·연령대 배수·의료비 처리가 두 기준에서 갈리면 "목표 대비 부족"이 규칙 차이인지
    // 계획 차이인지 구분할 수 없게 된다.
    const annualNeed = (baseMonthly: number): number => {
      let monthly = params.inflationMode === 'nominal'
        ? baseMonthly * Math.pow(1 + infRateAnnual, y)
        : baseMonthly;

      // 연령대별 배수. 엔진이 실제 지출에 반영한 것과 같은 곡선을 써야 차트의 목표선과
      // 재원 스택이 어긋나지 않는다.
      monthly *= spendingMultiplierForAge(params.spendingCurve, age);

      // 의료비도 그해에 반드시 나가야 하는 필요분이다. r.spending에는 이미 포함되어 있으므로
      // 여기 더하지 않으면, 의료비만큼 커진 실제 지출이 목표를 넘어서면서 실제로는 생활비가
      // 모자란 해까지 부족액 0으로 숨는다.
      // 이미 엔진이 inflationMode를 반영해 계산한 금액이라 물가 보정을 다시 적용하지 않는다.
      return monthly + r.healthcareSpending / 12;
    };

    const planBase = params.spendingStrategy === 'max_sustainable' && result.calculatedTargetSpending !== undefined
      ? result.calculatedTargetSpending
      : params.userProfile.targetMonthlySpending;

    const targetMonthly = annualNeed(planBase);
    const goalMonthly = annualNeed(params.userProfile.targetMonthlySpending);

    const national = Math.round(r.nationalPensionIncome / 12);
    const privatePen = Math.round(r.privatePensionIncome / 12);
    const dividend = Math.round(r.dividendIncome / 12);
    const other = Math.round(r.otherIncome / 12);

    const actualSpendingMonthly = Math.round(r.spending / 12);

    // 국민연금은 실제로 매달 전액 지급되므로 항상 raw 값 그대로 사용
    const nationalUsed = national;

    // 사적연금은 필요한 만큼만 쓰되, 실제 인출된 raw 값을 넘지 않는다
    const remainingAfterNational = Math.max(0, actualSpendingMonthly - nationalUsed);
    const privatePenUsed = Math.min(privatePen, remainingAfterNational);

    // 남은 필요분은 배당소득/기타소득이 raw 한도 내에서 채운다
    const remainingAfterPension = Math.max(0, remainingAfterNational - privatePenUsed);
    const dividendOtherTotal = dividend + other;
    const ratio = dividendOtherTotal > 0 ? Math.min(1, remainingAfterPension / dividendOtherTotal) : 0;
    const dividendUsed = Math.round(dividend * ratio);
    const otherUsed = Math.round(other * ratio);

    // 그래도 부족하면 자산에서 인출하고, 실제로 인출할 자산조차 없으면(시뮬레이션상 지출이 이미 줄어든 만큼) 자산부족으로 표시
    const usedSoFar = nationalUsed + privatePenUsed + dividendUsed + otherUsed;
    const assetWithdrawal = Math.max(0, actualSpendingMonthly - usedSoFar);
    const shortfall = Math.max(0, targetMonthly - actualSpendingMonthly);
    const goalShortfall = Math.max(0, goalMonthly - actualSpendingMonthly);

    return {
      age,
      targetMonthly: Math.round(targetMonthly),
      goalMonthly: Math.round(goalMonthly),
      nationalUsed, privatePenUsed, dividendUsed, otherUsed, assetWithdrawal, shortfall, goalShortfall,
    };
  });
}
