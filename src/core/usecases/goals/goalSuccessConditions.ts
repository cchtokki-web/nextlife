import {
  normalizeRetirementGoals,
  type RetirementGoal,
  type RetirementGoalType,
} from '../../entities/retirementGoal';
import type { SimulationParams } from '../../entities/types';

// 목표 달성 확률이 무엇을 근거로 조건을 골랐는지.
//   selected_goals    = 사용자가 고른 목표에서 조건을 유도했다
//   plan_defaults     = 고른 목표에서 «활성 조건»이 하나도 나오지 않아 계획의 기본
//                       조건(생활비 유지·자산 고갈)으로 계산했다. 판정 가능한 목표를 아예
//                       고르지 않은 경우와, 골랐지만 그 목표가 조건을 만들지 못한 경우
//                       (목표액 없는 「자산 성장」 단독)가 모두 여기로 온다
//   legacy_plan       = 목표를 한 번도 고른 적 없는 시나리오다. 목표 도입 이전과 같은
//                       조건(생활비·고갈·기말자산)을 그대로 쓴다
export type GoalConditionBasis = 'selected_goals' | 'plan_defaults' | 'legacy_plan';

export interface GoalSuccessConditions {
  basis: GoalConditionBasis;
  // 은퇴 후 모든 해에 목표 생활비를 채웠는지 판정할 것인가.
  requireSpendingTarget: boolean;
  // 기대수명까지 자산이 고갈되지 않았는지 판정할 것인가.
  requireAssetSurvival: boolean;
  // 기말자산 하한. 0이면 이 조건을 판정하지 않는다.
  terminalAssetGoal: number;
  // 고르긴 했지만 이 확률로는 판정할 수 없는 목표. 화면이 "반영되지 않았다"고 밝히는 데 쓴다.
  // 숨기면 "판정하지 않음"이 "판정해서 통과함"으로 읽힌다.
  unmeasuredGoals: RetirementGoalType[];
}

// 시행 하나로 판정할 수 있는 목표. 나머지는 세금·연금 활용도처럼 수익률 경로가 아니라
// 제도·전략 선택으로 갈리는 것이라, 시행별 성공/실패를 물을 대상이 아니다.
//
// EARLY_RETIREMENT는 어느 쪽도 아니다: 목표 은퇴 나이는 applyRetirementGoals가 계획의
// userProfile.retirementAge로 직접 옮기므로 모든 시행이 이미 그 나이에 은퇴한다. 조건으로
// 세면 언제나 전 시행 통과라 확률이 부풀고, 미판정 목록에 넣으면 반영된 목표를 반영되지
// 않았다고 말하게 된다.
const MEASURABLE_GOALS: ReadonlySet<RetirementGoalType> = new Set([
  'LIVING_EXPENSE_STABILITY',
  'COMFORTABLE_SPENDING',
  'ASSET_SURVIVAL',
  'INHERITANCE',
  'ASSET_GROWTH',
]);

const PLAN_EMBEDDED_GOALS: ReadonlySet<RetirementGoalType> = new Set(['EARLY_RETIREMENT']);

