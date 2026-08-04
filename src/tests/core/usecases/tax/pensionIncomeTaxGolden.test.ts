import { describe, test, expect } from 'vitest';
import {
  getPensionIncomeDeductionKRW,
  calculatePensionIncomeTaxKRW,
  calculateNationalPensionTaxKRW,
  calculatePrivatePensionExcessTaxNeededKRW,
} from '@/core/usecases/tax/TaxEngine';
import { resolveTaxContext } from '@/core/usecases/tax/taxContext';

// 연금소득 종합과세 골든 테스트.
//
// 세법 근거:
//   연금소득공제(소득세법 §47의2)
//     350만원 이하    → 전액
//     350만 ~ 700만   → 350만 + 초과분 × 40%
//     700만 ~ 1,400만 → 490만 + 초과분 × 20%
//     1,400만 초과    → 630만 + 초과분 × 10%   (한도 900만원)
//   과세표준 = 총연금액 − 연금소득공제 − 종합소득 기본공제(150만원)
//   세액 = 누진세(과세표준) × 1.1 (지방소득세 포함)
//
// 공제는 공적연금 + 사적연금을 **합산한** 총연금액에 한 번만 적용된다. 각각 따로 적용하면
// 공제를 두 번 주게 되어 예전의 고정 세율 모델보다 오히려 더 틀린다.

const ctx = resolveTaxContext();

describe('연금소득공제', () => {
  test('350만원 이하는 전액 공제되어 과세표준이 0이다', () => {
    expect(getPensionIncomeDeductionKRW(3_000_000, ctx)).toBeCloseTo(3_000_000);
    expect(calculatePensionIncomeTaxKRW(3_000_000, ctx)).toBe(0);
  });

  test('연 1,200만원 → 공제 590만원', () => {
    // 700만 구간: 490만 + (1,200만 − 700만) × 20% = 490만 + 100만 = 590만
    expect(getPensionIncomeDeductionKRW(12_000_000, ctx)).toBeCloseTo(5_900_000);
  });

  test('연 3,600만원 → 공제 850만원', () => {
    // 1,400만 구간: 630만 + (3,600만 − 1,400만) × 10% = 630만 + 220만 = 850만
    expect(getPensionIncomeDeductionKRW(36_000_000, ctx)).toBeCloseTo(8_500_000);
  });

  test('공제는 900만원을 넘지 못한다', () => {
    // 1억: 630만 + (1억 − 1,400만) × 10% = 630만 + 860만 = 1,490만 → 한도 900만으로 잘림
    expect(getPensionIncomeDeductionKRW(100_000_000, ctx)).toBe(9_000_000);
  });
});

describe('국민연금 소득세 — 수령액에 따라 실효세율이 달라진다', () => {
  test('월 100만원(연 1,200만) → 세액 약 30.4만원, 실효 약 2.5%', () => {
    // 공제:      590만
    // 과세표준:  1,200만 − 590만 − 150만 = 460만
    // 누진세:    460만 × 6%              = 27.6만   (1,400만 이하 구간)
    // 지방세:    27.6만 × 1.1            = 30.36만
    const tax = calculateNationalPensionTaxKRW(12_000_000, ctx);

    expect(tax).toBeCloseTo(303_600, -2);
    expect(tax / 12_000_000).toBeCloseTo(0.0253, 3);
  });

  test('월 300만원(연 3,600만) → 세액 약 290만원, 실효 약 8.1%', () => {
    // 공제:      850만
    // 과세표준:  3,600만 − 850만 − 150만 = 2,600만
    // 누진세:    2,600만 × 15% − 126만   = 264만    (1,400만 초과 ~ 5,000만 이하 구간)
    // 지방세:    264만 × 1.1             = 290.4만
    const tax = calculateNationalPensionTaxKRW(36_000_000, ctx);

    expect(tax).toBeCloseTo(2_904_000, -2);
    expect(tax / 36_000_000).toBeCloseTo(0.0807, 3);
  });

  test('월 50만원(연 600만)은 공제만으로 과세표준이 0이 되어 비과세다', () => {
    // 공제: 350만 + (600만 − 350만) × 40% = 450만
    // 과세표준: 600만 − 450만 − 150만 = 0
    expect(calculateNationalPensionTaxKRW(6_000_000, ctx)).toBe(0);
  });

  // 이것이 이 작업의 핵심이다. 예전 고정 2% 모델에서는 실효세율이 수령액과 무관하게
  // 같았고, 그래서 연기수령으로 연금액이 36% 늘 때의 세부담 증가가 과소평가됐다.
  // 이 앱은 국민연금 개시 나이를 최적화해 추천하므로 그 왜곡이 권고 자체를 바꾼다.
  test('수령액이 커질수록 실효세율이 올라간다 (고정 세율 모델에서는 불가능했던 성질)', () => {
    const rates = [6_000_000, 12_000_000, 24_000_000, 36_000_000, 60_000_000].map(
      (annual) => calculateNationalPensionTaxKRW(annual, ctx) / annual
    );

    for (let i = 1; i < rates.length; i++) {
      expect(rates[i]).toBeGreaterThan(rates[i - 1]);
    }
  });
});

