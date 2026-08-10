import { ObjectivePriority, UtilityConfig } from '../../entities/types';
import { DEFAULT_UTILITY_CONFIG } from '../utility/utilityWeights';

// 목표 우선순위(목적 함수) → Lifetime Utility 가중치.
// 합이 반드시 100이어야 하며 createUtilityConfig가 런타임에 이를 강제한다
// (objectivePresets.test.ts가 테이블 전체를 전수 검증한다).
//
// 값은 기본값(35/20/15/10/10/10)에서 해당 목표의 축을 키우고 나머지를 줄인 것이다.
// 특정 축을 0으로 만들지 않는 이유: Utility는 6개 축의 균형 점수이며 한 축이 0이면
// 그 축이 파탄난 전략(예: 세금 최소화를 골랐더니 생활비가 고갈)이 만점을 받을 수 있다.
export const OBJECTIVE_WEIGHT_PRESETS: Record<ObjectivePriority, UtilityConfig['weights']> = {
  // 평생 생활비 확보: 소비 수준과 고갈 방지가 압도적으로 중요하다.
  lifetime_spending: {
    consumption: 45, depletionSafety: 25, pensionUtilization: 15,
    taxEfficiency: 5, taxationRisk: 5, bequestAdequacy: 5,
  },
  // 세금 최소화: 세금 효율과 과세 위험 관리를 끌어올린다.
  tax_minimization: {
    consumption: 25, depletionSafety: 15, pensionUtilization: 15,
    taxEfficiency: 25, taxationRisk: 15, bequestAdequacy: 5,
  },
  // 자산 최대화: 자산을 오래 남기는 방향 = 고갈 방지 + 잔여자산.
  wealth_maximization: {
    consumption: 25, depletionSafety: 30, pensionUtilization: 15,
    taxEfficiency: 10, taxationRisk: 5, bequestAdequacy: 15,
  },
  // 상속 최대화: 잔여자산 적정성이 최우선.
  bequest_maximization: {
    consumption: 20, depletionSafety: 20, pensionUtilization: 10,
    taxEfficiency: 10, taxationRisk: 5, bequestAdequacy: 35,
  },
  // AI 추천: 사용자가 목표를 정하지 않은 상태다. 특정 축으로 기울이지 않고 기본 가중치를
  // 그대로 쓴다. 목표(objective) 자체를 제안하는 경로는 없다 — StrategyRecommendation에는
  // 목표를 담는 필드가 없고, objective는 오직 사용자가 화면에서 고를 때만 바뀐다.
  // 이 값이 기본 가중치와 달라지면 "목표 미정"이 조용히 특정 목표로 채점된다.
  ai_recommended: DEFAULT_UTILITY_CONFIG.weights,
};

