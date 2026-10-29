// 조사 전용: production 후보 생성기는 건드리지 않고 66~70세 대안을 추가한다.
import { test, expect } from 'vitest';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { buildMassScenarios } from './massScenarios';
import { StrategyGenerator } from '@/core/strategy/StrategyGenerator';
import { StrategyOptimizer } from '@/core/strategy/StrategyOptimizer';
import { LegacySimulationAdapter } from '@/core/domain/input/LegacySimulationAdapter';
import { LegacySimulationEngine } from '@/core/simulation/LegacySimulationEngine';
import { LegacyRecommendationEngine } from '@/core/recommendation/LegacyRecommendationEngine';
import { compileStrategy } from '@/core/usecases/strategy/compileStrategy';
import { applyAiSentinels } from '@/core/usecases/strategy/applyAiSentinels';
import { MonteCarloEngine } from '@/core/usecases/montecarlo/MonteCarloEngine';
import { resolveMonteCarloConfig } from '@/core/usecases/montecarlo/volatilityPresets';

class ExpandedRetirementGenerator extends StrategyGenerator {
  override generate(...args: Parameters<StrategyGenerator['generate']>): ReturnType<StrategyGenerator['generate']> {
    const [profile, , seed] = args;
    const generated = super.generate(...args);
    const currentAges = new Set(generated.candidates.map((c) => c.dimensions.retirementAge));
    // 65세 후보의 나머지 축과 전략을 그대로 유지한다. baseline은 격자 후보가 아니므로 제외한다.
    const templates = generated.candidates.filter((c) => c.dimensions.retirementAge === 65 && c.id.startsWith('retire-'));
    const additions = [];
    for (const age of [66, 67, 68, 69, 70]) {
      if (currentAges.has(age) || age < profile.personal.currentAge || age > seed.planHorizonAge) continue;
      for (const candidate of templates) {
        additions.push({
          ...candidate,
          id: `experimental-${age}-${candidate.id}`,
          dimensions: { ...candidate.dimensions, retirementAge: age },
          strategy: { ...candidate.strategy, retirementAge: age },
        });
      }
    }
    return { ...generated, candidates: [...generated.candidates, ...additions], debug: {
      ...generated.debug,
      generatedCandidateCount: generated.candidates.length + additions.length,
    } };
  }
}

test('기존 격자와 은퇴 66~70세 추가 격자를 비교한다', { timeout: 3_600_000 }, () => {
  const count = process.env.COMPARISON_COUNT ? Number(process.env.COMPARISON_COUNT) : 22;
  const shardCount = Number(process.env.COMPARISON_SHARDS ?? 1);
  const shardIndex = Number(process.env.COMPARISON_SHARD ?? 0);
  if (!Number.isInteger(count) || count < 1 || !Number.isInteger(shardCount) || shardCount < 1
    || !Number.isInteger(shardIndex) || shardIndex < 0 || shardIndex >= shardCount) {
    throw new Error('표본 수와 샤드 번호를 확인하세요.');
  }
  const scenarios = buildMassScenarios(count).filter((s) =>
    (process.env.COMPARISON_COUNT ? true : [2, 12, 22].includes(s.no))
    && (s.no - 1) % shardCount === shardIndex);
  const outputDir = process.env.COMPARISON_OUT;
  if (outputDir) {
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(join(outputDir, `shard-${shardIndex}.jsonl`), '', { flag: 'wx' });
  }
  const engine = new LegacySimulationEngine();
  const legacy = new LegacyRecommendationEngine(engine);
  for (const scenario of scenarios) {
    const compiled = compileStrategy(scenario.params);
    const recommendation = legacy.recommendLegacyConfig(compiled.params, compiled.utilityConfig);
    const effective = applyAiSentinels(compiled, recommendation).compiled.params;
    const input = LegacySimulationAdapter.fromLegacy(effective);
    const config = resolveMonteCarloConfig(effective);
    const run = (generator: StrategyGenerator) => new StrategyOptimizer(
      engine, undefined, generator, new MonteCarloEngine(engine),
    ).optimize(input.profile, input.goals, input.strategy, {
      monteCarlo: { config, finalistLimit: 3 },
    });
    const timedRun = (generator: StrategyGenerator) => {
      const started = performance.now();
      const result = run(generator);
      return { result, durationMs: Math.round(performance.now() - started), rssAfterBytes: process.memoryUsage().rss };
    };
    const original = timedRun(new StrategyGenerator());
    const extended = timedRun(new ExpandedRetirementGenerator());
    const baseline = original.result;
    const expanded = extended.result;
    expect(expanded.debug.generatedCandidateCount).toBeGreaterThanOrEqual(baseline.debug.generatedCandidateCount);
    expect(expanded.debug.generation.baselineCandidateId).toBe(baseline.debug.generation.baselineCandidateId);
    const summarize = (result: typeof baseline) => ({
      outcome: result.outcome.kind,
      generated: result.debug.generatedCandidateCount,
      preRejected: result.debug.hardConstraintRejectedCount,
      postRejected: result.debug.postSimulationRejectedCount,
      accepted: result.debug.acceptedCandidateCount,
      failures: result.debug.failedCandidateCount,
      duplicateOutcomes: result.debug.duplicateOutcomeCount,
      shortlisted: result.debug.deterministicShortlistCount,
      mcValidated: result.debug.monteCarloValidatedCount,
      mcConfirmed: result.debug.monteCarloConfirmedCount,
      recommendations: result.recommendations.recommendations.map((item) => ({
        persona: item.persona,
        age: item.candidate.candidate.dimensions.retirementAge,
        goalProbability: item.candidate.monteCarlo.goalSuccessProbability,
        missedGoals: item.candidate.evaluation.goalEvaluations.filter((goal) => !goal.achieved).map((goal) => goal.goalType),
        primary: item.candidate.candidate.id === result.recommendations.primary?.candidate.candidate.id,
      })),
      rejectionReasons: result.debug.rejectionReasons,
    });
    const row = { scenario: scenario.no, currentAge: scenario.meta.currentAge,
      goals: scenario.params.retirementGoals ?? [], seed: config.seed, trials: config.trials,
      baseline: { ...summarize(baseline), durationMs: original.durationMs, rssAfterBytes: original.rssAfterBytes },
      expanded: { ...summarize(expanded), durationMs: extended.durationMs, rssAfterBytes: extended.rssAfterBytes } };
    const line = `${JSON.stringify(row)}\n`;
    if (outputDir) appendFileSync(join(outputDir, `shard-${shardIndex}.jsonl`), line);
    else process.stdout.write(line);
  }
});
