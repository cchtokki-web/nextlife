import type { RetirementGoal, RetirementGoalType } from '../../entities/retirementGoal';
import { normalizeRetirementGoals } from '../../entities/retirementGoal';
import type { RetirementStrategy, SimulationParams } from '../../entities/types';
import { NATIONAL_PENSION_NORMAL_START_AGE } from '../pension/nationalPensionRules';

/**
 * 은퇴 목표를 이 축들의 «유일한 진실»로 만든다.
 *
 * 예전에는 같은 값을 두 화면이 각자 편집했다 — 목표 카드(3단계)와 고급/전문가 설정의
 * 「은퇴 목표」 섹션. 둘은 서로를 모르므로 「생활비 안정 월 300만원」을 고른 뒤 고급에서
 * 「배당금만 소비」를 고르면 경고 없이 둘 다 저장됐고, 축마다 이기는 쪽이 달라졌다(인출은
 * 배당금만 소비가, 채점 분모는 목표 금액이, 목표 달성 확률은 부족분 판정식 때문에 구조적으로
 * 100%가). 이제 겹치는 입력은 고급 패널에서 사라졌고, 그 축들은 여기서 목표로부터 파생된다.
 *
 * **고르지 않은 목표의 축은 각 옵션이 화면에서 「권장」으로 표시하던 값으로 되돌린다.**
 * 임의의 새 가정이 아니라 strategyOptions의 recommended 배지 및 DEFAULT_RETIREMENT_STRATEGY와
 * 같은 값이며, 은퇴 나이만 상수가 없어 국민연금 정상 개시 나이를 쓴다.
 *
 * **저장 데이터는 건드리지 않는다.** ScenarioModel.data가 E2EE라 서버 마이그레이션이라는
 * 선택지가 없어, 읽는 시점 정규화가 유일한 경로다(normalizeIsaFirstChoice와 같은 이유).
 *
 * 멱등이며, 바꿀 것이 없으면 **입력 참조를 그대로 돌려준다** — compileStrategy의
 * "아무것도 바꾸지 않은 시나리오는 입력이 비트 단위로 보존된다" 통과 경로를 지키기 위해서다.
 *
 * `strategy`를 인자로 받는 이유: resolveStrategy는 compileStrategy에 있고 compileStrategy가
 * 이 함수를 부른다. 여기서 되import하면 순환이 되므로, 이미 전략을 손에 쥔 호출부가 넘긴다.
 * 반드시 «같은 params»에서 resolveStrategy로 읽은 값을 넘겨야 한다.
 */
export function normalizeGoalDrivenParams(
  params: SimulationParams,
  strategy: RetirementStrategy,
): SimulationParams {
  const goals = normalizeRetirementGoals(params.retirementGoals ?? []);

  const userProfile = normalizeUserProfile(params, goals);
  const nextStrategy = normalizeStrategy(strategy, goals);

  const profileChanged = userProfile !== params.userProfile;
  // params.strategy가 없던 시나리오는 "전략을 저장한 적 없음"이라는 상태 자체가 의미를 갖는다
  // (compileStrategy의 통과 경로 판정). 실제로 바뀌는 축이 없으면 새로 쓰지 않는다.
  const strategyChanged = !sameNormalizedAxes(strategy, nextStrategy);
  if (!profileChanged && !strategyChanged) return params;

  return {
    ...params,
    userProfile,
    ...(strategyChanged || params.strategy ? { strategy: nextStrategy } : {}),
  };
}

function firstGoalWithTarget(
  goals: readonly RetirementGoal[],
  ...types: RetirementGoalType[]
): RetirementGoal | undefined {
  return goals.find((goal) => types.includes(goal.type) && goal.targetValue !== undefined);
}

