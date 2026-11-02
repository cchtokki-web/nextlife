import type { SimulationParams } from '../../core/entities/types';
import { evaluateGoalChanges } from '../../core/usecases/goals/evaluateGoalChanges';

self.onmessage = (event: MessageEvent<{ params: SimulationParams }>) => {
  try {
    self.postMessage({ kind: 'done', ...evaluateGoalChanges(event.data.params) });
  } catch (error) {
    self.postMessage({ kind: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
export {};
