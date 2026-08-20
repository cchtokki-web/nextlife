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
}

export const predefinedAssets: PredefinedAsset[] = [
  // 미국 ETF (US ETFs)
  {
    ticker: 'VOO',
    name: 'Vanguard S&P 500 ETF',
    type: 'etf',
    currency: 'USD',
    totalReturn: 9.4,
    dividendYield: 1.4,
  },
  {
    ticker: 'QQQ',
    name: 'Invesco QQQ Trust',
    type: 'etf',
    currency: 'USD',
    totalReturn: 9.6,
    dividendYield: 0.6,
  },
  {
    ticker: 'SCHD',
    name: 'Schwab US Dividend Equity ETF',
    type: 'etf',
    currency: 'USD',
    totalReturn: 10.5,
    dividendYield: 3.5,
  },
  {
    ticker: 'SPY',
    name: 'SPDR S&P 500 ETF Trust',
    type: 'etf',
    currency: 'USD',
    totalReturn: 9.4,
    dividendYield: 1.4,
  },
  {
    ticker: 'SPLG',
    name: 'SPDR Portfolio S&P 500 ETF',
    type: 'etf',
    currency: 'USD',
    totalReturn: 9.4,
    dividendYield: 1.4,
  },
  {
    ticker: 'JEPI',
    name: 'JPMorgan Equity Premium Income ETF',
    type: 'etf',
    currency: 'USD',
    totalReturn: 13.0,
    dividendYield: 8.0,
  },
  {
    ticker: 'TLT',
    name: 'iShares 20+ Year Treasury Bond ETF',
    type: 'etf',
    currency: 'USD',
    totalReturn: 7.5,
    dividendYield: 4.0,
  },
  {
    ticker: 'VNQ',
    name: 'Vanguard Real Estate ETF',
    type: 'etf',
    currency: 'USD',
    totalReturn: 9.2,
    dividendYield: 4.2,
  },

  // 미국 주식 (US Stocks)
  {
    ticker: 'AAPL',
    name: 'Apple Inc.',
    type: 'stock',
    currency: 'USD',
    totalReturn: 9.5,
    dividendYield: 0.5,
  },
  {
    ticker: 'MSFT',
    name: 'Microsoft Corporation',
    type: 'stock',
    currency: 'USD',
    totalReturn: 10.7,
    dividendYield: 0.7,
  },
  {
    ticker: 'NVDA',
    name: 'NVIDIA Corporation',
    type: 'stock',
    currency: 'USD',
    totalReturn: 12.1,
    dividendYield: 0.1,
  },
  {
    ticker: 'TSLA',
    name: 'Tesla, Inc.',
    type: 'stock',
    currency: 'USD',
    totalReturn: 12.0,
    dividendYield: 0.0,
  },
  {
    ticker: 'GOOGL',
    name: 'Alphabet Inc.',
    type: 'stock',
    currency: 'USD',
    totalReturn: 9.4,
    dividendYield: 0.4,
  },
  {
    ticker: 'AMZN',
    name: 'Amazon.com, Inc.',
    type: 'stock',
    currency: 'USD',
    totalReturn: 9.0,
    dividendYield: 0.0,
  },
  {
    ticker: 'META',
    name: 'Meta Platforms, Inc.',
    type: 'stock',
    currency: 'USD',
    totalReturn: 9.4,
    dividendYield: 0.4,
  },
  {
    ticker: 'O',
    name: 'Realty Income Corporation',
    type: 'stock',
    currency: 'USD',
    totalReturn: 9.5,
    dividendYield: 5.5,
  },

  // 국내 ETF (Korean ETFs)
  {
    ticker: '069500',
    name: 'KODEX 200 (삼성)',
    type: 'etf',
    currency: 'KRW',
    totalReturn: 8.0,
    dividendYield: 2.0,
  },
  {
    ticker: '360750',
    name: 'TIGER 미국S&P500 (미래에셋)',
    type: 'etf',
    currency: 'KRW',
    totalReturn: 9.3,
    dividendYield: 1.3,
  },
  {
    ticker: '133690',
    name: 'TIGER 미국나스닥100 (미래에셋)',
    type: 'etf',
    currency: 'KRW',
    totalReturn: 9.5,
    dividendYield: 0.5,
  },
  {
    ticker: '458730',
    name: 'TIGER 미국배당다우존스 (미래에셋)',
    type: 'etf',
    currency: 'KRW',
    totalReturn: 10.5,
    dividendYield: 3.5,
  },
  {
    ticker: '476560',
    name: 'KODEX 미국반도체MV (삼성)',
    type: 'etf',
    currency: 'KRW',
    totalReturn: 9.8,
    dividendYield: 0.3,
  },
  {
    ticker: '368590',
    name: 'ACE 미국S&P500 (한국투자)',
    type: 'etf',
    currency: 'KRW',
    totalReturn: 9.3,
    dividendYield: 1.3,
  },
  {
    ticker: '381170',
    name: 'TIGER 미국필라델피아반도체나스닥',
    type: 'etf',
    currency: 'KRW',
    totalReturn: 9.8,
    dividendYield: 0.3,
  },

  // 국내 주식 (Korean Stocks)
  {
    ticker: '005930',
    name: '삼성전자',
    type: 'stock',
    currency: 'KRW',
    totalReturn: 8.5,
    dividendYield: 2.5,
  },
  {
    ticker: '000660',
    name: 'SK하이닉스',
    type: 'stock',
    currency: 'KRW',
    totalReturn: 9.0,
    dividendYield: 1.0,
  },
  {
    ticker: '005380',
    name: '현대차',
    type: 'stock',
    currency: 'KRW',
    totalReturn: 9.5,
    dividendYield: 4.5,
  },
  {
    ticker: '035420',
    name: 'NAVER',
    type: 'stock',
    currency: 'KRW',
    totalReturn: 7.8,
    dividendYield: 0.8,
  },
  {
    ticker: '035720',
    name: '카카오',
    type: 'stock',
    currency: 'KRW',
    totalReturn: 7.4,
    dividendYield: 0.4,
  },
  {
    ticker: '207940',
    name: '삼성바이오로직스',
    type: 'stock',
    currency: 'KRW',
    totalReturn: 8.0,
    dividendYield: 0.0,
  },
  {
    ticker: '373220',
    name: 'LG에너지솔루션',
    type: 'stock',
    currency: 'KRW',
    totalReturn: 8.0,
    dividendYield: 0.0,
  },
  {
    ticker: '055600',
    name: 'KB금융',
    type: 'stock',
    currency: 'KRW',
    totalReturn: 9.5,
    dividendYield: 5.5,
  },

  // 사적연금 (Private Pension)
  {
    ticker: 'PENSION_DEP',
    name: '사적연금(예금)',
    type: 'etf',
    currency: 'KRW',
    totalReturn: 3.0,
    dividendYield: 0.0,
  },
  {
    ticker: 'PENSION_ETF',
    name: '사적연금(ETF)',
    type: 'etf',
    currency: 'KRW',
    totalReturn: 8.5,
    dividendYield: 1.5,
  },
];
