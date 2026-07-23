import { describe, test, expect } from 'vitest';
import {
  getDividendTaxRate,
  getPrivatePensionIncomeTaxRate,
  calculateNationalPensionTaxKRW,
  getIsaExemptionLimitKRW,
  calculateIsaMaturityTax,
  calculateComprehensiveTaxAndHealthInsuranceKRW,
  calculatePrivatePensionExcessTaxNeededKRW,
  getComprehensiveIncomeTaxKRW,
} from '@/core/usecases/tax/TaxEngine';
import { TaxSettings } from '@/core/entities/types';
import { InvalidTaxInputError } from '@/core/entities/errors';

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

describe('getComprehensiveIncomeTaxKRW', () => {
  test('과세표준 0이면 0', () => {
    expect(getComprehensiveIncomeTaxKRW(0)).toBe(0);
  });

  test('1,400만원 이하 구간: 6%, 공제 없음', () => {
    expect(getComprehensiveIncomeTaxKRW(10000000)).toBeCloseTo(600000);
  });

  test('1,400만원 초과 ~5,000만원 이하 구간: 15%, 누진공제 126만원', () => {
    // 30,000,000 * 0.15 - 1,260,000 = 3,240,000
    expect(getComprehensiveIncomeTaxKRW(30000000)).toBeCloseTo(3240000);
  });

  test('구간 경계값(정확히 1,400만원)은 하위 구간(6%) 적용', () => {
    expect(getComprehensiveIncomeTaxKRW(14000000)).toBeCloseTo(14000000 * 0.06);
  });

  test('10억 초과 구간: 45%, 누진공제 6,594만원', () => {
    expect(getComprehensiveIncomeTaxKRW(1200000000)).toBeCloseTo(1200000000 * 0.45 - 65940000);
  });

  test('음수 입력 시 InvalidTaxInputError', () => {
    expect(() => getComprehensiveIncomeTaxKRW(-1)).toThrow(InvalidTaxInputError);
  });
});

describe('calculateComprehensiveTaxAndHealthInsuranceKRW', () => {
  const basis = (financial: number, pension: number = 0) => ({
    annualRawFinancialIncomeKRW: financial,
    annualRawPensionIncomeKRW: pension,
  });

  test('금융소득이 2천만원 이하, 연금소득 없음이면 세금·건보료 모두 0', () => {
    const result = calculateComprehensiveTaxAndHealthInsuranceKRW(basis(20000000), baseTaxSettings);
    expect(result.comprehensiveTaxKRW).toBe(0);
    expect(result.healthInsuranceKRW).toBe(0);
  });

  test('2천만원 초과분에 대해 종합과세율·건보료율을 각각 적용한다 (연금소득 0)', () => {
    // 3천만원 -> 초과분 1천만원
    const result = calculateComprehensiveTaxAndHealthInsuranceKRW(basis(30000000), baseTaxSettings);
    expect(result.comprehensiveTaxKRW).toBeCloseTo(10000000 * 0.15);
    expect(result.healthInsuranceKRW).toBeCloseTo(10000000 * 0.05);
  });

  test('금융소득 단독으로는 기준 이하지만, 연금소득을 합산하면 건보료만 발생(종합과세는 0)', () => {
    // 금융소득 1,000만원(기준 이하) + 연금소득 1,500만원 = 합산 2,500만원 -> 초과 500만원
    const result = calculateComprehensiveTaxAndHealthInsuranceKRW(basis(10000000, 15000000), baseTaxSettings);
    expect(result.comprehensiveTaxKRW).toBe(0); // 종합과세 판정은 금융소득만 사용
    expect(result.healthInsuranceKRW).toBeCloseTo(5000000 * 0.05);
  });

  test('금융소득+연금소득 합산도 기준 이하면 둘 다 0', () => {
    const result = calculateComprehensiveTaxAndHealthInsuranceKRW(basis(5000000, 5000000), baseTaxSettings);
    expect(result.comprehensiveTaxKRW).toBe(0);
    expect(result.healthInsuranceKRW).toBe(0);
  });

  test('enableComprehensiveTax가 false면 연금소득 합산으로 건보료 기준을 넘어도 둘 다 0 (마스터 스위치)', () => {
    const result = calculateComprehensiveTaxAndHealthInsuranceKRW(basis(10000000, 15000000), {
      ...baseTaxSettings,
      enableComprehensiveTax: false,
    });
    expect(result.comprehensiveTaxKRW).toBe(0);
    expect(result.healthInsuranceKRW).toBe(0);
  });

  test('enableHealthInsurance가 false면 건보료만 0, 종합과세는 정상 부과', () => {
    const result = calculateComprehensiveTaxAndHealthInsuranceKRW(basis(30000000, 10000000), {
      ...baseTaxSettings,
      enableHealthInsurance: false,
    });
    expect(result.comprehensiveTaxKRW).toBeCloseTo(10000000 * 0.15);
    expect(result.healthInsuranceKRW).toBe(0);
  });

  test('음수 입력 시 InvalidTaxInputError', () => {
    expect(() => calculateComprehensiveTaxAndHealthInsuranceKRW(basis(-1), baseTaxSettings)).toThrow(
      InvalidTaxInputError
    );
  });
});

describe('calculatePrivatePensionExcessTaxNeededKRW', () => {
  test('저율과세 한도 이하이면 0, method는 none', () => {
    const r = calculatePrivatePensionExcessTaxNeededKRW(15000000, baseTaxSettings);
    expect(r.taxKRW).toBe(0);
    expect(r.method).toBe('none');
  });

  test('한도 초과 & 종합소득세가 더 유리하면 종합과세(누진세율) 선택', () => {
    // 분리과세: 20,000,000 * 16.5% = 3,300,000
    // 종합과세: 20,000,000 * 15% - 1,260,000 = 1,740,000 (더 유리)
    const r = calculatePrivatePensionExcessTaxNeededKRW(20000000, baseTaxSettings);
    expect(r.taxKRW).toBeCloseTo(1740000);
    expect(r.method).toBe('comprehensive');
  });

  test('한도 초과 & 고액 구간에서는 누진세율(최고 45%)이 항상 불리하므로 분리과세 선택', () => {
    const r = calculatePrivatePensionExcessTaxNeededKRW(500000000, baseTaxSettings);
    expect(r.taxKRW).toBeCloseTo(500000000 * 0.165);
    expect(r.method).toBe('separate');
  });

  test('enablePensionComprehensiveComparison=false면 비교 없이 항상 분리과세', () => {
    const r = calculatePrivatePensionExcessTaxNeededKRW(20000000, {
      ...baseTaxSettings,
      enablePensionComprehensiveComparison: false,
    });
    expect(r.taxKRW).toBeCloseTo(20000000 * 0.165);
    expect(r.method).toBe('separate');
  });

  test('enablePrivatePensionTax가 false면 0, method는 none', () => {
    const r = calculatePrivatePensionExcessTaxNeededKRW(20000000, {
      ...baseTaxSettings,
      enablePrivatePensionTax: false,
    });
    expect(r.taxKRW).toBe(0);
    expect(r.method).toBe('none');
  });

  test('음수 입력 시 InvalidTaxInputError', () => {
    expect(() => calculatePrivatePensionExcessTaxNeededKRW(-1, baseTaxSettings)).toThrow(InvalidTaxInputError);
  });
});
