import { SimulationParams } from '../../core/entities/types';
import { SIMULATOR_PARAMS_KEY } from './storageKeys';

export const initialParams: SimulationParams = {
  userProfile: {
    currentAge: 50,
    retirementAge: 60,
    expectancy: 85,
    targetMonthlySpending: 3500000, // 350만 원 (통계청 50대 평균 소비지출 참고)
  },
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

export const loadParams = (): SimulationParams => {
  if (typeof window === 'undefined') return initialParams;
  try {
    const data = localStorage.getItem(SIMULATOR_PARAMS_KEY);
    if (!data || data === 'undefined' || data === 'null') return initialParams;
    const parsed = JSON.parse(data);
    
    // 구조가 맞는지 가볍게 밸리데이션 후 리턴
    if (parsed.userProfile && Array.isArray(parsed.assets)) {
      return parsed as SimulationParams;
    }
  } catch (e) {
    console.error('Failed to load simulation params from LocalStorage:', e);
  }
  return initialParams;
};

export const saveParams = (params: SimulationParams): void => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(SIMULATOR_PARAMS_KEY, JSON.stringify(params));
  } catch (e) {
    console.error('Failed to save simulation params to LocalStorage:', e);
  }
};
