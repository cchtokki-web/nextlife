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


test('변경안 확정은 현재 목표를 유지하고 복구 이력만 지운다', () => {
  const change = vi.fn();
  const analyze = vi.fn();
  const updated = { ...initialParams, userProfile: { ...initialParams.userProfile, retirementAge: 61 } };
  const { result, rerender } = renderHook(({ params }) => useAppliedGoalChange({ activeParams: params, activeScenarioId: 'scenario', onChangeParams: change, onReanalyze: analyze }), { initialProps: { params: initialParams } });
  act(() => result.current.apply(updated));
  rerender({ params: updated });
  expect(result.current.canUndo).toBe(true);
  const calls = change.mock.calls.length;
  act(() => result.current.confirm());
  expect(result.current.canUndo).toBe(false);
  expect(change).toHaveBeenCalledTimes(calls);
  act(() => result.current.undo());
  expect(change).toHaveBeenCalledTimes(calls);
});
