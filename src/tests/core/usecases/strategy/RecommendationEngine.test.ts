import { describe, test, expect, vi } from 'vitest';
import { makeYearlyResult as makeYearlyResultFixture } from '@/tests/fixtures/yearlyResult';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import {
  recommendStrategy,
  buildReasons,
  computeDeltas,
  computeItemizedContributions,
} from '@/core/usecases/strategy/RecommendationEngine';
import {
  generateCandidatePlans,
  generateSpendingAdjustmentCandidates,
  getIdentityPlan,
} from '@/core/usecases/strategy/StrategyCandidateGenerator';
import { paramsWithSentinelOverlay } from '@/core/usecases/strategy/verifiedSentinelPlan';
import { compileStrategy, DEFAULT_RETIREMENT_STRATEGY } from '@/core/usecases/strategy/compileStrategy';
import { resolvePlanAssetStatus } from '@/core/usecases/dashboard/resolvePlanAssetStatus';
import { estimateSuccessRate } from '@/core/usecases/montecarlo/MonteCarloEngine';
import { resolveMonteCarloConfig } from '@/core/usecases/montecarlo/volatilityPresets';
import { computeLifetimeUtility } from '@/core/usecases/utility/UtilityEngine';
import { DEFAULT_UTILITY_CONFIG } from '@/core/usecases/utility/utilityWeights';
import {
  AssetSellOrderStrategy,
  CompleteWithdrawalPlan,
  IsaMaturityDestination,
  SimulationParams,
  StrategyRecommendation,
  SimulationResult,
  SimulationYearlyResult,
  UtilityBreakdown,
  WithdrawalPlan,
} from '@/core/entities/types';

const zeroDeltas: StrategyRecommendation['deltas'] = {
  lifetimeConsumption: 0,
  totalTax: 0,
  endingAssets: 0,
  pensionEndingBalance: 0,
  comprehensiveTaxYears: 0,
  healthInsuranceTotal: 0,
  nationalPensionTotal: 0,
};

