import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { YieldPresetHelper } from '@/web/features/AssetForm/YieldPresetHelper';
import { SimulationParams } from '@/core/entities/types';

function params(over: Partial<SimulationParams> = {}): SimulationParams {
  return {
    userProfile: { currentAge: 50, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3_000_000 },
    assets: [{
      id: 'a', type: 'etf', ticker: 'X', name: 'X', quantity: 1, averagePrice: 100_000_000,
      totalReturn: 9.5, dividendYield: 0.4, monthlyContribution: 0,
      reinvestDividend: true, currency: 'KRW', assetMarket: 'US_ETF',
    }],
    privatePensions: [{
      id: 'p', type: 'irp', investmentType: 'etf', name: 'IRP', balance: 10_000_000,
      monthlyContribution: 0, totalReturn: 6.4, dividendYield: 0, currency: 'KRW',
    }],
    isaAccounts: [], otherIncomes: [],
    nationalPension: { expectedMonthlyAmount: 0 },
    inflationRate: 2.5, inflationMode: 'real', baseExchangeRate: 1400,
    exchangeScenario: 'base', displayCurrency: 'KRW',
    ...over,
  } as unknown as SimulationParams;
}

describe('YieldPresetHelper', () => {
  test('안정형을 누르면 저장값이 5%/3%로 채워진다', async () => {
    const onChange = vi.fn();
    render(<YieldPresetHelper params={params()} onChangeParams={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: /보수적 5%/ }));

    const next = onChange.mock.calls[0][0] as SimulationParams;
    expect(next.assets[0].totalReturn).toBe(5);
    expect(next.privatePensions[0].totalReturn).toBe(3);
  });

  test('되돌리기 버튼은 스냅샷이 있을 때만 보인다', () => {
    const { rerender } = render(<YieldPresetHelper params={params()} onChangeParams={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /되돌리기/ })).toBeNull();

    rerender(
      <YieldPresetHelper
        params={params({
          yieldPreset: 'conservative',
          customYieldSnapshot: { assets: { a: 9.5 }, privatePensions: { p: 6.4 }, isaAccounts: {} },
        } as Partial<SimulationParams>)}
        onChangeParams={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /되돌리기/ })).toBeTruthy();
  });

  test('되돌리기는 직전 입력값을 복원한다', async () => {
    const onChange = vi.fn();
    render(
      <YieldPresetHelper
        params={params({
          assets: [{ ...params().assets[0], totalReturn: 5 }],
          privatePensions: [{ ...params().privatePensions[0], totalReturn: 3 }],
          yieldPreset: 'conservative',
          customYieldSnapshot: { assets: { a: 9.5 }, privatePensions: { p: 6.4 }, isaAccounts: {} },
        } as Partial<SimulationParams>)}
        onChangeParams={onChange}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /되돌리기/ }));

    const next = onChange.mock.calls[0][0] as SimulationParams;
    expect(next.assets[0].totalReturn).toBe(9.5);
    expect(next.privatePensions[0].totalReturn).toBe(6.4);
  });
});
