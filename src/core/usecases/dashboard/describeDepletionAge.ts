import { PlanAssetStatus } from './resolvePlanAssetStatus';

// 자산 고갈 예상 나이(SimulationResult.depletionAge)를 사람이 읽는 문구로 만든다.
//
// status가 'no_investable_asset'이면 나이를 쓰지 않는다. 투자자산이 하나도 없는 계획은
// 엔진이 첫 해에 depletionAge를 잡으므로(자산 0 <= 0), 여기서 그 값을 그대로 쓰면 PDF 요약이
// "자산 고갈 예상 나이: 51세"라고 보고한다 — 고갈시킬 자산이 애초에 없는 사람에게.
export function describeDepletionAge(
  depletionAge: number | null | undefined,
  expectancy: number,
  status: PlanAssetStatus
): string {
  if (status === 'no_investable_asset') return '투자자산 미보유';
  if (depletionAge !== null && depletionAge !== undefined) return `${depletionAge}세`;
  return `기대수명(${expectancy}세)까지 고갈 없음`;
}
