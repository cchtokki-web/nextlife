import { type NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  let ticker = searchParams.get('ticker');

  if (!ticker) {
    return Response.json({ error: 'Ticker is required' }, { status: 400 });
  }

  ticker = ticker.trim().toUpperCase();

  // If it's a numeric ticker (e.g. Korean stock/ETF) and doesn't contain a suffix, default to KOSPI (.KS)
  if (/^\d{6}$/.test(ticker)) {
    ticker = `${ticker}.KS`;
  }

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    if (!response.ok) {
      return Response.json({ error: `Failed to fetch price for ${ticker}` }, { status: response.status });
    }

    const data = await response.json();
    const result = data?.chart?.result?.[0];
    const meta = result?.meta;
    const price = meta?.regularMarketPrice;
    const currency = meta?.currency;

    if (typeof price !== 'number') {
      return Response.json({ error: `Price data not found for ${ticker}` }, { status: 404 });
    }

    return Response.json({ ticker, price, currency });
  } catch (error: any) {
    console.error('Error fetching stock price:', error);
    return Response.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
