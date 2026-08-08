import { describe, test, expect } from 'vitest';
import { computeExecutionRoadmap, selectDepletionAge } from '@/core/usecases/dashboard/computeExecutionRoadmap';
import {
  CompleteWithdrawalPlan,
  SimulationParams,
  SimulationResult,
  StrategyRecommendation,
  UtilityBreakdown,
} from '@/core/entities/types';

// 로드맵은 이제 "인출할 대상이 실제로 있는" 이벤트만 그린다. 이 파일의 대부분의 테스트는
// 마일스톤의 **나이 배치**를 검증하므로, 자산·사적연금을 실제로 가진 계획을 기준선으로 둔다.
// 미보유 계획의 동작은 아래 별도 describe에서 검증한다.
const baseParams: SimulationParams = {
  userProfile: { currentAge: 55, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3000000 },
  assets: [
    {
      id: 'asset-1', type: 'etf', ticker: 'SPY', name: 'S&P 500', quantity: 100,
      averagePrice: 500000, annualGrowthRate: 7, dividendYield: 1.5,
      monthlyContribution: 0, reinvestDividend: true, currency: 'KRW',
    },
  ],
  nationalPension: { expectedMonthlyAmount: 1000000 },
  privatePensions: [
    {
      id: 'pension-1', type: 'irp', balance: 200000000,
      monthlyContribution: 0, annualReturn: 5, currency: 'KRW',
    },
  ],
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
  recommendedPrivatePensionChanneling: true | null = null,
  channelingIncludesAccountTransfer = false
): StrategyRecommendation {
  return {
    currentUtility: utility,
    verifiedSentinelPlan: [],
    recommendedUtility: utility,
    recommendedPlan,
    recommendedAssetReinvestment: null,
    recommendedPrivatePensionChanneling,
    recommendedNewPensionContribution: null,
    channelingIncludesAccountTransfer,
    // computeExecutionRoadmap 자체는 improved를 읽지 않는다(recommendedPlan/
    // recommendedPrivatePensionChanneling만 본다) — 이 describe('computeExecutionRoadmap') 블록의
    // 모든 테스트에서 값은 무의미하므로 고정값으로 둔다. selectDepletionAge는 improved를 실제로
    // 읽으므로, 아래 describe('selectDepletionAge') 블록은 이 값을 그대로 쓰지 않고 스프레드 후
    // 매번 명시적으로 override한다.
    improved: false,
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
      householdEndAge: 90,
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
    const roadmap = computeExecutionRoadmap(baseParams, makeRecommendation(plan), null, 'sustained');

    const ages = roadmap.events.map((e) => e.age);
    // 60세: 퇴직+일반자산+사적연금(clampPrivatePensionStartAge(retirementAge)=60, 같은 나이 병합), 68세: 국민연금
    expect(ages).toEqual([60, 68]);

    const age60 = roadmap.events.find((e) => e.age === 60)!;
    expect(age60.items.map((i) => i.title)).toEqual(['퇴직', '일반자산 인출 개시', '사적연금 수령 개시']);

    const age68 = roadmap.events.find((e) => e.age === 68)!;
    expect(age68.items[0].title).toBe('국민연금 수령 개시 (연기)');
  });

  test('recommendation이 undefined이면 getIdentityPlan(params) 기준으로 폴백한다', () => {
    const roadmap = computeExecutionRoadmap(baseParams, undefined, null, 'sustained');
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
    const roadmap = computeExecutionRoadmap(earlyRetirementParams, undefined, null, 'sustained');

    const age50 = roadmap.events.find((e) => e.age === 50)!;
    expect(age50.items.map((i) => i.title)).toEqual(['퇴직', '일반자산 인출 개시']);

    const age55 = roadmap.events.find((e) => e.age === 55)!;
    expect(age55).toBeDefined();
    expect(age55.items.map((i) => i.title)).toEqual(['사적연금 수령 개시']);
  });

  test('recommendedPrivatePensionChanneling이 true면 사적연금 수령 개시 나이가 55세(조기 채널링)로 표시된다', () => {
    // baseParams: retirementAge=60 → 채널링이 없으면 사적연금 수령 개시는 60세여야 하지만,
    // Phase 4가 채택되면 실제로는 55세부터 조기 수령되므로 로드맵도 55세를 가리켜야 한다.
    const roadmap = computeExecutionRoadmap(baseParams, makeRecommendation(null, true), null, 'sustained');

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
    const roadmap = computeExecutionRoadmap(baseParams, makeRecommendation(null, true, true), null, 'sustained');
    const channelingItem = roadmap.events
      .find((e) => e.age === 55)!
      .items.find((i) => i.title === '사적연금 수령 개시 (조기·ISA 재투자)')!;

    expect(channelingItem.description).toContain('ISA에 재투자');
    expect(channelingItem.description).toContain('기존 연금 계좌 납입은 중단');
    expect(channelingItem.description).not.toContain('추가로 납입');
    expect(channelingItem.description).not.toContain('퇴직 전까지 납입');
  });

  test('channelingIncludesAccountTransfer가 false면(채널링 대상 계좌가 전부 납입 0) 계좌 이전 문구를 넣지 않는다', () => {
    // 채널링이 채택돼도 buildChannelingParams는 원래 계좌들의 monthlyContribution이 모두 0이면
    // 이전용 계좌를 만들지 않는다. 이 경우 "기존 계좌 납입은 중단하고 옮긴다"는 시뮬레이션되지
    // 않은 행동이므로 설명에서 빠져야 한다.
    const roadmap = computeExecutionRoadmap(baseParams, makeRecommendation(null, true, false), null, 'sustained');
    const channelingItem = roadmap.events
      .find((e) => e.age === 55)!
      .items.find((i) => i.title === '사적연금 수령 개시 (조기·ISA 재투자)')!;

    expect(channelingItem.description).toContain('ISA에 재투자');
    expect(channelingItem.description).not.toContain('기존 연금 계좌 납입은 중단');
  });

  // recommendedPrivatePensionChanneling은 true | null이라 false는 타입상 표현 불가능하다
  // (사용자가 직접 켜는 설정이 아니므로 "끄라는 추천"이 존재하지 않는다). 따라서 null 케이스만 검증한다.
  test('recommendedPrivatePensionChanneling이 null이면 기존과 동일하게 retirementAge 기준으로 표시된다', () => {
    const roadmapNull = computeExecutionRoadmap(baseParams, makeRecommendation(null, null), null, 'sustained');
    expect(roadmapNull.events.find((e) => e.age === 60)!.items.map((i) => i.title)).toContain('사적연금 수령 개시');
  });

  test('recommendation.recommendedPlan이 null이면(improved: false) getIdentityPlan(params) 기준으로 폴백한다', () => {
    const roadmap = computeExecutionRoadmap(baseParams, makeRecommendation(null), null, 'sustained');
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
    const roadmap = computeExecutionRoadmap(baseParams, makeRecommendation(plan), null, 'sustained');
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
    const roadmap = computeExecutionRoadmap(baseParams, makeRecommendation(plan), null, 'sustained');
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
    const roadmap = computeExecutionRoadmap(baseParams, makeRecommendation(plan), null, 'sustained');
    const ages = roadmap.events.map((e) => e.age);
    expect(ages).toEqual([...ages].sort((a, b) => a - b));
    expect(ages).toEqual([60, 61, 65]);
  });

  test('종료 마커는 본인 기대수명이다', () => {
    const roadmap = computeExecutionRoadmap(baseParams, undefined, null, 'sustained');
    expect(roadmap.endAge).toBe(90);
    expect(roadmap.endLabel).toBe('기대수명');
  });

  test('기대수명을 넘지 않는 고갈 이벤트가 종료 마커보다 앞에 온다', () => {
    const roadmap = computeExecutionRoadmap(baseParams, undefined, 85, 'sustained');

    expect(roadmap.events.some((e) => e.age === 85)).toBe(true);
    expect(roadmap.endAge).toBeGreaterThan(85);
  });

  test('depletionAge가 있으면 "자산 고갈 예상" 이벤트가 severity: warning으로 추가된다', () => {
    const roadmap = computeExecutionRoadmap(baseParams, undefined, 78, 'sustained');
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
    const roadmap = computeExecutionRoadmap(baseParams, makeRecommendation(plan), 60, 'sustained');
    const age60 = roadmap.events.find((e) => e.age === 60)!;
    expect(age60.items.map((i) => i.title)).toEqual(['퇴직', '일반자산 인출 개시', '사적연금 수령 개시', '자산 고갈 예상']);
  });

  test('depletionAge가 null이면 "자산 고갈 예상" 이벤트가 추가되지 않는다', () => {
    const roadmap = computeExecutionRoadmap(baseParams, undefined, null, 'sustained');
    expect(roadmap.events.some((e) => e.items.some((i) => i.title === '자산 고갈 예상'))).toBe(false);
  });

  test('Phase 4만 채택된 경우(recommendedPlan=null)에도 로드맵과 고갈 나이가 같은 시나리오를 가리킨다', () => {
    // computeExecutionRoadmap 자체는 depletionAge를 인자로 받으므로, 여기서는 채널링 채택 시
    // 55세 마일스톤이 나오는 것과 depletionAge 인자가 그대로 이벤트로 반영되는 것만 확인한다.
    // 호출부(DashboardSection.tsx/simulator/page.tsx)가 실제로 recommendedResult의 depletionAge를
    // 골라 넘기는지는 selectDepletionAge 자체를 검증하는 아래 describe('selectDepletionAge')에서
    // 별도로 확인한다 — 두 호출부 모두 selectDepletionAge 한 곳만 호출하므로, 그 함수의 동작만
    // 보장되면 화면/PDF 양쪽에 동일하게 적용된다.
    const roadmap = computeExecutionRoadmap(baseParams, makeRecommendation(null, true), 80, 'sustained');
    expect(roadmap.events.find((e) => e.age === 55)).toBeDefined();
    expect(roadmap.events.find((e) => e.age === 80)!.items.some((i) => i.severity === 'warning')).toBe(true);
  });
});

