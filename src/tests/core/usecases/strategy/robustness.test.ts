import { describe, test, expect } from 'vitest';
import {
  isObjectivePresetConfig,
  maxNormalizedRegret,
  pickLowestRegret,
  pickMostRobust,
  resolveAssumptionVariants,
} from '@/core/usecases/strategy/robustness';
import { compileStrategy, DEFAULT_RETIREMENT_STRATEGY } from '@/core/usecases/strategy/compileStrategy';
import { recommendStrategy } from '@/core/usecases/strategy/RecommendationEngine';
import { OBJECTIVE_WEIGHT_PRESETS } from '@/core/usecases/strategy/objectivePresets';
import { createUtilityConfig, DEFAULT_UTILITY_CONFIG } from '@/core/usecases/utility/utilityWeights';
import { scoreUtilityRaws } from '@/core/usecases/utility/UtilityEngine';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { SimulationParams, UtilityRaws } from '@/core/entities/types';
import { allAxesLiveParams } from '@/tests/fixtures/allAxesLiveParams';

// **가정 축의 'ai_*'는 "값을 채워 달라"가 아니라 "이 차원이 미정임을 인정하라"는 뜻이다.**
//
// 리스크 성향과 경제 시나리오는 사용자의 가정이다. 미정이라고 AI가 임의의 값을 골라 채우면
// 화면은 「AI 추천」을 보여주는데 곡선은 누군가 몰래 고른 특정 국면 하나로 그려진다.
// 대신 상위 후보를 여러 국면에서 다시 평가해 **최악이 가장 나은** 계획을 고른다.

const raws = (overrides: Partial<UtilityRaws> = {}): UtilityRaws => ({
  consumption: 0.5,
  depletionSafety: 0.5,
  pensionUtilization: 0.5,
  taxEfficiency: 0.5,
  taxationRisk: 0.5,
  bequestAdequacy: 0.5,
  ...overrides,
});

describe('resolveAssumptionVariants', () => {
  test('두 가정 축이 모두 확정이면 국면이 없다 (강건성 모드 꺼짐)', () => {
    const params = compileStrategy({
      ...allAxesLiveParams,
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, riskProfile: 'neutral', economicScenario: 'recession' },
    }).params;

    expect(resolveAssumptionVariants(params)).toEqual([]);
  });

  test('경제 시나리오가 미정이면 네 국면을 만든다', () => {
    const params = compileStrategy({
      ...allAxesLiveParams,
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, riskProfile: 'neutral' },
    }).params;

    expect(resolveAssumptionVariants(params).map((v) => v.label)).toEqual([
      '경제:long_term_average', '경제:recession', '경제:high_inflation', '경제:low_growth',
    ]);
  });

  test('두 축이 모두 미정이면 곱집합이 아니라 합집합이다', () => {
    // 곱집합(4 × 3 = 12)은 상위 후보 수만큼 곱해져 비용이 빠르게 는다.
    const params = compileStrategy({ ...allAxesLiveParams, strategy: DEFAULT_RETIREMENT_STRATEGY }).params;

    expect(resolveAssumptionVariants(params)).toHaveLength(7);
  });

  test('국면은 사용자 params를 변형하지 않는다', () => {
    const params = compileStrategy({ ...allAxesLiveParams, strategy: DEFAULT_RETIREMENT_STRATEGY }).params;
    const before = JSON.stringify(params);

    for (const variant of resolveAssumptionVariants(params)) variant.apply(params);

    expect(JSON.stringify(params)).toBe(before);
  });
});

describe('pickMostRobust', () => {
  const variants = [
    { label: '호황', apply: (p: SimulationParams) => p },
    { label: '침체', apply: (p: SimulationParams) => p },
  ];

  test('평균이 아니라 최악이 가장 나은 후보를 고른다', () => {
    // A는 평균이 더 높지만 침체에서 무너진다. 강건성은 그 계획을 고르지 않는다.
    const scores: Record<string, number[]> = { A: [100, 10], B: [60, 55] };
    const winner = pickMostRobust(['A', 'B'], variants, (c, v) => scores[c][variants.indexOf(v)]);

    expect(winner).toBe('B');
  });

  test('일부 국면에서 계산에 실패한 후보는 탈락시킨다', () => {
    // "어떤 국면에서 무너지는지 모르는" 계획을 최악이 좋다고 말할 수는 없다.
    const winner = pickMostRobust(['A', 'B'], variants, (c, v) =>
      c === 'A' && v.label === '침체' ? null : 90
    );

    expect(winner).toBe('B');
  });

  test('국면이 없으면 아무것도 고르지 않는다', () => {
    expect(pickMostRobust(['A'], [], () => 1)).toBeNull();
  });
});

