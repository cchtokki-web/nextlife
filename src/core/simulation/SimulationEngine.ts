import type { SimulationResult } from '../entities/types';
import type { RetirementProfile, RetirementStrategy } from '../domain/input/retirement';

/** Framework-independent simulation boundary. */
export interface SimulationEngine {
  simulate(
    profile: RetirementProfile,
    strategy: RetirementStrategy
  ): SimulationResult;
}
