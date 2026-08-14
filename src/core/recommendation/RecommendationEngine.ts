import type { StrategyRecommendation } from '../entities/types';
import type { RetirementProfile, RetirementStrategy } from '../domain/input/retirement';

/** Strategy recommendation boundary; implementations must not mutate their inputs. */
export interface RecommendationEngine {
  recommend(
    profile: RetirementProfile,
    strategy: RetirementStrategy
  ): StrategyRecommendation;
}
