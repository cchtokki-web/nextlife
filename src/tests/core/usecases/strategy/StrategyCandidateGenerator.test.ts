import { describe, test, expect } from 'vitest';
import {
  generateCandidatePlans,
  getIdentityPlan,
  generateSpendingAdjustmentCandidates,
} from '@/core/usecases/strategy/StrategyCandidateGenerator';
import { SimulationParams } from '@/core/entities/types';

const baseParams: SimulationParams = {
  userProfile: {
    currentAge: 55,
    retirementAge: 60,
    expectancy: 90,
    targetMonthlySpending: 3000000,
  },
  assets: [],
  nationalPension: { expectedMonthlyAmount: 0 },
  privatePensions: [
    {
      id: 'pension-1',
      type: 'irp',
      balance: 300000000,
      monthlyContribution: 0,
      totalReturn: 5,
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

describe('generateCandidatePlans', () => {
  test('사적연금이 없으면 후보를 생성하지 않는다', () => {
    const candidates = generateCandidatePlans({ ...baseParams, privatePensions: [] });
    expect(candidates).toEqual([]);
  });

  // 사적연금 계좌가 없으면 이 필드는 어떤 값이어도 시뮬레이션 결과가 같다. 그런데 예전에는
  // 후보가 0을 **명시**했고, getIdentityPlan은 저장값이 없으면 키 자체를 넣지 않아
  // (0 !== undefined) computeItemizedContributions가 "바뀐 필드"로 잡았다. 그 결과 사적연금이
  // 없는 사용자의 AI 추천 체크리스트에 "사적연금을 월 약 0만원 수준으로 정액 인출합니다
  // (효용 +0점)"라는 할 일이 떴다.
  test('사적연금 계좌가 없으면 후보에 privatePensionMonthlyTarget 키 자체를 넣지 않는다', () => {
    // 사적연금은 없지만 다른 차원(국민연금 시점)이 살아 있어 후보가 생성되는 경우
    const candidates = generateCandidatePlans({
      ...baseParams,
      privatePensions: [],
      nationalPension: { expectedMonthlyAmount: 1800000 },
    });

    expect(candidates.length).toBeGreaterThan(0);
    for (const c of candidates) {
      expect('privatePensionMonthlyTarget' in c).toBe(false);
    }
  });

  // 사적연금은 있는데 목표 생활비가 0인 경우까지 키를 지우면 "정액 0원"이 엔진 기본값
  // (잔여 개월 균등분할)로 바뀌어 시뮬레이션 동작 자체가 달라진다. 이 경우는 0을 유지한다.
  test('사적연금이 있고 목표 생활비만 0이면 정액 0원 후보를 유지한다', () => {
    const candidates = generateCandidatePlans({
      ...baseParams,
      userProfile: { ...baseParams.userProfile, targetMonthlySpending: 0 },
      nationalPension: { expectedMonthlyAmount: 1800000 },
    });

    expect(candidates.length).toBeGreaterThan(0);
    for (const c of candidates) {
      expect(c.privatePensionMonthlyTarget).toBe(0);
    }
  });

  test('사적연금이 있으면 유효 범위 내의 월 인출액 조합을 생성한다', () => {
    const candidates = generateCandidatePlans(baseParams);

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.length).toBeLessThanOrEqual(900); // 브라우저 실시간 처리 가능한 상한 (전체 시나리오 최악의 경우 216, 아래 별도 테스트로 검증)

    for (const c of candidates) {
      expect(c.privatePensionMonthlyTarget).toBeGreaterThan(0);
    }
  });

  test('국민연금 수령액이 0이면 국민연금 시점은 65세 단일 후보만 사용한다 (후보 폭증 방지)', () => {
    // baseParams.nationalPension.expectedMonthlyAmount === 0
    const candidates = generateCandidatePlans(baseParams);
    for (const c of candidates) {
      expect(c.nationalPensionStartAge).toBe(65);
    }
    // 월인출액(3개)만큼만 생성되어야 함
    expect(candidates.length).toBe(3);
  });

  test('국민연금 수령액이 있으면 조기~연기 수령 나이 그리드를 함께 탐색한다', () => {
    const paramsWithNationalPension: SimulationParams = {
      ...baseParams,
      nationalPension: { expectedMonthlyAmount: 1000000 },
    };
    const candidates = generateCandidatePlans(paramsWithNationalPension);

    const distinctNationalPensionAges = new Set(candidates.map((c) => c.nationalPensionStartAge));
    expect(distinctNationalPensionAges.size).toBeGreaterThan(1);
    // 3(월인출액) × 3(국민연금 개시나이) = 9
    expect(candidates.length).toBe(9);

    for (const c of candidates) {
      expect(c.nationalPensionStartAge).toBeGreaterThanOrEqual(60);
      expect(c.nationalPensionStartAge).toBeLessThanOrEqual(70);
    }
  });

  test('자산이 1개 이하면 매도 순서는 input_order 단일 후보만 사용한다', () => {
    const candidates = generateCandidatePlans({
      ...baseParams,
      assets: [
        { id: 'a1', type: 'etf', ticker: 'A', name: '자산1', quantity: 1, averagePrice: 100, totalReturn: 5, dividendYield: 2, monthlyContribution: 0, reinvestDividend: false, currency: 'KRW' },
      ],
    });
    for (const c of candidates) {
      expect(c.assetSellOrderStrategy).toBe('input_order');
    }
  });

  test('자산이 2개 이상이면 매도 순서 전략 3가지를 함께 탐색한다', () => {
    const twoAssetParams: SimulationParams = {
      ...baseParams,
      assets: [
        { id: 'a1', type: 'etf', ticker: 'A', name: '자산1', quantity: 1, averagePrice: 100, totalReturn: 5, dividendYield: 2, monthlyContribution: 0, reinvestDividend: false, currency: 'KRW' },
        { id: 'a2', type: 'etf', ticker: 'B', name: '자산2', quantity: 1, averagePrice: 100, totalReturn: 5, dividendYield: 4, monthlyContribution: 0, reinvestDividend: false, currency: 'KRW' },
      ],
    };
    const candidates = generateCandidatePlans(twoAssetParams);
    const distinctStrategies = new Set(candidates.map((c) => c.assetSellOrderStrategy));
    expect(distinctStrategies).toEqual(new Set(['input_order', 'low_dividend_first', 'high_dividend_first']));
  });

  test('ISA·사적연금·일반자산이 모두 있어야 ISA 만기 목적지 2가지를 탐색하고, 아니면 pension 단일 후보만 사용한다', () => {
    const withoutIsa = generateCandidatePlans(baseParams); // isaAccounts 없음
    for (const c of withoutIsa) {
      expect(c.isaMaturityDestination).toBe('pension');
    }

    const withIsaButNoAsset: SimulationParams = {
      ...baseParams,
      isaAccounts: [
        { id: 'isa-1', type: 'general', balance: 1000000, monthlyContribution: 0, totalReturn: 5, dividendYield: 0, currency: 'KRW', maturityYears: 3 },
      ],
    }; // assets가 여전히 []
    for (const c of generateCandidatePlans(withIsaButNoAsset)) {
      expect(c.isaMaturityDestination).toBe('pension');
    }

    const withAll: SimulationParams = {
      ...withIsaButNoAsset,
      assets: [
        { id: 'a1', type: 'etf', ticker: 'A', name: '자산1', quantity: 1, averagePrice: 100, totalReturn: 5, dividendYield: 2, monthlyContribution: 0, reinvestDividend: false, currency: 'KRW' },
      ],
    };
    const distinctDestinations = new Set(generateCandidatePlans(withAll).map((c) => c.isaMaturityDestination));
    expect(distinctDestinations).toEqual(new Set(['pension', 'asset']));
  });

  test('모든 차원이 무의미하면(사적연금 없음, 자산 1개 이하, ISA 조건 미충족) 후보를 생성하지 않는다', () => {
    const candidates = generateCandidatePlans({
      ...baseParams,
      privatePensions: [],
      assets: [],
    });
    expect(candidates).toEqual([]);
  });

  test('자산이 없으면 일반계좌 인출 개시 나이는 retirementAge 단일 후보만 사용한다', () => {
    // baseParams.assets === []
    const candidates = generateCandidatePlans(baseParams);
    for (const c of candidates) {
      expect(c.generalAssetWithdrawalStartAge).toBe(baseParams.userProfile.retirementAge);
    }
  });

  test('자산이 있으면 일반계좌 인출 개시 나이 그리드를 함께 탐색한다', () => {
    const withAsset: SimulationParams = {
      ...baseParams,
      assets: [
        { id: 'a1', type: 'etf', ticker: 'A', name: '자산1', quantity: 1, averagePrice: 100, totalReturn: 5, dividendYield: 2, monthlyContribution: 0, reinvestDividend: false, currency: 'KRW' },
      ],
    };
    const candidates = generateCandidatePlans(withAsset);
    const distinctAges = new Set(candidates.map((c) => c.generalAssetWithdrawalStartAge));
    expect(distinctAges.size).toBeGreaterThan(1);
    for (const c of candidates) {
      expect(c.generalAssetWithdrawalStartAge).toBeGreaterThanOrEqual(withAsset.userProfile.retirementAge);
      expect(c.generalAssetWithdrawalStartAge).toBeLessThan(withAsset.userProfile.expectancy);
    }
  });

  test('모든 차원이 최대로 확장되는 최악의 경우 216개(3×3×3×2×4) 후보를 생성한다', () => {
    // retirementAge(61)가 그리드 최솟값(62)보다 작아야 generalAssetWithdrawalStartAgeCandidates가
    // 4개(retirementAge 유니온 포함)가 된다.
    const worstCaseParams: SimulationParams = {
      ...baseParams,
      userProfile: { ...baseParams.userProfile, retirementAge: 61, expectancy: 95 },
      nationalPension: { expectedMonthlyAmount: 1000000 },
      assets: [
        { id: 'a1', type: 'etf', ticker: 'A', name: '자산1', quantity: 1, averagePrice: 100, totalReturn: 5, dividendYield: 2, monthlyContribution: 0, reinvestDividend: false, currency: 'KRW' },
        { id: 'a2', type: 'etf', ticker: 'B', name: '자산2', quantity: 1, averagePrice: 100, totalReturn: 5, dividendYield: 4, monthlyContribution: 0, reinvestDividend: false, currency: 'KRW' },
      ],
      isaAccounts: [
        { id: 'isa-1', type: 'general', balance: 1000000, monthlyContribution: 0, totalReturn: 5, dividendYield: 0, currency: 'KRW', maturityYears: 3 },
      ],
    };

    const candidates = generateCandidatePlans(worstCaseParams);
    expect(candidates.length).toBe(216);
  });

  test('회귀 가드: monthlySpendingMultiplier는 이 cartesian product의 차원이 아니라 항상 1이다', () => {
    const candidates = generateCandidatePlans(baseParams);
    for (const c of candidates) {
      expect(c.monthlySpendingMultiplier).toBe(1);
    }
  });
});

describe('getIdentityPlan', () => {
  // "결과를 바꾸지 않는다"는 본질적 성질은 identityPlan.test.ts가 엔진을 돌려 증명한다.
  // 여기서는 계획 객체의 형태만 고정한다.
  test('저장된 인출계획이 없으면 엔진 기본값으로 채운다', () => {
    const plan = getIdentityPlan(baseParams);

    expect(plan).toEqual({
      // privatePensionMonthlyTarget은 **키가 없어야 한다**. 엔진의 기본 동작은 "잔여 개월
      // 균등분할"이라 특정 금액으로 표현할 수 없고, 임의의 값을 채우는 순간 identity가 아니게 된다.
      // 예전에는 여기에 targetMonthlySpending을 넣어 전혀 다른 계획을 기준선으로 삼았다.
      nationalPensionStartAge: 65,
      assetSellOrderStrategy: 'input_order',
      isaMaturityDestination: 'pension',
      generalAssetWithdrawalStartAge: baseParams.userProfile.retirementAge,
      monthlySpendingMultiplier: 1,
    });
  });

  test('저장된 인출계획이 있으면 그 값을 그대로 쓴다', () => {
    const plan = getIdentityPlan({
      ...baseParams,
      withdrawalPlan: {
        nationalPensionStartAge: 70,
        privatePensionMonthlyTarget: 1000000,
        assetSellOrderStrategy: 'high_dividend_first',
        isaMaturityDestination: 'asset',
        generalAssetWithdrawalStartAge: 68,
      },
    });

    expect(plan).toEqual({
      nationalPensionStartAge: 70,
      privatePensionMonthlyTarget: 1000000,
      assetSellOrderStrategy: 'high_dividend_first',
      isaMaturityDestination: 'asset',
      generalAssetWithdrawalStartAge: 68,
      monthlySpendingMultiplier: 1,
    });
  });

  test('사적연금 유무는 identity plan에 영향을 주지 않는다', () => {
    // 예전에는 사적연금이 없으면 privatePensionMonthlyTarget을 0으로 채웠다. 0은 "한 푼도
    // 인출하지 않는다"는 지시인데, 연금이 없으면 애초에 인출할 것이 없으므로 지시 자체가
    // 무의미하고, 연금이 생기는 순간 의미가 뒤집힌다.
    expect(getIdentityPlan({ ...baseParams, privatePensions: [] }))
      .toEqual(getIdentityPlan(baseParams));
  });
});

describe('generateSpendingAdjustmentCandidates', () => {
  const basePlan = getIdentityPlan(baseParams);

  test('allowIncrease가 false여도 하강 후보는 생성한다', () => {
    // 고갈 위험이 있어 증액을 막는 상황이야말로 "덜 쓰는" 후보가 필요한 상황이다.
    const candidates = generateSpendingAdjustmentCandidates(baseParams, basePlan, { allowIncrease: false });

    expect(candidates.map((c) => c.monthlySpendingMultiplier)).toEqual([0.8, 0.9]);
  });

  test('HARD 생활비 목표용 옵션은 감액 후보를 생성하지 않는다', () => {
    const candidates = generateSpendingAdjustmentCandidates(baseParams, basePlan, {
      allowIncrease: false,
      allowDecrease: false,
    });

    expect(candidates).toEqual([]);
  });

  test("spendingStrategy가 'target'이 아니면 후보를 생성하지 않는다", () => {
    const candidates = generateSpendingAdjustmentCandidates(
      { ...baseParams, spendingStrategy: 'max_sustainable' },
      basePlan,
      { allowIncrease: true }
    );
    expect(candidates).toEqual([]);
  });

  test('targetMonthlySpending이 0 이하이면 후보를 생성하지 않는다', () => {
    const candidates = generateSpendingAdjustmentCandidates(
      { ...baseParams, userProfile: { ...baseParams.userProfile, targetMonthlySpending: 0 } },
      basePlan,
      { allowIncrease: true }
    );
    expect(candidates).toEqual([]);
  });

  test('정상 조건이면 하강·상승 배수 후보 4개를 생성하고 나머지 필드는 basePlan을 유지한다', () => {
    // 예전에는 증가 방향만 있어서 「자산 최대화」·「상속 최대화」를 고른 사용자에게 최적일 수
    // 있는 후보가 아예 생성되지 않았다 — 목표를 바꿔도 argmax가 움직일 여지가 없었다.
    const candidates = generateSpendingAdjustmentCandidates(baseParams, basePlan, { allowIncrease: true });

    expect(candidates.map((c) => c.monthlySpendingMultiplier)).toEqual([0.8, 0.9, 1.1, 1.2]);
    for (const c of candidates) {
      expect(c.assetSellOrderStrategy).toBe(basePlan.assetSellOrderStrategy);
    }
  });
});