// 사적연금 잔액이 매우 커서(6억) 균등분할 인출 시 사망 시점까지 상당액이 남는,
// 즉 최적화 여지가 뚜렷한 시나리오
const paramsWithLargePension: SimulationParams = {
  userProfile: {
    currentAge: 60,
    retirementAge: 60,
    expectancy: 90,
    targetMonthlySpending: 2000000,
  },
  assets: [],
  nationalPension: { expectedMonthlyAmount: 1000000 },
  privatePensions: [
    {
      id: 'pension-1',
      type: 'irp',
      balance: 600000000,
      monthlyContribution: 0,
      annualReturn: 4,
      currency: 'KRW',
    },
  ],
  otherIncomes: [],
  inflationRate: 0,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

// paramsWithLargePension + 일반자산 3천만원.
//
// "개선안이 존재할 때"의 동작(recommendedResult / itemizedContributions /
// nationalPensionOnlyUtility)을 검증하는 테스트 전용 픽스처다. 일반자산이 없으면
// improved가 false가 되어 그 테스트들이 성립하지 않는다.
//
// 이유: 연말 정산 세금(종합과세·건보료)은 일반자산 → 사적연금 순으로 징수되는데
// (SimulationEngine.collectTax), 일반자산이 없으면 그 세금이 곧바로 연금 잔액을 갉아먹는다.
// 그러면 "연금을 더 빼서 쓴다"는 후보의 이득이 늘어난 건보료에 상쇄되어 격자 탐색이
// baseline을 이기지 못한다. 예전에는 이 세금이 일반자산에서만 징수되고 남은 금액은 그냥
// 버려졌기 때문에(= 자산 0이면 전액 증발) 자산 없이도 개선안이 나왔다.
//
// paramsWithLargePension 자체에 자산을 넣지 않는 이유: 그 픽스처는
// "privatePensions/nationalPension을 비우면 탐색 차원이 하나도 없다"를 검증하는 테스트들의
// 기반이기도 한데, 일반자산이 하나라도 있으면 매도순서·인출개시나이 차원이 살아나 그 전제가 깨진다.
const paramsWithOptimizableHeadroom: SimulationParams = {
  ...paramsWithLargePension,
  assets: [
    {
      id: 'general-asset',
      type: 'stock',
      ticker: 'GEN',
      name: '일반자산',
      quantity: 3000,
      averagePrice: 10000,
      annualGrowthRate: 4,
      dividendYield: 4,
      monthlyContribution: 0,
      reinvestDividend: false,
      currency: 'KRW',
    },
  ],
};

// 자산 매도 순서·ISA 만기 목적지 두 차원이 실제로 결과에 영향을 주도록, 배당률이 크게 다른
// 자산 2개와 ISA 계좌를 함께 둔 시나리오 (사적연금은 paramsWithLargePension과 동일하게 유지)
const paramsWithAssetsAndIsa: SimulationParams = {
  ...paramsWithLargePension,
  assets: [
    {
      id: 'asset-high-div',
      type: 'stock',
      ticker: 'HIGHDIV',
      name: '고배당주',
      quantity: 1000,
      averagePrice: 10000,
      annualGrowthRate: 2,
      dividendYield: 8,
      monthlyContribution: 0,
      reinvestDividend: false,
      currency: 'KRW',
    },
    {
      id: 'asset-low-div',
      type: 'stock',
      ticker: 'LOWDIV',
      name: '저배당 성장주',
      quantity: 1000,
      averagePrice: 10000,
      annualGrowthRate: 8,
      dividendYield: 0.5,
      monthlyContribution: 0,
      reinvestDividend: false,
      currency: 'KRW',
    },
  ],
  isaAccounts: [
    {
      id: 'isa-1',
      type: 'general',
      balance: 50000000,
      monthlyContribution: 0,
      annualReturn: 5,
      dividendYield: 2,
      currency: 'KRW',
      maturityYears: 3,
    },
  ],
};

describe('recommendStrategy', () => {
  test('assetSellOrderStrategy/isaMaturityDestination 후보를 실제로 탐색해 최적 조합을 고른다', () => {
    const engine = new SimulationEngine();
    const recommendation = recommendStrategy(paramsWithAssetsAndIsa, engine);

    // 두 차원을 제외한 나머지 계획은 recommendStrategy가 고른 조합으로 고정한 채, 두 차원의
    // 6개 조합(3×2)을 엔진으로 직접 재현해 recommendStrategy가 실제로 최적을 찾았는지 검증한다.
    const dimensionGrid: Array<[AssetSellOrderStrategy, IsaMaturityDestination]> = [
      ['input_order', 'pension'],
      ['input_order', 'asset'],
      ['low_dividend_first', 'pension'],
      ['low_dividend_first', 'asset'],
      ['high_dividend_first', 'pension'],
      ['high_dividend_first', 'asset'],
    ];

    const utilities = dimensionGrid.map(([assetSellOrderStrategy, isaMaturityDestination]) => {
      const plan: WithdrawalPlan = {
        ...(recommendation.recommendedPlan ?? {}),
        assetSellOrderStrategy,
        isaMaturityDestination,
      };
      const candidateResult = engine.runForUtility({ ...paramsWithAssetsAndIsa, withdrawalPlan: plan });
      return computeLifetimeUtility(candidateResult, paramsWithAssetsAndIsa).score;
    });

    const bestAmongGrid = Math.max(...utilities);
    expect(recommendation.recommendedUtility.score).toBeGreaterThanOrEqual(bestAmongGrid - 1e-9);

    // 두 차원이 실제로 결과에 영향을 준다는 것도 함께 확인한다 (전부 동일하면 탐색이 무의미하다).
    const distinctScores = new Set(utilities.map((u) => u.toFixed(6)));
    expect(distinctScores.size).toBeGreaterThan(1);
  });

  test('추천 전략의 Utility는 현재(baseline) 전략의 Utility보다 낮지 않아야 한다', () => {
    const engine = new SimulationEngine();
    const recommendation = recommendStrategy(paramsWithLargePension, engine);

    expect(recommendation.recommendedUtility.score).toBeGreaterThanOrEqual(recommendation.currentUtility.score);
  });

  test('추천 결과는 항상 reasons를 최소 1개 이상 포함한다', () => {
    const engine = new SimulationEngine();
    const recommendation = recommendStrategy(paramsWithLargePension, engine);

    expect(recommendation.reasons.length).toBeGreaterThan(0);
  });

  test('탐색할 만한 최적화 차원이 전혀 없으면(사적연금·국민연금·복수자산·ISA 모두 없음) 추천 Utility가 현재 Utility와 동일하다', () => {
    const engine = new SimulationEngine();
    const noOptimizableDimensionParams: SimulationParams = {
      ...paramsWithLargePension,
      privatePensions: [],
      nationalPension: { expectedMonthlyAmount: 0 },
    };
    const recommendation = recommendStrategy(noOptimizableDimensionParams, engine);

    expect(recommendation.recommendedUtility.score).toBe(recommendation.currentUtility.score);
  });

  test('deltas 필드가 baseline과 추천 전략 간 실제 수치 차이를 반영한다', () => {
    const engine = new SimulationEngine();
    const recommendation = recommendStrategy(paramsWithLargePension, engine);

    // deltas의 각 필드는 숫자여야 하며 NaN이 아니어야 한다
    Object.values(recommendation.deltas).forEach((v) => {
      expect(typeof v).toBe('number');
      expect(Number.isNaN(v)).toBe(false);
    });
  });
});

// 배당 자산만 있고 사적연금/국민연금이 없어, 5차원 그리드(인출 시점/순서)로는 사망 시
// 잔여자산 과다를 해소할 수 없는 시나리오. 목표 생활비 증액(Phase 2)이 유일한 해소 수단이다.
//
// 수치가 예전(quantity 10,000 / 성장 5% / 배당 3% / 프리셋 없음)과 다른 이유:
// 증액 후보는 이제 SPENDING_INCREASE_GATE(몬테카를로 성공률 ≥ 90%)를 통과해야 채택된다.
// 옛 수치는 결정론상 고갈이 없고 잔여자산도 과다하지만 실제 성공률이 **49%**라, 증액을
// 권해서는 안 되는 계획이었다(그 케이스는 paramsWithSurplusButFragile로 따로 고정한다).
//
// 게이트를 통과하면서 **동시에** 증액이 실제로 효용을 올리는 구간은 좁다. 잔여자산이
// 적정선(월 목표 × 24)의 수십 배가 되면 bequestAdequacy의 exp 감쇠가 완전히 0이라 증액해도
// 점수가 움직이지 않기 때문이다 — 단순히 자산을 불리면 게이트는 통과하지만 증액 인센티브가
// 사라진다. 이 조합(8억 / 성장 3% / 배당 4%)이 그 두 조건을 함께 만족한다.
//
// yieldPreset이 'conservative'인 것은 **몬테카를로 변동성만** 낮추기 위해서다(σ 15 → 10).
// recommendStrategy는 applyYieldPreset을 거치지 않으므로 자산의 annualGrowthRate/dividendYield는
// 위에 적은 값 그대로 쓰인다 — resolveMonteCarloConfig만 이 필드를 본다.
const paramsWithSurplusAssetOnly: SimulationParams = {
  userProfile: { currentAge: 60, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3000000 },
  assets: [
    {
      id: 'a1',
      type: 'etf',
      ticker: 'AAA',
      name: '고배당 자산',
      quantity: 16000,
      averagePrice: 50000,
      annualGrowthRate: 3,
      dividendYield: 4,
      monthlyContribution: 0,
      reinvestDividend: false,
      currency: 'KRW',
    },
  ],
  nationalPension: { expectedMonthlyAmount: 0 },
  privatePensions: [],
  otherIncomes: [],
  inflationRate: 0,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
  yieldPreset: 'conservative',
};

// 자산이 목표 생활비를 감당하기에 턱없이 부족해 은퇴 시작과 동시에 고갈되는 시나리오.
const paramsWithDepletionRisk: SimulationParams = {
  ...paramsWithSurplusAssetOnly,
  assets: [{ ...paramsWithSurplusAssetOnly.assets[0], quantity: 200 }],
};

// 결정론으로는 고갈이 없고(= resolvePlanAssetStatus가 'sustained') 잔여자산도 과다해
// "더 써도 된다"로 보이지만, 시장 변동을 반영하면 성공률이 게이트 문턱에 못 미치는 계획.
//
// 결정론 판정만으로 증액을 허용하던 시절 AI가 정확히 이런 계획에 "생활비를 20% 늘리라"고
// 권했다. 51인 페르소나 실측에서 증액 추천을 받은 24명 전원의 성공률이 떨어졌고, 그 하락폭이
// 최대 35%p였다.
// yieldPreset을 지우면 몬테카를로 변동성이 기본값 σ=15로 돌아간다. 자산은 같은 8억이지만
// 성공률이 80%로 떨어져 게이트 문턱(90%) 아래가 된다 — 결정론 결과는 여전히 'sustained'다.
const paramsWithSurplusButFragile: SimulationParams = {
  ...paramsWithSurplusAssetOnly,
  yieldPreset: undefined,
};

describe('recommendStrategy - 생활비 증액(Phase 2) 후보', () => {
  test('5차원 탐색으로 해소되지 않는 잔여자산 과다는 생활비 증액 후보로 개선된다', () => {
    const engine = new SimulationEngine();
    const recommendation = recommendStrategy(paramsWithSurplusAssetOnly, engine);

    expect(recommendation.improved).toBe(true);
    expect(recommendation.recommendedPlan?.monthlySpendingMultiplier).toBeGreaterThan(1);
    expect(recommendation.reasons[0]).toContain('생활비');
    expect(recommendation.reasons[0]).toContain('늘리면');
    expect(recommendation.recommendedUtility.score).toBeGreaterThan(recommendation.currentUtility.score);
  });

  test('baseline이 기대수명 전에 고갈되는 시나리오에서는 생활비 증액 후보를 생성하지 않는다', () => {
    const engine = new SimulationEngine();
    const baseline = engine.runForUtility(paramsWithDepletionRisk);
    expect(baseline.depletionAge).not.toBeNull();
    expect(baseline.depletionAge!).toBeLessThan(paramsWithDepletionRisk.userProfile.expectancy);

    const recommendation = recommendStrategy(paramsWithDepletionRisk, engine);
    // Phase 2의 **증액** 후보가 0개임을 확인하는 것이 이 테스트의 취지다(하강 후보는 고갈
    // 위험과 무관하게 항상 생성된다 — 오히려 이런 상황에서 필요한 후보다).
    // totalCandidateCount에는 Phase 3(배당 재투자)의 시도량(assets.length)이 더해진다.
    // Phase 4는 실제로 실행한 시뮬레이션 횟수만 더하는데, 이 시나리오는 사적연금이 없어
    // 두 레그 모두 평가되지 않으므로 0이다.
    const baseCandidateCount = generateCandidatePlans(paramsWithDepletionRisk).length;
    const decreaseOnlyCount = generateSpendingAdjustmentCandidates(
      paramsWithDepletionRisk, getIdentityPlan(paramsWithDepletionRisk), { allowIncrease: false }
    ).length;

    expect(recommendation.totalCandidateCount)
      .toBe(baseCandidateCount + decreaseOnlyCount + paramsWithDepletionRisk.assets.length);
    // 증액은 추천되지 않는다.
    expect(recommendation.recommendedPlan?.monthlySpendingMultiplier ?? 1).toBeLessThanOrEqual(1);
  });

  test('결정론상 여유로워 보여도 몬테카를로 성공률이 낮으면 생활비 증액 후보를 만들지 않는다', () => {
    const engine = new SimulationEngine();

    // 전제: 결정론 판정만으로는 이 계획이 증액 대상으로 보인다.
    const baseline = engine.runForUtility(paramsWithSurplusButFragile);
    expect(resolvePlanAssetStatus(baseline, paramsWithSurplusButFragile)).toBe('sustained');
    // 그러나 실제 성공률은 게이트 문턱(0.9)에 한참 못 미친다.
    const mcConfig = { ...resolveMonteCarloConfig(paramsWithSurplusButFragile), trials: 300 };
    expect(estimateSuccessRate(paramsWithSurplusButFragile, engine, mcConfig)).toBeLessThan(0.9);

    const recommendation = recommendStrategy(paramsWithSurplusButFragile, engine);

    // 후보 수 자체가 감액분(2개)만큼만 늘어난다 = 증액 후보가 생성되지 않았다.
    const baseCandidateCount = generateCandidatePlans(paramsWithSurplusButFragile).length;
    const decreaseOnlyCount = generateSpendingAdjustmentCandidates(
      paramsWithSurplusButFragile, getIdentityPlan(paramsWithSurplusButFragile), { allowIncrease: false }
    ).length;
    expect(recommendation.totalCandidateCount)
      .toBe(baseCandidateCount + decreaseOnlyCount + paramsWithSurplusButFragile.assets.length);
    expect(recommendation.recommendedPlan?.monthlySpendingMultiplier ?? 1).toBeLessThanOrEqual(1);
  });

  test('게이트에 걸린 증액 후보는 강건성 승격 경로로도 되살아나지 않는다', () => {
    const engine = new SimulationEngine();

    // 게이트를 evaluateCandidate의 rememberCandidate **뒤로** 옮기면 이 단언이 깨진다:
    // 탈락한 후보가 topCandidates에 남아 applyRobustness의 promoteCandidate가 그것을
    // 최선으로 승격할 수 있기 때문이다. argmax만 막는 것으로는 부족하다는 것을 고정한다.
    //
    // 강건성 승격이 실제로 도는 조건(objective가 'ai_recommended')을 명시적으로 준다.
    const params: SimulationParams = {
      ...paramsWithSurplusButFragile,
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, objective: 'ai_recommended' },
    };
    const compiled = compileStrategy(params);
    const recommendation = recommendStrategy(compiled.params, engine, compiled.utilityConfig);

    expect(recommendation.recommendedPlan?.monthlySpendingMultiplier ?? 1).toBeLessThanOrEqual(1);
    expect(recommendation.itemizedContributions.some((c) => c.field === 'monthlySpendingMultiplier'))
      .toBe(false);
  });

  test('생활비 증액을 검토할 자격이 없으면 몬테카를로를 한 번도 돌리지 않는다', () => {
    // 단락 평가 확인. 증액이 애초에 불가능한 계획(고갈 위험)에서 게이트 MC를 돌리면
    // 추천 1회의 비용이 이유 없이 300 runSingle만큼 늘어난다.
    const engine = new SimulationEngine();
    const spy = vi.spyOn(engine, 'runSingle');

    recommendStrategy(paramsWithDepletionRisk, engine);
    const withoutGate = spy.mock.calls.length;
    spy.mockClear();

    // 같은 규모의 계획이지만 증액 자격이 있는 쪽은 게이트 MC(300시행 × 최대 3회)만큼 더 돈다.
    recommendStrategy(paramsWithSurplusButFragile, engine);
    const withGate = spy.mock.calls.length;
    spy.mockRestore();

    // 자격 없는 쪽은 게이트 MC 300회조차 돌지 않았다.
    expect(withoutGate).toBeLessThan(300);
    // 자격 있는 쪽은 baseline 게이트 MC 300회를 돌았다(후보 게이트는 baseline에서 탈락).
    expect(withGate).toBeGreaterThanOrEqual(300);
  });

  test("spendingStrategy가 'target'이 아니면 생활비 증액 후보를 생성하지 않는다", () => {
    const engine = new SimulationEngine();
    const params: SimulationParams = { ...paramsWithSurplusAssetOnly, spendingStrategy: 'max_sustainable' };
    const recommendation = recommendStrategy(params, engine);
    // Phase 2 후보 0개 확인이 취지. totalCandidateCount에는 Phase 3의 assets.length가 더해진다
    // (사적연금이 없어 Phase 4는 시뮬레이션을 0회 실행한다).
    const baseCandidateCount = generateCandidatePlans(params).length;

    expect(recommendation.totalCandidateCount).toBe(baseCandidateCount + params.assets.length);
  });

});

