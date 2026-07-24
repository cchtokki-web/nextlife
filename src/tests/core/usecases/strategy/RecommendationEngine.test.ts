import { describe, test, expect } from 'vitest';
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

// 배당 자산만 있고 사적연금/국민연금이 없어, 6차원 그리드(인출 시점/순서)로는 사망 시
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
  test('6차원 탐색으로 해소되지 않는 잔여자산 과다는 생활비 증액 후보로 개선된다', () => {
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
    const baseCandidateCount = generateCandidatePlans(paramsWithDepletionRisk).length;

    expect(recommendation.totalCandidateCount).toBe(baseCandidateCount);
    expect(recommendation.recommendedPlan?.monthlySpendingMultiplier ?? 1).toBe(1);
  });

  test("spendingStrategy가 'target'이 아니면 생활비 증액 후보를 생성하지 않는다", () => {
    const engine = new SimulationEngine();
    const params: SimulationParams = { ...paramsWithSurplusAssetOnly, spendingStrategy: 'max_sustainable' };
    const recommendation = recommendStrategy(params, engine);
    const baseCandidateCount = generateCandidatePlans(params).length;

    expect(recommendation.totalCandidateCount).toBe(baseCandidateCount);
  });
});

describe('recommendStrategy - recommendedResult', () => {
  test('improved가 true면 recommendedResult가 baseline과 다른 연도별 결과를 담는다', () => {
    const engine = new SimulationEngine();
    const recommendation = recommendStrategy(paramsWithLargePension, engine);
    expect(recommendation.improved).toBe(true);

    const baseline = engine.runForUtility(paramsWithLargePension);
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
    const recommendation = recommendStrategy(paramsWithLargePension, engine);
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
    comprehensiveTaxPaid: 0,
    privatePensionTaxMethod: 'none',
    spending: 0,
    hasTaxWarning: false,
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

    expect(reasons).toEqual(['현재 전략이 이미 Lifetime Utility 관점에서 충분히 합리적이어서 별도로 추천할 변경 사항이 없습니다.']);
  });

  test('identityPlan과 값이 같은 필드는(실제로는 바뀐 게 없으므로) 문구를 생성하지 않는다', () => {
    const identityPlan: CompleteWithdrawalPlan = {
      privatePensionStartAge: 60,
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
    expect(reasons).toEqual(['현재 전략이 이미 Lifetime Utility 관점에서 충분히 합리적이어서 별도로 추천할 변경 사항이 없습니다.']);
  });

  test('후보가 있었지만 모두 baseline보다 낮으면(정상 평가) "이미 합리적" 문구를 반환한다', () => {
    const reasons = buildReasons(null, zeroDeltas, false, { total: 12, failed: 0 });
    expect(reasons).toEqual(['현재 전략이 이미 Lifetime Utility 관점에서 충분히 합리적이어서 별도로 추천할 변경 사항이 없습니다.']);
  });

  test('후보가 전부 시뮬레이션 실패로 평가되지 못했으면 별도 문구를 반환한다', () => {
    const reasons = buildReasons(null, zeroDeltas, false, { total: 12, failed: 12 });
    expect(reasons).toEqual(['전략 후보를 평가하는 중 모두 오류가 발생해 추천을 계산하지 못했습니다. 현재 전략이 유지됩니다.']);
  });

  test('candidateStats 인자가 없으면 기존과 동일하게 동작한다(하위 호환)', () => {
    const reasons = buildReasons(null, zeroDeltas, false);
    expect(reasons).toEqual(['현재 전략이 이미 Lifetime Utility 관점에서 충분히 합리적이어서 별도로 추천할 변경 사항이 없습니다.']);
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
      { privatePensionStartAge: 65 },
      { ...zeroDeltas, pensionEndingBalance: 30000000 },
      true
    );
    expect(reasons.some((r) => r.includes('연금잔액') && r.includes('증가'))).toBe(true);
  });
});
