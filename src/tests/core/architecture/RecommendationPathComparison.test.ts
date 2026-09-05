import { describe, expect, test } from 'vitest';
import auditCase from '@/tests/fixtures/auditReportCase.json';
import { LegacyRecommendationEngine } from '@/core/recommendation/LegacyRecommendationEngine';
import { LegacySimulationAdapter } from '@/core/domain/input/LegacySimulationAdapter';
import { LegacySimulationEngine } from '@/core/simulation/LegacySimulationEngine';
import { MonteCarloEngine } from '@/core/usecases/montecarlo/MonteCarloEngine';
import { resolveMonteCarloConfig } from '@/core/usecases/montecarlo/volatilityPresets';
import { StrategyOptimizer } from '@/core/strategy/StrategyOptimizer';
import { normalizeSimulationParams } from '@/infrastructure/storage/normalizeSimulationParams';

describe('추천 경로 경계', () => {
  test('같은 입력에서 legacy 자동 반영 추천과 목표 기반 추천을 서로 섞지 않는다', () => {
    const params = normalizeSimulationParams((auditCase as { params: unknown }).params);
    const engine = new LegacySimulationEngine();
    const legacy = new LegacyRecommendationEngine(engine).recommendLegacyConfig(params);
    const input = LegacySimulationAdapter.fromLegacy(params);
    const optimized = new StrategyOptimizer(engine, undefined, undefined, new MonteCarloEngine(engine))
      .optimize(input.profile, input.goals, input.strategy, {
        monteCarlo: { config: { ...resolveMonteCarloConfig(params), trials: 20 }, screeningTrials: 10 },
      });

    // legacy 결과는 기존 자동 sentinel이 소비하는 Utility 계약이다.
    expect(legacy).toHaveProperty('improved');
    expect(legacy).toHaveProperty('currentUtility');

    // optimizer 결과는 카드/PDF가 소비하는 목표 기반 계약이다.
    expect(optimized).toHaveProperty('recommendations.recommendations');
    expect(optimized).toHaveProperty('baselineOutcome');

    // 두 경로의 결과 객체를 하나의 추천으로 간주하지 않는다.
    expect(legacy).not.toHaveProperty('recommendations');
    expect(optimized).not.toHaveProperty('currentUtility');

    // 비교 픽스처의 목적은 두 경로가 우연히 같은 후보 공간을 쓰지 않는지도 감시하는 것이다.
    // legacy는 인출계획만 자동 반영하고 은퇴 나이를 후보 축으로 만들지 않지만, optimizer는
    // 은퇴 나이를 포함한 네 축을 생성한다. 이 경계가 사라지면 한쪽 경로가 조용히 바뀐 것이다.
    expect(legacy.recommendedPlan).not.toHaveProperty('retirementAge');
    expect(optimized.rankedCandidates.length).toBeGreaterThan(0);
    expect(optimized.rankedCandidates.some((item) => item.candidate.dimensions.retirementAge !== undefined)).toBe(true);

    // baselineOutcome은 현상 유지 후보가 사전 HARD 필터를 통과한 경우에만 존재한다.
    // 이 픽스처에서는 존재 여부 자체보다 optimizer 결과에 legacy Utility 기준선이 섞이지
    // 않는다는 계약을 확인한다.
    expect(optimized.recommendations.recommendations.every((item) => item.candidate.outcome !== undefined)).toBe(true);

    const signature = {
      legacy: {
        improved: legacy.improved,
        hasRecommendedPlan: legacy.recommendedPlan !== null,
        reinvestmentKeys: Object.keys(legacy.verifiedAssetReinvestment ?? {}).sort(),
      },
      optimizer: {
        rankedCandidateCount: optimized.rankedCandidates.length,
        recommendationLabels: optimized.recommendations.recommendations.map((item) => item.label),
        recommendationAxes: optimized.recommendations.recommendations.map(
          (item) => item.candidate.candidate.dimensions,
        ),
      },
    };

    expect(signature).toMatchInlineSnapshot(`
      {
        "legacy": {
          "hasRecommendedPlan": true,
          "improved": true,
          "reinvestmentKeys": [],
        },
        "optimizer": {
          "rankedCandidateCount": 3,
          "recommendationAxes": [
            {
              "nationalPensionStartAge": 70,
              "nationalPensionTiming": "DEFERRED",
              "retirementAge": 60,
              "spendingPattern": "FRONT_LOADED",
              "withdrawalPolicy": "PENSION_FIRST",
            },
            {
              "nationalPensionStartAge": 70,
              "nationalPensionTiming": "DEFERRED",
              "retirementAge": 60,
              "spendingPattern": "FRONT_LOADED",
              "withdrawalPolicy": "GENERAL_FIRST",
            },
            {
              "nationalPensionStartAge": 65,
              "nationalPensionTiming": "NORMAL",
              "retirementAge": 60,
              "spendingPattern": "FRONT_LOADED",
              "withdrawalPolicy": "PENSION_FIRST",
            },
          ],
          "recommendationLabels": [
            "안정형",
            "균형형",
            "여유형",
          ],
        },
      }
    `);
  });
});
