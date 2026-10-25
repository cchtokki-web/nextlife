import { describe, test, expect } from 'vitest';
import { DEFAULT_TAX_SETTINGS, resolveTaxSettings } from '@/core/usecases/tax/taxRates';

describe('resolveTaxSettings', () => {
  test('인자가 없으면 DEFAULT_TAX_SETTINGS를 그대로 반환한다', () => {
    expect(resolveTaxSettings()).toEqual(DEFAULT_TAX_SETTINGS);
  });

  test('부분 override는 지정된 필드만 바꾸고 나머지는 기본값을 유지한다', () => {
    const resolved = resolveTaxSettings({ limitPrivatePensionToTaxLimit: true, healthInsuranceRate: 7 });

    expect(resolved.limitPrivatePensionToTaxLimit).toBe(true);
    expect(resolved.healthInsuranceRate).toBe(7);
    expect(resolved.enableComprehensiveTax).toBe(DEFAULT_TAX_SETTINGS.enableComprehensiveTax);
    expect(resolved.privatePensionLimit).toBe(DEFAULT_TAX_SETTINGS.privatePensionLimit);
  });

  test('모든 필드가 항상 채워진다 (Required<TaxSettings>)', () => {
    const resolved = resolveTaxSettings({});
    const keys: (keyof typeof resolved)[] = [
      'enableComprehensiveTax', 'enableHealthInsurance', 'usDividendTaxRate', 'domesticDividendTaxRate',
      'comprehensiveTaxRate', 'healthInsuranceRate', 'enablePrivatePensionTax', 'privatePensionLimit',
      'privatePensionExcessTaxRate', 'limitPrivatePensionToTaxLimit', 'enablePensionComprehensiveComparison',
    ];
    keys.forEach((key) => expect(resolved[key]).not.toBeUndefined());
  });
});