// 로드맵에는 추천이 건드리지 않는 항목(배우자 국민연금 등)도 함께 그려진다. 어떤 나이가
// 추천으로 옮겨진 것인지 표시가 없으면 한 타임라인 안에 두 기준이 섞인 것으로 읽힌다 —
// 실제로 "본인 60세(추천) / 배우자 64세(현재 설정)"가 "본인이 배우자보다 먼저 받는다"는
// 잘못된 인상을 만들었다.
describe('computeExecutionRoadmap - 추천으로 옮겨진 나이 표시', () => {
  const plan: CompleteWithdrawalPlan = {
    privatePensionMonthlyTarget: 0,
    nationalPensionStartAge: 60, // 현재 설정(65)에서 조기수령으로 당겨짐
    assetSellOrderStrategy: 'input_order',
    isaMaturityDestination: 'pension',
    generalAssetWithdrawalStartAge: 60, // 현재 설정(retirementAge=60)과 동일
    monthlySpendingMultiplier: 1,
  };

  test('추천이 옮긴 나이에는 옮기기 전 나이를 함께 싣는다', () => {
    const roadmap = computeExecutionRoadmap(baseParams, makeRecommendation(plan), null, 'sustained');

    const nationalPensionItem = roadmap.events
      .find((e) => e.age === 60)!
      .items.find((i) => i.title.includes('국민연금'))!;

    expect(nationalPensionItem.changedFromAge).toBe(65);
  });

  test('추천이 건드리지 않은 나이에는 표시하지 않는다', () => {
    const roadmap = computeExecutionRoadmap(baseParams, makeRecommendation(plan), null, 'sustained');

    const generalAssetItem = roadmap.events
      .flatMap((e) => e.items)
      .find((i) => i.title === '일반자산 인출 개시')!;

    expect(generalAssetItem.changedFromAge).toBeUndefined();
  });

  // 호출부가 추천을 넘기지 않으면(= 현재 설정 기준 모드) plan === identityPlan이므로
  // 어떤 항목에도 "옮겨졌다"는 표시가 붙으면 안 된다.
  test('추천을 넘기지 않으면 어떤 항목에도 표시가 붙지 않는다', () => {
    const roadmap = computeExecutionRoadmap(baseParams, undefined, null, 'sustained');

    expect(roadmap.events.flatMap((e) => e.items).every((i) => i.changedFromAge === undefined)).toBe(true);
    // 그리고 국민연금은 현재 설정인 65세에 그려진다.
    expect(roadmap.events.some((e) => e.age === 65)).toBe(true);
    expect(roadmap.events.some((e) => e.age === 60 && e.items.some((i) => i.title.includes('국민연금')))).toBe(false);
  });
});

