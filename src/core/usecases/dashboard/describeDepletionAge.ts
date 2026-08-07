import { PlanAssetStatus } from './resolvePlanAssetStatus';

// 자산 고갈 예상 나이(SimulationResult.depletionAge)를 사람이 읽는 문구로 만든다.
//
// depletionAge는 본인 기대수명이 아니라 가구 종료 나이(SimulationResult.householdEndAge)까지
// 도는 연도 루프에서 판정된다. 그래서 "고갈 없음" 폴백을 "기대수명 내 고갈 없음"이라고 쓰면
// 배우자가 더 오래 사는 계획에서 실제로 검사한 구간보다 짧은 구간만 보증한 것처럼 읽힌다
// (같은 리포트의 FIRE 나이·상속 부족 알림은 이미 가구 종료 나이 기준이라 서로 어긋난다).
//
// 배우자를 언급하는 조건(가구 종료가 본인 기대수명보다 늦을 때만)은 describeFireAge·
// computeRiskAlerts·generateChartCaptions와 같은 관례다.
// status가 'no_investable_asset'이면 나이를 쓰지 않는다. 투자자산이 하나도 없는 계획은
// 엔진이 첫 해에 depletionAge를 잡으므로(자산 0 <= 0), 여기서 그 값을 그대로 쓰면 PDF 요약이
// "자산 고갈 예상 나이: 51세"라고 보고한다 — 고갈시킬 자산이 애초에 없는 사람에게.
export function describeDepletionAge(
  depletionAge: number | null | undefined,
  householdEndAge: number,
  expectancy: number,
  status: PlanAssetStatus
): string {
  if (status === 'no_investable_asset') return '투자자산 미보유';
  if (depletionAge !== null && depletionAge !== undefined) return `${depletionAge}세`;
  if (householdEndAge > expectancy) {
    return `배우자 기대수명 시점(본인 나이 ${householdEndAge}세)까지 고갈 없음`;
  }
  return `기대수명(${householdEndAge}세)까지 고갈 없음`;
}
