import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { SimulationParams } from '@/core/entities/types';
import type { ValidatedStrategyCandidate } from '@/core/recommendation/RecommendationEngine';
import { DEFAULT_UTILITY_CONFIG } from '@/core/usecases/utility/utilityWeights';
import { describeStrategyChanges } from '@/core/usecases/dashboard/describeStrategyChanges';
import { StrategyRecommendationCards } from '@/web/features/Dashboard/recommendation/StrategyRecommendationCards';

const params: SimulationParams = {
  userProfile: { currentAge: 50, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3_500_000 },
  assets: [],
  nationalPension: { expectedMonthlyAmount: 1_500_000 },
  privatePensions: [],
  otherIncomes: [],
  inflationRate: 2,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
  yieldPreset: 'base',
  withdrawalPlan: { nationalPensionStartAge: 60, accountWithdrawalPolicy: 'GENERAL_FIRST' },
};

function candidate(
  rank: number,
  allocation: 'CONSERVATIVE' | 'BALANCED' | 'GROWTH',
  spending: 'FIXED' | 'FRONT_LOADED' | 'CARE_HEAVY',
  probability: number,
): ValidatedStrategyCandidate {
  const preset = allocation === 'CONSERVATIVE' ? 'conservative'
    : allocation === 'GROWTH' ? 'aggressive' : 'base';
  return {
    rank,
    candidate: {
      id: `candidate-${rank}`,
      dimensions: {
        retirementAge: 62,
        nationalPensionTiming: 'NORMAL',
        nationalPensionStartAge: 65,
        withdrawalPolicy: 'ISA_FIRST',
        spendingPattern: spending,
        assetAllocation: allocation,
      },
      strategy: {
        targetMonthlySpending: 3_500_000,
        planHorizonAge: 90,
        simulationStartYear: 2026,
        retirementAge: 62,
        nationalPensionStartAge: 65,
        withdrawalPolicy: { accountWithdrawalPolicy: 'ISA_FIRST' },
        spendingPolicy: { mode: 'target' },
        legacySettings: {
          inflationRate: 2,
          inflationMode: 'real',
          baseExchangeRate: 1350,
          exchangeScenario: 'base',
          displayCurrency: 'KRW',
          yieldPreset: preset,
        },
        legacyPresence: {
          withdrawalPlan: true,
          spendingStrategy: false,
          spendingCurve: false,
          assetFloor: false,
        },
        utilityConfig: DEFAULT_UTILITY_CONFIG,
      },
    },
    simulation: { yearlyResults: [], depletionAge: null, endingAssets: 200_000_000 + rank },
    evaluation: {
      hardConstraintsSatisfied: true,
      goalEvaluations: [],
      weightedScore: 80 - rank,
      score: 80 - rank,
      utility: { score: 80 - rank, components: { consumption: 0, depletionSafety: 0, pensionUtilization: 0, taxEfficiency: 0, taxationRisk: 0, bequestAdequacy: 0 } },
      hardConstraintFailures: [],
      unsupportedHardGoals: [],
    },
    monteCarlo: {
      trials: 1000,
      seed: 20260101,
      goalSuccessProbability: probability,
      spendingSuccessProbability: probability,
      assetSurvivalProbability: probability,
      terminalAssetMedian: 300_000_000 - rank,
      terminalAssetP10: 100_000_000,
      terminalAssetP90: 500_000_000,
      shortfallProbability: 1 - probability,
    },
  };
}

const formatValue = (value: number) => `${Math.round(value / 10_000)}만원`;