// 국민연금만 등록한 사용자의 로드맵. 예전에는 존재하지 않는 계좌의 인출 개시가 마일스톤으로
// 찍히고, 엔진이 첫 해에 잡은 depletionAge가 "자산 고갈 예상" 노드로 맨 앞에 놓였다.
describe('computeExecutionRoadmap - 투자자산 미보유 계획', () => {
  const pensionOnlyParams: SimulationParams = {
    ...baseParams,
    userProfile: { currentAge: 50, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3500000 },
    assets: [],
    privatePensions: [],
    nationalPension: { expectedMonthlyAmount: 1800000 },
  };

  test('자산·사적연금이 없으면 그 인출 개시 이벤트를 그리지 않는다', () => {
    const roadmap = computeExecutionRoadmap(pensionOnlyParams, undefined, 51, 'no_investable_asset');
    const titles = roadmap.events.flatMap((e) => e.items.map((i) => i.title));

    expect(titles).not.toContain('일반자산 인출 개시');
    expect(titles).not.toContain('사적연금 수령 개시');
  });

  test('투자자산 미보유면 "자산 고갈 예상" 노드를 그리지 않는다', () => {
    const roadmap = computeExecutionRoadmap(pensionOnlyParams, undefined, 51, 'no_investable_asset');

    expect(roadmap.events.some((e) => e.age === 51)).toBe(false);
    expect(roadmap.events.flatMap((e) => e.items).some((i) => i.severity === 'warning')).toBe(false);
  });

  test('로드맵은 본인 마일스톤만 그린다', () => {
    const roadmap = computeExecutionRoadmap(pensionOnlyParams, undefined, 51, 'no_investable_asset');

    expect(roadmap.events.map((e) => e.age)).toEqual([60, 65]);
    expect(roadmap.events.find((e) => e.age === 60)!.items.map((i) => i.title)).toEqual(['퇴직']);
    expect(roadmap.events.find((e) => e.age === 65)!.items.map((i) => i.title))
      .toEqual(['국민연금 수령 개시']);
  });

  test('국민연금 수령액이 0이면 국민연금 개시 이벤트도 그리지 않는다', () => {
    const roadmap = computeExecutionRoadmap(
      { ...pensionOnlyParams, nationalPension: { expectedMonthlyAmount: 0 } },
      undefined,
      51,
      'no_investable_asset'
    );

    expect(roadmap.events.flatMap((e) => e.items.map((i) => i.title))).toEqual(['퇴직']);
  });
});

