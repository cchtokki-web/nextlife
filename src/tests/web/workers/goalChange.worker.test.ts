import { afterEach, expect, test, vi } from 'vitest';
import { initialParams } from '@/infrastructure/storage/localStore';

afterEach(() => { vi.unstubAllGlobals(); vi.doUnmock('@/core/usecases/goals/evaluateGoalChanges'); });

test('워커는 공용 계산 결과를 그대로 전달한다', async () => {
  vi.resetModules();
  const calculated = { baselineProbability: 0.7, trials: 2000, proposals: [] };
  const evaluate = vi.fn(() => calculated);
  const postMessage = vi.fn();
  vi.doMock('@/core/usecases/goals/evaluateGoalChanges', () => ({ evaluateGoalChanges: evaluate }));
  vi.stubGlobal('self', { postMessage });
  await import('@/web/workers/goalChange.worker');
  const handler = (globalThis.self as unknown as { onmessage: (event: { data: unknown }) => void }).onmessage;
  handler({ data: { params: initialParams } });
  expect(evaluate).toHaveBeenCalledWith(initialParams);
  expect(postMessage).toHaveBeenCalledWith({ kind: 'done', ...calculated });
});
