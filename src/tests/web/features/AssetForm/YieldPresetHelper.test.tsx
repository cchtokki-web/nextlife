import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { YieldPresetHelper } from '@/web/features/AssetForm/YieldPresetHelper';
import { SimulationParams } from '@/core/entities/types';
import { normalizeSimulationParams } from '@/infrastructure/storage/normalizeSimulationParams';

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

  test('실제 왕복: base 프리셋 상태에서 시작해도 프리셋을 누르면 스냅샷이 잡히고 되돌리기가 원래 직접입력값을 복원한다', async () => {
    // 스토리지 기본값(defaultParams.ts)과 랜딩 흐름이 실제로 넘기는 형태를 재현한다 —
    // yieldPreset: 'base'로 시작하지만 자산별 수익률은 사용자가 이미 손으로 채워 넣은
    // 서로 다른 값이다(자산 두 개 9.5%/7%, 연금 6.4%). customYieldSnapshot은 아직 없다.
    const initialParams = params({
      yieldPreset: 'base',
      assets: [
        { ...params().assets[0], id: 'a1', totalReturn: 9.5 },
        { ...params().assets[0], id: 'a2', totalReturn: 7 },
      ],
      privatePensions: [{ ...params().privatePensions[0], id: 'p1', totalReturn: 6.4 }],
    } as Partial<SimulationParams>);

    const onChangeStep1 = vi.fn();
    const { rerender } = render(<YieldPresetHelper params={initialParams} onChangeParams={onChangeStep1} />);

    // 1단계: 실제 컴포넌트를 통해 프리셋을 적용한다(직접 손으로 스냅샷을 구성하지 않는다).
    await userEvent.click(screen.getByRole('button', { name: /보수적 5%/ }));
    const afterPreset = onChangeStep1.mock.calls[0][0] as SimulationParams;

    // 프리셋이 적용됐으니 값은 5%로 채워지고, 되돌릴 스냅샷은 원래 입력값을 담고 있어야 한다.
    expect(afterPreset.assets[0].totalReturn).toBe(5);
    expect(afterPreset.assets[1].totalReturn).toBe(5);
    expect(afterPreset.privatePensions[0].totalReturn).toBe(3);
    expect(afterPreset.customYieldSnapshot).toEqual({
      assets: { a1: 9.5, a2: 7 },
      privatePensions: { p1: 6.4 },
      isaAccounts: {},
    });

    // 2단계: 프리셋 적용 결과를 그대로 다시 컴포넌트에 먹인다(진짜 왕복).
    const onChangeStep2 = vi.fn();
    rerender(<YieldPresetHelper params={afterPreset} onChangeParams={onChangeStep2} />);

    expect(screen.getByRole('button', { name: /되돌리기/ })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /되돌리기/ }));

    const restored = onChangeStep2.mock.calls[0][0] as SimulationParams;
    // 원래 손으로 입력했던 9.5 / 7 / 6.4가 그대로 돌아와야 한다.
    expect(restored.assets[0].totalReturn).toBe(9.5);
    expect(restored.assets[1].totalReturn).toBe(7);
    expect(restored.privatePensions[0].totalReturn).toBe(6.4);
  });

  test('현재 값의 출처가 어느 버튼인지 aria-pressed로 드러난다', () => {
    // 표시는 «저장된 값»에서 유도한다(matchedYieldPreset). 자산·ISA의 totalReturn이
    // stockGrowth와, 사적연금의 totalReturn이 pensionReturn과 같을 때만 켜진다.
    const { rerender } = render(
      <YieldPresetHelper
        params={params({
          assets: [{ ...params().assets[0], totalReturn: 5 }],
          privatePensions: [{ ...params().privatePensions[0], totalReturn: 3 }],
        } as Partial<SimulationParams>)}
        onChangeParams={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /보수적 5%/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: /중립 7%/ }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: /공격 9%/ }).getAttribute('aria-pressed')).toBe('false');

    // 사용자가 자산 하나의 수익률을 직접 고치면 그 순간 꺼진다 — 입력칸의 값이 더 이상
    // 그 프리셋의 값이 아니기 때문이다. yieldPreset 필드를 거치지 않는다.
    rerender(
      <YieldPresetHelper
        params={params({
          assets: [{ ...params().assets[0], totalReturn: 6 }],
          privatePensions: [{ ...params().privatePensions[0], totalReturn: 3 }],
        } as Partial<SimulationParams>)}
        onChangeParams={vi.fn()}
      />
    );

    for (const label of [/보수적 5%/, /중립 7%/, /공격 9%/]) {
      expect(screen.getByRole('button', { name: label }).getAttribute('aria-pressed')).toBe('false');
    }
  });

  test('저장 계층을 통과한 옛 시나리오에서도 누른 적 없는 프리셋이 켜지지 않는다', () => {
    // **회귀 방지.** normalizeSimulationParams가 키 없는 시나리오에 yieldPreset: 'base'를
    // 채워 넣는다(optionalOneOf → initialParams.yieldPreset). 그 필드를 그대로 믿던 시절에는
    // 저장을 거친 «모든» 시나리오에서 「중립 7%」가 aria-pressed='true'로 켜졌다 — 자산
    // 수익률이 9.5%인데도. 손으로 만든 params가 아니라 저장 계층의 실제 출력으로 확인한다.
    const raw = JSON.parse(JSON.stringify(params())) as Record<string, unknown>;
    delete raw.yieldPreset;
    const stored = normalizeSimulationParams(raw);
    expect(stored.yieldPreset).toBe('base');

    render(<YieldPresetHelper params={stored} onChangeParams={vi.fn()} />);

    for (const label of [/보수적 5%/, /중립 7%/, /공격 9%/]) {
      expect(screen.getByRole('button', { name: label }).getAttribute('aria-pressed')).toBe('false');
    }
  });

  test('수익률을 고친 적 없는 경로가 yieldPreset을 custom으로 떨어뜨려도 표시는 남는다', () => {
    // 자산 삭제·티커 자동조회는 남은 계좌의 수익률을 «건드리지 않고» yieldPreset만
    // 'custom'으로 돌린다(AssetFormSection). 값이 여전히 프리셋의 값이므로 표시도 남아야 한다.
    render(
      <YieldPresetHelper
        params={params({
          yieldPreset: 'custom',
          assets: [{ ...params().assets[0], totalReturn: 5 }],
          privatePensions: [{ ...params().privatePensions[0], totalReturn: 3 }],
        } as Partial<SimulationParams>)}
        onChangeParams={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /보수적 5%/ }).getAttribute('aria-pressed')).toBe('true');
  });

  test('되돌리기 버튼은 토글이 아니므로 aria-pressed를 갖지 않는다', () => {
    render(
      <YieldPresetHelper
        params={params({
          customYieldSnapshot: { assets: { a: 9.5 }, privatePensions: { p: 6.4 }, isaAccounts: {} },
        } as Partial<SimulationParams>)}
        onChangeParams={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /되돌리기/ }).hasAttribute('aria-pressed')).toBe(false);
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