describe('maxNormalizedRegret / pickLowestRegret', () => {
  test('최고점과 같은 후보의 후회는 0이다', () => {
    const best = raws({ consumption: 1, depletionSafety: 1, pensionUtilization: 1, taxEfficiency: 1, taxationRisk: 1, bequestAdequacy: 1 });
    const worse = raws({ consumption: 0.1 });

    expect(maxNormalizedRegret(best, [best, worse])).toBe(0);
    expect(maxNormalizedRegret(worse, [best, worse])).toBeGreaterThan(0);
  });

  test('목표별 최솟값(min-over-objectives)과 다른 답을 낸다 — 반례', () => {
    // **이 테스트가 이 설계의 핵심 근거다.**
    //
    // 목표마다 도달 가능한 점수의 수준이 다르다. 예를 들어 상속 최대화는 bequestAdequacy에
    // 35점을 거는데 그 원점수는 현실 시나리오에서 흔히 0에 가깝다(적정선의 10배쯤 남기면
    // 종형 곡선이 포화한다). 그러면 **모든** 후보가 그 목표에서만 낮은 점수를 받는다.
    //
    // 목표별 최솟값으로 비교하면 그 "구조적으로 낮은 목표"가 순위를 지배한다 — 후보가
    // 어쩌지 못하는 축이 사실상 유일한 기준이 된다. 정규화된 후회는 각 목표를 그 목표의
    // 최고점 대비 상대 손실로 바꿔 이 수준 차이를 제거하고, "어느 목표를 골랐더라도 크게
    // 후회하지 않을 계획"을 고른다.
    //
    // sharp: 생활수준·고갈방지가 최고 수준이고 세금 축도 준수하다. 상속은 0.
    // flat:  모든 축이 중간이고 상속만 조금 낫다.
    const sharp = raws({
      consumption: 1, depletionSafety: 1, pensionUtilization: 0.5,
      taxEfficiency: 0.7, taxationRisk: 0.6, bequestAdequacy: 0,
    });
    const flat = raws({
      consumption: 0.6, depletionSafety: 0.6, pensionUtilization: 1,
      taxEfficiency: 1, taxationRisk: 1, bequestAdequacy: 0.3,
    });
    const all = [sharp, flat];

    // 최솟값 기준이라면 flat이 이긴다 — 상속 최대화 목표의 점수만으로 갈린다.
    const minOverObjectives = (r: UtilityRaws) =>
      Math.min(...Object.values(OBJECTIVE_WEIGHT_PRESETS).map((w) => scoreUtilityRaws(r, w).score));
    expect(minOverObjectives(flat)).toBeGreaterThan(minOverObjectives(sharp));

    // 정규화된 후회 기준이라면 sharp가 이긴다 — 세 목표에서 최고점이고 나머지에서도
    // 최고점 대비 손실이 작다.
    expect(maxNormalizedRegret(sharp, all)).toBeLessThan(maxNormalizedRegret(flat, all));
    expect(pickLowestRegret([{ raws: sharp }, { raws: flat }])?.raws).toBe(sharp);
  });

  test('후보가 하나면 그 후보를 돌려준다', () => {
    const only = { raws: raws() };
    expect(pickLowestRegret([only])).toBe(only);
  });

  test('후보가 없으면 null이다', () => {
    expect(pickLowestRegret([])).toBeNull();
  });
});

describe('isObjectivePresetConfig', () => {
  test('목표 프리셋 가중치는 참이다', () => {
    expect(isObjectivePresetConfig(DEFAULT_UTILITY_CONFIG)).toBe(true);
    const { weights: _w, ...rest } = DEFAULT_UTILITY_CONFIG;
    expect(isObjectivePresetConfig(createUtilityConfig(OBJECTIVE_WEIGHT_PRESETS.tax_minimization, rest))).toBe(true);
  });

  test('사용자 정의 가중치는 거짓이다', () => {
    // 후회 계산은 목표 프리셋 표 위에서만 의미가 있다.
    const { weights: _w, ...rest } = DEFAULT_UTILITY_CONFIG;
    const custom = createUtilityConfig(
      { consumption: 50, depletionSafety: 10, pensionUtilization: 10, taxEfficiency: 10, taxationRisk: 10, bequestAdequacy: 10 },
      rest
    );

    expect(isObjectivePresetConfig(custom)).toBe(false);
  });
});

