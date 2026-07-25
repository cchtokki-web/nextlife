import { describe, test, expect } from 'vitest';
import { computeExecutionRoadmap } from '@/core/usecases/dashboard/computeExecutionRoadmap';
import {
  CompleteWithdrawalPlan,
  SimulationParams,
  StrategyRecommendation,
  UtilityBreakdown,
} from '@/core/entities/types';

const baseParams: SimulationParams = {
  userProfile: { currentAge: 55, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3000000 },
  assets: [],
  nationalPension: { expectedMonthlyAmount: 1000000 },
  privatePensions: [],
  otherIncomes: [],
  inflationRate: 2,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

const utility: UtilityBreakdown = {
  score: 76,
  components: { consumption: 27, depletionSafety: 20, pensionUtilization: 13, taxEfficiency: 8, taxationRisk: 8, bequestAdequacy: 0 },
};

const zeroDeltas: StrategyRecommendation['deltas'] = {
  lifetimeConsumption: 0,
  totalTax: 0,
  endingAssets: 0,
  pensionEndingBalance: 0,
  comprehensiveTaxYears: 0,
  healthInsuranceTotal: 0,
  nationalPensionTotal: 0,
};

function makeRecommendation(recommendedPlan: CompleteWithdrawalPlan | null): StrategyRecommendation {
  return {
    currentUtility: utility,
    recommendedUtility: utility,
    recommendedPlan,
    improved: recommendedPlan !== null,
    reasons: [],
    deltas: zeroDeltas,
    totalCandidateCount: 0,
    failedCandidateCount: 0,
    recommendedResult: {
      yearlyResults: [],
      fireAge: null,
      depletionAge: null,
      endingAssets: 0,
      retirementScore: 0,
      retirementGrade: '보통',
      goalAchievementRate: 100,
      retirementAssetsAtRetirement: 0,
    },
    itemizedContributions: [],
  };
}

describe('computeExecutionRoadmap', () => {
  test('recommendedPlan이 채워진 경우 4개 이벤트가 정확한 나이/제목으로 생성된다', () => {
    const plan: CompleteWithdrawalPlan = {
      privatePensionStartAge: 63,
      privatePensionMonthlyTarget: 2000000,
      nationalPensionStartAge: 68,
      assetSellOrderStrategy: 'input_order',
      isaMaturityDestination: 'pension',
      generalAssetWithdrawalStartAge: 60,
      monthlySpendingMultiplier: 1,
    };
    const roadmap = computeExecutionRoadmap(baseParams, makeRecommendation(plan), null);

    const ages = roadmap.events.map((e) => e.age);
    expect(ages).toEqual([60, 63, 68]); // 60세: 퇴직+일반자산(같은 나이 병합), 63세: 사적연금, 68세: 국민연금

    const age60 = roadmap.events.find((e) => e.age === 60)!;
    expect(age60.items.map((i) => i.title)).toEqual(['퇴직', '일반자산 인출 개시']);

    const age63 = roadmap.events.find((e) => e.age === 63)!;
    expect(age63.items[0].title).toBe('사적연금 수령 개시');

    const age68 = roadmap.events.find((e) => e.age === 68)!;
    expect(age68.items[0].title).toBe('국민연금 수령 개시 (연기)');
  });

  test('recommendation이 undefined이면 getIdentityPlan(params) 기준으로 폴백한다', () => {
    const roadmap = computeExecutionRoadmap(baseParams, undefined, null);
    // getIdentityPlan: privatePensionStartAge=retirementAge=60, nationalPensionStartAge=65, generalAssetWithdrawalStartAge=60
    const ages = roadmap.events.map((e) => e.age);
    expect(ages).toEqual([60, 65]);
    const age60 = roadmap.events.find((e) => e.age === 60)!;
    expect(age60.items.map((i) => i.title)).toEqual(['퇴직', '일반자산 인출 개시', '사적연금 수령 개시']);
    const age65 = roadmap.events.find((e) => e.age === 65)!;
    expect(age65.items[0].title).toBe('국민연금 수령 개시');
  });

  test('recommendation.recommendedPlan이 null이면(improved: false) getIdentityPlan(params) 기준으로 폴백한다', () => {
    const roadmap = computeExecutionRoadmap(baseParams, makeRecommendation(null), null);
    const ages = roadmap.events.map((e) => e.age);
    expect(ages).toEqual([60, 65]);
  });

  test('국민연금 수령 개시 나이가 65세보다 이르면 "(조기)"를 표기한다', () => {
    const plan: CompleteWithdrawalPlan = {
      privatePensionStartAge: 60,
      privatePensionMonthlyTarget: 0,
      nationalPensionStartAge: 62,
      assetSellOrderStrategy: 'input_order',
      isaMaturityDestination: 'pension',
      generalAssetWithdrawalStartAge: 60,
      monthlySpendingMultiplier: 1,
    };
    const roadmap = computeExecutionRoadmap(baseParams, makeRecommendation(plan), null);
    const age62 = roadmap.events.find((e) => e.age === 62)!;
    expect(age62.items.find((i) => i.title.includes('국민연금'))!.title).toBe('국민연금 수령 개시 (조기)');
  });

  test('국민연금 수령 개시 나이가 정확히 65세면 접미사 없이 표기한다', () => {
    const plan: CompleteWithdrawalPlan = {
      privatePensionStartAge: 60,
      privatePensionMonthlyTarget: 0,
      nationalPensionStartAge: 65,
      assetSellOrderStrategy: 'input_order',
      isaMaturityDestination: 'pension',
      generalAssetWithdrawalStartAge: 60,
      monthlySpendingMultiplier: 1,
    };
    const roadmap = computeExecutionRoadmap(baseParams, makeRecommendation(plan), null);
    const age65 = roadmap.events.find((e) => e.age === 65)!;
    expect(age65.items.find((i) => i.title.includes('국민연금'))!.title).toBe('국민연금 수령 개시');
  });

  test('events는 나이 오름차순으로 정렬된다', () => {
    const plan: CompleteWithdrawalPlan = {
      privatePensionStartAge: 70,
      privatePensionMonthlyTarget: 0,
      nationalPensionStartAge: 62,
      assetSellOrderStrategy: 'input_order',
      isaMaturityDestination: 'pension',
      generalAssetWithdrawalStartAge: 61,
      monthlySpendingMultiplier: 1,
    };
    const roadmap = computeExecutionRoadmap(baseParams, makeRecommendation(plan), null);
    const ages = roadmap.events.map((e) => e.age);
    expect(ages).toEqual([...ages].sort((a, b) => a - b));
    expect(ages).toEqual([60, 61, 62, 70]);
  });

  test('expectancy는 params.userProfile.expectancy 그대로 반환된다', () => {
    const roadmap = computeExecutionRoadmap(baseParams, undefined, null);
    expect(roadmap.expectancy).toBe(90);
  });

  test('depletionAge가 있으면 "자산 고갈 예상" 이벤트가 severity: warning으로 추가된다', () => {
    const roadmap = computeExecutionRoadmap(baseParams, undefined, 78);
    const age78 = roadmap.events.find((e) => e.age === 78)!;
    expect(age78).toBeDefined();
    expect(age78.items).toEqual([
      {
        title: '자산 고갈 예상',
        description: '누적 자산이 모두 소진되어 목표 생활비를 유지하기 어려워질 것으로 예상됩니다.',
        severity: 'warning',
      },
    ]);
  });

  test('depletionAge가 다른 이벤트와 같은 나이면 같은 노드로 병합된다', () => {
    const plan: CompleteWithdrawalPlan = {
      privatePensionStartAge: 60,
      privatePensionMonthlyTarget: 0,
      nationalPensionStartAge: 65,
      assetSellOrderStrategy: 'input_order',
      isaMaturityDestination: 'pension',
      generalAssetWithdrawalStartAge: 60,
      monthlySpendingMultiplier: 1,
    };
    const roadmap = computeExecutionRoadmap(baseParams, makeRecommendation(plan), 60);
    const age60 = roadmap.events.find((e) => e.age === 60)!;
    expect(age60.items.map((i) => i.title)).toEqual(['퇴직', '일반자산 인출 개시', '사적연금 수령 개시', '자산 고갈 예상']);
  });

  test('depletionAge가 null이면 "자산 고갈 예상" 이벤트가 추가되지 않는다', () => {
    const roadmap = computeExecutionRoadmap(baseParams, undefined, null);
    expect(roadmap.events.some((e) => e.items.some((i) => i.title === '자산 고갈 예상'))).toBe(false);
  });
});
