import type { SimulationParams } from '../../core/entities/types';
import type { StrategyOptimizationResult } from '../../core/strategy/StrategyOptimizer';

export interface StrategyOptimizationRequest {
  kind: 'run';
  requestId: number;
  params: SimulationParams;
}

export type StrategyOptimizationResponse =
  | { kind: 'done'; requestId: number; result: StrategyOptimizationResult }
  | { kind: 'error'; requestId: number; message: string };
