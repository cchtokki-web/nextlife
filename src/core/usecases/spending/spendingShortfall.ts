import { SimulationYearlyResult } from '../../entities/types';

// "계획한 생활비를 채우지 못한 해"의 판정식과 집계를 두는 단일 지점.
//
// 지금 네 곳이 각자 `unmetSpending > 0`을 적고 있다 — SimulationEngine.meetsSustainabilityGoal,
// MonteCarloEngine.summarize, computeSensitivityAnalysis(시나리오·기준선 각 1회). 새 지표
// (생활 유지 성공률)가 그중 하나만 바꾸면 「지속 가능 생활비 역산」과 「생활 유지 성공률」이
// 서로 다른 정의 위에 서게 되고, 화면은 "이만큼 쓸 수 있다"와 "그 금액을 다 쓸 확률"을
// 다른 자로 잰 채 나란히 보여준다.
//
// **엡실론을 두지 않는다.** computeShortfallSummary의 SHORTFALL_EPSILON_MONTHLY(1만원)는
// 이진탐색 잔차가 **목표 대비 재구성 비교**에 새는 것을 막는 값이다. unmetSpending은 그와
// 달리 인출 경로가 정확히 0으로 닫아 두는 원장값이라(잔여 부족분을 명시적으로 0 대입) 잔차가
// 없다. 여기에 엡실론을 넣으면 meetsSustainabilityGoal의 판정이 이동해 max_sustainable
// 역산 금액이 앱 전체에서 바뀐다.
export interface SpendingShortfallSpan {
  years: number;
  firstAge: number;
  lastAge: number;
}

export function hasSpendingShortfall(year: SimulationYearlyResult): boolean {
  return year.unmetSpending > 0;
}

// 부족한 해가 하나도 없으면 null. 연속 구간이 아니라 **부족한 해 전체**를 세고, 처음과 마지막
// 나이를 함께 돌려준다 — 중간에 회복했다가 다시 부족해지는 계획에서 "60~64세 + 80~90세"를
// "60~90세 31년"으로 뭉개지 않기 위해 years는 실제 해의 수다.
export function summarizeSpendingShortfall(
  yearlyResults: readonly SimulationYearlyResult[]
): SpendingShortfallSpan | null {
  const years = yearlyResults.filter(hasSpendingShortfall);
  if (years.length === 0) return null;

  return {
    years: years.length,
    firstAge: years[0].age,
    lastAge: years[years.length - 1].age,
  };
}
