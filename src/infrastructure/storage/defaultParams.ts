import { SimulationParams } from '../../core/entities/types';
import { DEFAULT_PLAN_HORIZON_AGE } from '../../core/usecases/planHorizon';

// 새 시나리오의 기본값이자 «로드 실패 시의 안전한 바닥». normalizeSimulationParams가
// 필드별 기본값을 여기서 읽으므로, localStore와 별도 모듈로 둔다 — 같은 파일에 두면
// localStore ↔ normalizeSimulationParams 순환 참조가 된다.
export const initialParams: SimulationParams = {
  userProfile: {
    currentAge: 50,
    // 국민연금 정상 개시 나이. 「빠른 은퇴」 목표를 고르지 않으면 계산도 이 나이로 돌아가므로
    // (normalizeGoalDrivenParams), 기본값을 다른 값으로 두면 새 시나리오가 만들어지자마자
    // 저장값과 계산값이 어긋난다.
    retirementAge: 65,
    expectancy: DEFAULT_PLAN_HORIZON_AGE,
    targetMonthlySpending: 3500000, // 350만 원 (통계청 50대 평균 소비지출 참고)
  },
  retirementGoals: [],
  assets: [
    {
      id: 'asset-kodex200',
      type: 'etf',
      ticker: '069500',
      name: 'KODEX 200',
      quantity: 2000,
      averagePrice: 35000, // 약 7,000만 원
      annualGrowthRate: 5,
      dividendYield: 2.0,
      monthlyContribution: 400000,
      reinvestDividend: true,
      currency: 'KRW',
    },
    {
      id: 'asset-tiger-sp500',
      type: 'etf',
      ticker: '360750',
      name: 'TIGER 미국S&P500',
      quantity: 4000,
      averagePrice: 15000, // 약 6,000만 원
      annualGrowthRate: 8,
      dividendYield: 1.5,
      monthlyContribution: 300000,
      reinvestDividend: true,
      currency: 'KRW',
    },
  ],
  nationalPension: {
    expectedMonthlyAmount: 1200000, // 120만 원 (50대 평균 예상 수령액 수준)
  },
  privatePensions: [
    {
      id: 'pension-irp',
      type: 'irp',
      balance: 50000000, // 5,000만 원
      monthlyContribution: 400000, // 40만 원
      annualReturn: 4,
      currency: 'KRW',
    },
    {
      id: 'pension-savings',
      type: 'savings',
      balance: 60000000, // 6,000만 원
      monthlyContribution: 500000, // 50만 원
      annualReturn: 4,
      currency: 'KRW',
    },
  ],
  otherIncomes: [],
  inflationRate: 2.5,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
  yieldPreset: 'base',
};
