import type { StrategySimulationResult } from '../entities/types';
import type { RetirementProfile, RetirementStrategy } from '../domain/input/retirement';

/**
 * Framework-independent, deterministic single-strategy evaluator.
 *
 * Goal scoring, recommendation, utility selection, UI copy and Monte Carlo belong to later layers.
 */
export interface SimulationEngine {
  simulate(
    profile: RetirementProfile,
    strategy: RetirementStrategy
  ): StrategySimulationResult;
}
