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
  test('current 프로필의 세율·한도가 2024년 기준 값이다', () => {
    // 값 보존의 유일한 근거는 이 리터럴들이다. taxRates.ts의 export와 비교하는 것은
    // 그쪽이 프로필에서 파생되므로 같은 참조를 비교하는 셈이라 어떤 오기도 잡지 못한다.
    // 다음 개정 프로필을 추가하다가 현행 값을 건드리면 여기서 걸린다.
    const p = TAX_LAW_PROFILES.current;

    expect(p.financialIncomeThresholdKRW).toBe(20000000);
    expect(p.isaAnnualLimitKRW).toBe(20000000);
    expect(p.isaExemptionGeneralKRW).toBe(2000000);
    expect(p.isaExemptionLowIncomeKRW).toBe(4000000);
    expect(p.isaMaturityTaxRate).toBe(0.099);
    expect(p.nationalPensionTaxRate).toBe(0.02);
    expect(p.privatePensionLimitKRW).toBe(15000000);
    expect(p.privatePensionExcessTaxRate).toBe(16.5);

    expect(p.privatePensionBrackets).toEqual([
      { minAge: 0, maxAge: 70, rate: 0.055 },
      { minAge: 70, maxAge: 80, rate: 0.044 },
      { minAge: 80, maxAge: Infinity, rate: 0.033 },
    ]);

    expect(p.comprehensiveIncomeBrackets).toEqual([
      { minKRW: 0, rate: 0.06, deductionKRW: 0 },
      { minKRW: 14000000, rate: 0.15, deductionKRW: 1260000 },
      { minKRW: 50000000, rate: 0.24, deductionKRW: 5760000 },
      { minKRW: 88000000, rate: 0.35, deductionKRW: 15440000 },
      { minKRW: 150000000, rate: 0.38, deductionKRW: 19940000 },
      { minKRW: 300000000, rate: 0.40, deductionKRW: 25940000 },
      { minKRW: 500000000, rate: 0.42, deductionKRW: 35940000 },
      { minKRW: 1000000000, rate: 0.45, deductionKRW: 65940000 },
    ]);
  });

  test('taxRates.ts의 기존 export 이름이 모두 current 프로필에서 파생된다', () => {
    // 값이 맞는지는 위 테스트가 본다. 이 테스트가 지키는 것은 "값의 단일 소스가
    // 프로필 하나"라는 구조다 — 누군가 taxRates.ts에 리터럴을 다시 하드코딩하면
    // 참조가 갈라지면서 여기서 실패한다.
    const p = TAX_LAW_PROFILES.current;

    expect(FINANCIAL_INCOME_COMPREHENSIVE_TAX_THRESHOLD_KRW).toBe(p.financialIncomeThresholdKRW);
    expect(ISA_ANNUAL_CONTRIBUTION_LIMIT_KRW).toBe(p.isaAnnualLimitKRW);
    expect(ISA_EXEMPTION_LIMIT_GENERAL_KRW).toBe(p.isaExemptionGeneralKRW);
    expect(ISA_EXEMPTION_LIMIT_LOW_INCOME_KRW).toBe(p.isaExemptionLowIncomeKRW);
    expect(ISA_MATURITY_TAX_RATE).toBe(p.isaMaturityTaxRate);
    expect(NATIONAL_PENSION_TAX_RATE).toBe(p.nationalPensionTaxRate);
    expect(DEFAULT_PRIVATE_PENSION_LIMIT_KRW).toBe(p.privatePensionLimitKRW);
    expect(DEFAULT_PRIVATE_PENSION_EXCESS_TAX_RATE).toBe(p.privatePensionExcessTaxRate);
    // 배열은 같은 인스턴스여야 한다(복사본이면 한쪽만 수정되는 사고가 가능해진다).
    expect(PRIVATE_PENSION_TAX_BRACKETS).toBe(p.privatePensionBrackets);
    expect(KOREA_COMPREHENSIVE_INCOME_TAX_BRACKETS_2024).toBe(p.comprehensiveIncomeBrackets);
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
