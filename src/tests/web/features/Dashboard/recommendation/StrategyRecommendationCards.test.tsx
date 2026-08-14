import { render, screen, within } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import type { SimulationParams } from '@/core/entities/types';
import type { RankedStrategyCandidate } from '@/core/strategy/StrategyOptimizer';
import { DEFAULT_UTILITY_CONFIG } from '@/core/usecases/utility/utilityWeights';
import {
  StrategyRecommendationCards,
  strategyCharacteristicLabel,
  strategyChanges,
} from '@/web/features/Dashboard/recommendation/StrategyRecommendationCards';

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
): RankedStrategyCandidate {
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
  test('실제 전략 특성으로 라벨을 정하며 1위가 균형형이 아니어도 추천한다', () => {
    const candidates = [
      candidate(1, 'CONSERVATIVE', 'FIXED', 0.97),
      candidate(2, 'BALANCED', 'FRONT_LOADED', 0.91),
      candidate(3, 'GROWTH', 'CARE_HEAVY', 0.79),
    ];

    render(
      <StrategyRecommendationCards
        candidates={candidates}
        status="done"
        currentGoalProbability={0.72}
        params={params}
        formatValue={formatValue}
      />
    );

    expect(strategyCharacteristicLabel(candidates[0])).toBe('안정형');
    const firstCard = screen.getByText('안정형').closest('article')!;
    expect(within(firstCard).getByText('추천')).toBeInTheDocument();
    expect(screen.getByText('72%')).toBeInTheDocument();
    expect(screen.getAllByText('97%')).toHaveLength(2);
    expect(screen.getAllByText('현재 계획에서 달라지는 점')).toHaveLength(3);
  });

  test('현재 값과 다른 항목만 변경점으로 만든다', () => {
    const changes = strategyChanges(params, candidate(1, 'CONSERVATIVE', 'FIXED', 0.97), formatValue);

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
        candidates={candidates}
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
