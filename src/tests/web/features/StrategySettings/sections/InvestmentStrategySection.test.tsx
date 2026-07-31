import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { InvestmentStrategySection } from '@/web/features/StrategySettings/sections/InvestmentStrategySection';
import { EconomicAssumptionSection } from '@/web/features/StrategySettings/sections/EconomicAssumptionSection';
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
    for (const label of [/안정형/, /중립형/, /공격형/, /AI 추천/]) {
      expect(risk.getByRole('radio', { name: label })).toBeInTheDocument();
    }

    const scenario = within(screen.getByRole('radiogroup', { name: '경제 시나리오' }));
    for (const label of [/장기 평균/, /장기 침체/, /고물가/, /저성장/, /AI 추천/]) {
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

  test('시나리오와 리스크 성향의 역할 구분을 설명문으로 알린다', () => {
    render(
      <InvestmentStrategySection
        params={initialParams} onChangeParams={vi.fn()}
        mode="standard" changed={new Set()} ai={noAi}
      />
    );

    expect(screen.getByText(/시나리오는 물가·환율을, 리스크 성향은 수익률을 결정합니다/))
      .toBeInTheDocument();
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
    expect(screen.queryByText(/시나리오는 물가·환율을, 리스크 성향은 수익률을 결정합니다/))
      .not.toBeInTheDocument();
  });
});

describe('EconomicAssumptionSection', () => {
  test('물가상승률·환율·기준 통화를 표시한다', () => {
    render(
      <EconomicAssumptionSection
        params={initialParams} onChangeParams={vi.fn()}
        mode="standard" changed={new Set()}
      />
    );

    expect(screen.getByLabelText('물가상승률')).toHaveValue(2.5);
    expect(screen.getByLabelText('적용 환율')).toBeInTheDocument();
    expect(screen.getByLabelText('대시보드 기준 통화')).toBeInTheDocument();
  });

  test('실질 수익률 스위치를 끄면 inflationMode가 nominal이 된다', () => {
    const onChangeParams = vi.fn();
    render(
      <EconomicAssumptionSection
        params={initialParams} onChangeParams={onChangeParams}
        mode="standard" changed={new Set()}
      />
    );

    fireEvent.click(screen.getByRole('switch', { name: /실질 수익률로 계산/ }));

    expect(onChangeParams).toHaveBeenCalledWith({ ...initialParams, inflationMode: 'nominal' });
  });

  test('경제 시나리오를 명시적으로 고르면 물가상승률 입력이 비활성화되고 안내문이 보인다', () => {
    const params = {
      ...initialParams,
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, economicScenario: 'recession' as const },
    };

    render(
      <EconomicAssumptionSection
        params={params} onChangeParams={vi.fn()}
        mode="standard" changed={new Set()}
      />
    );

    expect(screen.getByLabelText('물가상승률')).toBeDisabled();
    expect(screen.getByText(/경제 시나리오가 아래 물가상승률과 환율을 결정합니다/)).toBeInTheDocument();
  });

  test('경제 시나리오가 AI 추천(미정)이면 물가상승률 입력이 가능하고 안내문이 없다', () => {
    render(
      <EconomicAssumptionSection
        params={initialParams} onChangeParams={vi.fn()}
        mode="standard" changed={new Set()}
      />
    );

    expect(screen.getByLabelText('물가상승률')).not.toBeDisabled();
    expect(screen.queryByText(/경제 시나리오가 아래 물가상승률과 환율을 결정합니다/)).not.toBeInTheDocument();
  });
});
