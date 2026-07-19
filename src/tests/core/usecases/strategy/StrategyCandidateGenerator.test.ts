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
    expect(candidates.length).toBeLessThanOrEqual(40); // 브라우저 실시간 처리 가능한 상한

    for (const c of candidates) {
      expect(c.privatePensionStartAge).toBeGreaterThanOrEqual(baseParams.userProfile.retirementAge);
      expect(c.privatePensionStartAge).toBeLessThan(baseParams.userProfile.expectancy);
      expect(c.privatePensionMonthlyTarget).toBeGreaterThan(0);
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
