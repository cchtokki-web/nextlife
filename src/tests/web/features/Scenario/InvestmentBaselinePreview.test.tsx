import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  it('사용자가 누른 경우에만 현재 계획의 같은 종목에 시세를 전달한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ price: 120, currency: 'USD', marketTime: 1700000000 })));
    const onApply = vi.fn();
    render(<InvestmentBaselinePreview baseline={baseline} currentParams={baseline.params} onApply={onApply} />);
    const button = await screen.findByRole('button', { name: '조회 시세 1개를 현재 계획에 반영' });
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(onApply).toHaveBeenCalledWith([{ assetId: 'a', ticker: 'VOO', currency: 'USD', price: 120, marketTime: 1700000000 }]);
  });

  it('자동 반영을 켠 경우 새로 조회한 시세를 한 번 반영한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ price: 120, currency: 'USD', marketTime: 1700000000 })));
    const onApply = vi.fn();
    const current = { ...baseline.params, autoUpdateEtfPrices: true };
    const view = render(<InvestmentBaselinePreview baseline={baseline} currentParams={current} onApply={onApply} />);
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
    expect(onApply).toHaveBeenCalledWith([{ assetId: 'a', ticker: 'VOO', currency: 'USD', price: 120, marketTime: 1700000000 }]);
    view.rerender(<InvestmentBaselinePreview baseline={baseline} currentParams={current} onApply={onApply} />);
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('자동 조회 중 단가를 직접 변경하면 늦은 응답으로 덮지 않는다', async () => {
    let resolveQuote!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise<Response>((resolve) => { resolveQuote = resolve; })));
    const onApply = vi.fn();
    const current = { ...baseline.params, autoUpdateEtfPrices: true };
    const view = render(<InvestmentBaselinePreview baseline={baseline} currentParams={current} onApply={onApply} />);
    const edited = { ...current, assets: [{ ...asset, averagePrice: 777 }] };
    view.rerender(<InvestmentBaselinePreview baseline={baseline} currentParams={edited} onApply={onApply} />);
    resolveQuote(Response.json({ price: 120, currency: 'USD', marketTime: 1700000000 }));
    expect(await screen.findByText(/1,200 USD/)).toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('조회 중 자동 반영을 끄면 취소된 응답을 적용하지 않는다', async () => {
    let resolveAutomatic!: (response: Response) => void;
    const fetchMock = vi.fn().mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveAutomatic = resolve; }))
      .mockResolvedValueOnce(Response.json({ price: 110, currency: 'USD', marketTime: 1700000000 }));
    vi.stubGlobal('fetch', fetchMock);
    const onApply = vi.fn();
    const active = { ...baseline.params, autoUpdateEtfPrices: true };
    const view = render(<InvestmentBaselinePreview baseline={baseline} currentParams={active} onApply={onApply} />);
    view.rerender(<InvestmentBaselinePreview baseline={baseline} currentParams={{ ...active, autoUpdateEtfPrices: false }} onApply={onApply} />);
    resolveAutomatic(Response.json({ price: 120, currency: 'USD', marketTime: 1700000000 }));
    await screen.findByText(/1,100 USD/);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('자동 반영을 켜면 기존 조회값 대신 새 시세를 요청한다', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ price: 120, currency: 'USD', marketTime: 1700000000 }))
      .mockResolvedValueOnce(Response.json({ price: 130, currency: 'USD', marketTime: 1700000100 }));
    vi.stubGlobal('fetch', fetchMock);
    const onApply = vi.fn();
    const view = render(<InvestmentBaselinePreview baseline={baseline} currentParams={baseline.params} onApply={onApply} />);
    await screen.findByText(/1,200 USD/);
    expect(onApply).not.toHaveBeenCalled();
    view.rerender(<InvestmentBaselinePreview baseline={baseline} currentParams={{ ...baseline.params, autoUpdateEtfPrices: true }} onApply={onApply} />);
    await waitFor(() => expect(onApply).toHaveBeenCalledWith([{ assetId: 'a', ticker: 'VOO', currency: 'USD', price: 130, marketTime: 1700000100 }]));
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
    await waitFor(() => expect(screen.getByText('조회할 ETF가 없습니다.')).toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('자동 반영은 기준 저장 후 새로 추가한 ETF도 조회한다', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => Response.json({
      price: url.includes('QQQ') ? 200 : 120, currency: 'USD', marketTime: 1700000000,
    }));
    vi.stubGlobal('fetch', fetchMock);
    const onApply = vi.fn();
    const added = { ...asset, id: 'b', ticker: 'QQQ', name: 'QQQ', averagePrice: 100 };
    const current = { ...baseline.params, assets: [asset, added], autoUpdateEtfPrices: true };
    render(<InvestmentBaselinePreview baseline={baseline} currentParams={current} onApply={onApply} />);
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls.map((call) => call[0])).toContain('/api/stock-price?ticker=QQQ');
    expect(onApply.mock.calls[0][0]).toEqual(expect.arrayContaining([
      expect.objectContaining({ assetId: 'b', ticker: 'QQQ', price: 200 }),
    ]));
    expect(screen.getByText(/현재 입력 10주/)).toBeInTheDocument();
  });

  it('기준 계획이 없어도 자동 반영을 켠 현재 ETF를 조회한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ price: 120, currency: 'USD', marketTime: 1700000000 })));
    const onApply = vi.fn();
    render(<InvestmentBaselinePreview currentParams={{ ...baseline.params, autoUpdateEtfPrices: true }} onApply={onApply} />);
    await waitFor(() => expect(onApply).toHaveBeenCalledWith([
      { assetId: 'a', ticker: 'VOO', currency: 'USD', price: 120, marketTime: 1700000000 },
    ]));
  });

  it('기준 계획을 저장한 뒤 같은 자산의 종목이 변경되면 현재 종목만 반영한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => Response.json({
      price: url.includes('QQQ') ? 200 : 120, currency: 'USD', marketTime: 1700000000,
    })));
    const onApply = vi.fn();
    const current = { ...baseline.params, assets: [{ ...asset, ticker: 'QQQ', name: 'QQQ' }], autoUpdateEtfPrices: true };
    render(<InvestmentBaselinePreview baseline={baseline} currentParams={current} onApply={onApply} />);
    await waitFor(() => expect(onApply).toHaveBeenCalledWith([
      { assetId: 'a', ticker: 'QQQ', currency: 'USD', price: 200, marketTime: 1700000000 },
    ]));
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
