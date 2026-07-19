import { SimulationParams, SimulationResult, SimulationYearlyResult } from '../entities/types';

export interface MonthlySpendingComposition {
  age: number;
  nationalUsed: number;
  privatePenUsed: number;
  dividendUsed: number;
  otherUsed: number;
  assetWithdrawal: number;
  shortfall: number;
}

// 은퇴 후 연령별 월 생활비를 어떤 재원으로 충당하는지 계산한다.
// 국민연금은 항상 전액, 사적연금은 필요한 만큼만 쓰되 저율과세 한도를 절대 넘지 않고,
// 남는 필요분은 배당소득/기타소득 -> 자산인출 -> 자산부족 순으로 채운다.
// 대시보드 차트와 PDF 리포트가 동일한 결과를 보여줘야 하므로 계산 로직을 이 함수 하나로 공유한다.
export function computeMonthlySpendingComposition(
  yearlyResults: SimulationYearlyResult[],
  params: SimulationParams,
  result: SimulationResult
): MonthlySpendingComposition[] {
  const retirementYearsResults = yearlyResults.filter(r => r.age >= params.userProfile.retirementAge);

  const rawPensionLimit = params.taxSettings?.privatePensionLimit ?? 15000000;
  const monthlyPensionLimit = params.displayCurrency === 'USD'
    ? (rawPensionLimit / 12) / params.baseExchangeRate
    : rawPensionLimit / 12;

  return retirementYearsResults.map((r) => {
    const age = r.age;
    const y = age - params.userProfile.currentAge;
    const infRateAnnual = params.inflationRate / 100;

    let targetMonthly = 0;
    if (params.spendingStrategy === 'max_sustainable' && result.calculatedTargetSpending !== undefined) {
      targetMonthly = result.calculatedTargetSpending;
    } else {
      targetMonthly = params.userProfile.targetMonthlySpending;
    }

    if (params.inflationMode === 'nominal') {
      targetMonthly = targetMonthly * Math.pow(1 + infRateAnnual, y);
    }

    const national = Math.round(r.nationalPensionIncome / 12);
    const privatePen = Math.round(r.privatePensionIncome / 12);
    const dividend = Math.round(r.dividendIncome / 12);
    const other = Math.round(r.otherIncome / 12);

    const actualSpendingMonthly = Math.round(r.spending / 12);

    // 국민연금은 실제로 매달 전액 지급되므로 항상 raw 값 그대로 사용
    const nationalUsed = national;

    // 사적연금은 필요한 만큼만 쓰되, 저율과세 한도를 절대 넘지 않는다
    const remainingAfterNational = Math.max(0, actualSpendingMonthly - nationalUsed);
    const privatePenUsed = Math.min(privatePen, monthlyPensionLimit, remainingAfterNational);

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

    return { age, nationalUsed, privatePenUsed, dividendUsed, otherUsed, assetWithdrawal, shortfall };
  });
}
