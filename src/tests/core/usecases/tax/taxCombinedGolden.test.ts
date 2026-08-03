import { describe, test, expect } from 'vitest';
import {
  calculateComprehensiveTaxAndHealthInsuranceKRW,
  calculateNationalPensionTaxKRW,
  calculatePrivatePensionExcessTaxNeededKRW,
  calculateCapitalGainsTaxKRW,
} from '@/core/usecases/tax/TaxEngine';
import { resolveTaxContext } from '@/core/usecases/tax/taxContext';

// 여러 소득이 한 해에 겹칠 때의 총 세부담. 항목별 골든 테스트는 각자 한 규칙만 겨냥하므로,
// 규칙들이 서로 간섭하는 지점(공제 중복, 과세표준 공유, 기준액 분리)은 이 파일이 잡는다.
//
// 특히 세 가지 간섭을 확인한다:
//   1. 연금소득공제·기본공제가 국민연금과 사적연금에 **한 번만** 적용되는가
//   2. 건보료 기준액이 금융소득 + 공적연금×50%만 세고 사적연금은 빼는가
//   3. 금융소득종합과세가 연금소득에 영향받지 않는가(별도 과세 체계)

const ctx = resolveTaxContext();

describe('복합 케이스 — 배당 3,000만 + 국민연금 1,200만 + 사적연금 2,000만 + 해외ETF 차익 2,000만', () => {
  const DIVIDEND = 30_000_000;
  const NATIONAL_PENSION = 12_000_000;
  const PRIVATE_PENSION = 20_000_000;
  const CAPITAL_GAIN = 20_000_000;

  const withholding = DIVIDEND * 0.154;
  const comprehensiveAndHealth = calculateComprehensiveTaxAndHealthInsuranceKRW(
    {
      annualRawFinancialIncomeKRW: DIVIDEND,
      annualPublicPensionIncomeKRW: NATIONAL_PENSION,
      annualWithheldFinancialTaxKRW: withholding,
    },
    ctx
  );
  const nationalPensionTax = calculateNationalPensionTaxKRW(NATIONAL_PENSION, ctx);
  const privatePensionExcess = calculatePrivatePensionExcessTaxNeededKRW(
    PRIVATE_PENSION, ctx, NATIONAL_PENSION
  );
  const capitalGainsTax = calculateCapitalGainsTaxKRW(CAPITAL_GAIN, ctx);

  test('배당 원천징수 = 3,000만 × 15.4% = 462만원', () => {
    expect(withholding).toBeCloseTo(4_620_000, -2);
  });

  test('금융소득종합과세 추가 납부 = 0 (원천징수가 누진세액을 넘는다)', () => {
    // 초과분 1,000만 × 6% × 1.1 = 66만 < 기납부 상당 154만 → 0
    // 연금소득이 아무리 커도 이 판정에는 들어가지 않는다(별도 과세 체계).
    expect(comprehensiveAndHealth.comprehensiveTaxKRW).toBe(0);
  });

  test('건보료 기준액 = 배당 3,000만 + 국민연금 1,200만 × 50% = 3,600만원', () => {
    // 사적연금 2,000만은 부과 대상이 아니라 빠진다. 포함했다면 5,600만이 됐을 것이다.
    expect(comprehensiveAndHealth.healthInsuranceIncomeBasisKRW).toBeCloseTo(36_000_000, -2);
    // 초과분 1,600만 × 7.09% = 113.44만
    expect(comprehensiveAndHealth.healthInsuranceKRW).toBeCloseTo(1_134_400, -2);
  });

  test('국민연금세 = 30.36만원', () => {
    // 공제 590만 → 과표 460만 → 6% × 1.1
    expect(nationalPensionTax).toBeCloseTo(303_600, -2);
  });

  test('사적연금 초과세는 종합과세를 고르고, 국민연금과 합산해 증분으로 계산한다', () => {
    // 분리과세: 2,000만 × 16.5%                                    = 330.0만
    // 종합과세(증분):
    //   합산 3,200만 → 공제 810만(630만 + 1,800만×10%)
    //                → 과표 3,200 − 810 − 150 = 2,240만
    //                → (2,240만 × 15% − 126만) × 1.1              = 231.0만
    //   국민연금만 1,200만                                          =  30.36만
    //   증분 = 231.0 − 30.36                                       = 200.64만  → 더 유리
    expect(privatePensionExcess.method).toBe('comprehensive');
    expect(privatePensionExcess.taxKRW).toBeCloseTo(2_006_400, -2);

    // 공제를 두 번 주는 예전 방식이었다면 사적연금 2,000만 단독 계산으로 76.56만이 나온다.
    // 합산 증분이 그보다 커야 한다 — 국민연금이 이미 낮은 구간을 채웠기 때문이다.
    expect(privatePensionExcess.taxKRW).toBeGreaterThan(765_600);
  });

  test('해외ETF 양도세 = (2,000만 − 250만) × 22% = 385만원', () => {
    expect(capitalGainsTax).toBeCloseTo(3_850_000, -2);
  });

  test('총 세부담 = 1,191.44만원', () => {
    // 462.0(배당 원천징수) + 0(종합과세) + 113.44(건보료)
    //   + 30.36(국민연금세) + 200.64(사적연금 초과세) + 385.0(양도세)
    const total =
      withholding
      + comprehensiveAndHealth.comprehensiveTaxKRW
      + comprehensiveAndHealth.healthInsuranceKRW
      + nationalPensionTax
      + privatePensionExcess.taxKRW
      + capitalGainsTax;

    expect(total).toBeCloseTo(11_914_400, -2);
  });
});
