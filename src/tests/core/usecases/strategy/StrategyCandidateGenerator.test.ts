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
    expect(candidates.length).toBeLessThanOrEqual(150); // 브라우저 실시간 처리 가능한 상한 (최대 5×5×5=125)

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
    // 사적연금 그리드(5×5)만큼만 생성되어야 함
    expect(candidates.length).toBe(25);
  });

  test('국민연금 수령액이 있으면 조기~연기 수령 나이 그리드를 함께 탐색한다', () => {
    const paramsWithNationalPension: SimulationParams = {
      ...baseParams,
      nationalPension: { expectedMonthlyAmount: 1000000 },
    };
    const candidates = generateCandidatePlans(paramsWithNationalPension);

    const distinctNationalPensionAges = new Set(candidates.map((c) => c.nationalPensionStartAge));
    expect(distinctNationalPensionAges.size).toBeGreaterThan(1);
    // 5(사적연금 개시나이) × 5(월인출액) × 5(국민연금 개시나이) = 125
    expect(candidates.length).toBe(125);

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
});
