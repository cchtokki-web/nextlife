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

  // recommendation.recommendedResult는 사용자가 입력창에 직접 쓴 값(예: 사적연금 수령 개시
  // 나이)이 아니라 AI가 자체 탐색한 후보 중 최적값을 반영한다. after 모드에서 사용자가 폼을
  // 편집해도 이 화면은 여전히 예전 추천값 기준으로 그려져 "입력을 바꿨는데 결과가 그대로"인
  // 것처럼 보이므로, params가 바뀌면(=사용자가 뭔가 편집하면) 항상 current로 되돌려 방금 편집한
  // 값이 실제로 반영된 화면을 보여준다.
  test('after 상태에서 params가 바뀌면(사용자가 폼을 편집하면) 자동으로 current로 복귀한다', () => {
    type ParamsProps = Props & { params: { targetMonthlySpending: number } };
    const { result, rerender } = renderHook(
      ({ recommendation, params }: ParamsProps) => useBeforeAfterToggle({ recommendation, params }),
      { initialProps: { recommendation: makeRecommendation(true), params: { targetMonthlySpending: 3000000 } } }
    );
    act(() => result.current.toggle());
    expect(result.current.mode).toBe('after');

    rerender({ recommendation: makeRecommendation(true), params: { targetMonthlySpending: 3500000 } });
    expect(result.current.mode).toBe('current');
  });

  test('params 참조가 그대로면(리렌더만 발생) after 상태가 유지된다', () => {
    type ParamsProps = Props & { params: { targetMonthlySpending: number } };
    const sameParams = { targetMonthlySpending: 3000000 };
    const { result, rerender } = renderHook(
      ({ recommendation, params }: ParamsProps) => useBeforeAfterToggle({ recommendation, params }),
      { initialProps: { recommendation: makeRecommendation(true), params: sameParams } }
    );
    act(() => result.current.toggle());
    expect(result.current.mode).toBe('after');

    rerender({ recommendation: makeRecommendation(true), params: sameParams });
    expect(result.current.mode).toBe('after');
  });
});