describe('recommendStrategy - recommendedResult', () => {
  test('improved가 true면 recommendedResult가 baseline과 다른 연도별 결과를 담는다', () => {
    const engine = new SimulationEngine();
    const recommendation = recommendStrategy(paramsWithOptimizableHeadroom, engine);
    expect(recommendation.improved).toBe(true);

    const baseline = engine.runForUtility(paramsWithOptimizableHeadroom);
    expect(recommendation.recommendedResult.endingAssets).not.toBe(baseline.endingAssets);
  });

  test('improved가 false면 recommendedResult가 baseline과 동일하다', () => {
    const engine = new SimulationEngine();
    const noOptimizableDimensionParams: SimulationParams = {
      ...paramsWithLargePension,
      privatePensions: [],
      nationalPension: { expectedMonthlyAmount: 0 },
    };
    const recommendation = recommendStrategy(noOptimizableDimensionParams, engine);
    expect(recommendation.improved).toBe(false);

    const baseline = engine.runForUtility(noOptimizableDimensionParams);
    expect(recommendation.recommendedResult.endingAssets).toBe(baseline.endingAssets);
  });
});

describe('recommendStrategy - verifiedSentinelPlan', () => {
  test('사슬의 각 단계 효용은 그 조합을 실제로 시뮬레이션한 값이다', () => {
    const engine = new SimulationEngine();
    const recommendation = recommendStrategy(paramsWithOptimizableHeadroom, engine);
    expect(recommendation.improved).toBe(true);
    // 이 픽스처에서 검증된 축이 하나도 없어지면 아래 단언이 통째로 무의미해진다.
    expect(recommendation.verifiedSentinelPlan.length).toBeGreaterThan(0);

    // 기준점이 identityPlan이 아니라 "사용자의 params + 해당 축들만 교체"임을 직접 재현한다.
    // 이것이 "검증된 오버레이"라는 주장의 전부다 — 추정치를 실으면 화면이 계산하는 값과
    // 어긋나고, 그 어긋남은 사용자에게 "적용했더니 점수가 내려갔다"로 나타난다.
    for (const step of recommendation.verifiedSentinelPlan) {
      const overlaid = paramsWithSentinelOverlay(paramsWithOptimizableHeadroom, step.planOverrides);
      const expected = computeLifetimeUtility(
        engine.runForUtility(overlaid),
        overlaid,
        DEFAULT_UTILITY_CONFIG
      );

      expect(step.utility, `${step.field} 단계의 효용이 실측과 다르다`).toEqual(expected);
      expect(step.utility.score).toBeGreaterThan(recommendation.currentUtility.score);
    }
  });

  test('개선안이 없으면 빈 배열이다', () => {
    const engine = new SimulationEngine();
    const noOptimizableDimensionParams: SimulationParams = {
      ...paramsWithLargePension,
      privatePensions: [],
      nationalPension: { expectedMonthlyAmount: 0 },
    };
    const recommendation = recommendStrategy(noOptimizableDimensionParams, engine);
    expect(recommendation.improved).toBe(false);
    expect(recommendation.verifiedSentinelPlan).toEqual([]);
  });
});

describe('recommendStrategy - itemizedContributions', () => {
  test('improved가 false면 itemizedContributions는 빈 배열이다', () => {
    const engine = new SimulationEngine();
    const noOptimizableDimensionParams: SimulationParams = {
      ...paramsWithLargePension,
      privatePensions: [],
      nationalPension: { expectedMonthlyAmount: 0 },
    };
    const recommendation = recommendStrategy(noOptimizableDimensionParams, engine);
    expect(recommendation.itemizedContributions).toEqual([]);
  });

  test('improved가 true면 itemizedContributions에 최소 1개 이상의 항목이 있고 각 필드가 유효하다', () => {
    const engine = new SimulationEngine();
    const recommendation = recommendStrategy(paramsWithOptimizableHeadroom, engine);
    expect(recommendation.improved).toBe(true);

    expect(recommendation.itemizedContributions.length).toBeGreaterThan(0);
    recommendation.itemizedContributions.forEach((item) => {
      expect(typeof item.label).toBe('string');
      expect(item.label.length).toBeGreaterThan(0);
      expect(Number.isNaN(item.utilityDelta)).toBe(false);
      Object.values(item.deltas).forEach((v) => {
        expect(Number.isNaN(v)).toBe(false);
      });
    });
  });
});

