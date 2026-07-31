import { describe, test, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAiRecommendation } from '@/web/features/StrategySettings/useAiRecommendation';
import { initialParams } from '@/infrastructure/storage/localStore';
import * as RecommendationEngine from '@/core/usecases/strategy/RecommendationEngine';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('useAiRecommendation', () => {
  test('recommendStrategy 결과를 그대로 노출한다', () => {
    const fake = { improved: true, recommendedPlan: { nationalPensionStartAge: 70 } };
    vi.spyOn(RecommendationEngine, 'recommendStrategy').mockReturnValue(fake as never);

    const { result } = renderHook(() => useAiRecommendation(initialParams));

    expect(result.current.recommendation).toBe(fake);
    expect(result.current.improved).toBe(true);
    expect(result.current.error).toBeNull();
  });

  test('params가 같으면 recommendStrategy를 다시 호출하지 않는다', () => {
    const spy = vi.spyOn(RecommendationEngine, 'recommendStrategy')
      .mockReturnValue({ improved: false } as never);

    const { rerender } = renderHook(({ p }) => useAiRecommendation(p), {
      initialProps: { p: initialParams },
    });
    rerender({ p: initialParams });

    expect(spy).toHaveBeenCalledTimes(1);
  });

  test('recommendStrategy가 던지면 error를 채우고 recommendation은 null이다', () => {
    vi.spyOn(RecommendationEngine, 'recommendStrategy').mockImplementation(() => {
      throw new Error('시뮬레이션 실패');
    });

    const { result } = renderHook(() => useAiRecommendation(initialParams));

    expect(result.current.recommendation).toBeNull();
    expect(result.current.error).toBe('추천을 계산하지 못했습니다.');
    expect(result.current.improved).toBe(false);
  });

  test('compileStrategy가 만든 UtilityConfig로 추천을 실행한다', () => {
    const spy = vi.spyOn(RecommendationEngine, 'recommendStrategy')
      .mockReturnValue({ improved: false } as never);

    const params = {
      ...initialParams,
      strategy: {
        mode: 'standard' as const, objective: 'tax_minimization' as const,
        spendingChoice: 'target' as const,
        bequestStrategy: 'maximize' as const, nationalPensionStrategy: 'normal' as const,
        privatePensionStrategy: 'tax_first' as const, preferIsaFirst: false,
        reinvestDividends: true, riskProfile: 'neutral' as const,
        economicScenario: 'long_term_average' as const,
      },
    };

    renderHook(() => useAiRecommendation(params));

    const cfg = spy.mock.calls[0][2];
    expect(cfg?.weights.taxEfficiency).toBe(25);
  });
});
