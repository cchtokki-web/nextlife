import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { EtfHistoricalReturn } from '@/web/features/AssetForm/EtfHistoricalReturn';

afterEach(() => vi.unstubAllGlobals());

describe('ETF 과거 수익률 확인', () => {
  it('실제 관측 기간과 수익률을 보여 주고 사용자가 적용할 때만 입력한다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ prices: [
      { date: '2020-01-01', adjustedClose: 100 }, { date: '2025-01-01', adjustedClose: 200 },
    ] })));
    const onApply = vi.fn();
    render(<EtfHistoricalReturn ticker="VOO" onApply={onApply} />);
    fireEvent.click(screen.getByRole('button', { name: '수정 종가로 과거 수익률 보기' }));
    expect(await screen.findByText(/2020-01-01 ~ 2025-01-01/)).toHaveTextContent('연환산 14.9%');
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '이 값을 연 총수익률에 적용' }));
    expect(onApply).toHaveBeenCalledWith('VOO', 14.9);
  });

  it('기간 중 관측치가 누락되면 그 사실을 알린다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ prices: [
      { date: '2020-01-01', adjustedClose: 100 }, { date: '2021-01-01', adjustedClose: null },
      { date: '2025-01-01', adjustedClose: 200 },
    ] })));
    render(<EtfHistoricalReturn ticker="VOO" onApply={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '수정 종가로 과거 수익률 보기' }));
    expect(await screen.findByText(/수정 종가 1건이 누락/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '이 값을 연 총수익률에 적용' })).toBeEnabled();
  });

  it('1년 미만이면 값을 만들지 않는다', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ prices: [
      { date: '2020-01-01', adjustedClose: 100 }, { date: '2020-02-01', adjustedClose: 120 },
    ] })));
    render(<EtfHistoricalReturn ticker="VOO" onApply={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '수정 종가로 과거 수익률 보기' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('기존 입력값을 유지합니다');
  });

  it('조회 중 종목을 바꾸면 이전 종목의 결과를 표시하지 않는다', async () => {
    let resolveFetch!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise<Response>((resolve) => { resolveFetch = resolve; })));
    const view = render(<EtfHistoricalReturn ticker="VOO" onApply={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '수정 종가로 과거 수익률 보기' }));
    view.rerender(<EtfHistoricalReturn ticker="QQQ" onApply={vi.fn()} />);
    await act(async () => { resolveFetch(Response.json({ prices: [
      { date: '2020-01-01', adjustedClose: 100 }, { date: '2025-01-01', adjustedClose: 200 },
    ] })); });
    expect(screen.queryByText(/2020-01-01 ~ 2025-01-01/)).toBeNull();
    expect(screen.getByRole('button', { name: '수정 종가로 과거 수익률 보기' })).toBeEnabled();
  });
});
