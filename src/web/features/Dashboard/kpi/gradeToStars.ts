import { getRetirementGrade, RetirementGrade } from '../../../../core/entities/retirementGrade';
import { PlanConfidenceBandKey } from '../../../../core/usecases/dashboard/computePlanConfidence';

const GRADE_TO_STAR_COUNT: Record<RetirementGrade, number> = {
  '매우 안정': 5,
  안정: 4,
  보통: 3,
  주의: 2,
  위험: 1,
};

// 0~100점 스케일(retirementScore/utility.score 공용)을 5단계 등급과 동일한 경계값으로 별점 변환한다.
export function scoreToStars(score: number): number {
  return GRADE_TO_STAR_COUNT[getRetirementGrade(score)];
}

// 확률 밴드 → 별점. 라벨이 밴드에서 나오는데 별만 점수에서 나오면 둘이 어긋난다
// (보정 점수 49점은 1개, 밴드는 '보통'인 상태가 실제로 가능하다).
const BAND_TO_STAR_COUNT: Record<PlanConfidenceBandKey, number> = {
  very_stable: 5,
  stable: 4,
  moderate: 3,
  caution: 2,
  risky: 1,
  // 6밴드를 5별에 접으므로 최하위 둘이 별 1개를 공유한다. 별은 어차피 등급 라벨의 보조
  // 표시이고, '위험'과 '매우 위험'의 차이는 옆에 적히는 확률 숫자가 말한다.
  very_risky: 1,
};

export function bandToStars(band: PlanConfidenceBandKey): number {
  return BAND_TO_STAR_COUNT[band];
}
