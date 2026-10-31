import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/stock-info/route';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('관측 가능한 배당률', () => {
  it('최근 배당과 유효한 가격이 있으면 관측 배당률을 기존 응답과 함께 반환한다', async () => {
    const now = Math.floor(Date.now() / 1000);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ chart: { result: [{
      meta: { regularMarketPrice: 100, regularMarketTime: now },
      timestamp: [now - 400 * 86400, now - 86400],
      indicators: { quote: [{ close: [90, 100] }] },
      events: { dividends: { one: { date: now - 100 * 86400, amount: 2 } } },
    }] } })));
    const response = await GET(new NextRequest('http://localhost/api/stock-info?ticker=VOO'));
    expect(await response.json()).toMatchObject({ dividendYield: 2, observedDividendYield: 2 });
  });

  it('배당 사건이 없으면 기본값을 관측치로 반환하지 않는다', async () => {
    const now = Math.floor(Date.now() / 1000);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ chart: { result: [{
      meta: { regularMarketPrice: 100, regularMarketTime: now },
      timestamp: [now - 400 * 86400, now - 86400], indicators: { quote: [{ close: [90, 100] }] },
    }] } })));
    const response = await GET(new NextRequest('http://localhost/api/stock-info?ticker=VOO'));
    expect(await response.json()).toMatchObject({ dividendYield: 1, observedDividendYield: null });
  });

  it('시세가 오래되거나 관측 기간이 짧으면 배당률 자동 갱신값을 반환하지 않는다', async () => {
    const now = Math.floor(Date.now() / 1000);
    for (const { marketTime, first } of [
      { marketTime: now - 31 * 86400, first: now - 400 * 86400 },
      { marketTime: now, first: now - 100 * 86400 },
    ]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ chart: { result: [{
        meta: { regularMarketPrice: 100, regularMarketTime: marketTime },
        timestamp: [first, now - 86400], indicators: { quote: [{ close: [90, 100] }] },
        events: { dividends: { one: { date: now - 20 * 86400, amount: 2 } } },
      }] } })));
      const response = await GET(new NextRequest('http://localhost/api/stock-info?ticker=VOO'));
      expect(await response.json()).toMatchObject({ observedDividendYield: null });
    }
  });
});
