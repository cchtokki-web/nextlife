import type { UtilityConfig, SimulationResult } from '../entities/types';
import type { LegacySimulationConfig } from '../domain/input/retirement';
import type { SimulationEngine } from '../simulation/SimulationEngine';

interface LegacySimulationRunner {
  run(config: LegacySimulationConfig, utilityConfig?: UtilityConfig): SimulationResult;
}

function supportsLegacyRun(engine: SimulationEngine): engine is SimulationEngine & LegacySimulationRunner {
  return 'run' in engine && typeof engine.run === 'function';
}

/** Application-layer compatibility entry point for existing UI and stored scenarios. */
export function simulateLegacyConfig(
  engine: SimulationEngine,
  config: LegacySimulationConfig,
  utilityConfig?: UtilityConfig
): SimulationResult {
  // Existing UI/stored-scenario callers still expect calculatedTargetSpending and utility.
  // Keep that richer contract in this explicitly named compatibility adapter, never in the
  // deterministic SimulationEngine.simulate boundary.
  if (supportsLegacyRun(engine)) return engine.run(config, utilityConfig);
  throw new Error('simulateLegacyConfig requires the legacy run compatibility contract');
}
