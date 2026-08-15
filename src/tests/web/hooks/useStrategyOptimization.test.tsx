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
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
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

  test('워커가 죽으면 running에 머물지 않고 오류로 전환한다', async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const { result } = renderHook(() => useStrategyOptimization(params, {
      createWorker: () => worker as unknown as Worker,
      debounceMs: 1,
    }));

    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(result.current.status).toBe('running');

    // 워커 스크립트 로드 실패·CSP 차단·모듈 최상단 예외는 onmessage를 부르지 않는다.
    // onerror가 없던 예전 구현에서는 여기서 영원히 'running'이었다.
    act(() => worker.onerror?.({ message: 'failed to load worker' } as ErrorEvent));
    expect(result.current.status).toBe('error');
    expect(result.current.errorMessage).toBe('failed to load worker');
  });

  test('워커가 보고한 오류 메시지를 버리지 않는다', async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const { result } = renderHook(() => useStrategyOptimization(params, {
      createWorker: () => worker as unknown as Worker,
      debounceMs: 1,
    }));

    await act(async () => vi.advanceTimersByTimeAsync(1));
    const request = worker.postMessage.mock.calls[0][0];
    act(() => worker.onmessage?.({
      data: { kind: 'error', requestId: request.requestId, message: '기말 자산 계산 실패' },
    } as MessageEvent));

    expect(result.current.status).toBe('error');
    expect(result.current.errorMessage).toBe('기말 자산 계산 실패');
  });

  test('형식이 맞지 않는 메시지는 정상 계산을 오류로 뒤집지 않는다', async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const { result } = renderHook(() => useStrategyOptimization(params, {
      createWorker: () => worker as unknown as Worker,
      debounceMs: 1,
    }));

    await act(async () => vi.advanceTimersByTimeAsync(1));
    const request = worker.postMessage.mock.calls[0][0];
    act(() => worker.onmessage?.({
      data: { requestId: request.requestId, somethingElse: true },
    } as MessageEvent));

    expect(result.current.status).toBe('running');
  });

  test('역직렬화 실패(onmessageerror)도 오류로 전환한다', async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const { result } = renderHook(() => useStrategyOptimization(params, {
      createWorker: () => worker as unknown as Worker,
      debounceMs: 1,
    }));

    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(result.current.status).toBe('running');

    // 결과가 구조화 복제를 통과하지 못한 경우. onerror와 달리 이쪽은 커버가 없었다.
    act(() => worker.onmessageerror?.({} as MessageEvent));
    expect(result.current.status).toBe('error');
    expect(result.current.errorMessage).toBeTruthy();
  });

  test('계산 중 언마운트되면 워커를 종료한다', async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const { unmount } = renderHook(() => useStrategyOptimization(params, {
      createWorker: () => worker as unknown as Worker,
      debounceMs: 1,
    }));

    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(worker.postMessage).toHaveBeenCalled();
    expect(worker.terminate).not.toHaveBeenCalled();

    // 응답을 받기 전에 화면을 떠나는 경우. 종료하지 않으면 워커가 계속 돈다.
    unmount();
    expect(worker.terminate).toHaveBeenCalled();
  });
});
