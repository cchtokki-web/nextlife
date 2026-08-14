import { describe, expect, test } from 'vitest';
import { simulateLegacyConfig } from '@/core/application/simulateLegacyConfig';
import { LegacySimulationAdapter } from '@/core/domain/input/LegacySimulationAdapter';
import type { SimulationEngine } from '@/core/simulation/SimulationEngine';
import { LegacySimulationEngine } from '@/core/simulation/LegacySimulationEngine';
import { compileStrategy } from '@/core/usecases/strategy/compileStrategy';
import { initialParams } from '@/infrastructure/storage/localStore';

describe('new simulation boundary over the legacy engine', () => {
  test('legacy config adapter round-trips without changing or mutating persisted input', () => {
    const legacyConfig = structuredClone(initialParams);
    const before = structuredClone(legacyConfig);
    const compiled = compileStrategy(legacyConfig);

    const { profile, strategy } = LegacySimulationAdapter.fromLegacy(
      legacyConfig,
      compiled.utilityConfig
    );

    expect(LegacySimulationAdapter.toLegacy(profile, strategy)).toEqual(legacyConfig);
    expect(legacyConfig).toEqual(before);
  });

  test('simulate(profile, strategy) is exactly equal to the pre-refactor run result', () => {
    const legacyEngine = new LegacySimulationEngine();
    const compiled = compileStrategy(structuredClone(initialParams));
    const before = legacyEngine.run(compiled.params, compiled.utilityConfig);
    const { profile, strategy } = LegacySimulationAdapter.fromLegacy(
      compiled.params,
      compiled.utilityConfig
    );

    const engine: SimulationEngine = legacyEngine;
    const after = engine.simulate(profile, strategy);

    expect(after).toEqual(before);
  });

  test('application entry point runs without React or browser state', () => {
    const engine: SimulationEngine = new LegacySimulationEngine();
    const compiled = compileStrategy(structuredClone(initialParams));

    const result = simulateLegacyConfig(engine, compiled.params, compiled.utilityConfig);

    expect(result.yearlyResults.length).toBeGreaterThan(0);
    expect(result.yearlyResults[0].age).toBe(compiled.params.userProfile.currentAge);
    expect(result.yearlyResults.at(-1)?.age).toBe(compiled.params.userProfile.expectancy);
  });
});
