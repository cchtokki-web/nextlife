// 국민연금 조기/연기수령 도메인 규칙.
// expectedMonthlyAmount는 "정상수급개시연령(65세) 기준 금액"으로 해석하고, 실제 청구 연령에 따라
// 아래 계수를 곱해 조정한다.

export const NATIONAL_PENSION_NORMAL_START_AGE = 65;
export const NATIONAL_PENSION_EARLY_MIN_AGE = 60; // 조기수령 최소 나이 (최대 5년 조기)
export const NATIONAL_PENSION_DEFERRED_MAX_AGE = 70; // 연기수령 최대 나이 (최대 5년 연기)
export const NATIONAL_PENSION_EARLY_REDUCTION_PER_MONTH = 0.005; // 조기 1개월당 0.5% 감액
export const NATIONAL_PENSION_DEFERRED_INCREASE_PER_MONTH = 0.006; // 연기 1개월당 0.6% 가산

export function getNationalPensionAdjustmentFactor(claimAge: number): number {
  const clampedAge = Math.min(NATIONAL_PENSION_DEFERRED_MAX_AGE, Math.max(NATIONAL_PENSION_EARLY_MIN_AGE, claimAge));

  if (clampedAge < NATIONAL_PENSION_NORMAL_START_AGE) {
    const monthsEarly = (NATIONAL_PENSION_NORMAL_START_AGE - clampedAge) * 12;
    return 1 - NATIONAL_PENSION_EARLY_REDUCTION_PER_MONTH * monthsEarly;
  }

  if (clampedAge > NATIONAL_PENSION_NORMAL_START_AGE) {
    const monthsDeferred = (clampedAge - NATIONAL_PENSION_NORMAL_START_AGE) * 12;
    return 1 + NATIONAL_PENSION_DEFERRED_INCREASE_PER_MONTH * monthsDeferred;
  }

  return 1;
}
