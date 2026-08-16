import type { SimulationParams } from '../../entities/types';
import {
  normalizeRetirementGoals,
  type RetirementGoal,
} from '../../entities/retirementGoal';
import { resolveStrategy } from '../strategy/compileStrategy';
import { normalizeGoalDrivenParams } from './normalizeGoalDrivenParams';

export function resolveRetirementGoals(params: SimulationParams): RetirementGoal[] {
  // 저수준 필드에서 목표를 «복원하지 않는다» — 사용자가 고르지 않은 목표를 선택된 것으로
  // 꾸미지 않는다는 뜻이다. 카드를 처음 선택할 때 그 값을 target 기본값으로 쓸 뿐이다.
  if (!Array.isArray(params.retirementGoals)) return [];
  return normalizeRetirementGoals(params.retirementGoals);
}

/**
 * 저장된 시나리오를 «읽을 때» 목표 상태를 정돈한다. 화면과 계산이 보는 모든 params가 이
 * 함수를 지난다(useScenarios의 migrateParams).
 *
 * 목표 배열 정규화에 더해, 목표가 정하는 축을 다시 세운다 — 은퇴 나이·목표 생활비·목표
 * 상속자산은 목표에서 파생하고, 생활비 전략·목표 우선순위는 baseline으로 고정한다(뒤의 둘은
 * 목표가 정하는 값이 아니라 «고르는 일 자체를 없앤» 축이다). 그 입력들은 고급 패널에서 제거되어 「은퇴 목표」
 * 카드가 유일한 편집 경로이므로, 저장된 옛 값이 남아 있으면 화면 어디에도 없는 값이 계산을
 * 좌우하게 된다. E2EE라 서버 마이그레이션이라는 선택지가 없어 읽는 시점에 할 수밖에 없다.
 *
 * **정규화를 compileStrategy에 두지 않는 이유**: 그쪽은 "전략(사용자 언어) → 저수준 파라미터"
 * 번역기이고, 어떤 축을 제품이 노출하는가는 그 번역기가 알 일이 아니다. 거기에 두면
 * 배당금만 소비·평생 소비 최적화 같은 엔진 기능이 번역 단계에서 통째로 죽어, 나중에 내부
 * 최적화 엔진이 그 축을 후보로 쓰려 해도 쓸 수 없다.
 */
export function migrateRetirementGoals(params: SimulationParams): SimulationParams {
  const withGoals = Array.isArray(params.retirementGoals)
    ? withNormalizedGoalList(params, params.retirementGoals)
    : params;
  return normalizeGoalDrivenParams(withGoals, resolveStrategy(withGoals));
}

function withNormalizedGoalList(
  params: SimulationParams,
  goals: readonly RetirementGoal[],
): SimulationParams {
  const normalized = normalizeRetirementGoals(goals);
  return JSON.stringify(normalized) === JSON.stringify(goals)
    ? params
    : { ...params, retirementGoals: normalized };
}

/**
 * 목표 편집을 시나리오 설정에 반영한다.
 *
 * 투영 규칙은 여기에 두지 않는다 — 엔진이 읽는 시점에 쓰는 것과 «같은» 함수
 * (normalizeGoalDrivenParams)에 맡긴다. 두 곳에 규칙을 두면 카드에 적힌 값과 계산에 들어간
 * 값이 갈라지고, 그 갈라짐이 정확히 이 화면이 고치려는 결함이었다.
 */
export function applyRetirementGoals(
  params: SimulationParams,
  goals: readonly RetirementGoal[],
): SimulationParams {
  const next = { ...params, retirementGoals: normalizeRetirementGoals(goals) };
  return normalizeGoalDrivenParams(next, resolveStrategy(next));
}
