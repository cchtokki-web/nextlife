import type { StrategyRecommendation } from '../entities/types';
import type { RetirementGoals, RetirementProfile, RetirementStrategy } from '../domain/input/retirement';

/** Strategy recommendation boundary; implementations must not mutate their inputs. */
export interface RecommendationEngine {
  recommend(
    profile: RetirementProfile,
    goals: RetirementGoals,
    strategy: RetirementStrategy
  ): StrategyRecommendation;
}
