import type { GoalFailureBreakdown } from '../../entities/montecarlo';
import type { SimulationParams } from '../../entities/types';

// 목표 달성 확률을 떨어뜨린 지배적 원인.
//   spending  = 목표 생활비를 못 채운 해가 있다
//   depletion = 기대수명 전에 자산이 고갈된다
//   terminal  = 기말자산이 목표(상속액/하한선)에 못 미친다
//   none      = 세 조건 모두 실패 시행이 없다
export type GoalFailureCause = 'spending' | 'depletion' | 'terminal' | 'none';

export interface GoalShortfallExplanation {
  cause: GoalFailureCause;
  // "왜 이 확률인가"의 한 줄 요약.
  headline: string;
  // 원인을 만든 **설정**을 지목하는 문장. 지목할 설정을 찾지 못하면 undefined다 —
  // 근거 없는 추측을 문장으로 만들지 않는다.
  hint?: string;
}

export interface ExplainGoalShortfallInput {
  goalFailure: GoalFailureBreakdown;
  trials: number;
  params: SimulationParams;
  formatValue: (value: number) => string;
}

// 목표 달성 확률이 낮은 이유를 문장으로 만든다.
//
// 이 함수가 필요한 이유: 확률 하나만 보여주면 사용자는 언제나 "자산이 모자란다"로 읽는다.
// 그런데 실제로 가장 자주 확률을 무너뜨리는 것은 **인출을 막는 설정**이다 — 사적연금
// 「최소 인출」은 저율과세 한도의 25%를 월 인출 상한으로 만들고(compileStrategy의
// PRIVATE_PENSION_RULES), 상속 목표액은 그 금액을 인출 하한선(assetFloor)으로 만든다.
// 두 경우 모두 자산은 계좌에 그대로 남아 고갈로 잡히지 않으므로, 화면에는 "자산 30억,
// 목표 달성 확률 2%"라는 서로 모순돼 보이는 조합만 남는다.
//
// **세 원인을 그대로 비교하지 않는다.** 자산이 고갈된 시행은 그 해에 생활비 미달도 내고
// (인출 경로가 매달 min(잔액, 필요액)으로 깎는다) 기말자산 목표도 함께 놓치므로, 원시 개수만
// 비교하면 언제나 기말자산 미달이 1등이 된다 — 실제 이야기는 고갈인데도.
// 그래서 고갈 시행 수를 뺀 **초과분**끼리 비교한다: 고갈 없이 생활비만 못 채운 시행,
// 고갈 없이 기말자산만 못 맞춘 시행. 그 초과분이 고갈보다 클 때만 다른 이야기가 된다.
export function explainGoalShortfall({
  goalFailure,
  trials,
  params,
  formatValue,
}: ExplainGoalShortfallInput): GoalShortfallExplanation {
  const { spendingShortfall, assetDepletion, terminalShortfall } = goalFailure;
  if (spendingShortfall === 0 && assetDepletion === 0 && terminalShortfall === 0) {
    return { cause: 'none', headline: '모든 시행에서 목표 조건을 만족했습니다.' };
  }

  const spendingOnly = spendingShortfall - assetDepletion;
  const terminalOnly = terminalShortfall - assetDepletion;
  const cause: GoalFailureCause = assetDepletion >= spendingOnly && assetDepletion >= terminalOnly
    ? 'depletion'
    : spendingOnly >= terminalOnly
      ? 'spending'
      : 'terminal';

  if (cause === 'depletion') {
    return {
      cause,
      headline: `${trials}회 중 ${assetDepletion}회에서 기대수명 전에 자산이 고갈됩니다.`,
    };
  }

  if (cause === 'terminal') {
    return {
      cause,
      headline: `${trials}회 중 ${terminalShortfall}회에서 기말자산이 목표(${formatValue(goalFailure.terminalAssetGoal)})에 못 미칩니다.`,
      hint: '상속 목표액을 낮추면 달성 확률이 올라갑니다.',
    };
  }

  const fromAge = goalFailure.medianFirstShortfallAge;
  return {
    cause,
    headline: `${trials}회 중 ${spendingShortfall}회에서 목표 생활비를 채우지 못합니다`
      + (fromAge !== null ? ` (평균적으로 ${fromAge}세부터).` : '.'),
    // 자산이 살아남는데도 목표를 못 채우는 시행이 있을 때만 설정을 지목한다. 고갈이
    // 원인의 대부분이면 "인출 설정 때문"이라는 문장은 사실이 아니다.
    ...(spendingShortfall > assetDepletion ? withdrawalBlockHint(params, formatValue) : {}),
  };
}

// 자산이 남아 있는데도 목표 생활비를 못 채우게 만드는 **설정**을 찾는다.
// 우선순위는 사용자가 바꿔서 얻는 효과가 큰 순서다.
function withdrawalBlockHint(
  params: SimulationParams,
  formatValue: (value: number) => string,
): { hint?: string } {
  const pensionCap = params.withdrawalPlan?.privatePensionMonthlyTarget;
  if (pensionCap !== undefined && pensionCap > 0) {
    return {
      hint: `사적연금 인출이 월 ${formatValue(pensionCap)}으로 제한되어 있어, 일반계좌를 다 쓴 뒤에는`
        + ' 연금 잔액이 남아 있어도 목표 생활비를 채울 수 없습니다. 「연금 전략 → 사적연금 인출 전략」을'
        + ' 확인해 보세요.',
    };
  }

  const floor = params.assetFloor ?? 0;
  if (floor > 0) {
    return {
      hint: `자산 하한선 ${formatValue(floor)} 아래로는 인출하지 않도록 설정되어 있어, 그 금액은`
        + ' 생활비로 쓸 수 없습니다. 상속 목표액을 낮추면 달성 확률이 올라갑니다.',
    };
  }

  return {};
}
