import { describe, test, expect } from 'vitest';
import { applyAiSentinels } from '@/core/usecases/strategy/applyAiSentinels';
import { compileStrategy, DEFAULT_RETIREMENT_STRATEGY } from '@/core/usecases/strategy/compileStrategy';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { recommendStrategy } from '@/core/usecases/strategy/RecommendationEngine';
import {
  CompleteWithdrawalPlan, NationalPensionStrategy, SimulationParams, StrategyRecommendation,
  UtilityBreakdown,
} from '@/core/entities/types';

const baseParams: SimulationParams = {
  userProfile: { currentAge: 50, retirementAge: 60, expectancy: 85, targetMonthlySpending: 3000000 },
  assets: [
    {
      id: 'a1', type: 'etf', ticker: 'X', name: 'X', quantity: 1000, averagePrice: 100000,
      annualGrowthRate: 7, dividendYield: 2, monthlyContribution: 0,
      reinvestDividend: false, currency: 'KRW',
    },
  ],
  nationalPension: { expectedMonthlyAmount: 1000000 },
  privatePensions: [],
  otherIncomes: [],
  inflationRate: 2.5,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

const compiledFor = (nationalPensionStrategy: NationalPensionStrategy) =>
  compileStrategy({
    ...baseParams,
    strategy: { ...DEFAULT_RETIREMENT_STRATEGY, nationalPensionStrategy },
  });

const utility: UtilityBreakdown = {
  score: 76,
  components: {
    consumption: 27, depletionSafety: 20, pensionUtilization: 13,
    taxEfficiency: 8, taxationRisk: 8, bequestAdequacy: 0,
  },
};

const plan = (nationalPensionStartAge: number): CompleteWithdrawalPlan => ({
  privatePensionMonthlyTarget: 0,
  nationalPensionStartAge,
  assetSellOrderStrategy: 'input_order',
  isaMaturityDestination: 'pension',
  generalAssetWithdrawalStartAge: 60,
  monthlySpendingMultiplier: 1,
});

const utilityWithScore = (score: number): UtilityBreakdown => ({ ...utility, score });

function makeRecommendation(
  recommendedPlan: CompleteWithdrawalPlan | null,
  improved = true,
  // 추천 나이만 사용자의 실제 인출계획에 얹었을 때의 효용. 기본값은 baseline(utility)보다
  // 높게 둬서, 이 인자를 신경 쓰지 않는 기존 테스트들이 "적용되는" 경로를 그대로 타게 한다.
  nationalPensionOnlyUtility: UtilityBreakdown | null = utilityWithScore(utility.score + 1)
): StrategyRecommendation {
  return {
    currentUtility: utility,
    nationalPensionOnlyUtility,
    recommendedUtility: utility,
    recommendedPlan,
    recommendedAssetReinvestment: null,
    recommendedPrivatePensionChanneling: null,
    recommendedNewPensionContribution: null,
    channelingIncludesAccountTransfer: false,
    improved,
    reasons: [],
    deltas: {
      lifetimeConsumption: 0, totalTax: 0, endingAssets: 0, pensionEndingBalance: 0,
      comprehensiveTaxYears: 0, healthInsuranceTotal: 0, nationalPensionTotal: 0,
    },
    totalCandidateCount: 0,
    failedCandidateCount: 0,
    recommendedResult: {
      yearlyResults: [], fireAge: null, depletionAge: null, endingAssets: 0,
      retirementScore: 0, retirementGrade: '보통', goalAchievementRate: 100,
      retirementAssetsAtRetirement: 0, householdEndAge: 90,
    },
    itemizedContributions: [],
  };
}

describe('applyAiSentinels', () => {
  test("nationalPensionStrategy가 'ai_optimized'이면 추천 나이로 채운다", () => {
    const compiled = compiledFor('ai_optimized');
    expect(compiled.params.withdrawalPlan?.nationalPensionStartAge).toBe(65);

    const applied = applyAiSentinels(compiled, makeRecommendation(plan(68)));

    expect(applied.params.withdrawalPlan?.nationalPensionStartAge).toBe(68);
  });

  test('추천 나이만 얹었을 때 효용이 baseline보다 낮으면 채우지 않는다', () => {
    // 추천 격자는 6개 필드를 함께 최적화하므로, 그중 국민연금 나이 하나만 떼어 사용자의
    // 계획에 이식하면 한 번도 시뮬레이션된 적 없는 조합이 된다. 그 조합이 baseline보다
    // 나쁠 수 있고, 그때 자동 채움은 "AI 적용"이라는 이름으로 결과를 악화시킨다.
    const compiled = compiledFor('ai_optimized');
    const worse = makeRecommendation(plan(60), true, utilityWithScore(utility.score - 1));

    expect(applyAiSentinels(compiled, worse)).toBe(compiled);
  });

  test('추천 나이만 얹었을 때 효용이 baseline과 같으면 채우지 않는다', () => {
    // 개선이 없는데 참조를 새로 만들면 page.tsx의 하위 useMemo가 전부 무효화되어
    // 이 화면에서 가장 무거운 렌더가 이유 없이 다시 돈다.
    const compiled = compiledFor('ai_optimized');
    const flat = makeRecommendation(plan(60), true, utilityWithScore(utility.score));

    expect(applyAiSentinels(compiled, flat)).toBe(compiled);
  });

  test('단일 축 효용을 계산하지 못했으면(null) 채우지 않는다', () => {
    // 시뮬레이션 실패 등으로 판단 근거가 없을 때는 보수적으로 사용자 계획을 그대로 둔다.
    const compiled = compiledFor('ai_optimized');
    const unknown = makeRecommendation(plan(68), true, null);

    expect(applyAiSentinels(compiled, unknown)).toBe(compiled);
  });

  test('확정 enum이면 추천이 있어도 채우지 않는다', () => {
    const compiled = compiledFor('defer_max');
    const applied = applyAiSentinels(compiled, makeRecommendation(plan(68)));

    expect(applied).toBe(compiled);
    expect(applied.params.withdrawalPlan?.nationalPensionStartAge).toBe(70);
  });

  test('추천이 없으면 입력 참조를 그대로 반환한다', () => {
    const compiled = compiledFor('ai_optimized');
    expect(applyAiSentinels(compiled, undefined)).toBe(compiled);
  });

  test('recommendedPlan이 null이면 입력 참조를 그대로 반환한다', () => {
    const compiled = compiledFor('ai_optimized');
    expect(applyAiSentinels(compiled, makeRecommendation(null))).toBe(compiled);
  });

  test('improved가 false이면 입력 참조를 그대로 반환한다', () => {
    const compiled = compiledFor('ai_optimized');
    expect(applyAiSentinels(compiled, makeRecommendation(plan(68), false))).toBe(compiled);
  });

  test('추천 나이가 이미 컴파일된 값과 같으면 입력 참조를 그대로 반환한다', () => {
    const compiled = compiledFor('ai_optimized');
    expect(applyAiSentinels(compiled, makeRecommendation(plan(65)))).toBe(compiled);
  });

  test('strategy 필드가 없는 통과 경로(compileStrategy)에서는 센티널을 채우지 않는다', () => {
    // baseParams에는 strategy가 없으므로 compileStrategy는 통과 경로를 타 params를
    // 그대로 반환한다(withdrawalPlan도 undefined).
    //
    // 이때 params.strategy가 아니라 resolveStrategy로 판정하면 안 된다 —
    // DEFAULT_RETIREMENT_STRATEGY의 nationalPensionStrategy가 'ai_optimized'라서
    // "AI에게 맡기겠다고 고른 적 없는" 시나리오까지 센티널 사용자로 오인하게 된다.
    const compiled = compileStrategy(baseParams);
    expect(compiled.params.withdrawalPlan).toBeUndefined();

    // 65세(= 엔진 기본값)가 아닌 나이를 추천해야 "조건에서 걸러졌는가"와 "나이가 같아서
    // 반환됐는가"가 구분된다. plan(65)로는 두 경로가 같은 결과를 내 검증력이 없다.
    const applied = applyAiSentinels(compiled, makeRecommendation(plan(70)));

    expect(applied).toBe(compiled);
  });

  test('통과 경로에 사용자가 저장해 둔 수령 나이가 있으면 추천값으로 덮어쓰지 않는다', () => {
    // compileStrategy의 통과 경로는 "새 기능을 하나도 켜지 않은 시나리오는 입력이 비트
    // 단위로 보존된다"를 보장한다. 이 함수가 그 보장을 깨면, 전략 컴파일러 이전에 저장된
    // 시나리오를 열기만 해도 사용자가 직접 고른 개시 나이가 조용히 바뀐다.
    const compiled = compileStrategy({
      ...baseParams,
      withdrawalPlan: { nationalPensionStartAge: 62 },
    });
    expect(compiled.params.strategy).toBeUndefined();
    expect(compiled.params.withdrawalPlan?.nationalPensionStartAge).toBe(62);

    const applied = applyAiSentinels(compiled, makeRecommendation(plan(68)));

    expect(applied).toBe(compiled);
    expect(applied.params.withdrawalPlan?.nationalPensionStartAge).toBe(62);
  });

  test('withdrawalPlan의 다른 필드와 utilityConfig는 보존된다', () => {
    const compiled = compileStrategy({
      ...baseParams,
      withdrawalPlan: { generalAssetWithdrawalStartAge: 62 },
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, nationalPensionStrategy: 'ai_optimized' },
    });

    const applied = applyAiSentinels(compiled, makeRecommendation(plan(68)));

    expect(applied.params.withdrawalPlan?.generalAssetWithdrawalStartAge).toBe(62);
    expect(applied.params.withdrawalPlan?.isaMaturityDestination).toBe('pension');
    expect(applied.utilityConfig).toBe(compiled.utilityConfig);
  });

  test('params의 다른 최상위 필드는 그대로 유지된다', () => {
    const compiled = compiledFor('ai_optimized');
    const applied = applyAiSentinels(compiled, makeRecommendation(plan(68)));

    expect(applied.params.userProfile).toBe(compiled.params.userProfile);
    expect(applied.params.assets).toBe(compiled.params.assets);
    expect(applied.params.strategy).toBe(compiled.params.strategy);
  });
});

