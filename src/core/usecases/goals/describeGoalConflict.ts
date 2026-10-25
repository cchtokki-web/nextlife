import type { ConflictingGoal } from '../../evaluation/GoalEvaluationEngine';
import type { GoalConflictVerdict } from '../../evaluation/EvaluationEngine';
// 목표의 표시 이름(RETIREMENT_GOAL_LABELS)은 도메인이 유일한 출처다. 여기에 짧은 별명을
// 새로 두면 목표 선택 화면이 「상속 자산 확보」라 부른 것을 충돌 블록이 다른 이름으로
// 부르게 되고, 사용자는 자기가 고른 목표가 어느 것인지 짚지 못한다 — 세 벌이던 어휘를
// 하나로 합친 이유다.
import {
  RETIREMENT_GOAL_CONSTRAINT_LABELS,
  RETIREMENT_GOAL_LABELS,
} from '../../entities/retirementGoal';
import { formatManwon } from '../utility/utilityAnalysis';

/**
 * 화면과 PDF가 «같은 문장»을 쓰기 위한 단일 출처. 문구를 두 벌로 두면 반드시 갈라진다.
 */
export interface GoalConflictDescription {
  title: string;
  /** yieldedGoal 유무로 갈리는 두 문장 중 하나. */
  lead: string;
  /**
   * 「생활비 안정 월 12만원 부족」 같은 항목들. 미달이 0인 목표는 빠지고, 전부 0이면
   * 설명 자체가 만들어지지 않는다 — 이 배열은 «절대 비지 않는다».
   */
  shortfalls: string[];
}

const TITLE = '동시에 달성하기 어려운 목표가 있습니다';

/**
 * 목표 하나의 미달 문구. **`unit`이 아니라 목표 «유형»으로 가른다.**
 *
 * `YEARS`는 자산 고갈에서 「짧음」, 은퇴 나이에서 「늦음」으로 방향이 반대라, 단위로 가르면
 * 둘 중 하나가 반드시 틀린 말을 한다. 은퇴 나이 분기는 «만들 수 없다» —
 * `EARLY_RETIREMENT`는 런타임 계층이 아니라 planning constraint라 후보 단계에서 걸러지고,
 * 그 사실이 `ConflictingGoalType`에 박혀 있어 case를 쓰면 컴파일 오류가 난다.
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
    default: {
      // 여기는 «도달할 수 없다». ConflictingGoalType이 위 네 유형뿐이라 이 자리의
      // goal.goalType은 never이고, 유형이 하나 늘면 아래 대입이 컴파일 오류가 되어
      // 문구를 쓰기 전에는 통과하지 못한다. 도달 불가를 규약이 아니라 컴파일러가 보증한다.
      //
      // 그래도 throw를 남긴다: 타입은 런타임 값을 검사하지 못하므로, 계약 밖에서 만들어진
      // (저장된 JSON, 옛 계약을 구현한 외부 엔진) 값이 흘러들 수 있다. 조용히 빠뜨리면
      // 「이만큼만 부딪혔다」로 읽혀 엔진이 목표 하나를 삼킨 것과 구분되지 않는다.
      const unreachable: never = goal.goalType;
      throw new Error(`목표 충돌 문구를 만들 수 없는 목표 유형입니다: ${String(unreachable)}`);
    }
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
  // 참가한 목표가 전부 미달 0인 경우(세 생산자 모두 Math.max(0, …)로 깎으므로 가능하다).
  // 여기서 설명을 돌려주면 화면과 PDF가 「자산이 부족합니다」라고 쓴 바로 아래에 빈 목록을
  // 그린다 — 밑에 깔린 데이터가 반증하는 문장이다. 그릴 것이 없으면 undefined 하나로 말한다.
  if (shortfalls.length === 0) return undefined;

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
