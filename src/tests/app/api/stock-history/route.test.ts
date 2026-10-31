import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/stock-history/route';

const request = (query: string) => new NextRequest(`http://localhost/api/stock-history?${query}`);
const fixture = {
  chart: { result: [{
    meta: { exchangeTimezoneName: 'America/New_York', currency: 'USD' },
    timestamp: [Date.parse('2026-01-02T21:00:00Z') / 1000, Date.parse('2026-01-05T21:00:00Z') / 1000],
    indicators: { quote: [{ close: [100, null] }] },
    events: { dividends: { d: { date: Date.parse('2026-01-05T14:30:00Z') / 1000, amount: 1 } } },
  }] },
};

afterEach(() => vi.unstubAllGlobals());

describe('과거 시세 조회', () => {
  it('현지 거래일을 기준으로 범위를 제한하고 누락 종가와 원천 사건을 보존한다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(fixture));
    vi.stubGlobal('fetch', fetchMock);
    const response = await GET(request('ticker=voo&start=2026-01-02&end=2026-01-05'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ticker: 'VOO', currency: 'USD', timezone: 'America/New_York', completeness: 'unverified',
      prices: [{ date: '2026-01-02', close: 100 }, { date: '2026-01-05', close: null }],
      dividends: [{ amount: 1 }], splits: [],
    });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: 'no-store' });
  });

  it('국내 숫자 코드에 거래소 접미사를 붙인다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(fixture));
    vi.stubGlobal('fetch', fetchMock);
    await GET(request('ticker=069500&start=2026-01-02&end=2026-01-05'));
    expect(String(fetchMock.mock.calls[0][0])).toContain('/069500.KS?');
  });

  it('잘못된 입력은 외부 요청 없이 거부한다', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    for (const query of [
      'ticker=VOO%2Ffoo&start=2026-01-02&end=2026-01-05',
      'ticker=VOO&start=2026-02-30&end=2026-03-01',
      'ticker=VOO&start=2026-01-05&end=2026-01-02',
      'ticker=VOO&start=2000-01-01&end=2026-01-02',
    ]) expect((await GET(request(query))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('원천 요청 실패와 손상된 배열은 성공한 빈 데이터로 표시하지 않는다', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(Response.json({ chart: { result: [{ meta: {}, timestamp: [1] }] } }));
    vi.stubGlobal('fetch', fetchMock);
    expect((await GET(request('ticker=VOO&start=2026-01-02&end=2026-01-05'))).status).toBe(502);
    expect((await GET(request('ticker=VOO&start=2026-01-02&end=2026-01-05'))).status).toBe(502);
  });
});