describe('computeItemizedContributions', () => {
  test('identityPlan과 다른 필드마다 독립적인 utilityDelta/deltas 항목을 생성한다', () => {
    const engine = new SimulationEngine();
    const identityPlan = getIdentityPlan(paramsWithLargePension);
    const baselineResult = engine.runForUtility(paramsWithLargePension);
    const currentUtility = computeLifetimeUtility(baselineResult, paramsWithLargePension, DEFAULT_UTILITY_CONFIG);
    const recommendedPlan = { ...identityPlan, nationalPensionStartAge: 70 };

    const items = computeItemizedContributions(
      paramsWithLargePension,
      identityPlan,
      recommendedPlan,
      currentUtility,
      baselineResult,
      engine,
      DEFAULT_UTILITY_CONFIG
    );

    expect(items).toHaveLength(1);
    expect(items[0].label).toContain('70세');
    expect(items[0].label).toContain('연기');
    expect(Number.isNaN(items[0].utilityDelta)).toBe(false);
    expect(items[0].deltas.nationalPensionTotal).not.toBe(0);
  });

  test('2개 필드가 동시에 바뀌어도 각 필드를 독립적으로(단일 필드만 override) 평가해 서로 다른 deltas를 생성한다', () => {
    const engine = new SimulationEngine();
    const identityPlan = getIdentityPlan(paramsWithLargePension);
    const baselineResult = engine.runForUtility(paramsWithLargePension);
    const currentUtility = computeLifetimeUtility(baselineResult, paramsWithLargePension, DEFAULT_UTILITY_CONFIG);
    // identityPlan의 privatePensionMonthlyTarget과 다르게, 국민연금 연기(70)와 사적연금
    // 월 인출액(300만원) 둘 다 바뀐 추천안 — 루프가 필드별로 격리되는지 검증한다.
    const recommendedPlan = { ...identityPlan, nationalPensionStartAge: 70, privatePensionMonthlyTarget: 3000000 };

    const items = computeItemizedContributions(
      paramsWithLargePension,
      identityPlan,
      recommendedPlan,
      currentUtility,
      baselineResult,
      engine,
      DEFAULT_UTILITY_CONFIG
    );

    expect(items).toHaveLength(2);

    const nationalPensionItem = items.find((item) => item.label.includes('국민연금'));
    const privatePensionItem = items.find((item) => item.label.includes('사적연금'));
    expect(nationalPensionItem).toBeDefined();
    expect(privatePensionItem).toBeDefined();

    // 국민연금 항목은 nationalPensionStartAge 하나만 baseline에 적용한 결과라, 사적연금
    // 월 인출액은 바뀌지 않았으므로 그 필드의 delta는 0이어야 한다(두 필드를 한꺼번에 섞어
    // 적용하는 버그였다면 이 값도 함께 바뀌어 0이 아니게 된다).
    expect(nationalPensionItem!.deltas.nationalPensionTotal).not.toBe(0);
    expect(privatePensionItem!.label).toContain('정액 인출');
    // 두 항목의 deltas가 서로 동일하지 않아야(각자 다른 단일 필드 override 결과여야) 한다.
    expect(nationalPensionItem!.deltas).not.toEqual(privatePensionItem!.deltas);
  });

  // buildReasons와 마찬가지로 항목 라벨도 배수의 방향을 따라야 한다. 자산이 부족한 계획에서는
  // 오히려 감액이 추천되는 것이 정상이라, 이 경로가 실제 사용자 화면에 그대로 노출된다.
  test('monthlySpendingMultiplier가 1보다 작으면 항목 라벨도 감액 문구를 쓴다', () => {
    const engine = new SimulationEngine();
    const identityPlan = getIdentityPlan(paramsWithLargePension);
    const baselineResult = engine.runForUtility(paramsWithLargePension);
    const currentUtility = computeLifetimeUtility(baselineResult, paramsWithLargePension, DEFAULT_UTILITY_CONFIG);
    const recommendedPlan = { ...identityPlan, monthlySpendingMultiplier: 0.8 };

    const items = computeItemizedContributions(
      paramsWithLargePension,
      identityPlan,
      recommendedPlan,
      currentUtility,
      baselineResult,
      engine,
      DEFAULT_UTILITY_CONFIG
    );

    expect(items).toHaveLength(1);
    expect(items[0].label).toContain('감액');
    expect(items[0].label).toContain('줄입니다');
    expect(items[0].label).not.toContain('증액');
  });

  // "적용해도 아무것도 바뀌지 않는 할 일"은 어떤 필드든 소음이다. 사적연금 계좌가 없는데
  // privatePensionMonthlyTarget만 다른 경우가 실제로 화면에 "효용 +0점" 카드로 떴다.
  //
  // 판정에 "모든 deltas가 0"까지 포함하는 것이 중요하다 — utilityDelta만 0이고 절세·자산
  // 효과가 있는 항목은 정상이며, 화면 각주가 이미 그 경우를 설명한다.
  test('효용도 절세도 자산도 전혀 바꾸지 않는 항목은 제외한다', () => {
    const engine = new SimulationEngine();
    // 사적연금 계좌가 없는 계획 — 이 필드는 어떤 값이어도 결과가 같다.
    const noPensionParams: SimulationParams = { ...paramsWithLargePension, privatePensions: [] };
    const identityPlan = getIdentityPlan(noPensionParams);
    const baselineResult = engine.runForUtility(noPensionParams);
    const currentUtility = computeLifetimeUtility(baselineResult, noPensionParams, DEFAULT_UTILITY_CONFIG);
    const recommendedPlan = { ...identityPlan, privatePensionMonthlyTarget: 1250000 };

    const items = computeItemizedContributions(
      noPensionParams,
      identityPlan,
      recommendedPlan,
      currentUtility,
      baselineResult,
      engine,
      DEFAULT_UTILITY_CONFIG
    );

    expect(items).toEqual([]);
  });

  test('효용은 그대로여도 절세·자산 효과가 있는 항목은 남긴다', () => {
    const engine = new SimulationEngine();
    const identityPlan = getIdentityPlan(paramsWithLargePension);
    const baselineResult = engine.runForUtility(paramsWithLargePension);
    const currentUtility = computeLifetimeUtility(baselineResult, paramsWithLargePension, DEFAULT_UTILITY_CONFIG);
    const recommendedPlan = { ...identityPlan, nationalPensionStartAge: 70 };

    const items = computeItemizedContributions(
      paramsWithLargePension,
      identityPlan,
      recommendedPlan,
      currentUtility,
      baselineResult,
      engine,
      DEFAULT_UTILITY_CONFIG
    );

    expect(items).toHaveLength(1);
    // 효용 변화가 0이더라도 deltas가 살아 있으면 사용자에게 보여줄 근거가 있다.
    expect(Object.values(items[0].deltas).some((v) => v !== 0)).toBe(true);
  });

  test('recommendedPlan이 identityPlan과 완전히 같으면 빈 배열을 반환한다', () => {
    const engine = new SimulationEngine();
    const identityPlan = getIdentityPlan(paramsWithLargePension);
    const baselineResult = engine.runForUtility(paramsWithLargePension);
    const currentUtility = computeLifetimeUtility(baselineResult, paramsWithLargePension, DEFAULT_UTILITY_CONFIG);

    const items = computeItemizedContributions(
      paramsWithLargePension,
      identityPlan,
      identityPlan,
      currentUtility,
      baselineResult,
      engine,
      DEFAULT_UTILITY_CONFIG
    );
    expect(items).toEqual([]);
  });
});

// 기본값은 공용 픽스처(@/tests/fixtures/yearlyResult)와 완전히 같았다. 복제본을 남겨 두면
// SimulationYearlyResult에 필수 필드가 추가될 때마다 여기서도 컴파일이 깨진다 —
// 그 복제를 없애려고 공용 픽스처를 만들었다.
const makeYearlyResult = makeYearlyResultFixture;

function makeSimulationResult(yearlyResults: SimulationYearlyResult[], endingAssets: number): SimulationResult {
  return {
    yearlyResults,
    fireAge: 60,
    depletionAge: null,
    endingAssets,
    retirementScore: 0,
    retirementGrade: '보통',
    goalAchievementRate: 100,
    retirementAssetsAtRetirement: 0,
  };
}

describe('computeDeltas - baseline/recommended 실제 수치 차이 계산', () => {
  const baseline = makeSimulationResult(
    [
      makeYearlyResult({ age: 60, year: 2026, spending: 1000, dividendTaxPaid: 10, pensionTaxPaid: 5, healthInsurancePaid: 20, hasTaxWarning: false, pensionAssets: 500 }),
      makeYearlyResult({ age: 61, year: 2027, spending: 1100, dividendTaxPaid: 15, pensionTaxPaid: 5, healthInsurancePaid: 25, hasTaxWarning: true, pensionAssets: 400 }),
    ],
    5000
  );
  const recommended = makeSimulationResult(
    [
      makeYearlyResult({ age: 60, year: 2026, spending: 1200, dividendTaxPaid: 20, pensionTaxPaid: 10, nationalPensionTaxPaid: 5, healthInsurancePaid: 15, hasTaxWarning: true, pensionAssets: 600 }),
      makeYearlyResult({ age: 61, year: 2027, spending: 1300, dividendTaxPaid: 25, pensionTaxPaid: 10, nationalPensionTaxPaid: 5, healthInsurancePaid: 15, comprehensiveTaxPaid: 10, hasTaxWarning: true, pensionAssets: 550 }),
    ],
    6000
  );

  test('deltas의 각 필드가 baseline/recommended 간 실제 차이와 정확히 일치한다', () => {
    const deltas = computeDeltas(baseline, recommended);

    expect(deltas.lifetimeConsumption).toBe(400); // (1200+1300) - (1000+1100)
    expect(deltas.totalTax).toBe(35); // (50+65) - (35+45)
    expect(deltas.endingAssets).toBe(1000); // 6000 - 5000
    expect(deltas.pensionEndingBalance).toBe(150); // 550(마지막 해) - 400(마지막 해)
    expect(deltas.comprehensiveTaxYears).toBe(1); // 2개 연도(hasTaxWarning) - 1개 연도
    expect(deltas.healthInsuranceTotal).toBe(-15); // 30 - 45
  });

  test('nationalPensionTotal은 baseline/recommended 간 국민연금 총 수령액 차이와 일치한다', () => {
    const baselineNat = makeSimulationResult(
      [makeYearlyResult({ age: 60, year: 2026, nationalPensionIncome: 1000 })],
      0
    );
    const recommendedNat = makeSimulationResult(
      [makeYearlyResult({ age: 60, year: 2026, nationalPensionIncome: 700 })],
      0
    );
    const deltas = computeDeltas(baselineNat, recommendedNat);
    expect(deltas.nationalPensionTotal).toBe(-300);
  });
});

