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
