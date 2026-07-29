import { describe, test, expect } from 'vitest';
import { generateRuleBasedAdvice } from '@/app/api/ai-advisor/ruleBasedAdvisor';
import { SimulationResult, StrategyRecommendation, UtilityBreakdown } from '@/core/entities/types';

const baseUtility: UtilityBreakdown = {
  score: 76,
  components: { consumption: 27, depletionSafety: 20, pensionUtilization: 13, taxEfficiency: 8, taxationRisk: 10, bequestAdequacy: 0 },
};

const zeroDeltas: StrategyRecommendation['deltas'] = {
  lifetimeConsumption: 0, totalTax: 0, endingAssets: 0, pensionEndingBalance: 0, comprehensiveTaxYears: 0, healthInsuranceTotal: 0, nationalPensionTotal: 0,
};

const emptyResult: SimulationResult = {
  yearlyResults: [],
  fireAge: 65,
  depletionAge: null,
  endingAssets: 0,
  retirementScore: 0,
  retirementGrade: '보통',
  goalAchievementRate: 100,
  retirementAssetsAtRetirement: 0,
};

function makeRecommendation(currentScore: number, recommendedScore: number): StrategyRecommendation {
  const improved = recommendedScore > currentScore;
  return {
    currentUtility: { ...baseUtility, score: currentScore },
    recommendedUtility: { ...baseUtility, score: recommendedScore },
    recommendedPlan: improved ? {
      privatePensionMonthlyTarget: 0,
      nationalPensionStartAge: 65,
      assetSellOrderStrategy: 'input_order',
      isaMaturityDestination: 'pension',
      generalAssetWithdrawalStartAge: 65,
      monthlySpendingMultiplier: 1,
    } : null,
    recommendedAssetReinvestment: null,
    recommendedPrivatePensionChanneling: null,
    recommendedNewPensionContribution: null,
    improved,
    reasons: ['65세부터 일반 자산(주식/ETF) 인출을 시작합니다.'],
    deltas: zeroDeltas,
    totalCandidateCount: 12,
    failedCandidateCount: 0,
    recommendedResult: emptyResult,
    itemizedContributions: [],
  };
}

describe('generateRuleBasedAdvice - Utility Score 반영', () => {
  test('utility/recommendation 미지정 시 기존과 동일하게 2문장만 반환한다', () => {
    const advice = generateRuleBasedAdvice(90, 3000000, false, undefined, null, '매우 안정');
    const sentenceCount = advice.split(/(?<=\.)\s+/).filter(Boolean).length;
    expect(sentenceCount).toBe(2);
  });

  test('추천 전략이 baseline보다 개선되면 Utility 점수 변화 문장을 추가한다', () => {
    const recommendation = makeRecommendation(83, 87);
    const advice = generateRuleBasedAdvice(90, 3000000, false, undefined, null, '매우 안정', baseUtility, recommendation);

    expect(advice).toContain('83');
    expect(advice).toContain('87');
    expect(advice).toContain('평생 효용');
  });

  test('추천 전략이 baseline과 동일하면(개선 없음) 문장을 추가하지 않는다', () => {
    const recommendation = makeRecommendation(83, 83);
    const advice = generateRuleBasedAdvice(90, 3000000, false, undefined, null, '매우 안정', baseUtility, recommendation);

    const sentenceCount = advice.split(/(?<=\.)\s+/).filter(Boolean).length;
    expect(sentenceCount).toBe(2);
  });
});
