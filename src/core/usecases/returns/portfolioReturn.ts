import { SimulationParams } from '../../entities/types';

/**
 * 시장 연동 계좌의 잔액가중 평균 총수익률(%). 유도할 잔액이 없으면 null.
 *
 * **사적연금을 포함한다.** 예전에는 자산과 ISA만 셌고, 그 근거는 "연금은 이미 충격
 * 배율로 따로 줄어든다"였다. 그런데 그 배율은 프리셋 표의 비(4/7)로 고정된 상수라
 * 사용자가 연금 계좌에 무엇을 담았는지와 무관했다. 실측 사례에서 사적연금이 포트폴리오의
 * 절반이었고 셋 다 미국배당 ETF·커버드콜이었는데, 변동성 유도에서는 그 절반이 통째로
 * 빠져 있었다.
 *
 * 단순평균이 아니라 잔액 가중인 이유: 100만원짜리 고위험 자산 하나가 10억짜리 안전
 * 자산과 같은 무게를 가지면, 포트폴리오의 성격을 말하지 못한다.
 *
 * 통화 환산은 SimulationEngine.convertValue와 같은 규칙이다(USD → KRW는 환율을 곱한다).
 * exchangeScenario의 ±10% 배율은 일부러 적용하지 않는다 — 여기서 구하는 것은 금액이
 * 아니라 «무게»이고, 모든 USD 계좌에 같은 배율을 곱해도 가중평균은 바뀌지 않는다.
 */
export function weightedAverageTotalReturn(params: SimulationParams): number | null {
  let weightedSum = 0;
  let totalValue = 0;

  const add = (value: number, ratePercent: number) => {
    if (!(value > 0)) return;
    weightedSum += value * ratePercent;
    totalValue += value;
  };

  const toKRW = (amount: number, currency: 'KRW' | 'USD') =>
    currency === 'USD' ? amount * params.baseExchangeRate : amount;

  for (const asset of params.assets ?? []) {
    add(toKRW(asset.quantity * asset.averagePrice, asset.currency), asset.totalReturn);
  }
  for (const isa of params.isaAccounts ?? []) {
    add(toKRW(isa.balance, isa.currency), isa.totalReturn);
  }
  for (const pension of params.privatePensions ?? []) {
    add(toKRW(pension.balance, pension.currency), pension.totalReturn);
  }

  return totalValue > 0 ? weightedSum / totalValue : null;
}

/**
 * 그 계좌가 시장 충격을 받는 배율.
 *
 * **유도 규칙은 새로 만든 것이 아니다.** 예전 PENSION_RETURN_SHOCK_BETA가 쓰던 규칙
 * ─ "충격 배율 = 그 버킷의 기대수익률 ÷ 주식 기대수익률" ─ 을 그대로 쓰되, 프리셋 표
 * 대신 **사용자가 실제로 넣은 값**을 먹인다. 그 상수는 연금 계좌에 무엇이 들어 있든
 * 언제나 4/7을 곱했다. 총수익률 14%짜리 커버드콜을 담은 IRP도 43%를 깎였다.
 *
 * **잔액가중 β의 평균은 정확히 1.0이다**: Σ(bᵢ·rᵢ/R)/Σb = (1/R)·R = 1.
 * 즉 포트폴리오 «전체»가 받는 충격은 유도된 변동성 그대로이고, 계좌 «간» 분산만
 * 기대수익률을 따라간다. 이 성질이 이중 보수를 막는다 — 연금의 낮은 수익률이 가중평균을
 * 내려 변동성을 낮추는데 배율이 또 낮추면, 같은 보수성이 두 번 계산된다.
 *
 * **불확실**: 기대수익률과 변동성이 비례한다는 보장은 없다(CAPM 계열의 단순화에 가깝다).
 * 이 저장소에 실측 변동성 자료가 없어 대체할 근거가 없고, 옛 상수도 같은 단순화 위에
 * 서 있었다. 실측 자료가 생기면 이 함수부터 갈아낄 자리다.
 */
export function shockBeta(accountTotalReturn: number, portfolioAverageTotalReturn: number): number {
  // 평균이 0 이하면 나눌 수 없다. 종전처럼 모든 계좌에 같은 폭을 준다.
  if (!(portfolioAverageTotalReturn > 0)) return 1;

  // 단일 요인 모델에서 계좌가 시장과 «반대로» 움직일 수는 없다. 음수 배율은 하락장에
  // 그 계좌만 오르게 만든다. 0은 "시장 민감도 없음"이며, toMonthlyCompoundRate가
  // 연 −100% 아래를 막는 것과 같은 성격의 가드다.
  return Math.max(0, accountTotalReturn / portfolioAverageTotalReturn);
}
