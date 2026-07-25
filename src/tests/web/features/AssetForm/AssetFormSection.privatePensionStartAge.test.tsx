import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AssetFormSection } from '@/web/features/AssetForm/AssetFormSection';
import { SimulationParams } from '@/core/entities/types';

// jsdom은 scrollIntoView를 구현하지 않는다. 탭 전환 시 AssetFormSection이 이를 호출하므로 스텁한다.
window.HTMLElement.prototype.scrollIntoView = vi.fn();

const baseParams: SimulationParams = {
  userProfile: { currentAge: 50, retirementAge: 50, expectancy: 90, targetMonthlySpending: 3000000 },
  assets: [],
  nationalPension: { expectedMonthlyAmount: 0 },
  privatePensions: [
    { id: 'p1', type: 'irp', balance: 100000000, monthlyContribution: 0, annualReturn: 5, currency: 'KRW' },
  ],
  otherIncomes: [],
  inflationRate: 2,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

// AssetFormSection은 activeTab='profile'로 시작하므로, "연금 자산" 탭 버튼을 클릭해야
// 사적연금 관련 필드가 렌더링된다.
function renderOnPensionsTab(params: SimulationParams, onChangeParams = vi.fn()) {
  render(<AssetFormSection params={params} onChangeParams={onChangeParams} />);
  fireEvent.click(screen.getByRole('button', { name: /연금 자산/ }));
  return onChangeParams;
}

describe('AssetFormSection - 사적연금 수령 개시 나이', () => {
  test('사적연금 계좌가 없으면 수령 개시 나이 필드가 렌더링되지 않는다', () => {
    renderOnPensionsTab({ ...baseParams, privatePensions: [] });
    expect(screen.queryByText(/사적연금 수령 개시 나이/)).not.toBeInTheDocument();
  });

  test('사적연금 계좌가 있으면 필드가 렌더링되고, 은퇴나이(50)가 55세 미만이라 기본값 55를 보여준다', () => {
    renderOnPensionsTab(baseParams);
    expect(screen.getByText(/사적연금 수령 개시 나이/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('55')).toBeInTheDocument();
  });

  test('은퇴나이가 55세 이상이면 기본값으로 은퇴나이를 그대로 보여준다', () => {
    renderOnPensionsTab({ ...baseParams, userProfile: { ...baseParams.userProfile, retirementAge: 60 } });
    expect(screen.getByDisplayValue('60')).toBeInTheDocument();
  });

  test('withdrawalPlan.privatePensionStartAge가 이미 설정돼 있으면 그 값을 보여준다', () => {
    renderOnPensionsTab({ ...baseParams, withdrawalPlan: { privatePensionStartAge: 62 } });
    expect(screen.getByDisplayValue('62')).toBeInTheDocument();
  });

  test('55세 미만 값을 입력하면 55로 clamp되어 onChangeParams가 호출된다', () => {
    const onChangeParams = renderOnPensionsTab(baseParams);
    fireEvent.change(screen.getByDisplayValue('55'), { target: { value: '52' } });

    expect(onChangeParams).toHaveBeenCalledWith({
      ...baseParams,
      isaAccounts: [],
      spendingStrategy: 'target',
      withdrawalPlan: { privatePensionStartAge: 55 },
    });
  });

  test('정상 값을 입력하면 withdrawalPlan.privatePensionStartAge만 갱신되고 나머지 params는 유지된다', () => {
    const onChangeParams = renderOnPensionsTab(baseParams);
    fireEvent.change(screen.getByDisplayValue('55'), { target: { value: '62' } });

    expect(onChangeParams).toHaveBeenCalledWith({
      ...baseParams,
      isaAccounts: [],
      spendingStrategy: 'target',
      withdrawalPlan: { privatePensionStartAge: 62 },
    });
  });
});
