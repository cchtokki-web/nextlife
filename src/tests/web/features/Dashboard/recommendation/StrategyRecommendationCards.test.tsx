import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { SimulationParams } from '@/core/entities/types';
import type { CandidateRecommendation, ValidatedStrategyCandidate } from '@/core/recommendation/RecommendationEngine';
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

// 카드 한 장을 이름으로 집는다. 적용 상태 알림에도 같은 페르소나 이름이 들어가므로
// «article» 안에서만 찾아야 한다.
function cardTitled(label: string): HTMLElement {
  const card = [...document.querySelectorAll('article')]
    .find((article) => article.textContent?.includes(label));
  if (!card) throw new Error(`${label} 카드를 찾지 못했습니다`);
  return card as HTMLElement;
}

describe('StrategyRecommendationCards', () => {
  test('추천 결과가 없으면 후보만으로 페르소나를 지어내지 않는다', () => {
    render(
      <StrategyRecommendationCards
        status="done"
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

    const recommendations = [
      { persona: 'STABLE' as const, label: '안정형' as const, candidate: candidates[0], reason: '하방 방어' },
      { persona: 'BALANCED' as const, label: '균형형' as const, candidate: candidates[1], reason: '목표 균형' },
      { persona: 'COMFORTABLE' as const, label: '여유형' as const, candidate: candidates[2], reason: '소비 여력' },
    ];

    render(
      <StrategyRecommendationCards
        recommendations={recommendations}
        primary={recommendations[1]}
        status="done"
        params={params}
        formatValue={formatValue}
      />
    );

    expect(screen.getByText('안정형')).toBeInTheDocument();
    expect(screen.getByText('균형형')).toBeInTheDocument();
    expect(screen.getByText('여유형')).toBeInTheDocument();
    expect(within(cardTitled('균형형')).getByText('추천')).toBeInTheDocument();
  });

  // 엔진이 고르지 않은 카드를 「NextLife가 고른 안」으로 보여주지 않는다.
  test('primary가 없으면 어느 카드에도 추천을 붙이지 않는다', () => {
    const candidates = [
      candidate(1, 'CONSERVATIVE', 'FIXED', 0.7),
      candidate(2, 'BALANCED', 'FIXED', 0.47),
    ];

    render(
      <StrategyRecommendationCards
        recommendations={[
          { persona: 'STABLE', label: '안정형', candidate: candidates[0], reason: '하방 방어' },
          { persona: 'BALANCED', label: '균형형', candidate: candidates[1], reason: '목표 균형' },
        ]}
        status="done"
        params={params}
        formatValue={formatValue}
      />
    );

    expect(screen.getByText('안정형')).toBeInTheDocument();
    expect(screen.queryByText('추천')).not.toBeInTheDocument();
  });

  // ☆을 어디에 붙일지는 RecommendationEngine이 정한다. UI가 규칙을 다시 구현하면, 코어가
  // 규칙을 바꿔도 화면만 옛 규칙으로 남는다. 워커를 건너온 primary는 구조적 복제라 배열
  // 원소와 «다른 객체»이므로, 붙는 자리는 후보 id로 짚어야 한다.
  test('☆추천은 코어가 고른 primary 카드에 붙는다', () => {
    const candidates = [
      candidate(1, 'CONSERVATIVE', 'FIXED', 0.7),
      candidate(2, 'BALANCED', 'FIXED', 0.47),
    ];
    const recommendations = [
      { persona: 'STABLE' as const, label: '안정형' as const, candidate: candidates[0], reason: '하방 방어' },
      { persona: 'BALANCED' as const, label: '균형형' as const, candidate: candidates[1], reason: '목표 균형' },
    ];

    render(
      <StrategyRecommendationCards
        recommendations={recommendations}
        primary={structuredClone(recommendations[0])}
        status="done"
        params={params}
        formatValue={formatValue}
      />
    );

    expect(within(cardTitled('안정형')).getByText('추천')).toBeInTheDocument();
    expect(within(cardTitled('균형형')).queryByText('추천')).not.toBeInTheDocument();
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
    expect(screen.queryByRole('button', { name: '적용' })).toBeNull();
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
        params={params}
        formatValue={formatValue}
        {...props}
      />
    );
  }

  // 적용 스냅샷. 실제 호출자(useAppliedStrategy)가 내려 주는 모양 그대로 만든다.
  const snapshotOf = (candidateId: string, skippedLabels: string[] = []) => ({
    candidateId, label: '균형형' as const, appliedLabels: ['은퇴 시점'], skippedLabels,
  });

  // rerenderWith: 적용 전후로 appliedStrategy만 바꿔 «같은» 컴포넌트를 다시 그린다.
  // 새로 render하면 로컬 state가 초기화되어 언마운트 없는 실제 화면 전환을 재현하지 못한다.
  function renderCards(props: CardProps = {}) {
    const view = render(cardsElement(props));
    return { ...view, rerenderWith: (next: CardProps) => view.rerender(cardsElement(next)) };
  }

  // 「적용」을 누르면 재분석이 걸리고, useStrategyOptimization이 status를 idle로 되돌린 뒤
  // 워커 검증이 끝날 때까지 카드 그리드가 통째로 사라진다(수 초). 되돌리기가 카드 안에만
  // 있으면 사용자가 되돌리고 싶어 할 «바로 그 순간»에 취소 경로가 없어진다 — 그 사이 자동저장은
  // 이미 돌고 있고 스냅샷은 메모리에만 있어, 새로고침하면 원본이 영영 사라진다.
  test.each([
    ['idle' as const],
    ['running' as const],
    ['error' as const],
  ])('검증 상태가 %s여서 카드가 사라져도 되돌리기는 남는다', (status) => {
    const onUndoStrategy = vi.fn();
    renderCards({
      status,
      recommendations: undefined,
      appliedStrategy: snapshotOf('candidate-1'),
      onUndoStrategy,
      onApplyStrategy: vi.fn(),
    });

    fireEvent.click(screen.getByRole('button', { name: '적용 해제' }));
    expect(onUndoStrategy).toHaveBeenCalledTimes(1);
  });

  // 결과가 카드 대신 안내로 대체되는 경우(도달 불가·후보 없음)도 같다.
  test('추천이 도달 불가로 대체돼도 되돌리기는 남는다', () => {
    const onUndoStrategy = vi.fn();
    renderCards({
      recommendations: [balanced],
      outcome: { kind: 'no_candidate_reaches_goal', validatedCount: 12, personaCount: 1 },
      appliedStrategy: snapshotOf('candidate-1'),
      onUndoStrategy,
      onApplyStrategy: vi.fn(),
    });

    expect(screen.getByText('어떤 전략으로도 목표에 도달하지 못합니다')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '적용 해제' }));
    expect(onUndoStrategy).toHaveBeenCalledTimes(1);
  });

  // 적용된 카드가 보이면 그 카드가 해제를 맡는다. 같은 이름의 버튼이 둘이면 사용자는 두 개가
  // 서로 다른 일을 한다고 읽는다.
  test('적용된 카드가 보이면 해제 버튼은 하나뿐이다', () => {
    renderCards({
      appliedStrategy: snapshotOf('candidate-1'),
      onUndoStrategy: vi.fn(),
      onApplyStrategy: vi.fn(),
    });

    expect(screen.getAllByRole('button', { name: '적용 해제' })).toHaveLength(1);
  });

  // 반영하지 못한 축을 숨기면 「전략을 적용했다」는 화면의 약속과 실제가 조용히 어긋난다
  // (applyStrategyToParams의 skipped 계약). 목표를 고르지 않은 사용자에게는 이것이 기본 동작이다.
  test('반영하지 못한 축을 이름으로 밝힌다', () => {
    renderCards({
      appliedStrategy: snapshotOf('candidate-1', ['은퇴 시점', '월 생활비']),
      onUndoStrategy: vi.fn(),
      onApplyStrategy: vi.fn(),
    });

    expect(screen.getByText(/은퇴 시점, 월 생활비.*반영하지 못했습니다/)).toBeInTheDocument();
  });

  // 설정을 바꿀 수 없는 읽기 전용 문맥이 같은 컴포넌트를 쓸 수 있다. 콜백이 없으면 액션 자체가 없어야 한다.
  test('적용 콜백이 없으면 버튼을 내지 않는다', () => {
    renderCards();

    expect(screen.queryByRole('button', { name: /적용/ })).not.toBeInTheDocument();
  });

  // 확인 단계를 두지 않는다 — 바뀌는 내용은 바로 위 「달라지는 점」에 이미 있고, 적용 뒤에는
  // 같은 자리의 「적용 해제」로 되돌릴 수 있다.
  test('확인 단계 없이 한 번에 적용한다', () => {
    const onApplyStrategy = vi.fn();
    renderCards({ onApplyStrategy });

    fireEvent.click(screen.getByRole('button', { name: '적용' }));

    expect(onApplyStrategy).toHaveBeenCalledWith(balanced);
    expect(screen.queryByRole('button', { name: '취소' })).not.toBeInTheDocument();
  });

  // 적용한 자리에서 바로 되돌릴 수 있어야 한다. 대시보드 바깥의 되돌리기 배너를 제거한
  // 뒤로, 이 버튼이 화면에 남은 유일한 취소 경로다.
  test('적용한 전략은 그 자리에서 해제할 수 있다', () => {
    const onUndoStrategy = vi.fn();
    renderCards({ onApplyStrategy: vi.fn(), appliedStrategy: snapshotOf('candidate-1'), onUndoStrategy });

    const undoButton = screen.getByRole('button', { name: '적용 해제' });
    expect(undoButton).toBeEnabled();

    // 확인 단계 없이 곧바로 해제한다 — 되돌리는 방향이라 잃을 것이 없다.
    fireEvent.click(undoButton);
    expect(onUndoStrategy).toHaveBeenCalledTimes(1);
  });

  // 설정을 바꿀 수 없는 읽기 전용 문맥은 해제 콜백을 주지 않는다.
  test('해제 콜백이 없으면 적용됨으로만 표시한다', () => {
    renderCards({ onApplyStrategy: vi.fn(), appliedStrategy: snapshotOf('candidate-1') });

    expect(screen.getByRole('button', { name: '적용됨' })).toBeDisabled();
  });

  // 적용 → 해제의 왕복이 «같은» 컴포넌트 위에서 처음 상태로 돌아와야 한다. 컴포넌트가
  // 언마운트되지 않으므로, 적용 전후를 rerender로 이어 붙여야만 잡히는 회귀다.
  test('적용한 뒤 해제하면 처음 버튼으로 돌아온다', () => {
    const onApplyStrategy = vi.fn();
    const onUndoStrategy = vi.fn();
    const { rerenderWith } = renderCards({ onApplyStrategy, onUndoStrategy });

    fireEvent.click(screen.getByRole('button', { name: '적용' }));
    expect(onApplyStrategy).toHaveBeenCalledWith(balanced);

    // 적용이 반영되면 호출자가 스냅샷을 내려 준다.
    rerenderWith({ onApplyStrategy, onUndoStrategy, appliedStrategy: snapshotOf('candidate-1') });
    fireEvent.click(screen.getByRole('button', { name: '적용 해제' }));
    expect(onUndoStrategy).toHaveBeenCalledTimes(1);

    rerenderWith({ onApplyStrategy, onUndoStrategy });
    expect(screen.getByRole('button', { name: '적용' })).toBeInTheDocument();
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
        params={params}
        formatValue={formatValue}
        onApplyStrategy={vi.fn()}
        onUndoStrategy={vi.fn()}
        appliedStrategy={{ candidateId: 'candidate-2', label: '균형형', appliedLabels: [], skippedLabels: [] }}
      />
    );

    expect(screen.getAllByRole('button', { name: '적용 해제' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: '적용' })).toHaveLength(2);
    expect(
      within(cardTitled('균형형')).getByRole('button', { name: '적용 해제' })
    ).toBeInTheDocument();
  });

  // 카드 강조(테두리)와 그 접근성 표시는 «적용 상태»를 따른다. ☆추천은 엔진이 고른
  // 카드일 뿐 사용자가 반영한 카드가 아니어서, 둘을 같은 강조로 말하면 아직 아무것도
  // 적용하지 않은 화면이 "이미 하나 골라져 있다"로 읽힌다.
  function threeCards(props: CardProps = {}) {
    const recommendations = [
      { persona: 'STABLE' as const, label: '안정형' as const, candidate: candidate(1, 'CONSERVATIVE', 'FIXED', 0.97), reason: '하방 방어' },
      { persona: 'BALANCED' as const, label: '균형형' as const, candidate: candidate(2, 'BALANCED', 'FIXED', 0.95), reason: '목표 균형' },
      { persona: 'COMFORTABLE' as const, label: '여유형' as const, candidate: candidate(3, 'GROWTH', 'FRONT_LOADED', 0.9), reason: '소비 여력' },
    ];
    return render(
      <StrategyRecommendationCards
        recommendations={recommendations}
        primary={recommendations[1]}
        status="done"
        params={params}
        formatValue={formatValue}
        onApplyStrategy={vi.fn()}
        onUndoStrategy={vi.fn()}
        {...props}
      />
    );
  }



  test('적용한 카드만 강조한다 — ☆추천 카드가 아니라', () => {
    threeCards({ appliedStrategy: snapshotOf('candidate-3') });

    // ☆추천은 균형형에 붙어 있지만, 강조는 사용자가 적용한 여유형이 가져간다.
    expect(within(cardTitled('균형형')).getByText('추천')).toBeInTheDocument();
    expect(cardTitled('여유형')).toHaveAttribute('aria-current', 'true');
    expect(cardTitled('균형형')).not.toHaveAttribute('aria-current');
    expect(cardTitled('안정형')).not.toHaveAttribute('aria-current');
  });

  test('적용한 전략이 없으면 어떤 카드도 강조하지 않는다', () => {
    const { container } = threeCards();

    expect(container.querySelectorAll('article[aria-current]')).toHaveLength(0);
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

    expect(screen.getByRole('button', { name: '적용' })).toBeEnabled();
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
            // 인출 축은 dimensions가 아니라 «시뮬레이션된 전략»을 본다(strategyFieldMap).
            // dimensions만 맞추면 카드가 실제로 돌려보지 않은 정책을 변경점으로 내건다.
            withdrawalPolicy: { accountWithdrawalPolicy: 'GENERAL_FIRST' as const },
          },
        },
      },
    };
    renderCards({ recommendations: [sameAsCurrent], onApplyStrategy: vi.fn() });

    expect(screen.getByRole('button', { name: /달라지는 점이 없습니다/ })).toBeDisabled();
  });
});

