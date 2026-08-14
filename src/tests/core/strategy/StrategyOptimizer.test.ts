import { describe, expect, test, vi } from 'vitest';
import type { StrategySimulationResult, UtilityBreakdown } from '@/core/entities/types';
import type { GoalEvaluationEngine, GoalEvaluationResult } from '@/core/evaluation/GoalEvaluationEngine';
import { LegacySimulationAdapter } from '@/core/domain/input/LegacySimulationAdapter';
import type { SimulationEngine } from '@/core/simulation/SimulationEngine';
import { LegacySimulationEngine } from '@/core/simulation/LegacySimulationEngine';
import type { StrategyCandidate, StrategyGenerationResult } from '@/core/strategy/StrategyGenerator';
import { StrategyGenerator } from '@/core/strategy/StrategyGenerator';
import { StrategyOptimizer } from '@/core/strategy/StrategyOptimizer';
import type { StrategyMonteCarloEngine } from '@/core/usecases/montecarlo/MonteCarloEngine';
import { VOLATILITY_BY_YIELD_PRESET } from '@/core/usecases/montecarlo/volatilityPresets';
import { initialParams } from '@/infrastructure/storage/localStore';

const utility = (score: number): UtilityBreakdown => ({
  score,
  components: {
    consumption: score,
    depletionSafety: 0,
    pensionUtilization: 0,
    taxEfficiency: 0,
    taxationRisk: 0,
    bequestAdequacy: 0,
  },
});

const evaluation = (
  score: number,
  hardConstraintFailures: GoalEvaluationResult['hardConstraintFailures'] = [],
): GoalEvaluationResult => ({
  score,
  weightedScore: score,
  hardConstraintsSatisfied: hardConstraintFailures.length === 0,
  goalEvaluations: [],
  utility: utility(score),
  hardConstraintFailures,
  unsupportedHardGoals: [],
});

const simulation = (endingAssets: number): StrategySimulationResult => ({
  yearlyResults: [],
  depletionAge: null,
  endingAssets,
});

function candidate(
  seed: ReturnType<typeof LegacySimulationAdapter.fromLegacy>['strategy'],
  id: string,
  retirementAge: number,
): StrategyCandidate {
  return {
    id,
    strategy: { ...seed, retirementAge },
    dimensions: {
      retirementAge,
      nationalPensionTiming: 'NORMAL',
      nationalPensionStartAge: 65,
      withdrawalPolicy: 'GENERAL_FIRST',
      spendingPattern: 'FIXED',
      assetAllocation: 'BALANCED',
    },
  };
}

function fakeGeneration(candidates: StrategyCandidate[]): StrategyGenerationResult {
  return {
    candidates,
    debug: {
      axisSizes: {
        retirementAge: candidates.length,
        nationalPensionTiming: 1,
        nationalPensionStartAge: 1,
        withdrawalPolicy: 1,
        spendingPattern: 1,
        assetAllocation: 1,
      },
      theoreticalCombinationCount: candidates.length,
      generatedCandidateCount: candidates.length,
      cappedCandidateCount: 0,
      omittedAxes: [],
    },
  };
}