describe('recommendStrategy 통합 — 강건성 모드', () => {
  test('사용자가 입력한 물가·수익률을 덮어쓰지 않는다', () => {
    // 강건성 모드는 "어느 계획을 추천하는가"만 바꾼다. 국면 params는 평가에만 쓰고 버린다.
    const engine = new SimulationEngine();
    const compiled = compileStrategy({ ...allAxesLiveParams, strategy: DEFAULT_RETIREMENT_STRATEGY });
    const before = JSON.stringify(compiled.params);

    recommendStrategy(compiled.params, engine, compiled.utilityConfig);

    expect(JSON.stringify(compiled.params)).toBe(before);
  });

  test('추천 결과는 언제나 사용자 가정으로 계산한 값이다', () => {
    // 국면 평가 점수가 결과에 새어 나오면, 화면에 보이는 곡선과 점수가 사용자가 한 번도
    // 동의한 적 없는 미래의 것이 된다.
    const engine = new SimulationEngine();
    const compiled = compileStrategy({ ...allAxesLiveParams, strategy: DEFAULT_RETIREMENT_STRATEGY });
    const recommendation = recommendStrategy(compiled.params, engine, compiled.utilityConfig);

    // 추천이 실제로 쓴 params를 그대로 다시 돌린다.
    //
    // 예전에는 recommendedPlan으로 params를 손수 재조립해 비교했는데, 그 재현은 단계가 늘 때마다
    // 깨졌다 — Phase 3(자산별 배당 재투자)를 빠뜨려 한 번, Phase 4-B(신규 연금 납입)를 빠뜨려
    // 또 한 번. 게다가 «재현이 틀린 것»과 «국면이 새어 나온 것»을 구분할 수 없어서, 깨질 때마다
    // 진짜 결함인지 재현 누락인지 다시 조사해야 했다. 조합 자체를 받아 오면 그 모호함이 사라진다.
    const reproduced = engine.runForUtility(recommendation.recommendedParams);
    expect(recommendation.recommendedResult.endingAssets).toBeCloseTo(reproduced.endingAssets, 6);

    // 그 params가 «사용자의» 가정 위에 서 있는지도 함께 본다. 강건성 재평가가 만든 국면
    // params(수익률·물가를 바꾼 것)가 새어 나오면 이 단언이 깨진다 — 위의 동일성만으로는
    // 국면 params를 그대로 돌려줘도 통과하기 때문이다.
    expect(recommendation.recommendedParams.inflationRate).toBe(compiled.params.inflationRate);
    expect(recommendation.recommendedParams.yieldPreset).toBe(compiled.params.yieldPreset);
    expect(recommendation.recommendedParams.assets.map((asset) => asset.annualGrowthRate))
      .toEqual(compiled.params.assets.map((asset) => asset.annualGrowthRate));
  });

  test('가정 축을 확정하면 강건성 재평가가 일어나지 않는다', () => {
    // 사용자가 국면을 직접 골랐으면 그 국면만이 진실이다. 다른 국면으로 재평가하는 것은
    // 사용자의 명시적 선택을 무시하는 것이다.
    const engine = new SimulationEngine();
    const fixed = compileStrategy({
      ...allAxesLiveParams,
      strategy: {
        ...DEFAULT_RETIREMENT_STRATEGY,
        riskProfile: 'neutral', economicScenario: 'recession', objective: 'lifetime_spending',
      },
    });

    expect(resolveAssumptionVariants(fixed.params)).toEqual([]);

    const recommendation = recommendStrategy(fixed.params, engine, fixed.utilityConfig);
    // 재평가가 없으므로 추천안은 순수 argmax다 — 최고점 후보가 그대로 남는다.
    expect(recommendation.recommendedUtility.score).toBeGreaterThanOrEqual(recommendation.currentUtility.score);
  });
});
