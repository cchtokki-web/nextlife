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
    //
    // **상한을 맨 마지막에 건다.** 예전에는 가격 CAGR에만 걸려 있어 배당이 상한을
    // 우회했다 — 상한이 9.5%인데 배당 8%인 종목이 실효 17.5%로 조회되는 식이었다.
    if (isNaN(cagr)) cagr = 6.0; // 데이터 계산 실패 시에만 기본값 사용
    else if (cagr < 0) cagr = 0; // 실시간 조회 값이 마이너스여도 가격 상승률 최소값은 0으로 한다

    if (dividendYield > 30 || dividendYield < 0 || isNaN(dividendYield)) dividendYield = 0;

    // 배당을 포함한 총수익률에 장기 상한을 건다. 상한에 걸리면 totalReturn < dividendYield가
    // 되어 가격상승률이 음수가 되는 종목이 생긴다 — 분배금이 총수익률을 넘는 상품의 NAV
    // 잠식을 그대로 표현한 것이라 의도된 결과다.
    let totalReturn = cagr + dividendYield;
    if (totalReturn > 9.5) totalReturn = 9.5;

    return Response.json({
      ticker,
      totalReturn: Math.round(totalReturn * 10) / 10,
      dividendYield: Math.round(dividendYield * 10) / 10,
    });

  } catch (error) {
    console.error('Error fetching stock info:', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
