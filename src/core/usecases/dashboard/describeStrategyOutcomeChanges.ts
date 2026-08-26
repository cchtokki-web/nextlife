import type { StrategyPlanOutcome } from './summarizePlanOutcome';

// 「이 추천을 적용하면 실제 숫자가 어떻게 되나」.
//
// describeStrategyChanges가 «설정»의 전후를 말한다면(국민연금 65세 → 60세), 이 함수는 그
// 설정 변경이 만든 «결과»의 전후를 말한다(국민연금 월 187만원 → 월 132만원).
//
// 두 함수를 나누는 이유: 설정 축은 사용자가 되돌릴 수 있는 조작이고 결과는 그 조작의 대가라,
// 화면에서 서로 다른 자리에 서야 한다. 그리고 설정 축은 후보의 strategy만 있으면 서술되지만
// 결과는 «시뮬레이션된 원장»이 있어야 나온다(StrategyPlanOutcome).
//
// 화면(StrategyRecommendationCards)과 PDF가 이 함수 하나를 공유한다 — describeStrategyChanges와
// 같은 이유다. 서술을 두 벌 두면 같은 계획의 두 문서가 다른 금액을 말한다.

export type StrategyOutcomeChangeKey =
  | 'nationalPensionMonthly'
  | 'annualWithdrawal'
  | 'annualTaxAndLevy';

export interface StrategyOutcomeChange {
  key: StrategyOutcomeChangeKey;
  label: string;
  before: string;
  after: string;
  /** 후(after) − 전(before). 화면이 증감 색을 정하는 데 쓴다. 0이면 이 행은 만들어지지 않는다. */
  difference: number;
  /**
   * 이 항목이 늘어난 것이 사용자에게 좋은 일인가. 금액의 부호만으로는 알 수 없어 항목이
   * 직접 말한다 — 국민연금 수령액은 오르는 편이 좋고, 자산 인출액은 좋고 나쁨을 단정할 수
   * 없다(같은 생활비를 더 적게 인출해 만들면 좋고, 연금이 늦어 자산을 헐어 쓰면 나쁘다).
   *
   * 'neutral'이면 화면은 증감을 색으로 칠하지 않고 방향만 적는다.
   */
  direction: 'higher_is_better' | 'lower_is_better' | 'neutral';
}

// 표시 단위(만원) 아래의 차이는 화면에서 같은 숫자로 찍히므로 행을 만들지 않는다.
// 「달라지는 점」이라고 적어 놓고 같은 값을 두 번 보여주면 사용자는 무엇이 바뀌었는지
// 되레 알 수 없다.
const NEGLIGIBLE_DIFFERENCE = 10_000;

export function describeStrategyOutcomeChanges(
  before: StrategyPlanOutcome | undefined,
  after: StrategyPlanOutcome | undefined,
  formatValue: (value: number) => string,
): StrategyOutcomeChange[] {
  if (!before || !after) return [];

  const changes: StrategyOutcomeChange[] = [];

  // 국민연금은 «개시 나이와 함께» 적는다. 개시 나이가 달라지면 두 금액은 서로 다른 해의
  // 첫 수령액이라, 나이를 빼고 금액만 나란히 놓으면 명목 모드에서 물가상승분이 연기 가산으로
  // 오해된다. 나이를 붙여 두면 문장이 스스로 기준을 밝힌다.
  const pensionMonthly = (outcome: StrategyPlanOutcome): string | null => (
    outcome.nationalPensionMonthlyNet === null || outcome.nationalPensionFirstAge === null
      ? null
      : `${outcome.nationalPensionFirstAge}세부터 월 ${formatValue(outcome.nationalPensionMonthlyNet)}`
  );
  const beforePension = pensionMonthly(before);
  const afterPension = pensionMonthly(after);
  // 한쪽만 수령하는 계획은 비교가 아니라 «없던 소득이 생겼다/사라졌다»이고, 그 사실은
  // 개시 나이 축(describeStrategyChanges)이 이미 말한다. 금액 비교는 양쪽이 다 있을 때만 한다.
  if (beforePension !== null && afterPension !== null) {
    const difference = (after.nationalPensionMonthlyNet ?? 0) - (before.nationalPensionMonthlyNet ?? 0);
    // 월액이라 만원 문턱은 과하다. 개시 나이가 같고 금액도 같으면 아예 같은 문자열이 된다.
    if (beforePension !== afterPension) {
      changes.push({
        key: 'nationalPensionMonthly',
        label: '국민연금 실수령액(세후)',
        before: beforePension,
        after: afterPension,
        difference,
        direction: 'higher_is_better',
      });
    }
  }

  const numeric = (
    key: StrategyOutcomeChangeKey,
    label: string,
    pick: (outcome: StrategyPlanOutcome) => number,
    direction: StrategyOutcomeChange['direction'],
  ) => {
    const difference = pick(after) - pick(before);
    if (Math.abs(difference) < NEGLIGIBLE_DIFFERENCE) return;
    changes.push({
      key,
      label,
      before: formatValue(pick(before)),
      after: formatValue(pick(after)),
      difference,
      direction,
    });
  };

  numeric(
    'annualWithdrawal',
    '은퇴 후 연평균 자산 인출액',
    (outcome) => outcome.averageAnnualWithdrawal,
    'neutral',
  );
  numeric(
    'annualTaxAndLevy',
    '은퇴 후 연평균 세금·건강보험료',
    (outcome) => outcome.averageAnnualTaxAndLevy,
    'lower_is_better',
  );

  return changes;
}
