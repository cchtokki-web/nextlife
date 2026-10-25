import { normalizeRetirementGoals } from '../entities/retirementGoal';
import type { RetirementGoals } from '../domain/input/retirement';
import {
  retirementAgeHardFailure,
  type GoalEvaluationResult,
  type HardConstraintFailure,
  type HardConstraintFailureCode,
} from '../evaluation/GoalEvaluationEngine';
import type { StrategyCandidate } from './StrategyGenerator';

/** `Extract` rather than a bare literal, so renaming the shared code breaks this loudly. */
export type PreSimulationRejectionCode = Extract<HardConstraintFailureCode, 'HARD_RETIREMENT_AGE'>;
export type HardConstraintRejectionCode = HardConstraintFailureCode;

/**
 * 탈락 항목은 평가 단계의 실패 항목과 같은 모양이다. 별도 interface로 두면 두 벌을 따로
 * 유지해야 하고 필드가 어긋날 수 있어 별칭으로 둔다.
 */
export type HardConstraintRejection = HardConstraintFailure;

/**
 * Keeps HARD filtering explicit without pretending every constraint is knowable before projection.
 * Static strategy facts are checked before simulation; cash-flow and terminal-asset constraints are
 * checked from GoalEvaluationEngine output afterwards.
 */
export class HardConstraintFilter {
  beforeSimulation(
    candidate: StrategyCandidate,
    goals: RetirementGoals,
  ): HardConstraintRejection[] {
    // normalizeRetirementGoals dedupes by type, so at most one EARLY_RETIREMENT goal survives.
    // Every HARD one is checked regardless, so relaxing that dedup cannot silently weaken this gate.
    return normalizeRetirementGoals(goals.selectedGoals ?? [])
      .filter((goal) => goal.type === 'EARLY_RETIREMENT' && goal.constraintType === 'HARD')
      .map((goal) => retirementAgeHardFailure(candidate.strategy.retirementAge, goal))
      .filter((failure): failure is NonNullable<typeof failure> => failure !== null);
  }

  /**
   * 사후 HARD 판정의 단일 근거. 후보를 떨어뜨릴지는 오직 이 결과의 길이로 정한다.
   *
   * 예전에는 optimizer가 `hardConstraintsSatisfied` 불리언과 실패 목록을 각각 봤다. 커스텀
   * 엔진이 불리언만 false로 주면 후보는 탈락하는데 사유 목록은 비어, 디버그 출력이
   * "N개 탈락, 사유 {}"가 됐다. 여기서 두 입력을 하나로 합쳐 그 상태를 없앤다 —
   * 사유 없는 탈락은 사유가 붙고, 탈락 판정 자체는 한 값에서만 나온다.
   */
  afterEvaluation(evaluation: GoalEvaluationResult): HardConstraintRejection[] {
    if (evaluation.hardConstraintFailures.length > 0) {
      return evaluation.hardConstraintFailures.map((failure) => ({ ...failure }));
    }

    if (evaluation.hardConstraintsSatisfied === false) {
      return [{
        code: 'HARD_UNSPECIFIED',
        reason: '평가 엔진이 사유를 밝히지 않고 HARD 제약 위반으로 판정했습니다.',
      }];
    }

    return [];
  }
}
