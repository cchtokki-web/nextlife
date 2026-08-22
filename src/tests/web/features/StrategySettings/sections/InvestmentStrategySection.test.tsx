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
    // 2026-08-22: 수익률을 지배하던 세 선택지(안정형/중립형/공격형)는 제거됐다 —
    // 리스크 성향은 이제 '사용자 직접입력'/'입력 수익률 유지' 둘뿐이다.
    const risk = within(screen.getByRole('radiogroup', { name: '리스크 성향' }));
    for (const label of [/사용자 직접입력/, /입력 수익률 유지/]) {
      expect(risk.getByRole('radio', { name: label })).toBeInTheDocument();
    }
    for (const label of [/안정형/, /중립형/, /공격형/]) {
      expect(risk.queryByRole('radio', { name: label })).not.toBeInTheDocument();
    }

    const scenario = within(screen.getByRole('radiogroup', { name: '경제 시나리오' }));
    for (const label of [/장기 평균/, /장기 침체/, /고물가/, /저성장/, /직접 입력값 유지/]) {
      expect(scenario.getByRole('radio', { name: label })).toBeInTheDocument();
    }
  });

  test('입력 수익률 유지를 고르면 strategy.riskProfile이 ai_recommended가 된다', () => {
    // 기본값이 이미 'ai_recommended'라 그 라디오를 클릭해도 change 이벤트가 나지 않는다.
    // 'custom'에서 시작해 실제로 값이 바뀌는 경로를 검증한다.
    const params = {
      ...initialParams,
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, riskProfile: 'custom' as const },
    };
    const onChangeParams = vi.fn();
    render(
      <InvestmentStrategySection
        params={params} onChangeParams={onChangeParams}
        mode="standard" changed={new Set()} ai={noAi}
      />
    );

    fireEvent.click(
      within(screen.getByRole('radiogroup', { name: '리스크 성향' }))
        .getByRole('radio', { name: /입력 수익률 유지/ })
    );

    expect(onChangeParams).toHaveBeenCalledWith({
      ...params,
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, riskProfile: 'ai_recommended' },
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

  // 2026-08-22: 경제 시나리오는 물가·환율만 정하고, 리스크 성향은 더 이상 수익률을
  // 정하지 않는다(자산·연금·ISA에 입력한 수익률이 항상 그대로 쓰인다). 설명문이 그
  // 사실을 정확히 말해야 한다.
  test('시나리오와 리스크 성향의 역할 구분을 설명문으로 알린다', () => {
    render(
      <InvestmentStrategySection
        params={initialParams} onChangeParams={vi.fn()}
        mode="standard" changed={new Set()} ai={noAi}
      />
    );

    expect(screen.getByText(/경제 시나리오는 물가·환율만 바꿉니다/))
      .toBeInTheDocument();
    expect(screen.getByText(/리스크 성향은 수익률을 바꾸지 않습니다/)).toBeInTheDocument();
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