describe('StrategyRecommendationCards', () => {
  test('추천 결과가 없으면 후보만으로 페르소나를 지어내지 않는다', () => {
    render(
      <StrategyRecommendationCards
        status="done"
        currentGoalProbability={0.72}
        params={params}
        formatValue={formatValue}
      />
    );

    // 페르소나 배정은 RecommendationEngine의 책임이다. 예전 UI 폴백은 rank로 persona를 만들고
    // GROWTH 후보를 '여유형'으로 부르며 실행되지도 않은 선택 근거를 함께 출력했다.
    expect(screen.getByText('현재 목표 조건을 만족하는 추천 후보가 없습니다.')).toBeInTheDocument();
    expect(screen.queryByText('안정형')).not.toBeInTheDocument();
    expect(screen.queryByText('여유형')).not.toBeInTheDocument();
  });

  test('계산 실패와 HARD 목표 충돌을 서로 다른 문구로 안내한다', () => {
    const { unmount } = render(
      <StrategyRecommendationCards
        status="done"
        outcome={{
          kind: 'no_candidate_survived',
          hardConstraintRejectedCount: 0,
          failedCount: 12,
          blockedBy: [],
          firstFailureReason: 'projection exploded',
        }}
        params={params}
        formatValue={formatValue}
      />
    );

    // 계산이 깨진 경우: 목표가 불가능하다고 말하면 안 된다.
    expect(screen.getByText(/계산 중 오류로 평가하지 못했습니다/)).toBeInTheDocument();
    expect(screen.getByText(/projection exploded/)).toBeInTheDocument();
    expect(screen.queryByText(/필수\(HARD\) 목표를 동시에 만족하는 전략을 찾지 못했습니다/))
      .not.toBeInTheDocument();
    unmount();

    render(
      <StrategyRecommendationCards
        status="done"
        outcome={{
          kind: 'no_candidate_survived',
          hardConstraintRejectedCount: 40,
          failedCount: 0,
          blockedBy: ['HARD_ASSET_SURVIVAL'],
        }}
        params={params}
        formatValue={formatValue}
      />
    );

    // 목표가 충돌한 경우: 무엇이 막았는지와 조정 방법을 알려준다.
    expect(screen.getByText(/필수\(HARD\) 목표를 동시에 만족하는 전략을 찾지 못했습니다/))
      .toBeInTheDocument();
    expect(screen.getByText(/자산 고갈 방지/)).toBeInTheDocument();
    expect(screen.queryByText(/계산 중 오류/)).not.toBeInTheDocument();
  });

  test('검증된 후보가 있으나 페르소나가 없으면 목표 탓으로 돌리지 않는다', () => {
    render(
      <StrategyRecommendationCards
        status="done"
        outcome={{ kind: 'no_persona_matched', validatedCount: 7 }}
        params={params}
        formatValue={formatValue}
      />
    );

    expect(screen.getByText(/전략 7개를 검증했지만/)).toBeInTheDocument();
    expect(screen.queryByText(/목표 조건을 만족하는 추천 후보가 없습니다/)).not.toBeInTheDocument();
  });

  test('검증하지 못한 HARD 목표를 추천과 함께 고지한다', () => {
    const candidates = [candidate(1, 'CONSERVATIVE', 'FIXED', 0.97)];

    render(
      <StrategyRecommendationCards
        recommendations={[
          { persona: 'STABLE', label: '안정형', candidate: candidates[0], reason: '하방 방어' },
        ]}
        status="done"
        currentGoalProbability={0.72}
        unsupportedHardGoals={['HOUSING_STABILITY']}
        params={params}
        formatValue={formatValue}
      />
    );

    expect(screen.getByText(/다음 필수\(HARD\) 목표는 현재 검증할 수 없습니다/)).toBeInTheDocument();
    expect(screen.getByText(/주거 안정/)).toBeInTheDocument();
  });

  test('오류 상태에서 워커가 보고한 원인을 함께 보여준다', () => {
    render(
      <StrategyRecommendationCards
        status="error"
        errorMessage="shortlistLimit must be a finite number, received NaN"
        params={params}
        formatValue={formatValue}
      />
    );

    expect(screen.getByText(/shortlistLimit must be a finite number/)).toBeInTheDocument();
  });

  test('idle은 검증 중 스피너로 표시하지 않는다', () => {
    render(
      <StrategyRecommendationCards
        status="idle"
        params={params}
        formatValue={formatValue}
      />
    );

    expect(screen.queryByText(/검증하고 있습니다/)).not.toBeInTheDocument();
  });

  test('현재 값과 다른 항목만 변경점으로 만든다', () => {
    const changes = describeStrategyChanges(params, candidate(1, 'CONSERVATIVE', 'FIXED', 0.97), formatValue);

    expect(changes.map((change) => change.label)).toEqual([
      '은퇴 시점', '국민연금', '자산 인출', '투자 성향',
    ]);
    expect(changes).not.toContainEqual(expect.objectContaining({ label: '월 생활비' }));
    expect(changes).not.toContainEqual(expect.objectContaining({ label: '생활비 배분' }));
  });

  test('최종 추천 엔진의 세 페르소나를 안정형·균형형·여유형으로 표시한다', () => {
    const candidates = [
      candidate(1, 'CONSERVATIVE', 'FIXED', 0.97),
      candidate(2, 'BALANCED', 'FIXED', 0.95),
      candidate(3, 'GROWTH', 'FRONT_LOADED', 0.9),
    ];

    render(
      <StrategyRecommendationCards
        recommendations={[
          { persona: 'STABLE', label: '안정형', candidate: candidates[0], reason: '하방 방어' },
          { persona: 'BALANCED', label: '균형형', candidate: candidates[1], reason: '목표 균형' },
          { persona: 'COMFORTABLE', label: '여유형', candidate: candidates[2], reason: '소비 여력' },
        ]}
        status="done"
        currentGoalProbability={0.7}
        params={params}
        formatValue={formatValue}
      />
    );

    expect(screen.getByText('안정형')).toBeInTheDocument();
    expect(screen.getByText('균형형')).toBeInTheDocument();
    expect(screen.getByText('여유형')).toBeInTheDocument();
    expect(within(screen.getByText('균형형').closest('article')!).getByText('추천')).toBeInTheDocument();
  });
});

