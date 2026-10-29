// 조사 전용: 후보 ID를 유지한 채 순서·상한·선별 수의 영향을 대조한다.
import { expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
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

type Order = 'natural' | 'reversed';
class ControlledGenerator extends StrategyGenerator {
  ids: string[] = [];
  dropped = 0;
  constructor(private readonly order: Order, private readonly limit: number) { super(); }

  override generate(...args: Parameters<StrategyGenerator['generate']>): ReturnType<StrategyGenerator['generate']> {
    const [profile, goals, seed] = args;
    // 원본 격자는 기본 상한으로 생성하고, 확장과 조사 전용 상한은 이 아래에서만 적용한다.
    const base = super.generate(profile, goals, seed, { maxCandidates: 1000 });
    if (base.debug.cappedCandidateCount !== 0) throw new Error('기존 격자가 상한에 잘려 실험할 수 없습니다.');
    const baseline = base.candidates.find((c) => c.id === base.debug.baselineCandidateId);
    if (!baseline) throw new Error('현상 유지 후보가 없습니다.');
    const ages = new Set(base.candidates.map((c) => c.dimensions.retirementAge));
    const templates = base.candidates.filter((c) => c.dimensions.retirementAge === 65 && c.id.startsWith('retire-'));
    const additions = [66, 67, 68, 69, 70].filter((age) => !ages.has(age)
      && age >= profile.personal.currentAge && age <= seed.planHorizonAge).flatMap((age) => templates.map((c) => ({
        ...c, id: c.id.replace(/^retire-65\|/, `retire-${age}|`),
        dimensions: { ...c.dimensions, retirementAge: age },
        strategy: { ...c.strategy, retirementAge: age },
      })));
    const other = [...base.candidates.filter((c) => c.id !== baseline.id), ...additions];
    if (this.order === 'reversed') other.reverse();
    const all = [baseline, ...other];
    if (new Set(all.map((c) => c.id)).size !== all.length) throw new Error('중복 후보 ID');
    const candidates = all.slice(0, this.limit);
    this.ids = candidates.map((c) => c.id);
    this.dropped = all.length - candidates.length;
    return { ...base, candidates, debug: { ...base.debug, generatedCandidateCount: candidates.length,
      cappedCandidateCount: this.dropped } };
  }
}

test('같은 후보 ID에서 순서·상한·선별 수를 대조한다', { timeout: 600_000 }, () => {
  const scenarioNo = Number(process.env.CONTROL_CASE ?? 2);
  const scenario = buildMassScenarios(scenarioNo).find((s) => s.no === scenarioNo);
  if (!Number.isInteger(scenarioNo) || scenarioNo < 1 || !scenario) throw new Error('시나리오 번호 오류');
  const engine = new LegacySimulationEngine();
  const compiled = compileStrategy(scenario.params);
  const legacy = new LegacyRecommendationEngine(engine).recommendLegacyConfig(compiled.params, compiled.utilityConfig);
  const effective = applyAiSentinels(compiled, legacy).compiled.params;
  const input = LegacySimulationAdapter.fromLegacy(effective);
  const config = resolveMonteCarloConfig(effective);
  const rows = [];
  for (const cap of [60, 1000]) {
    for (const order of ['natural', 'reversed'] as const) {
      for (const shortlistLimit of [12, 24]) {
        const generator = new ControlledGenerator(order, cap);
        const started = performance.now();
        const result = new StrategyOptimizer(engine, undefined, generator, new MonteCarloEngine(engine))
          .optimize(input.profile, input.goals, input.strategy, { monteCarlo: { config, shortlistLimit, finalistLimit: 3 } });
        const primary = result.recommendations.primary;
        rows.push({ cap, order, shortlistLimit, elapsedMs: Math.round(performance.now() - started),
          generated: generator.ids.length, dropped: generator.dropped,
          idSet: createHash('sha256').update([...generator.ids].sort().join('\n')).digest('hex'),
          outcome: result.outcome.kind, accepted: result.debug.acceptedCandidateCount,
          duplicate: result.debug.duplicateOutcomeCount, shortlisted: result.debug.deterministicShortlistCount,
          failed: result.debug.failedCandidateCount, mcFailures: result.debug.monteCarloFailures.length,
          primary: primary ? { id: primary.candidate.candidate.id, age: primary.candidate.candidate.dimensions.retirementAge,
            probability: primary.candidate.monteCarlo.goalSuccessProbability,
            missed: primary.candidate.evaluation.goalEvaluations.filter((g) => !g.achieved).map((g) => g.goalType) } : null,
          recommendationIds: result.recommendations.recommendations.map((x) => x.candidate.candidate.id),
          baselineId: result.debug.generation.baselineCandidateId,
        });
        expect(generator.ids).toContain(result.debug.generation.baselineCandidateId);
      }
    }
  }
  const full = rows.filter((r) => r.cap === 1000);
  expect(new Set(full.map((r) => r.idSet)).size).toBe(1);
  const output = { scenario: scenarioNo, goals: scenario.params.retirementGoals, seed: config.seed, trials: config.trials, rows };
  if (process.env.CONTROL_OUT) {
    mkdirSync(process.env.CONTROL_OUT, { recursive: true });
    writeFileSync(join(process.env.CONTROL_OUT, `case-${scenarioNo}.json`), JSON.stringify(output, null, 2), { flag: 'wx' });
  } else process.stdout.write(`${JSON.stringify(output)}\n`);
});
