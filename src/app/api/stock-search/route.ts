import { type NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const q = searchParams.get('q');

  if (!q) {
    return Response.json({ error: 'Query is required' }, { status: 400 });
  }

  try {
    const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    if (!response.ok) {
      return Response.json({ error: `Failed to fetch search results` }, { status: response.status });
    }

    const data = await response.json();
    const quotes = data.quotes || [];

    const results = quotes
      .filter((q: any) => q.quoteType === 'EQUITY' || q.quoteType === 'ETF')
      .map((q: any) => {
        let ticker = q.symbol;
        if (ticker.endsWith('.KS') || ticker.endsWith('.KQ')) {
          ticker = ticker.replace(/\.KS$|\.KQ$/, '');
        }
        
        let currency = 'USD';
        if (q.exchange === 'KSE' || q.exchange === 'KOE' || q.exchange === 'KOSDAQ' || q.symbol.endsWith('.KS') || q.symbol.endsWith('.KQ')) {
          currency = 'KRW';
        }

        return {
          ticker,
          name: q.longname || q.shortname || ticker,
          type: q.quoteType === 'ETF' ? 'etf' : 'stock',
          currency,
          exchDisp: q.exchDisp || q.exchange,
        };
      });

    return Response.json({ results });
  } catch (error: any) {
    console.error('Error fetching stock search:', error);
    return Response.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
