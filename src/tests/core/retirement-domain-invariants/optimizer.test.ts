import { describe, expect, test } from 'vitest';
import { LegacySimulationAdapter } from '@/core/domain/input/LegacySimulationAdapter';
import type { SimulationEngine } from '@/core/simulation/SimulationEngine';
import { LegacySimulationEngine } from '@/core/simulation/LegacySimulationEngine';
import type { StrategyCandidate, StrategyGenerationResult } from '@/core/strategy/StrategyGenerator';
import { StrategyGenerator } from '@/core/strategy/StrategyGenerator';
import { StrategyOptimizer } from '@/core/strategy/StrategyOptimizer';
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
          assetAllocation: 'BALANCED',
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
          assetAllocation: 'BALANCED',
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
          assetAllocation: 1,
        },
        theoreticalCombinationCount: 2,
        generatedCandidateCount: 2,
        cappedCandidateCount: 0,
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
});
