'use client';

import { useEffect, useRef, useState } from 'react';
import type { SimulationParams } from '../../core/entities/types';
import type { StrategyOptimizationResult } from '../../core/strategy/StrategyOptimizer';
import type {
  StrategyOptimizationRequest,
  StrategyOptimizationResponse,
} from '../workers/strategyOptimizationProtocol';

export type StrategyOptimizationStatus = 'idle' | 'running' | 'done' | 'error' | 'unsupported';

interface UseStrategyOptimizationOptions {
  createWorker?: () => Worker;
  debounceMs?: number;
}

function defaultCreateWorker(): Worker {
  return new Worker(new URL('../workers/strategyOptimization.worker.ts', import.meta.url), {
    type: 'module',
  });
}

export function useStrategyOptimization(
  params: SimulationParams | undefined,
  options: UseStrategyOptimizationOptions = {},
): { result?: StrategyOptimizationResult; status: StrategyOptimizationStatus } {
  const { createWorker = defaultCreateWorker, debounceMs = 400 } = options;
  const [state, setState] = useState<{
    paramsKey: string;
    result?: StrategyOptimizationResult;
    status: StrategyOptimizationStatus;
  }>({ paramsKey: '', status: 'idle' });
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const createWorkerRef = useRef(createWorker);

  useEffect(() => {
    createWorkerRef.current = createWorker;
  });

  const paramsKey = params ? JSON.stringify(params) : '';

  useEffect(() => {
    if (!params) return;

    const timer = setTimeout(() => {
      workerRef.current?.terminate();
      workerRef.current = null;

      let worker: Worker;
      try {
        worker = createWorkerRef.current();
      } catch {
        setState({ paramsKey, status: 'unsupported' });
        return;
      }

      const requestId = ++requestIdRef.current;
      workerRef.current = worker;
      setState({ paramsKey, status: 'running' });
      worker.onmessage = (event: MessageEvent<StrategyOptimizationResponse>) => {
        if (event.data.requestId !== requestIdRef.current) return;
        if (event.data.kind === 'done') {
          setState({ paramsKey, result: event.data.result, status: 'done' });
        } else {
          setState({ paramsKey, status: 'error' });
        }
      };

      const request: StrategyOptimizationRequest = { kind: 'run', requestId, params };
      worker.postMessage(request);
    }, debounceMs);

    return () => {
      clearTimeout(timer);
      // 새 params가 렌더된 순간부터 이전 결과를 사용할 수 없게 한다. worker.terminate()만으로는
      // 이미 이벤트 큐에 들어간 응답까지 막지 못하므로 requestId도 즉시 전진시킨다.
      requestIdRef.current += 1;
      workerRef.current?.terminate();
      workerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramsKey, debounceMs]);

  if (!params) return { result: undefined, status: 'idle' };
  // effect cleanup보다 렌더가 먼저 일어나는 React 순서에서도 다른 입력의 결과가 한 프레임
  // 노출되지 않도록, 계산 결과를 그 결과를 만든 직렬화 키와 함께 검증한다.
  if (state.paramsKey !== paramsKey) return { result: undefined, status: 'idle' };
  return { result: state.result, status: state.status };
}
