import { describe, test, expect } from 'vitest';
import { applyAiSentinels } from '@/core/usecases/strategy/applyAiSentinels';
import { compileStrategy, DEFAULT_RETIREMENT_STRATEGY } from '@/core/usecases/strategy/compileStrategy';
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
