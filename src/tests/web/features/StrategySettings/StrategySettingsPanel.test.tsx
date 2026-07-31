import { describe, test, expect, vi } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { StrategySettingsPanel } from '@/web/features/StrategySettings/StrategySettingsPanel';
import { initialParams } from '@/infrastructure/storage/localStore';
import { DEFAULT_RETIREMENT_STRATEGY } from '@/core/usecases/strategy/compileStrategy';

describe('StrategySettingsPanel', () => {
  test('전략 모드 3개와 6개 섹션 제목을 렌더링한다', () => {
    render(<StrategySettingsPanel params={initialParams} onChangeParams={vi.fn()} />);

    expect(screen.getByRole('radio', { name: /간편/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /표준/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /전문가/ })).toBeInTheDocument();

    for (const title of ['기본 정보', '은퇴 목표', '연금 전략', '투자 전략', '경제 가정', '고급 설정']) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
  });

  test('strategy가 없으면 간편 모드가 선택된다', () => {
    render(<StrategySettingsPanel params={initialParams} onChangeParams={vi.fn()} />);

    expect(screen.getByRole('radio', { name: /간편/ })).toBeChecked();
  });

  test('모드를 바꾸면 strategy.mode가 반영된 params로 onChangeParams가 호출된다', () => {
    const onChangeParams = vi.fn();
    render(<StrategySettingsPanel params={initialParams} onChangeParams={onChangeParams} />);

    fireEvent.click(screen.getByRole('radio', { name: /전문가/ }));

    expect(onChangeParams).toHaveBeenCalledWith({
      ...initialParams,
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, mode: 'expert' },
    });
  });

  test('기본값과 다른 값이 있으면 해당 섹션에 변경 개수 배지가 표시된다', () => {
    const params = {
      ...initialParams,
      userProfile: { ...initialParams.userProfile, currentAge: 42 },
    };

    render(<StrategySettingsPanel params={params} onChangeParams={vi.fn()} />);

    expect(screen.getByText('1개 변경')).toBeInTheDocument();
  });

  test('간편 모드에서 고급 설정 변경이 있으면 숨겨진 설정 개수를 알린다', () => {
    const params = {
      ...initialParams,
      taxSettings: { ...initialParams.taxSettings, usDividendTaxRate: 20 } as never,
    };

    render(<StrategySettingsPanel params={params} onChangeParams={vi.fn()} />);

    expect(screen.getByText('숨겨진 사용자 설정 1개')).toBeInTheDocument();
  });

  test('섹션에서 값을 바꾸면 그 섹션이 잠깐 강조되고 시간이 지나면 해제된다', () => {
    vi.useFakeTimers();
    try {
      const { container } = render(
        <StrategySettingsPanel params={initialParams} onChangeParams={vi.fn()} />
      );

      fireEvent.click(screen.getByRole('button', { name: /기본 정보/ }));
      fireEvent.change(screen.getByLabelText('현재 나이'), { target: { value: '48' } });

      expect(container.querySelectorAll('[data-highlighted]')).toHaveLength(1);

      act(() => { vi.advanceTimersByTime(2000); });

      expect(container.querySelectorAll('[data-highlighted]')).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