describe('applyAiSentinels 통합 — 실제 추천 엔진', () => {
  // 합성 utility가 아니라 recommendStrategy가 실제로 만든 추천으로 검증한다.
  // 위 단위 테스트들은 게이트 "로직"이 맞는지만 보고, 이 테스트는 게이트가 실제 데이터에서
  // 걸리는 일이 있는지 — 즉 이 방어가 무의미한 항상-참이 아닌지 — 를 지킨다.
  const engineParams: SimulationParams = {
    ...baseParams,
    // 조기 은퇴 + 높은 생활비. 그리드는 전체 조합으로 큰 개선(39 → 60)을 찾지만, 그 조합에서
    // 국민연금 나이만 떼어 내면 오히려 baseline보다 나빠진다. 자동 채움이 막아야 하는 경우다.
    userProfile: { currentAge: 45, retirementAge: 50, expectancy: 90, targetMonthlySpending: 4000000 },
    strategy: { ...DEFAULT_RETIREMENT_STRATEGY, nationalPensionStrategy: 'ai_optimized' },
  };

  test('나이 축만 떼어 내면 악화되는 추천은 자동 채움하지 않는다', () => {
    const engine = new SimulationEngine();
    const compiled = compileStrategy(engineParams);
    const recommendation = recommendStrategy(compiled.params, engine, compiled.utilityConfig);

    // 전제: 추천은 개선을 주장하고, 그 나이는 baseline과 다르다.
    expect(recommendation.improved).toBe(true);
    expect(recommendation.recommendedPlan?.nationalPensionStartAge)
      .not.toBe(compiled.params.withdrawalPlan?.nationalPensionStartAge);

    // 전제: 단일 축만 적용하면 실제로 개선이 아니다(이 테스트의 존재 이유).
    const only = recommendation.nationalPensionOnlyUtility;
    expect(only).not.toBeNull();
    expect(only!.score).toBeLessThanOrEqual(recommendation.currentUtility.score);

    // 그러므로 채우지 않는다 — 참조까지 그대로다.
    expect(applyAiSentinels(compiled, recommendation)).toBe(compiled);
  });

  test('자동 채움을 거른 계획의 효용은 baseline보다 낮아지지 않는다', () => {
    const engine = new SimulationEngine();
    const compiled = compileStrategy(engineParams);
    const recommendation = recommendStrategy(compiled.params, engine, compiled.utilityConfig);
    const effective = applyAiSentinels(compiled, recommendation);

    const baseline = engine.run(compiled.params, compiled.utilityConfig);
    const applied = engine.run(effective.params, effective.utilityConfig);

    expect(typeof baseline.utility?.score).toBe('number');
    expect(applied.utility!.score).toBeGreaterThanOrEqual(baseline.utility!.score);
  });
});

