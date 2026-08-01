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

  // A6(C2와 같은 결함 형태): UtilityEngine.targetAnnualSpendingForYear는 **모든** 생활비
  // 전략에서 userProfile.targetMonthlySpending을 소비 만족도의 분모로 쓴다. 어느 선택지에서든
  // 숨기면 사용자가 볼 수도 고칠 수도 없는 값이 점수를 좌우한다.
  test.each([
    ['target'],
    ['ai'],
    ['dividend_only'],
    ['max_sustainable'],
  ] as const)('생활비 전략이 %s여도 목표 월 생활비 입력이 보인다', (spendingChoice) => {
    renderSection({
      ...initialParams,
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, spendingChoice },
    });

    expect(screen.getByLabelText('목표 월 생활비')).toBeInTheDocument();
  });

  test.each([
    ['dividend_only'],
    ['max_sustainable'],
  ] as const)('인출액을 정하지 않는 전략(%s)에서는 이 값이 채점 기준임을 안내한다', (spendingChoice) => {
    renderSection({
      ...initialParams,
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, spendingChoice },
    });

    expect(screen.getByText(/소비 만족도/)).toBeInTheDocument();
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

  // 아래 두 케이스는 제거된 AssetFormSection profile 탭의 목표 상속자산 입력에서 옮겨온 것이다.
  test('목표 상속자산을 콤마 표기로 보여주고 콤마를 뗀 숫자로 반영한다', () => {
    const params: SimulationParams = {
      ...initialParams,
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, bequestStrategy: 'target_amount' },
      userProfile: { ...initialParams.userProfile, targetBequest: 200000000 },
    };
    const onChangeParams = renderSection(params);

    expect(screen.getByLabelText('목표 상속자산')).toHaveValue('200,000,000');

    fireEvent.change(screen.getByLabelText('목표 상속자산'), { target: { value: '150,000,000' } });

    expect(onChangeParams).toHaveBeenCalledWith({
      ...params,
      userProfile: { ...params.userProfile, targetBequest: 150000000 },
    });
  });

  test('0으로 명시적으로 입력해도(다 쓰고 가기) 정상 반영된다', () => {
    const params: SimulationParams = {
      ...initialParams,
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, bequestStrategy: 'target_amount' },
      userProfile: { ...initialParams.userProfile, targetBequest: 100000000 },
    };
    const onChangeParams = renderSection(params);

    fireEvent.change(screen.getByLabelText('목표 상속자산'), { target: { value: '0' } });

    expect(onChangeParams).toHaveBeenCalledWith({
      ...params,
      userProfile: { ...params.userProfile, targetBequest: 0 },
    });
  });

  // C2: compileStrategy의 resolveSpendingStrategy가 'ai'를 'target'으로 내리므로, 엔진은
  // 'ai'를 골라도 userProfile.targetMonthlySpending 전액을 인출 목표로 계속 쓴다.
  // 입력을 숨기면 사용자가 볼 수도 고칠 수도 없는 값이 계산을 지배한다.
  describe('생활비 전략이 AI 추천일 때', () => {
    const aiParams: SimulationParams = {
      ...initialParams,
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, spendingChoice: 'ai' },
    };

    test('목표 월 생활비 입력이 계속 보인다 (엔진이 이 값을 그대로 쓰기 때문)', () => {
      renderSection(aiParams);

      expect(screen.getByLabelText('목표 월 생활비')).toBeInTheDocument();
    });

    test('AI 제안값 힌트를 볼 수 있다', () => {
      const ai = {
        recommendation: { improved: true, recommendedPlan: { monthlySpendingMultiplier: 1.1 } } as never,
        error: null,
        improved: true,
      };

      renderSection(aiParams, vi.fn(), ai);

      expect(screen.getByText(/AI 추천: 385만원/)).toBeInTheDocument();
    });
  });

  // C3: 'target_amount'를 고르면서 targetBequest를 미설정으로 두면 화면은 "0원"을 보여주는데
  // compileStrategy는 그 키를 지워 'maximize'와 똑같이 동작한다(엔진 추정 8,400만원).
  describe('상속 전략이 "목표 금액 유지"로 바뀔 때', () => {
    test('목표 상속자산이 없으면 적정 상속 자산(월 생활비 × 24개월)으로 시드한다', () => {
      const onChangeParams = renderSection();

      fireEvent.click(group('상속 전략').getByRole('radio', { name: /목표 금액 유지/ }));

      expect(onChangeParams).toHaveBeenCalledWith({
        ...initialParams,
        strategy: { ...DEFAULT_RETIREMENT_STRATEGY, bequestStrategy: 'target_amount' },
        userProfile: {
          ...initialParams.userProfile,
          targetBequest: initialParams.userProfile.targetMonthlySpending * 24,
        },
      });
    });

    test('이미 입력한 목표 상속자산은 시드가 덮어쓰지 않는다', () => {
      // targetBequest만 있고 strategy가 없으면 레거시 씨앗이 이미 'target_amount'를 유도해
      // 라디오가 선택된 상태가 된다(클릭해도 change 이벤트가 없다). 다른 전략을 명시해
      // "금액은 있지만 지금은 다른 전략" 상태를 만든다.
      const params: SimulationParams = {
        ...initialParams,
        strategy: { ...DEFAULT_RETIREMENT_STRATEGY, bequestStrategy: 'leave_some' },
        userProfile: { ...initialParams.userProfile, targetBequest: 300000000 },
      };
      const onChangeParams = renderSection(params);

      fireEvent.click(group('상속 전략').getByRole('radio', { name: /목표 금액 유지/ }));

      expect(onChangeParams).toHaveBeenCalledWith({
        ...params,
        strategy: { ...DEFAULT_RETIREMENT_STRATEGY, bequestStrategy: 'target_amount' },
      });
    });

    test('다른 상속 전략을 고를 때는 targetBequest를 건드리지 않는다', () => {
      const onChangeParams = renderSection();

      // '일부 남기기'는 기본값이라 이미 선택되어 있다(클릭해도 change 이벤트가 없다).
      fireEvent.click(group('상속 전략').getByRole('radio', { name: /모두 사용/ }));

      expect(onChangeParams).toHaveBeenCalledWith({
        ...initialParams,
        strategy: { ...DEFAULT_RETIREMENT_STRATEGY, bequestStrategy: 'spend_all' },
      });
    });
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
