import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/stock-price/route';

afterEach(() => vi.unstubAllGlobals());

describe('시세 기준 시각', () => {
  it('원천의 시세 기준 시각을 기존 가격·통화와 함께 제공한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ chart: { result: [{ meta: {
      regularMarketPrice: 100, currency: 'USD', regularMarketTime: 1700000000,
    } }] } })));
    const response = await GET(new NextRequest('http://localhost/api/stock-price?ticker=VOO'));
    expect(await response.json()).toEqual({ ticker: 'VOO', price: 100, currency: 'USD', marketTime: 1700000000 });
  });

  it('원천에 시각이 없을 때 요청 시각으로 대체하지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ chart: { result: [{ meta: {
      regularMarketPrice: 100, currency: 'USD',
    } }] } })));
    const response = await GET(new NextRequest('http://localhost/api/stock-price?ticker=VOO'));
    expect(await response.json()).toMatchObject({ price: 100, marketTime: null });
  });
});
