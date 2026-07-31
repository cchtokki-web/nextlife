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

  test('params 참조가 같으면 recommendStrategy를 다시 호출하지 않는다', () => {
    const spy = vi.spyOn(RecommendationEngine, 'recommendStrategy')
      .mockReturnValue({ improved: false } as never);

    const { rerender } = renderHook(({ p }) => useAiRecommendation(p), {
      initialProps: { p: initialParams },
    });
    rerender({ p: initialParams });

    expect(spy).toHaveBeenCalledTimes(1);
  });

  // 실제 회귀 시나리오: StrategySettingsPanel은 매 렌더마다 새 params 객체를 받을 수 있다
  // (예: 부모 재렌더, useDeferredValue를 거친 값 등) — 내용이 그대로라도 참조는 다르다.
  // useMemo의 기본 참조 비교(`[params]`)만으로는 이 경우를 잡지 못해 매번 recommendStrategy
  // (최대 162개 후보 시뮬레이션)가 재실행된다. 이 훅은 내용 기반 키(JSON.stringify)로
  // 메모이제이션해야 하며, 이 테스트가 참조 동일성 테스트보다 그 계약을 더 정확히 증명한다.
  test('참조는 다르지만 내용이 같은 params가 들어오면 recommendStrategy를 다시 호출하지 않는다', () => {
    const spy = vi.spyOn(RecommendationEngine, 'recommendStrategy')
      .mockReturnValue({ improved: false } as never);

    const { rerender } = renderHook(({ p }) => useAiRecommendation(p), {
      initialProps: { p: initialParams },
    });
    // 구조적으로는 initialParams와 동일하지만 참조는 다른 새 객체.
    rerender({ p: { ...initialParams, userProfile: { ...initialParams.userProfile } } });

    expect(spy).toHaveBeenCalledTimes(1);
  });

  test('내용이 실제로 달라지면(params 값 변경) recommendStrategy를 다시 호출한다', () => {
    const spy = vi.spyOn(RecommendationEngine, 'recommendStrategy')
      .mockReturnValue({ improved: false } as never);

    const { rerender } = renderHook(({ p }) => useAiRecommendation(p), {
      initialProps: { p: initialParams },
    });
    rerender({
      p: {
        ...initialParams,
        userProfile: { ...initialParams.userProfile, targetMonthlySpending: 4000000 },
      },
    });

    expect(spy).toHaveBeenCalledTimes(2);
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
        riskProfile: 'neutral' as const,
        economicScenario: 'long_term_average' as const,
      },
    };

    renderHook(() => useAiRecommendation(params));

    const cfg = spy.mock.calls[0][2];
    expect(cfg?.weights.taxEfficiency).toBe(25);
  });
});
