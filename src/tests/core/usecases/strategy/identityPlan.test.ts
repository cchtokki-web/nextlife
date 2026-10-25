import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { getIdentityPlan } from '@/core/usecases/strategy/StrategyCandidateGenerator';
import { paramsWithBaselinePlan } from '@/core/usecases/strategy/StrategyCandidateGenerator';
import { SimulationParams } from '@/core/entities/types';

// **getIdentityPlan은 진짜 identity여야 한다.**
//
// 이름 그대로 "아무것도 바꾸지 않는 계획"이다. 추천 엔진은 이것을 기준선으로 삼아
// 개선 여부를 판정하고, 항목별 기여도(itemizedContributions)를 계산하고, Phase 3/4의
// baseline으로 쓴다. 기준선이 사용자의 실제 계획과 다르면 그 위에 쌓인 모든 숫자가 틀린다.
//
// ## 예전에 무엇이 틀렸나
//
// 1. params.withdrawalPlan을 **통째로 무시**하고 nationalPensionStartAge: 65를 항상 반환했다.
//    「최대 연기(70세)」를 고른 사용자의 기준선이 65세였다 — compileStrategy는 이 필드를
//    항상 채우므로, 전략 패널을 쓴 모든 사용자에게 해당됐다.
// 2. privatePensionMonthlyTarget을 targetMonthlySpending으로 채웠다. 그런데 이 필드가
//    미지정일 때 엔진의 기본 동작은 "잔여 개월 균등분할"이라 전혀 다른 계획이다.
//    RecommendationEngine.ts가 "동일 params에서 72점 vs 65점으로 갈린다"고 실측을 기록해 뒀고,
//    그 어긋남을 피하려고 bestPlan === null일 때의 예외 분기가 세 곳에 흩어져 있었다.
//
// 이 파일이 통과하면 그 예외 분기들과 Phase 3/4 baseline 불일치(5~10점 계통 오차)가
// 근거를 잃는다.

