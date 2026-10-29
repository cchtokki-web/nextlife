import type { HardConstraintRejectionCode } from '../../../../core/strategy/HardConstraintFilter';
import { RETIREMENT_GOAL_CONSTRAINT_LABELS } from '../../../../core/entities/retirementGoal';
import { hardConstraintLabel } from '../../RetirementGoals/goalCatalog';

const actions: Record<HardConstraintRejectionCode, string> = {
  HARD_RETIREMENT_AGE: '희망 은퇴 나이를 늦추는 방안을 검토하세요.',
  HARD_SPENDING_SHORTFALL: '목표 생활비를 조정하거나 은퇴 전 적립액을 늘리는 방안을 검토하세요.',
  HARD_ASSET_SURVIVAL: '생활비와 은퇴 전 적립액을 점검해 자산 고갈을 줄일 수 있는지 검토하세요.',
  HARD_MINIMUM_ENDING_ASSETS: '남기려는 자산 목표액과 은퇴 전 적립액을 검토하세요.',
  HARD_UNSPECIFIED: '위반된 조건이 기록되지 않아 구체적인 조정 방향을 확인할 수 없습니다.',
};

/** 탈락 사유는 전체 후보에서 모은 조건이므로 각 조건이 모든 후보에 적용됐다고 단정하지 않는다. */
export function describeBlockedConstraints(codes: readonly HardConstraintRejectionCode[]): string[] {
  return [...new Set(codes)].map((code) => `${hardConstraintLabel(code)}: ${actions[code]}`);
}

export const RECHECK_CONSTRAINTS = `목표의 우선순위와 조건 강도도 확인하세요. 「${RETIREMENT_GOAL_CONSTRAINT_LABELS.HARD}」를 「${RETIREMENT_GOAL_CONSTRAINT_LABELS.SOFT}」으로 바꾸면 해당 목표가 필수 조건에서 제외됩니다. 조정 후 다시 분석해야 결과를 알 수 있습니다.`;