function makeUtility(score: number, components: Partial<UtilityBreakdown['components']> = {}): UtilityBreakdown {
  return {
    score,
    components: {
      consumption: 0,
      depletionSafety: 0,
      pensionUtilization: 0,
      taxEfficiency: 0,
      taxationRisk: 0,
      bequestAdequacy: 0,
      ...components,
    },
  };
}

describe('buildReasons - context 인자로 전달되는 신규 문구', () => {
  test('monthlySpendingMultiplier가 1이 아니고 context가 있으면 생활비 증액 문구를 가장 먼저 반환한다', () => {
    const reasons = buildReasons({ monthlySpendingMultiplier: 1.2 }, zeroDeltas, true, undefined, {
      currentUtility: makeUtility(70),
      recommendedUtility: makeUtility(80),
      originalMonthlyTarget: 3000000,
    });

    expect(reasons[0]).toContain('생활비');
    expect(reasons[0]).toContain('늘리면');
    expect(reasons[0]).toContain('70점 → 80점');
  });

  // 생활비 배수가 1 미만이면 감액이다. 예전에는 '증액'/'늘리면'이 하드코딩돼 있어
  // "350만원 → 280만원(약 -70만원 증액)로 늘리면"이라는, 방향이 뒤집힌 문장이 나왔다.
  test('monthlySpendingMultiplier가 1보다 작으면 감액 문구를 쓴다', () => {
    const reasons = buildReasons({ monthlySpendingMultiplier: 0.8 }, zeroDeltas, true, undefined, {
      currentUtility: makeUtility(55),
      recommendedUtility: makeUtility(58),
      originalMonthlyTarget: 3500000,
    });

    expect(reasons[0]).toContain('350만원 → 280만원');
    expect(reasons[0]).toContain('70만원 감액');
    expect(reasons[0]).toContain('줄이면');
    expect(reasons[0]).not.toContain('증액');
    expect(reasons[0]).not.toContain('-70만원');
  });

  test('monthlySpendingMultiplier가 1이면(변경 없음) 생활비 증액 문구를 생성하지 않는다', () => {
    const reasons = buildReasons({ monthlySpendingMultiplier: 1 }, zeroDeltas, true, undefined, {
      currentUtility: makeUtility(70),
      recommendedUtility: makeUtility(80),
      originalMonthlyTarget: 3000000,
    });

    expect(reasons.some((r) => r.includes('생활비'))).toBe(false);
  });

  test("improved:false이고 '주의'/'위험' 등급이면 약점을 인용한 문구를 반환한다(단정적인 '이미 합리적' 문구 대신)", () => {
    const currentUtility = makeUtility(66, {
      consumption: 20,
      depletionSafety: 20,
      pensionUtilization: 0, // 0/15 -> 약점
      taxEfficiency: 10,
      taxationRisk: 10,
      bequestAdequacy: 6,
    });
    const reasons = buildReasons(null, zeroDeltas, false, { total: 6, failed: 0 }, {
      currentUtility,
      recommendedUtility: currentUtility,
    });

    expect(reasons[0]).toContain('66점');
    expect(reasons[0]).toContain('주의');
    expect(reasons.some((r) => r.includes('연금 활용도'))).toBe(true);
  });

  test("improved:false이고 '보통' 이상 등급이면 기존의 '이미 합리적' 문구를 유지한다", () => {
    const currentUtility = makeUtility(75, {
      consumption: 27,
      depletionSafety: 18,
      pensionUtilization: 12,
      taxEfficiency: 8,
      taxationRisk: 8,
      bequestAdequacy: 2,
    });
    const reasons = buildReasons(null, zeroDeltas, false, { total: 6, failed: 0 }, {
      currentUtility,
      recommendedUtility: currentUtility,
    });

    expect(reasons).toEqual(['현재 전략이 이미 평생 효용 관점에서 충분히 합리적이어서 별도로 추천할 변경 사항이 없습니다.']);
  });

  test('identityPlan과 값이 같은 필드는(실제로는 바뀐 게 없으므로) 문구를 생성하지 않는다', () => {
    const identityPlan: CompleteWithdrawalPlan = {
      privatePensionMonthlyTarget: 0,
      nationalPensionStartAge: 65,
      assetSellOrderStrategy: 'input_order',
      isaMaturityDestination: 'pension',
      generalAssetWithdrawalStartAge: 60,
      monthlySpendingMultiplier: 1,
    };
    const plan: CompleteWithdrawalPlan = { ...identityPlan, monthlySpendingMultiplier: 1.1 };

    const reasons = buildReasons(plan, zeroDeltas, true, undefined, {
      currentUtility: makeUtility(70),
      recommendedUtility: makeUtility(75),
      originalMonthlyTarget: 3000000,
      identityPlan,
    });

    expect(reasons.some((r) => r.includes('사적연금'))).toBe(false);
    expect(reasons.some((r) => r.includes('일반 자산'))).toBe(false);
    expect(reasons[0]).toContain('생활비');
  });
});

describe('buildReasons - 후보 실패 통계에 따른 메시지 분기', () => {
  test('개선 없고 후보가 하나도 없으면(탐색할 차원 없음) 기존처럼 "이미 합리적" 문구를 반환한다', () => {
    const reasons = buildReasons(null, zeroDeltas, false, { total: 0, failed: 0 });
    expect(reasons).toEqual(['현재 전략이 이미 평생 효용 관점에서 충분히 합리적이어서 별도로 추천할 변경 사항이 없습니다.']);
  });

  test('후보가 있었지만 모두 baseline보다 낮으면(정상 평가) "이미 합리적" 문구를 반환한다', () => {
    const reasons = buildReasons(null, zeroDeltas, false, { total: 12, failed: 0 });
    expect(reasons).toEqual(['현재 전략이 이미 평생 효용 관점에서 충분히 합리적이어서 별도로 추천할 변경 사항이 없습니다.']);
  });

  test('후보가 전부 시뮬레이션 실패로 평가되지 못했으면 별도 문구를 반환한다', () => {
    const reasons = buildReasons(null, zeroDeltas, false, { total: 12, failed: 12 });
    expect(reasons).toEqual(['전략 후보를 평가하는 중 모두 오류가 발생해 추천을 계산하지 못했습니다. 현재 전략이 유지됩니다.']);
  });

  test('candidateStats 인자가 없으면 기존과 동일하게 동작한다(하위 호환)', () => {
    const reasons = buildReasons(null, zeroDeltas, false);
    expect(reasons).toEqual(['현재 전략이 이미 평생 효용 관점에서 충분히 합리적이어서 별도로 추천할 변경 사항이 없습니다.']);
  });
});

describe('recommendStrategy - totalCandidateCount/failedCandidateCount', () => {
  test('탐색할 차원이 있으면 총 후보 수를 반환하고 실패 수는 0이다', () => {
    const engine = new SimulationEngine();
    const recommendation = recommendStrategy(paramsWithLargePension, engine);

    expect(recommendation.totalCandidateCount).toBeGreaterThan(0);
    expect(recommendation.failedCandidateCount).toBe(0);
  });

  test('인출 차원이 전혀 없으면 생활비 하강 후보만 남는다', () => {
    const engine = new SimulationEngine();
    const noOptimizableDimensionParams: SimulationParams = {
      ...paramsWithLargePension,
      privatePensions: [],
      nationalPension: { expectedMonthlyAmount: 0 },
    };
    const recommendation = recommendStrategy(noOptimizableDimensionParams, engine);

    // Phase 1(인출 시점/순서 격자)과 Phase 3은 탐색할 차원이 없어 0개이고, Phase 4도
    // 사적연금이 없어(hasPension false) 시뮬레이션을 한 번도 실행하지 않으므로 0이다.
    // 예전에는 Phase 4가 전제 조건 미충족이어도 무조건 +1을 더해, AI advisor의
    // "전부 실패" 판정(failed === total)이 성립할 수 없었다.
    //
    // Phase 2의 하강 후보는 인출 격자와 무관하게 항상 생성된다 — "덜 쓴다"는 선택지는
    // 자산이 하나뿐이어도 존재한다.
    const decreaseOnlyCount = generateSpendingAdjustmentCandidates(
      noOptimizableDimensionParams, getIdentityPlan(noOptimizableDimensionParams), { allowIncrease: false }
    ).length;

    expect(generateCandidatePlans(noOptimizableDimensionParams)).toEqual([]);
    expect(recommendation.totalCandidateCount).toBe(decreaseOnlyCount);
    expect(recommendation.failedCandidateCount).toBe(0);
  });
});

