import { describe, expect, test } from 'vitest';
import { LegacySimulationAdapter } from '@/core/domain/input/LegacySimulationAdapter';
import type { SimulationEngine } from '@/core/simulation/SimulationEngine';
import { LegacySimulationEngine } from '@/core/simulation/LegacySimulationEngine';
import type { StrategyCandidate, StrategyGenerationResult } from '@/core/strategy/StrategyGenerator';
import { StrategyGenerator } from '@/core/strategy/StrategyGenerator';
import { StrategyOptimizer } from '@/core/strategy/StrategyOptimizer';
import { MonteCarloEngine } from '@/core/usecases/montecarlo/MonteCarloEngine';
import { retirementParams } from './fixtures';

describe('retirement-domain-invariants / optimizer', () => {
  test('상속 목표보다 훨씬 많이 남겨도 생활비 HARD 부족 후보는 기본 랭킹에서 탈락한다', () => {
    const input = LegacySimulationAdapter.fromLegacy(retirementParams());
    input.goals.selectedGoals = [
      {
        type: 'LIVING_EXPENSE_STABILITY',
        priority: 1,
        constraintType: 'HARD',
      },
      {
        type: 'INHERITANCE',
        priority: 2,
        constraintType: 'SOFT',
        targetValue: 500_000_000,
      },
    ];
    const fundedStrategy = { ...input.strategy };
    const wastefulStrategy = { ...input.strategy };
    const candidates: StrategyCandidate[] = [
      {
        id: 'funded',
        strategy: fundedStrategy,
        dimensions: {
          retirementAge: fundedStrategy.retirementAge,
          nationalPensionTiming: 'NORMAL',
          nationalPensionStartAge: 65,
          withdrawalPolicy: 'GENERAL_FIRST',
          spendingPattern: 'FIXED',
        },
      },
      {
        id: 'wasteful',
        strategy: wastefulStrategy,
        dimensions: {
          retirementAge: wastefulStrategy.retirementAge,
          nationalPensionTiming: 'NORMAL',
          nationalPensionStartAge: 65,
          withdrawalPolicy: 'GENERAL_FIRST',
          spendingPattern: 'FIXED',
        },
      },
    ];
    const actualEngine = new LegacySimulationEngine();
    const funded = actualEngine.simulate(input.profile, fundedStrategy);
    const firstRetirementYear = funded.yearlyResults.findIndex(
      (year) => year.age >= wastefulStrategy.retirementAge
    );
    const wasteful = {
      ...funded,
      endingAssets: 100_000_000_000,
      yearlyResults: funded.yearlyResults.map((year, index) => index === firstRetirementYear
        ? {
            ...year,
            actualSpending: Math.max(0, year.actualSpending - 1),
            spending: Math.max(0, year.spending - 1),
            shortfall: 1,
            unmetSpending: 1,
          }
        : year),
    };
    const engine: SimulationEngine = {
      simulate: (_profile, strategy) => strategy === wastefulStrategy ? wasteful : funded,
    };
    const generation: StrategyGenerationResult = {
      candidates,
      debug: {
        axisSizes: {
          retirementAge: 1,
          nationalPensionTiming: 1,
          nationalPensionStartAge: 1,
          withdrawalPolicy: 1,
          spendingPattern: 1,
        },
        theoreticalCombinationCount: 2,
        generatedCandidateCount: 2,
        cappedCandidateCount: 0,
        baselineCandidateId: 'baseline',
        baselineDuplicateCount: 0,
        omittedAxes: [],
      },
    };
    const generator = { generate: () => generation } as unknown as StrategyGenerator;

    const optimized = new StrategyOptimizer(engine, undefined, generator).optimize(
      input.profile,
      input.goals,
      input.strategy,
    );

    expect(optimized.best?.candidate.id).toBe('funded');
    expect(optimized.rankedCandidates.map((candidate) => candidate.candidate.id))
      .not.toContain('wasteful');
    expect(optimized.debug.rejectionReasons.HARD_SPENDING_SHORTFALL).toBe(1);
  });

  // 2단계(선별→확정) 깔때기가 추천 품질을 의미 있게 떨어뜨리지 않는지 지킨다.
  //
  // 낮은 시행 수로 선별하면 근소한 차이의 후보들 사이에서 순서가 뒤집힐 수 있다. 그건
  // 설계상 감수하는 비용이고(그 대가로 실측 11.5초 → 3.1초), 중요한 것은 "뒤집혀도 사용자가
  // 받는 계획의 목표 성공확률이 실질적으로 같아야 한다"는 것이다. 후보 id가 같은지가 아니라
  // 확률 차이를 본다.
  test('선별 단계를 거쳐 고른 전략도 전량 검증으로 고른 전략과 실질적으로 같은 수준이다', () => {
    const base = retirementParams();
    // 성공확률이 100%에 붙지 않고 실제로 갈리도록 자산을 줄인다.
    const params = {
      ...base,
      assets: [{ ...base.assets[0], quantity: 12_000 }],
      userProfile: { ...base.userProfile, targetMonthlySpending: 4_000_000 },
    };
    const input = LegacySimulationAdapter.fromLegacy(params);
    const engine = new LegacySimulationEngine();
    const config = { trials: 300, seed: 42, annualStdDev: 15 };
    const optimizer = () =>
      new StrategyOptimizer(engine, undefined, undefined, new MonteCarloEngine(engine));

    const flat = optimizer().optimize(input.profile, input.goals, input.strategy, {
      monteCarlo: { config, shortlistLimit: 12, screeningTrials: 300 },
    });
    const staged = optimizer().optimize(input.profile, input.goals, input.strategy, {
      monteCarlo: { config, shortlistLimit: 12, screeningTrials: 80 },
    });

    const byPersona = (result: typeof flat) => new Map(
      result.recommendations.recommendations.map((item) =>
        [item.persona, item.candidate.monteCarlo.goalSuccessProbability]),
    );
    const flatProbabilities = byPersona(flat);
    const stagedProbabilities = byPersona(staged);

    // 두 결과가 모두 비면 아래 비교가 공허하게 통과한다. 먼저 실제로 추천이 나왔는지 본다.
    expect(flatProbabilities.size).toBeGreaterThan(0);
    expect([...stagedProbabilities.keys()].sort()).toEqual([...flatProbabilities.keys()].sort());
    for (const [persona, flatProbability] of flatProbabilities) {
      // 선별 오차로 다른 후보가 뽑히더라도 목표 성공확률 차이는 2%p 이내여야 한다.
      expect(Math.abs(stagedProbabilities.get(persona)! - flatProbability)).toBeLessThanOrEqual(0.02);
    }
  });
});