// DashboardSection.tsx(화면)와 simulator/page.tsx(PDF) 양쪽이 로드맵에 넘길 depletionAge를
// 고르는 데 공통으로 쓰는 selectDepletionAge를 직접 검증한다. computeExecutionRoadmap 자체는
// depletionAge를 그대로 인자로 받아 반영할 뿐이라 호출부의 "어떤 시나리오의 depletionAge를
// 넘길지" 판단 로직은 이 describe 없이는 회귀 보호가 전혀 없었다(이전 커밋의 갭).
describe('selectDepletionAge', () => {
  const baselineResult: SimulationResult = {
    yearlyResults: [],
    fireAge: null,
    depletionAge: 75,
    endingAssets: 0,
    retirementScore: 0,
    retirementGrade: '보통',
    goalAchievementRate: 100,
    retirementAssetsAtRetirement: 0,
    householdEndAge: 90,
  };

  test('recommendation이 없으면 baseline(result)의 depletionAge를 쓴다', () => {
    expect(selectDepletionAge(undefined, baselineResult)).toBe(75);
  });

  test('improved가 false면 recommendedResult가 달라도 baseline(result)의 depletionAge를 쓴다', () => {
    const rec: StrategyRecommendation = {
      ...makeRecommendation(null),
      improved: false,
      recommendedResult: { ...baselineResult, depletionAge: 60 },
    };
    expect(selectDepletionAge(rec, baselineResult)).toBe(75);
  });

  // 이게 이번 수정이 고치는 정확한 케이스다: Phase 3/4(배당 재투자·사적연금 채널링·신규
  // 연금계좌 납입)가 단독으로 채택되면 recommendedPlan은 null이지만 improved는 true다.
  // recommendedPlan 유무로만 판단하던 예전 조건이라면 이 케이스에서 baseline(75)을 반환해,
  // 로드맵의 마일스톤(추천 시나리오 기준)과 고갈 나이(baseline 기준)가 서로 다른 시나리오를
  // 섞어 보여주는 버그가 재현된다.
  test('improved가 true이고 recommendedPlan이 null이어도(신규 연금계좌 납입만 채택) recommendedResult의 depletionAge를 쓴다', () => {
    const rec: StrategyRecommendation = {
      ...makeRecommendation(null),
      improved: true,
      recommendedNewPensionContribution: true,
      recommendedResult: { ...baselineResult, depletionAge: 82 },
    };
    expect(selectDepletionAge(rec, baselineResult)).toBe(82);
  });

  test('improved가 true이고 recommendedPlan도 있으면 recommendedResult의 depletionAge를 쓴다', () => {
    const plan: CompleteWithdrawalPlan = {
      privatePensionMonthlyTarget: 0,
      nationalPensionStartAge: 65,
      assetSellOrderStrategy: 'input_order',
      isaMaturityDestination: 'pension',
      generalAssetWithdrawalStartAge: 60,
      monthlySpendingMultiplier: 1,
    };
    const rec: StrategyRecommendation = {
      ...makeRecommendation(plan),
      improved: true,
      recommendedResult: { ...baselineResult, depletionAge: 88 },
    };
    expect(selectDepletionAge(rec, baselineResult)).toBe(88);
  });
});