describe('buildReasons - 자산 매도 순서 / ISA 만기 이동 문구', () => {
  test('low_dividend_first면 저배당 자산 우선 매도 문구를 포함한다', () => {
    const reasons = buildReasons({ assetSellOrderStrategy: 'low_dividend_first' }, zeroDeltas, true);
    expect(reasons.some((r) => r.includes('배당') && r.includes('낮은'))).toBe(true);
  });

  test('high_dividend_first면 고배당 자산 우선 매도 문구를 포함한다', () => {
    const reasons = buildReasons({ assetSellOrderStrategy: 'high_dividend_first' }, zeroDeltas, true);
    expect(reasons.some((r) => r.includes('배당') && r.includes('높은'))).toBe(true);
  });

  test('input_order이거나 미지정이면 매도 순서 관련 문구를 추가하지 않는다', () => {
    const reasonsInputOrder = buildReasons({ assetSellOrderStrategy: 'input_order' }, zeroDeltas, true);
    expect(reasonsInputOrder.some((r) => r.includes('매도'))).toBe(false);

    const reasonsUndefined = buildReasons({}, zeroDeltas, true);
    expect(reasonsUndefined.some((r) => r.includes('매도'))).toBe(false);
  });

  test("isaMaturityDestination이 'asset'이면 ISA 자금 이동 문구를 포함한다", () => {
    const reasons = buildReasons({ isaMaturityDestination: 'asset' }, zeroDeltas, true);
    expect(reasons.some((r) => r.includes('ISA') && r.includes('일반 자산'))).toBe(true);
  });

  test("isaMaturityDestination이 'pension'이거나 미지정이면 ISA 이동 문구를 추가하지 않는다", () => {
    const reasonsPension = buildReasons({ isaMaturityDestination: 'pension' }, zeroDeltas, true);
    expect(reasonsPension.some((r) => r.includes('ISA'))).toBe(false);

    const reasonsUndefined = buildReasons({}, zeroDeltas, true);
    expect(reasonsUndefined.some((r) => r.includes('ISA'))).toBe(false);
  });
});

describe('buildReasons - 일반계좌(자산) 인출 시점 문구', () => {
  test('generalAssetWithdrawalStartAge가 정의되어 있으면 인출 개시 나이 문구를 포함한다', () => {
    const reasons = buildReasons({ generalAssetWithdrawalStartAge: 70 }, zeroDeltas, true);
    expect(reasons.some((r) => r.includes('70세') && r.includes('일반 자산'))).toBe(true);
  });

  test('generalAssetWithdrawalStartAge가 미지정이면 관련 문구를 추가하지 않는다', () => {
    const reasons = buildReasons({}, zeroDeltas, true);
    expect(reasons.some((r) => r.includes('일반 자산'))).toBe(false);
  });
});

describe('buildReasons - 국민연금 조기/연기수령 문구', () => {
  test('nationalPensionStartAge가 65세보다 이르면 조기 수령 문구를 포함한다', () => {
    const reasons = buildReasons(
      { nationalPensionStartAge: 60 },
      zeroDeltas,
      true
    );
    expect(reasons.some((r) => r.includes('60세') && r.includes('조기'))).toBe(true);
  });

  test('nationalPensionStartAge가 65세보다 늦으면 연기 수령 문구를 포함한다', () => {
    const reasons = buildReasons(
      { nationalPensionStartAge: 70 },
      zeroDeltas,
      true
    );
    expect(reasons.some((r) => r.includes('70세') && r.includes('연기'))).toBe(true);
  });

  test('nationalPensionStartAge가 65세이거나 미지정이면 국민연금 관련 문구를 추가하지 않는다', () => {
    const reasonsAt65 = buildReasons({ nationalPensionStartAge: 65 }, zeroDeltas, true);
    expect(reasonsAt65.some((r) => r.includes('국민연금'))).toBe(false);

    const reasonsUndefined = buildReasons({}, zeroDeltas, true);
    expect(reasonsUndefined.some((r) => r.includes('국민연금'))).toBe(false);
  });

  test('조기 수령 문구에 deltas.nationalPensionTotal 기준 평생 총 수령액 변화가 병기된다', () => {
    const reasons = buildReasons(
      { nationalPensionStartAge: 60 },
      { ...zeroDeltas, nationalPensionTotal: -50000000 },
      true
    );
    expect(reasons.some((r) => r.includes('60세') && r.includes('감소'))).toBe(true);
  });
});

describe('buildReasons - pensionEndingBalance 증가 케이스', () => {
  test('사망 시 연금잔액이 증가하면(가치판단 없이) 사실만 보고하는 문구를 반환한다', () => {
    const reasons = buildReasons(
      {},
      { ...zeroDeltas, pensionEndingBalance: 30000000 },
      true
    );
    expect(reasons.some((r) => r.includes('연금잔액') && r.includes('증가'))).toBe(true);
  });
});

