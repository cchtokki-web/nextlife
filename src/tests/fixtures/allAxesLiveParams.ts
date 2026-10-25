import { SimulationParams } from '@/core/entities/types';

// 모든 전략 축이 살아 있는 시뮬레이션 파라미터.
//
// 자산 2종(배당률 상이) · ISA 1좌 · 사적연금(IRP 6억) · 국민연금을 모두 갖춰,
// StrategyCandidateGenerator의 5개 차원이 전부 의미를 갖는다(최악 216개 후보).
// 어느 하나라도 빠지면 그 축의 후보가 생성되지 않아 "축을 바꿔도 결과가 같다"가
// 결함 때문인지 픽스처 때문인지 구분할 수 없게 된다.
//
// 원래 RecommendationEngine.performance.test.ts의 성능 회귀 가드용 픽스처였다.
// strategyAxisDelta 테스트가 같은 조건("모든 차원이 살아 있음")을 필요로 해 여기로 옮겼다.
//
// 물가 0% · 실질 기준인 이유: 명목 성장이 섞이면 축을 바꿔서 생긴 차이와 물가로 생긴
// 차이를 눈으로 구분할 수 없다. 축의 효과만 남기기 위한 선택이다.
export const allAxesLiveParams: SimulationParams = {
  userProfile: {
    currentAge: 55,
    retirementAge: 61,
    expectancy: 95,
    targetMonthlySpending: 3000000,
  },
  assets: [
    { id: 'a1', type: 'etf', ticker: 'A', name: '자산1', quantity: 1, averagePrice: 100, totalReturn: 5, dividendYield: 2, monthlyContribution: 0, reinvestDividend: false, currency: 'KRW' },
    { id: 'a2', type: 'etf', ticker: 'B', name: '자산2', quantity: 1, averagePrice: 100, totalReturn: 5, dividendYield: 4, monthlyContribution: 0, reinvestDividend: false, currency: 'KRW' },
  ],
  isaAccounts: [
    { id: 'isa-1', type: 'general', balance: 1000000, monthlyContribution: 0, totalReturn: 5, dividendYield: 0, currency: 'KRW', maturityYears: 3 },
  ],
  nationalPension: { expectedMonthlyAmount: 1000000 },
  privatePensions: [
    {
      id: 'pension-1',
      type: 'irp',
      balance: 600000000,
      monthlyContribution: 0,
      totalReturn: 4,
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
