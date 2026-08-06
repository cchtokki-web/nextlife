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
//
// **retirementAge와의 비교가 필요한 이유**: fireAge는 "소득만으로 생활비를 감당하게 되는
// 시점"이지 "은퇴할 수 있는 시점"이 아니다. 60세 은퇴를 계획한 사용자에게 73이라는 숫자만
// 보여주면 이미 지나간 시점을 "조기은퇴 가능 나이"라고 말하는 형용모순이 된다. 계산을
// 바꾸는 대신(원금 인출이 소득에 포함되는 구조적 한계는 그대로 남는다) 은퇴 계획 대비
// 상대 위치를 함께 인쇄해 오해를 없앤다.
export function describeFireAge(
  fireAge: number | null | undefined,
  expectancy: number,
  retirementAge: number
): string {
  if (fireAge === null || fireAge === undefined) return '달성 불가능';

  if (fireAge <= retirementAge) {
    return `${fireAge}세 (은퇴 시점에 이미 달성)`;
  }

  const delayYears = fireAge - retirementAge;
  const base = `${fireAge}세 — 현재 은퇴 계획(${retirementAge}세)보다 ${delayYears}년 늦음`;

  // 기대수명을 넘는 fireAge는 반드시 은퇴 나이보다도 늦다(은퇴 < 기대수명). 두 단서는
  // 서로 다른 사실을 말하므로 함께 붙인다 — 하나만 남기면 다른 하나가 조용히 사라진다.
  if (fireAge > expectancy) {
    return `${base} (본인 기대수명 ${expectancy}세 이후 — 배우자 생존 기간 기준)`;
  }

  return base;
}
