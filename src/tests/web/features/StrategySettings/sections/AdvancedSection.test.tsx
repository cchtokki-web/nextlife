import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AdvancedSection } from '@/web/features/StrategySettings/sections/AdvancedSection';
import { initialParams } from '@/infrastructure/storage/localStore';
import { DEFAULT_RETIREMENT_STRATEGY } from '@/core/usecases/strategy/compileStrategy';
import { resolveTaxSettings } from '@/core/usecases/tax/taxRates';
import { PrivatePensionStrategy, SimulationParams } from '@/core/entities/types';

const renderSection = (onChangeParams = vi.fn()) => {
  render(
    <AdvancedSection
      params={initialParams} onChangeParams={onChangeParams}
      mode="expert" changed={new Set()}
    />
  );
  return onChangeParams;
};

const withPensionStrategy = (privatePensionStrategy: PrivatePensionStrategy): SimulationParams => ({
  ...initialParams,
  strategy: { ...DEFAULT_RETIREMENT_STRATEGY, privatePensionStrategy },
});

describe('AdvancedSection', () => {
  test('세법 버전 셀렉터를 렌더링하고 현행만 선택지로 둔다', () => {
    renderSection();

    const select = screen.getByLabelText('세법 버전');
    expect(select).toBeInTheDocument();
    expect(select.querySelectorAll('option')).toHaveLength(1);
  });

  test('세율·한도 입력을 렌더링한다', () => {
    renderSection();

    expect(screen.getByLabelText('미국 배당세율')).toBeInTheDocument();
    expect(screen.getByLabelText('국내 배당세율')).toBeInTheDocument();
    expect(screen.getByLabelText('사적연금 저율과세 한도')).toBeInTheDocument();
    expect(screen.getByLabelText('사적연금 한도초과 세율')).toBeInTheDocument();
  });

  test('미국 배당세율을 바꾸면 taxSettings에 반영된다', () => {
    const onChangeParams = renderSection();

    fireEvent.change(screen.getByLabelText('미국 배당세율'), { target: { value: '20' } });

    expect(onChangeParams).toHaveBeenCalledWith({
      ...initialParams,
      taxSettings: { ...resolveTaxSettings(initialParams.taxSettings), usDividendTaxRate: 20 },
    });
  });

  test('사적연금 저율과세 한도는 콤마 표기로 보여주고 콤마를 뗀 숫자로 반영한다', () => {
    const onChangeParams = renderSection();

    const input = screen.getByLabelText('사적연금 저율과세 한도');
    expect(input).toHaveValue('15,000,000');

    fireEvent.change(input, { target: { value: '18,000,000' } });

    expect(onChangeParams).toHaveBeenCalledWith({
      ...initialParams,
      taxSettings: { ...resolveTaxSettings(initialParams.taxSettings), privatePensionLimit: 18000000 },
    });
  });

  test('연금 전략이 AI 최적화면 저율과세 한도 스위치를 직접 켤 수 있다', () => {
    const onChangeParams = renderSection();

    const sw = screen.getByRole('switch', { name: /저율과세 한도 내에서만 인출/ });
    expect(sw).not.toBeDisabled();

    fireEvent.click(sw);

    expect(onChangeParams).toHaveBeenCalledWith({
      ...initialParams,
      taxSettings: {
        ...resolveTaxSettings(initialParams.taxSettings),
        limitPrivatePensionToTaxLimit: true,
      },
    });
  });

  test('연금 전략이 명시적이면 저율과세 한도 스위치가 비활성화되고 이유를 설명한다', () => {
    render(
      <AdvancedSection
        params={withPensionStrategy('tax_first')}
        onChangeParams={vi.fn()} mode="expert" changed={new Set()}
      />
    );

    expect(screen.getByRole('switch', { name: /저율과세 한도 내에서만 인출/ })).toBeDisabled();
    expect(screen.getByText(/③연금 전략의 선택이 이 값을 결정합니다/)).toBeInTheDocument();
  });

  test('전략이 지배할 때는 저장된 값이 아니라 전략이 강제하는 값을 보여준다', () => {
    // 'spending_first'는 한도를 무시하고 인출한다(limitToTaxLimit=false). 저장된
    // taxSettings가 true여도 실제 계산은 false로 돌아가므로, 켜진 스위치를 보여주면
    // 화면과 결과가 어긋난다.
    render(
      <AdvancedSection
        params={{
          ...withPensionStrategy('spending_first'),
          taxSettings: { ...resolveTaxSettings(), limitPrivatePensionToTaxLimit: true },
        }}
        onChangeParams={vi.fn()} mode="expert" changed={new Set()}
      />
    );

    expect(screen.getByRole('switch', { name: /저율과세 한도 내에서만 인출/ })).not.toBeChecked();
  });

  test('금융소득종합과세 스위치를 렌더링한다', () => {
    renderSection();

    expect(screen.getByRole('switch', { name: /금융소득종합과세 반영/ })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /건강보험료 반영/ })).toBeInTheDocument();
  });

  test('간편 모드에서는 아무것도 렌더링하지 않는다', () => {
    render(
      <AdvancedSection
        params={initialParams} onChangeParams={vi.fn()}
        mode="simple" changed={new Set()}
      />
    );

    expect(screen.queryByLabelText('미국 배당세율')).not.toBeInTheDocument();
  });

  test('표준 모드에서도 고급 설정은 숨긴다', () => {
    render(
      <AdvancedSection
        params={initialParams} onChangeParams={vi.fn()}
        mode="standard" changed={new Set()}
      />
    );

    expect(screen.queryByLabelText('세법 버전')).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: /금융소득종합과세 반영/ })).not.toBeInTheDocument();
  });
});
