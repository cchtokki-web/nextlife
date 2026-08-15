import { act, renderHook } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { SimulationParams } from '@/core/entities/types';
import type { CandidateRecommendation } from '@/core/recommendation/RecommendationEngine';
import { useAppliedStrategy } from '@/web/hooks/useAppliedStrategy';
import { makeParams, makeRanked, type RankedOverrides } from '../../core/usecases/dashboard/strategyFieldFixtures';

function recommendation(overrides: RankedOverrides = {}): CandidateRecommendation {
  const ranked = makeRanked(overrides);
  return {
    persona: 'BALANCED',
    label: '균형형',
    candidate: {
      ...ranked,
      monteCarlo: {
        trials: 1000,
        seed: 20260101,
        goalSuccessProbability: 0.9,
        spendingSuccessProbability: 0.9,
        assetSurvivalProbability: 0.9,
        terminalAssetMedian: 300_000_000,
        terminalAssetP10: 100_000_000,
        terminalAssetP90: 500_000_000,
        shortfallProbability: 0.1,
      },
    },
    reason: '목표 균형',
  };
}

interface Harness {
  activeParams: SimulationParams;
  activeScenarioId: string | null;
}

function setup(initial: Partial<Harness> = {}) {
  const props: Harness = {
    activeParams: initial.activeParams ?? makeParams({
      userProfile: { currentAge: 50, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3_000_000 },
    }),
    activeScenarioId: 'activeScenarioId' in initial ? initial.activeScenarioId! : 'scenario-1',
  };
  let live: Harness = props;

  // useScenarios.handleUpdateActiveParams는 넘겨받은 객체를 그대로 시나리오 data에 넣는다
  // (useScenarios.ts:872). 즉 적용 직후 activeParams는 우리가 만든 «그 참조»가 된다.
  // 훅의 무효화 판정이 이 사실 위에 서 있으므로 하네스도 똑같이 움직인다.
  const onChangeParams = vi.fn<(params: SimulationParams) => void>((next) => {
    live = { ...live, activeParams: next };
    view.rerender(live);
  });
  const onReanalyze = vi.fn<(params: SimulationParams) => void>();

  const view = renderHook(
    ({ activeParams, activeScenarioId }: Harness) =>
      useAppliedStrategy({ activeParams, activeScenarioId, onChangeParams, onReanalyze }),
    { initialProps: props }
  );

  /** 사용자가 사이드바에서 설정을 직접 바꾼 것과 같다(언제나 새 객체가 된다). */
  const editByUser = () => {
    live = { ...live, activeParams: { ...live.activeParams } };
    view.rerender(live);
  };
  const switchScenario = (activeScenarioId: string) => {
    live = { ...live, activeScenarioId };
    view.rerender(live);
  };

  return { ...view, onChangeParams, onReanalyze, props, editByUser, switchScenario };
}

