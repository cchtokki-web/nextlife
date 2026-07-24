import { describe, test, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBeforeAfterToggle } from '@/web/features/Dashboard/hooks/useBeforeAfterToggle';
import { StrategyRecommendation } from '@/core/entities/types';

function makeRecommendation(improved: boolean): StrategyRecommendation {
  return { improved } as unknown as StrategyRecommendation;
}

type Props = { recommendation?: StrategyRecommendation };

describe('useBeforeAfterToggle', () => {
  test('추천이 없으면 canApply는 false이고 mode는 항상 current다', () => {
    const { result } = renderHook(() => useBeforeAfterToggle({ recommendation: undefined }));
    expect(result.current.canApply).toBe(false);
    expect(result.current.mode).toBe('current');
  });

  test('improved인 추천이 있으면 canApply가 true이고 toggle로 after/current를 오갈 수 있다', () => {
    const { result } = renderHook(() => useBeforeAfterToggle({ recommendation: makeRecommendation(true) }));
    expect(result.current.canApply).toBe(true);
    expect(result.current.mode).toBe('current');

    act(() => result.current.toggle());
    expect(result.current.mode).toBe('after');

    act(() => result.current.toggle());
    expect(result.current.mode).toBe('current');
  });

  test('after 상태에서 추천이 사라지면 자동으로 current로 복귀한다', () => {
    const { result, rerender } = renderHook(
      ({ recommendation }: Props) => useBeforeAfterToggle({ recommendation }),
      { initialProps: { recommendation: makeRecommendation(true) } as Props }
    );
    act(() => result.current.toggle());
    expect(result.current.mode).toBe('after');

    rerender({ recommendation: undefined });
    expect(result.current.mode).toBe('current');
  });

  test('after 상태에서 improved가 false로 바뀌면 자동으로 current로 복귀한다', () => {
    const { result, rerender } = renderHook(
      ({ recommendation }: Props) => useBeforeAfterToggle({ recommendation }),
      { initialProps: { recommendation: makeRecommendation(true) } as Props }
    );
    act(() => result.current.toggle());
    expect(result.current.mode).toBe('after');

    rerender({ recommendation: makeRecommendation(false) });
    expect(result.current.mode).toBe('current');
  });
});
