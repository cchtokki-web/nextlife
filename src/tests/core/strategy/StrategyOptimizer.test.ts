import { describe, expect, test, vi } from 'vitest';
import type { StrategySimulationResult, UtilityBreakdown } from '@/core/entities/types';
import type { GoalEvaluationEngine, GoalEvaluationResult } from '@/core/evaluation/GoalEvaluationEngine';
import { LegacySimulationAdapter } from '@/core/domain/input/LegacySimulationAdapter';
import type { SimulationEngine } from '@/core/simulation/SimulationEngine';
import { LegacySimulationEngine } from '@/core/simulation/LegacySimulationEngine';
import type { StrategyCandidate, StrategyGenerationResult } from '@/core/strategy/StrategyGenerator';
import { StrategyGenerator } from '@/core/strategy/StrategyGenerator';
import { personaAwareShortlist } from '@/core/strategy/StrategyOptimizer';
import { StrategyOptimizer } from '@/core/strategy/StrategyOptimizer';
import type { StrategyMonteCarloEngine } from '@/core/usecases/montecarlo/MonteCarloEngine';
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
  dimensionOverrides: Partial<StrategyCandidate['dimensions']> = {},
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
      ...dimensionOverrides,
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
      },
      theoreticalCombinationCount: candidates.length,
      generatedCandidateCount: candidates.length,
      cappedCandidateCount: 0,
      baselineCandidateId: 'baseline',
      baselineDuplicateCount: 0,
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

  // 격자에 현상 유지가 없으면 argmax는 반드시 어떤 조정을 고른다. 실제 생성기를 써서
  // "현재 계획이 최선이면 현재 계획을 돌려준다"를 끝까지 확인한다 — 후보 목록에 넣는 것과
  // 순위 경로가 그것을 살려 두는 것은 다른 문제다.
  test('현재 계획이 가장 좋으면 아무것도 바꾸지 않는 안을 고른다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    const seed = {
      ...input.strategy,
      spendingPolicy: { ...input.strategy.spendingPolicy, mode: 'max_sustainable' as const },
    };
    const engine = { simulate: vi.fn(() => simulation(100)) } satisfies SimulationEngine;
    // 소비 모드를 그대로 둔 후보는 현상 유지 하나뿐이다(격자는 전부 target으로 고정한다).
    const evaluator = {
      evaluate: vi.fn((_profile, _goals, strategy) =>
        evaluation(strategy.spendingPolicy.mode === 'max_sustainable' ? 100 : 50)),
    } satisfies GoalEvaluationEngine;

    const result = new StrategyOptimizer(engine, evaluator, new StrategyGenerator())
      .optimize(input.profile, input.goals, seed);

    expect(result.best?.candidate.id).toBe('baseline');
    expect(result.best?.candidate.strategy).toEqual(seed);
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

  test('커스텀 평가기가 실패 상세 없이 HARD false만 반환해도 후보를 통과시키지 않는다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    const only = candidate(input.strategy, 'hard-false', 60);
    const generator = { generate: () => fakeGeneration([only]) } as unknown as StrategyGenerator;
    const evaluated = { ...evaluation(70), hardConstraintsSatisfied: false };

    const result = new StrategyOptimizer(
      { simulate: () => simulation(100) },
      { evaluate: () => evaluated },
      generator,
    ).optimize(input.profile, input.goals, input.strategy);

    expect(result.rankedCandidates).toEqual([]);
    expect(result.debug.postSimulationRejectedCount).toBe(1);
    // 탈락시켰다면 사유도 반드시 남는다. 예전에는 "1개 탈락, 사유 {}"가 나왔다.
    expect(result.debug.rejectionReasons).toEqual({ HARD_UNSPECIFIED: 1 });
    expect(result.outcome).toMatchObject({
      kind: 'no_candidate_survived',
      hardConstraintRejectedCount: 1,
      blockedBy: ['HARD_UNSPECIFIED'],
    });
  });

  test('실패 상세가 있으면 불리언이 true여도 상세를 따른다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    const only = candidate(input.strategy, 'contradictory', 60);
    const generator = { generate: () => fakeGeneration([only]) } as unknown as StrategyGenerator;
    // 두 값이 모순된 상태. 상세 목록이 단일 근거이므로 후보는 탈락해야 한다.
    const evaluated = {
      ...evaluation(70, [{
        code: 'HARD_ASSET_SURVIVAL' as const,
        goalType: 'ASSET_SURVIVAL' as const,
        reason: 'depleted',
      }]),
      hardConstraintsSatisfied: true,
    };

    const result = new StrategyOptimizer(
      { simulate: () => simulation(100) },
      { evaluate: () => evaluated },
      generator,
    ).optimize(input.profile, input.goals, input.strategy);

    expect(result.rankedCandidates).toEqual([]);
    expect(result.debug.rejectionReasons).toEqual({ HARD_ASSET_SURVIVAL: 1 });
  });

  test('불리언을 생략한 평가 결과는 실패 상세가 없으면 통과시킨다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    const only = candidate(input.strategy, 'clean', 60);
    const generator = { generate: () => fakeGeneration([only]) } as unknown as StrategyGenerator;
    const { hardConstraintsSatisfied: _omitted, ...withoutBoolean } = evaluation(70);

    const result = new StrategyOptimizer(
      { simulate: () => simulation(100) },
      { evaluate: () => withoutBoolean },
      generator,
    ).optimize(input.profile, input.goals, input.strategy);

    expect(result.rankedCandidates).toHaveLength(1);
    expect(result.debug.postSimulationRejectedCount).toBe(0);
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
    expect(result.debug.acceptedCandidateCount).toBe(2);
  });

  test('선별은 낮은 시행 수로 하고, 화면에 나가는 숫자는 전체 시행으로 다시 구한다', () => {
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
    // 시행 수에 따라 값이 달라지게 해서, 최종 결과가 어느 단계에서 왔는지 구분할 수 있게 한다.
    const validate = vi.fn((_profile, _goals, _strategy, config) => {
      const probability = config.trials === 1_000 ? 0.9 : 0.4;
      return {
        trials: config.trials, seed: config.seed,
        goalSuccessProbability: probability, spendingSuccessProbability: probability,
        assetSurvivalProbability: probability, terminalAssetMedian: config.trials,
        terminalAssetP10: 1, terminalAssetP90: 2, shortfallProbability: 1 - probability,
      };
    });

    const result = new StrategyOptimizer(engine, evaluator, generator, { validate }).optimize(
      input.profile,
      input.goals,
      input.strategy,
      { monteCarlo: { config: { trials: 1_000, seed: 42, annualStdDev: 15 } } },
    );

    const trialCounts = validate.mock.calls.map((call) => call[3].trials);
    // 12개는 선별(200), 페르소나 승자만 확정(1000). 예전의 평면적 20 × 1000과 대비된다.
    // 후보가 전부 FIXED라 여유형은 비고, 안정형·균형형 둘만 승자를 낸다.
    expect(trialCounts.filter((t) => t === 200)).toHaveLength(12);
    expect(trialCounts.filter((t) => t === 1_000)).toHaveLength(2);
    expect(validate.mock.calls.every((call) => call[3].seed === 42)).toBe(true);

    expect(result.debug.deterministicShortlistCount).toBe(12);
    expect(result.debug.monteCarloValidatedCount).toBe(12);
    expect(result.debug.monteCarloConfirmedCount).toBe(2);

    // 추천과 순위에 실린 값은 반드시 전체 시행 결과여야 한다.
    const recommended = result.recommendations.recommendations[0];
    expect(recommended.candidate.monteCarlo.goalSuccessProbability).toBe(0.9);
    expect(recommended.candidate.monteCarlo.terminalAssetMedian).toBe(1_000);
    expect(result.rankedCandidates).toHaveLength(2);
    expect(result.rankedCandidates.every((item) => item.monteCarlo?.trials === 1_000)).toBe(true);
  });

  test('screeningTrials가 config.trials 이상이면 단일 패스로 동작한다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    const candidates = [candidate(input.strategy, 'a', 60)];
    const generator = { generate: () => fakeGeneration(candidates) } as unknown as StrategyGenerator;
    const validate = vi.fn((_p, _g, _s, config) => ({
      trials: config.trials, seed: config.seed,
      goalSuccessProbability: 0.8, spendingSuccessProbability: 0.8,
      assetSurvivalProbability: 0.8, terminalAssetMedian: 100,
      terminalAssetP10: 50, terminalAssetP90: 200, shortfallProbability: 0.2,
    }));

    new StrategyOptimizer(
      { simulate: () => simulation(100) },
      { evaluate: () => evaluation(80) },
      generator,
      { validate },
    ).optimize(input.profile, input.goals, input.strategy, {
      monteCarlo: { config: { trials: 500, seed: 1, annualStdDev: 15 }, screeningTrials: 500 },
    });

    // 재검증 없이 한 번만 부른다.
    expect(validate).toHaveBeenCalledTimes(1);
    expect(validate.mock.calls[0][3].trials).toBe(500);
  });

  test('결정론 상위 후보만 Monte Carlo로 검증한 뒤 페르소나를 배정한다', () => {
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

    expect(validate.mock.calls.every((call) => call[3].seed === 42)).toBe(true);
    expect(result.rankedCandidates.every((item) => item.monteCarlo !== undefined)).toBe(true);
    expect(result.debug.deterministicShortlistCount).toBe(12);
    expect(result.debug.monteCarloValidatedCount).toBe(12);
    expect(result.debug.monteCarloFailures).toEqual([]);
    // 후보 30개가 모두 FIXED이므로 여유형은 성립하지 않는다. 안정형·균형형은 자격 조건이
    // 아니라 비교자로 정의되므로 언제나 채워진다 — 예전에는 자산배분 라벨이 그 둘의 자격
    // 조건이었고, 그 축은 사용자가 실행할 수 있는 조정이 아니어서 없앴다.
    expect(result.recommendations.recommendations.map((item) => item.label))
      .toEqual(['안정형', '균형형']);
  });

  // 확정 단계(1000회 재실행)는 선별 단계와 다른 확률을 만든다. 그래서 primary를 그 자리에서
  // 다시 고르는데, 이 재선정이 배지 규칙을 따르지 않으면 화면의 ☆만 옛 규칙으로 남는다.
  test('목표를 모두 지킨 카드 중 확률이 가장 높은 것에 추천을 준다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    input.goals.selectedGoals = [
      { type: 'ASSET_SURVIVAL', priority: 1, constraintType: 'SOFT' },
    ];
    const candidates = [
      candidate(input.strategy, 'stable', 60),
      candidate(input.strategy, 'balanced', 60),
    ];
    const generator = { generate: () => fakeGeneration(candidates) } as unknown as StrategyGenerator;
    const engine: SimulationEngine = { simulate: () => simulation(100) };
    const achievedEvaluation = (score: number): GoalEvaluationResult => ({
      ...evaluation(score),
      goalEvaluations: [{
        goalType: 'ASSET_SURVIVAL',
        score: 100,
        achieved: true,
        measurement: { unit: 'NONE' },
        reason: '',
      }],
    });
    const evaluator: GoalEvaluationEngine = {
      evaluate: vi.fn(() => achievedEvaluation(70)),
    };
    const idOf = (strategy: unknown) =>
      candidates.find((item) => item.strategy === strategy)?.id;
    const validate = vi.fn((_profile, _goals, strategy, config) => {
      const probability = idOf(strategy) === 'stable' ? 0.7 : 0.47;
      return {
        trials: config.trials,
        seed: config.seed,
        goalSuccessProbability: probability,
        spendingSuccessProbability: probability,
        assetSurvivalProbability: probability,
        terminalAssetMedian: 100,
        terminalAssetP10: 50,
        terminalAssetP90: 150,
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

    expect(result.recommendations.recommendations.map((item) => item.label))
      .toEqual(['안정형', '균형형']);
    expect(result.recommendations.primary?.candidate.candidate.id).toBe('stable');
  });

  test('여유형 라벨은 그 특성을 실제로 가진 후보에만 붙는다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    // 은퇴초기 집중형은 결정론 점수가 가장 낮게 나오기 쉬워 shortlist에서 먼저 잘린다.
    // 그러면 여유형 자리에 평탄한 계획이 앉은 채 "은퇴 초반 소비 여력을 우선했습니다"라는
    // 문구가 붙는다. personaAwareShortlist가 그 자리를 먼저 예약하는 이유다.
    const candidates = [
      ...Array.from({ length: 8 }, (_, index) =>
        candidate(input.strategy, `fixed-${index}`, 60, { spendingPattern: 'FIXED' })),
      candidate(input.strategy, 'front-loaded', 60, { spendingPattern: 'FRONT_LOADED' }),
    ];
    const generator = { generate: () => fakeGeneration(candidates) } as unknown as StrategyGenerator;
    const engine: SimulationEngine = { simulate: () => simulation(100) };
    const evaluator: GoalEvaluationEngine = {
      evaluate: vi.fn((_profile, _goals, strategy) => {
        const index = candidates.findIndex((item) => item.strategy === strategy);
        return evaluation(100 - index);
      }),
    };
    const monteCarloEngine = {
      validate: (_profile, _goals, _strategy, config) => ({
        trials: config.trials,
        seed: config.seed,
        goalSuccessProbability: 0.8,
        spendingSuccessProbability: 0.8,
        assetSurvivalProbability: 0.8,
        terminalAssetMedian: 100,
        terminalAssetP10: 50,
        terminalAssetP90: 200,
        shortfallProbability: 0.2,
      }),
    } satisfies StrategyMonteCarloEngine;

    const result = new StrategyOptimizer(engine, evaluator, generator, monteCarloEngine).optimize(
      input.profile,
      input.goals,
      input.strategy,
      // 점수 상위 4개만 뽑으면 전부 FIXED다. 그래도 여유형 자리를 먼저 확보해야 한다.
      { monteCarlo: { config: { trials: 100, seed: 42, annualStdDev: 15 }, shortlistLimit: 4 } },
    );

    const byLabel = new Map(
      result.recommendations.recommendations.map((item) => [item.label, item.candidate]),
    );
    expect(byLabel.get('여유형')?.candidate.id).toBe('front-loaded');
    expect(byLabel.get('여유형')?.candidate.dimensions.spendingPattern).toBe('FRONT_LOADED');
  });

  test('HARD 목표로 전부 탈락한 경우와 계산이 전부 실패한 경우를 구분해 보고한다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    const candidates = [candidate(input.strategy, 'a', 60), candidate(input.strategy, 'b', 61)];
    const generator = { generate: () => fakeGeneration(candidates) } as unknown as StrategyGenerator;

    // (1) 시뮬레이션이 전부 예외로 죽는 경우
    const crashing: SimulationEngine = {
      simulate: () => { throw new Error('projection exploded'); },
    };
    const crashed = new StrategyOptimizer(
      crashing,
      { evaluate: () => evaluation(80) },
      generator,
    ).optimize(input.profile, input.goals, input.strategy);

    expect(crashed.outcome).toEqual({
      kind: 'no_candidate_survived',
      hardConstraintRejectedCount: 0,
      failedCount: 2,
      blockedBy: [],
      firstFailureReason: 'projection exploded',
    });

    // (2) HARD 제약으로 전부 탈락하는 경우 — 같은 "추천 0개"지만 원인이 전혀 다르다.
    const healthy: SimulationEngine = { simulate: () => simulation(100) };
    const rejecting: GoalEvaluationEngine = {
      evaluate: () => evaluation(80, [{
        code: 'HARD_ASSET_SURVIVAL',
        goalType: 'ASSET_SURVIVAL',
        reason: '계획 종료 전에 자산이 고갈됩니다.',
      }]),
    };
    const rejected = new StrategyOptimizer(healthy, rejecting, generator)
      .optimize(input.profile, input.goals, input.strategy);

    expect(rejected.outcome).toEqual({
      kind: 'no_candidate_survived',
      hardConstraintRejectedCount: 2,
      failedCount: 0,
      blockedBy: ['HARD_ASSET_SURVIVAL'],
    });
  });

  // 자산배분 축을 없앤 뒤로 안정형·균형형은 자격 조건 없이 비교자만으로 정의된다. 그래서
  // 몬테카를로를 통과한 후보가 하나라도 있으면 추천은 반드시 채워지고, no_persona_matched는
  // 방어적 분기로만 남는다(여유형 하나가 비는 것은 정상이며 outcome을 바꾸지 않는다).
  test('검증된 후보가 하나뿐이어도 페르소나를 비우지 않는다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    // 페르소나 조건에 맞는 후보가 없으려면 모든 후보가 몬테카를로 검증을 통과하지 못해야
    // 한다 — 안정형·균형형은 자격 조건이 없으므로, 검증된 후보가 있으면 반드시 채워진다.
    const candidates = [
      candidate(input.strategy, 'fixed', 60, { spendingPattern: 'FIXED' }),
    ];
    const generator = { generate: () => fakeGeneration(candidates) } as unknown as StrategyGenerator;
    const monteCarloEngine = {
      validate: (_p, _g, _s, config) => ({
        trials: config.trials, seed: config.seed,
        goalSuccessProbability: 0.8, spendingSuccessProbability: 0.8,
        assetSurvivalProbability: 0.8, terminalAssetMedian: 100,
        terminalAssetP10: 50, terminalAssetP90: 200, shortfallProbability: 0.2,
      }),
    } satisfies StrategyMonteCarloEngine;

    const result = new StrategyOptimizer(
      { simulate: () => simulation(100) },
      { evaluate: () => evaluation(80) },
      generator,
      monteCarloEngine,
    ).optimize(input.profile, input.goals, input.strategy, {
      monteCarlo: { config: { trials: 10, seed: 1, annualStdDev: 15 } },
    });

    expect(result.recommendations.recommendations.map((item) => item.label)).toEqual(['안정형']);
    expect(result.outcome).toEqual({ kind: 'ok' });
  });

  test('정상적으로 추천이 만들어지면 outcome은 ok다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    const candidates = [candidate(input.strategy, 'balanced', 60)];
    const generator = { generate: () => fakeGeneration(candidates) } as unknown as StrategyGenerator;
    const monteCarloEngine = {
      validate: (_p, _g, _s, config) => ({
        trials: config.trials, seed: config.seed,
        goalSuccessProbability: 0.8, spendingSuccessProbability: 0.8,
        assetSurvivalProbability: 0.8, terminalAssetMedian: 100,
        terminalAssetP10: 50, terminalAssetP90: 200, shortfallProbability: 0.2,
      }),
    } satisfies StrategyMonteCarloEngine;

    const result = new StrategyOptimizer(
      { simulate: () => simulation(100) },
      { evaluate: () => evaluation(80) },
      generator,
      monteCarloEngine,
    ).optimize(input.profile, input.goals, input.strategy, {
      monteCarlo: { config: { trials: 10, seed: 1, annualStdDev: 15 } },
    });

    expect(result.outcome).toEqual({ kind: 'ok' });
  });

  // 국민연금만 있고 자산이 없는 계획에서 실제로 나온 상태: 추천은 두 장 만들어졌지만 둘 다
  // 0%였다. 그때 outcome이 ok였기 때문에 화면은 "둘 중 하나를 고르세요"라고 말했다.
  test('추천이 전부 0%면 ok가 아니라 도달 불가로 알린다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    const candidates = [
      candidate(input.strategy, 'balanced', 60, { spendingPattern: 'FIXED' }),
      candidate(input.strategy, 'front', 61, { spendingPattern: 'FRONT_LOADED' }),
    ];
    const generator = { generate: () => fakeGeneration(candidates) } as unknown as StrategyGenerator;
    const monteCarloEngine = {
      validate: (_p, _g, _s, config) => ({
        trials: config.trials, seed: config.seed,
        goalSuccessProbability: 0, spendingSuccessProbability: 0,
        assetSurvivalProbability: 0.4, terminalAssetMedian: 100,
        terminalAssetP10: 0, terminalAssetP90: 200, shortfallProbability: 1,
      }),
    } satisfies StrategyMonteCarloEngine;

    const result = new StrategyOptimizer(
      { simulate: () => simulation(100) },
      { evaluate: () => evaluation(80) },
      generator,
      monteCarloEngine,
    ).optimize(input.profile, input.goals, input.strategy, {
      monteCarlo: { config: { trials: 10, seed: 1, annualStdDev: 15 } },
    });

    expect(result.outcome).toEqual({
      kind: 'no_candidate_reaches_goal',
      validatedCount: 2,
      personaCount: 2,
    });
    // 추천 자체는 비우지 않는다. 그 후보들이 「가장 나은 후보」라는 사실은 여전히 참이고,
    // 비우면 primary가 null이 되어 도달 불가와 「추천 없음」이 데이터에서 구별되지 않는다.
    expect(result.recommendations.recommendations).toHaveLength(2);
    expect(result.recommendations.primary).not.toBeNull();
  });

  test('추천 중 하나라도 0%를 넘으면 그대로 ok다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    const candidates = [
      candidate(input.strategy, 'balanced', 60, { spendingPattern: 'FIXED' }),
      candidate(input.strategy, 'front', 61, { spendingPattern: 'FRONT_LOADED' }),
    ];
    const generator = { generate: () => fakeGeneration(candidates) } as unknown as StrategyGenerator;
    const monteCarloEngine = {
      validate: (_p, _g, strategy, config) => ({
        trials: config.trials, seed: config.seed,
        goalSuccessProbability: strategy.retirementAge === 61 ? 0.02 : 0,
        spendingSuccessProbability: 0.1,
        assetSurvivalProbability: 0.4, terminalAssetMedian: 100,
        terminalAssetP10: 0, terminalAssetP90: 200, shortfallProbability: 0.9,
      }),
    } satisfies StrategyMonteCarloEngine;

    const result = new StrategyOptimizer(
      { simulate: () => simulation(100) },
      { evaluate: () => evaluation(80) },
      generator,
      monteCarloEngine,
    ).optimize(input.profile, input.goals, input.strategy, {
      monteCarlo: { config: { trials: 10, seed: 1, annualStdDev: 15 } },
    });

    expect(result.outcome).toEqual({ kind: 'ok' });
  });

  test('후보가 하나도 생성되지 않으면 탈락과 구분한다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    const generator = { generate: () => fakeGeneration([]) } as unknown as StrategyGenerator;

    const result = new StrategyOptimizer(
      { simulate: () => simulation(100) },
      { evaluate: () => evaluation(80) },
      generator,
    ).optimize(input.profile, input.goals, input.strategy);

    expect(result.outcome).toEqual({ kind: 'no_candidate_generated' });
  });

  test('한도가 유한하지 않으면 조용히 빈 결과를 내지 않고 예외를 던진다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    const candidates = [candidate(input.strategy, 'a', 60)];
    const generator = { generate: () => fakeGeneration(candidates) } as unknown as StrategyGenerator;
    const engine: SimulationEngine = { simulate: () => simulation(100) };
    const evaluator: GoalEvaluationEngine = { evaluate: () => evaluation(80) };

    expect(() =>
      new StrategyOptimizer(engine, evaluator, generator).optimize(
        input.profile,
        input.goals,
        input.strategy,
        { rankingLimit: Number.NaN },
      )
    ).toThrow(/rankingLimit/);
  });

  test('Monte Carlo 엔진 없이 검증을 요청하면 시뮬레이션 전에 즉시 실패한다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    const generate = vi.fn(() => fakeGeneration([candidate(input.strategy, 'a', 60)]));
    const generator = { generate } as unknown as StrategyGenerator;
    const engine: SimulationEngine = { simulate: () => simulation(100) };

    expect(() =>
      new StrategyOptimizer(engine, { evaluate: () => evaluation(80) }, generator).optimize(
        input.profile,
        input.goals,
        input.strategy,
        { monteCarlo: { config: { trials: 10, seed: 1, annualStdDev: 15 } } },
      )
    ).toThrow(/StrategyMonteCarloEngine/);
    // 후보 생성조차 하지 않아야 한다. 예전에는 전체 시뮬레이션을 끝낸 뒤에야 던졌다.
    expect(generate).not.toHaveBeenCalled();
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

  // **후보마다 σ를 다시 정하지 않는다.** 예전에는 후보의 legacySettings.yieldPreset을 읽어
  // 프리셋 변동성(10/15/20%p)으로 갈아끼웠다. 자산배분 축이 사라져 후보들의 수익률 가정이
  // 모두 같아진 지금 그 덮어쓰기는 카드가 약속한 확률을 적용 후 재현되지 못하게 만들 뿐이다 —
  // 재채점 경로(resolveMonteCarloConfig)는 실제 입력 수익률에서 σ를 유도하기 때문이다.
  test('후보의 수익률 프리셋과 무관하게 호출자가 준 설정을 그대로 쓴다', () => {
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
      // 선별/확정 2단계를 끄고 단일 패스로 둬야 후보마다 호출이 하나씩만 남아 config를
      // 그대로 비교할 수 있다.
      monteCarlo: {
        config: { trials: 1_000, seed: 2026, annualStdDev: 99 },
        screeningTrials: 1_000,
      },
    });

    const configsByPreset = Object.fromEntries(validate.mock.calls.map((call) => [
      call[2].legacySettings.yieldPreset,
      call[3],
    ]));
    expect(configsByPreset).toEqual({
      conservative: { trials: 1_000, seed: 2026, annualStdDev: 99 },
      base: { trials: 1_000, seed: 2026, annualStdDev: 99 },
      aggressive: { trials: 1_000, seed: 2026, annualStdDev: 99 },
    });
  });

  // C11: 결정론 단계는 통과했는데 확률 검증이 전부 실패한 경우. 목표가 불가능해서가 아니라
  // 계산이 깨진 것이므로 HARD 탈락과 같은 문구로 뭉뚱그리면 안 된다.
  test('Monte Carlo가 전부 실패하면 HARD 탈락과 구분해 보고한다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    const candidates = [
      candidate(input.strategy, 'a', 60),
      candidate(input.strategy, 'b', 61),
    ];
    const generator = { generate: () => fakeGeneration(candidates) } as unknown as StrategyGenerator;

    const result = new StrategyOptimizer(
      { simulate: () => simulation(100) },
      { evaluate: () => evaluation(80) },
      generator,
      { validate: () => { throw new Error('monte carlo exploded'); } },
    ).optimize(input.profile, input.goals, input.strategy, {
      monteCarlo: { config: { trials: 10, seed: 1, annualStdDev: 15 } },
    });

    expect(result.outcome).toEqual({
      kind: 'no_candidate_survived',
      hardConstraintRejectedCount: 0,
      failedCount: 2,
      blockedBy: [],
      firstFailureReason: 'monte carlo exploded',
    });
    expect(result.debug.monteCarloValidatedCount).toBe(0);
  });

  // C8: 순위의 1순위 키는 목표 성공확률이다. 이 키가 생활비 성공확률로 바뀌어도
  // 아무 테스트가 실패하지 않았다. 두 지표는 정의가 다르고(고갈 여부를 묻는지) 순서도 다르다.
  test('확률 순위의 1순위 키는 생활비가 아니라 목표 성공확률이다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    const candidates = [
      candidate(input.strategy, 'goal-best', 60),
      candidate(input.strategy, 'spending-best', 61),
    ];
    const generator = { generate: () => fakeGeneration(candidates) } as unknown as StrategyGenerator;
    // 두 지표의 순서를 일부러 반대로 만든다.
    const table: Record<string, { goal: number; spending: number }> = {
      'goal-best': { goal: 0.9, spending: 0.1 },
      'spending-best': { goal: 0.2, spending: 0.99 },
    };
    const monteCarloEngine = {
      validate: (_p, _g, strategy, config) => {
        const id = candidates.find((item) => item.strategy === strategy)!.id;
        const { goal, spending } = table[id];
        return {
          trials: config.trials, seed: config.seed,
          goalSuccessProbability: goal, spendingSuccessProbability: spending,
          assetSurvivalProbability: 0.5, terminalAssetMedian: 100,
          terminalAssetP10: 50, terminalAssetP90: 200, shortfallProbability: 1 - spending,
        };
      },
    } satisfies StrategyMonteCarloEngine;

    const result = new StrategyOptimizer(
      { simulate: () => simulation(100) },
      { evaluate: () => evaluation(80) },
      generator,
      monteCarloEngine,
    ).optimize(input.profile, input.goals, input.strategy, {
      monteCarlo: { config: { trials: 10, seed: 1, annualStdDev: 15 }, screeningTrials: 10 },
    });

    expect(result.rankedCandidates[0].candidate.id).toBe('goal-best');
  });

  // C12: unsupportedHardGoals의 화면 표시는 테스트돼 있었지만, optimizer가 그것을 실제로
  // 모으는지는 검증된 적이 없었다. 수집이 끊기면 고지 기능 전체가 조용히 죽는다.
  test('정량 판정할 수 없는 HARD 목표를 debug에 모은다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    input.goals.selectedGoals = [{
      type: 'HOUSING_STABILITY', priority: 1, constraintType: 'HARD',
    }];

    // 실제 평가기를 써야 unsupportedHardGoals가 채워진다.
    const result = new StrategyOptimizer(new LegacySimulationEngine()).optimize(
      input.profile,
      input.goals,
      input.strategy,
      { maxCandidates: 4 },
    );

    expect(result.debug.unsupportedHardGoals).toEqual(['HOUSING_STABILITY']);
  });

  // 예약 수(reservedPerPersona)가 사는 이유: 한 후보가 두 페르소나 조건을 동시에 만족하면
  // 앞 페르소나가 선점하므로, 뒤 페르소나에게 남길 대안이 shortlist에 있어야 한다.
  // 예약이 1이면 대안이 들어오지 못해 여유형이 통째로 비는 경우가 생긴다.
  test('페르소나가 후보를 선점해도 대안이 shortlist에 남아 3개를 채운다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    // 점수 순: filler들이 가장 높고, 그다음 dual, 마지막이 대안 front-loaded.
    const candidates = [
      ...Array.from({ length: 6 }, (_, i) =>
        candidate(input.strategy, `filler-${i}`, 60, { spendingPattern: 'FIXED' })),
      candidate(input.strategy, 'dual', 61, { spendingPattern: 'FRONT_LOADED' }),
      candidate(input.strategy, 'alt-front', 62, { spendingPattern: 'FRONT_LOADED' }),
    ];
    const order = new Map(candidates.map((item, index) => [item.id, 100 - index]));
    const generator = { generate: () => fakeGeneration(candidates) } as unknown as StrategyGenerator;
    const monteCarloEngine = {
      validate: (_p, _g, _s, config) => ({
        trials: config.trials, seed: config.seed,
        goalSuccessProbability: 0.8, spendingSuccessProbability: 0.8,
        assetSurvivalProbability: 0.8, terminalAssetMedian: 100,
        terminalAssetP10: 50, terminalAssetP90: 200, shortfallProbability: 0.2,
      }),
    } satisfies StrategyMonteCarloEngine;

    const result = new StrategyOptimizer(
      { simulate: () => simulation(100) },
      {
        evaluate: (_p, _g, strategy) => {
          const id = candidates.find((item) => item.strategy === strategy)!.id;
          return evaluation(order.get(id)!);
        },
      },
      generator,
      monteCarloEngine,
    ).optimize(input.profile, input.goals, input.strategy, {
      monteCarlo: { config: { trials: 10, seed: 1, annualStdDev: 15 }, shortlistLimit: 6 },
    });

    // dual이 안정형으로 선점되어도 alt-front가 여유형을 채워야 한다.
    expect(result.recommendations.recommendations.map((item) => item.label).sort())
      .toEqual(['균형형', '안정형', '여유형']);
  });

  test('사전 단계에서 모든 후보가 탈락하면 시뮬레이션 없이 그 사실을 보고한다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    input.goals.selectedGoals = [{
      type: 'EARLY_RETIREMENT', priority: 1, targetValue: 50, constraintType: 'HARD',
    }];
    const candidates = [candidate(input.strategy, 'a', 60), candidate(input.strategy, 'b', 61)];
    const generator = { generate: () => fakeGeneration(candidates) } as unknown as StrategyGenerator;
    const simulate = vi.fn(() => simulation(100));

    const result = new StrategyOptimizer(
      { simulate },
      { evaluate: () => evaluation(80) },
      generator,
    ).optimize(input.profile, input.goals, input.strategy);

    // 사전 탈락이므로 시뮬레이션은 한 번도 돌지 않아야 한다.
    expect(simulate).not.toHaveBeenCalled();
    expect(result.debug.hardConstraintRejectedCount).toBe(2);
    expect(result.outcome).toMatchObject({
      kind: 'no_candidate_survived',
      failedCount: 0,
      blockedBy: ['HARD_RETIREMENT_AGE'],
    });
  });

  test('0이나 음수 한도는 조용히 빈 결과를 만들지 않고 1개로 보정한다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    const candidates = [candidate(input.strategy, 'a', 60), candidate(input.strategy, 'b', 61)];
    const generator = { generate: () => fakeGeneration(candidates) } as unknown as StrategyGenerator;

    for (const rankingLimit of [0, -5]) {
      const result = new StrategyOptimizer(
        { simulate: () => simulation(100) },
        { evaluate: () => evaluation(80) },
        generator,
      ).optimize(input.profile, input.goals, input.strategy, { rankingLimit });

      // slice(0, 0)이 되어 "추천 없음"으로 보이면 안 된다.
      expect(result.rankedCandidates).toHaveLength(1);
      expect(result.outcome).toEqual({ kind: 'ok' });
    }
  });

  test('계획 종료보다 늦은 은퇴 나이여도 후보 0개로 무너지지 않는다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    input.strategy.retirementAge = 95;
    input.strategy.planHorizonAge = 90;

    const result = new StrategyOptimizer(new LegacySimulationEngine()).optimize(
      input.profile,
      input.goals,
      input.strategy,
      { maxCandidates: 6 },
    );

    // seed 은퇴 나이는 격자 밖이어도 보존되므로 후보는 존재해야 한다.
    expect(result.debug.generatedCandidateCount).toBeGreaterThan(0);
    expect(result.outcome.kind).not.toBe('no_candidate_generated');
  });

  test('목표를 상한(5개)보다 많이 넘겨도 엔진이 정상 동작한다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    input.goals.selectedGoals = [
      { type: 'LIVING_EXPENSE_STABILITY', priority: 1, constraintType: 'SOFT' },
      { type: 'ASSET_SURVIVAL', priority: 2, constraintType: 'SOFT' },
      { type: 'INHERITANCE', priority: 3, constraintType: 'SOFT' },
      { type: 'PENSION_OPTIMIZATION', priority: 4, constraintType: 'SOFT' },
      { type: 'TAX_OPTIMIZATION', priority: 5, constraintType: 'SOFT' },
      { type: 'RISK_REDUCTION', priority: 6, constraintType: 'SOFT' },
      { type: 'ASSET_GROWTH', priority: 7, constraintType: 'SOFT' },
    ];

    const result = new StrategyOptimizer(new LegacySimulationEngine()).optimize(
      input.profile,
      input.goals,
      input.strategy,
      { maxCandidates: 6 },
    );

    expect(result.rankedCandidates.length).toBeGreaterThan(0);
    const best = result.rankedCandidates[0].evaluation;
    expect(Number.isFinite(best.weightedScore)).toBe(true);
    expect(best.goalEvaluations.length).toBeGreaterThan(0);
  });
});

