import type { ConflictingGoal } from '../../evaluation/GoalEvaluationEngine';
import type { GoalConflictVerdict } from '../../evaluation/EvaluationEngine';
import { RETIREMENT_GOAL_CONSTRAINT_LABELS } from '../../entities/retirementGoal';
import { formatManwon } from '../utility/utilityAnalysis';
// 목표의 표시 이름은 카탈로그가 유일한 출처다. 여기에 짧은 별명을 새로 두면 목표 선택
// 화면이 「상속 자산 확보」라 부른 것을 충돌 블록이 다른 이름으로 부르게 되고, 사용자는
// 자기가 고른 목표가 어느 것인지 짚지 못한다 — 세 벌이던 어휘를 하나로 합친 이유다.
import { RETIREMENT_GOAL_LABELS } from '../../entities/retirementGoal';

/**
 * 화면과 PDF가 «같은 문장»을 쓰기 위한 단일 출처. 문구를 두 벌로 두면 반드시 갈라진다.
 */
export interface GoalConflictDescription {
  title: string;
  /** yieldedGoal 유무로 갈리는 두 문장 중 하나. */
  lead: string;
  /** 「생활비 안정 월 12만원 부족」 같은 항목들. 미달이 0인 목표는 빠진다. */
  shortfalls: string[];
}

const TITLE = '동시에 달성하기 어려운 목표가 있습니다';

/**
 * 목표 하나의 미달 문구. **`unit`이 아니라 목표 «유형»으로 가른다.**
 *
 * `YEARS`는 자산 고갈에서 「짧음」, 은퇴 나이에서 「늦음」으로 방향이 반대라, 단위로 가르면
 * 둘 중 하나가 반드시 틀린 말을 한다. 은퇴 나이 분기는 «만들지 않는다» —
 * `EARLY_RETIREMENT`는 런타임 계층이 아니라 planning constraint라 후보 단계에서 걸러지고
 * `conflictingGoals`에 들어오지 않는다(스펙). 도달하지 않는 분기는 검증할 수 없다.
 *
 * 미달이 0인 목표는 빠진다. 이긴 쪽도 0이 아닐 수 있으므로 0 여부로 승패를 읽어서는 안 되고,
 * 0인 항목은 「얼마가 모자란다」라고 말할 것이 없을 뿐이다.
 */
function describeShortfall(goal: ConflictingGoal): string | undefined {
  if (!(goal.shortfall.amount > 0)) return undefined;
  const label = RETIREMENT_GOAL_LABELS[goal.goalType];

  switch (goal.goalType) {
    // 계층 1. 바닥은 «월» 금액이라 기간을 밝히지 않으면 연 금액으로 읽힌다.
    case 'LIVING_EXPENSE_STABILITY':
    case 'COMFORTABLE_SPENDING':
      return `${label} 월 ${formatManwon(goal.shortfall.amount)} 부족`;
    case 'INHERITANCE':
      return `${label} ${formatManwon(goal.shortfall.amount)} 부족`;
    // 자산 고갈 방지의 미달은 금액으로 말할 수 없다 — 이 목표가 재는 것은 「계획 종료까지
    // 버텼는가」이므로 미달도 기간이다(GoalEvaluationEngine).
    case 'ASSET_SURVIVAL':
      return `${label} 목표보다 ${goal.shortfall.amount}년 짧음`;
    default:
      // 오늘 `conflictingGoals`를 만드는 두 함수는 위 네 유형만 담는다. 다른 유형이 왔다면
      // 판정 쪽이 바뀐 것이고, 조용히 빠뜨리면 「이만큼만 부딪혔다」로 읽혀 엔진이 목표
      // 하나를 삼킨 것과 구분되지 않는다. 그 침묵을 막는 것이 이 블록의 존재 이유다.
      throw new Error(`목표 충돌 문구를 만들 수 없는 목표 유형입니다: ${goal.goalType}`);
  }
}

/**
 * 충돌 판정을 사용자가 읽는 문장으로 옮긴다.
 *
 * **충돌이 없으면 `undefined`를 돌려준다.** 빈 문자열이나 빈 배열을 돌려주면 소비자마다
 * 「비었다」의 기준을 새로 정하게 된다. `goalConflict`가 `undefined`인 경우(그 엔진은
 * 판정하지 않았다)도 같다 — 그릴 것이 없다는 점에서 다르지 않다.
 */
export function describeGoalConflict(verdict: GoalConflictVerdict): GoalConflictDescription | undefined {
  const conflicting = verdict.conflictingGoals ?? [];
  if (!verdict.goalConflict || conflicting.length === 0) return undefined;

  const shortfalls = conflicting
    .map(describeShortfall)
    .filter((text): text is string => text !== undefined);

  // 「지켰다/달성했다」로 쓰지 않는다. 이긴 쪽도 미달일 수 있어 그 경우 거짓이 된다
  // (ConflictingGoal.shortfall 주석). 우선순위가 «적용됐다»는 사실만 말한다.
  //
  // 양보한 목표의 이름은 도메인 라벨에서 가져온다. 계층 2에서 양보하는 것은 상속만이 아니라
  // 자산 고갈 방지일 수도 있어, 「상속」을 문장에 박아 두면 절반은 틀린 말이 된다.
  const lead = verdict.yieldedGoal !== undefined
    ? `「${RETIREMENT_GOAL_CONSTRAINT_LABELS.HARD}」로 설정한 생활비를 `
      + `${RETIREMENT_GOAL_LABELS[verdict.yieldedGoal]} 목표보다 우선했습니다. `
      + '그래도 두 목표를 모두 충족하기에는 자산이 부족합니다.'
    // 여럿이 함께 양보했거나 같은 계층끼리 부딪힌 경우. 하나를 임의로 패자로 만들지 않는다.
    : '현재 조건에서는 아래 목표를 모두 충족할 수 없어 어느 하나를 임의로 우선하지 않았습니다.';

  return { title: TITLE, lead, shortfalls };
}
