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
 * 축은 두 갈래다.
 *
 *  - **목표에서 파생되는 셋**: 은퇴 나이, 목표 월 생활비, 목표 상속자산(+상속 전략).
 *    대응 목표를 고르면 그 targetValue가 값이 된다.
 *  - **baseline으로 고정되는 둘**: 생활비 전략, 목표 우선순위. 목표가 정하지 않고 화면에도
 *    편집 경로가 없다 — 값을 고르는 일 자체를 없앤 축이다.
 *
 * 고정·폴백에 쓰는 값은 임의로 정하지 않았다. DEFAULT_RETIREMENT_STRATEGY와 같은 값이며
 * (제거된 고급 패널이 「권장」 배지를 달아 두었던 값들이다), 상수가 없는 두 축만 예외다 —
 * 은퇴 나이는 국민연금 정상 개시 나이를 쓰고, 목표 월 생활비는 채점 분모라 저장값을 남긴다.
 *
 * **저장 데이터를 여기서 쓰지는 않는다.** ScenarioModel.data가 E2EE라 서버 마이그레이션이라는
 * 선택지가 없어, 읽는 시점 정규화가 유일한 경로다(normalizeIsaFirstChoice와 같은 이유).
 * 다만 호출부(useScenarios의 로드 경로)가 이 결과를 시나리오 state로 삼으므로, 사용자가 이후
 * 아무 값이나 바꾸면 자동저장이 정규화된 값을 저장한다. 즉 «되돌릴 수 없는 변환»이다.
 *
 * 멱등이며, 바꿀 것이 없으면 **입력 참조를 그대로 돌려준다** — compileStrategy의
 * "아무것도 바꾸지 않은 시나리오는 입력이 비트 단위로 보존된다" 통과 경로를 지키기 위해서다.
 *
 * `strategy`를 인자로 받는 이유: 호출부가 이미 resolveStrategy로 전략을 읽어 두었고, 여기서
 * 다시 읽으면 같은 params에 대해 두 번 해석하게 된다. 반드시 «같은 params»에서 읽은 값을
 * 넘겨야 한다 — 다른 params의 전략을 넘기면 조용히 그 값이 승격된다.
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

/**
 * 목표값이 «쓸 수 있는 값»인 목표를 우선순위 순으로 찾는다.
 *
 * `0`을 값으로 인정하지 않는다. 0은 사용자가 입력창을 비웠거나 아직 채우지 않은 상태이고
 * (셀렉터는 빈 칸을 undefined로 저장하지만 "0"은 숫자로 통과시킨다), 그 0이 파생되면
 * 목표 월 생활비가 0이 되어 소비 만족도의 분모가 사라진다 — UtilityEngine은 분모가 0이면
 * 채점 불가를 «만점»으로 읽으므로, 아무것도 못 쓰는 계획이 최고점을 받는다.
 * 게다가 목표를 지워도 아래 폴백이 그 0을 그대로 물려받아 되돌릴 방법이 없어진다.
 */
function firstGoalWithTarget(
  goals: readonly RetirementGoal[],
  ...types: RetirementGoalType[]
): RetirementGoal | undefined {
  return goals.find((goal) =>
    types.includes(goal.type) && goal.targetValue !== undefined && goal.targetValue > 0);
}

function normalizeUserProfile(
  params: SimulationParams,
  goals: readonly RetirementGoal[],
): SimulationParams['userProfile'] {
  const current = params.userProfile;

  // 「빠른 은퇴」를 고르지 않았으면 은퇴 나이를 정할 화면이 없다. 국민연금 정상 개시 나이를
  // 쓴다 — 새 가정을 만들지 않으면서 "연금이 시작될 때 일을 마친다"는 뜻이 되는 유일한 값이다.
  //
  // 현재 나이보다 이르게는 두지 않는다. 이미 지난 나이에 은퇴하는 계획은 계산할 수 없고,
  // 68세에 아직 일하는 사용자를 65세로 되돌리면 그 사람의 계획이 통째로 사라진다.
  // 목표로 정한 나이도 같은 바닥을 적용한다 — 목표값은 1세까지 허용되기 때문이다
  // (normalizeTargetValue의 clamp).
  const retirementAge = Math.max(
    current.currentAge,
    firstGoalWithTarget(goals, 'EARLY_RETIREMENT')?.targetValue ?? NATIONAL_PENSION_NORMAL_START_AGE,
  );

  // 생활비 목표가 여럿이면 «가장 큰» 값이 목표다. 예전에는 우선순위가 높은 쪽이 이겨
  // (firstGoalWithTarget) 「생활비 안정」을 1순위에 둔 사용자의 「여유 있는 소비」 금액이
  // 계산에 닿지 못했다. 사용자가 고른 두 값이 둘 다 계산에 닿게 한다.
  //
  // 목표가 하나도 없으면 저장값을 그대로 둔다 — 목표 금액은 모든 생활비 전략에서 소비
  // 만족도의 «분모»라 계산에 계속 필요하고, 이 축에는 「권장」 상수가 없다.
  const spendingTargets = goals
    .filter((goal) =>
      (goal.type === 'LIVING_EXPENSE_STABILITY' || goal.type === 'COMFORTABLE_SPENDING')
      && goal.targetValue !== undefined && goal.targetValue > 0)
    .map((goal) => goal.targetValue as number);
  const targetMonthlySpending = spendingTargets.length > 0
    ? Math.max(...spendingTargets)
    : current.targetMonthlySpending;

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
    //
    // **이 한 줄이 「저장 시나리오는 max_sustainable을 가질 수 없다」의 근거다.** 조건이
    // 없다는 것이 핵심이다 — 목표를 고른 적 없는 옛 시나리오(retirementGoals 키 자체가 없는
    // 것 포함)도 로드 경로에서 여기를 지나 'target'이 된다. 그래서 그 전략은 오늘 제품에서
    // «도달 불가»이며(SpendingStrategy 주석의 세 잠금 중 둘째), 그 전략의 계산을 고치는
    // 작업은 사용자가 보는 결과를 바꾸지 않는다(known-issues 13번).
    //
    // 여기에 조건을 붙이면 — 예컨대 「사용자가 골랐으면 존중한다」 — 그 전략이 제품에
    // 되살아난다. 그것은 제품 의사결정이므로 코드에서 조용히 하지 말 것.
    // maxSustainableReachability 테스트가 이 무조건성을 고정한다.
    spendingChoice: 'target',
    // 목표 우선순위는 목표 카드가 정한다(createGoalUtilityConfig). 'ai_recommended'는
    // "특정 축으로 기울이지 않음"이라 목표 가중치를 그대로 통과시키는 baseline이다.
    objective: 'ai_recommended',
    // 안전마진은 평생 소비 최적화 전용 하위 입력이었다. 그 전략이 사라졌으므로 무동작
    // 값으로 되돌린다 — 남겨 두면 화면 어디에도 없는 값이 하한선을 계속 움직인다.
    //
    // **spendingShape는 여기서 빠졌다.** 같은 이유로 함께 눌러쓰고 있었으나, 이제 그 축은
    // 「고급 / 전문가 설정」의 ‹생활비 전략› 섹션이 소유하고 추천의 「생활비 배분」이
    // 반영한다. 여기서 계속 눌러쓰면 적용 버튼이 방금 넣은 값을 다음 로드가 지운다.
    // 되돌리려면 그 섹션도 함께 걷어내야 한다 — 화면에 없는 값이 곡선을 움직이는 상태가
    // 예전 결함이었다.
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
    && (current.bequestSafetyMarginRate ?? 0) === next.bequestSafetyMarginRate
    && current.minMonthlySpending === undefined;
}