// **현상 유지 후보는 선별 단계에서 잘리지 않아야 한다.**
//
// 생성 단계는 같은 이유로 이미 그것을 보호한다(StrategyGenerator가 baseline을 격자보다 먼저
// 넣어 maxCandidates 상한에 잘리지 않게 한다). 선별 단계에는 그 보호가 없었다: accepted는
// 결정론 점수 순인데, 그 점수는 변동성을 보지 않아 「지금 계획」이 뒤로 밀릴 수 있다. 밀리면
// 몬테카를로를 받지 못하고, 그러면 균형형 슬롯에서 지금보다 나쁜 안이 이긴다 — 사용자가 이미
// 최선인 계획을 쓰고 있어도 화면은 바꾸라고 말한다.
describe('personaAwareShortlist — 현상 유지 보호', () => {
  const item = (id: string, allocation: 'CONSERVATIVE' | 'BALANCED' | 'GROWTH') => ({
    candidate: {
      id,
      dimensions: {
        retirementAge: 60,
        nationalPensionTiming: 'NORMAL' as const,
        nationalPensionStartAge: 65,
        withdrawalPolicy: 'GENERAL_FIRST' as const,
        spendingPattern: 'FIXED' as const,
        assetAllocation: allocation,
      },
    },
  } as unknown as Parameters<typeof personaAwareShortlist>[0][number]);

  // 결정론 점수 순으로 baseline이 한참 뒤에 있는 상황.
  const accepted = [
    ...Array.from({ length: 30 }, (_, i) => item(`grid-${i}`, 'GROWTH')),
    item('baseline', 'BALANCED'),
  ];

  test('결정론 순위가 낮아도 현상 유지는 선별에 남는다', () => {
    const shortlist = personaAwareShortlist(accepted, 12, 'baseline');

    expect(shortlist.map((i) => i.candidate.id)).toContain('baseline');
  });

  test('상한을 넘겨 담지 않는다', () => {
    expect(personaAwareShortlist(accepted, 12, 'baseline')).toHaveLength(12);
  });

  test('현상 유지가 accepted에 없으면 아무것도 바뀌지 않는다', () => {
    const withoutBaseline = accepted.filter((i) => i.candidate.id !== 'baseline');

    expect(personaAwareShortlist(withoutBaseline, 12, 'baseline'))
      .toEqual(personaAwareShortlist(withoutBaseline, 12, undefined));
  });
});
