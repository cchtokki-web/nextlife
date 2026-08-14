import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { SimulationParams } from '@/core/entities/types';
import { useStrategyOptimization } from '@/web/hooks/useStrategyOptimization';

const params: SimulationParams = {
  userProfile: { currentAge: 50, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3_000_000 },
  assets: [],
  nationalPension: { expectedMonthlyAmount: 0 },
  privatePensions: [],
  otherIncomes: [],
  inflationRate: 2,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
}

describe('useStrategyOptimization', () => {
  afterEach(() => vi.useRealTimers());

  test('입력을 워커로 보내고 최종 3개 결과를 받는다', async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const { result } = renderHook(() => useStrategyOptimization(params, {
      createWorker: () => worker as unknown as Worker,
      debounceMs: 1,
    }));

    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(result.current.status).toBe('running');
    expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: 'run', params }));

    act(() => worker.onmessage?.({
      data: {
        kind: 'done', requestId: 1,
        result: { best: null, rankedCandidates: [], debug: {} },
      },
    } as MessageEvent));

    expect(result.current.status).toBe('done');
    expect(result.current.result?.rankedCandidates).toEqual([]);
  });

  test('입력이 바뀌면 이전 결과와 워커 응답을 즉시 무효화한다', async () => {
    vi.useFakeTimers();
    const firstWorker = new FakeWorker();
    const secondWorker = new FakeWorker();
    const workers = [firstWorker, secondWorker];
    const changedParams: SimulationParams = {
      ...params,
      userProfile: { ...params.userProfile, retirementAge: 62 },
    };
    const oldResult = { best: null, rankedCandidates: [{ rank: 1 }], debug: {} };
    const newResult = { best: null, rankedCandidates: [{ rank: 2 }], debug: {} };
    const { result, rerender } = renderHook(
      ({ value }) => useStrategyOptimization(value, {
        createWorker: () => workers.shift() as unknown as Worker,
        debounceMs: 10,
      }),
      { initialProps: { value: params } },
    );

    await act(async () => vi.advanceTimersByTimeAsync(10));
    const firstRequest = firstWorker.postMessage.mock.calls[0][0];
    act(() => firstWorker.onmessage?.({
      data: { kind: 'done', requestId: firstRequest.requestId, result: oldResult },
    } as MessageEvent));
    expect(result.current.status).toBe('done');

    rerender({ value: changedParams });
    expect(result.current.status).toBe('idle');
    expect(result.current.result).toBeUndefined();
    expect(firstWorker.terminate).toHaveBeenCalledOnce();

    // 종료 직전에 큐에 들어온 이전 응답도 새 입력의 결과로 되살아나면 안 된다.
    act(() => firstWorker.onmessage?.({
      data: { kind: 'done', requestId: firstRequest.requestId, result: oldResult },
    } as MessageEvent));
    expect(result.current.result).toBeUndefined();

    await act(async () => vi.advanceTimersByTimeAsync(10));
    const secondRequest = secondWorker.postMessage.mock.calls[0][0];
    act(() => secondWorker.onmessage?.({
      data: { kind: 'done', requestId: secondRequest.requestId, result: newResult },
    } as MessageEvent));
    expect(result.current.status).toBe('done');
    expect(result.current.result).toBe(newResult);
  });
});
