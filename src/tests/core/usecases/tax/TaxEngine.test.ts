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
import { resolveTaxContext } from '@/core/usecases/tax/taxContext';
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

// TaxEngine의 모든 함수는 TaxContext(세법 프로필 + 사용자 설정)를 받는다.
// 프로필은 항상 현행(TaxLawVersion 기본값)이고, 테스트가 바꾸고 싶은 것은 설정 쪽뿐이다.
const ctx = (overrides: Partial<TaxSettings> = {}) =>
  resolveTaxContext({ ...baseTaxSettings, ...overrides });
const baseCtx = ctx();

describe('getDividendTaxRate', () => {
  test('US_ETF 시장은 usDividendTaxRate를 사용한다', () => {
    expect(getDividendTaxRate('US_ETF', 'USD', baseCtx)).toBeCloseTo(0.15);
  });

  test('KR_ETF 시장은 domesticDividendTaxRate를 사용한다', () => {
    expect(getDividendTaxRate('KR_ETF', 'KRW', baseCtx)).toBeCloseTo(0.154);
  });

  test('market 미지정 시 통화 기준으로 폴백한다 (USD -> US_ETF, KRW -> KR_ETF)', () => {
    expect(getDividendTaxRate(undefined, 'USD', baseCtx)).toBeCloseTo(0.15);
    expect(getDividendTaxRate(undefined, 'KRW', baseCtx)).toBeCloseTo(0.154);
  });

  test('IRP/PENSION/OTHER 등 배당세 대상이 아닌 시장은 0을 반환한다', () => {
    expect(getDividendTaxRate('IRP', 'KRW', baseCtx)).toBe(0);
    expect(getDividendTaxRate('OTHER', 'KRW', baseCtx)).toBe(0);
  });
});

describe('getPrivatePensionIncomeTaxRate', () => {
  test('55~69세는 5.5%', () => {
    expect(getPrivatePensionIncomeTaxRate(55, baseCtx)).toBeCloseTo(0.055);
    expect(getPrivatePensionIncomeTaxRate(69, baseCtx)).toBeCloseTo(0.055);
  });

  test('70~79세는 4.4%', () => {
    expect(getPrivatePensionIncomeTaxRate(70, baseCtx)).toBeCloseTo(0.044);
    expect(getPrivatePensionIncomeTaxRate(79, baseCtx)).toBeCloseTo(0.044);
  });

  test('80세 이상은 3.3%', () => {
    expect(getPrivatePensionIncomeTaxRate(80, baseCtx)).toBeCloseTo(0.033);
    expect(getPrivatePensionIncomeTaxRate(100, baseCtx)).toBeCloseTo(0.033);
  });
});

describe('calculateNationalPensionTaxKRW', () => {
  // 세율표·손계산 검증은 pensionIncomeTaxGolden.test.ts에 있다. 여기서는 계약만 고정한다:
  // 인자는 **연간** 수령액이고, 세액은 연금소득공제와 누진세율을 거쳐 나온다.
  test('연간 수령액을 받아 연금소득공제 후 누진세율로 과세한다', () => {
    // 연 600만원은 공제(450만)와 기본공제(150만)만으로 과세표준이 0이 된다.
    expect(calculateNationalPensionTaxKRW(6000000, baseCtx)).toBe(0);
    // 연 1,200만원부터는 세금이 발생한다.
    expect(calculateNationalPensionTaxKRW(12000000, baseCtx)).toBeGreaterThan(0);
  });

  test('수령액이 커질수록 실효세율이 올라간다 (고정 세율이 아니다)', () => {
    const rateAt = (annual: number) => calculateNationalPensionTaxKRW(annual, baseCtx) / annual;
    expect(rateAt(36000000)).toBeGreaterThan(rateAt(12000000));
  });
});

describe('getIsaExemptionLimitKRW', () => {
  test('일반형은 200만원', () => {
    expect(getIsaExemptionLimitKRW('general', baseCtx)).toBe(2000000);
  });
  test('서민형은 400만원', () => {
    expect(getIsaExemptionLimitKRW('low_income', baseCtx)).toBe(4000000);
  });
});