// 목표 달성 확률이 판정할 조건을 정한다.
//
// **이 함수가 필요한 이유.** 예전에는 조건이 세 개로 고정되어 있었다 — 목표 생활비, 자산
// 고갈, 기말자산 ≥ (targetBequest ?? assetFloor). 그래서 두 방향으로 모두 틀렸다.
//   - 고르지 않은 목표가 확률을 깎았다. 상속을 한 번도 고르지 않아도 compileStrategy가
//     기본 전략('일부 남기기')으로 실체화한 24개월치 생활비가 기말자산 조건이 됐고,
//     구 UI에서 상속 목표액을 넣어 둔 시나리오는 그 금액이 조건으로 살아 있었다.
//   - 고른 목표는 확률을 바꾸지 못했다. 자산 고갈 방지를 HARD로 골라도, 아예 고르지 않아도
//     같은 값이 나왔다.
//
// **레거시 시나리오는 목표를 «지어내지» 않는다.** retirementGoals 키가 없으면 목표 화면을
// 거친 적이 없다는 뜻이므로 판정 조건을 목표에서 만들지 않고 예전 세 조건을 그대로 쓴다.
//
// 다만 «값»까지 예전 그대로인 것은 아니다. migrateRetirementGoals가 로드 시점에 목표가 정하는
// 축을 정규화하므로(normalizeGoalDrivenParams), 상속 목표가 없는 시나리오는 targetBequest 키가
// 지워진 채 여기 도착한다 — 즉 아래 legacyTerminalGoal은 assetFloor나 0으로 떨어진다.
// 그것이 새 규칙이다: 고르지 않은 상속 목표는 기말자산 조건이 되지 않는다.
export function resolveGoalSuccessConditions(params: SimulationParams): GoalSuccessConditions {
  const legacyTerminalGoal = Math.max(0, params.userProfile.targetBequest ?? params.assetFloor ?? 0);

  if (!Array.isArray(params.retirementGoals)) {
    return {
      basis: 'legacy_plan',
      requireSpendingTarget: true,
      requireAssetSurvival: true,
      terminalAssetGoal: legacyTerminalGoal,
      unmeasuredGoals: [],
    };
  }

  const goals = normalizeRetirementGoals(params.retirementGoals);
  const measurable = goals.filter((goal) => MEASURABLE_GOALS.has(goal.type));
  const unmeasuredGoals = goals
    .filter((goal) => !MEASURABLE_GOALS.has(goal.type) && !PLAN_EMBEDDED_GOALS.has(goal.type))
    .map((goal) => goal.type);

  const requireSpendingTarget = measurable.some((goal) =>
    goal.type === 'LIVING_EXPENSE_STABILITY' || goal.type === 'COMFORTABLE_SPENDING');
  const requireAssetSurvival = measurable.some((goal) => goal.type === 'ASSET_SURVIVAL');
  const terminalAssetGoal = terminalAssetGoalOf(measurable, params);

  // **판별 기준은 「판정 가능한 «유형»을 골랐는가」가 아니라 「활성 «조건»이 남았는가」다.**
  // 유형만 보면 구멍이 생긴다: 「자산 성장」은 판정 가능한 유형이지만 목표액을 묻는 UI가
  // 없어(goalCatalog에 target 필드가 없다) 상속 목표를 함께 고르지 않으면 terminalAssetGoal이
  // 0으로 풀린다. 그러면 세 조건이 모두 비어 있는데도 'selected_goals'로 빠져나가, 62세에
  // 자산이 바닥나는 계획조차 «판정할 것이 없다»는 이유로 언제나 100%를 받는다.
  //
  // 판정할 조건이 없다고 해서 100%를 줄 수는 없다. "계획대로 굴러가는가"라는 최소한의
  // 질문(생활비를 계획대로 쓰며 기대수명까지 자산이 버티는가)으로 되돌아간다.
  // 기말자산 조건은 넣지 않는다 — 사용자가 요구한 적 없는 금액이기 때문이다.
  //
  // 판정 가능한 목표를 «하나도» 고르지 않은 경우도 세 조건이 모두 비므로 이 한 분기가
  // 함께 덮는다. 두 벌로 두면 같은 뜻의 가드가 갈라진다.
  //
  // unmeasuredGoals는 여기서도 «유형» 기준 그대로다. 그 필드가 답하는 질문은 「고른 목표 중
  // 이 확률이 판정하지 못한 것이 무엇인가」이고, 「자산 성장」은 조건이 비었을 뿐 판정 대상
  // 유형이므로 미반영 목록에 넣으면 다른 사실을 말하게 된다.
  if (!requireSpendingTarget && !requireAssetSurvival && terminalAssetGoal <= 0) {
    return {
      basis: 'plan_defaults',
      requireSpendingTarget: true,
      requireAssetSurvival: true,
      terminalAssetGoal: 0,
      unmeasuredGoals,
    };
  }

  return {
    basis: 'selected_goals',
    requireSpendingTarget,
    requireAssetSurvival,
    terminalAssetGoal,
    unmeasuredGoals,
  };
}

// 기말자산 조건은 상속·자산 성장 목표에서만 나온다. 목표에 금액이 없으면 계획이 실체화한
// targetBequest로 대신한다 — 그 값은 사용자가 목표를 고른 결과로 만들어진 것이라
// (applyRetirementGoals → compileStrategy) 고르지 않은 조건을 새로 만드는 것이 아니다.
function terminalAssetGoalOf(
  measurable: readonly RetirementGoal[],
  params: SimulationParams,
): number {
  const assetGoals = measurable.filter((goal) =>
    goal.type === 'INHERITANCE' || goal.type === 'ASSET_GROWTH');
  if (assetGoals.length === 0) return 0;

  const explicit = assetGoals
    .map((goal) => goal.targetValue)
    .filter((value): value is number => value !== undefined && Number.isFinite(value));
  if (explicit.length > 0) return Math.max(0, Math.max(...explicit));

  return Math.max(0, params.userProfile.targetBequest ?? 0);
}
