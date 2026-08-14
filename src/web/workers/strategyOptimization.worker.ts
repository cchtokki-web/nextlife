import { LegacySimulationAdapter } from '../../core/domain/input/LegacySimulationAdapter';
import { LegacySimulationEngine } from '../../core/simulation/LegacySimulationEngine';
import { StrategyOptimizer } from '../../core/strategy/StrategyOptimizer';
import { MonteCarloEngine } from '../../core/usecases/montecarlo/MonteCarloEngine';
import { resolveMonteCarloConfig } from '../../core/usecases/montecarlo/volatilityPresets';
import type {
  StrategyOptimizationRequest,
  StrategyOptimizationResponse,
} from './strategyOptimizationProtocol';

const engine = new LegacySimulationEngine();
const optimizer = new StrategyOptimizer(
  engine,
  undefined,
  undefined,
  new MonteCarloEngine(engine),
);

self.onmessage = (event: MessageEvent<StrategyOptimizationRequest>) => {
  const { requestId, params } = event.data;

  try {
    const input = LegacySimulationAdapter.fromLegacy(params);
    const result = optimizer.optimize(input.profile, input.goals, input.strategy, {
      monteCarlo: {
        config: resolveMonteCarloConfig(params),
        shortlistLimit: 20,
        finalistLimit: 3,
      },
    });
    const response: StrategyOptimizationResponse = { kind: 'done', requestId, result };
    self.postMessage(response);
  } catch (error) {
    const response: StrategyOptimizationResponse = {
      kind: 'error',
      requestId,
      message: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
};

export {};