describe('calculateIsaMaturityTax', () => {
  test('수익이 비과세 한도 이하이면 세금 0', () => {
    expect(calculateIsaMaturityTax(1500000, 2000000, baseCtx)).toBe(0);
  });
  test('수익이 없거나 손실이면 세금 0', () => {
    expect(calculateIsaMaturityTax(-500000, 2000000, baseCtx)).toBe(0);
    expect(calculateIsaMaturityTax(0, 2000000, baseCtx)).toBe(0);
  });
  test('한도 초과분에 9.9% 분리과세', () => {
    // 500만원 수익, 200만원 한도 -> 300만원 * 9.9%
    expect(calculateIsaMaturityTax(5000000, 2000000, baseCtx)).toBeCloseTo(3000000 * 0.099);
  });
});

describe('getComprehensiveIncomeTaxKRW', () => {
  test('과세표준 0이면 0', () => {
    expect(getComprehensiveIncomeTaxKRW(0, baseCtx)).toBe(0);
  });

  test('1,400만원 이하 구간: 6%, 공제 없음', () => {
    expect(getComprehensiveIncomeTaxKRW(10000000, baseCtx)).toBeCloseTo(600000);
  });

  test('1,400만원 초과 ~5,000만원 이하 구간: 15%, 누진공제 126만원', () => {
    // 30,000,000 * 0.15 - 1,260,000 = 3,240,000
    expect(getComprehensiveIncomeTaxKRW(30000000, baseCtx)).toBeCloseTo(3240000);
  });

  test('구간 경계값(정확히 1,400만원)은 하위 구간(6%) 적용', () => {
    expect(getComprehensiveIncomeTaxKRW(14000000, baseCtx)).toBeCloseTo(14000000 * 0.06);
  });

  test('10억 초과 구간: 45%, 누진공제 6,594만원', () => {
    expect(getComprehensiveIncomeTaxKRW(1200000000, baseCtx)).toBeCloseTo(1200000000 * 0.45 - 65940000);
  });

  test('음수 입력 시 InvalidTaxInputError', () => {
    expect(() => getComprehensiveIncomeTaxKRW(-1, baseCtx)).toThrow(InvalidTaxInputError);
  });
});

describe('calculateComprehensiveTaxAndHealthInsuranceKRW', () => {
  // 원천징수액은 전액 국내 배당(15.4%)이라고 가정한다. 비교과세의 기납부세액 공제에 쓰인다.
  const basis = (financial: number, pension: number = 0) => ({
    annualRawFinancialIncomeKRW: financial,
    annualRawPensionIncomeKRW: pension,
    annualWithheldFinancialTaxKRW: financial * 0.154,
  });

  test('금융소득이 2천만원 이하, 연금소득 없음이면 세금·건보료 모두 0', () => {
    const result = calculateComprehensiveTaxAndHealthInsuranceKRW(basis(20000000), baseCtx);
    expect(result.comprehensiveTaxKRW).toBe(0);
    expect(result.healthInsuranceKRW).toBe(0);
  });

  test('flat 모드에서는 2천만원 초과분에 지정 세율을 그대로 적용한다 (연금소득 0)', () => {
    // 3천만원 -> 초과분 1천만원.
    // 기본 모드(progressive_credit)에서는 원천징수액을 공제해 추가 납부가 0이 된다
    // (comprehensiveTaxGolden.test.ts 참고). 여기서는 예전 단순 모델의 계약을 고정한다.
    const result = calculateComprehensiveTaxAndHealthInsuranceKRW(
      basis(30000000),
      ctx({ comprehensiveTaxMode: 'flat' })
    );
    expect(result.comprehensiveTaxKRW).toBeCloseTo(10000000 * 0.15);
    expect(result.healthInsuranceKRW).toBeCloseTo(10000000 * 0.05);
  });

  test('건보료율은 모드와 무관하게 초과분에 그대로 적용된다', () => {
    const result = calculateComprehensiveTaxAndHealthInsuranceKRW(basis(30000000), baseCtx);
    expect(result.healthInsuranceKRW).toBeCloseTo(10000000 * 0.05);
  });

  test('금융소득 단독으로는 기준 이하지만, 연금소득을 합산하면 건보료만 발생(종합과세는 0)', () => {
    // 금융소득 1,000만원(기준 이하) + 연금소득 1,500만원 = 합산 2,500만원 -> 초과 500만원
    const result = calculateComprehensiveTaxAndHealthInsuranceKRW(basis(10000000, 15000000), baseCtx);
    expect(result.comprehensiveTaxKRW).toBe(0); // 종합과세 판정은 금융소득만 사용
    expect(result.healthInsuranceKRW).toBeCloseTo(5000000 * 0.05);
  });

  test('금융소득+연금소득 합산도 기준 이하면 둘 다 0', () => {
    const result = calculateComprehensiveTaxAndHealthInsuranceKRW(basis(5000000, 5000000), baseCtx);
    expect(result.comprehensiveTaxKRW).toBe(0);
    expect(result.healthInsuranceKRW).toBe(0);
  });

  test('enableComprehensiveTax가 false면 연금소득 합산으로 건보료 기준을 넘어도 둘 다 0 (마스터 스위치)', () => {
    const result = calculateComprehensiveTaxAndHealthInsuranceKRW(basis(10000000, 15000000), ctx({ enableComprehensiveTax: false }));
    expect(result.comprehensiveTaxKRW).toBe(0);
    expect(result.healthInsuranceKRW).toBe(0);
  });

  test('enableHealthInsurance가 false면 건보료만 0, 종합과세는 정상 부과', () => {
    // 기본 모드에서 추가 납부가 실제로 발생하는 규모(1억)로 잡는다 — 3천만원이면
    // 원천징수 공제로 0이 되어 "정상 부과"를 확인할 수 없다.
    const result = calculateComprehensiveTaxAndHealthInsuranceKRW(basis(100000000, 10000000), ctx({ enableHealthInsurance: false }));
    expect(result.comprehensiveTaxKRW).toBeGreaterThan(0);
    expect(result.healthInsuranceKRW).toBe(0);
  });

  test('음수 입력 시 InvalidTaxInputError', () => {
    expect(() => calculateComprehensiveTaxAndHealthInsuranceKRW(basis(-1), baseCtx)).toThrow(
      InvalidTaxInputError
    );
  });
});

