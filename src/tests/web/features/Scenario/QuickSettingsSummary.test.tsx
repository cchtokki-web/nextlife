import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QuickSettingsSummary } from '@/web/features/Scenario/QuickSettingsSummary';
import { applyYieldPreset, restoreCustomYieldPreset } from '@/core/usecases/scenario/applyYieldPreset';
import { SimulationParams } from '@/core/entities/types';

const baseParams: SimulationParams = {
  userProfile: { currentAge: 55, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3000000 },
  assets: [],
  nationalPension: { expectedMonthlyAmount: 0 },
  privatePensions: [],
  otherIncomes: [],
  inflationRate: 0,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

describe('QuickSettingsSummary', () => {
  test('현재나이/은퇴나이/목표월생활비 값을 표시하고, 프리셋 버튼 3개를 렌더링한다', () => {
    render(<QuickSettingsSummary params={baseParams} onChangeParams={vi.fn()} />);

    expect(screen.getByDisplayValue('55')).toBeInTheDocument();
    expect(screen.getByDisplayValue('60')).toBeInTheDocument();
    expect(screen.getByDisplayValue('3,000,000')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /보수적/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /기본값/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /공격적/ })).toBeInTheDocument();
  });

  test('현재나이를 변경하면 onChangeParams가 userProfile.currentAge만 바뀐 객체로 호출된다', () => {
    const onChangeParams = vi.fn();
    render(<QuickSettingsSummary params={baseParams} onChangeParams={onChangeParams} />);

    fireEvent.change(screen.getByDisplayValue('55'), { target: { value: '58' } });

    expect(onChangeParams).toHaveBeenCalledWith({
      ...baseParams,
      userProfile: { ...baseParams.userProfile, currentAge: 58 },
    });
  });

  test('목표 월 생활비를 콤마 포함 문자열로 입력해도 숫자로 파싱해 반영한다', () => {
    const onChangeParams = vi.fn();
    render(<QuickSettingsSummary params={baseParams} onChangeParams={onChangeParams} />);

    fireEvent.change(screen.getByDisplayValue('3,000,000'), { target: { value: '3,500,000' } });

    expect(onChangeParams).toHaveBeenCalledWith({
      ...baseParams,
      userProfile: { ...baseParams.userProfile, targetMonthlySpending: 3500000 },
    });
  });

  test('프리셋 버튼 클릭 시 onChangeParams가 applyYieldPreset 결과와 동일한 객체로 호출된다', () => {
    const onChangeParams = vi.fn();
    render(<QuickSettingsSummary params={baseParams} onChangeParams={onChangeParams} />);

    fireEvent.click(screen.getByRole('button', { name: /보수적/ }));

    expect(onChangeParams).toHaveBeenCalledWith(applyYieldPreset(baseParams, 'conservative'));
  });

  test('userProfile이 없으면 크래시 없이 기본값을 사용한다', () => {
    const paramsWithoutProfile = { ...baseParams, userProfile: undefined } as unknown as SimulationParams;
    render(<QuickSettingsSummary params={paramsWithoutProfile} onChangeParams={vi.fn()} />);

    expect(screen.getByDisplayValue('35')).toBeInTheDocument();
  });

  test('프리셋 라벨은 "투자성향"이 아니라 "시장 수익률 프리셋"으로 표시된다', () => {
    render(<QuickSettingsSummary params={baseParams} onChangeParams={vi.fn()} />);

    expect(screen.getByText('시장 수익률 프리셋')).toBeInTheDocument();
    expect(screen.queryByText('투자성향')).not.toBeInTheDocument();
  });

  test('yieldPreset이 custom이 아니고 customYieldSnapshot도 없으면 사용자 프리셋 버튼을 표시하지 않는다', () => {
    render(<QuickSettingsSummary params={baseParams} onChangeParams={vi.fn()} />);

    expect(screen.queryByRole('button', { name: '사용자 프리셋' })).not.toBeInTheDocument();
  });

  test('yieldPreset이 custom이면 사용자 프리셋 버튼이 활성 상태로 표시된다', () => {
    const customParams: SimulationParams = { ...baseParams, yieldPreset: 'custom' };
    render(<QuickSettingsSummary params={customParams} onChangeParams={vi.fn()} />);

    expect(screen.getByRole('button', { name: '사용자 프리셋' })).toHaveClass('text-primary');
  });

  test('다른 프리셋으로 바꿔도 customYieldSnapshot이 있으면 사용자 프리셋 버튼이 계속 표시된다', () => {
    const params: SimulationParams = {
      ...baseParams,
      yieldPreset: 'aggressive',
      customYieldSnapshot: { assets: {}, privatePensions: {} },
    };
    render(<QuickSettingsSummary params={params} onChangeParams={vi.fn()} />);

    expect(screen.getByRole('button', { name: '사용자 프리셋' })).toBeInTheDocument();
  });

  test('사용자 프리셋 버튼 클릭 시 onChangeParams가 restoreCustomYieldPreset 결과와 동일한 객체로 호출된다', () => {
    const onChangeParams = vi.fn();
    const params: SimulationParams = {
      ...baseParams,
      yieldPreset: 'aggressive',
      customYieldSnapshot: { assets: {}, privatePensions: {} },
    };
    render(<QuickSettingsSummary params={params} onChangeParams={onChangeParams} />);

    fireEvent.click(screen.getByRole('button', { name: '사용자 프리셋' }));

    expect(onChangeParams).toHaveBeenCalledWith(restoreCustomYieldPreset(params));
  });
});