// 국민연금 200만원만 있고 자산이 없는 계획에서 실제로 나온 화면: 균형형·여유형 두 장이
// 생활비도 예상 잔여자산도 같은 값으로, 둘 다 0%인 채 나란히 섰고 앞 카드에 ☆추천이 붙었다.
// 고를 이유가 없는 선택지를 고르라는 화면이었다.
describe('StrategyRecommendationCards 목표 도달 불가', () => {
  const unreachable = [
    { persona: 'BALANCED' as const, label: '균형형' as const, candidate: candidate(1, 'BALANCED', 'FIXED', 0), reason: '목표 균형' },
    { persona: 'COMFORTABLE' as const, label: '여유형' as const, candidate: candidate(2, 'BALANCED', 'FRONT_LOADED', 0), reason: '소비 여력' },
  ];
  const outcome = { kind: 'no_candidate_reaches_goal', validatedCount: 12, personaCount: 2 } as const;

  test('추천이 전부 0%면 전략 카드와 비교 바 대신 격차를 보여준다', () => {
    render(
      <StrategyRecommendationCards
        recommendations={unreachable}
        status="done"
        currentGoalProbability={0}
        outcome={outcome}
        params={params}
        formatValue={formatValue}
        onApplyStrategy={vi.fn()}
        canApplyStrategy={() => true}
      />
    );

    expect(screen.getByText('어떤 전략으로도 목표에 도달하지 못합니다')).toBeInTheDocument();
    expect(screen.getByText(/전략 12개를 검증했지만 모두 목표 달성 확률이 0%/)).toBeInTheDocument();
    expect(screen.queryByText('균형형')).toBeNull();
    expect(screen.queryByText('여유형')).toBeNull();
    expect(screen.queryByLabelText('현재 계획과 추천 전략 비교')).toBeNull();
    expect(screen.queryByRole('button', { name: '이 전략 적용' })).toBeNull();
  });

  test('지속 가능한 생활비를 계산했으면 목표와의 격차를 숫자로 말한다', () => {
    render(
      <StrategyRecommendationCards
        recommendations={unreachable}
        status="done"
        outcome={outcome}
        sustainableSpendingAdvice={{
          kind: 'overspending',
          currentMonthly: 3_000_000,
          sustainableMonthly: 2_000_000,
          difference: 1_000_000,
        }}
        params={params}
        formatValue={formatValue}
      />
    );

    const gap = screen.getByLabelText('목표와 지속 가능한 생활비의 격차');
    expect(within(gap).getByText('300만원')).toBeInTheDocument();
    expect(within(gap).getByText('200만원')).toBeInTheDocument();
    expect(within(gap).getByText('100만원')).toBeInTheDocument();
  });

  // 조언은 고정 생활비 계획이 아니거나 지속가능액이 0으로 수렴하면 null이다. 그때 0원을 찍으면
  // 측정하지 못한 값을 확신에 찬 숫자로 보여주게 된다.
  test('지속 가능한 생활비를 구하지 못했으면 격차를 숫자로 지어내지 않는다', () => {
    render(
      <StrategyRecommendationCards
        recommendations={unreachable}
        status="done"
        outcome={outcome}
        sustainableSpendingAdvice={null}
        params={params}
        formatValue={formatValue}
      />
    );

    expect(screen.getByText('어떤 전략으로도 목표에 도달하지 못합니다')).toBeInTheDocument();
    expect(screen.getByText(/목표 생활비를 낮추거나/)).toBeInTheDocument();
    expect(screen.queryByLabelText('목표와 지속 가능한 생활비의 격차')).toBeNull();
  });
});