describe('useAppliedStrategy', () => {
  test('적용하면 설정 갱신과 재분석 요청이 같은 params 참조를 받는다', () => {
    const { result, onChangeParams, onReanalyze } = setup();

    act(() => result.current.applyRecommendation(recommendation({ retirementAge: 63 })));

    // 두 호출이 서로 다른 객체를 받으면 analysisIsCurrent(참조 비교)가 깨져
    // 대시보드가 "다시 분석해 주세요"로 한 프레임 사라진다.
    const next = onChangeParams.mock.calls[0][0];
    expect(onReanalyze).toHaveBeenCalledWith(next);
    expect(onReanalyze.mock.calls[0][0]).toBe(next);
    expect(next.userProfile.retirementAge).toBe(63);
  });

  test('적용 결과를 스냅샷으로 남긴다', () => {
    const { result } = setup();

    act(() => result.current.applyRecommendation(
      recommendation({ retirementAge: 63, spendingPattern: 'FRONT_LOADED' })
    ));

    expect(result.current.snapshot).toMatchObject({
      scenarioId: 'scenario-1',
      candidateId: 'candidate-1',
      label: '균형형',
      skippedLabels: ['생활비 배분'],
    });
    expect(result.current.snapshot?.appliedLabels).toContain('은퇴 시점');
  });

  test('되돌리면 적용 직전 params로 복구하고 스냅샷을 지운다', () => {
    const { result, onChangeParams, onReanalyze, props } = setup();

    act(() => result.current.applyRecommendation(recommendation({ retirementAge: 63 })));
    act(() => result.current.undo());

    expect(onChangeParams).toHaveBeenLastCalledWith(props.activeParams);
    expect(onReanalyze).toHaveBeenLastCalledWith(props.activeParams);
    expect(result.current.snapshot).toBeNull();
  });

  test('전략을 연달아 적용해도 최초 원본으로 되돌린다', () => {
    const { result, onChangeParams, props } = setup();

    act(() => result.current.applyRecommendation(recommendation({ retirementAge: 63 })));
    act(() => result.current.applyRecommendation(recommendation({ retirementAge: 64 })));
    act(() => result.current.undo());

    // 전략 A 적용 상태로 돌아가면 사용자의 진짜 원본이 영영 사라진다.
    expect(onChangeParams).toHaveBeenLastCalledWith(props.activeParams);
  });

  test('사용자가 설정을 직접 바꾸면 되돌리기를 제공하지 않는다', () => {
    const { result, editByUser } = setup();

    act(() => result.current.applyRecommendation(recommendation({ retirementAge: 63 })));
    expect(result.current.snapshot).not.toBeNull();

    // handleUpdateActiveParams는 언제나 새 객체를 만든다 — 참조가 달라지면 우리가 넣은
    // params가 아니라는 뜻이고, 그 위에 옛 스냅샷을 덮어쓰면 사용자의 편집이 사라진다.
    act(() => editByUser());

    expect(result.current.snapshot).toBeNull();
  });

  test('시나리오를 전환하면 되돌리기를 제공하지 않는다', () => {
    const { result, switchScenario } = setup();

    act(() => result.current.applyRecommendation(recommendation({ retirementAge: 63 })));
    act(() => switchScenario('scenario-2'));

    expect(result.current.snapshot).toBeNull();
  });

  test('바뀔 것이 없으면 아무 일도 하지 않는다', () => {
    const activeParams = makeParams({
      userProfile: { currentAge: 50, retirementAge: 62, expectancy: 90, targetMonthlySpending: 3_500_000 },
      yieldPreset: 'base',
      withdrawalPlan: { nationalPensionStartAge: 65, accountWithdrawalPolicy: 'ISA_FIRST' },
    });
    const { result, onChangeParams, onReanalyze } = setup({ activeParams });

    act(() => result.current.applyRecommendation(recommendation()));

    expect(onChangeParams).not.toHaveBeenCalled();
    expect(onReanalyze).not.toHaveBeenCalled();
    expect(result.current.snapshot).toBeNull();
  });

  test('활성 시나리오가 없으면 적용하지 않는다', () => {
    // handleUpdateActiveParams가 무동작이라 설정은 그대로인데 배너만 뜨는 상태를 막는다.
    const { result, onChangeParams } = setup({ activeScenarioId: null });

    act(() => result.current.applyRecommendation(recommendation({ retirementAge: 63 })));

    expect(onChangeParams).not.toHaveBeenCalled();
    expect(result.current.snapshot).toBeNull();
  });

  test('canApply는 실제 설정에 반영될 것이 있는지로 판정한다', () => {
    const { result } = setup();

    expect(result.current.canApply(recommendation({ retirementAge: 63 }))).toBe(true);
    // 생활비 배분만 다른 후보는 반영 경로가 없어 눌러도 아무 일이 일어나지 않는다.
    expect(result.current.canApply(recommendation({
      retirementAge: 60, spendingPattern: 'FRONT_LOADED', targetMonthlySpending: 3_000_000,
    }))).toBe(false);
  });

  test('활성 시나리오가 없으면 적용 가능하다고 하지 않는다', () => {
    const { result } = setup({ activeScenarioId: null });

    expect(result.current.canApply(recommendation({ retirementAge: 63 }))).toBe(false);
  });

  test('forget은 되돌리기만 없애고 설정은 건드리지 않는다', () => {
    const { result, onChangeParams } = setup();

    act(() => result.current.applyRecommendation(recommendation({ retirementAge: 63 })));
    onChangeParams.mockClear();
    act(() => result.current.forget());

    expect(result.current.snapshot).toBeNull();
    expect(onChangeParams).not.toHaveBeenCalled();
  });
});
