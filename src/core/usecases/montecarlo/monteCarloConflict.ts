import { PlanAssetStatus } from '../dashboard/resolvePlanAssetStatus';

// 결정론 시뮬레이션이 "고갈 없음"이라고 말하는데도 확률 시뮬레이션의 성공률이 이 값 미만이면,
// 화면의 두 조각이 서로 다른 이야기를 하고 있는 상태다.
//
// 51인 페르소나 실측: 결정론상 고갈이 없는 33명 중 18명(55%)의 MC 성공률이 70% 미만이었고,
// 51명 중 42명(82%)의 MC p10 기말자산이 0원이었다. 그중 21명은 등급이 '안정' 이상이다.
// 등급만 보여 주면 그 21명은 자기 계획이 중앙값에서만 성립한다는 사실을 알 길이 없다.
export const MONTE_CARLO_CONFLICT_THRESHOLD = 0.95;

// 진단 카드와 PDF 리포트가 이 판정을 공유한다. 두 곳이 다른 임계를
// 쓰면 "헤드라인은 경고하는데 배지는 조용한" 구간이 생기는데, 그것이 정확히 이 경고가
// 없애려는 상태다.
export function isMonteCarloConflict(
  status: PlanAssetStatus,
  monteCarlo: { successRate: number } | undefined
): boolean {
  return (
    status === 'sustained' &&
    monteCarlo !== undefined &&
    monteCarlo.successRate < MONTE_CARLO_CONFLICT_THRESHOLD
  );
}
