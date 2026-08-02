import { describe, test, expect } from 'vitest';
import { resolveTaxContext } from '@/core/usecases/tax/taxContext';
import { TAX_LAW_PROFILES } from '@/core/usecases/tax/taxLawProfiles';
import { DEFAULT_TAX_SETTINGS } from '@/core/usecases/tax/taxRates';
import { getComprehensiveIncomeTaxKRW, calculateNationalPensionTaxKRW } from '@/core/usecases/tax/TaxEngine';

describe('resolveTaxContext', () => {
  test('세법 버전과 사용자 설정을 함께 확정한다', () => {
    const ctx = resolveTaxContext({ comprehensiveTaxRate: 20 }, 'current');

    expect(ctx.profile).toBe(TAX_LAW_PROFILES.current);
    expect(ctx.settings.comprehensiveTaxRate).toBe(20);
    // 지정하지 않은 설정은 기본값으로 채워진다.
    expect(ctx.settings.usDividendTaxRate).toBe(DEFAULT_TAX_SETTINGS.usDividendTaxRate);
  });

  test('인자가 전혀 없어도(구 데이터) 완전한 컨텍스트를 만든다', () => {
    const ctx = resolveTaxContext();

    expect(ctx.profile).toBe(TAX_LAW_PROFILES.current);
    expect(ctx.settings).toEqual(DEFAULT_TAX_SETTINGS);
  });

  // 이 테스트가 A1 작업의 본체다. 예전에는 TaxEngine이 모듈 로드 시점의 평평한 상수를
  // 읽었기 때문에, 프로필을 바꿔도 계산 결과가 절대 달라지지 않았다 — 세법 버전 축이
  // 있는 척하는 죽은 구조였다. 프로필을 바꾸면 세액이 바뀐다는 것을 직접 확인한다.
  //
  // TaxLawVersion에는 아직 'current' 하나뿐이라(확정되지 않은 개정안의 숫자를 지어내지
  // 않는다는 설계 결정) 실제 버전 두 개로 비교할 수는 없다. 대신 프로필 객체를 직접
  // 조립해 "TaxEngine이 넘겨받은 프로필을 실제로 읽는가"를 검증한다.
  test('TaxEngine은 넘겨받은 프로필의 값을 실제로 사용한다', () => {
    const base = resolveTaxContext();

    const doubledNationalPensionRate = {
      ...base,
      profile: { ...base.profile, nationalPensionTaxRate: base.profile.nationalPensionTaxRate * 2 },
    };
    expect(calculateNationalPensionTaxKRW(10_000_000, doubledNationalPensionRate))
      .toBeCloseTo(calculateNationalPensionTaxKRW(10_000_000, base) * 2);

    const flatTenPercent = {
      ...base,
      profile: {
        ...base.profile,
        comprehensiveIncomeBrackets: [{ minKRW: 0, rate: 0.1, deductionKRW: 0 }],
      },
    };
    expect(getComprehensiveIncomeTaxKRW(30_000_000, flatTenPercent)).toBeCloseTo(3_000_000);
    // 현행 프로필은 15% − 누진공제 126만원 = 324만원이라 값이 실제로 달라야 한다.
    expect(getComprehensiveIncomeTaxKRW(30_000_000, base)).toBeCloseTo(3_240_000);
  });
});