describe('calculatePrivatePensionExcessTaxNeededKRW', () => {
  test('저율과세 한도 이하이면 0, method는 none', () => {
    const r = calculatePrivatePensionExcessTaxNeededKRW(15000000, baseCtx);
    expect(r.taxKRW).toBe(0);
    expect(r.method).toBe('none');
  });

  test('한도 초과 & 종합소득세가 더 유리하면 종합과세(누진세율) 선택', () => {
    // 분리과세: 20,000,000 × 16.5%                    = 3,300,000
    // 종합과세: 연금소득공제 6,900,000 + 기본공제 1,500,000을 뺀
    //           과세표준 11,600,000 × 6% × 1.1(지방세) =   765,600  (더 유리)
    // (손계산 상세는 pensionIncomeTaxGolden.test.ts 참고)
    const r = calculatePrivatePensionExcessTaxNeededKRW(20000000, baseCtx);
    expect(r.taxKRW).toBeCloseTo(765600, -2);
    expect(r.method).toBe('comprehensive');
  });

  test('한도 초과 & 고액 구간에서는 누진세율(최고 45%)이 항상 불리하므로 분리과세 선택', () => {
    const r = calculatePrivatePensionExcessTaxNeededKRW(500000000, baseCtx);
    expect(r.taxKRW).toBeCloseTo(500000000 * 0.165);
    expect(r.method).toBe('separate');
  });

  test('enablePensionComprehensiveComparison=false면 비교 없이 항상 분리과세', () => {
    const r = calculatePrivatePensionExcessTaxNeededKRW(20000000, ctx({ enablePensionComprehensiveComparison: false }));
    expect(r.taxKRW).toBeCloseTo(20000000 * 0.165);
    expect(r.method).toBe('separate');
  });

  test('enablePrivatePensionTax가 false면 0, method는 none', () => {
    const r = calculatePrivatePensionExcessTaxNeededKRW(20000000, ctx({ enablePrivatePensionTax: false }));
    expect(r.taxKRW).toBe(0);
    expect(r.method).toBe('none');
  });

  test('음수 입력 시 InvalidTaxInputError', () => {
    expect(() => calculatePrivatePensionExcessTaxNeededKRW(-1, baseCtx)).toThrow(InvalidTaxInputError);
  });
});
