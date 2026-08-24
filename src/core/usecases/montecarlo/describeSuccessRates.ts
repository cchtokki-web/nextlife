import { MonteCarloResult } from '../../entities/montecarlo';
import { SimulationParams } from '../../entities/types';
import { describeSpendingCurve } from '../spending/spendingCurve';

// **두 성공률의 캡션을 만드는 단일 출처.**
//
// describeMonteCarloAssumptions와 같은 자리에, 같은 이유로 둔다 — 화면(MonteCarloSection)과
// PDF(pdfReportSections)가 «같은 문장»을 인쇄해야 하고, 그 문장이 서술하는 판정 규칙은
// 전부 core의 것이기 때문이다. 저 파일의 주석이 문구를 두 벌로 두었을 때 치른 대가를
// 기록해 두었다: 규칙이 바뀌자 두 곳이 «동시에» 거짓이 됐고 어느 쪽도 오류를 내지 않았다.
//
// **이 파일이 생긴 계기.** 화면과 PDF가 「계획 생활비(월 300만원)를 한 해도 줄이지 않은
// 경우입니다」라고 인쇄하고 있었다. 그런데 엔진이 실제로 판정하는 목표는 연령대별 배수를
// 곱한 값이다(SimulationEngine의 monthlyTargetSpending = baseMonthly ×
// spendingMultiplierForAge). 「생활비 배분」을 고른 계획에서는 70대 258만원·80대 228만원이
// 판정 기준인데, 문구는 300만원 하나만 말했다. 계산은 옳고 문구만 틀린 상태였다.

export interface SuccessRateCopy {
  // 상단 「목표 달성 확률」과 아래 두 비율의 관계. 관계를 말할 수 없으면 null.
  compositeNote: string | null;
  // 「생활 유지 성공률」 아래에 붙는 한 줄.
  spendingCaption: string;
  // 「자산 보존 성공률」 아래에 붙는 한 줄.
  assetCaption: string;
}

export function describeSuccessRates(input: {
  monteCarlo: Pick<
    MonteCarloResult,
    'plannedMonthlySpending' | 'successAge' | 'goalConditions' | 'goalSuccessProbability'
  >;
  params: SimulationParams;
  formatValue: (value: number) => string;
}): SuccessRateCopy {
  const { monteCarlo, params, formatValue } = input;
  const { retirementAge, expectancy } = params.userProfile;

  // **기준액은 params가 아니라 결과에서 가져온다.** 「평생 소비 최적화」 계획에서 판정
  // 기준은 사용자가 입력한 목표가 아니라 엔진이 역산해 고정한 금액이다
  // (freezeSpendingPlan → MonteCarloResult.plannedMonthlySpending). params의 목표를 쓰면
  // 그 계획에서 화면이 판정에 쓰이지 않은 금액을 판정 기준이라고 말하게 된다.
  //
  // 곡선은 params에서 온다 — freezeSpendingPlan은 targetMonthlySpending만 바꾸고
  // spendingCurve는 그대로 둔다.
  const bands = describeSpendingCurve(
    params.spendingCurve,
    monteCarlo.plannedMonthlySpending,
    retirementAge,
    expectancy,
  );

  return {
    compositeNote: describeCompositeNote(monteCarlo),
    // 곡선이 없으면 구간이 하나뿐이라 나열할 것이 없다. 그때는 종전 문장을 그대로 쓴다 —
    // 그 계획에서는 그 문장이 참이다.
    spendingCaption: bands.length === 0
      ? `계획 생활비(월 ${formatValue(monteCarlo.plannedMonthlySpending)})를 한 해도 줄이지 않은 경우입니다.`
      : `설정한 연령별 목표 생활비(${bands
        .map((band) => `${band.fromAge}~${band.toAge ?? expectancy}세 ${formatValue(band.monthlyAmount)}`)
        .join(' · ')})를 한 해도 부족 없이 충당한 경우입니다.`,
    assetCaption: `${monteCarlo.successAge}세 이전에 금융자산이 0원이 되지 않은 경우입니다. `
      + '두 확률은 서로 다른 실패를 셉니다 — 연금이 생활비를 덮으면 자산이 바닥나도 생활은 유지됩니다.',
  };
}

// 두 비율이 나란히 같은 값일 때 사용자는 「그러면 둘이 같은 지표 아닌가」라고 읽는다.
// 실제로는 상단 「목표 달성 확률」이 이 조건들을 **같은 시행에서** 함께 물은 값이고,
// 두 비율은 그 판정을 이루는 성분이다. 그 관계를 말하지 않으면 세 숫자가 우연히 같은 화면에서
// 아무 설명 없이 세 번 반복된다.
//
// **「아래 두 조건을 모두 만족한 비율」이라고 쓰지 않는다.** goalSuccessProbability의 생활비
// 조건은 목표 대비 재구성값에 월 1만원 엡실론을 두고, spendingSuccessRate는 엔진 원장을
// 엡실론 없이 본다. 두 술어 사이에 포함관계가 없다는 것이 spendingShortfall.ts에 실측과 함께
// 기록돼 있다(AUDIT-003). 그래서 여기서는 «무엇을 함께 판정했는가»만 말하고 두 비율과의
// 동일성은 주장하지 않는다.
function describeCompositeNote(
  monteCarlo: Pick<MonteCarloResult, 'goalConditions' | 'goalSuccessProbability'>,
): string | null {
  const { requireSpendingTarget, requireAssetSurvival, terminalAssetGoal } = monteCarlo.goalConditions;

  const judged: string[] = [];
  if (requireSpendingTarget) judged.push('생활비');
  if (requireAssetSurvival) judged.push('자산 생존');
  if (terminalAssetGoal > 0) judged.push('목표 잔여자산');

  // 판정 조건이 하나뿐이면 「함께 판정했다」는 말이 성립하지 않는다. 조건이 아예 없는
  // 경우는 resolveGoalSuccessConditions가 만들지 않지만(plan_defaults로 되돌린다) 같은
  // 가드가 그 경우도 덮는다.
  if (judged.length < 2) return null;

  const percent = Math.round(monteCarlo.goalSuccessProbability * 100);
  return `위 「목표 달성 확률 ${percent}%」는 ${judged.join('·')}을 «같은 시행에서» 함께 판정한 값입니다 — `
    + '아래 두 비율을 곱하거나 더한 값이 아닙니다.';
}