describe('StrategyOptimizer', () => {
  test('실제 엔진 경계로 생성부터 평가·랭킹까지 연결한다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));

    const result = new StrategyOptimizer(new LegacySimulationEngine()).optimize(
      input.profile,
      input.goals,
      input.strategy,
      { maxCandidates: 12, rankingLimit: 3 },
    );

    expect(result.debug.generatedCandidateCount).toBe(12);
    expect(result.debug.simulatedCandidateCount).toBe(12);
    expect(result.debug.failedCandidateCount).toBe(0);
    expect(result.rankedCandidates).toHaveLength(3);
    expect(result.best?.rank).toBe(1);
  });

  test('HARD 은퇴 나이 위반 후보는 시뮬레이션 전에 제거한다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    input.goals.selectedGoals = [{
      type: 'EARLY_RETIREMENT', priority: 1, targetValue: 60, constraintType: 'HARD',
    }];
    const candidates = [candidate(input.strategy, 'age-60', 60), candidate(input.strategy, 'age-61', 61)];
    const generator = { generate: vi.fn(() => fakeGeneration(candidates)) } as unknown as StrategyGenerator;
    const simulate = vi.fn(() => simulation(100));
    const engine = { simulate } satisfies SimulationEngine;
    const evaluator = { evaluate: vi.fn(() => evaluation(70)) } satisfies GoalEvaluationEngine;

    const result = new StrategyOptimizer(engine, evaluator, generator)
      .optimize(input.profile, input.goals, input.strategy);

    expect(simulate).toHaveBeenCalledTimes(1);
    expect(result.best?.candidate.id).toBe('age-60');
    expect(result.debug.hardConstraintRejectedCount).toBe(1);
    expect(result.debug.rejectionReasons.HARD_RETIREMENT_AGE).toBe(1);
  });

  test('사후 HARD 탈락과 시뮬레이션 실패를 분리 집계하고 목표 가중 점수로 정렬한다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    const candidates = [
      candidate(input.strategy, 'low', 60),
      candidate(input.strategy, 'best', 60),
      candidate(input.strategy, 'hard-fail', 60),
      candidate(input.strategy, 'engine-fail', 60),
    ];
    const generator = { generate: () => fakeGeneration(candidates) } as unknown as StrategyGenerator;
    const engine: SimulationEngine = {
      simulate: vi.fn((_profile, strategy) => {
        const id = candidates.find((item) => item.strategy === strategy)?.id;
        if (id === 'engine-fail') throw new Error('projection failed');
        return simulation(id === 'best' ? 200 : 100);
      }),
    };
    const evaluator: GoalEvaluationEngine = {
      evaluate: vi.fn((_profile, _goals, strategy) => {
        const id = candidates.find((item) => item.strategy === strategy)?.id;
        if (id === 'hard-fail') {
          return evaluation(99, [{
            code: 'HARD_ASSET_SURVIVAL',
            goalType: 'ASSET_SURVIVAL',
            reason: 'depleted',
          }]);
        }
        const evaluated = evaluation(id === 'best' ? 90 : 50);
        // lifetime utility compatibility fields must no longer decide the primary ranking.
        return id === 'best'
          ? { ...evaluated, score: 1, utility: utility(1) }
          : { ...evaluated, score: 100, utility: utility(100) };
      }),
    };

    const result = new StrategyOptimizer(engine, evaluator, generator)
      .optimize(input.profile, input.goals, input.strategy);

    expect(result.rankedCandidates.map((item) => item.candidate.id)).toEqual(['best', 'low']);
    expect(result.rankedCandidates.map((item) => item.rank)).toEqual([1, 2]);
    expect(result.debug.postSimulationRejectedCount).toBe(1);
    expect(result.debug.failedCandidateCount).toBe(1);
    expect(result.debug.rejectionReasons.HARD_ASSET_SURVIVAL).toBe(1);
    expect(result.debug.simulationFailures).toEqual([
      { candidateId: 'engine-fail', reason: 'projection failed' },
    ]);
  });

  test('동점이면 기말자산, 후보 id 순으로 결정론적으로 정렬한다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    const candidates = [candidate(input.strategy, 'b', 60), candidate(input.strategy, 'a', 60)];
    const generator = { generate: () => fakeGeneration(candidates) } as unknown as StrategyGenerator;
    const engine: SimulationEngine = {
      simulate: (_profile, strategy) => simulation(strategy === candidates[0].strategy ? 100 : 200),
    };
    const evaluator: GoalEvaluationEngine = { evaluate: () => evaluation(80) };

    const result = new StrategyOptimizer(engine, evaluator, generator)
      .optimize(input.profile, input.goals, input.strategy, { rankingLimit: 1 });

    expect(result.rankedCandidates).toHaveLength(1);
    expect(result.best?.candidate.id).toBe('a');
    expect(result.debug.rankedCandidateCount).toBe(2);
  });

  test('결정론 상위 20개만 Monte Carlo로 검증한 뒤 최종 3개를 재정렬한다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    const candidates = Array.from({ length: 30 }, (_, index) =>
      candidate(input.strategy, `candidate-${String(index + 1).padStart(2, '0')}`, 60)
    );
    const generator = { generate: () => fakeGeneration(candidates) } as unknown as StrategyGenerator;
    const engine: SimulationEngine = { simulate: () => simulation(100) };
    const evaluator: GoalEvaluationEngine = {
      evaluate: vi.fn((_profile, _goals, strategy) => {
        const index = candidates.findIndex((item) => item.strategy === strategy);
        return evaluation(100 - index);
      }),
    };
    const validate = vi.fn((_profile, _goals, strategy, config) => {
      const index = candidates.findIndex((item) => item.strategy === strategy);
      const probability = index / 100;
      return {
        trials: config.trials,
        seed: config.seed,
        goalSuccessProbability: probability,
        spendingSuccessProbability: probability,
        assetSurvivalProbability: probability,
        terminalAssetMedian: index,
        terminalAssetP10: index,
        terminalAssetP90: index,
        shortfallProbability: 1 - probability,
      };
    });
    const monteCarloEngine = { validate } satisfies StrategyMonteCarloEngine;

    const result = new StrategyOptimizer(engine, evaluator, generator, monteCarloEngine).optimize(
      input.profile,
      input.goals,
      input.strategy,
      { monteCarlo: { config: { trials: 1_000, seed: 42, annualStdDev: 15 } } },
    );

    expect(validate).toHaveBeenCalledTimes(20);
    expect(validate.mock.calls.every((call) => call[3].seed === 42)).toBe(true);
    expect(result.rankedCandidates.map((item) => item.candidate.id)).toEqual([
      'candidate-20',
      'candidate-19',
      'candidate-18',
    ]);
    expect(result.rankedCandidates.every((item) => item.monteCarlo !== undefined)).toBe(true);
    expect(result.debug.deterministicShortlistCount).toBe(20);
    expect(result.debug.monteCarloValidatedCount).toBe(20);
    expect(result.debug.monteCarloFailures).toEqual([]);
  });

  test('Monte Carlo 옵션이 없으면 확률 검증을 실행하지 않는다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    const candidates = [candidate(input.strategy, 'only', 60)];
    const generator = { generate: () => fakeGeneration(candidates) } as unknown as StrategyGenerator;
    const validate = vi.fn();

    const result = new StrategyOptimizer(
      { simulate: () => simulation(100) },
      { evaluate: () => evaluation(80) },
      generator,
      { validate } as unknown as StrategyMonteCarloEngine,
    ).optimize(input.profile, input.goals, input.strategy);

    expect(validate).not.toHaveBeenCalled();
    expect(result.debug.deterministicShortlistCount).toBe(0);
    expect(result.debug.monteCarloValidatedCount).toBe(0);
  });

  test('후보별 수익률 프리셋의 변동성을 적용하면서 trials와 seed는 공통으로 유지한다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    const presets = ['conservative', 'base', 'aggressive'] as const;
    const candidates = presets.map((preset) => {
      const item = candidate(input.strategy, preset, 60);
      return {
        ...item,
        strategy: {
          ...item.strategy,
          legacySettings: { ...item.strategy.legacySettings, yieldPreset: preset },
        },
      };
    });
    const generator = { generate: () => fakeGeneration(candidates) } as unknown as StrategyGenerator;
    const validate = vi.fn((_profile, _goals, _strategy, config) => ({
      trials: config.trials,
      seed: config.seed,
      goalSuccessProbability: 1,
      spendingSuccessProbability: 1,
      assetSurvivalProbability: 1,
      terminalAssetMedian: 100,
      terminalAssetP10: 90,
      terminalAssetP90: 110,
      shortfallProbability: 0,
    }));

    new StrategyOptimizer(
      { simulate: () => simulation(100) },
      { evaluate: () => evaluation(80) },
      generator,
      { validate } satisfies StrategyMonteCarloEngine,
    ).optimize(input.profile, input.goals, input.strategy, {
      monteCarlo: { config: { trials: 1_000, seed: 2026, annualStdDev: 99 } },
    });

    const configsByPreset = Object.fromEntries(validate.mock.calls.map((call) => [
      call[2].legacySettings.yieldPreset,
      call[3],
    ]));
    expect(configsByPreset).toEqual({
      conservative: {
        trials: 1_000,
        seed: 2026,
        annualStdDev: VOLATILITY_BY_YIELD_PRESET.conservative,
      },
      base: {
        trials: 1_000,
        seed: 2026,
        annualStdDev: VOLATILITY_BY_YIELD_PRESET.base,
      },
      aggressive: {
        trials: 1_000,
        seed: 2026,
        annualStdDev: VOLATILITY_BY_YIELD_PRESET.aggressive,
      },
    });
  });
});
