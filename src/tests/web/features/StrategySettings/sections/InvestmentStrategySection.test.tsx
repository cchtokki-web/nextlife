import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { InvestmentStrategySection } from '@/web/features/StrategySettings/sections/InvestmentStrategySection';
import { DEFAULT_RETIREMENT_STRATEGY } from '@/core/usecases/strategy/compileStrategy';
import { initialParams } from '@/infrastructure/storage/localStore';

const noAi = { recommendation: null, error: null, improved: false };

describe('InvestmentStrategySection', () => {
  test('리스크 성향과 경제 시나리오 선택지를 렌더링한다', () => {
    render(
      <InvestmentStrategySection
        params={initialParams} onChangeParams={vi.fn()}
        mode="standard" changed={new Set()} ai={noAi}
      />
    );

    // 두 그룹 모두 'AI 추천' 옵션을 가지므로 그룹으로 좁혀 찾는다.
    const risk = within(screen.getByRole('radiogroup', { name: '리스크 성향' }));
    for (const label of [/안정형/, /중립형/, /공격형/, /사용자 직접입력/, /입력 수익률 유지/]) {
      expect(risk.getByRole('radio', { name: label })).toBeInTheDocument();
    }

    const scenario = within(screen.getByRole('radiogroup', { name: '경제 시나리오' }));
    for (const label of [/장기 평균/, /장기 침체/, /고물가/, /저성장/, /직접 입력값 유지/]) {
      expect(scenario.getByRole('radio', { name: label })).toBeInTheDocument();
    }
  });

  test('리스크 성향을 고르면 strategy.riskProfile이 반영된다', () => {
    const onChangeParams = vi.fn();
    render(
      <InvestmentStrategySection
        params={initialParams} onChangeParams={onChangeParams}
        mode="standard" changed={new Set()} ai={noAi}
      />
    );

    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: '리스크 성향' }))
        .getByRole('radio', { name: /공격형/ })
    );

    expect(onChangeParams).toHaveBeenCalledWith({
      ...initialParams,
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, riskProfile: 'aggressive' },
    });
  });

  test('사용자 직접입력을 고르면 strategy.riskProfile이 custom이 된다', () => {
    const onChangeParams = vi.fn();
    render(
      <InvestmentStrategySection
        params={initialParams} onChangeParams={onChangeParams}
        mode="standard" changed={new Set()} ai={noAi}
      />
    );

    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: '리스크 성향' }))
        .getByRole('radio', { name: /사용자 직접입력/ })
    );

    expect(onChangeParams).toHaveBeenCalledWith({
      ...initialParams,
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, riskProfile: 'custom' },
    });
  });

  // 경제 시나리오는 물가·환율만 정하고, 자산·사적연금의 수익률은 리스크 성향(governing한
  // 값을 고른 경우)만 정한다. 설명문이 그 역할 구분을 정확히 말해야 한다.
  test('시나리오와 리스크 성향의 역할 구분을 설명문으로 알린다', () => {
    render(
      <InvestmentStrategySection
        params={initialParams} onChangeParams={vi.fn()}
        mode="standard" changed={new Set()} ai={noAi}
      />
    );

    expect(screen.getByText(/경제 시나리오는 물가·환율만 바꿉니다/))
      .toBeInTheDocument();
    expect(screen.getByText(/입력 수익률 유지.*가 아닌 값으로 고른 경우에만/)).toBeInTheDocument();
  });

  test('간편 모드에서는 두 필드가 모두 숨겨지므로 역할 구분 설명문도 렌더되지 않는다', () => {
    // 리스크 성향/경제 시나리오는 SIMPLE_FIELDS에 없다. 필드가 하나도 안 보이는데
    // "두 설정이 겹칠 때는..." 설명문만 남으면 무엇에 대한 설명인지 알 수 없다.
    render(
      <InvestmentStrategySection
        params={initialParams} onChangeParams={vi.fn()}
        mode="simple" changed={new Set()} ai={noAi}
      />
    );

    expect(screen.queryByRole('radiogroup', { name: '리스크 성향' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radiogroup', { name: '경제 시나리오' })).not.toBeInTheDocument();
    expect(screen.queryByText(/경제 시나리오는 물가·환율만 바꿉니다/))
      .not.toBeInTheDocument();
  });
});
