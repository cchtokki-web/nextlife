import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { InvestmentBaselinePreview } from '@/web/features/Scenario/InvestmentBaselinePreview';
import { YieldPresetHelper } from '@/web/features/AssetForm/YieldPresetHelper';
import { applyCurrentQuotes } from '@/core/usecases/investmentTracking/applyCurrentQuotes';
import { applyHistoricalEtfReturns } from '@/core/usecases/investmentTracking/applyHistoricalEtfReturns';
import { applyObservedEtfDividends } from '@/core/usecases/investmentTracking/applyObservedEtfDividends';
import { initialParams } from '@/infrastructure/storage/defaultParams';
import type { SimulationParams } from '@/core/entities/types';

const asset = { ...initialParams.assets[0], id: 'a', type: 'etf' as const, ticker: 'VOO', name: 'VOO', quantity: 10, averagePrice: 100, totalReturn: 7, dividendYield: 2, currency: 'USD' as const };
const baseline = { capturedAt: '2026-01-01T00:00:00.000Z', params: { ...initialParams, assets: [asset] } };
const today = () => new Date().toISOString().slice(0, 10);
const start = () => `${Number(today().slice(0, 4)) - 2}-01-01`;
const priceResponse = () => Response.json({ price: 120, currency: 'USD', marketTime: 1700000000 });
const historyResponse = () => Response.json({ prices: [{ date: start(), adjustedClose: 100 }, { date: today(), adjustedClose: 120 }] });
const dividendResponse = () => Response.json({ observedDividendYield: 3 });

function setMarketFetch() {
  const mock = vi.fn().mockImplementation(async (url: string) => url.startsWith('/api/stock-price') ? priceResponse()
    : url.startsWith('/api/stock-info') ? dividendResponse() : historyResponse());
  vi.stubGlobal('fetch', mock);
  return mock;
}

afterEach(() => vi.unstubAllGlobals());

