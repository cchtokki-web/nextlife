'use client';

import { ComprehensiveTaxMode, TaxLawVersion, TaxSettings } from '../../../../core/entities/types';
import {
  resolvePrivatePensionTaxLimitOverride, resolveStrategy,
} from '../../../../core/usecases/strategy/compileStrategy';
import { resolveTaxSettings } from '../../../../core/usecases/tax/taxRates';
import SelectField from '../../../components/SelectField';
import { AmountField } from '../../../components/fields/AmountField';
import { NumberField } from '../../../components/fields/NumberField';
import { FieldRow, SwitchField } from '../../../components/form';
import { SECTION_FIELDS, isFieldVisible } from '../fieldVisibility';
import { SectionProps } from '../strategyOptions';

// 세법 버전 선택지. 현재는 현행 하나뿐이며, 확정된 개정안이 생기면 여기에 추가한다
// (허구의 개정안을 지어내지 않는다는 것이 설계 결정이다 — taxLawProfiles.ts 참고).
const TAX_LAW_OPTIONS: ReadonlyArray<{ value: TaxLawVersion; label: string }> = [
  { value: 'current', label: '현행 세법 (2024년 기준)' },
];

// 저율과세 한도 스텝 버튼의 증감 단위(100만원). 구 TaxSettingsSection과 같은 값이다.
const PENSION_LIMIT_STEP = 1000000;

// %로 입력받는 세율 필드. 키를 좁혀 두어야 setTax에 엉뚱한 필드가 들어가지 않는다.
type RateKey =
  | 'usDividendTaxRate' | 'domesticDividendTaxRate'
  | 'comprehensiveTaxRate' | 'healthInsuranceRate' | 'privatePensionExcessTaxRate'
  | 'capitalGainsTaxRate';

