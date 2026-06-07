import { SimulationParams } from '../../core/entities/types';

const STORAGE_KEY = 'nextlife_simulator_params';

export const initialParams: SimulationParams = {
  userProfile: {
    currentAge: 40,
    retirementAge: 60,
    expectancy: 85,
    targetMonthlySpending: 3000000, // 300만 원
  },
  assets: [
    {
      id: 'asset-voo',
      type: 'etf',
      ticker: 'VOO',
      name: 'Vanguard S&P 500 ETF',
      quantity: 100,
      averagePrice: 500, // USD
      annualGrowthRate: 8,
      dividendYield: 1.5,
      monthlyContribution: 200, // USD
      reinvestDividend: true,
      currency: 'USD',
    },
    {
      id: 'asset-schd',
      type: 'etf',
      ticker: 'SCHD',
      name: 'Schwab US Dividend Equity ETF',
      quantity: 200,
      averagePrice: 80, // USD
      annualGrowthRate: 8,
      dividendYield: 3.5,
      monthlyContribution: 300, // USD
      reinvestDividend: false,
      currency: 'USD',
    },
  ],
  nationalPension: {
    expectedMonthlyAmount: 1000000, // 100만 원
  },
  privatePensions: [
    {
      id: 'pension-irp',
      type: 'irp',
      balance: 30000000, // 3,000만 원
      monthlyContribution: 500000, // 50만 원
      annualReturn: 5,
      currency: 'KRW',
    },
    {
      id: 'pension-savings',
      type: 'savings',
      balance: 20000000, // 2,000만 원
      monthlyContribution: 340000, // 34만 원
      annualReturn: 5,
      currency: 'KRW',
    },
  ],
  otherIncomes: [
    {
      id: 'income-rent',
      label: '부동산 임대소득',
      monthlyAmount: 500000, // 50만 원
      currency: 'KRW',
    },
  ],
  inflationRate: 2.5,
  inflationMode: 'nominal',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
  yieldPreset: 'base',
};

export const loadParams = (): SimulationParams => {
  if (typeof window === 'undefined') return initialParams;
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return initialParams;
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(params));
  } catch (e) {
    console.error('Failed to save simulation params to LocalStorage:', e);
  }
};
