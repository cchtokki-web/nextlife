import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { RetirementGoalSection } from '@/web/features/StrategySettings/sections/RetirementGoalSection';
import { DEFAULT_RETIREMENT_STRATEGY } from '@/core/usecases/strategy/compileStrategy';
import { initialParams } from '@/infrastructure/storage/localStore';
import { SimulationParams } from '@/core/entities/types';

const noAi = { recommendation: null, error: null, improved: false };

const renderSection = (params: SimulationParams = initialParams, onChangeParams = vi.fn(), ai = noAi) => {
  render(
    <RetirementGoalSection
      params={params} onChangeParams={onChangeParams}
      mode="standard" changed={new Set()} ai={ai}
    />
  );
  return onChangeParams;
};

// '생활비 전략'과 '목표 우선순위'는 둘 다 'AI 추천' 옵션을 갖는다. 그룹으로 좁히지
// 않으면 getByRole이 두 개를 찾아 던지므로, 라디오는 항상 그룹 안에서 찾는다.
const group = (name: string) => within(screen.getByRole('radiogroup', { name }));

describe('RetirementGoalSection', () => {
  test('생활비 전략 4개 선택지를 렌더링한다', () => {
    renderSection();

    const spending = group('생활비 전략');
    for (const label of [/원하는 생활비 직접 입력/, /배당금만 소비/, /최대 생활비 자동 계산/, /AI 추천/]) {
      expect(spending.getByRole('radio', { name: label })).toBeInTheDocument();
    }
  });

  test('목표 우선순위 5개 선택지를 렌더링한다', () => {
    renderSection();

    const objective = group('목표 우선순위');
    for (const label of [/평생 생활비 확보/, /세금 최소화/, /자산 최대화/, /상속 최대화/, /AI 추천/]) {
      expect(objective.getByRole('radio', { name: label })).toBeInTheDocument();
    }
  });

  test('목표 우선순위를 고르면 strategy.objective가 반영된다', () => {
    const onChangeParams = renderSection();

    fireEvent.click(group('목표 우선순위').getByRole('radio', { name: /세금 최소화/ }));

    expect(onChangeParams).toHaveBeenCalledWith({
      ...initialParams,
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, objective: 'tax_minimization' },
    });
  });

  test('생활비 전략이 target일 때만 목표 월 생활비 입력이 보인다', () => {
    renderSection();

    expect(screen.getByLabelText('목표 월 생활비')).toBeInTheDocument();
  });

  test('배당금만 소비를 고르면 목표 월 생활비 입력이 사라진다', () => {
    render(
      <RetirementGoalSection
        params={{
          ...initialParams,
          strategy: { ...DEFAULT_RETIREMENT_STRATEGY, spendingChoice: 'dividend_only' },
        }}
        onChangeParams={vi.fn()} mode="standard" changed={new Set()} ai={noAi}
      />
    );

    expect(screen.queryByLabelText('목표 월 생활비')).not.toBeInTheDocument();
  });

  test('AI 추천을 고르면 그 선택 상태가 유지된다', () => {
    const onChangeParams = renderSection();

    fireEvent.click(group('생활비 전략').getByRole('radio', { name: /AI 추천/ }));

    expect(onChangeParams).toHaveBeenCalledWith({
      ...initialParams,
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, spendingChoice: 'ai' },
    });
  });

  test('상속 전략이 "목표 금액 유지"일 때만 금액 입력이 보인다', () => {
    renderSection();
    expect(screen.queryByLabelText('목표 상속자산')).not.toBeInTheDocument();

    render(
      <RetirementGoalSection
        params={{
          ...initialParams,
          strategy: { ...DEFAULT_RETIREMENT_STRATEGY, bequestStrategy: 'target_amount' },
        }}
        onChangeParams={vi.fn()} mode="standard" changed={new Set()} ai={noAi}
      />
    );
    expect(screen.getByLabelText('목표 상속자산')).toBeInTheDocument();
  });

  test('AI 추천이 개선안을 찾으면 생활비 배수 힌트를 표시한다', () => {
    const ai = {
      recommendation: {
        improved: true,
        recommendedPlan: { monthlySpendingMultiplier: 1.1 },
      } as never,
      error: null,
      improved: true,
    };

    renderSection(initialParams, vi.fn(), ai);

    expect(screen.getByText(/AI 추천: 385만원/)).toBeInTheDocument();
  });
});
