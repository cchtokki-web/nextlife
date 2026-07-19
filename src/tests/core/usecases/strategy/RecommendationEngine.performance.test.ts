import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { recommendStrategy } from '@/core/usecases/strategy/RecommendationEngine';
import { SimulationParams } from '@/core/entities/types';

// StrategyCandidateGenerator의 최악 시나리오(864개 후보, StrategyCandidateGenerator.test.ts 참고)에서
// recommendStrategy가 브라우저 실시간 처리에 부적합할 만큼 느려지지 않는지 검증하는 성능 회귀 가드.
// runForUtility() 도입 전(각 후보마다 run()의 findMaxSustainableValue 30회 이진탐색까지 포함)에는
// 이 시나리오가 수 초 이상 걸렸다.
const worstCaseParams: SimulationParams = {
  userProfile: {
    currentAge: 55,
    retirementAge: 61,
    expectancy: 95,
    targetMonthlySpending: 3000000,
  },
  assets: [
    { id: 'a1', type: 'etf', ticker: 'A', name: '자산1', quantity: 1, averagePrice: 100, annualGrowthRate: 5, dividendYield: 2, monthlyContribution: 0, reinvestDividend: false, currency: 'KRW' },
    { id: 'a2', type: 'etf', ticker: 'B', name: '자산2', quantity: 1, averagePrice: 100, annualGrowthRate: 5, dividendYield: 4, monthlyContribution: 0, reinvestDividend: false, currency: 'KRW' },
  ],
  isaAccounts: [
    { id: 'isa-1', type: 'general', balance: 1000000, monthlyContribution: 0, annualReturn: 5, dividendYield: 0, currency: 'KRW', maturityYears: 3 },
  ],
  nationalPension: { expectedMonthlyAmount: 1000000 },
  privatePensions: [
    {
      id: 'pension-1',
      type: 'irp',
      balance: 600000000,
      monthlyContribution: 0,
      annualReturn: 4,
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

describe('recommendStrategy - 성능 회귀 가드', () => {
  test('최악 시나리오(864개 후보)에서도 5초 이내에 완료된다', () => {
    const engine = new SimulationEngine();

    const start = performance.now();
    const recommendation = recommendStrategy(worstCaseParams, engine);
    const elapsedMs = performance.now() - start;

    expect(elapsedMs).toBeLessThan(5000);
    expect(recommendation.recommendedUtility.score).toBeGreaterThanOrEqual(recommendation.currentUtility.score);
  });
});
