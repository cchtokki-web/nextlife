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

function makeRecommendation(
  recommendedPlan: CompleteWithdrawalPlan | null,
  recommendedPrivatePensionChanneling: true | null = null
): StrategyRecommendation {
  return {
    currentUtility: utility,
    recommendedUtility: utility,
    recommendedPlan,
    recommendedAssetReinvestment: null,
    recommendedPrivatePensionChanneling,
    recommendedNewPensionContribution: null,
    improved: recommendedPlan !== null || recommendedPrivatePensionChanneling === true,
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
  test('recommendedPlan이 채워진 경우 이벤트가 정확한 나이/제목으로 생성된다', () => {
    const plan: CompleteWithdrawalPlan = {
      privatePensionMonthlyTarget: 2000000,
      nationalPensionStartAge: 68,
      assetSellOrderStrategy: 'input_order',
      isaMaturityDestination: 'pension',
      generalAssetWithdrawalStartAge: 60,
      monthlySpendingMultiplier: 1,
    };
    const roadmap = computeExecutionRoadmap(baseParams, makeRecommendation(plan), null);

    const ages = roadmap.events.map((e) => e.age);
    // 60세: 퇴직+일반자산+사적연금(clampPrivatePensionStartAge(retirementAge)=60, 같은 나이 병합), 68세: 국민연금
    expect(ages).toEqual([60, 68]);

    const age60 = roadmap.events.find((e) => e.age === 60)!;
    expect(age60.items.map((i) => i.title)).toEqual(['퇴직', '일반자산 인출 개시', '사적연금 수령 개시']);

    const age68 = roadmap.events.find((e) => e.age === 68)!;
    expect(age68.items[0].title).toBe('국민연금 수령 개시 (연기)');
  });

  test('recommendation이 undefined이면 getIdentityPlan(params) 기준으로 폴백한다', () => {
    const roadmap = computeExecutionRoadmap(baseParams, undefined, null);
    // getIdentityPlan: nationalPensionStartAge=65, generalAssetWithdrawalStartAge=60,
    // 사적연금 수령 개시 나이는 clampPrivatePensionStartAge(retirementAge)=60
    const ages = roadmap.events.map((e) => e.age);
    expect(ages).toEqual([60, 65]);
    const age60 = roadmap.events.find((e) => e.age === 60)!;
    expect(age60.items.map((i) => i.title)).toEqual(['퇴직', '일반자산 인출 개시', '사적연금 수령 개시']);
    const age65 = roadmap.events.find((e) => e.age === 65)!;
    expect(age65.items[0].title).toBe('국민연금 수령 개시');
  });

  test('retirementAge가 55세 미만이면 사적연금 수령 개시 이벤트는 55세로 clamp된다', () => {
    const earlyRetirementParams: SimulationParams = {
      ...baseParams,
      userProfile: { ...baseParams.userProfile, retirementAge: 50 },
    };
    const roadmap = computeExecutionRoadmap(earlyRetirementParams, undefined, null);

    const age50 = roadmap.events.find((e) => e.age === 50)!;
    expect(age50.items.map((i) => i.title)).toEqual(['퇴직', '일반자산 인출 개시']);

    const age55 = roadmap.events.find((e) => e.age === 55)!;
    expect(age55).toBeDefined();
    expect(age55.items.map((i) => i.title)).toEqual(['사적연금 수령 개시']);
  });

  test('recommendedPrivatePensionChanneling이 true면 사적연금 수령 개시 나이가 55세(조기 채널링)로 표시된다', () => {
    // baseParams: retirementAge=60 → 채널링이 없으면 사적연금 수령 개시는 60세여야 하지만,
    // Phase 4가 채택되면 실제로는 55세부터 조기 수령되므로 로드맵도 55세를 가리켜야 한다.
    const roadmap = computeExecutionRoadmap(baseParams, makeRecommendation(null, true), null);

    const age55 = roadmap.events.find((e) => e.age === 55)!;
    expect(age55).toBeDefined();
    expect(age55.items.map((i) => i.title)).toContain('사적연금 수령 개시 (조기·ISA 재투자)');

    const age60 = roadmap.events.find((e) => e.age === 60)!;
    expect(age60.items.map((i) => i.title)).toEqual(['퇴직', '일반자산 인출 개시']);
  });

  test('채널링 설명은 채널링 레그가 실제로 시뮬레이션한 내용만 기술한다(신규 계좌 추가 납입을 단언하지 않는다)', () => {
    // 신규 연금 계좌 납입은 recommendedNewPensionContribution이라는 독립 후보라 채택되지 않을 수
    // 있다. 채널링만 채택된 사용자에게 "신규 계좌에 납입합니다"라고 적으면 시뮬레이션하지 않은
    // 행동을 단언하게 되므로, 설명에는 채널링의 실제 가정(납입 중단 → 이전용 계좌)만 담는다.
    const roadmap = computeExecutionRoadmap(baseParams, makeRecommendation(null, true), null);
    const channelingItem = roadmap.events
      .find((e) => e.age === 55)!
      .items.find((i) => i.title === '사적연금 수령 개시 (조기·ISA 재투자)')!;

    expect(channelingItem.description).toContain('ISA에 재투자');
    expect(channelingItem.description).toContain('기존 연금 계좌 납입은 중단');
    expect(channelingItem.description).not.toContain('추가로 납입');
    expect(channelingItem.description).not.toContain('퇴직 전까지 납입');
  });

  // recommendedPrivatePensionChanneling은 true | null이라 false는 타입상 표현 불가능하다
  // (사용자가 직접 켜는 설정이 아니므로 "끄라는 추천"이 존재하지 않는다). 따라서 null 케이스만 검증한다.
  test('recommendedPrivatePensionChanneling이 null이면 기존과 동일하게 retirementAge 기준으로 표시된다', () => {
    const roadmapNull = computeExecutionRoadmap(baseParams, makeRecommendation(null, null), null);
    expect(roadmapNull.events.find((e) => e.age === 60)!.items.map((i) => i.title)).toContain('사적연금 수령 개시');
  });

  test('recommendation.recommendedPlan이 null이면(improved: false) getIdentityPlan(params) 기준으로 폴백한다', () => {
    const roadmap = computeExecutionRoadmap(baseParams, makeRecommendation(null), null);
    const ages = roadmap.events.map((e) => e.age);
    expect(ages).toEqual([60, 65]);
  });

  test('국민연금 수령 개시 나이가 65세보다 이르면 "(조기)"를 표기한다', () => {
    const plan: CompleteWithdrawalPlan = {
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
      privatePensionMonthlyTarget: 0,
      nationalPensionStartAge: 61,
      assetSellOrderStrategy: 'input_order',
      isaMaturityDestination: 'pension',
      generalAssetWithdrawalStartAge: 65,
      monthlySpendingMultiplier: 1,
    };
    const roadmap = computeExecutionRoadmap(baseParams, makeRecommendation(plan), null);
    const ages = roadmap.events.map((e) => e.age);
    expect(ages).toEqual([...ages].sort((a, b) => a - b));
    expect(ages).toEqual([60, 61, 65]);
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

  test('Phase 4만 채택된 경우(recommendedPlan=null)에도 로드맵과 고갈 나이가 같은 시나리오를 가리킨다', () => {
    // computeExecutionRoadmap 자체는 depletionAge를 인자로 받으므로, 여기서는 채널링 채택 시
    // 55세 마일스톤이 나오는 것과 depletionAge 인자가 그대로 이벤트로 반영되는 것만 확인하고,
    // 호출부의 선택 조건은 위 Step 1에서 improved 기준으로 통일한 것으로 보장한다.
    const roadmap = computeExecutionRoadmap(baseParams, makeRecommendation(null, true), 80);
    expect(roadmap.events.find((e) => e.age === 55)).toBeDefined();
    expect(roadmap.events.find((e) => e.age === 80)!.items.some((i) => i.severity === 'warning')).toBe(true);
  });
});
