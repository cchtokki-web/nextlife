import { act, renderHook } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { initialParams } from '@/infrastructure/storage/localStore';
import { useAppliedGoalChange } from '@/web/hooks/useAppliedGoalChange';

test('연속으로 변경해도 최초 목표로 복구하고 다른 편집은 덮어쓰지 않는다', () => {
  const change = vi.fn();
  const analyze = vi.fn();
  const first = { ...initialParams, userProfile: { ...initialParams.userProfile, retirementAge: 61 } };
  const second = { ...first, userProfile: { ...first.userProfile, retirementAge: 62 } };
  const { result, rerender } = renderHook(({ params }) => useAppliedGoalChange({ activeParams: params, activeScenarioId: 'scenario', onChangeParams: change, onReanalyze: analyze }), { initialProps: { params: initialParams } });
  act(() => result.current.apply(first));
  expect(change).toHaveBeenLastCalledWith(first);
  rerender({ params: first });
  expect(result.current.canUndo).toBe(true);
  act(() => result.current.apply(second));
  rerender({ params: second });
  act(() => result.current.undo());
  expect(change).toHaveBeenLastCalledWith(initialParams);
  expect(analyze).toHaveBeenLastCalledWith(initialParams);
  act(() => result.current.apply(first));
  rerender({ params: { ...first } });
  expect(result.current.canUndo).toBe(false);
  const calls = change.mock.calls.length;
  act(() => result.current.undo());
  expect(change).toHaveBeenCalledTimes(calls);
});