describe('ETF 시세와 수익률 갱신', () => {
  it('자동 수익률 모드에서는 단가·총수익률·배당률을 함께 반영한다', async () => {
    const fetchMock = setMarketFetch();
    function Harness() {
      const [current, setCurrent] = useState<SimulationParams>({ ...baseline.params, assets: [asset] });
      return <><YieldPresetHelper params={current} onChangeParams={setCurrent} />
        <InvestmentBaselinePreview currentParams={current} onApply={(quotes, returns = [], dividends = []) => {
          setCurrent((previous) => applyObservedEtfDividends(applyHistoricalEtfReturns(applyCurrentQuotes(previous, quotes).params, returns, today()).params, dividends).params);
        }} />
        <output data-testid="applied">{current.assets[0].averagePrice}:{current.assets[0].totalReturn}:{current.assets[0].dividendYield}</output></>;
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '자동 수익률' }));
    await waitFor(() => expect(screen.getByTestId('applied').textContent).toMatch(/^120:(?!7:)[\d.]+:3$/));
    expect(fetchMock.mock.calls.some(([url]) => url.startsWith('/api/stock-history'))).toBe(true);
  });

  it('공통 프리셋 모드에서는 총수익률을 보존하고 시세와 배당률만 전달한다', async () => {
    const fetchMock = setMarketFetch();
    const onApply = vi.fn();
    const current = { ...baseline.params, yieldPreset: 'base' as const, autoUpdateEtfReturns: false };
    render(<InvestmentBaselinePreview currentParams={current} onApply={onApply} />);
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
    expect(onApply.mock.calls[0][0]).toEqual([expect.objectContaining({ assetId: 'a', price: 120 })]);
    expect(onApply.mock.calls[0][1]).toEqual([]);
    expect(onApply.mock.calls[0][2]).toEqual([expect.objectContaining({ assetId: 'a', dividendYield: 3 })]);
    expect(fetchMock.mock.calls.some(([url]) => url.startsWith('/api/stock-history'))).toBe(false);
  });

  it('배당 자료가 없으면 기존 배당률을 유지하고 알려준다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => url.startsWith('/api/stock-price') ? priceResponse()
      : Response.json({ observedDividendYield: null })));
    const onApply = vi.fn();
    render(<InvestmentBaselinePreview currentParams={baseline.params} onApply={onApply} />);
    expect(await screen.findByText(/배당률을 조회하지 못해 기존 값을 유지/)).toBeInTheDocument();
    expect(onApply).toHaveBeenCalledWith([expect.objectContaining({ price: 120 })]);
  });

  it('조회 도중 단가를 변경하면 늦은 시세로 덮어쓰지 않는다', async () => {
    let resolvePrice!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => url.startsWith('/api/stock-price')
      ? new Promise<Response>((resolve) => { resolvePrice = resolve; }) : Promise.resolve(Response.json({ observedDividendYield: 2 }))));
    const onApply = vi.fn();
    const view = render(<InvestmentBaselinePreview currentParams={baseline.params} onApply={onApply} />);
    view.rerender(<InvestmentBaselinePreview currentParams={{ ...baseline.params, assets: [{ ...asset, averagePrice: 777 }] }} onApply={onApply} />);
    await act(async () => { resolvePrice(priceResponse()); });
    expect(onApply).not.toHaveBeenCalled();
  });

  it('조회 도중 배당률을 변경하면 기존 입력을 덮어쓰지 않는다', async () => {
    let resolveDividend!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => url.startsWith('/api/stock-price')
      ? Promise.resolve(priceResponse()) : new Promise<Response>((resolve) => { resolveDividend = resolve; })));
    const onApply = vi.fn();
    const current = { ...baseline.params, assets: [{ ...asset, averagePrice: 120 }] };
    const view = render(<InvestmentBaselinePreview currentParams={current} onApply={onApply} />);
    view.rerender(<InvestmentBaselinePreview currentParams={{ ...current, assets: [{ ...current.assets[0], dividendYield: 4 }] }} onApply={onApply} />);
    await act(async () => { resolveDividend(dividendResponse()); });
    expect(onApply).not.toHaveBeenCalled();
  });

  it('자료가 누락된 과거 수익률은 자동 반영하지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => url.startsWith('/api/stock-price') ? priceResponse()
      : url.startsWith('/api/stock-info') ? Response.json({ observedDividendYield: 2 })
        : Response.json({ prices: [{ date: start(), adjustedClose: 100 }, { date: `${Number(today().slice(0, 4)) - 1}-01-01`, adjustedClose: null }, { date: today(), adjustedClose: 120 }] })));
    const onApply = vi.fn();
    const current = { ...baseline.params, assets: [{ ...asset, averagePrice: 120, autoHistoricalReturn: true }] };
    render(<InvestmentBaselinePreview currentParams={current} onApply={onApply} />);
    expect(await screen.findByText(/수익률을 갱신하지 못해 기존 값을 유지/)).toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('과거 수익률 조회 중 공통 프리셋을 선택하면 이전 응답을 적용하지 않는다', async () => {
    let resolveHistory!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => url.startsWith('/api/stock-price') ? Promise.resolve(priceResponse())
      : url.startsWith('/api/stock-info') ? Promise.resolve(Response.json({ observedDividendYield: 2 }))
        : new Promise<Response>((resolve) => { resolveHistory = resolve; })));
    const onApply = vi.fn();
    const automatic = { ...baseline.params, assets: [{ ...asset, averagePrice: 120, autoHistoricalReturn: true }], yieldPreset: 'custom' as const };
    const view = render(<InvestmentBaselinePreview currentParams={automatic} onApply={onApply} />);
    view.rerender(<InvestmentBaselinePreview currentParams={{ ...automatic, yieldPreset: 'base', assets: [{ ...automatic.assets[0], autoHistoricalReturn: false }] }} onApply={onApply} />);
    await act(async () => { resolveHistory(historyResponse()); });
    expect(onApply).not.toHaveBeenCalled();
  });

  it('시세 목록을 표시하지 않고 현재 계획의 시세를 자동 반영한다', async () => {
    setMarketFetch();
    const onApply = vi.fn();
    render(<InvestmentBaselinePreview baseline={baseline} currentParams={baseline.params} onApply={onApply} />);
    await waitFor(() => expect(onApply).toHaveBeenCalled());
    expect(onApply.mock.calls[0][0]).toEqual([expect.objectContaining({ assetId: 'a', price: 120 })]);
    expect(screen.queryByRole('region', { name: 'ETF 시세 참고' })).toBeNull();
    expect(screen.queryByText('ETF 시세')).toBeNull();
    expect(screen.queryByText(/1,200 USD/)).toBeNull();
  });

  it('통화가 다른 시세는 반영하지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => url.startsWith('/api/stock-price')
      ? Response.json({ price: 120, currency: 'KRW', marketTime: 1700000000 }) : Response.json({ observedDividendYield: 2 })));
    const onApply = vi.fn();
    render(<InvestmentBaselinePreview currentParams={baseline.params} onApply={onApply} />);
    expect(await screen.findByText(/시세를 조회하지 못해 기존 값을 유지/)).toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  });
});
