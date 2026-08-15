import { describe, expect, test } from 'vitest';
import { RecommendationEngine } from '@/core/recommendation/RecommendationEngine';
import type { RankedStrategyCandidate } from '@/core/strategy/StrategyOptimizer';
import { LegacySimulationAdapter } from '@/core/domain/input/LegacySimulationAdapter';
import { initialParams } from '@/infrastructure/storage/localStore';

function candidate(input: {
  id: string;
  allocation: 'CONSERVATIVE' | 'BALANCED' | 'GROWTH';
  spending: 'FIXED' | 'FRONT_LOADED' | 'CARE_HEAVY';
  goalProbability: number;
  spendingProbability?: number;
  survivalProbability?: number;
  p10?: number;
}): RankedStrategyCandidate {
  const domain = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
  return {
    rank: 1,
    candidate: {
      id: input.id,
      strategy: domain.strategy,
      dimensions: {
        retirementAge: domain.strategy.retirementAge,
        nationalPensionTiming: 'NORMAL',
        nationalPensionStartAge: 65,
        withdrawalPolicy: 'GENERAL_FIRST',
        spendingPattern: input.spending,
        assetAllocation: input.allocation,
      },
    },
    simulation: { yearlyResults: [], depletionAge: null, endingAssets: 100 },
    evaluation: {
      hardConstraintsSatisfied: true,
      goalEvaluations: [],
      weightedScore: Math.round(input.goalProbability * 100),
      score: 0,
      utility: {
        score: 0,
        components: {
          consumption: 0,
          depletionSafety: 0,
          pensionUtilization: 0,
          taxEfficiency: 0,
          taxationRisk: 0,
          bequestAdequacy: 0,
        },
      },
      hardConstraintFailures: [],
      unsupportedHardGoals: [],
    },
    monteCarlo: {
      trials: 100,
      seed: 42,
      goalSuccessProbability: input.goalProbability,
      spendingSuccessProbability: input.spendingProbability ?? input.goalProbability,
      assetSurvivalProbability: input.survivalProbability ?? input.goalProbability,
      terminalAssetMedian: 100,
      terminalAssetP10: input.p10 ?? 50,
      terminalAssetP90: 150,
      shortfallProbability: 1 - (input.spendingProbability ?? input.goalProbability),
    },
  };
}

describe('RecommendationEngine', () => {
  test('Monte Carlo 검증 후보를 서로 다른 안정형·균형형·여유형으로 선택한다', () => {
    const candidates = [
      candidate({ id: 'stable', allocation: 'CONSERVATIVE', spending: 'FIXED', goalProbability: 0.8, survivalProbability: 0.99, p10: 90 }),
      candidate({ id: 'balanced', allocation: 'BALANCED', spending: 'FIXED', goalProbability: 0.95 }),
      candidate({ id: 'comfortable', allocation: 'GROWTH', spending: 'FRONT_LOADED', goalProbability: 0.9, spendingProbability: 0.97 }),
      candidate({ id: 'growth', allocation: 'GROWTH', spending: 'FIXED', goalProbability: 0.99 }),
    ];

    const result = new RecommendationEngine().recommend(candidates);

    expect(result.recommendations.map((item) => item.label)).toEqual(['안정형', '균형형', '여유형']);
    expect(result.recommendations.map((item) => item.candidate.candidate.id)).toEqual([
      'stable', 'balanced', 'comfortable',
    ]);
    expect(new Set(result.recommendations.map((item) => item.candidate.candidate.id)).size).toBe(3);
    expect(result.primary?.persona).toBe('BALANCED');
  });

  test('검증되지 않은 후보를 추천하거나 후보 수를 부풀리지 않는다', () => {
    const validated = candidate({
      id: 'validated', allocation: 'BALANCED', spending: 'FIXED', goalProbability: 0.9,
    });
    const unvalidated = { ...validated, candidate: { ...validated.candidate, id: 'unvalidated' } };
    delete unvalidated.monteCarlo;

    const result = new RecommendationEngine().recommend([validated, unvalidated]);

    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0].candidate.candidate.id).toBe('validated');
  });

  // C7: qualifies가 하드 필터가 된 뒤로, CONSERVATIVE + FRONT_LOADED 후보는 안정형과 여유형
  // 양쪽 조건을 동시에 만족한다. 그래서 `used` Set이 실제로 중재를 하게 됐는데, 기존 테스트
  // 입력(CONSERVATIVE/FIXED, GROWTH/FRONT_LOADED)은 애초에 겹칠 수 없어 이를 검증하지 못했다.
  test('두 페르소나 조건을 동시에 만족하는 후보를 중복 배정하지 않는다', () => {
    const dual = candidate({
      id: 'dual', allocation: 'CONSERVATIVE', spending: 'FRONT_LOADED', goalProbability: 0.9,
    });

    const result = new RecommendationEngine().recommend([dual]);

    const ids = result.recommendations.map((item) => item.candidate.candidate.id);
    expect(ids).toEqual(['dual']);
    // 배열 순서상 안정형이 먼저 선점한다. 여유형은 남은 후보가 없으므로 비어야 한다.
    expect(result.recommendations.map((item) => item.persona)).toEqual(['STABLE']);
  });

  test('겹치는 후보가 있어도 각 페르소나에는 서로 다른 후보가 간다', () => {
    const dual = candidate({
      id: 'dual', allocation: 'CONSERVATIVE', spending: 'FRONT_LOADED', goalProbability: 0.9,
    });
    const frontLoaded = candidate({
      id: 'front-loaded', allocation: 'GROWTH', spending: 'FRONT_LOADED', goalProbability: 0.8,
    });

    const result = new RecommendationEngine().recommend([dual, frontLoaded]);

    const ids = result.recommendations.map((item) => item.candidate.candidate.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(['dual', 'front-loaded']);
  });
});
