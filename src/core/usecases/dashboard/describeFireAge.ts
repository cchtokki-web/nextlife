// FIRE 달성 나이(SimulationResult.fireAge)를 사람이 읽는 문구로 만든다.
//
// fireAge의 종료 게이트는 본인 기대수명이 아니라 가구 종료 나이(SimulationResult.householdEndAge)다
// — depletionAge/endingAssets와 같은 기준이어야 하기 때문이다(SimulationEngine 참조). 그래서
// 배우자가 본인보다 오래 사는 계획에서는 fireAge가 본인 기대수명보다 클 수 있다.
//
// 단서 없이 숫자만 인쇄하면 같은 리포트(그리고 같은 AI 프롬프트)가 "기대수명 80세"와
// "FIRE 85세"를 나란히 말하는 모순이 된다. LLM은 그 둘을 모두 사실로 받아들이므로
// 인쇄되는 모든 지점이 이 함수를 거치게 해서 문구를 한 곳에서만 정의한다.
// 배우자를 언급하는 조건(가구 종료가 본인 기대수명보다 늦을 때만)은 generateChartCaptions·
// computeRiskAlerts와 같은 관례다.
export function describeFireAge(fireAge: number | null | undefined, expectancy: number): string {
  if (fireAge === null || fireAge === undefined) return '달성 불가능';
  if (fireAge > expectancy) {
    return `${fireAge}세 (본인 기대수명 ${expectancy}세 이후 — 배우자 생존 기간 기준)`;
  }
  return `${fireAge}세`;
}
