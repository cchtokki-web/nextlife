/**
 * 「지속 가능한 한도는 월 N원입니다」가 **어떤 세계의 값인지** 밝히는 한 문장.
 *
 * 이 파일이 생긴 이유는 한 화면이 두 세계를 섞어 말하고 있었기 때문이다. 같은 화면이
 * 「목표 달성 확률 71%」(1,000회 시행)와 「지속 가능한 한도 월 410만원」을 나란히 놓는데,
 * 뒤의 값에는 확률이 붙어 있지 않다. 사용자는 자연히 앞의 71%를 뒤의 금액에도 적용해
 * 「410만원을 써도 71%는 된다」로 읽는다. 그 독법은 틀렸다.
 *
 * **그 금액은 결정론 이진탐색의 결과다.** SimulationEngine.searchSustainable은
 * runSingle(trialParams)을 returnPath 없이 30회 부른다 — 수익률이 해마다 흔들리지 않고
 * 기준 경로가 그대로 실현되는 단 하나의 세계다. 성공 조건도 확률이 아니라 그 한 경로에서
 * 세 가지가 모두 참인가다(meetsSustainabilityGoal): 결손이 있는 해가 없고, 은퇴 후 매해
 * 연령대별·물가반영 목표에 의료비를 더한 금액을 채웠고, 기말자산이 하한선을 넘는다.
 *
 * 즉 이 값은 「권장액」도 「확률 X%를 유지하는 금액」도 아니고 **그 한 경로에서의 한계값**이다.
 * 시장이 흔들리면 같은 금액을 끝까지 쓸 확률은 그보다 낮다.
 *
 * **문장을 core에 두는 이유**는 describeSustainableSpendingLimit·describeMonteCarloAssumptions와
 * 같다 — 화면과 PDF가 같은 문장을 인쇄해야 하고, 그 문장이 서술하는 것(어떤 실행에서 나온
 * 값인가)은 엔진의 사실이지 표시 계층의 사정이 아니다.
 *
 * **범위 밖**: 확률 기준으로 역산한 한도(「목표 달성 확률 70%를 유지하는 최대 초기 생활비」)는
 * 새 계산이다. 이진탐색 단계마다 1,000회 시행이 필요하고 지금 그 값을 만드는 코드는 없다.
 * (SimulationMetricsCalculator의 sustainableSpendingBasis: 'probabilistic' 분기는 생산자가
 * 없어 언제나 'deterministic'으로만 선다 — known-issues 참조.) 여기서는 지어내지 않고,
 * 이미 있는 값이 무엇인지만 정확히 말한다.
 */
export function describeSustainableSpendingBasis(expectancy: number): string {
  return `이 금액은 기준 수익률이 그대로 실현되고 시장이 흔들리지 않는다고 볼 때 ${expectancy}세까지 `
    + '버티는 한계값입니다 — 권장액이 아니며, 시장 변동을 반영한 확률은 「목표 달성 확률」이 따로 답합니다.';
}
