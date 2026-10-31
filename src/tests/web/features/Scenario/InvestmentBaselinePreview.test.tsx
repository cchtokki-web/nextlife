import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { InvestmentBaselinePreview } from '@/web/features/Scenario/InvestmentBaselinePreview';
import { initialParams } from '@/infrastructure/storage/defaultParams';

const asset = { ...initialParams.assets[0], id: 'a', type: 'etf' as const, ticker: 'VOO', name: 'VOO', quantity: 10, currency: 'USD' as const };
const baseline = { capturedAt: '2026-01-01T00:00:00.000Z', params: { ...initialParams, assets: [asset] } };

afterEach(() => vi.unstubAllGlobals());

describe('기준 수량 시세 참고', () => {
  it('기준 수량과 현재 시세를 표시하고 조회 요청에 수량을 보내지 않는다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ price: 120, currency: 'USD', marketTime: 1700000000 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<InvestmentBaselinePreview baseline={baseline} />);
    expect(await screen.findByText(/1,200 USD/)).toBeInTheDocument();
    expect(screen.getByText(/실제 잔고나 현재 평가금과 다를 수 있습니다/)).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/stock-price?ticker=VOO');
  });

  it('시세 통화가 다르거나 기준 시각이 없으면 평가값을 표시하지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ price: 120, currency: 'KRW', marketTime: 1700000000 })));
    const view = render(<InvestmentBaselinePreview baseline={baseline} />);
    expect(await screen.findByText(/시세 통화가 기준 통화와 달라/)).toBeInTheDocument();
    expect(screen.queryByText(/1,200 USD/)).toBeNull();
    view.unmount();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ price: 120, currency: 'USD' })));
    render(<InvestmentBaselinePreview baseline={baseline} />);
    expect(await screen.findByText(/시세 또는 기준 시각을 확인할 수 없습니다/)).toBeInTheDocument();
  });

  it('기준 계획에 ETF가 없으면 외부 조회를 하지 않는다', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(<InvestmentBaselinePreview baseline={{ ...baseline, params: { ...baseline.params, assets: [] } }} />);
    await waitFor(() => expect(screen.getByText('기준 계획에 ETF가 없습니다.')).toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('기준 계획이 바뀐 뒤 늦게 도착한 이전 시세를 표시하지 않는다', async () => {
    let resolveOld!: (response: Response) => void;
    const fetchMock = vi.fn().mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce(Response.json({ price: 20, currency: 'USD', marketTime: 1700000000 }));
    vi.stubGlobal('fetch', fetchMock);
    const view = render(<InvestmentBaselinePreview baseline={baseline} />);
    const next = { ...baseline, params: { ...baseline.params, assets: [{ ...asset, id: 'b', ticker: 'QQQ', name: 'QQQ', quantity: 2 }] } };
    view.rerender(<InvestmentBaselinePreview baseline={next} />);
    expect(await screen.findByText(/40 USD/)).toBeInTheDocument();
    resolveOld(Response.json({ price: 120, currency: 'USD', marketTime: 1700000000 }));
    await waitFor(() => expect(screen.queryByText(/1,200 USD/)).toBeNull());
    expect(screen.getByText(/40 USD/)).toBeInTheDocument();
  });
});
