import type { SimulationResult } from '../entities/types';
import type { RetirementGoals, RetirementProfile, RetirementStrategy } from '../domain/input/retirement';
import type { GoalConflictVerdict } from './EvaluationEngine';
import { DefaultGoalEvaluationEngine, type GoalEvaluationEngine } from './GoalEvaluationEngine';

/**
 * 「이 계획의 목표들이 서로 맞지 않는가」 «하나»만 묻는 진입점.
 *
 * 판정을 하지 않는다 — 규칙을 가진 쪽(GoalEvaluationEngine)에게 묻고, 그 결과에서 화면과
 * 리포트가 쓰는 세 필드만 떼어 낸다. 여기에 「이겼다/양보했다」를 다시 세우는 코드가 한 줄이라도
 * 생기면 같은 계획에 대해 규칙이 둘이 되고, 둘은 언젠가 갈라진다.
 *
 * **왜 따로 있나.** 충돌 판정만 필요한 호출부(PDF 리포트)가 `LegacyEvaluationEngine`을 새로
 * 만들어 `evaluate()`를 통째로 돌리고 있었다. 그 한 번에 리스크 알림·차트 캡션·부족 요약·
 * 지속가능액 조언·평생 효용 설명까지 함께 계산되는데, 리포트는 그중 어느 것도 그 호출에서
 * 읽지 않았다(같은 값을 제 손으로 다시 계산한다). 필드 하나를 읽으려고 문서 한 벌을 더
 * 만드는 셈이라, 이 진입점이 그 «필요한 질문만» 남긴다.
 *
 * 세 필드를 고르는 이유는 `GoalConflictVerdict` 주석 참고 — 나머지는 최적화기가 후보를 줄
 * 세우는 재료라 표시 계층에 비교 대상이 없다.
 */
export function evaluateGoalConflict(
  profile: RetirementProfile,
  goals: RetirementGoals,
  strategy: RetirementStrategy,
  result: SimulationResult,
  // 기본값으로 규칙의 주인을 쓴다. 주입 가능하게 두는 것은 «규칙을 갈아 끼우기» 위해서가
  // 아니라, 이 함수가 스스로 판정하지 않고 정말로 위임만 하는지를 테스트가 확인하기 위해서다.
  engine: GoalEvaluationEngine = new DefaultGoalEvaluationEngine(),
): GoalConflictVerdict {
  const { goalConflict, conflictingGoals, yieldedGoal } = engine.evaluate(
    profile, goals, strategy, result,
  );
  return { goalConflict, conflictingGoals, yieldedGoal };
}