describe('recommendStrategy - Phase 3 배당 재투자 통합', () => {
  test('assets가 비어 있으면 recommendedAssetReinvestment는 null이다', () => {
    const engine = new SimulationEngine();
    const result = recommendStrategy(paramsWithLargePension, engine);
    expect(result.recommendedAssetReinvestment).toBeNull();
  });

  test('자산이 있으면 itemizedContributions/reasons에 배당 재투자 항목이 추가될 수 있다(구조 검증)', () => {
    // reinvestDividend는 SimulationEngine 내부에서 (1) 은퇴 전(currentAge < retirementAge) 연차에만,
    // (2) assets[0]이 아닌 자산에 대해서만 실제로 결과에 영향을 준다 — assets[0]의 배당은
    // reinvestDividend 값과 무관하게 항상 자기 자신으로 재유입되는 잉여 스윕 로직이 있어 index 0은
    // 항상 무효과다(RecommendationEngine.ts의 Phase 3 통합 조사 과정에서 실제 엔진으로 확인).
    // 그래서 이 fixture는 paramsWithLargePension을 은퇴 전 시점(currentAge 30 < retirementAge 65)으로
    // 조정하고, 성장률이 크게 다른 자산 2개를 둔다 — asset-1(저성장·고배당)의 배당을 재투자하지
    // 않고 asset-0(고성장)으로 흘려보내는 쪽이 유리해지도록 설계해 실제로 non-null 경로를 탄다.
    const engine = new SimulationEngine();
    const paramsWithAssets: SimulationParams = {
      ...paramsWithLargePension,
      userProfile: { ...paramsWithLargePension.userProfile, currentAge: 30, retirementAge: 65 },
      assets: [
        {
          id: 'asset-0',
          type: 'etf',
          ticker: 'GROWTH',
          name: '성장자산',
          quantity: 1,
          averagePrice: 30000000,
          annualGrowthRate: 10,
          dividendYield: 0,
          monthlyContribution: 0,
          reinvestDividend: true,
          currency: 'KRW',
        },
        {
          id: 'asset-1',
          type: 'etf',
          ticker: 'SPY',
          name: '테스트자산',
          quantity: 1,
          averagePrice: 30000000,
          annualGrowthRate: 1,
          dividendYield: 8,
          monthlyContribution: 0,
          reinvestDividend: true,
          currency: 'KRW',
        },
      ],
    };
    const result = recommendStrategy(paramsWithAssets, engine);
    // 이 fixture에서는 asset-1(저성장·고배당)의 재투자 중단만 유리하다 — 배당을 연 1%짜리
    // 자산 안에서 굴리는 것보다 현금으로 빼 두는 편이 사망 시 잔여자산 과다를 덜 만든다.
    // asset-0은 배당이 0이라 스위치를 뒤집어도 아무 일도 일어나지 않는다.
    //
    // 예전 주석은 "asset-0은 index 0이라 flip해도 무효과"라고 적혀 있었다. 그건 잉여 현금이
    // activeAssets[0]으로 되돌아가던 시절의 이야기이고, 현금 버킷이 생기면서 근거가 사라졌다.
    expect(result.recommendedAssetReinvestment).not.toBeNull();
    expect(Object.keys(result.recommendedAssetReinvestment ?? {})).toEqual(['asset-1']);
    expect(result.itemizedContributions.some((c) => c.label.includes('테스트자산'))).toBe(true);

    // Phase 3 최종값(finalUtility/finalResult) 배선 회귀 방지: recommendedUtility/recommendedResult가
    // "Phase 1+2 결과(bestUtility/bestResult)"가 아니라 "Phase 3까지 반영한 최종값"이어야 한다.
    expect(result.improved).toBe(true);
    expect(result.recommendedUtility.score).toBeGreaterThan(result.currentUtility.score);
    // deltas가 전부 0이 아니어야 한다(재투자 변경이 실제 수치에 반영됨).
    expect(Object.values(result.deltas).some((v) => v !== 0)).toBe(true);
    expect(result.deltas.totalTax).toBeLessThan(0); // 세금 절감 방향

    // recommendedResult가 "추천안(인출계획 + 배당 재투자)을 실제로 적용한 시뮬레이션"과 일치하는지
    // 재구성해 검증한다 — bestUtility를 잘못 반환하는 회귀라면 이 값이 어긋난다.
    expect(result.recommendedResult.yearlyResults.length).toBeGreaterThan(0);
    const appliedParams: SimulationParams = {
      ...paramsWithAssets,
      withdrawalPlan: result.recommendedPlan ?? undefined,
      assets: paramsWithAssets.assets.map((a) =>
        result.recommendedAssetReinvestment && a.id in result.recommendedAssetReinvestment
          ? { ...a, reinvestDividend: result.recommendedAssetReinvestment[a.id] }
          : a
      ),
    };
    const appliedResult = engine.runForUtility(appliedParams);
    const appliedUtility = computeLifetimeUtility(appliedResult, appliedParams, DEFAULT_UTILITY_CONFIG);
    expect(appliedUtility.score).toBe(result.recommendedUtility.score);
    expect(appliedResult.endingAssets).toBeCloseTo(result.recommendedResult.endingAssets, 2);
  });

  test('WithdrawalPlan(Phase 1/2) 개선은 없지만 Phase 3(배당 재투자) 개선만 있으면 reasons에 Phase 3 문구만 담고 "이미 합리적" 폴백은 담지 않는다', () => {
    // 인출계획 그리드로는 개선이 없도록 설계한다: 사적연금·국민연금·ISA 없음, 두 자산의
    // 배당수익률을 **실제로** 동일하게 두어 매도순서 차원 무효화(주석은 예전부터 그렇게
    // 말했지만 값은 0과 8이었다 — 잉여 현금이 자산으로 되돌아가던 시절에는 그 차이가
    // 가려져 있었을 뿐이다), 은퇴기간을 짧게 두어 매도순서 절세 효과도 제거.
    //
    // 그 위에서 Phase 3만 개선을 찾는다: 축적기가 40년이라 배당을 자산 안에서 굴리면
    // 사망 시 잔여자산이 적정선(월생활비 × 24)을 크게 초과해 bequestAdequacy가 감점된다.
    // 재투자를 끄면 그만큼이 현금으로 남아 초과가 줄어든다.
    //
    // 결과: bestPlan은 null(인출계획 미개선)이고 Phase 3만 개선 —
    // reasons 3-way 병합의 가운데 분기(withdrawalPlanImproved===false && additionalReasons.length>0).
    const engine = new SimulationEngine();
    const phase3OnlyParams: SimulationParams = {
      userProfile: { currentAge: 25, retirementAge: 65, expectancy: 70, targetMonthlySpending: 2000000 },
      assets: [
        {
          id: 'asset-0',
          type: 'etf',
          ticker: 'GROWTH',
          name: '테스트자산',
          quantity: 1,
          averagePrice: 30000000,
          annualGrowthRate: 12,
          dividendYield: 8,
          monthlyContribution: 0,
          reinvestDividend: true,
          currency: 'KRW',
        },
        {
          id: 'asset-1',
          type: 'etf',
          ticker: 'SPY',
          name: '저성장자산',
          quantity: 1,
          averagePrice: 30000000,
          annualGrowthRate: 1,
          dividendYield: 8,
          monthlyContribution: 0,
          reinvestDividend: false,
          currency: 'KRW',
        },
      ],
      nationalPension: { expectedMonthlyAmount: 0 },
      privatePensions: [],
      otherIncomes: [],
      inflationRate: 0,
      inflationMode: 'real',
      baseExchangeRate: 1350,
      exchangeScenario: 'base',
      displayCurrency: 'KRW',
    };
    const result = recommendStrategy(phase3OnlyParams, engine);

    // 인출계획 차원은 개선 없음(bestPlan null), Phase 3만 개선.
    expect(result.recommendedPlan).toBeNull();
    expect(result.recommendedAssetReinvestment).toEqual({ 'asset-0': false });
    expect(result.improved).toBe(true);

    // reasons는 Phase 3 문구만 포함하고, buildReasons의 "이미 합리적"/"충분히 합리적" 및
    // '주의'/'위험' 등급 폴백 문구("개선 여지가 있으나")는 포함하지 않아야 한다(가운데 분기 검증).
    expect(result.reasons.some((r) => r.includes('테스트자산') && r.includes('재투자'))).toBe(true);
    expect(result.reasons.every((r) => !r.includes('합리적') && !r.includes('개선 여지가 있으나'))).toBe(true);
  });
});