describe('StrategyRecommendationCards 적용 버튼', () => {
  const balanced = {
    persona: 'BALANCED' as const,
    label: '균형형' as const,
    candidate: candidate(1, 'BALANCED', 'FIXED', 0.95),
    reason: '목표 균형',
  };

  type CardProps = Partial<Parameters<typeof StrategyRecommendationCards>[0]>;

  function cardsElement(props: CardProps) {
    return (
      <StrategyRecommendationCards
        recommendations={[balanced]}
        status="done"
        currentGoalProbability={0.7}
        params={params}
        formatValue={formatValue}
        {...props}
      />
    );
  }

  // rerenderWith: 적용 전후로 appliedCandidateId만 바꿔 «같은» 컴포넌트를 다시 그린다.
  // 새로 render하면 로컬 state가 초기화되어 언마운트 없는 실제 화면 전환을 재현하지 못한다.
  function renderCards(props: CardProps = {}) {
    const view = render(cardsElement(props));
    return { ...view, rerenderWith: (next: CardProps) => view.rerender(cardsElement(next)) };
  }

  // 설정을 바꿀 수 없는 읽기 전용 문맥이 같은 컴포넌트를 쓸 수 있다. 콜백이 없으면 액션 자체가 없어야 한다.
  test('적용 콜백이 없으면 버튼을 내지 않는다', () => {
    renderCards();

    expect(screen.queryByRole('button', { name: /적용/ })).not.toBeInTheDocument();
  });

  test('바로 적용하지 않고 한 번 더 확인한다', () => {
    const onApplyStrategy = vi.fn();
    renderCards({ onApplyStrategy });

    fireEvent.click(screen.getByRole('button', { name: '이 전략 적용' }));

    expect(onApplyStrategy).not.toHaveBeenCalled();
    expect(screen.getByText(/현재 시나리오 설정이 바뀝니다/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '적용' }));
    expect(onApplyStrategy).toHaveBeenCalledWith(balanced);
  });

  test('확인을 취소하면 적용하지 않고 원래 버튼으로 돌아간다', () => {
    const onApplyStrategy = vi.fn();
    renderCards({ onApplyStrategy });

    fireEvent.click(screen.getByRole('button', { name: '이 전략 적용' }));
    fireEvent.click(screen.getByRole('button', { name: '취소' }));

    expect(onApplyStrategy).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '이 전략 적용' })).toBeInTheDocument();
  });

  // 적용한 자리에서 바로 되돌릴 수 있어야 한다. 배너는 대시보드 바깥에 있어서, 카드를
  // 보고 있는 사용자에게는 취소 경로가 보이지 않는다.
  test('적용한 전략은 그 자리에서 해제할 수 있다', () => {
    const onUndoStrategy = vi.fn();
    renderCards({ onApplyStrategy: vi.fn(), appliedCandidateId: 'candidate-1', onUndoStrategy });

    const undoButton = screen.getByRole('button', { name: '적용 해제' });
    expect(undoButton).toBeEnabled();

    // 확인 단계 없이 곧바로 해제한다 — 되돌리는 방향이라 잃을 것이 없다.
    fireEvent.click(undoButton);
    expect(onUndoStrategy).toHaveBeenCalledTimes(1);
  });

  // 설정을 바꿀 수 없는 읽기 전용 문맥은 해제 콜백을 주지 않는다.
  test('해제 콜백이 없으면 적용됨으로만 표시한다', () => {
    renderCards({ onApplyStrategy: vi.fn(), appliedCandidateId: 'candidate-1' });

    expect(screen.getByRole('button', { name: '적용됨' })).toBeDisabled();
  });

  // 확인 단계를 거쳐 적용한 뒤 해제하면 «처음» 버튼으로 돌아와야 한다. 컴포넌트가
  // 언마운트되지 않으므로, 적용 시점에 confirming을 내리지 않으면 해제 직후 확인 패널이
  // 되살아난다. 적용 전후를 rerender로 이어 붙여야만 잡히는 회귀다.
  test('적용한 뒤 해제하면 확인 단계가 아니라 처음 버튼으로 돌아온다', () => {
    const onApplyStrategy = vi.fn();
    const onUndoStrategy = vi.fn();
    const { rerenderWith } = renderCards({ onApplyStrategy, onUndoStrategy });

    fireEvent.click(screen.getByRole('button', { name: '이 전략 적용' }));
    fireEvent.click(screen.getByRole('button', { name: '적용' }));
    expect(onApplyStrategy).toHaveBeenCalledWith(balanced);

    // 적용이 반영되면 호출자가 appliedCandidateId를 내려 준다.
    rerenderWith({ onApplyStrategy, onUndoStrategy, appliedCandidateId: 'candidate-1' });
    fireEvent.click(screen.getByRole('button', { name: '적용 해제' }));
    expect(onUndoStrategy).toHaveBeenCalledTimes(1);

    rerenderWith({ onApplyStrategy, onUndoStrategy });
    expect(screen.getByRole('button', { name: '이 전략 적용' })).toBeInTheDocument();
    expect(screen.queryByText(/현재 시나리오 설정이 바뀝니다/)).not.toBeInTheDocument();
  });

  // 어느 전략이 적용 중인지는 오직 이 버튼으로만 드러난다. 세 카드가 같은 onUndoStrategy를
  // 받으므로, applied 판정이 깨지면 전부 「적용 해제」가 되어 그 정보가 사라진다.
  test('적용 해제 버튼은 적용된 카드에만 나온다', () => {
    render(
      <StrategyRecommendationCards
        recommendations={[
          { persona: 'STABLE', label: '안정형', candidate: candidate(1, 'CONSERVATIVE', 'FIXED', 0.97), reason: '하방 방어' },
          { persona: 'BALANCED', label: '균형형', candidate: candidate(2, 'BALANCED', 'FIXED', 0.95), reason: '목표 균형' },
          { persona: 'COMFORTABLE', label: '여유형', candidate: candidate(3, 'GROWTH', 'FRONT_LOADED', 0.9), reason: '소비 여력' },
        ]}
        status="done"
        currentGoalProbability={0.7}
        params={params}
        formatValue={formatValue}
        onApplyStrategy={vi.fn()}
        onUndoStrategy={vi.fn()}
        appliedCandidateId="candidate-2"
      />
    );

    expect(screen.getAllByRole('button', { name: '적용 해제' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: '이 전략 적용' })).toHaveLength(2);
    expect(
      within(screen.getByText('균형형').closest('article')!).getByRole('button', { name: '적용 해제' })
    ).toBeInTheDocument();
  });

  // 카드가 받는 params는 센티널이 채운 계산용 값이고 실제 적용 대상은 사용자가 입력한
  // 설정이다. 둘의 판정이 엇갈리면 눌러도 아무 일이 없거나(침묵 실패) 적용할 것이 있는데
  // 버튼이 잠긴다. 그래서 활성 여부는 «적용하는 쪽»이 판정한다.
  test('적용 가능 여부는 카드가 아니라 호출자가 판정한다', () => {
    const canApplyStrategy = vi.fn().mockReturnValue(false);
    renderCards({ onApplyStrategy: vi.fn(), canApplyStrategy });

    expect(canApplyStrategy).toHaveBeenCalledWith(balanced);
    // 카드에는 달라지는 점이 있지만 실제 설정에는 반영할 것이 없는 상태다.
    expect(screen.getByRole('button', { name: '반영할 수 있는 설정이 없습니다' })).toBeDisabled();
  });

  test('호출자가 적용 가능하다고 하면 카드 목록이 비어 있어도 누를 수 있다', () => {
    renderCards({ onApplyStrategy: vi.fn(), canApplyStrategy: () => true });

    expect(screen.getByRole('button', { name: '이 전략 적용' })).toBeEnabled();
  });

  test('달라지는 점이 없으면 적용할 것도 없다', () => {
    const sameAsCurrent = {
      ...balanced,
      candidate: {
        ...balanced.candidate,
        candidate: {
          ...balanced.candidate.candidate,
          dimensions: {
            ...balanced.candidate.candidate.dimensions,
            retirementAge: params.userProfile.retirementAge,
            nationalPensionStartAge: 60,
            withdrawalPolicy: 'GENERAL_FIRST' as const,
          },
          strategy: {
            ...balanced.candidate.candidate.strategy,
            retirementAge: params.userProfile.retirementAge,
            nationalPensionStartAge: 60,
          },
        },
      },
    };
    renderCards({ recommendations: [sameAsCurrent], onApplyStrategy: vi.fn() });

    expect(screen.getByRole('button', { name: /달라지는 점이 없습니다/ })).toBeDisabled();
  });
});
