import { describe, test, expect } from 'vitest';
import {
  generateCandidatePlans,
  getIdentityPlan,
  generateSpendingAdjustmentCandidates,
} from '@/core/usecases/strategy/StrategyCandidateGenerator';
import { CompleteWithdrawalPlan, SimulationParams } from '@/core/entities/types';

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
      annualReturn: 5,
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
        { id: 'a1', type: 'etf', ticker: 'A', name: '자산1', quantity: 1, averagePrice: 100, annualGrowthRate: 5, dividendYield: 2, monthlyContribution: 0, reinvestDividend: false, currency: 'KRW' },
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
        { id: 'a1', type: 'etf', ticker: 'A', name: '자산1', quantity: 1, averagePrice: 100, annualGrowthRate: 5, dividendYield: 2, monthlyContribution: 0, reinvestDividend: false, currency: 'KRW' },
        { id: 'a2', type: 'etf', ticker: 'B', name: '자산2', quantity: 1, averagePrice: 100, annualGrowthRate: 5, dividendYield: 4, monthlyContribution: 0, reinvestDividend: false, currency: 'KRW' },
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
        { id: 'isa-1', type: 'general', balance: 1000000, monthlyContribution: 0, annualReturn: 5, dividendYield: 0, currency: 'KRW', maturityYears: 3 },
      ],
    }; // assets가 여전히 []
    for (const c of generateCandidatePlans(withIsaButNoAsset)) {
      expect(c.isaMaturityDestination).toBe('pension');
    }

    const withAll: SimulationParams = {
      ...withIsaButNoAsset,
      assets: [
        { id: 'a1', type: 'etf', ticker: 'A', name: '자산1', quantity: 1, averagePrice: 100, annualGrowthRate: 5, dividendYield: 2, monthlyContribution: 0, reinvestDividend: false, currency: 'KRW' },
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
        { id: 'a1', type: 'etf', ticker: 'A', name: '자산1', quantity: 1, averagePrice: 100, annualGrowthRate: 5, dividendYield: 2, monthlyContribution: 0, reinvestDividend: false, currency: 'KRW' },
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
        { id: 'a1', type: 'etf', ticker: 'A', name: '자산1', quantity: 1, averagePrice: 100, annualGrowthRate: 5, dividendYield: 2, monthlyContribution: 0, reinvestDividend: false, currency: 'KRW' },
        { id: 'a2', type: 'etf', ticker: 'B', name: '자산2', quantity: 1, averagePrice: 100, annualGrowthRate: 5, dividendYield: 4, monthlyContribution: 0, reinvestDividend: false, currency: 'KRW' },
      ],
      isaAccounts: [
        { id: 'isa-1', type: 'general', balance: 1000000, monthlyContribution: 0, annualReturn: 5, dividendYield: 0, currency: 'KRW', maturityYears: 3 },
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
  test('baseline과 동등한 기본값으로 채워진 완결 plan을 반환한다', () => {
    const plan = getIdentityPlan(baseParams);

    expect(plan).toEqual<CompleteWithdrawalPlan>({
      privatePensionMonthlyTarget: baseParams.userProfile.targetMonthlySpending,
      nationalPensionStartAge: 65,
      assetSellOrderStrategy: 'input_order',
      isaMaturityDestination: 'pension',
      generalAssetWithdrawalStartAge: baseParams.userProfile.retirementAge,
      monthlySpendingMultiplier: 1,
    });
  });

  test('사적연금이 없으면 privatePensionMonthlyTarget은 0이다', () => {
    const plan = getIdentityPlan({ ...baseParams, privatePensions: [] });
    expect(plan.privatePensionMonthlyTarget).toBe(0);
  });
});

describe('generateSpendingAdjustmentCandidates', () => {
  const basePlan = getIdentityPlan(baseParams);

  test('allowIncrease가 false이면 후보를 생성하지 않는다', () => {
    const candidates = generateSpendingAdjustmentCandidates(baseParams, basePlan, { allowIncrease: false });
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

  test('정상 조건이면 배수 후보 2개(1.1, 1.2)를 생성하고 나머지 필드는 basePlan을 유지한다', () => {
    const candidates = generateSpendingAdjustmentCandidates(baseParams, basePlan, { allowIncrease: true });

    expect(candidates.map((c) => c.monthlySpendingMultiplier)).toEqual([1.1, 1.2]);
    for (const c of candidates) {
      expect(c.assetSellOrderStrategy).toBe(basePlan.assetSellOrderStrategy);
    }
  });
});
