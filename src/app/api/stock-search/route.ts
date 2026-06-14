import { type NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const q = searchParams.get('q');

  if (!q) {
    return Response.json({ error: 'Query is required' }, { status: 400 });
  }

  try {
    const url = `https://m.stock.naver.com/front-api/search/autoComplete?query=${encodeURIComponent(q)}&target=stock`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    if (!response.ok) {
      return Response.json({ error: `Failed to fetch search results` }, { status: response.status });
    }

    const data = await response.json();
    
    if (!data.isSuccess || !data.result || !data.result.items) {
      return Response.json({ results: [] });
    }

    const items = data.result.items;

    const results = items.map((item: any) => {
      let ticker = item.code;
      let currency = 'USD';
      
      if (item.nationCode === 'KOR') {
        currency = 'KRW';
        if (item.typeCode === 'KOSPI') {
          ticker = `${ticker}.KS`;
        } else if (item.typeCode === 'KOSDAQ') {
          ticker = `${ticker}.KQ`;
        } else {
          ticker = `${ticker}.KS`;
        }
      } else if (item.nationCode === 'USA') {
        // Use reutersCode if it contains dot (e.g., AAPL.O) but for Yahoo Finance we usually just need the ticker like AAPL.
        // Actually item.code is usually the pure ticker like 'AAPL' or 'SPY'.
        ticker = item.code;
      }

      let type = 'stock';
      const isEtf = (item.url && item.url.includes('/etf/')) || 
                    /KODEX|TIGER|ACE|KBSTAR|HANARO|ARIRANG|SOL|KOSEF|TIMEFOLIO|FOCUS|PLUS/.test(item.name.toUpperCase());
      if (isEtf) {
        type = 'etf';
      }

      return {
        ticker,
        name: item.name,
        type,
        currency,
        exchDisp: item.typeName || item.nationName || 'Unknown',
      };
    });

    return Response.json({ results });
  } catch (error: any) {
    console.error('Error fetching stock search:', error);
    return Response.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
