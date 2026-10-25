import type { SimulationYearlyResult } from '../../entities/types';

// 「사적연금 소득이 왜 생활비를 채운 금액보다 작은가」.
//
// **왜 필요한가.** 사적연금은 인출할 때 연령별 저율(3.3~5.5%)로 원천징수하고, 연말에 그해
// 총 인출액 기준으로 실제 세액을 다시 계산해 차액을 마저 걷는다. 그 정산은 생활비가 이미
// 지출된 뒤에 «자산 매도»로 이뤄지므로, 화면의 사적연금 소득은 그 차액까지 뺀 값인 반면
// 그해 생활비를 실제로 채운 돈은 그보다 크다.
//
// 실제로 이 격차가 리포트에서 「연 2,697만원 수령」과 「월 73만원 부족」이라는, 서로 빼면
// 맞지 않는 두 숫자를 만들었다(3,600 − 2,697 = 903만원 = 월 75만원). 두 값 다 옳고 원장도
// 보존식을 만족하지만, 차이를 설명하는 문장이 어디에도 없어 사용자에게는 계산 오류로 보인다.
//
// 화면(IncomeCompositionChart)과 PDF가 이 함수 하나를 공유한다 — 숫자를 설명하는 문장이
// 두 벌이면 같은 계획의 두 문서가 다른 이야기를 한다.

export interface PrivatePensionTaxSettlement {
  fromAge: number;
  toAge: number;
  /** 정산이 일어난 해 중 가장 큰 연말 징수액. 「연 최대 N원」으로 말한다. */
  maxAnnualAmount: number;
  /** 화면·PDF가 그대로 찍는 문장. */
  sentence: string;
}

// 표시 단위(만원) 아래의 정산은 화면에서 0만원으로 찍히므로 문장을 만들지 않는다.
const NEGLIGIBLE_SETTLEMENT = 10_000;

export function describePrivatePensionTaxSettlement(
  yearlyResults: readonly SimulationYearlyResult[],
  formatValue: (value: number) => string,
): PrivatePensionTaxSettlement | null {
  // 옛 결과에는 이 필드가 없다. 그때는 격차를 «측정하지 못한» 것이지 0인 것이 아니므로,
  // 없는 숫자로 문장을 지어내지 않고 아무 말도 하지 않는다.
  const settled = yearlyResults.filter(
    (year) => (year.privatePensionYearEndTaxAdjustment ?? 0) >= NEGLIGIBLE_SETTLEMENT,
  );
  if (settled.length === 0) return null;

  const fromAge = settled[0].age;
  const toAge = settled[settled.length - 1].age;
  const maxAnnualAmount = Math.max(
    ...settled.map((year) => year.privatePensionYearEndTaxAdjustment ?? 0),
  );
  // 구간이 이어져 있다고 단정하지 않는다 — 중간에 정산이 없는 해가 끼어 있을 수 있으므로
  // 「A~B세」가 아니라 「A세부터 B세 사이」라고 적는다.
  const range = fromAge === toAge ? `${fromAge}세에는` : `${fromAge}세부터 ${toAge}세 사이에는`;

  return {
    fromAge,
    toAge,
    maxAnnualAmount,
    sentence: `${range} 사적연금 저율과세 한도를 넘긴 몫의 세금(연 최대 ${formatValue(maxAnnualAmount)})을`
      + ' 연말에 자산에서 따로 냅니다. 위 사적연금 금액은 그 정산까지 뺀 세후 소득이라,'
      + ' 그해 생활비를 실제로 채운 금액보다 그만큼 작습니다.',
  };
}
