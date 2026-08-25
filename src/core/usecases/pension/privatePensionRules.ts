// 사적연금(IRP/연금저축/퇴직연금) 최소 수령 개시 나이 도메인 규칙.
// 한국 세법상 사적연금은 만 55세부터 연금으로 수령 가능하며, 그 이전에는(의료비·장기실업 등
// 법정 예외 사유 없이는) 인출 자체가 불가능하다. nationalPensionRules.ts의 조기/연기수령
// clamp와 대칭되는 위치에 둔다.

export const PRIVATE_PENSION_MIN_START_AGE = 55;

export function clampPrivatePensionStartAge(age: number): number {
  return Math.max(PRIVATE_PENSION_MIN_START_AGE, age);
}

/**
 * 지금 사적연금을 인출할 수 있는가. 계층 밖(법정) 제약이라 HARD 생활비 바닥을 채우는
 * 1단계에서도 깨지 않는다.
 *
 * 이 술어가 존재하는 이유는 같은 비교가 인출 계좌 구성과 인출 가능액 판정 두 곳에 있었기
 * 때문이다. 둘이 갈라지면 「닿을 수 있다고 판정한 금액」과 「실제로 꺼낸 금액」이 어긋난다.
 */
export function canWithdrawPrivatePension(age: number): boolean {
  return age >= PRIVATE_PENSION_MIN_START_AGE;
}

export type StatutoryPensionWithdrawalLimit =
  | { status: 'limited'; annualLimit: number }
  | { status: 'not_limited'; annualLimit: null };

/**
 * 소득세법 시행령 제40조의2의 연금수령한도.
 *
 * `과세기간 개시일 평가액 ÷ (11 - 연금수령연차) × 120%`이며, 연금수령연차가 11년
 * 이상이면 이 공식이 적용되지 않는다. 이 함수는 공식을 한 곳에 고정할 뿐, 현행 입력에 없는
 * 기산연도나 2013년 이전 가입 예외를 추정하지 않는다.
 */
export function calculateStatutoryPensionWithdrawalLimit(
  taxPeriodOpeningBalance: number,
  pensionReceivingYear: number,
): StatutoryPensionWithdrawalLimit {
  if (!Number.isFinite(taxPeriodOpeningBalance) || taxPeriodOpeningBalance < 0) {
    throw new RangeError('과세기간 개시일 연금계좌 평가액은 0 이상의 유한한 값이어야 합니다.');
  }
  if (!Number.isInteger(pensionReceivingYear) || pensionReceivingYear < 1) {
    throw new RangeError('연금수령연차는 1 이상의 정수여야 합니다.');
  }
  if (pensionReceivingYear >= 11) return { status: 'not_limited', annualLimit: null };
  return {
    status: 'limited',
    annualLimit: taxPeriodOpeningBalance / (11 - pensionReceivingYear) * 1.2,
  };
}
