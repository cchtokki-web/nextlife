// 사적연금(IRP/연금저축/퇴직연금) 최소 수령 개시 나이 도메인 규칙.
// 한국 세법상 사적연금은 만 55세부터 연금으로 수령 가능하며, 그 이전에는(의료비·장기실업 등
// 법정 예외 사유 없이는) 인출 자체가 불가능하다. nationalPensionRules.ts의 조기/연기수령
// clamp와 대칭되는 위치에 둔다.

export const PRIVATE_PENSION_MIN_START_AGE = 55;

export function clampPrivatePensionStartAge(age: number): number {
  return Math.max(PRIVATE_PENSION_MIN_START_AGE, age);
}
