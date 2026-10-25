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

// postMessage 경계는 이 코드베이스에서 타입이 실제로 지워지는 유일한 지점이다. 여기서만은
// 런타임 검사가 필요하다 — 형식이 다른 메시지를 그대로 흘려보내면 undefined가 엔진까지 간다.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parseOptimizationRequest(data: unknown): StrategyOptimizationRequest | null {
  if (!isRecord(data)) return null;
  if (data.kind !== 'run') return null;
  if (typeof data.requestId !== 'number') return null;
  if (!isRecord(data.params)) return null;
  return data as unknown as StrategyOptimizationRequest;
}

export function parseOptimizationResponse(data: unknown): StrategyOptimizationResponse | null {
  if (!isRecord(data)) return null;
  if (typeof data.requestId !== 'number') return null;
  if (data.kind === 'done' && isRecord(data.result)) {
    return data as unknown as StrategyOptimizationResponse;
  }
  if (data.kind === 'error' && typeof data.message === 'string') {
    return data as unknown as StrategyOptimizationResponse;
  }
  return null;
}
