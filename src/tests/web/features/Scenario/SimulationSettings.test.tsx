import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SimulationSettings } from '@/web/features/Scenario/SimulationSettings';
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

function renderSimulationSettings(activeParams: SimulationParams, handleUpdateActiveParams = vi.fn()) {
  return render(
    <SimulationSettings scenarioState={{ activeParams, handleUpdateActiveParams }} />
  );
}

describe('SimulationSettings 시장 수익률 프리셋 - 사용자 프리셋', () => {
  test('yieldPreset이 custom이 아니고 customYieldSnapshot도 없으면 사용자 프리셋 버튼을 표시하지 않는다', () => {
    renderSimulationSettings(baseParams);

    expect(screen.queryByRole('button', { name: '사용자 프리셋' })).not.toBeInTheDocument();
  });

  test('다른 프리셋으로 바꿔도 customYieldSnapshot이 있으면 사용자 프리셋 버튼이 계속 표시된다', () => {
    const params: SimulationParams = {
      ...baseParams,
      yieldPreset: 'aggressive',
      customYieldSnapshot: { assets: {}, privatePensions: {} },
    };
    renderSimulationSettings(params);

    expect(screen.getByRole('button', { name: '사용자 프리셋' })).toBeInTheDocument();
  });

  test('yieldPreset이 custom이면 사용자 프리셋 버튼이 활성 상태로 표시된다', () => {
    const params: SimulationParams = { ...baseParams, yieldPreset: 'custom' };
    renderSimulationSettings(params);

    const button = screen.getByRole('button', { name: '사용자 프리셋' });
    expect(button.className).toContain('active');
  });

  test('사용자 프리셋 버튼 클릭 시 handleUpdateActiveParams가 restoreCustomYieldPreset 결과와 동일한 객체로 호출된다', () => {
    const handleUpdateActiveParams = vi.fn();
    const params: SimulationParams = {
      ...baseParams,
      yieldPreset: 'aggressive',
      customYieldSnapshot: { assets: {}, privatePensions: {} },
    };
    renderSimulationSettings(params, handleUpdateActiveParams);

    fireEvent.click(screen.getByRole('button', { name: '사용자 프리셋' }));

    // SimulationSettings는 내부적으로 방어적 기본값(spendingStrategy 등)을 병합한 activeParams를 사용한다.
    const mergedParams = { ...params, spendingStrategy: 'target' };
    expect(handleUpdateActiveParams).toHaveBeenCalledWith(restoreCustomYieldPreset(mergedParams as SimulationParams));
  });

  test('기존 프리셋 버튼 클릭 동작은 그대로 유지된다', () => {
    const handleUpdateActiveParams = vi.fn();
    renderSimulationSettings(baseParams, handleUpdateActiveParams);

    fireEvent.click(screen.getByRole('button', { name: /보수적/ }));

    // SimulationSettings는 내부적으로 방어적 기본값(spendingStrategy 등)을 병합한 activeParams를 사용한다.
    const mergedParams = { ...baseParams, spendingStrategy: 'target' };
    expect(handleUpdateActiveParams).toHaveBeenCalledWith(applyYieldPreset(mergedParams as SimulationParams, 'conservative'));
  });
});
