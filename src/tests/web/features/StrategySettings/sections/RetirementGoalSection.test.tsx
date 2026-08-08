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
    for (const label of [/원하는 생활비 직접 입력/, /배당금만 소비/, /평생 소비 최적화/, /생활비 제안 받기/]) {
      expect(spending.getByRole('radio', { name: label })).toBeInTheDocument();
    }
  });

  test('목표 우선순위 5개 선택지를 렌더링한다', () => {
    renderSection();

    const objective = group('목표 우선순위');
    for (const label of [/평생 생활비 확보/, /세금 최소화/, /자산 최대화/, /상속 최대화/, /균형 있게 평가/]) {
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

    fireEvent.click(group('생활비 전략').getByRole('radio', { name: /생활비 제안 받기/ }));

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

      expect(screen.getByText(/추천값 있음: 385만원/)).toBeInTheDocument();
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

  // C9: 두 금액 입력의 콤마 파싱이 검증되지 않았다. 화면은 toLocaleString()으로 콤마를
  // 붙여 보여주므로, onChange에서 콤마를 떼지 않으면 사용자가 그 값을 그대로 고쳤을 때
  // Number('3,000,000') === NaN이 저장되고 엔진 전체가 NaN으로 물든다.
  describe('금액 입력의 콤마 파싱', () => {
    const targetAmountParams: SimulationParams = {
      ...initialParams,
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, bequestStrategy: 'target_amount' },
      userProfile: { ...initialParams.userProfile, targetBequest: 200000000 },
    };

    test('목표 월 생활비를 콤마 표기로 보여준다', () => {
      renderSection();

      expect(screen.getByLabelText('목표 월 생활비')).toHaveValue('3,500,000');
    });

    test('목표 월 생활비는 콤마를 뗀 숫자로 저장한다', () => {
      const onChangeParams = renderSection();

      fireEvent.change(screen.getByLabelText('목표 월 생활비'), { target: { value: '3,000,000' } });

      // params 전체를 단정한다 — strategy나 targetBequest를 함께 건드리면 깨진다.
      expect(onChangeParams).toHaveBeenCalledWith({
        ...initialParams,
        userProfile: { ...initialParams.userProfile, targetMonthlySpending: 3000000 },
      });
    });

    test('목표 월 생활비를 비우면 0으로 저장한다(지웠다 다시 입력하는 경로)', () => {
      const onChangeParams = renderSection();

      fireEvent.change(screen.getByLabelText('목표 월 생활비'), { target: { value: '' } });

      expect(onChangeParams).toHaveBeenCalledWith({
        ...initialParams,
        userProfile: { ...initialParams.userProfile, targetMonthlySpending: 0 },
      });
    });

    test('목표 월 생활비에 숫자가 아닌 값을 넣으면 저장하지 않는다', () => {
      // NaN이 저장되면 소비 만족도의 분모가 NaN이 되어 점수 전체가 사라진다.
      const onChangeParams = renderSection();

      fireEvent.change(screen.getByLabelText('목표 월 생활비'), { target: { value: '350만' } });

      expect(onChangeParams).not.toHaveBeenCalled();
    });

    test('목표 상속자산을 비우면 0으로 저장한다', () => {
      const onChangeParams = renderSection(targetAmountParams);

      fireEvent.change(screen.getByLabelText('목표 상속자산'), { target: { value: '' } });

      expect(onChangeParams).toHaveBeenCalledWith({
        ...targetAmountParams,
        userProfile: { ...targetAmountParams.userProfile, targetBequest: 0 },
      });
    });

    test('목표 상속자산에 숫자가 아닌 값을 넣으면 저장하지 않는다', () => {
      const onChangeParams = renderSection(targetAmountParams);

      fireEvent.change(screen.getByLabelText('목표 상속자산'), { target: { value: '2억' } });

      expect(onChangeParams).not.toHaveBeenCalled();
    });

    // 엔진은 자산 흐름을 displayCurrency로 환산한 뒤 이 두 값과 맞댄다(SimulationEngine).
    // 단위를 '원'으로 고정하면 USD 표기 사용자가 달러 값을 넣으면서 '원'을 보게 되어
    // 화면 표기와 엔진 해석이 어긋난다.
    test.each([
      ['KRW', '원'],
      ['USD', 'USD'],
    ] as const)('표시 통화가 %s면 두 금액 입력의 단위가 %s가 된다', (displayCurrency, suffix) => {
      renderSection({ ...targetAmountParams, displayCurrency });

      expect(screen.getByLabelText('목표 월 생활비').parentElement).toHaveTextContent(suffix);
      expect(screen.getByLabelText('목표 상속자산').parentElement).toHaveTextContent(suffix);
    });
  });

  // 금액 입력이 '목표 금액 유지' 외의 전략에서도 보이면, 엔진이 쓰지 않는 값을
  // 사용자가 조정하며 "고쳤는데 결과가 안 바뀐다"를 겪는다.
  test.each([
    ['spend_all'],
    ['leave_some'],
    ['maximize'],
  ] as const)('상속 전략이 %s면 목표 상속자산 입력이 보이지 않는다', (bequestStrategy) => {
    renderSection({
      ...initialParams,
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, bequestStrategy },
      userProfile: { ...initialParams.userProfile, targetBequest: 200000000 },
    });

    expect(screen.queryByLabelText('목표 상속자산')).not.toBeInTheDocument();
  });

  describe('평생 소비 최적화 전용 입력', () => {
    const withChoice = (
      spendingChoice: 'target' | 'max_sustainable',
      patch: Partial<typeof DEFAULT_RETIREMENT_STRATEGY> = {}
    ): SimulationParams => ({
      ...initialParams,
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, spendingChoice, ...patch },
      userProfile: { ...initialParams.userProfile, targetBequest: 100000000 },
    });

    test('평생 소비 최적화를 고르면 소비 성향과 최소 생활비가 보인다', () => {
      renderSection(withChoice('max_sustainable'));

      expect(screen.getByRole('radiogroup', { name: '소비 성향' })).toBeInTheDocument();
      expect(screen.getByLabelText('최소 생활비')).toBeInTheDocument();
    });

    test('다른 생활비 전략에서는 보이지 않는다', () => {
      // 인출액을 목표 생활비가 정하는 전략에서는 "연령대별 배분"이라는 질문이 성립하지 않는다.
      renderSection(withChoice('target'));

      expect(screen.queryByRole('radiogroup', { name: '소비 성향' })).not.toBeInTheDocument();
      expect(screen.queryByLabelText('최소 생활비')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('자산 안전마진')).not.toBeInTheDocument();
    });

    test('안전마진은 목표 상속자산을 정했을 때만 보인다', () => {
      // 마진은 "지켜야 할 금액"에 붙는 것이라 지킬 금액이 없으면 조정할 대상이 없다.
      renderSection(withChoice('max_sustainable', { bequestStrategy: 'target_amount' }));
      expect(screen.getByLabelText('자산 안전마진')).toBeInTheDocument();

      screen.getByLabelText('자산 안전마진').remove();
      renderSection(withChoice('max_sustainable', { bequestStrategy: 'leave_some' }));
      expect(screen.queryByLabelText('자산 안전마진')).not.toBeInTheDocument();
    });

    test('소비 성향을 고르면 strategy.spendingShape가 반영된다', () => {
      const onChangeParams = renderSection(withChoice('max_sustainable'));

      fireEvent.click(
        within(screen.getByRole('radiogroup', { name: '소비 성향' }))
          .getByRole('radio', { name: /활동기 집중형/ })
      );

      expect(onChangeParams).toHaveBeenCalledWith(
        expect.objectContaining({
          strategy: expect.objectContaining({ spendingShape: 'front_loaded' }),
        })
      );
    });

    test('안전마진에 음수를 넣어도 0 아래로 내려가지 않는다', () => {
      const onChangeParams = renderSection(
        withChoice('max_sustainable', { bequestStrategy: 'target_amount' })
      );

      fireEvent.change(screen.getByLabelText('자산 안전마진'), { target: { value: '-30' } });

      expect(onChangeParams).toHaveBeenCalledWith(
        expect.objectContaining({
          strategy: expect.objectContaining({ bequestSafetyMarginRate: 0 }),
        })
      );
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

    expect(screen.getByText(/추천값 있음: 385만원/)).toBeInTheDocument();
  });
});
