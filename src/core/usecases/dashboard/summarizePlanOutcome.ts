import type { SimulationYearlyResult } from '../../entities/types';
import { sumYearTaxesAndLevies } from '../tax/annualTaxTotals';

// 한 «계획»의 결정론 원장을 사용자가 비교할 수 있는 몇 개의 숫자로 접는다.
//
// **왜 필요한가.** 추천 카드는 「국민연금 65세 → 60세」처럼 «축»만 말했다. 그런데 그 축이
// 바뀌면 실제로 손에 들어오는 돈이 바뀐다 — 60세 개시는 30% 감액(nationalPensionRules),
// 개시 시점이 밀리면 그 공백을 자산 인출이 메우고, 인출이 늘면 연금소득세와 건강보험료가
// 함께 오른다. 사용자가 「적용」을 누르기 전에 알아야 하는 것은 나이가 아니라 그 결과다.
//
// 여기서 «새로 계산»하지 않는다. 후보를 실제로 시뮬레이션한 원장(StrategySimulationResult)에서
// 읽기만 한다. 산식을 다시 유도하면 카드가 약속한 숫자를 적용된 계획이 재현하지 못한다.
//
// 세금은 sumYearTaxesAndLevies를 쓴다 — 건강보험료를 빼면 「연금을 더 뽑아 건보료를 키우는
// 계획」이 세금이 늘지 않은 것으로 보인다(annualTaxTotals 주석).
export interface StrategyPlanOutcome {
  /** 은퇴 후 연평균 자산 인출액(모든 계좌, 세전 총액). */
  averageAnnualWithdrawal: number;
  /** 은퇴 후 연평균 세금 + 건강보험료. */
  averageAnnualTaxAndLevy: number;
  /**
   * 국민연금을 처음 받는 해의 «세후» 월 수령액. 감액·가산과 연금소득세가 모두 반영된 값이다.
   *
   * 수령 이력이 아예 없으면(국민연금 미입력, 또는 개시 나이가 계획 종료 뒤) null이다.
   * 0으로 접지 않는다 — 「받지 않는다」와 「0원을 받는다」는 다른 사실이고, 후자를 화면에
   * 찍으면 국민연금이 없는 사용자에게 「월 0원」이라는 없는 항목이 생긴다.
   */
  nationalPensionFirstAge: number | null;
  nationalPensionMonthlyNet: number | null;
}

export function summarizePlanOutcome(
  yearlyResults: readonly SimulationYearlyResult[],
  retirementAge: number,
): StrategyPlanOutcome {
  const retired = yearlyResults.filter((year) => year.age >= retirementAge);
  const average = (pick: (year: SimulationYearlyResult) => number): number =>
    retired.length > 0
      ? retired.reduce((sum, year) => sum + pick(year), 0) / retired.length
      : 0;

  // 「처음 받는 해」는 computePensionGapRisk·computeExpertAnalytics가 쓰는 것과 같은 판정이다
  // (수령액 > 0인 첫 해). 개시 «설정» 나이가 아니라 원장이 실제로 지급한 해를 본다.
  const firstPensionYear = yearlyResults.find((year) => year.nationalPensionIncome > 0);

  return {
    averageAnnualWithdrawal: average((year) => year.withdrawal),
    averageAnnualTaxAndLevy: average(sumYearTaxesAndLevies),
    nationalPensionFirstAge: firstPensionYear?.age ?? null,
    nationalPensionMonthlyNet: firstPensionYear === undefined
      ? null
      : firstPensionYear.nationalPensionIncome / 12,
  };
}