describe('사적연금 한도초과세 — 국민연금과 합산해 증분으로 계산한다', () => {
  test('국민연금이 있으면 사적연금분 종합과세액이 더 커진다 (누진 구간이 이미 채워져 있으므로)', () => {
    const privateAmount = 20_000_000;

    const alone = calculatePrivatePensionExcessTaxNeededKRW(privateAmount, ctx, 0);
    const withNational = calculatePrivatePensionExcessTaxNeededKRW(privateAmount, ctx, 24_000_000);

    // 둘 다 분리과세(16.5%)와 비교해 유리한 쪽을 고르므로, 합산 시 종합과세가 불리해져
    // 분리과세로 넘어가거나 세액이 커진다. 어느 쪽이든 단독 계산보다 작아질 수는 없다.
    expect(withNational.taxKRW).toBeGreaterThanOrEqual(alone.taxKRW);
  });

  test('국민연금 없이 사적연금 2,000만원 — 공제 후 종합과세가 분리과세보다 유리하다', () => {
    // 분리과세:  2,000만 × 16.5%                       = 330만
    // 종합과세:  공제 690만 (630만 + 600만×10%)
    //            과세표준 2,000만 − 690만 − 150만      = 1,160만
    //            누진세 1,160만 × 6%                   = 69.6만
    //            지방세 포함 69.6만 × 1.1              = 76.56만  → 종합과세 선택
    const r = calculatePrivatePensionExcessTaxNeededKRW(20_000_000, ctx, 0);

    expect(r.method).toBe('comprehensive');
    expect(r.taxKRW).toBeCloseTo(765_600, -2);
  });

  test('저율과세 한도(1,500만원) 이하이면 초과세가 없다', () => {
    const r = calculatePrivatePensionExcessTaxNeededKRW(15_000_000, ctx, 24_000_000);
    expect(r.taxKRW).toBe(0);
    expect(r.method).toBe('none');
  });

  test('고액 구간에서는 누진세율이 불리해 분리과세를 고른다', () => {
    const r = calculatePrivatePensionExcessTaxNeededKRW(500_000_000, ctx, 0);
    expect(r.method).toBe('separate');
    expect(r.taxKRW).toBeCloseTo(500_000_000 * 0.165);
  });

  test('공제가 두 번 적용되지 않는다 — 합산 세액은 각각 따로 계산한 합보다 크다', () => {
    const national = 24_000_000;
    const priv = 20_000_000;

    const combined = calculatePensionIncomeTaxKRW(national + priv, ctx);
    const separateSum =
      calculatePensionIncomeTaxKRW(national, ctx) + calculatePensionIncomeTaxKRW(priv, ctx);

    // 따로 계산하면 연금소득공제와 기본공제를 두 번씩 받는다.
    expect(combined).toBeGreaterThan(separateSum);
  });
});