// 세 카드는 「더 나은가」가 아니라 「특성을 가졌는가」로 뽑히므로(RECOMMENDATION_PERSONAS),
// 현재 계획보다 나쁜 안이 ☆추천을 달고 올라올 수 있다. 사용자는 그 사실을 알 방법이 없었다.
describe('StrategyRecommendationCards - 현재 계획과의 비교', () => {
  const worse = {
    persona: 'BALANCED' as const,
    label: '균형형' as const,
    candidate: candidate(1, 'BALANCED', 'FIXED', 0.47),
    reason: '목표 균형',
  };
  const better = {
    persona: 'STABLE' as const,
    label: '안정형' as const,
    candidate: candidate(2, 'CONSERVATIVE', 'FIXED', 0.82),
    reason: '보수적',
  };

  const renderWith = (recommendations: CandidateRecommendation[], currentGoalProbability?: number) => render(
    <StrategyRecommendationCards
      recommendations={recommendations}
      primary={recommendations[0]}
      status="done"
      params={params}
      formatValue={formatValue}
      currentGoalProbability={currentGoalProbability}
    />
  );

  test('현재 계획보다 낮은 카드는 얼마나 낮은지 밝힌다', () => {
    renderWith([worse], 0.67);

    expect(screen.getByText(/현재 계획 67%보다 20%p 낮음/)).toBeInTheDocument();
  });

  test('현재 계획보다 높은 카드는 얼마나 높은지 밝힌다', () => {
    renderWith([better], 0.67);

    expect(screen.getByText(/현재 계획 67%보다 15%p 높음/)).toBeInTheDocument();
  });

  // ☆는 「고를 만한 안」이라는 뜻이다. 지금보다 나쁜 안에 붙으면 그 뜻이 거짓이 된다.
  test('현재 계획보다 나쁜 카드에는 ☆추천을 붙이지 않는다', () => {
    renderWith([worse], 0.67);

    expect(screen.queryByText('추천')).not.toBeInTheDocument();
  });

  test('현재 계획보다 나은 카드에는 그대로 붙인다', () => {
    renderWith([better], 0.67);

    expect(screen.getByText('추천')).toBeInTheDocument();
  });

  test('세 추천이 모두 지금보다 나쁘면 유지를 권한다', () => {
    renderWith([worse], 0.67);

    expect(screen.getByText(/현재 계획을 유지하는 편이 낫습니다/)).toBeInTheDocument();
  });

  test('하나라도 나으면 유지를 권하지 않는다', () => {
    renderWith([worse, better], 0.67);

    expect(screen.queryByText(/현재 계획을 유지하는 편이 낫습니다/)).not.toBeInTheDocument();
  });

  // 몬테카를로가 아직 끝나지 않은 상태에서 「나쁘다」고 말하면 측정되지 않은 것이 나쁜 것으로
  // 둔갑한다. 비교할 수 없으면 아무 말도 하지 않고 종전 화면 그대로 둔다.
  test('현재 확률을 모르면 비교를 말하지 않는다', () => {
    renderWith([worse], undefined);

    // 카드에는 언제나 「현재 계획에서 달라지는 점」 제목이 있으므로 증감 문구만 좁혀 본다.
    expect(screen.queryByText(/현재 계획 \d+%보다/)).not.toBeInTheDocument();
    expect(screen.getByText('추천')).toBeInTheDocument();
  });
});
