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

  /**
   * 화면에서는 추천 카드가 「달라지는 점」을 서술한 params를 그대로 넘긴다. 그 기준이 활성
   * 설정과 어긋나는 경우는 별도 테스트에서 다루고, 여기서는 둘이 같은 흔한 경우를 만든다.
   */
  const applyRec = (rec: CandidateRecommendation) =>
    view.result.current.applyRecommendation(rec, live.activeParams);

  return { ...view, onChangeParams, onReanalyze, props, editByUser, switchScenario, applyRec };
}

describe('useAppliedStrategy', () => {
  test('적용하면 설정 갱신과 재분석 요청이 같은 params 참조를 받는다', () => {
    const { onChangeParams, onReanalyze, applyRec } = setup();

    act(() => applyRec(recommendation({ retirementAge: 63 })));

    // 두 호출이 서로 다른 객체를 받으면 analysisIsCurrent(참조 비교)가 깨져
    // 대시보드가 "다시 분석해 주세요"로 한 프레임 사라진다.
    const next = onChangeParams.mock.calls[0][0];
    expect(onReanalyze).toHaveBeenCalledWith(next);
    expect(onReanalyze.mock.calls[0][0]).toBe(next);
    expect(next.userProfile.retirementAge).toBe(63);
  });

  test('적용 결과를 스냅샷으로 남긴다', () => {
    const { result, applyRec } = setup();

    act(() => applyRec(recommendation({ retirementAge: 63, spendingPattern: 'FRONT_LOADED' })));

    expect(result.current.snapshot).toMatchObject({
      scenarioId: 'scenario-1',
      candidateId: 'candidate-1',
      label: '균형형',
      skippedLabels: [],
    });
    expect(result.current.snapshot?.appliedLabels).toContain('은퇴 시점');
    expect(result.current.snapshot?.appliedLabels).toContain('생활비 배분');
  });

  test('되돌리면 적용 직전 params로 복구하고 스냅샷을 지운다', () => {
    const { result, onChangeParams, onReanalyze, props, applyRec } = setup();

    act(() => applyRec(recommendation({ retirementAge: 63 })));
    act(() => result.current.undo());

    expect(onChangeParams).toHaveBeenLastCalledWith(props.activeParams);
    expect(onReanalyze).toHaveBeenLastCalledWith(props.activeParams);
    expect(result.current.snapshot).toBeNull();
  });

  test('전략을 연달아 적용해도 최초 원본으로 되돌린다', () => {
    const { result, onChangeParams, props, applyRec } = setup();

    act(() => applyRec(recommendation({ retirementAge: 63 })));
    act(() => applyRec(recommendation({ retirementAge: 64 })));
    act(() => result.current.undo());

    // 전략 A 적용 상태로 돌아가면 사용자의 진짜 원본이 영영 사라진다.
    expect(onChangeParams).toHaveBeenLastCalledWith(props.activeParams);
  });

  test('사용자가 설정을 직접 바꾸면 되돌리기를 제공하지 않는다', () => {
    const { result, editByUser, applyRec } = setup();

    act(() => applyRec(recommendation({ retirementAge: 63 })));
    expect(result.current.snapshot).not.toBeNull();

    // handleUpdateActiveParams는 언제나 새 객체를 만든다 — 참조가 달라지면 우리가 넣은
    // params가 아니라는 뜻이고, 그 위에 옛 스냅샷을 덮어쓰면 사용자의 편집이 사라진다.
    act(() => editByUser());

    expect(result.current.snapshot).toBeNull();
  });

  test('시나리오를 전환하면 되돌리기를 제공하지 않는다', () => {
    const { result, switchScenario, applyRec } = setup();

    act(() => applyRec(recommendation({ retirementAge: 63 })));
    act(() => switchScenario('scenario-2'));

    expect(result.current.snapshot).toBeNull();
  });

  test('바뀔 것이 없으면 아무 일도 하지 않는다', () => {
    const activeParams = makeParams({
      userProfile: { currentAge: 50, retirementAge: 62, expectancy: 90, targetMonthlySpending: 3_500_000 },
      yieldPreset: 'base',
      withdrawalPlan: { nationalPensionStartAge: 65, accountWithdrawalPolicy: 'ISA_FIRST' },
    });
    const { result, onChangeParams, onReanalyze, applyRec } = setup({ activeParams });

    act(() => applyRec(recommendation()));

    expect(onChangeParams).not.toHaveBeenCalled();
    expect(onReanalyze).not.toHaveBeenCalled();
    expect(result.current.snapshot).toBeNull();
  });

  test('활성 시나리오가 없으면 적용하지 않는다', () => {
    // handleUpdateActiveParams가 무동작이라 설정은 그대로인데 카드만 "적용됨"이 되는 상태를 막는다.
    const { result, onChangeParams, applyRec } = setup({ activeScenarioId: null });

    act(() => applyRec(recommendation({ retirementAge: 63 })));

    expect(onChangeParams).not.toHaveBeenCalled();
    expect(result.current.snapshot).toBeNull();
  });

  test('previewApply는 실제 설정에 반영될 것이 있는지로 판정한다', () => {
    const { result, props } = setup();

    expect(result.current.previewApply(
      recommendation({ retirementAge: 63 }), props.activeParams,
    ).canApply).toBe(true);
    // 여섯 축이 모두 현재 설정과 같은 후보(현상 유지)는 눌러도 바뀔 것이 없다.
    expect(result.current.previewApply(
      recommendation({ retirementAge: 60, targetMonthlySpending: 3_000_000 }),
      props.activeParams,
    ).canApply).toBe(false);
  });

  /**
   * 회귀: 「달라지는 점」이 하나도 없는 균형형 카드에 적용 버튼이 켜져 있었다.
   *
   * 카드가 서술 기준으로 쓰는 params(센티널이 국민연금 66세를 채운 effective.params)와
   * 적용 대상인 activeParams(개시 나이 미지정 = 기본 65세)가 어긋나서, 적용 대상 쪽에서만
   * 변경으로 잡히는 축이 버튼을 살렸다.
   */
  test('카드가 말하지 않은 축만 반영될 후보는 적용 가능하다고 하지 않는다', () => {
    const activeParams = makeParams({
      userProfile: { currentAge: 50, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3_500_000 },
      withdrawalPlan: { accountWithdrawalPolicy: 'ISA_FIRST' },
    });
    const simulatedParams = makeParams({
      userProfile: { currentAge: 50, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3_500_000 },
      withdrawalPlan: { nationalPensionStartAge: 66, accountWithdrawalPolicy: 'ISA_FIRST' },
    });
    const { result } = setup({ activeParams });

    const balanced = recommendation({ retirementAge: 60, nationalPensionStartAge: 66 });
    const preview = result.current.previewApply(balanced, simulatedParams);

    expect(preview.canApply).toBe(false);
    // 반영 대상 자체는 잡힌다 — 다만 카드가 말한 축이 하나도 없어 버튼이 열리지 않는다.
    // 이 상태에서 예고 문구를 낼지는 카드가 정한다(StrategyRecommendationCards 테스트).
    expect(preview.pinned.map((field) => field.label)).toEqual(['국민연금']);
  });

  /**
   * 카드가 말한 축이 있어서 버튼은 열리지만, 센티널이 채워 둔 국민연금도 함께 확정된다.
   * 이 예고가 없으면 「달라지는 점」 목록이 "이것만 바뀐다"는 약속으로 읽힌다.
   */
  test('카드가 말하지 않았지만 함께 확정될 축을 예고한다', () => {
    const activeParams = makeParams({
      userProfile: { currentAge: 50, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3_500_000 },
      withdrawalPlan: { accountWithdrawalPolicy: 'ISA_FIRST' },
    });
    const simulatedParams = makeParams({
      userProfile: { currentAge: 50, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3_500_000 },
      withdrawalPlan: { nationalPensionStartAge: 66, accountWithdrawalPolicy: 'ISA_FIRST' },
    });
    const { result } = setup({ activeParams });

    const preview = result.current.previewApply(
      // 「생활비 배분」이 카드가 말한 축이다 — 이것이 버튼을 연다.
      recommendation({
        retirementAge: 60, nationalPensionStartAge: 66, spendingPattern: 'FRONT_LOADED',
      }),
      simulatedParams,
    );

    expect(preview.canApply).toBe(true);
    expect(preview.pinned.map((field) => field.label)).toEqual(['국민연금']);
  });

  test('활성 시나리오가 없으면 적용 가능하다고 하지 않는다', () => {
    const { result, props } = setup({ activeScenarioId: null });

    const preview = result.current.previewApply(
      recommendation({ retirementAge: 63 }), props.activeParams,
    );

    expect(preview.canApply).toBe(false);
    expect(preview.pinned).toEqual([]);
  });

  test('forget은 되돌리기만 없애고 설정은 건드리지 않는다', () => {
    const { result, onChangeParams, applyRec } = setup();

    act(() => applyRec(recommendation({ retirementAge: 63 })));
    onChangeParams.mockClear();
    act(() => result.current.forget());

    expect(result.current.snapshot).toBeNull();
    expect(onChangeParams).not.toHaveBeenCalled();
  });
});
