import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AssetFormSection } from '@/web/features/AssetForm/AssetFormSection';
import { SimulationParams } from '@/core/entities/types';

const baseParams: SimulationParams = {
  userProfile: { currentAge: 55, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3000000 },
  assets: [],
  nationalPension: { expectedMonthlyAmount: 0 },
  privatePensions: [],
  otherIncomes: [],
  inflationRate: 2,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

// AssetFormSection은 activeTab='profile'로 시작하므로 별도 탭 클릭 없이 바로 렌더링된다.
describe('AssetFormSection - 목표 상속자산', () => {
  test('targetBequest가 없으면 기본값 0을 보여준다', () => {
    render(<AssetFormSection params={baseParams} onChangeParams={vi.fn()} />);
    expect(screen.getByText('목표 상속자산')).toBeInTheDocument();
    expect(screen.getByDisplayValue('0')).toBeInTheDocument();
  });

  test('targetBequest가 설정되어 있으면 콤마 포맷으로 표시한다', () => {
    const params: SimulationParams = { ...baseParams, userProfile: { ...baseParams.userProfile, targetBequest: 200000000 } };
    render(<AssetFormSection params={params} onChangeParams={vi.fn()} />);
    expect(screen.getByDisplayValue('200,000,000')).toBeInTheDocument();
  });

  test('값을 입력하면 onChangeParams가 userProfile.targetBequest만 바뀐 객체로 호출된다', () => {
    const onChangeParams = vi.fn();
    render(<AssetFormSection params={baseParams} onChangeParams={onChangeParams} />);

    fireEvent.change(screen.getByDisplayValue('0'), { target: { value: '150,000,000' } });

    expect(onChangeParams).toHaveBeenCalledWith({
      ...baseParams,
      isaAccounts: [],
      spendingStrategy: 'target',
      userProfile: { ...baseParams.userProfile, targetBequest: 150000000 },
    });
  });

  test('0으로 명시적으로 입력해도(다 쓰고 가기) 정상 반영된다', () => {
    const onChangeParams = vi.fn();
    const params: SimulationParams = { ...baseParams, userProfile: { ...baseParams.userProfile, targetBequest: 100000000 } };
    render(<AssetFormSection params={params} onChangeParams={onChangeParams} />);

    fireEvent.change(screen.getByDisplayValue('100,000,000'), { target: { value: '0' } });

    expect(onChangeParams).toHaveBeenCalledWith({
      ...params,
      isaAccounts: [],
      spendingStrategy: 'target',
      userProfile: { ...params.userProfile, targetBequest: 0 },
    });
  });
});