describe('recommendStrategy - Phase 4 사적연금 채널링 통합', () => {
  test('ISA 계좌가 없으면 recommendedPrivatePensionChanneling은 null이다', () => {
    const engine = new SimulationEngine();
    const result = recommendStrategy(paramsWithLargePension, engine);
    expect(result.recommendedPrivatePensionChanneling).toBeNull();
  });

  test('사적연금+ISA가 있고 브릿지 구간이 존재하면 유리할 때 채택되고 itemizedContributions/reasons에 반영된다 (bestPlan이 non-null인 경우)', () => {
    // 주의: 이 픽스처는 Phase 1/2(인출계획 5차원 탐색 + 생활비 배수)도 개선안을 찾아
    // bestPlan이 non-null이 된다(privatePensionMonthlyTarget/nationalPensionStartAge가
    // identity와 달라짐 — 아래에서 직접 확인). 즉 recommendedPlan은
    // `{ ...bestPlan, isaMaturityDestination: 'asset' }` 분기만 검증한다.
    // `bestPlan === null`인 채널링-단독 채택 케이스(`{ ...identityPlan, isaMaturityDestination: 'asset' }`
    // 분기)는 실제 엔진으로 재현하기 어려워(리뷰어가 ~40개 파라미터 조합을 스윕해도 못 찾음)
    // 아래 별도 테스트(엔진 stub 사용)에서 검증한다.
    const engine = new SimulationEngine();
    const params: SimulationParams = {
      ...paramsWithLargePension,
      // targetMonthlySpending을 2,000,000(원안)에서 25,000,000으로 올렸다: 이 시뮬레이터는
      // ISA(만기 99년이라 시뮬레이션 기간 내 절대 만기되지 않음)와 신규 연금 계좌(Phase 4가
      // 추가하는 buildNewPension)에 들어간 돈을 전혀 소비로 되돌리지 않는다 — 순수 사망 시
      // 잔여자산(bequest)으로만 남는다. bequestAdequacy는 "적정 잔여자산(=월 목표생활비 ×
      // 24개월)" 대비 초과분을 지수적으로 감점하므로, 월 생활비가 낮으면(원안 200만원) 채널링이
      // 만들어내는 추가 잔여자산이 적정치 대비 과다해져 bequestAdequacy 감점이 수익률 차익(ISA
      // 6% vs 연금 2%) 효과를 압도해 버려 채널링이 항상 손해로 나온다(직접 확인함: 200만원에서는
      // recommendedPrivatePensionChanneling이 결정론적으로 null). 월 생활비를 올려 적정
      // 잔여자산 기준선을 함께 끌어올리면 과다 페널티가 완화되어 수익률 차익 효과가 순이익으로
      // 드러난다. 2500만원은 19,000,000~30,000,000 구간에서 균일하게 true(정도 차이만 있을 뿐
      // 항상 채택됨)로 확인된 안정 구간의 중간값이라 knife-edge가 아니다.
      userProfile: { ...paramsWithLargePension.userProfile, currentAge: 50, retirementAge: 60, expectancy: 90, targetMonthlySpending: 25000000 },
      privatePensions: [
        { id: 'pension-1', type: 'irp', balance: 600000000, monthlyContribution: 0, annualReturn: 2, currency: 'KRW' },
      ],
      isaAccounts: [
        { id: 'isa-1', type: 'general', balance: 10000000, monthlyContribution: 0, annualReturn: 6, dividendYield: 0, currency: 'KRW', maturityYears: 99 },
      ],
    };

    const result = recommendStrategy(params, engine);

    // ISA 수익률(6%)이 사적연금 수익률(2%)보다 높은 시나리오라 채널링이 유리해야 한다.
    // 만약 이 assertion이 실패하면(유리하지 않다고 나오면) annualReturn 격차를 더 벌려서
    // 결정론적으로 채택되는 시나리오를 다시 찾는다 — 실제 엔진 기반 통합 테스트이므로 근사치가
    // 아니라 실제 계산 결과에 의존한다.
    expect(result.recommendedPrivatePensionChanneling).toBe(true);
    expect(result.itemizedContributions.some((c) => c.label.includes('사적연금을 55세부터'))).toBe(true);
    expect(result.reasons.some((r) => r.includes('사적연금을 55세부터'))).toBe(true);
    expect(result.recommendedUtility.score).toBeGreaterThan(result.currentUtility.score);

    // bestPlan이 실제로 non-null이라는 것(즉 이 테스트가 위 주석대로 `{ ...bestPlan, ... }` 분기를
    // 검증하고 있다는 것)을 identity 대비 필드 차이로 확인한다. bestPlan이 null이었다면 이 값들은
    // identityPlan과 동일했을 것이다(사적연금 25,000,000/국민연금 65세).
    const identityPlan = getIdentityPlan(params);
    expect(result.recommendedPlan?.privatePensionMonthlyTarget).not.toBe(identityPlan.privatePensionMonthlyTarget);
    expect(result.recommendedPlan?.nationalPensionStartAge).not.toBe(identityPlan.nationalPensionStartAge);
    expect(result.recommendedPlan?.isaMaturityDestination).toBe('asset');
  });

  test('Phase 1/2가 개선안을 찾지 못해 bestPlan이 null이면, 채널링이 채택돼도 recommendedPlan을 지어내지 않는다(null 유지 + 라벨로 안내)', () => {
    // 실제 엔진으로 "bestPlan===null이면서 채널링만 채택되는" 조합을 재현하려 했으나(리뷰어가
    // ~40개 파라미터 조합을 스윕) 자연 발생시키지 못했다. 그래서 engine.runForUtility를 stub해
    // Phase 1/2/신규계좌 후보는 baseline과 동점(개선 없음)으로, 채널링 후보만 baseline보다
    // 낫게 만들어 이 분기를 직접 겨냥한다.
    //
    // 이전 구현은 여기서 `{ ...identityPlan, isaMaturityDestination: 'asset' }`을 만들어 돌려줬는데,
    // 그 계획은 한 번도 시뮬레이션되지 않은 조합이었다 — 채널링 후보는 params.withdrawalPlan
    // (이 경로에서는 대개 undefined) 위에서 평가됐고, identityPlan은 그와 다르게 동작한다
    // (같은 파일 :385~389 주석: 동일 params에서 72점 vs 65점). 시뮬레이션되지 않은 계획을
    // 추천안으로 내보내지 않는 것이 새 계약이다.
    const userProfile = { currentAge: 50, retirementAge: 60, expectancy: 60, targetMonthlySpending: 2000000 };
    const params: SimulationParams = {
      userProfile,
      assets: [],
      nationalPension: { expectedMonthlyAmount: 1000000 },
      privatePensions: [
        { id: 'pension-1', type: 'irp', balance: 600000000, monthlyContribution: 0, annualReturn: 2, currency: 'KRW' },
      ],
      isaAccounts: [
        { id: 'isa-1', type: 'general', balance: 10000000, monthlyContribution: 0, annualReturn: 6, dividendYield: 0, currency: 'KRW', maturityYears: 99 },
      ],
      otherIncomes: [],
      inflationRate: 0,
      inflationMode: 'real',
      baseExchangeRate: 1350,
      exchangeScenario: 'base',
      displayCurrency: 'KRW',
    };

    // 목표 연간 생활비를 정확히 충족하는 결과 — baseline과 모든 Phase 1/2/신규계좌 후보를
    // 서로 동점(개선 없음)으로 묶는다.
    //
    // 고정된 spending을 돌려주면 안 된다. Phase 2의 생활비 배수 후보는 목표 자체를
    // 스케일링하므로(0.8배 후보의 목표는 1,600,000원), 고정값은 그 후보에서 목표 대비 125%
    // 소비로 읽혀 자동으로 이겨 버린다 — 이 테스트가 세우려는 "동점" 전제가 깨진다.
    const tiedResultFor = (candidateParams: SimulationParams): SimulationResult => makeSimulationResult(
      [makeYearlyResult({ age: 60, spending: candidateParams.userProfile.targetMonthlySpending * 12 })],
      0
    );
    // baseline보다 Utility 점수가 확실히 높은 결과 — 채널링 후보 전용.
    //
    // 예전에는 목표 대비 125% 소비(spending 30,000,000)로 consumption 축을 올렸다. 지금은
    // 목표를 채운 해가 만점이고 초과 소비에 보상이 없어(consumptionYearUtility) 그 방법으로는
    // baseline과 동점이 된다. 대신 잔여자산을 적정선(월 목표 × appropriateBequestMonths = 24)에
    // 정확히 맞춰 bequestAdequacy 축에서 이기게 한다. 배수 후보들은 endingAssets가 0이라
    // 이 축에서 baseline과 계속 동점이므로 "채널링만 유일하게 개선"이라는 전제가 유지된다.
    const channelingResult: SimulationResult = makeSimulationResult(
      [makeYearlyResult({ age: 60, spending: userProfile.targetMonthlySpending * 12 })],
      userProfile.targetMonthlySpending * DEFAULT_UTILITY_CONFIG.appropriateBequestMonths
    );

    const engine = new SimulationEngine();
    // PrivatePensionChannelingOptimizer.buildChannelingParams만 privatePensions 각 계좌에
    // earlyChannelingEnabled: true를 설정한다(신규계좌 레그/Phase 1/2 후보는 설정하지 않음) —
    // 이 필드로 채널링 후보만 식별해 다른 결과를 반환한다.
    engine.runForUtility = vi.fn((candidateParams: SimulationParams): SimulationResult => {
      const isChannelingCandidate = candidateParams.privatePensions.some((p) => p.earlyChannelingEnabled === true);
      return isChannelingCandidate ? channelingResult : tiedResultFor(candidateParams);
    });

    const result = recommendStrategy(params, engine);

    // 전제 확인: 채널링이 채택되었다.
    expect(result.recommendedPrivatePensionChanneling).toBe(true);
    expect(result.recommendedUtility.score).toBeGreaterThan(result.currentUtility.score);

    // 본 assertion: 시뮬레이션되지 않은 계획을 지어내지 않는다.
    expect(result.recommendedPlan).toBeNull();
    // 대신 ISA 만기 자금을 일반 자산으로 옮기라는 지시는 채널링 항목 라벨을 통해 전달된다
    // (이 라벨은 reasons/체크리스트/PDF/AI 프롬프트로 그대로 흘러간다).
    expect(result.reasons.some((r) => r.includes('ISA 만기 자금은 일반 자산으로 이전'))).toBe(true);
  });

  test('retirementAge가 55 이하이면 채널링 후보 자체가 생성되지 않는다', () => {
    const engine = new SimulationEngine();
    const params: SimulationParams = {
      ...paramsWithLargePension,
      userProfile: { ...paramsWithLargePension.userProfile, currentAge: 50, retirementAge: 55, expectancy: 90 },
      isaAccounts: [
        { id: 'isa-1', type: 'general', balance: 10000000, monthlyContribution: 0, annualReturn: 6, dividendYield: 0, currency: 'KRW', maturityYears: 99 },
      ],
    };

    const result = recommendStrategy(params, engine);
    expect(result.recommendedPrivatePensionChanneling).toBeNull();
  });

  test('채널링이 채택되면 recommendedPlan에도 isaMaturityDestination 변경이 반영된다', () => {
    // Phase 4가 채택되는 위 테스트와 동일한 픽스처를 재사용한다.
    const engine = new SimulationEngine();
    const params: SimulationParams = {
      ...paramsWithLargePension,
      userProfile: { ...paramsWithLargePension.userProfile, currentAge: 50, retirementAge: 60, expectancy: 90, targetMonthlySpending: 25000000 },
      privatePensions: [
        { id: 'pension-1', type: 'irp', balance: 600000000, monthlyContribution: 0, annualReturn: 2, currency: 'KRW' },
      ],
      isaAccounts: [
        { id: 'isa-1', type: 'general', balance: 10000000, monthlyContribution: 0, annualReturn: 6, dividendYield: 0, currency: 'KRW', maturityYears: 99 },
      ],
    };

    const result = recommendStrategy(params, engine);

    expect(result.recommendedPrivatePensionChanneling).toBe(true);
    // 후보 시뮬레이션이 전제한 값이 추천안에도 실제로 담겨야 한다 —
    // 그렇지 않으면 사용자가 체크리스트대로 해도 표시된 수치가 재현되지 않는다.
    expect(result.recommendedPlan?.isaMaturityDestination).toBe('asset');
  });
});