describe('applyAiSentinels 통합', () => {
  test('센티널을 채운 결과가 나이를 직접 지정한 params의 결과와 동일하다', () => {
    const engine = new SimulationEngine();

    const sentinel = compiledFor('ai_optimized');
    const applied = applyAiSentinels(sentinel, makeRecommendation(plan(68)));
    const appliedResult = engine.run(applied.params, applied.utilityConfig);

    // 같은 나이를 withdrawalPlan에 직접 넣은 경우. compileStrategy가 센티널을 65로 덮으므로
    // 컴파일 뒤에 넣어야 한다 — 컴파일 전에 넣으면 그 값이 다시 65로 뒤집힌다.
    const direct = compiledFor('ai_optimized');
    const directResult = engine.run(
      {
        ...direct.params,
        withdrawalPlan: { ...(direct.params.withdrawalPlan ?? {}), nationalPensionStartAge: 68 },
      },
      direct.utilityConfig
    );

    // 필드가 실제로 존재하는지 먼저 확인한다. SimulationResult.utility는 UtilityBreakdown
    // ({ score, components })이고 totalScore 같은 필드는 없다 — 없는 필드를 비교하면
    // undefined === undefined로 무의미하게 통과한다.
    expect(typeof appliedResult.utility?.score).toBe('number');

    expect(appliedResult.utility?.score).toBe(directResult.utility?.score);
    // score만으로는 집계값이라 변별력이 약할 수 있어 components까지 비교해 강화한다.
    expect(appliedResult.utility?.components).toEqual(directResult.utility?.components);
    // endingAssets는 비교하지 않는다 — 이 픽스처는 66세경 자산이 완전 소진되어 항상 0으로
    // 고정되므로, applyAiSentinels가 완전히 망가져 no-op이 되어도 이 값은 통과해 버린다.
    // 바로 아래 yearlyResults 비교가 이 검증을 온전히 대신한다.
    expect(JSON.stringify(appliedResult.yearlyResults)).toBe(JSON.stringify(directResult.yearlyResults));
  });

  test('센티널을 채우면 baseline(65세)과 결과가 달라진다', () => {
    const engine = new SimulationEngine();
    const compiled = compiledFor('ai_optimized');

    const baseline = engine.run(compiled.params, compiled.utilityConfig);
    const applied = applyAiSentinels(compiled, makeRecommendation(plan(70)));
    const appliedResult = engine.run(applied.params, applied.utilityConfig);

    // 빈 배열끼리 비교하면 "[]" === "[]"로 무의미하게 통과하므로 먼저 내용이 있는지 확인한다.
    // 한쪽만 비어 있어도 .not.toBe는 통과해 버리므로 양쪽 모두 확인해야 한다.
    expect(baseline.yearlyResults.length).toBeGreaterThan(0);
    expect(appliedResult.yearlyResults.length).toBeGreaterThan(0);

    // endingAssets는 이 시나리오에서 지표가 되지 못한다 — 자산이 66세경 완전 소진되어
    // 국민연금을 언제 받든 65세/70세 모두 0으로 고정된다. 연도별 결과 전체를 비교해야
    // "자동 채움이 시뮬레이션을 실제로 바꿨다"를 검증할 수 있다.
    expect(JSON.stringify(appliedResult.yearlyResults))
      .not.toBe(JSON.stringify(baseline.yearlyResults));
  });

  test('센티널을 채워도 원본 compiled는 변형되지 않는다(되먹임 방지)', () => {
    const compiled = compiledFor('ai_optimized');
    const before = compiled.params.withdrawalPlan?.nationalPensionStartAge;

    applyAiSentinels(compiled, makeRecommendation(plan(68)));

    // 추천 계산(recommendStrategy)의 입력은 언제나 이 원본이다. 여기가 오염되면
    // 다음 추천이 이미 적용된 값 위에서 계산되어 되먹임이 시작된다.
    expect(compiled.params.withdrawalPlan?.nationalPensionStartAge).toBe(before);
    expect(before).toBe(65);
  });
});
