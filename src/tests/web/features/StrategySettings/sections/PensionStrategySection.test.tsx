import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { PensionStrategySection } from '@/web/features/StrategySettings/sections/PensionStrategySection';
import { DEFAULT_RETIREMENT_STRATEGY } from '@/core/usecases/strategy/compileStrategy';
import { initialParams } from '@/infrastructure/storage/localStore';

const noAi = { recommendation: null, error: null, improved: false };

describe('PensionStrategySection', () => {
  test('국민연금 전략 6개(조기수령 포함)와 사적연금 전략 5개를 렌더링한다', () => {
    render(
      <PensionStrategySection
        params={initialParams} onChangeParams={vi.fn()}
        mode="standard" changed={new Set()} ai={noAi}
      />
    );

    // 두 그룹 모두 'AI 최적화' 옵션을 가지므로 그룹으로 좁혀 찾는다.
    const national = within(screen.getByRole('radiogroup', { name: '국민연금 수령 시작' }));
    for (const label of [/조기 수령/, /예상 수령/, /1년 연기/, /2년 연기/, /최대 연기/, /AI 최적화/]) {
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

  test('배당금 재투자를 끄면 모든 자산의 reinvestDividend가 false가 된다', () => {
    const onChangeParams = vi.fn();
    render(
      <PensionStrategySection
        params={initialParams} onChangeParams={onChangeParams}
        mode="standard" changed={new Set()} ai={noAi}
      />
    );

    fireEvent.click(screen.getByRole('switch', { name: /배당금 재투자/ }));

    expect(onChangeParams).toHaveBeenCalledWith({
      ...initialParams,
      assets: initialParams.assets.map((a) => ({ ...a, reinvestDividend: false })),
    });
  });

  test('자산마다 설정이 다르면 스위치가 꺼진 상태로 보이고 혼합 안내를 표시한다', () => {
    const mixed = {
      ...initialParams,
      assets: [
        { ...initialParams.assets[0], reinvestDividend: true },
        { ...initialParams.assets[1], reinvestDividend: false },
      ],
    };

    render(
      <PensionStrategySection
        params={mixed} onChangeParams={vi.fn()}
        mode="standard" changed={new Set()} ai={noAi}
      />
    );

    expect(screen.getByRole('switch', { name: /배당금 재투자/ })).not.toBeChecked();
    expect(screen.getByText(/자산마다 다르게 설정되어 있습니다/)).toBeInTheDocument();
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

  // B2: 사적연금 월 인출 목표는 적용되지 않을 뿐 아니라 이 화면의 선택지로는 표현조차 되지
  // 않는다. 후보 격자는 targetMonthlySpending × {0.8, 1.0, 1.3}이고 표현 가능한 값은
  // privatePensionLimit/12 × {1, 0.5, 0.25}라 교집합이 없다. 적용할 수 없는 값을 "AI 추천"으로
  // 보여주면 사용자는 추천을 따르려고 눌렀다가 아무 일도 일어나지 않는 것을 보게 된다.
  test('적용할 수 없는 사적연금 월 인출 목표는 힌트로 보여주지 않는다', () => {
    const ai = {
      recommendation: {
        improved: true,
        recommendedPlan: { nationalPensionStartAge: 70, privatePensionMonthlyTarget: 2800000 },
      } as never,
      error: null, improved: true,
    };

    render(
      <PensionStrategySection
        params={initialParams} onChangeParams={vi.fn()}
        mode="standard" changed={new Set()} ai={ai}
      />
    );

    expect(screen.queryByText(/만원 인출/)).not.toBeInTheDocument();
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
