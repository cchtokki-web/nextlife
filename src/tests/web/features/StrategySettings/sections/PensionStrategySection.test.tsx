import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { PensionStrategySection } from '@/web/features/StrategySettings/sections/PensionStrategySection';
import { DEFAULT_RETIREMENT_STRATEGY } from '@/core/usecases/strategy/compileStrategy';
import { initialParams } from '@/infrastructure/storage/localStore';

const noAi = { recommendation: null, error: null, improved: false };

describe('PensionStrategySection', () => {
  test('국민연금 전략 5개와 사적연금 전략 5개를 렌더링한다', () => {
    render(
      <PensionStrategySection
        params={initialParams} onChangeParams={vi.fn()}
        mode="standard" changed={new Set()} ai={noAi}
      />
    );

    // 두 그룹 모두 'AI 최적화' 옵션을 가지므로 그룹으로 좁혀 찾는다.
    const national = within(screen.getByRole('radiogroup', { name: '국민연금 수령 시작' }));
    for (const label of [/예상 수령/, /1년 연기/, /2년 연기/, /최대 연기/, /AI 최적화/]) {
      expect(national.getByRole('radio', { name: label })).toBeInTheDocument();
    }

    const priv = within(screen.getByRole('radiogroup', { name: '사적연금 인출 전략' }));
    for (const label of [/절세 우선/, /생활비 우선/, /자산 성장 우선/, /최소 인출/, /AI 최적화/]) {
      expect(priv.getByRole('radio', { name: label })).toBeInTheDocument();
    }
  });

  test('국민연금 전략을 고르면 strategy에 반영된다', () => {
    const onChangeParams = vi.fn();
    render(
      <PensionStrategySection
        params={initialParams} onChangeParams={onChangeParams}
        mode="standard" changed={new Set()} ai={noAi}
      />
    );

    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: '국민연금 수령 시작' }))
        .getByRole('radio', { name: /최대 연기/ })
    );

    expect(onChangeParams).toHaveBeenCalledWith({
      ...initialParams,
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, nationalPensionStrategy: 'defer_max' },
    });
  });

  test('ISA 우선 사용과 배당 재투자 스위치를 렌더링한다', () => {
    render(
      <PensionStrategySection
        params={initialParams} onChangeParams={vi.fn()}
        mode="standard" changed={new Set()} ai={noAi}
      />
    );

    expect(screen.getByRole('switch', { name: /ISA 먼저 사용/ })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /배당금 재투자/ })).toBeInTheDocument();
  });

  test('AI가 연기 수령을 추천하면 힌트를 표시한다', () => {
    const ai = {
      recommendation: { improved: true, recommendedPlan: { nationalPensionStartAge: 70 } } as never,
      error: null, improved: true,
    };

    render(
      <PensionStrategySection
        params={initialParams} onChangeParams={vi.fn()}
        mode="standard" changed={new Set()} ai={ai}
      />
    );

    expect(screen.getByText('AI 추천: 70세부터 수령')).toBeInTheDocument();
  });

  test('간편 모드에서도 국민연금/사적연금 전략은 보인다', () => {
    render(
      <PensionStrategySection
        params={initialParams} onChangeParams={vi.fn()}
        mode="simple" changed={new Set()} ai={noAi}
      />
    );

    expect(screen.getByRole('radio', { name: /최대 연기/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /절세 우선/ })).toBeInTheDocument();
  });

  test('간편 모드에서는 ISA/배당 재투자 스위치가 숨겨진다', () => {
    render(
      <PensionStrategySection
        params={initialParams} onChangeParams={vi.fn()}
        mode="simple" changed={new Set()} ai={noAi}
      />
    );

    expect(screen.queryByRole('switch', { name: /ISA 먼저 사용/ })).not.toBeInTheDocument();
  });
});
