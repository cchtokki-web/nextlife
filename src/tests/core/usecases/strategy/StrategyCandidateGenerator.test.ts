import { describe, test, expect } from 'vitest';
import { generateCandidatePlans } from '@/core/usecases/strategy/StrategyCandidateGenerator';
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

  test('사적연금이 있으면 유효 범위 내의 인출 개시 나이 x 월 인출액 조합을 생성한다', () => {
    const candidates = generateCandidatePlans(baseParams);

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.length).toBeLessThanOrEqual(900); // 브라우저 실시간 처리 가능한 상한 (전체 시나리오 최악의 경우 864, 아래 별도 테스트로 검증)

    for (const c of candidates) {
      expect(c.privatePensionStartAge).toBeGreaterThanOrEqual(baseParams.userProfile.retirementAge);
      expect(c.privatePensionStartAge).toBeLessThan(baseParams.userProfile.expectancy);
      expect(c.privatePensionMonthlyTarget).toBeGreaterThan(0);
    }
  });

  test('국민연금 수령액이 0이면 국민연금 시점은 65세 단일 후보만 사용한다 (후보 폭증 방지)', () => {
    // baseParams.nationalPension.expectedMonthlyAmount === 0
    const candidates = generateCandidatePlans(baseParams);
    for (const c of candidates) {
      expect(c.nationalPensionStartAge).toBe(65);
    }
    // 사적연금 개시나이(retirementAge=60 유니온 포함 4개) × 월인출액(3개)만큼만 생성되어야 함
    expect(candidates.length).toBe(12);
  });

  test('국민연금 수령액이 있으면 조기~연기 수령 나이 그리드를 함께 탐색한다', () => {
    const paramsWithNationalPension: SimulationParams = {
      ...baseParams,
      nationalPension: { expectedMonthlyAmount: 1000000 },
    };
    const candidates = generateCandidatePlans(paramsWithNationalPension);

    const distinctNationalPensionAges = new Set(candidates.map((c) => c.nationalPensionStartAge));
    expect(distinctNationalPensionAges.size).toBeGreaterThan(1);
    // 4(사적연금 개시나이, retirementAge 유니온 포함) × 3(월인출액) × 3(국민연금 개시나이) = 36
    expect(candidates.length).toBe(36);

    for (const c of candidates) {
      expect(c.nationalPensionStartAge).toBeGreaterThanOrEqual(60);
      expect(c.nationalPensionStartAge).toBeLessThanOrEqual(70);
    }
  });

  test('은퇴 나이가 이미 기대수명에 가까우면 유효한 개시 나이 후보만 남는다', () => {
    const candidates = generateCandidatePlans({
      ...baseParams,
      userProfile: { ...baseParams.userProfile, retirementAge: 88, expectancy: 90 },
    });

    for (const c of candidates) {
      expect(c.privatePensionStartAge).toBe(88);
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

  test('모든 차원이 최대로 확장되는 최악의 경우 864개(4×3×3×3×2×4) 후보를 생성한다', () => {
    // retirementAge(61)가 그리드 최솟값(62)보다 작아야 startAgeCandidates/
    // generalAssetWithdrawalStartAgeCandidates가 각각 4개(retirementAge 유니온 포함)가 된다.
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
    expect(candidates.length).toBe(864);
  });
});
