import { describe, expect, test } from 'vitest';
import { LegacySimulationAdapter } from '@/core/domain/input/LegacySimulationAdapter';
import { LegacyEvaluationEngine } from '@/core/evaluation/LegacyEvaluationEngine';
import { LegacySimulationEngine } from '@/core/simulation/LegacySimulationEngine';
import { computeRiskAlerts } from '@/core/usecases/dashboard/computeRiskAlerts';
import { computeShortfallSummary } from '@/core/usecases/dashboard/computeShortfallSummary';
import { resolvePlanAssetStatus } from '@/core/usecases/dashboard/resolvePlanAssetStatus';
import { resolvePlanOutcome } from '@/core/usecases/dashboard/resolvePlanOutcome';
import { compileStrategy } from '@/core/usecases/strategy/compileStrategy';
import { initialParams } from '@/infrastructure/storage/localStore';

describe('evaluation boundary', () => {
  test('returns the same legacy evaluations without changing the simulation result', () => {
    const compiled = compileStrategy(structuredClone(initialParams));
    const simulationEngine = new LegacySimulationEngine();
    const result = simulationEngine.run(compiled.params, compiled.utilityConfig);
    const resultBefore = structuredClone(result);
    const { profile, strategy } = LegacySimulationAdapter.fromLegacy(
      compiled.params,
      compiled.utilityConfig
    );

    const evaluation = new LegacyEvaluationEngine(simulationEngine)
      .evaluate(profile, strategy, result);

    expect(evaluation.riskAlerts).toEqual(computeRiskAlerts(result, compiled.params));
    expect(evaluation.shortfall).toEqual(computeShortfallSummary(compiled.params, result));
    expect(evaluation.planAssetStatus).toBe(resolvePlanAssetStatus(result, compiled.params));
    expect(evaluation.planOutcome).toEqual(resolvePlanOutcome(result, compiled.params));
    expect(result).toEqual(resultBefore);
  });
});
