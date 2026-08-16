import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useMonteCarlo } from '@/web/hooks/useMonteCarlo';
import { SimulationParams } from '@/core/entities/types';
import { MonteCarloRequest, MonteCarloResponse } from '@/web/workers/monteCarloProtocol';
import { NO_GOAL_FAILURE, LEGACY_GOAL_CONDITIONS } from '@/tests/fixtures/goalFailure';

// 워커 생성을 주입 가능하게 둔 이유: jsdom에는 Worker가 없어 훅 테스트가 실제 워커를
// 띄울 수 없다. 이 저장소는 이미 배선 자체를 테스트로 고정하는 관례가 있다
// (useStrategyPipeline.test가 recommendStrategy에 넘어간 params를 검사하듯이).
class FakeWorker {
  static instances: FakeWorker[] = [];
  posted: MonteCarloRequest[] = [];
  terminated = false;
  onmessage: ((event: MessageEvent<MonteCarloResponse>) => void) | null = null;

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(message: MonteCarloRequest) {
    this.posted.push(message);
  }

  terminate() {
    this.terminated = true;
  }

  // 워커가 응답한 것처럼 흉내 낸다.
  respond(response: MonteCarloResponse) {
    this.onmessage?.({ data: response } as MessageEvent<MonteCarloResponse>);
  }
}

const params: SimulationParams = {
  userProfile: { currentAge: 55, retirementAge: 60, expectancy: 85, targetMonthlySpending: 2500000 },
  assets: [],
  isaAccounts: [],
  nationalPension: { expectedMonthlyAmount: 1000000 },
  privatePensions: [],
  otherIncomes: [],
  inflationRate: 2,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

function makeResult(successRate: number) {
  return {
    trials: 1000, seed: 1, successAge: 85, successRate, spendingSuccessRate: successRate,
    goalSuccessProbability: successRate,
    goalFailure: NO_GOAL_FAILURE, goalConditions: LEGACY_GOAL_CONDITIONS,
    plannedMonthlySpending: 3000000,
    endingAssets: { p10: 1, p50: 2, p90: 3 },
    assetDownside: [], depletion: { count: 0, earliestAge: null, medianAge: null },
    deterministicEndingAssets: 2,
  };
}

const createWorker = () => new FakeWorker() as unknown as Worker;

beforeEach(() => {
  FakeWorker.instances = [];
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useMonteCarlo', () => {
  test('디바운스가 지난 뒤 워커에 한 번만 요청한다', async () => {
    const { result } = renderHook(() => useMonteCarlo(params, { createWorker, debounceMs: 400 }));

    expect(result.current.status).toBe('idle');
    expect(FakeWorker.instances).toHaveLength(0);

    await act(async () => { vi.advanceTimersByTime(400); });

    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0].posted).toHaveLength(1);
    expect(result.current.status).toBe('running');
  });

  test('응답이 오면 결과와 done 상태를 준다', async () => {
    const { result } = renderHook(() => useMonteCarlo(params, { createWorker, debounceMs: 400 }));
    await act(async () => { vi.advanceTimersByTime(400); });

    const worker = FakeWorker.instances[0];
    await act(async () => {
      worker.respond({ kind: 'done', requestId: worker.posted[0].requestId, result: makeResult(0.87) });
    });

    await waitFor(() => expect(result.current.status).toBe('done'));
    expect(result.current.result?.successRate).toBe(0.87);
  });

  test('워커가 실패를 알리면 error 상태가 된다', async () => {
    const { result } = renderHook(() => useMonteCarlo(params, { createWorker, debounceMs: 400 }));
    await act(async () => { vi.advanceTimersByTime(400); });

    const worker = FakeWorker.instances[0];
    await act(async () => {
      worker.respond({ kind: 'error', requestId: worker.posted[0].requestId, message: '실패' });
    });

    await waitFor(() => expect(result.current.status).toBe('error'));
  });

  // 계산 중에 입력이 바뀌면 이전 워커는 쓸모없는 일을 계속하고 있다. 협조적 취소 대신
  // terminate()를 쓰는 이유는 훅 주석에 있다.
  test('계산 중 params가 바뀌면 이전 워커를 종료하고 새로 띄운다', async () => {
    const { rerender } = renderHook(
      ({ p }) => useMonteCarlo(p, { createWorker, debounceMs: 400 }),
      { initialProps: { p: params } }
    );
    await act(async () => { vi.advanceTimersByTime(400); });
    const first = FakeWorker.instances[0];

    const changed = { ...params, userProfile: { ...params.userProfile, targetMonthlySpending: 3000000 } };
    rerender({ p: changed });
    await act(async () => { vi.advanceTimersByTime(400); });

    expect(first.terminated).toBe(true);
    expect(FakeWorker.instances).toHaveLength(2);
  });

  // terminate()가 이미 큐에 나간 메시지를 막아 주지는 않는다.
  test('오래된 requestId의 응답은 무시한다', async () => {
    const { result } = renderHook(() => useMonteCarlo(params, { createWorker, debounceMs: 400 }));
    await act(async () => { vi.advanceTimersByTime(400); });

    const worker = FakeWorker.instances[0];
    await act(async () => {
      worker.respond({ kind: 'done', requestId: worker.posted[0].requestId + 999, result: makeResult(0.5) });
    });

    expect(result.current.result).toBeUndefined();
    expect(result.current.status).toBe('running');
  });

  test('언마운트 시 워커를 종료한다', async () => {
    const { unmount } = renderHook(() => useMonteCarlo(params, { createWorker, debounceMs: 400 }));
    await act(async () => { vi.advanceTimersByTime(400); });

    unmount();

    expect(FakeWorker.instances[0].terminated).toBe(true);
  });

  // Worker가 없는 환경(구형 브라우저, SSR, jsdom)에서 화면이 죽으면 안 된다.
  test('Worker를 지원하지 않는 환경이면 unsupported 상태가 된다', async () => {
    const { result } = renderHook(() =>
      useMonteCarlo(params, {
        createWorker: () => { throw new Error('Worker is not defined'); },
        debounceMs: 400,
      })
    );

    await act(async () => { vi.advanceTimersByTime(400); });

    expect(result.current.status).toBe('unsupported');
  });

  test('params가 없으면 아무것도 하지 않는다', async () => {
    const { result } = renderHook(() => useMonteCarlo(undefined, { createWorker, debounceMs: 400 }));

    await act(async () => { vi.advanceTimersByTime(400); });

    expect(FakeWorker.instances).toHaveLength(0);
    expect(result.current.status).toBe('idle');
  });

  test('디바운스 안에 여러 번 바뀌면 마지막 것만 요청한다', async () => {
    const { rerender } = renderHook(
      ({ p }) => useMonteCarlo(p, { createWorker, debounceMs: 400 }),
      { initialProps: { p: params } }
    );

    for (let i = 1; i <= 3; i++) {
      await act(async () => { vi.advanceTimersByTime(100); });
      rerender({ p: { ...params, userProfile: { ...params.userProfile, targetMonthlySpending: 2500000 + i } } });
    }
    await act(async () => { vi.advanceTimersByTime(400); });

    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0].posted[0].params.userProfile.targetMonthlySpending).toBe(2500003);
  });
});
