import { describe, test, expect } from 'vitest';
import { TAX_LAW_PROFILES, resolveTaxLawProfile } from '@/core/usecases/tax/taxLawProfiles';
import {
  DEFAULT_PRIVATE_PENSION_EXCESS_TAX_RATE,
  DEFAULT_PRIVATE_PENSION_LIMIT_KRW,
  FINANCIAL_INCOME_COMPREHENSIVE_TAX_THRESHOLD_KRW,
  ISA_ANNUAL_CONTRIBUTION_LIMIT_KRW,
  ISA_EXEMPTION_LIMIT_GENERAL_KRW,
  ISA_EXEMPTION_LIMIT_LOW_INCOME_KRW,
  ISA_MATURITY_TAX_RATE,
  KOREA_COMPREHENSIVE_INCOME_TAX_BRACKETS_2024,
  NATIONAL_PENSION_TAX_RATE,
  PRIVATE_PENSION_TAX_BRACKETS,
} from '@/core/usecases/tax/taxRates';

describe('TAX_LAW_PROFILES', () => {
  test('current 프로필이 기존 상수와 정확히 일치한다', () => {
    const p = TAX_LAW_PROFILES.current;

    expect(p.financialIncomeThresholdKRW).toBe(FINANCIAL_INCOME_COMPREHENSIVE_TAX_THRESHOLD_KRW);
    expect(p.isaAnnualLimitKRW).toBe(ISA_ANNUAL_CONTRIBUTION_LIMIT_KRW);
    expect(p.isaExemptionGeneralKRW).toBe(ISA_EXEMPTION_LIMIT_GENERAL_KRW);
    expect(p.isaExemptionLowIncomeKRW).toBe(ISA_EXEMPTION_LIMIT_LOW_INCOME_KRW);
    expect(p.isaMaturityTaxRate).toBe(ISA_MATURITY_TAX_RATE);
    expect(p.nationalPensionTaxRate).toBe(NATIONAL_PENSION_TAX_RATE);
    expect(p.privatePensionLimitKRW).toBe(DEFAULT_PRIVATE_PENSION_LIMIT_KRW);
    expect(p.privatePensionExcessTaxRate).toBe(DEFAULT_PRIVATE_PENSION_EXCESS_TAX_RATE);
    expect(p.privatePensionBrackets).toEqual(PRIVATE_PENSION_TAX_BRACKETS);
    expect(p.comprehensiveIncomeBrackets).toEqual(KOREA_COMPREHENSIVE_INCOME_TAX_BRACKETS_2024);
  });

  test('세법 버전마다 프로필이 하나씩 존재한다', () => {
    // TaxLawVersion에 값을 추가하면 Record 타입이 프로필 누락을 컴파일 타임에 잡지만,
    // 런타임에서도 빈 프로필이 아닌지 확인한다.
    for (const profile of Object.values(TAX_LAW_PROFILES)) {
      expect(profile.comprehensiveIncomeBrackets.length).toBeGreaterThan(0);
      expect(profile.privatePensionBrackets.length).toBeGreaterThan(0);
    }
  });
});

describe('resolveTaxLawProfile', () => {
  test('버전 미지정이면 current를 반환한다', () => {
    expect(resolveTaxLawProfile()).toBe(TAX_LAW_PROFILES.current);
  });

  test('current를 명시해도 같은 프로필을 반환한다', () => {
    expect(resolveTaxLawProfile('current')).toBe(TAX_LAW_PROFILES.current);
  });
});
