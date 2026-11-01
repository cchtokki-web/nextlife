import type { InvestmentCategory } from '../../../core/entities/types';

// **여기의 totalReturn은 배당을 포함한 값이다.**
//
// 예전에는 이 표가 가격상승률과 배당률을 따로 들고 있었고 엔진이 둘을 더해 굴렸다.
// 즉 SCHD는 언제나 10.5%로 계산돼 왔다. 총수익률 표기로 옮기면서 그 합을 그대로 적었다 —
// 값을 새로 정하지 않고 지금까지의 동작을 보존한 것이다.
//
// 그래서 이 숫자들이 높아 보인다면, 그것은 표기가 바뀌어서가 아니라 원래 그랬던 것이
// 드러난 것이다. 값 자체를 고칠 때는 근거를 함께 적을 것.

export interface PredefinedAsset {
  ticker: string;
  name: string;
  type: 'stock' | 'etf';
  currency: 'USD' | 'KRW';
  /** 배당을 포함한 연 총수익률 %. dividendYield를 빼면 가격상승률이 된다. */
  totalReturn: number;
  dividendYield: number;
  category: InvestmentCategory;
}

export const predefinedAssets: PredefinedAsset[] = [
  // 미국 ETF (US ETFs)
  {
    ticker: 'VOO',
    category: 'index',
    name: 'Vanguard S&P 500 ETF',
    type: 'etf',
    currency: 'USD',
    totalReturn: 9.4,
    dividendYield: 1.4,
  },
  {
    ticker: 'QQQ',
    category: 'growth',
    name: 'Invesco QQQ Trust',
    type: 'etf',
    currency: 'USD',
    totalReturn: 9.6,
    dividendYield: 0.6,
  },
  {
    ticker: 'SCHD',
    category: 'dividend',
    name: 'Schwab US Dividend Equity ETF',
    type: 'etf',
    currency: 'USD',
    totalReturn: 10.5,
    dividendYield: 3.5,
  },
  {
    ticker: 'SPY',
    category: 'index',
    name: 'SPDR S&P 500 ETF Trust',
    type: 'etf',
    currency: 'USD',
    totalReturn: 9.4,
    dividendYield: 1.4,
  },
  {
    ticker: 'SPLG',
    category: 'index',
    name: 'SPDR Portfolio S&P 500 ETF',
    type: 'etf',
    currency: 'USD',
    totalReturn: 9.4,
    dividendYield: 1.4,
  },
  {
    ticker: 'JEPI',
    category: 'income',
    name: 'JPMorgan Equity Premium Income ETF',
    type: 'etf',
    currency: 'USD',
    totalReturn: 13.0,
    dividendYield: 8.0,
  },
  {
    ticker: 'TLT',
    category: 'bond',
    name: 'iShares 20+ Year Treasury Bond ETF',
    type: 'etf',
    currency: 'USD',
    totalReturn: 7.5,
    dividendYield: 4.0,
  },
  {
    ticker: 'VNQ',
    category: 'income',
    name: 'Vanguard Real Estate ETF',
    type: 'etf',
    currency: 'USD',
    totalReturn: 9.2,
    dividendYield: 4.2,
  },

  // 미국 주식 (US Stocks)
  {
    ticker: 'AAPL', category: 'other',
    name: 'Apple Inc.',
    type: 'stock',
    currency: 'USD',
    totalReturn: 9.5,
    dividendYield: 0.5,
  },
  {
    ticker: 'MSFT', category: 'other',
    name: 'Microsoft Corporation',
    type: 'stock',
    currency: 'USD',
    totalReturn: 10.7,
    dividendYield: 0.7,
  },
  {
    ticker: 'NVDA', category: 'growth',
    name: 'NVIDIA Corporation',
    type: 'stock',
    currency: 'USD',
    totalReturn: 12.1,
    dividendYield: 0.1,
  },
  {
    ticker: 'TSLA', category: 'growth',
    name: 'Tesla, Inc.',
    type: 'stock',
    currency: 'USD',
    totalReturn: 12.0,
    dividendYield: 0.0,
  },
  {
    ticker: 'GOOGL', category: 'growth',
    name: 'Alphabet Inc.',
    type: 'stock',
    currency: 'USD',
    totalReturn: 9.4,
    dividendYield: 0.4,
  },
  {
    ticker: 'AMZN', category: 'growth',
    name: 'Amazon.com, Inc.',
    type: 'stock',
    currency: 'USD',
    totalReturn: 9.0,
    dividendYield: 0.0,
  },
  {
    ticker: 'META', category: 'growth',
    name: 'Meta Platforms, Inc.',
    type: 'stock',
    currency: 'USD',
    totalReturn: 9.4,
    dividendYield: 0.4,
  },
  {
    ticker: 'O', category: 'income',
    name: 'Realty Income Corporation',
    type: 'stock',
    currency: 'USD',
    totalReturn: 9.5,
    dividendYield: 5.5,
  },

  // 국내 ETF (Korean ETFs)
  {
    ticker: '069500', category: 'index',
    name: 'KODEX 200 (삼성)',
    type: 'etf',
    currency: 'KRW',
    totalReturn: 8.0,
    dividendYield: 2.0,
  },
  {
    ticker: '360750', category: 'index',
    name: 'TIGER 미국S&P500 (미래에셋)',
    type: 'etf',
    currency: 'KRW',
    totalReturn: 9.3,
    dividendYield: 1.3,
  },
  {
    ticker: '133690', category: 'growth',
    name: 'TIGER 미국나스닥100 (미래에셋)',
    type: 'etf',
    currency: 'KRW',
    totalReturn: 9.5,
    dividendYield: 0.5,
  },
  {
    ticker: '458730', category: 'dividend',
    name: 'TIGER 미국배당다우존스 (미래에셋)',
    type: 'etf',
    currency: 'KRW',
    totalReturn: 10.5,
    dividendYield: 3.5,
  },
  {
    ticker: '476560', category: 'growth',
    name: 'KODEX 미국반도체MV (삼성)',
    type: 'etf',
    currency: 'KRW',
    totalReturn: 9.8,
    dividendYield: 0.3,
  },
  {
    ticker: '368590', category: 'index',
    name: 'ACE 미국S&P500 (한국투자)',
    type: 'etf',
    currency: 'KRW',
    totalReturn: 9.3,
    dividendYield: 1.3,
  },
  {
    ticker: '381170', category: 'growth',
    name: 'TIGER 미국필라델피아반도체나스닥',
    type: 'etf',
    currency: 'KRW',
    totalReturn: 9.8,
    dividendYield: 0.3,
  },

  // 국내 주식 (Korean Stocks)
  {
    ticker: '005930', category: 'other',
    name: '삼성전자',
    type: 'stock',
    currency: 'KRW',
    totalReturn: 8.5,
    dividendYield: 2.5,
  },
  {
    ticker: '000660', category: 'growth',
    name: 'SK하이닉스',
    type: 'stock',
    currency: 'KRW',
    totalReturn: 9.0,
    dividendYield: 1.0,
  },
  {
    ticker: '005380', category: 'dividend',
    name: '현대차',
    type: 'stock',
    currency: 'KRW',
    totalReturn: 9.5,
    dividendYield: 4.5,
  },
  {
    ticker: '035420', category: 'other',
    name: 'NAVER',
    type: 'stock',
    currency: 'KRW',
    totalReturn: 7.8,
    dividendYield: 0.8,
  },
  {
    ticker: '035720', category: 'growth',
    name: '카카오',
    type: 'stock',
    currency: 'KRW',
    totalReturn: 7.4,
    dividendYield: 0.4,
  },
  {
    ticker: '207940', category: 'growth',
    name: '삼성바이오로직스',
    type: 'stock',
    currency: 'KRW',
    totalReturn: 8.0,
    dividendYield: 0.0,
  },
  {
    ticker: '373220', category: 'growth',
    name: 'LG에너지솔루션',
    type: 'stock',
    currency: 'KRW',
    totalReturn: 8.0,
    dividendYield: 0.0,
  },
  {
    ticker: '055600', category: 'dividend',
    name: 'KB금융',
    type: 'stock',
    currency: 'KRW',
    totalReturn: 9.5,
    dividendYield: 5.5,
  },

  // 사적연금 (Private Pension)
  {
    ticker: 'PENSION_DEP',
    category: 'other',
    name: '사적연금(예금)',
    type: 'etf',
    currency: 'KRW',
    totalReturn: 3.0,
    dividendYield: 0.0,
  },
  {
    ticker: 'PENSION_ETF',
    category: 'other',
    name: '사적연금(ETF)',
    type: 'etf',
    currency: 'KRW',
    totalReturn: 8.5,
    dividendYield: 1.5,
  },
];
