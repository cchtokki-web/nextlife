import { describe, expect, test } from 'vitest';
import { LegacySimulationAdapter } from '@/core/domain/input/LegacySimulationAdapter';
import { LegacySimulationEngine } from '@/core/simulation/LegacySimulationEngine';
import { StrategyOptimizer } from '@/core/strategy/StrategyOptimizer';
import { MonteCarloEngine } from '@/core/usecases/montecarlo/MonteCarloEngine';
import { resolveMonteCarloConfig } from '@/core/usecases/montecarlo/volatilityPresets';
import { getNationalPensionAdjustmentFactor } from '@/core/usecases/pension/nationalPensionRules';
import { normalizeSimulationParams } from '@/infrastructure/storage/normalizeSimulationParams';
import auditCase from '@/tests/fixtures/auditReportCase.json';

/**
 * 추천 카드가 「국민연금 65세 → 60세」 같은 «축»만이 아니라 그 축이 만든 «금액»을 말할 수
 * 있으려면, 후보마다 시뮬레이션된 원장 요약이 실제로 실려 나와야 한다.
 *
 * 여기서 고정하는 것은 세 가지다.
 *   1. 현상 유지(현재 계획) 후보의 요약이 결과에 실린다 — 비교의 「전」이다.
 *   2. 추천된 후보마다 자기 요약을 들고 있다 — 비교의 「후」다.
 *   3. 두 요약은 «같은 경로»(SimulationEngine.simulate)에서 나온다. 화면이 들고 있는 현재
 *      계획 실행 결과를 「전」으로 쓰면, 아무것도 바꾸지 않는 후보에도 0이 아닌 차이가 찍힌다.
 */
describe('StrategyOptimizer가 내는 계획 요약', () => {
  function optimize() {
    const params = normalizeSimulationParams((auditCase as { params: unknown }).params);
    const engine = new LegacySimulationEngine();
    const input = LegacySimulationAdapter.fromLegacy(params);
    const result = new StrategyOptimizer(engine, undefined, undefined, new MonteCarloEngine(engine))
      .optimize(input.profile, input.goals, input.strategy, {
        // 시행 수는 이 테스트의 주제가 아니다. 요약은 결정론 원장에서 나오므로 시행 수와 무관하다.
        monteCarlo: { config: { ...resolveMonteCarloConfig(params), trials: 40 }, screeningTrials: 20 },
      });
    return { params, result };
  }

  test('현상 유지 후보와 추천 후보가 모두 자기 요약을 들고 나온다', () => {
    const { result } = optimize();

    expect(result.baselineOutcome).toBeDefined();
    expect(result.recommendations.recommendations.length).toBeGreaterThan(0);
    for (const recommendation of result.recommendations.recommendations) {
      expect(recommendation.candidate.outcome).toBeDefined();
    }
  });

  test('국민연금 개시 나이를 옮긴 후보의 요약에 감액·가산이 반영된다', () => {
    const { result } = optimize();
    const baselineAge = result.baselineOutcome?.nationalPensionFirstAge;
    expect(baselineAge).not.toBeNull();

    const moved = result.recommendations.recommendations
      .map((recommendation) => recommendation.candidate)
      .filter((candidate) => candidate.outcome?.nationalPensionFirstAge !== baselineAge);
    // 이 시나리오에서 개시 나이 축이 실제로 움직이는지부터 확인한다. 움직이지 않으면
    // 아래 비교는 아무것도 재지 못한 채 통과한다.
    expect(moved.length).toBeGreaterThan(0);

    for (const candidate of moved) {
      const outcome = candidate.outcome!;
      const factorRatio = getNationalPensionAdjustmentFactor(outcome.nationalPensionFirstAge!)
        / getNationalPensionAdjustmentFactor(baselineAge!);
      const monthlyRatio = outcome.nationalPensionMonthlyNet!
        / result.baselineOutcome!.nationalPensionMonthlyNet!;

      // 세후 금액이라 비율이 계수와 정확히 같지는 않다(누진세율). 방향과 크기만 본다 —
      // 예전처럼 65세 기준 금액을 그대로 쓰면 이 비율이 1에 붙는다.
      expect(factorRatio > 1 ? monthlyRatio > 1.05 : monthlyRatio < 0.95).toBe(true);
    }
  });
});
