import { describe, test, expect } from 'vitest';
import { applyAiSentinels } from '@/core/usecases/strategy/applyAiSentinels';
import { compileStrategy, DEFAULT_RETIREMENT_STRATEGY } from '@/core/usecases/strategy/compileStrategy';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
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

function makeRecommendation(
  recommendedPlan: CompleteWithdrawalPlan | null,
  improved = true
): StrategyRecommendation {
  return {
    currentUtility: utility,
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
    expect(appliedResult.endingAssets).toBe(directResult.endingAssets);
    expect(JSON.stringify(appliedResult.yearlyResults)).toBe(JSON.stringify(directResult.yearlyResults));
  });

  test('센티널을 채우면 baseline(65세)과 결과가 달라진다', () => {
    const engine = new SimulationEngine();
    const compiled = compiledFor('ai_optimized');

    const baseline = engine.run(compiled.params, compiled.utilityConfig);
    const applied = applyAiSentinels(compiled, makeRecommendation(plan(70)));
    const appliedResult = engine.run(applied.params, applied.utilityConfig);

    // 빈 배열끼리 비교하면 "[]" === "[]"로 무의미하게 통과하므로 먼저 내용이 있는지 확인한다.
    expect(baseline.yearlyResults.length).toBeGreaterThan(0);

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
