import { getRetirementGrade, RetirementGrade } from '../../../../core/entities/retirementGrade';

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
