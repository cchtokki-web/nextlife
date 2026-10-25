'use client';

import { useEffect, useRef, useState } from 'react';
import type { SimulationParams } from '../../core/entities/types';
import type { StrategyOptimizationResult } from '../../core/strategy/StrategyOptimizer';
import {
  parseOptimizationResponse,
  type StrategyOptimizationRequest,
} from '../workers/strategyOptimizationProtocol';

export type StrategyOptimizationStatus = 'idle' | 'running' | 'done' | 'error' | 'unsupported';

interface UseStrategyOptimizationOptions {
  createWorker?: () => Worker;
  debounceMs?: number;
}

interface StrategyOptimizationState {
  paramsKey: string;
  result?: StrategyOptimizationResult;
  status: StrategyOptimizationStatus;
  errorMessage?: string;
}

function defaultCreateWorker(): Worker {
  return new Worker(new URL('../workers/strategyOptimization.worker.ts', import.meta.url), {
    type: 'module',
  });
}

export function useStrategyOptimization(
  params: SimulationParams | undefined,
  options: UseStrategyOptimizationOptions = {},
): {
  result?: StrategyOptimizationResult;
  status: StrategyOptimizationStatus;
  errorMessage?: string;
} {
  const { createWorker = defaultCreateWorker, debounceMs = 400 } = options;
  const [state, setState] = useState<StrategyOptimizationState>({ paramsKey: '', status: 'idle' });
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
      worker.onmessage = (event: MessageEvent<unknown>) => {
        const response = parseOptimizationResponse(event.data);
        // 알 수 없는 형식의 메시지를 error로 바꾸지 않는다. 예전에는 else 분기가 그렇게 처리해서
        // 정체불명의 메시지 하나가 정상 계산을 실패로 뒤집을 수 있었다.
        if (!response || response.requestId !== requestIdRef.current) return;
        if (response.kind === 'done') {
          setState({ paramsKey, result: response.result, status: 'done' });
        } else {
          console.error('[strategyOptimization] worker reported an error', response.message);
          setState({ paramsKey, status: 'error', errorMessage: response.message });
        }
      };

      // onerror가 없으면 워커 로드 실패·CSP 차단·생성자 예외가 아무 상태 변화도 만들지 못해
      // UI가 영구히 'running'에 머문다. 금융 계산에서 조용한 무한 대기는 오류보다 나쁘다.
      worker.onerror = (event: ErrorEvent) => {
        if (requestId !== requestIdRef.current) return;
        const message = event.message || '백그라운드 계산을 실행하지 못했습니다.';
        console.error('[strategyOptimization] worker crashed', event.message, event.filename, event.lineno);
        setState({ paramsKey, status: 'error', errorMessage: message });
      };

      worker.onmessageerror = () => {
        if (requestId !== requestIdRef.current) return;
        console.error('[strategyOptimization] worker response could not be deserialized');
        setState({ paramsKey, status: 'error', errorMessage: '계산 결과를 전달받지 못했습니다.' });
      };

      const request: StrategyOptimizationRequest = { kind: 'run', requestId, params };
      try {
        worker.postMessage(request);
      } catch (error) {
        // 구조화 복제 불가능한 값(함수·Symbol 등)이 params에 있으면 postMessage가 여기서 던진다.
        // 잡지 않으면 effect 밖으로 튀어 렌더 자체가 깨진다.
        const message = error instanceof Error ? error.message : String(error);
        console.error('[strategyOptimization] failed to post params to worker', error);
        setState({ paramsKey, status: 'error', errorMessage: message });
      }
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
  return { result: state.result, status: state.status, errorMessage: state.errorMessage };
}
