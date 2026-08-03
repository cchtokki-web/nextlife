import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import {
  computeLifetimeUtility,
  computeUtilityRaws,
  scoreUtilityRaws,
  UTILITY_AXES,
} from '@/core/usecases/utility/UtilityEngine';
import { DEFAULT_UTILITY_CONFIG, createUtilityConfig } from '@/core/usecases/utility/utilityWeights';
import { OBJECTIVE_WEIGHT_PRESETS } from '@/core/usecases/strategy/objectivePresets';
import { ObjectivePriority, SimulationParams, SimulationResult } from '@/core/entities/types';
import { allAxesLiveParams } from '@/tests/fixtures/allAxesLiveParams';

// **원점수(raw)와 채점(score)의 분리.**
//
// 6개 축의 raw 값은 UtilityConfig의 weights와 무관하다 — weights는 마지막에 곱해질 뿐이고,
// 나머지 설정(taxBurdenCeiling 등)은 OBJECTIVE_WEIGHT_PRESETS가 건드리지 않는다
// (compileStrategy가 UTILITY_CONFIG_REST로 고정한다).
//
// 그래서 raw 6개만 보관하면 **같은 시뮬레이션 결과를 5개 목표 전부로 채점**할 수 있다.
// 지금까지 그게 불가능했던 이유는 components가 이미 Math.round(raw × weight)라서
// weight를 되돌릴 수 없었기 때문이다(round 때문에 나눠도 원본이 복원되지 않는다).
//
// 이 분리가 "목표 우선순위 축 살리기"와 "강건성 모드"의 지렛대다. 둘 다 한 결과를
// 여러 채점 기준으로 비교해야 하는데, 그때마다 재시뮬레이션을 하면 비용이 곱해진다.

const OBJECTIVES = Object.keys(OBJECTIVE_WEIGHT_PRESETS) as ObjectivePriority[];

// compileStrategy와 동일한 조립 방식 — weights만 목표별로 갈리고 나머지는 기본값 고정.
const { weights: _defaultWeights, ...UTILITY_CONFIG_REST } = DEFAULT_UTILITY_CONFIG;
const configForObjective = (objective: ObjectivePriority) =>
  createUtilityConfig(OBJECTIVE_WEIGHT_PRESETS[objective], UTILITY_CONFIG_REST);

// 축마다 서로 다른 raw 값이 나오도록 조건을 흩뜨린 매트릭스.
// 한 시나리오만 쓰면 "우연히 0이거나 1인 축"에서 등가성이 성립해도 알 수 없다.
const SCENARIOS: ReadonlyArray<{ name: string; params: SimulationParams }> = [
  { name: '모든 축이 살아 있는 기준 시나리오', params: allAxesLiveParams },
  {
    name: '자산 고갈 (생활비 과다)',
    params: {
      ...allAxesLiveParams,
      userProfile: { ...allAxesLiveParams.userProfile, targetMonthlySpending: 15000000 },
    },
  },
  {
    name: '연금 없음 (연금 활용도 축이 바닥)',
    params: {
      ...allAxesLiveParams,
      privatePensions: [],
      nationalPension: { expectedMonthlyAmount: 0 },
    },
  },
  {
    name: '상속 목표 지정',
    params: {
      ...allAxesLiveParams,
      userProfile: { ...allAxesLiveParams.userProfile, targetBequest: 500000000 },
    },
  },
  {
    name: '다 쓰고 가기 (targetBequest 0)',
    params: {
      ...allAxesLiveParams,
      userProfile: { ...allAxesLiveParams.userProfile, targetBequest: 0 },
    },
  },
];

function runScenario(params: SimulationParams): SimulationResult {
  return new SimulationEngine().runForUtility(params);
}

describe('computeUtilityRaws / scoreUtilityRaws', () => {
  test.each(SCENARIOS)('$name: raw를 채점하면 computeLifetimeUtility와 완전히 같다', ({ params }) => {
    const result = runScenario(params);

    const direct = computeLifetimeUtility(result, params, DEFAULT_UTILITY_CONFIG);
    const viaRaws = scoreUtilityRaws(
      computeUtilityRaws(result, params, DEFAULT_UTILITY_CONFIG),
      DEFAULT_UTILITY_CONFIG.weights
    );

    expect(viaRaws).toEqual(direct);
  });

  test.each(SCENARIOS)('$name: raw는 전부 0~1 범위다', ({ params }) => {
    const raws = computeUtilityRaws(runScenario(params), params, DEFAULT_UTILITY_CONFIG);

    for (const axis of UTILITY_AXES) {
      expect(raws[axis], `${axis} raw가 0~1을 벗어났다: ${raws[axis]}`).toBeGreaterThanOrEqual(0);
      expect(raws[axis]).toBeLessThanOrEqual(1);
    }
  });

  test('목표를 바꿔도 raw는 같고 점수만 달라진다', () => {
    const params = allAxesLiveParams;
    const result = runScenario(params);

    const rawsPerObjective = OBJECTIVES.map((objective) => {
      const cfg = configForObjective(objective);
      return {
        objective,
        raws: computeUtilityRaws(result, params, cfg),
        score: computeLifetimeUtility(result, params, cfg).score,
      };
    });

    // raw는 목표와 무관 — 이것이 "재시뮬 없는 다목표 채점"의 근거다.
    for (const entry of rawsPerObjective) {
      expect(entry.raws, `${entry.objective}의 raw가 기준과 다르다`).toEqual(rawsPerObjective[0].raws);
    }

    // 그런데 점수는 달라야 한다. 같으면 이 분리가 아무 정보도 담지 못한다는 뜻이다.
    expect(new Set(rawsPerObjective.map((e) => e.score)).size).toBeGreaterThan(1);
  });

  test('한 번 계산한 raw로 다른 목표의 점수를 재시뮬 없이 재현한다', () => {
    const params = allAxesLiveParams;
    const result = runScenario(params);
    const raws = computeUtilityRaws(result, params, DEFAULT_UTILITY_CONFIG);

    for (const objective of OBJECTIVES) {
      const cfg = configForObjective(objective);

      expect(scoreUtilityRaws(raws, cfg.weights), `${objective}의 재채점이 어긋난다`).toEqual(
        computeLifetimeUtility(result, params, cfg)
      );
    }
  });

  test('연도별 결과가 비어 있으면 raw는 전부 0이다', () => {
    const empty = { ...runScenario(allAxesLiveParams), yearlyResults: [] };
    const raws = computeUtilityRaws(empty, allAxesLiveParams, DEFAULT_UTILITY_CONFIG);

    for (const axis of UTILITY_AXES) {
      expect(raws[axis]).toBe(0);
    }
    expect(scoreUtilityRaws(raws, DEFAULT_UTILITY_CONFIG.weights).score).toBe(0);
  });
});