export function AdvancedSection({ params, onChangeParams, mode, changed }: SectionProps) {
  const tax = resolveTaxSettings(params.taxSettings);

  // 「연금 전략」이 'ai_optimized'가 아니면 compileStrategy가 저율과세 한도 설정을
  // 덮어쓴다. 그 상태에서 스위치를 켤 수 있게 두면 "켰는데 결과가 안 바뀐다"가 되므로
  // 비활성화하고 이유를 설명문에 적는다.
  const pensionStrategy = resolveStrategy(params).privatePensionStrategy;
  const limitOverride = resolvePrivatePensionTaxLimitOverride(pensionStrategy);
  const pensionStrategyGovernsLimit = limitOverride !== null;
  // 지배당하는 동안에는 저장된 값이 아니라 실제 계산에 쓰이는 값을 보여준다.
  const limitChecked = limitOverride ?? tax.limitPrivatePensionToTaxLimit;

  const setTax = (patch: Partial<TaxSettings>) => {
    onChangeParams({ ...params, taxSettings: { ...tax, ...patch } });
  };

  // 남는 현금 수익률은 다른 자산과 같은 규칙으로 물가를 반영한다. 그래서 실질 기준일 때는
  // "0%면 그대로"가 아니라 "0%면 물가만큼 구매력이 줄어든다"가 된다 — 그 뜻을 설명문에
  // 적어 두지 않으면 같은 숫자가 모드에 따라 다른 의미를 갖는 것으로만 보인다.
  const isRealBasis = (params.inflationMode ?? 'real') === 'real';
  const inflationRate = params.inflationRate ?? 2;

  // 비교과세 모드에서는 누진세율표와 원천징수 공제가 세액을 정하므로 comprehensiveTaxRate가
  // 계산에 쓰이지 않는다. 위 limitPrivatePensionToTaxLimit과 같은 이유로 비활성화한다.
  const comprehensiveTaxModeGovernsRate = tax.comprehensiveTaxMode !== 'flat';

  // 이 섹션의 필드는 전부 전문가 전용이라 간편/표준에서는 본문이 통째로 빈다. 아코디언은
  // 여전히 열리므로, 왜 비어 있는지 알려 주지 않으면 고장으로 읽힌다.
  const hasVisibleField = SECTION_FIELDS.advanced.some((path) => isFieldVisible(mode, path));
  if (!hasVisibleField) {
    return (
      <p className="text-xs text-foreground-muted">
        전문가 모드에서 세율·한도를 직접 조정할 수 있습니다. 지금은 현행 세법 기준 기본값으로 계산합니다.
      </p>
    );
  }

  const rateField = (key: RateKey, label: string, tooltip?: string, disabled = false) => {
    const path = `taxSettings.${key}`;
    return isFieldVisible(mode, path) && (
      <FieldRow label={label} tooltipText={tooltip} changed={changed.has(path)}>
        <NumberField
          label="" aria-label={label} step="0.1" suffixText="%"
          value={tax[key]}
          disabled={disabled}
          onChangeValue={(rate) => setTax({ [key]: rate })}
        />
      </FieldRow>
    );
  };

  return (
    <>
      {isFieldVisible(mode, 'taxLawVersion') && (
        <FieldRow
          label="세법 버전"
          tooltipText="계산에 사용할 세율표입니다. 확정된 개정안이 생기면 선택지가 늘어납니다."
          changed={changed.has('taxLawVersion')}
        >
          <SelectField
            label="" aria-label="세법 버전"
            value={params.taxLawVersion ?? 'current'}
            onChange={(e) =>
              onChangeParams({ ...params, taxLawVersion: e.target.value as TaxLawVersion })
            }
            options={TAX_LAW_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          />
        </FieldRow>
      )}

      {isFieldVisible(mode, 'cashYieldRate') && (
        <FieldRow
          label="남는 현금 수익률"
          tooltipText={
            isRealBasis
              ? '쓰고 남은 돈에 붙는 연 이자율입니다. 지금은 실질(물가 반영) 기준으로 계산 중이라'
                + ` 물가상승률(${inflationRate}%)을 뺀 만큼만 실제로 불어납니다.`
                + ' 0%로 두면 물가만큼 구매력이 줄어듭니다.'
              : '쓰고 남은 돈에 붙는 연 이자율입니다. 0%로 두면 이자 없이 그대로 남습니다.'
          }
          changed={changed.has('cashYieldRate')}
        >
          <NumberField
            label="" aria-label="남는 현금 수익률" step="0.1" suffixText="%"
            value={params.cashYieldRate ?? 0}
            onChangeValue={(rate) => onChangeParams({ ...params, cashYieldRate: rate })}
          />
        </FieldRow>
      )}

      {isFieldVisible(mode, 'taxSettings.comprehensiveTaxMode') && (
        <FieldRow
          label="금융소득종합과세 계산 방식"
          tooltipText="연 2천만원을 넘는 금융소득에 세금을 얼마나 더 매길지 정하는 방식입니다."
          changed={changed.has('taxSettings.comprehensiveTaxMode')}
        >
          <SelectField
            label="" aria-label="금융소득종합과세 계산 방식"
            value={tax.comprehensiveTaxMode}
            onChange={(e) => setTax({ comprehensiveTaxMode: e.target.value as ComprehensiveTaxMode })}
            options={[
              { value: 'progressive_credit', label: '비교과세 (실제 세법)' },
              { value: 'flat', label: '단순 세율 직접 지정' },
            ]}
          />
        </FieldRow>
      )}

      <div className="grid grid-cols-2 items-end gap-3.5 sm:gap-4">
        {rateField('usDividendTaxRate', '미국 배당세율',
          '해외 주식·ETF 배당에 붙는 세율입니다.')}
        {rateField('domesticDividendTaxRate', '국내 배당세율',
          '국내 주식·ETF 배당에 붙는 세율입니다.')}
        {/* 이 세율은 '단순 세율 직접 지정' 모드에서만 계산에 쓰인다. 비교과세 모드에서는
            누진세율표와 원천징수 공제로 세액이 정해지므로 여기를 고쳐도 결과가 바뀌지 않는다.
            숨기지 않고 비활성화하는 것은 바로 위 저율과세 한도 스위치와 같은 방식이다 —
            사라진 필드는 "어디 갔지"가 되고, 비활성화된 필드는 이유를 함께 읽힌다. */}
        {rateField('comprehensiveTaxRate', '금융소득종합과세 세율',
          comprehensiveTaxModeGovernsRate
            ? '비교과세 모드에서는 누진세율표를 쓰므로 이 값이 계산에 반영되지 않습니다. 계산 방식을 「단순 세율 직접 지정」으로 바꾸면 사용됩니다.'
            : '연 2천만원을 넘는 금융소득에 추가로 붙는 세율입니다.',
          comprehensiveTaxModeGovernsRate)}
        {rateField('capitalGainsTaxRate', '해외주식 양도소득세율',
          '해외 주식·ETF를 팔아 남긴 차익에 붙는 세율입니다. 연 250만원까지는 공제되고, 실제 납부는 판 다음 해에 이뤄집니다. 국내 주식·ETF의 매매차익은 비과세라 붙지 않습니다.')}
        {rateField('healthInsuranceRate', '건강보험료율',
          '기준을 넘는 소득에 추가로 붙는 건강보험료 비율입니다. 기준 소득은 금융소득과 공적연금(50% 반영)만 세며, 사적연금은 부과 대상이 아니라 빠집니다.')}

        {isFieldVisible(mode, 'taxSettings.privatePensionLimit') && (
          // 금액 입력은 한 줄을 다 쓴다. 입력 우측에는 단위와 스테퍼 자리로 5.1rem이
          // 비워져 있어(components.module.css의 inputWithSteppers), 격자 반 칸(126px)에서는
          // 1,500만원이 "15,0"까지만 보인다.
          <FieldRow
            className="col-span-2"
            label="사적연금 저율과세 한도"
            tooltipText="이 금액까지는 낮은 세율이 적용됩니다."
            changed={changed.has('taxSettings.privatePensionLimit')}
          >
            <AmountField
              label="" aria-label="사적연금 저율과세 한도" suffixText="원"
              value={tax.privatePensionLimit}
              onChangeValue={(limit) => setTax({ privatePensionLimit: limit })}
              // 구 세금 설정 화면에 있던 ±100만원 스텝 버튼. 금액이 커서 직접 타이핑하면
              // 자릿수를 틀리기 쉬운 필드라 그대로 복원한다.
              onStepUp={() => setTax({
                privatePensionLimit: tax.privatePensionLimit + PENSION_LIMIT_STEP,
              })}
              onStepDown={() => setTax({
                privatePensionLimit: Math.max(0, tax.privatePensionLimit - PENSION_LIMIT_STEP),
              })}
            />
          </FieldRow>
        )}

        {rateField('privatePensionExcessTaxRate', '사적연금 한도초과 세율',
          '저율과세 한도를 넘긴 연금소득에 붙는 세율입니다.')}
      </div>

      {isFieldVisible(mode, 'taxSettings.limitPrivatePensionToTaxLimit') && (
        <SwitchField
          label="사적연금을 저율과세 한도 내에서만 인출"
          description={
            pensionStrategyGovernsLimit
              ? '지금은 「연금 전략」의 선택이 이 값을 결정합니다. 직접 정하려면 연금 전략을 "자동으로 선택"으로 두세요.'
              : '세금이 적게 붙는 한도까지만 꺼내 씁니다. 생활비가 모자라면 다른 자산에서 채웁니다.'
          }
          tooltipTerm="irp"
          checked={limitChecked}
          onChange={(v) => setTax({ limitPrivatePensionToTaxLimit: v })}
          disabled={pensionStrategyGovernsLimit}
          changed={changed.has('taxSettings.limitPrivatePensionToTaxLimit')}
        />
      )}

      {isFieldVisible(mode, 'taxSettings.enableCapitalGainsTax') && (
        <SwitchField
          label="해외주식 양도소득세 반영"
          description="해외 주식·ETF를 팔아 생활비를 마련할 때 붙는 양도소득세를 계산에 넣습니다. 끄면 매도 차익에 세금이 붙지 않아 잔여자산이 실제보다 낙관적으로 나옵니다."
          checked={tax.enableCapitalGainsTax}
          onChange={(v) => setTax({ enableCapitalGainsTax: v })}
          changed={changed.has('taxSettings.enableCapitalGainsTax')}
        />
      )}

      {isFieldVisible(mode, 'taxSettings.enableComprehensiveTax') && (
        <SwitchField
          label="금융소득종합과세 반영"
          description="배당·이자가 연 2천만원을 넘을 때의 추가 세금을 계산에 넣습니다."
          tooltipTerm="comprehensiveTax"
          checked={tax.enableComprehensiveTax}
          onChange={(v) => setTax({ enableComprehensiveTax: v })}
          changed={changed.has('taxSettings.enableComprehensiveTax')}
        />
      )}

      {isFieldVisible(mode, 'taxSettings.enableHealthInsurance') && (
        <SwitchField
          label="건강보험료 반영"
          description="은퇴 후 소득에 따라 늘어나는 건강보험료를 계산에 넣습니다. 피부양자 자격 상실 시의 급증과 재산 부과분은 반영하지 않아 실제 부담이 더 클 수 있습니다."
          tooltipTerm="healthInsurance"
          checked={tax.enableHealthInsurance}
          onChange={(v) => setTax({ enableHealthInsurance: v })}
          changed={changed.has('taxSettings.enableHealthInsurance')}
        />
      )}

      {isFieldVisible(mode, 'taxSettings.enablePrivatePensionTax') && (
        <SwitchField
          label="사적연금 한도초과세 반영"
          description="저율과세 한도를 넘겨 인출할 때의 추가 세금을 계산에 넣습니다."
          tooltipTerm="irp"
          checked={tax.enablePrivatePensionTax}
          onChange={(v) => setTax({ enablePrivatePensionTax: v })}
          changed={changed.has('taxSettings.enablePrivatePensionTax')}
        />
      )}

      {isFieldVisible(mode, 'taxSettings.enablePensionComprehensiveComparison') && (
        <SwitchField
          label="분리과세·종합과세 유리한 쪽 선택"
          description="한도를 넘긴 연금소득에 대해 둘 중 세금이 적은 쪽으로 계산합니다."
          checked={tax.enablePensionComprehensiveComparison}
          onChange={(v) => setTax({ enablePensionComprehensiveComparison: v })}
          changed={changed.has('taxSettings.enablePensionComprehensiveComparison')}
        />
      )}
    </>
  );
}