function normalizeUserProfile(
  params: SimulationParams,
  goals: readonly RetirementGoal[],
): SimulationParams['userProfile'] {
  const current = params.userProfile;

  // 「빠른 은퇴」를 고르지 않았으면 은퇴 나이를 정할 화면이 없다. 국민연금 정상 개시 나이를
  // 쓴다 — 새 가정을 만들지 않으면서 "연금이 시작될 때 일을 마친다"는 뜻이 되는 유일한 값이다.
  const retirementAge = firstGoalWithTarget(goals, 'EARLY_RETIREMENT')?.targetValue
    ?? NATIONAL_PENSION_NORMAL_START_AGE;

  // 생활비 목표가 없다고 이 값을 지우지는 않는다. 목표 금액은 모든 생활비 전략에서 소비
  // 만족도의 «분모»라 계산에 계속 필요하고, 이 축에는 「권장」 상수가 없다. 그래서 목표가
  // 없으면 저장값을 그대로 둔다.
  const targetMonthlySpending =
    firstGoalWithTarget(goals, 'LIVING_EXPENSE_STABILITY', 'COMFORTABLE_SPENDING')?.targetValue
    ?? current.targetMonthlySpending;

  const targetBequest = firstGoalWithTarget(goals, 'INHERITANCE')?.targetValue;

  const same = current.retirementAge === retirementAge
    && current.targetMonthlySpending === targetMonthlySpending
    && current.targetBequest === targetBequest;
  if (same) return current;

  const next = { ...current, retirementAge, targetMonthlySpending };
  // undefined를 남기지 않고 키를 지운다. `targetBequest: undefined`는 JSON 직렬화·구조 비교에서
  // "키가 없는 것"과 미묘하게 달라진다(compileStrategy가 같은 규칙을 쓴다).
  if (targetBequest === undefined) delete next.targetBequest;
  else next.targetBequest = targetBequest;
  return next;
}

function normalizeStrategy(
  strategy: RetirementStrategy,
  goals: readonly RetirementGoal[],
): RetirementStrategy {
  const next: RetirementStrategy = {
    ...strategy,
    // 인출 규칙은 언제나 「원하는 생활비 직접 입력」이다. 배당금만 소비·평생 소비 최적화는
    // 목표 금액을 인출에 쓰지 않아, 생활비 목표를 고른 계획과 정면으로 어긋난다.
    spendingChoice: 'target',
    // 목표 우선순위는 목표 카드가 정한다(createGoalUtilityConfig). 'ai_recommended'는
    // "특정 축으로 기울이지 않음"이라 목표 가중치를 그대로 통과시키는 baseline이다.
    objective: 'ai_recommended',
    // 아래 둘은 평생 소비 최적화 전용 하위 입력이었다. 그 전략이 사라졌으므로 무동작 값으로
    // 되돌린다 — 남겨 두면 화면 어디에도 없는 값이 곡선과 하한선을 계속 움직인다.
    spendingShape: 'flat',
    bequestSafetyMarginRate: 0,
    // 상속 목표를 골랐을 때만 인출에 하한선을 건다. 고르지 않았으면 「일부 남기기」 —
    // 하한선을 걸지 않고 2년치 생활비를 적정선으로 «채점»만 하는 권장값이다.
    bequestStrategy: firstGoalWithTarget(goals, 'INHERITANCE') ? 'target_amount' : 'leave_some',
  };
  // 미지정이 "경고 없음"이라는 유효한 상태다. 0을 넣으면 "월 0원 미만" 판정이 생긴다.
  delete next.minMonthlySpending;
  return next;
}

// 정규화가 실제로 바꾼 축이 있는지. 위 함수가 손대는 축만 본다 — 나머지(연금·투자·경제)는
// 사용자가 고급 설정에서 계속 정하는 값이라 비교 대상이 아니다.
function sameNormalizedAxes(current: RetirementStrategy, next: RetirementStrategy): boolean {
  return current.spendingChoice === next.spendingChoice
    && current.objective === next.objective
    && current.bequestStrategy === next.bequestStrategy
    && (current.spendingShape ?? 'flat') === next.spendingShape
    && (current.bequestSafetyMarginRate ?? 0) === next.bequestSafetyMarginRate
    && current.minMonthlySpending === undefined;
}
