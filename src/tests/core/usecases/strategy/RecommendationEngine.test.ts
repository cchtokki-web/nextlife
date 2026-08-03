import { describe, test, expect, vi } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import {
  recommendStrategy,
  buildReasons,
  computeDeltas,
  computeItemizedContributions,
} from '@/core/usecases/strategy/RecommendationEngine';
import { generateCandidatePlans, getIdentityPlan } from '@/core/usecases/strategy/StrategyCandidateGenerator';
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
const paramsWithSurplusAssetOnly: SimulationParams = {
  userProfile: { currentAge: 60, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3000000 },
  assets: [
    {
      id: 'a1',
      type: 'etf',
      ticker: 'AAA',
      name: '고배당 자산',
      quantity: 10000,
      averagePrice: 50000,
      annualGrowthRate: 5,
      dividendYield: 3,
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

// 자산이 목표 생활비를 감당하기에 턱없이 부족해 은퇴 시작과 동시에 고갈되는 시나리오.
const paramsWithDepletionRisk: SimulationParams = {
  ...paramsWithSurplusAssetOnly,
  assets: [{ ...paramsWithSurplusAssetOnly.assets[0], quantity: 200 }],
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
    // Phase 2(생활비 증액) 후보가 0개임을 확인하는 것이 이 테스트의 취지다. totalCandidateCount에는
    // Phase 3(배당 재투자)의 시도량(assets.length)이 더해진다. Phase 4는 실제로 실행한 시뮬레이션
    // 횟수만 더하는데, 이 시나리오는 사적연금이 없어 두 레그 모두 평가되지 않으므로 0이다.
    const baseCandidateCount = generateCandidatePlans(paramsWithDepletionRisk).length;

    expect(recommendation.totalCandidateCount).toBe(baseCandidateCount + paramsWithDepletionRisk.assets.length);
    expect(recommendation.recommendedPlan?.monthlySpendingMultiplier ?? 1).toBe(1);
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

  // B5: 고갈 판정 기준은 본인 기대수명이 아니라 가구 종료 나이다. 장수 배우자가 있으면
  // 본인 기대수명 이후·가구 종료 이전에 파산하는 계획이 "고갈 위험 없음"으로 통과해
  // 생활비를 더 늘리라는 추천을 받는다.
  test('배우자 단독 생존 구간에 고갈되는 baseline에서는 생활비 증액 후보를 생성하지 않는다', () => {
    const engine = new SimulationEngine();
    const params: SimulationParams = {
      ...paramsWithSurplusAssetOnly,
      assets: [{ ...paramsWithSurplusAssetOnly.assets[0], quantity: 9000 }],
      spouse: {
        enabled: true, currentAge: 50, expectancy: 95,
        nationalPensionMonthlyAmount: 0, nationalPensionStartAge: 65,
      },
    };

    const baseline = engine.runForUtility(params);
    // 전제: 본인 기대수명(90)은 넘겼지만 가구 종료(105) 전에 고갈된다.
    expect(baseline.depletionAge!).toBeGreaterThan(params.userProfile.expectancy);
    expect(baseline.depletionAge!).toBeLessThan(baseline.householdEndAge);

    const recommendation = recommendStrategy(params, engine);
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

describe('recommendStrategy - nationalPensionOnlyUtility', () => {
  test('추천 나이만 사용자의 실제 인출계획에 얹은 효용을 계산한다', () => {
    const engine = new SimulationEngine();
    const recommendation = recommendStrategy(paramsWithOptimizableHeadroom, engine);
    expect(recommendation.improved).toBe(true);

    const recommendedAge = recommendation.recommendedPlan?.nationalPensionStartAge;
    expect(typeof recommendedAge).toBe('number');

    const currentAge = paramsWithOptimizableHeadroom.withdrawalPlan?.nationalPensionStartAge ?? 65;
    // 이 픽스처에서 추천 나이가 baseline과 같아지면 아래 단언이 무의미해진다.
    expect(recommendedAge).not.toBe(currentAge);
    expect(recommendation.nationalPensionOnlyUtility).not.toBeNull();

    // 기준점이 identityPlan이 아니라 "사용자의 params + 나이만 교체"임을 직접 재현해 확인한다.
    // identityPlan 기준이면 privatePensionMonthlyTarget 등 다른 필드까지 함께 바뀌어
    // 다른 점수가 나온다.
    const onlyAgeParams: SimulationParams = {
      ...paramsWithOptimizableHeadroom,
      withdrawalPlan: {
        ...(paramsWithOptimizableHeadroom.withdrawalPlan ?? {}),
        nationalPensionStartAge: recommendedAge,
      },
    };
    const expected = computeLifetimeUtility(
      engine.runForUtility(onlyAgeParams),
      onlyAgeParams,
      DEFAULT_UTILITY_CONFIG
    );

    expect(recommendation.nationalPensionOnlyUtility?.score).toBe(expected.score);
    expect(recommendation.nationalPensionOnlyUtility?.components).toEqual(expected.components);
  });

  test('개선안이 없으면 null이다', () => {
    const engine = new SimulationEngine();
    const noOptimizableDimensionParams: SimulationParams = {
      ...paramsWithLargePension,
      privatePensions: [],
      nationalPension: { expectedMonthlyAmount: 0 },
    };
    const recommendation = recommendStrategy(noOptimizableDimensionParams, engine);
    expect(recommendation.improved).toBe(false);
    expect(recommendation.nationalPensionOnlyUtility).toBeNull();
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

function makeYearlyResult(overrides: Partial<SimulationYearlyResult>): SimulationYearlyResult {
  return {
    age: 60,
    year: 2026,
    totalAssets: 0,
    stockAssets: 0,
    pensionAssets: 0,
    dividendIncome: 0,
    nationalPensionIncome: 0,
    privatePensionIncome: 0,
    pensionIncome: 0,
    otherIncome: 0,
    totalIncome: 0,
    preTaxTotalIncome: 0,
    dividendTaxPaid: 0,
    pensionTaxPaid: 0,
    nationalPensionTaxPaid: 0,
    healthInsurancePaid: 0,
    healthInsuranceIncomeBasis: 0,
    comprehensiveTaxPaid: 0,
    privatePensionTaxMethod: 'none',
    spending: 0,
    healthcareSpending: 0,
    hasTaxWarning: false,
    spouseAlive: false,
    spendingFactor: 1,
    ...overrides,
  };
}

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
    householdEndAge: 90,
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

  test('탐색할 차원이 전혀 없으면 총 후보 수는 0이다', () => {
    const engine = new SimulationEngine();
    const noOptimizableDimensionParams: SimulationParams = {
      ...paramsWithLargePension,
      privatePensions: [],
      nationalPension: { expectedMonthlyAmount: 0 },
    };
    const recommendation = recommendStrategy(noOptimizableDimensionParams, engine);

    // Phase 1/2/3은 탐색할 차원이 전혀 없어 0개이고, Phase 4도 사적연금이 없어(hasPension false)
    // 시뮬레이션을 한 번도 실행하지 않으므로 0이다. 예전에는 Phase 4가 전제 조건 미충족이어도
    // 무조건 +1을 더해, AI advisor의 "전부 실패" 판정(failed === total)이 성립할 수 없었다.
    expect(recommendation.totalCandidateCount).toBe(0);
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
    // 이 fixture는 실제 엔진에서 결정론적으로 asset-1만 재투자 중단(false)이 유리하다고 판단한다
    // (asset-0은 index 0이라 flip해도 무효과이므로 beneficial 목록에 들어가지 않는다).
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
    // 인출계획 그리드로는 개선이 없도록(사적연금·국민연금·ISA 없음, 두 자산의 배당수익률을 동일하게
    // 두어 매도순서 차원도 무효화, 은퇴기간을 짧게 두어 매도순서 절세 효과도 없음) 설계하되,
    // 축적기(currentAge 25 < retirementAge 65)가 길어 asset-1(저성장·고배당)의 배당을 고성장
    // asset-0으로 흘려보내는 재투자 중단이 유리해지도록 성장률 격차를 크게 둔다. 그 결과 bestPlan은
    // null(인출계획 미개선)이지만 Phase 3는 asset-1 재투자 중단을 추천한다 —
    // reasons 3-way 병합의 가운데 분기(withdrawalPlanImproved===false && additionalReasons.length>0).
    const engine = new SimulationEngine();
    const phase3OnlyParams: SimulationParams = {
      userProfile: { currentAge: 25, retirementAge: 65, expectancy: 70, targetMonthlySpending: 2000000 },
      assets: [
        {
          id: 'asset-0',
          type: 'etf',
          ticker: 'GROWTH',
          name: '성장자산',
          quantity: 1,
          averagePrice: 30000000,
          annualGrowthRate: 12,
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
    expect(result.recommendedAssetReinvestment).toEqual({ 'asset-1': false });
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

    // 목표 연간 생활비(2,000,000 * 12 = 24,000,000)를 정확히 충족하는 결과 — baseline과 모든
    // Phase 1/2/신규계좌 후보에 대해 이 값을 반환해 서로 동점(개선 없음)으로 묶는다.
    const tiedResult: SimulationResult = makeSimulationResult(
      [makeYearlyResult({ age: 60, spending: 24000000 })],
      0
    );
    // 목표 대비 125% 소비(consumption 컴포넌트만 더 높음, 다른 컴포넌트는 동일하게 유지)로
    // baseline보다 Utility 점수가 확실히 높은 결과 — 채널링 후보 전용.
    const channelingResult: SimulationResult = makeSimulationResult(
      [makeYearlyResult({ age: 60, spending: 30000000 })],
      0
    );

    const engine = new SimulationEngine();
    // PrivatePensionChannelingOptimizer.buildChannelingParams만 privatePensions 각 계좌에
    // earlyChannelingEnabled: true를 설정한다(신규계좌 레그/Phase 1/2 후보는 설정하지 않음) —
    // 이 필드로 채널링 후보만 식별해 다른 결과를 반환한다.
    engine.runForUtility = vi.fn((candidateParams: SimulationParams): SimulationResult => {
      const isChannelingCandidate = candidateParams.privatePensions.some((p) => p.earlyChannelingEnabled === true);
      return isChannelingCandidate ? channelingResult : tiedResult;
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
