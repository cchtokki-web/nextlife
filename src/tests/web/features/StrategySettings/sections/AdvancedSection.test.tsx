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
    expect(screen.getByText(/「연금 전략」의 선택이 이 값을 결정합니다/)).toBeInTheDocument();
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

  // C10: 세금 스위치 4종은 "렌더된다"까지만 검증되어 있었다. 이 섹션의 스위치는 전부
  // setTax(patch) 하나를 공유하므로, 핸들러가 붙는 키를 잘못 적으면(복붙 실수)
  // 스위치를 켰는데 옆 항목이 켜지거나 값이 통째로 초기화되는데 아무도 잡지 못했다.
  describe('세금 스위치 4종', () => {
    const defaults = resolveTaxSettings(initialParams.taxSettings);

    const SWITCHES = [
      ['금융소득종합과세 반영', 'enableComprehensiveTax'],
      ['건강보험료 반영', 'enableHealthInsurance'],
      ['사적연금 한도초과세 반영', 'enablePrivatePensionTax'],
      ['분리과세·종합과세 유리한 쪽 선택', 'enablePensionComprehensiveComparison'],
    ] as const;

    test.each(SWITCHES)('%s 스위치를 누르면 그 필드만 뒤집힌다', (label, key) => {
      const onChangeParams = renderSection();

      const sw = screen.getByRole('switch', { name: new RegExp(label) });
      // 저장된 값이 그대로 화면에 반영되어야 한다. 여기가 어긋나면 클릭 결과도 반대가 된다.
      expect(sw).toHaveProperty('checked', defaults[key]);

      fireEvent.click(sw);

      // taxSettings 전체를 단정한다 — 다른 세율·한도를 함께 덮어쓰면 깨진다.
      expect(onChangeParams).toHaveBeenCalledWith({
        ...initialParams,
        taxSettings: { ...defaults, [key]: !defaults[key] },
      });
    });

    test.each(SWITCHES)('%s 스위치는 반대 상태에서 누르면 원래대로 돌아온다', (label, key) => {
      // 한 방향(꺼짐→켜짐)만 검증하면 핸들러가 e.target.checked 대신 상수 true를 써도 통과한다.
      const flipped = { ...defaults, [key]: !defaults[key] };
      const params: SimulationParams = { ...initialParams, taxSettings: flipped };
      const onChangeParams = vi.fn();
      render(
        <AdvancedSection
          params={params} onChangeParams={onChangeParams}
          mode="expert" changed={new Set()}
        />
      );

      fireEvent.click(screen.getByRole('switch', { name: new RegExp(label) }));

      expect(onChangeParams).toHaveBeenCalledWith({
        ...params,
        taxSettings: { ...flipped, [key]: defaults[key] },
      });
    });
  });

  // 구 TaxSettingsSection에 있던 ±100만원 스텝 버튼. 금액이 커서 직접 타이핑하면
  // 자릿수를 틀리기 쉬운 필드라 새 섹션에도 있어야 한다.
  describe('사적연금 저율과세 한도 스텝 버튼', () => {
    const currentLimit = resolveTaxSettings(initialParams.taxSettings).privatePensionLimit;

    const stepperFor = (label: string, name: 'Increase value' | 'Decrease value') => {
      const input = screen.getByLabelText(label);
      const buttons = input.closest('div')?.parentElement
        ?.querySelectorAll<HTMLButtonElement>(`button[aria-label="${name}"]`);
      return buttons?.[0];
    };

    test('▲ 버튼이 한도를 100만원 올린다', () => {
      const onChangeParams = renderSection();

      fireEvent.click(stepperFor('사적연금 저율과세 한도', 'Increase value')!);

      expect(onChangeParams).toHaveBeenCalledWith(expect.objectContaining({
        taxSettings: expect.objectContaining({ privatePensionLimit: currentLimit + 1000000 }),
      }));
    });

    test('▼ 버튼이 한도를 100만원 내리고 0 아래로는 내려가지 않는다', () => {
      const onChangeParams = vi.fn();
      render(
        <AdvancedSection
          params={{
            ...initialParams,
            taxSettings: { ...resolveTaxSettings(initialParams.taxSettings), privatePensionLimit: 500000 },
          }}
          onChangeParams={onChangeParams}
          mode="expert" changed={new Set()}
        />
      );

      fireEvent.click(stepperFor('사적연금 저율과세 한도', 'Decrease value')!);

      expect(onChangeParams).toHaveBeenCalledWith(expect.objectContaining({
        taxSettings: expect.objectContaining({ privatePensionLimit: 0 }),
      }));
    });
  });

  test('전문가 모드에서는 안내문 없이 실제 설정만 보여준다', () => {
    renderSection();

    expect(screen.queryByText(/전문가 모드에서 세율·한도를 직접 조정할 수 있습니다/))
      .not.toBeInTheDocument();
  });

  // 간편/표준에서는 이 섹션의 모든 필드가 STANDARD_EXCLUDED라 본문이 통째로 비는데,
  // 아코디언은 열 수 있다. 빈 아코디언은 고장으로 읽히므로 왜 비었는지 알려 준다.
  test.each(['simple', 'standard'] as const)('%s 모드에서는 필드 대신 안내문만 보여준다', (mode) => {
    render(
      <AdvancedSection
        params={initialParams} onChangeParams={vi.fn()}
        mode={mode} changed={new Set()}
      />
    );

    expect(screen.queryByLabelText('미국 배당세율')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('세법 버전')).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: /금융소득종합과세 반영/ })).not.toBeInTheDocument();
    expect(screen.getByText(/전문가 모드에서 세율·한도를 직접 조정할 수 있습니다/))
      .toBeInTheDocument();
  });
});