const base: SimulationParams = {
  userProfile: { currentAge: 55, retirementAge: 61, expectancy: 90, targetMonthlySpending: 3000000 },
  assets: [
    { id: 'a1', type: 'etf', ticker: 'A', name: '자산1', quantity: 3000, averagePrice: 100000, totalReturn: 5, dividendYield: 2, monthlyContribution: 0, reinvestDividend: false, currency: 'KRW' },
    { id: 'a2', type: 'etf', ticker: 'B', name: '자산2', quantity: 2000, averagePrice: 100000, totalReturn: 5, dividendYield: 4, monthlyContribution: 0, reinvestDividend: false, currency: 'KRW' },
  ],
  isaAccounts: [
    { id: 'isa-1', type: 'general', balance: 20000000, monthlyContribution: 0, totalReturn: 5, dividendYield: 0, currency: 'KRW', maturityYears: 3 },
  ],
  nationalPension: { expectedMonthlyAmount: 1000000 },
  privatePensions: [
    { id: 'p1', type: 'irp', balance: 300000000, monthlyContribution: 0, totalReturn: 4, currency: 'KRW' },
  ],
  otherIncomes: [],
  inflationRate: 0,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

// 사적연금 유/무 × 저장된 withdrawalPlan 유/무 × 국민연금 유/무를 교차한 매트릭스.
// 각 축이 getIdentityPlan의 서로 다른 분기를 건드린다.
const MATRIX: ReadonlyArray<{ name: string; params: SimulationParams }> = [
  { name: '기본(저장된 인출계획 없음)', params: base },
  {
    name: '사적연금 없음',
    params: { ...base, privatePensions: [] },
  },
  {
    name: '국민연금 없음',
    params: { ...base, nationalPension: { expectedMonthlyAmount: 0 } },
  },
  {
    name: '저장된 인출계획 — 국민연금 70세 연기',
    params: { ...base, withdrawalPlan: { nationalPensionStartAge: 70 } },
  },
  {
    name: '저장된 인출계획 — 국민연금 60세 조기',
    params: { ...base, withdrawalPlan: { nationalPensionStartAge: 60 } },
  },
  {
    name: '저장된 인출계획 — 사적연금 정액 인출',
    params: { ...base, withdrawalPlan: { privatePensionMonthlyTarget: 1000000 } },
  },
  {
    name: '저장된 인출계획 — 매도 순서/ISA 목적지/인출 개시 나이',
    params: {
      ...base,
      withdrawalPlan: {
        assetSellOrderStrategy: 'high_dividend_first',
        isaMaturityDestination: 'asset',
        generalAssetWithdrawalStartAge: 70,
      },
    },
  },
  {
    name: '저장된 인출계획 — 전 필드 지정',
    params: {
      ...base,
      withdrawalPlan: {
        privatePensionMonthlyTarget: 1250000,
        nationalPensionStartAge: 67,
        assetSellOrderStrategy: 'low_dividend_first',
        isaMaturityDestination: 'asset',
        generalAssetWithdrawalStartAge: 65,
        monthlySpendingMultiplier: 1,
      },
    },
  },
  {
    name: '저장된 인출계획 — 계좌군 CUSTOM 정책',
    params: {
      ...base,
      withdrawalPlan: {
        accountWithdrawalPolicy: 'CUSTOM',
        customWithdrawalOrder: ['isa-1', 'GENERAL', 'IRP'],
      },
    },
  },
  {
    name: '자산 없음(연금만)',
    params: { ...base, assets: [], isaAccounts: [] },
  },
];

describe('getIdentityPlan은 결과를 바꾸지 않는다', () => {
  test.each(MATRIX)('$name', ({ params }) => {
    const engine = new SimulationEngine();

    const baseline = engine.runForUtility(params);
    const viaIdentity = engine.runForUtility(paramsWithBaselinePlan(params, getIdentityPlan(params)));

    // 점수만 비교하면 자산 곡선이 달라도 우연히 같을 수 있으므로 결과 전체를 비교한다.
    expect(viaIdentity).toEqual(baseline);
  });
});

describe('getIdentityPlan은 사용자가 저장한 인출계획을 그대로 반영한다', () => {
  test('국민연금 개시 나이를 저장했으면 그 값이 기준선이다', () => {
    const plan = getIdentityPlan({ ...base, withdrawalPlan: { nationalPensionStartAge: 70 } });

    expect(plan.nationalPensionStartAge).toBe(70);
  });

  test('저장된 값이 없으면 엔진 기본값(65세)이 기준선이다', () => {
    expect(getIdentityPlan(base).nationalPensionStartAge).toBe(65);
  });

  test('사적연금 정액 인출을 저장하지 않았으면 그 필드를 지정하지 않는다', () => {
    // 엔진의 기본 동작은 "잔여 개월 균등분할"이라 특정 금액으로 표현할 수 없다.
    // 임의의 값을 채우면 그 순간 identity가 아니게 된다.
    expect(getIdentityPlan(base).privatePensionMonthlyTarget).toBeUndefined();
  });

  test('사적연금 정액 인출을 저장했으면 그 값이 기준선이다', () => {
    const plan = getIdentityPlan({ ...base, withdrawalPlan: { privatePensionMonthlyTarget: 1000000 } });

    expect(plan.privatePensionMonthlyTarget).toBe(1000000);
  });

  // compileStrategy는 사적연금 계좌 유무를 보지 않고 이 필드를 채운다(저율과세 한도 × 전략 비율).
  // 계좌가 하나도 없으면 그 값은 시뮬레이션에 아무 영향도 주지 않는데, 기준선에 남으면
  // 후보(계좌가 없으면 키를 넣지 않는다)와 어긋나 "바뀐 필드"로 잡힌다. 그래서 AI 추천
  // 체크리스트에 "사적연금을 정액 인출 대신 균등하게 인출합니다 (효용 +0점)"라는 존재하지
  // 않는 할 일이 떴다. 후보 생성기와 같은 규칙을 여기에도 둔다.
  test('사적연금 계좌가 없으면 저장된 정액 인출액이 있어도 기준선에 넣지 않는다', () => {
    const plan = getIdentityPlan({
      ...base,
      privatePensions: [],
      withdrawalPlan: { privatePensionMonthlyTarget: 1250000 },
    });

    expect('privatePensionMonthlyTarget' in plan).toBe(false);
  });
});
