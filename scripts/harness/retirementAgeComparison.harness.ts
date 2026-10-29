// 조사 전용: production 후보 생성기는 건드리지 않고 66~70세 대안을 추가한다.
import { test, expect } from 'vitest';
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

test('2·12·22번의 기존 격자와 은퇴 66~70세 추가 격자를 비교한다', { timeout: 600_000 }, () => {
  const scenarios = buildMassScenarios(22).filter((s) => s.no === 2 || s.no === 12 || s.no === 22);
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
    const baseline = run(new StrategyGenerator());
    const expanded = run(new ExpandedRetirementGenerator());
    expect(expanded.debug.generatedCandidateCount).toBeGreaterThan(baseline.debug.generatedCandidateCount);
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
        age: item.candidate.candidate.dimensions.retirementAge,
        goalProbability: item.candidate.monteCarlo.goalSuccessProbability,
      })),
      rejectionReasons: result.debug.rejectionReasons,
    });
    process.stdout.write(`${JSON.stringify({ scenario: scenario.no, seed: config.seed, trials: config.trials,
      baseline: summarize(baseline), expanded: summarize(expanded) })}\n`);
  }
});
