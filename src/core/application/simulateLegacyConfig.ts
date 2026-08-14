import type { UtilityConfig, SimulationResult } from '../entities/types';
import type { LegacySimulationConfig } from '../domain/input/retirement';
import { LegacySimulationAdapter } from '../domain/input/LegacySimulationAdapter';
import type { SimulationEngine } from '../simulation/SimulationEngine';

/** Application-layer compatibility entry point for existing UI and stored scenarios. */
export function simulateLegacyConfig(
  engine: SimulationEngine,
  config: LegacySimulationConfig,
  utilityConfig?: UtilityConfig
): SimulationResult {
  const { profile, strategy } = LegacySimulationAdapter.fromLegacy(config, utilityConfig);
  return engine.simulate(profile, strategy);
}
