import type { UtilityConfig } from '../entities/types';
import type { LegacySimulationConfig } from '../domain/input/retirement';
import { LegacySimulationAdapter } from '../domain/input/LegacySimulationAdapter';
import type { RecommendationEngine } from './RecommendationEngine';
import { LegacySimulationEngine } from '../simulation/LegacySimulationEngine';
import { recommendStrategy } from '../usecases/strategy/RecommendationEngine';

/** Preserves the current candidate generation, scoring, and ordering without modification. */
export class LegacyRecommendationEngine implements RecommendationEngine {
  constructor(private readonly simulationEngine: LegacySimulationEngine) {}

  recommend(
    profile: Parameters<RecommendationEngine['recommend']>[0],
    strategy: Parameters<RecommendationEngine['recommend']>[1]
  ): ReturnType<RecommendationEngine['recommend']> {
    return recommendStrategy(
      LegacySimulationAdapter.toLegacy(profile, strategy),
      this.simulationEngine,
      strategy.utilityConfig
    );
  }

  recommendLegacyConfig(
    config: LegacySimulationConfig,
    utilityConfig?: UtilityConfig
  ): ReturnType<RecommendationEngine['recommend']> {
    const { profile, strategy } = LegacySimulationAdapter.fromLegacy(config, utilityConfig);
    return this.recommend(profile, strategy);
  }
}
