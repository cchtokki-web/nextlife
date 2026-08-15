import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { initialParams } from '@/infrastructure/storage/localStore';

// 워커 모듈은 import 시점에 self.onmessage를 설치한다. 예전에는 엔진 3종을 모듈 최상단에서
// 생성했기 때문에, 그중 하나라도 생성자에서 던지면 onmessage가 아예 설치되지 않았다.
// 그러면 메인 스레드는 응답도 오류도 받지 못한 채 "검증 중" 스피너를 영원히 돌린다.
// 그래서 생성을 요청 처리 안으로 미뤘고, 이 테스트가 그 지연 생성을 고정한다.
describe('strategyOptimization.worker', () => {
  const postMessage = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    postMessage.mockClear();
    vi.stubGlobal('self', { postMessage } as unknown as Window & typeof globalThis);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock('@/core/simulation/LegacySimulationEngine');
  });

  const dispatch = (data: unknown): void => {
    const handler = (globalThis.self as unknown as { onmessage?: (e: { data: unknown }) => void })
      .onmessage;
    expect(handler).toBeTypeOf('function');
    handler!({ data });
  };

  test('엔진 생성이 실패해도 핸들러는 설치되고 오류 응답을 돌려준다', async () => {
    vi.doMock('@/core/simulation/LegacySimulationEngine', () => ({
      LegacySimulationEngine: class {
        constructor() {
          throw new Error('engine construction failed');
        }
      },
    }));

    await import('@/web/workers/strategyOptimization.worker');

    // 어댑터가 먼저 실패하면 엔진 생성까지 가지 못하므로 정상 params를 쓴다.
    dispatch({ kind: 'run', requestId: 7, params: structuredClone(initialParams) });

    // 핵심: 응답이 온다는 것 자체. requestId가 실려야 훅이 버리지 않는다.
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'error',
      requestId: 7,
      message: expect.stringContaining('engine construction failed'),
    }));
  });

  test('형식이 맞지 않는 메시지는 무시하고 응답하지 않는다', async () => {
    await import('@/web/workers/strategyOptimization.worker');

    // requestId를 알 수 없는 메시지에 응답해 봐야 훅이 버린다. 조용히 무시하는 것이 맞다.
    dispatch({ kind: 'cancel', requestId: 1 });
    dispatch({ requestId: 1, params: {} });
    dispatch(null);
    dispatch({ kind: 'run', requestId: 'not-a-number', params: structuredClone(initialParams) });

    expect(postMessage).not.toHaveBeenCalled();
  });
});
