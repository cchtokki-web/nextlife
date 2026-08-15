import { describe, test, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { SimulationParams } from '@/core/entities/types';
import { initialParams } from '@/infrastructure/storage/localStore';
import { useAnalysisRequest } from '@/web/features/RetirementAnalysis/useAnalysisRequest';
import type { AnalysisRequest } from '@/web/features/RetirementAnalysis/AnalysisRuntime';

const ANALYZED_AT = '2026-08-01T00:00:00.000Z';

function paramsWithAge(age: number): SimulationParams {
  return { ...initialParams, userProfile: { ...initialParams.userProfile, currentAge: age } };
}

interface HookProps {
  isLoaded: boolean;
  activeScenarioId: string | null;
  analyzedAt: string | null;
  params: SimulationParams;
}

let buildRequest: (params: SimulationParams) => AnalysisRequest;

function render(initial: HookProps) {
  return renderHook(
    (props: HookProps) => useAnalysisRequest({
      isLoaded: props.isLoaded,
      activeScenarioId: props.activeScenarioId,
      analyzedAt: props.analyzedAt,
      buildRequest: () => buildRequest(props.params),
    }),
    { initialProps: initial }
  );
}

beforeEach(() => {
  buildRequest = vi.fn(
    (params: SimulationParams): AnalysisRequest => ({ params, compareScenarios: [] })
  );
});

describe('useAnalysisRequest — 저장된 계획 복원', () => {
  // 이 훅이 존재하는 이유. 예전에는 요청이 평범한 useState라 새로고침·재로그인 뒤 화면이
  // 언제나 "은퇴 계획을 만들어 보세요"로 시작했다 — 설정은 돌아오는데 결과만 사라졌다.
  test('분석했던 시나리오는 로드가 끝나는 즉시 요청을 세운다', () => {
    const params = paramsWithAge(51);
    const { result } = render({
      isLoaded: true, activeScenarioId: 's1', analyzedAt: ANALYZED_AT, params,
    });

    expect(result.current.request).not.toBeNull();
    expect(result.current.request!.params).toBe(params);
  });

  test('분석한 적 없는 시나리오는 요청을 세우지 않는다', () => {
    const { result } = render({
      isLoaded: true, activeScenarioId: 's1', analyzedAt: null, params: initialParams,
    });

    expect(result.current.request).toBeNull();
    expect(buildRequest).not.toHaveBeenCalled();
  });

  // 적재가 끝나기 전의 params는 initialParams 폴백이다. 그것으로 요청을 세우면 사용자의
  // 실제 자산이 아니라 기본값을 분석한 대시보드가 한 번 뜬다.
  test('적재가 끝나기 전에는 아무것도 세우지 않는다', () => {
    const { result, rerender } = render({
      isLoaded: false, activeScenarioId: null, analyzedAt: null, params: initialParams,
    });

    expect(result.current.request).toBeNull();
    expect(buildRequest).not.toHaveBeenCalled();

    const loaded = paramsWithAge(51);
    rerender({ isLoaded: true, activeScenarioId: 's1', analyzedAt: ANALYZED_AT, params: loaded });

    expect(result.current.request!.params).toBe(loaded);
  });

  // 렌더 중 조정이라 안내 문구로 한 번 커밋한 뒤 대시보드로 바뀌는 깜빡임이 없어야 한다.
  test('복원은 첫 커밋에서 끝난다', () => {
    let commits = 0;
    const params = paramsWithAge(51);
    renderHook(() => {
      commits += 1;
      return useAnalysisRequest({
        isLoaded: true,
        activeScenarioId: 's1',
        analyzedAt: ANALYZED_AT,
        buildRequest: () => ({ params, compareScenarios: [] }),
      });
    });

    // 렌더 중 setState는 커밋 전에 다시 렌더하지만, 커밋은 한 번만 일어난다.
    expect(commits).toBeLessThanOrEqual(2);
  });

  test('같은 시나리오에 머무는 동안 다시 세우지 않는다', () => {
    const params = paramsWithAge(51);
    const { result, rerender } = render({
      isLoaded: true, activeScenarioId: 's1', analyzedAt: ANALYZED_AT, params,
    });
    const restored = result.current.request;

    rerender({ isLoaded: true, activeScenarioId: 's1', analyzedAt: ANALYZED_AT, params });
    rerender({ isLoaded: true, activeScenarioId: 's1', analyzedAt: ANALYZED_AT, params });

    expect(result.current.request).toBe(restored);
    expect(buildRequest).toHaveBeenCalledTimes(1);
  });

  // 사용자가 설정을 고치면 대시보드는 stale로 판정되어 "다시 분석해 주세요"로 물러난다.
  // 훅이 그때마다 새 요청을 세우면 그 안내가 영영 뜨지 않고, 무거운 재계산이 타이핑마다 돈다.
  test('설정을 고쳐도 스스로 다시 분석하지 않는다', () => {
    const { result, rerender } = render({
      isLoaded: true, activeScenarioId: 's1', analyzedAt: ANALYZED_AT, params: paramsWithAge(51),
    });
    const restored = result.current.request;

    rerender({
      isLoaded: true, activeScenarioId: 's1', analyzedAt: ANALYZED_AT, params: paramsWithAge(52),
    });

    expect(result.current.request).toBe(restored);
  });

  // 초기화는 요청을 지우고 분석 표시도 함께 지운다. 되살아나면 초기화가 무의미해진다.
  test('요청을 지운 뒤 되살아나지 않는다', () => {
    const { result, rerender } = render({
      isLoaded: true, activeScenarioId: 's1', analyzedAt: ANALYZED_AT, params: paramsWithAge(51),
    });

    act(() => result.current.setRequest(null));
    rerender({
      isLoaded: true, activeScenarioId: 's1', analyzedAt: null, params: initialParams,
    });

    expect(result.current.request).toBeNull();
  });
});

describe('useAnalysisRequest — 시나리오 전환', () => {
  test('분석했던 다른 시나리오로 옮기면 그 시나리오로 다시 세운다', () => {
    const first = paramsWithAge(51);
    const { result, rerender } = render({
      isLoaded: true, activeScenarioId: 's1', analyzedAt: ANALYZED_AT, params: first,
    });
    expect(result.current.request!.params).toBe(first);

    const second = paramsWithAge(61);
    rerender({ isLoaded: true, activeScenarioId: 's2', analyzedAt: ANALYZED_AT, params: second });

    expect(result.current.request!.params).toBe(second);
    expect(buildRequest).toHaveBeenCalledTimes(2);
  });

  // 남겨 두면 그 결과는 stale로 판정되어 "입력 변경사항을 다시 분석해 주세요"가 뜨는데,
  // 한 번도 분석한 적 없는 시나리오에서 그 문구는 사실이 아니다.
  test('분석한 적 없는 시나리오로 옮기면 이전 결과를 지운다', () => {
    const { result, rerender } = render({
      isLoaded: true, activeScenarioId: 's1', analyzedAt: ANALYZED_AT, params: paramsWithAge(51),
    });
    expect(result.current.request).not.toBeNull();

    rerender({
      isLoaded: true, activeScenarioId: 's2', analyzedAt: null, params: paramsWithAge(61),
    });

    expect(result.current.request).toBeNull();
  });

  test('돌아오면 다시 복원한다', () => {
    const first = paramsWithAge(51);
    const { result, rerender } = render({
      isLoaded: true, activeScenarioId: 's1', analyzedAt: ANALYZED_AT, params: first,
    });

    rerender({ isLoaded: true, activeScenarioId: 's2', analyzedAt: null, params: paramsWithAge(61) });
    expect(result.current.request).toBeNull();

    rerender({ isLoaded: true, activeScenarioId: 's1', analyzedAt: ANALYZED_AT, params: first });
    expect(result.current.request!.params).toBe(first);
  });
});
