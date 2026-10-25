import type { UtilityConfig } from '../entities/types';
import type { LegacySimulationConfig } from '../domain/input/retirement';
import { LegacySimulationAdapter } from '../domain/input/LegacySimulationAdapter';
import type { LegacyRecommendationEngineContract } from './RecommendationEngine';
import { LegacySimulationEngine } from '../simulation/LegacySimulationEngine';
import { recommendStrategy } from '../usecases/strategy/RecommendationEngine';

/**
 * 기존 `recommendStrategy`(usecases/strategy/RecommendationEngine.ts)를 도메인 모델로 감싼
 * 호환 어댑터. 후보 생성·점수·정렬을 그대로 보존한다.
 *
 * **어느 쪽을 쓸지**: 신규 목표 기반 흐름은 이 클래스가 아니라 StrategyOptimizer와
 * recommendation/RecommendationEngine(안정형·균형형·여유형)을 쓴다. 이 클래스는 기존 화면과
 * 저장 데이터 경로의 호환을 위해서만 남아 있다.
 *
 * 이름이 비슷한 파일이 셋이라 혼동하기 쉽다:
 * - `recommendation/RecommendationEngine.ts` — 신규 페르소나 엔진(그리고 이 클래스가 구현하는 계약)
 * - `usecases/strategy/RecommendationEngine.ts` — 구 `recommendStrategy` 구현
 * - 이 파일 — 둘을 잇는 어댑터
 */
export class LegacyRecommendationEngine implements LegacyRecommendationEngineContract {
  constructor(private readonly simulationEngine: LegacySimulationEngine) {}

  recommend(
    profile: Parameters<LegacyRecommendationEngineContract['recommend']>[0],
    goals: Parameters<LegacyRecommendationEngineContract['recommend']>[1],
    strategy: Parameters<LegacyRecommendationEngineContract['recommend']>[2]
  ): ReturnType<LegacyRecommendationEngineContract['recommend']> {
    return recommendStrategy(
      LegacySimulationAdapter.toLegacy(profile, goals, strategy),
      this.simulationEngine,
      strategy.utilityConfig
    );
  }

  recommendLegacyConfig(
    config: LegacySimulationConfig,
    utilityConfig?: UtilityConfig
  ): ReturnType<LegacyRecommendationEngineContract['recommend']> {
    const { profile, goals, strategy } = LegacySimulationAdapter.fromLegacy(config, utilityConfig);
    return this.recommend(profile, goals, strategy);
  }
}
