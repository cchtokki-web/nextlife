import { type NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  let ticker = searchParams.get('ticker');

  if (!ticker) {
    return Response.json({ error: 'Ticker is required' }, { status: 400 });
  }

  ticker = ticker.trim().toUpperCase();
  if (/^\d{6}$/.test(ticker)) {
    ticker = `${ticker}.KS`;
  }

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=5y&interval=1mo&events=div`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      next: { revalidate: 86400 } // Cache for 24 hours
    });

    if (!response.ok) {
      return Response.json({ error: `Failed to fetch info for ${ticker}` }, { status: response.status });
    }

    const data = await response.json();
    const result = data?.chart?.result?.[0];
    
    if (!result) {
      return Response.json({ error: `Data not found for ${ticker}` }, { status: 404 });
    }

    const meta = result.meta;
    const currentPrice = meta?.regularMarketPrice;

    // Calculate 5-year CAGR
    let cagr = 6.0; // Default fallback
    const quotes = result.indicators?.quote?.[0];
    if (quotes && quotes.close && quotes.close.length > 0) {
      // Find first valid close price
      let firstPrice = null;
      let firstIndex = 0;
      for (let i = 0; i < quotes.close.length; i++) {
        if (quotes.close[i] !== null) {
          firstPrice = quotes.close[i];
          firstIndex = i;
          break;
        }
      }
      
      // Find last valid close price
      let lastPrice = null;
      let lastIndex = quotes.close.length - 1;
      for (let i = quotes.close.length - 1; i >= 0; i--) {
        if (quotes.close[i] !== null) {
          lastPrice = quotes.close[i];
          lastIndex = i;
          break;
        }
      }

      if (firstPrice && lastPrice && firstPrice > 0 && lastIndex > firstIndex) {
        // Calculate the actual number of years based on timestamps
        const timestamps = result.timestamp;
        const firstTime = timestamps[firstIndex];
        const lastTime = timestamps[lastIndex];
        const years = (lastTime - firstTime) / (365.25 * 24 * 60 * 60);
        
        if (years >= 1) { // Only calculate if we have at least 1 year of data
          cagr = (Math.pow(lastPrice / firstPrice, 1 / years) - 1) * 100;
        }
      }
    }

    // Calculate Dividend Yield
    let dividendYield = 1.0; // Default fallback
    const dividends = result.events?.dividends;
    if (dividends && currentPrice && currentPrice > 0) {
      const now = Date.now() / 1000;
      const oneYearAgo = now - (365 * 24 * 60 * 60);
      
      let annualDividends = 0;
      for (const key in dividends) {
        const div = dividends[key];
        if (div.date >= oneYearAgo) {
          annualDividends += div.amount;
        }
      }
      
      dividendYield = (annualDividends / currentPrice) * 100;
    }

    // Sanity checks and conservative adjustments
    // Cap long-term CAGR at 9.5% for general assets to avoid overly optimistic projections
    if (isNaN(cagr)) cagr = 6.0; // 데이터 계산 실패 시에만 기본값 사용
    else if (cagr > 9.5) cagr = 9.5;
    else if (cagr < 0) cagr = 0; // 실시간 조회 값이 마이너스여도 연 성장률 최소값은 0으로 한다

    if (dividendYield > 30 || dividendYield < 0 || isNaN(dividendYield)) dividendYield = 0;

    return Response.json({
      ticker,
      annualGrowthRate: Math.round(cagr * 10) / 10,
      dividendYield: Math.round(dividendYield * 10) / 10,
    });

  } catch (error) {
    console.error('Error fetching stock info:', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
