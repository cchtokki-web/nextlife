import type { SimulationResult } from '../entities/types';
import type { RetirementGoals, RetirementProfile, RetirementStrategy } from '../domain/input/retirement';

/** Framework-independent simulation boundary. */
export interface SimulationEngine {
  simulate(
    profile: RetirementProfile,
    goals: RetirementGoals,
    strategy: RetirementStrategy
  ): SimulationResult;
}
