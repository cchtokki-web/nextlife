import type { GoalFailureBreakdown } from '../../core/entities/montecarlo';
import type { GoalSuccessConditions } from '../../core/usecases/goals/goalSuccessConditions';

// 실패 원인이 하나도 없는 breakdown. MonteCarloResult를 손으로 만드는 테스트가 목표 달성
// 실패 사유를 검증 대상으로 삼지 않을 때 쓴다 — 이 값이면 진단 카드의 사유 블록이 렌더되지
// 않으므로, 기존 테스트의 기대 문구가 새 필드 때문에 흔들리지 않는다.
export const NO_GOAL_FAILURE: GoalFailureBreakdown = {
  spendingShortfall: 0,
  assetDepletion: 0,
  observedAssetDepletionCount: 0,
  terminalShortfall: 0,
  medianFirstShortfallAge: null,
  terminalAssetGoal: 0,
};

// 목표 도입 이전과 같은 조건(생활비·고갈·기말자산). MonteCarloResult를 손으로 만드는
// 테스트가 목표 반영 여부를 검증 대상으로 삼지 않을 때 쓴다 — legacy_plan이면 진단 카드의
// 목표 반영 안내가 렌더되지 않으므로 기존 기대 문구가 흔들리지 않는다.
export const LEGACY_GOAL_CONDITIONS: GoalSuccessConditions = {
  basis: 'legacy_plan',
  requireSpendingTarget: true,
  requireAssetSurvival: true,
  terminalAssetGoal: 0,
  unmeasuredGoals: [],
};
