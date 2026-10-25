// ISA 중도인출 도메인 규칙.
//
// 한국 ISA는 «납입원금» 범위에서만 중도인출을 허용하고, 그 위의 수익금은 만기까지 계좌에
// 남아 비과세 한도 계산에 들어간다. 계층 밖(법정) 제약이므로 HARD 생활비 바닥을 채우는
// 1단계에서도 깨지 않는다 — 전략 선호와 달리 계획이 미뤄 둔 것이 아니라 법이 막는 것이다.
//
// 이 파일이 존재하는 이유는 같은 식이 세 곳(인출 계좌의 availableGross·withdraw,
// 인출 가능액 판정)에 흩어져 있었기 때문이다. 셋이 갈라지면 「인출 엔진이 닿을 수 있다고
// 판정한 금액」과 「실제로 꺼낸 금액」이 어긋나고, 그 차이는 설명되지 않는 생활비 부족으로만
// 드러난다. privatePensionRules.ts의 55세 게이트와 대칭되는 위치에 둔다.

/**
 * 지금 꺼낼 수 있는 ISA 금액. 잔액과 납입원금은 «같은 통화»여야 한다.
 *
 * 환산은 이 함수 밖에서 한 번만 한다. 환산이 양의 선형변환이라 min과 순서를 바꿔도 값이
 * 같으므로, 원시 통화에서 자르고 한 번 환산하는 쪽이 호출부마다 두 번 환산하는 것보다 싸다.
 */
export function isaWithdrawableGross(currentBalance: number, totalInvested: number): number {
  return Math.max(0, Math.min(currentBalance, totalInvested));
}

/**
 * 납입원금이 말라 잔액이 남아도 더는 꺼낼 수 없는 상태인가.
 *
 * 「수익금이 있는가」가 아니다. 수익이 조금이라도 난 계좌는 첫해부터 잔액 > 원금이므로,
 * 그것을 「막혔다」로 읽으면 거의 모든 실제 계정이 언제나 막힌 것이 되어 판정이 무의미해진다.
 * 원금이 실제로 0이 되어 «한 푼도» 꺼낼 수 없을 때만 참이다.
 */
export function isIsaPrincipalExhausted(currentBalance: number, totalInvested: number): boolean {
  return currentBalance > 0 && isaWithdrawableGross(currentBalance, totalInvested) <= 0;
}
