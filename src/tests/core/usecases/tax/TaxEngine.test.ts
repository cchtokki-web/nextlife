import { describe, test, expect } from 'vitest';
import {
  getDividendTaxRate,
  getPrivatePensionIncomeTaxRate,
  calculateNationalPensionTaxKRW,
  getIsaExemptionLimitKRW,
  calculateIsaMaturityTax,
  calculateComprehensiveTaxAndHealthInsuranceKRW,
  calculatePrivatePensionExcessTaxNeededKRW,
} from '@/core/usecases/tax/TaxEngine';
import { TaxSettings } from '@/core/entities/types';

const baseTaxSettings: TaxSettings = {
  enableComprehensiveTax: true,
  enableHealthInsurance: true,
  usDividendTaxRate: 15,
  domesticDividendTaxRate: 15.4,
  comprehensiveTaxRate: 15,
  healthInsuranceRate: 5,
  enablePrivatePensionTax: true,
  privatePensionLimit: 15000000,
  privatePensionExcessTaxRate: 16.5,
};

describe('getDividendTaxRate', () => {
  test('US_ETF 시장은 usDividendTaxRate를 사용한다', () => {
    expect(getDividendTaxRate('US_ETF', 'USD', baseTaxSettings)).toBeCloseTo(0.15);
  });

  test('KR_ETF 시장은 domesticDividendTaxRate를 사용한다', () => {
    expect(getDividendTaxRate('KR_ETF', 'KRW', baseTaxSettings)).toBeCloseTo(0.154);
  });

  test('market 미지정 시 통화 기준으로 폴백한다 (USD -> US_ETF, KRW -> KR_ETF)', () => {
    expect(getDividendTaxRate(undefined, 'USD', baseTaxSettings)).toBeCloseTo(0.15);
    expect(getDividendTaxRate(undefined, 'KRW', baseTaxSettings)).toBeCloseTo(0.154);
  });

  test('IRP/PENSION/OTHER 등 배당세 대상이 아닌 시장은 0을 반환한다', () => {
    expect(getDividendTaxRate('IRP', 'KRW', baseTaxSettings)).toBe(0);
    expect(getDividendTaxRate('OTHER', 'KRW', baseTaxSettings)).toBe(0);
  });
});

describe('getPrivatePensionIncomeTaxRate', () => {
  test('55~69세는 5.5%', () => {
    expect(getPrivatePensionIncomeTaxRate(55)).toBeCloseTo(0.055);
    expect(getPrivatePensionIncomeTaxRate(69)).toBeCloseTo(0.055);
  });

  test('70~79세는 4.4%', () => {
    expect(getPrivatePensionIncomeTaxRate(70)).toBeCloseTo(0.044);
    expect(getPrivatePensionIncomeTaxRate(79)).toBeCloseTo(0.044);
  });

  test('80세 이상은 3.3%', () => {
    expect(getPrivatePensionIncomeTaxRate(80)).toBeCloseTo(0.033);
    expect(getPrivatePensionIncomeTaxRate(100)).toBeCloseTo(0.033);
  });
});

describe('calculateNationalPensionTaxKRW', () => {
  test('세전액의 2%를 세금으로 반환한다', () => {
    expect(calculateNationalPensionTaxKRW(1000000)).toBeCloseTo(20000);
  });
});

describe('getIsaExemptionLimitKRW', () => {
  test('일반형은 200만원', () => {
    expect(getIsaExemptionLimitKRW('general')).toBe(2000000);
  });
  test('서민형은 400만원', () => {
    expect(getIsaExemptionLimitKRW('low_income')).toBe(4000000);
  });
});

describe('calculateIsaMaturityTax', () => {
  test('수익이 비과세 한도 이하이면 세금 0', () => {
    expect(calculateIsaMaturityTax(1500000, 2000000)).toBe(0);
  });
  test('수익이 없거나 손실이면 세금 0', () => {
    expect(calculateIsaMaturityTax(-500000, 2000000)).toBe(0);
    expect(calculateIsaMaturityTax(0, 2000000)).toBe(0);
  });
  test('한도 초과분에 9.9% 분리과세', () => {
    // 500만원 수익, 200만원 한도 -> 300만원 * 9.9%
    expect(calculateIsaMaturityTax(5000000, 2000000)).toBeCloseTo(3000000 * 0.099);
  });
});

describe('calculateComprehensiveTaxAndHealthInsuranceKRW', () => {
  test('금융소득이 2천만원 이하이면 세금·건보료 모두 0', () => {
    const result = calculateComprehensiveTaxAndHealthInsuranceKRW(20000000, baseTaxSettings);
    expect(result.comprehensiveTaxKRW).toBe(0);
    expect(result.healthInsuranceKRW).toBe(0);
  });

  test('2천만원 초과분에 대해 종합과세율·건보료율을 각각 적용한다', () => {
    // 3천만원 -> 초과분 1천만원
    const result = calculateComprehensiveTaxAndHealthInsuranceKRW(30000000, baseTaxSettings);
    expect(result.comprehensiveTaxKRW).toBeCloseTo(10000000 * 0.15);
    expect(result.healthInsuranceKRW).toBeCloseTo(10000000 * 0.05);
  });

  test('enableComprehensiveTax가 false면 초과해도 세금·건보료 모두 0', () => {
    const result = calculateComprehensiveTaxAndHealthInsuranceKRW(30000000, {
      ...baseTaxSettings,
      enableComprehensiveTax: false,
    });
    expect(result.comprehensiveTaxKRW).toBe(0);
    expect(result.healthInsuranceKRW).toBe(0);
  });

  test('enableHealthInsurance가 false면 종합과세만 부과되고 건보료는 0', () => {
    const result = calculateComprehensiveTaxAndHealthInsuranceKRW(30000000, {
      ...baseTaxSettings,
      enableHealthInsurance: false,
    });
    expect(result.comprehensiveTaxKRW).toBeCloseTo(10000000 * 0.15);
    expect(result.healthInsuranceKRW).toBe(0);
  });
});

describe('calculatePrivatePensionExcessTaxNeededKRW', () => {
  test('저율과세 한도 이하이면 0', () => {
    expect(calculatePrivatePensionExcessTaxNeededKRW(15000000, baseTaxSettings)).toBe(0);
  });

  test('한도 초과 시 전체 세전 인출액에 초과세율을 적용한 총 필요세액을 반환한다', () => {
    expect(calculatePrivatePensionExcessTaxNeededKRW(20000000, baseTaxSettings)).toBeCloseTo(20000000 * 0.165);
  });

  test('enablePrivatePensionTax가 false면 0', () => {
    expect(
      calculatePrivatePensionExcessTaxNeededKRW(20000000, { ...baseTaxSettings, enablePrivatePensionTax: false })
    ).toBe(0);
  });
});
