import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { InvestmentBaselinePreview } from '@/web/features/Scenario/InvestmentBaselinePreview';
import { initialParams } from '@/infrastructure/storage/defaultParams';
import { YieldPresetHelper } from '@/web/features/AssetForm/YieldPresetHelper';
import { applyHistoricalEtfReturns } from '@/core/usecases/investmentTracking/applyHistoricalEtfReturns';
import { useState } from 'react';
import type { SimulationParams } from '@/core/entities/types';

const asset = { ...initialParams.assets[0], id: 'a', type: 'etf' as const, ticker: 'VOO', name: 'VOO', quantity: 10, currency: 'USD' as const };
const baseline = { capturedAt: '2026-01-01T00:00:00.000Z', params: { ...initialParams, assets: [asset] } };

afterEach(() => vi.unstubAllGlobals());

describe('기준 수량 시세 참고', () => {
  it('공통 자동 수익률을 선택하면 각 ETF의 자료를 조회해 반영한다', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const start = `${Number(today.slice(0, 4)) - 2}-01-01`;
    const fetchMock = vi.fn().mockImplementation(async () => Response.json({ prices: [
      { date: start, adjustedClose: 100 }, { date: today, adjustedClose: 120 },
    ] }));
    vi.stubGlobal('fetch', fetchMock);
    function Harness() {
      const [current, setCurrent] = useState<SimulationParams>({ ...baseline.params, assets: [asset, { ...asset, id: 'b', ticker: 'QQQ' }] });
      return <><YieldPresetHelper params={current} onChangeParams={setCurrent} />
        <InvestmentBaselinePreview currentParams={current} onApply={(_quotes, returns = []) => {
          setCurrent((previous) => applyHistoricalEtfReturns(previous, returns, today).params);
        }} />
        <output>{current.assets.map((item) => item.totalReturn).join(',')}</output></>;
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '자동 수익률' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getAllByText(/현재 입력과 일치합니다/)).toHaveLength(2));
  });
  it('실패 후 다시 조회하면 최신 시세를 확인하고 자동 반영이 꺼져 있으면 직접 반영을 기다린다', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('일시 오류'))
      .mockResolvedValueOnce(Response.json({ price: 125, currency: 'USD', marketTime: 1700000000 }));
    vi.stubGlobal('fetch', fetchMock);
    const onApply = vi.fn();
    render(<InvestmentBaselinePreview baseline={baseline} currentParams={baseline.params} onApply={onApply} />);
    expect(await screen.findByText(/시세 또는 기준 시각을 확인할 수 없습니다/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '시세·자동 수익률 새로고침' }));
    expect(await screen.findByText(/1,250 USD/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('다시 조회할 때 열린 화면에서 추가한 ETF도 자동 반영한다', async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => Response.json({
      price: url.includes('QQQ') ? 200 : 120, currency: 'USD', marketTime: 1700000000,
    }));
    vi.stubGlobal('fetch', fetchMock);
    const onApply = vi.fn();
    const current = { ...baseline.params, autoUpdateEtfPrices: true };
    const view = render(<InvestmentBaselinePreview currentParams={current} onApply={onApply} />);
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
    const added = { ...asset, id: 'b', ticker: 'QQQ', name: 'QQQ' };
    view.rerender(<InvestmentBaselinePreview currentParams={{ ...current, assets: [asset, added] }} onApply={onApply} />);
    fireEvent.click(screen.getByRole('button', { name: '시세·자동 수익률 새로고침' }));
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(2));
    expect(onApply.mock.calls[1][0]).toEqual(expect.arrayContaining([expect.objectContaining({ assetId: 'b', ticker: 'QQQ', price: 200 })]));
  });

  it('기준이 없는 ETF는 현재 입력 수량이 바뀌면 표시 금액도 갱신한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ price: 120, currency: 'USD', marketTime: 1700000000 })));
    const current = { ...baseline.params, autoUpdateEtfPrices: true };
    const view = render(<InvestmentBaselinePreview currentParams={current} onApply={vi.fn()} />);
    expect(await screen.findByText('1,200 USD')).toBeInTheDocument();
    view.rerender(<InvestmentBaselinePreview currentParams={{ ...current, assets: [{ ...asset, quantity: 12 }] }} onApply={vi.fn()} />);
    expect(screen.getByText('1,440 USD')).toBeInTheDocument();
    expect(screen.getByText(/현재 입력 12주/)).toBeInTheDocument();
  });

  it('다시 조회하면 이전 요청의 늦은 응답을 버린다', async () => {
    let resolveOld!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn().mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce(Response.json({ price: 130, currency: 'USD', marketTime: 1700000000 })));
    render(<InvestmentBaselinePreview baseline={baseline} />);
    fireEvent.click(screen.getByRole('button', { name: '시세·자동 수익률 새로고침' }));
    expect(await screen.findByText(/1,300 USD/)).toBeInTheDocument();
    resolveOld(Response.json({ price: 120, currency: 'USD', marketTime: 1700000000 }));
    await waitFor(() => expect(screen.queryByText(/1,200 USD/)).toBeNull());
  });

  it('다시 조회할 때 선택한 과거 수익률도 재조회한다', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const start = `${Number(today.slice(0, 4)) - 2}-01-01`;
    const fetchMock = vi.fn().mockImplementation(async () => Response.json({ prices: [
      { date: start, adjustedClose: 100 }, { date: today, adjustedClose: 120 },
    ] }));
    vi.stubGlobal('fetch', fetchMock);
    const selected = { ...asset, autoHistoricalReturn: true };
    render(<InvestmentBaselinePreview currentParams={{ ...baseline.params, assets: [selected] }} onApply={vi.fn()} />);
    await screen.findByText(/연환산/);
    fireEvent.click(screen.getByRole('button', { name: '시세·자동 수익률 새로고침' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/연환산/)).toBeInTheDocument();
  });

  it('같은 ETF의 입력 수량 변화만 동일 시세로 비교하며 입력 수정에 따라 갱신한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ price: 120, currency: 'USD', marketTime: 1700000000 })));
    const current = { ...baseline.params, assets: [{ ...asset, quantity: 12 }] };
    const view = render(<InvestmentBaselinePreview baseline={baseline} currentParams={current} />);
    expect(await screen.findByText(/동일 시세 수량 차이 \+240 USD/)).toBeInTheDocument();
    expect(screen.getByText(/수익률 아님/)).toBeInTheDocument();
    view.rerender(<InvestmentBaselinePreview baseline={baseline} currentParams={{ ...current, assets: [{ ...asset, quantity: 8 }] }} />);
    expect(screen.getByText(/동일 시세 수량 차이 -240 USD/)).toBeInTheDocument();
    view.rerender(<InvestmentBaselinePreview baseline={baseline} currentParams={baseline.params} />);
    expect(screen.queryByText(/동일 시세 수량 차이/)).toBeNull();
    view.rerender(<InvestmentBaselinePreview baseline={baseline} currentParams={{ ...current, assets: [{ ...asset, ticker: 'QQQ' }] }} />);
    expect(screen.queryByText(/동일 시세 수량 차이/)).toBeNull();
  });

  it('기준 수량과 현재 시세를 표시하고 조회 요청에 수량을 보내지 않는다', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ price: 120, currency: 'USD', marketTime: 1700000000 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<InvestmentBaselinePreview baseline={baseline} />);
    expect(await screen.findByText(/1,200 USD/)).toBeInTheDocument();
    expect(screen.getByText(/실제 잔고와 다를 수 있습니다/)).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/stock-price?ticker=VOO');
  });

  it('사용자가 누른 경우에만 현재 계획의 같은 종목에 시세를 전달한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ price: 120, currency: 'USD', marketTime: 1700000000 })));
    const onApply = vi.fn();
    render(<InvestmentBaselinePreview baseline={baseline} currentParams={baseline.params} onApply={onApply} />);
    const button = await screen.findByRole('button', { name: '시세 1개 반영' });
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

  it('시세와 과거 수익률 자동 반영을 같은 시나리오 변경으로 함께 전달한다', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const start = `${Number(today.slice(0, 4)) - 2}-01-01`;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => url.startsWith('/api/stock-history')
      ? Response.json({ prices: [{ date: start, adjustedClose: 100 }, { date: today, adjustedClose: 120 }] })
      : Response.json({ price: 120, currency: 'USD', marketTime: 1700000000 })));
    const onApply = vi.fn();
    const selected = { ...asset, autoHistoricalReturn: true };
    const current = { ...baseline.params, assets: [selected], autoUpdateEtfPrices: true };
    render(<InvestmentBaselinePreview currentParams={current} onApply={onApply} />);
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
    expect(onApply.mock.calls[0][0]).toEqual([expect.objectContaining({ assetId: 'a', price: 120 })]);
    expect(onApply.mock.calls[0][1]).toEqual([expect.objectContaining({ assetId: 'a', ticker: 'VOO', endDate: today, missingPoints: 0 })]);
  });

  it('자동 수익률만 켜도 누락된 자료를 기존 값에 반영하지 않는다', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const start = `${Number(today.slice(0, 4)) - 2}-01-01`;
    const middle = `${Number(today.slice(0, 4)) - 1}-01-01`;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ prices: [
      { date: start, adjustedClose: 100 }, { date: middle, adjustedClose: null }, { date: today, adjustedClose: 120 },
    ] })));
    const onApply = vi.fn();
    const selected = { ...asset, autoHistoricalReturn: true };
    render(<InvestmentBaselinePreview currentParams={{ ...baseline.params, assets: [selected] }} onApply={onApply} />);
    expect(await screen.findByText(/누락 1건/)).toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('과거 수익률 조회 중 직접 수정한 값은 늦은 응답으로 덮지 않는다', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const start = `${Number(today.slice(0, 4)) - 2}-01-01`;
    let resolveHistory!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise<Response>((resolve) => { resolveHistory = resolve; })));
    const onApply = vi.fn();
    const selected = { ...asset, autoHistoricalReturn: true };
    const current = { ...baseline.params, assets: [selected] };
    const view = render(<InvestmentBaselinePreview currentParams={current} onApply={onApply} />);
    view.rerender(<InvestmentBaselinePreview currentParams={{ ...current, assets: [{ ...selected, totalReturn: 20 }] }} onApply={onApply} />);
    resolveHistory(Response.json({ prices: [{ date: start, adjustedClose: 100 }, { date: today, adjustedClose: 120 }] }));
    expect(await screen.findByText(/연환산/)).toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
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
    expect(screen.getByText(/현재 입력 10주 · 시세 200 USD/)).toBeInTheDocument();
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
