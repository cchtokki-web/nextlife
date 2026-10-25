export const RETIREMENT_GRADE_THRESHOLDS = {
  veryStable: 90, // 매우 안정
  stable: 80, // 안정
  normal: 70, // 보통
  caution: 60, // 주의
  // 그 미만: 위험
} as const;

export type RetirementGrade = '매우 안정' | '안정' | '보통' | '주의' | '위험';

export function getRetirementGrade(score: number): RetirementGrade {
  if (score >= RETIREMENT_GRADE_THRESHOLDS.veryStable) return '매우 안정';
  if (score >= RETIREMENT_GRADE_THRESHOLDS.stable) return '안정';
  if (score >= RETIREMENT_GRADE_THRESHOLDS.normal) return '보통';
  if (score >= RETIREMENT_GRADE_THRESHOLDS.caution) return '주의';
  return '위험';
}

// 5단계 등급을 3색으로 접을 때 쓰는 경계값 (등급 의미와 일치)
// - green : RETIREMENT_GRADE_THRESHOLDS.stable 이상 (안정 등급 이상)
// - orange: RETIREMENT_GRADE_THRESHOLDS.caution 이상 (보통/주의 등급)
// - red   : 그 미만 (위험 등급)
export function getRetirementGradeColorTier(score: number): 'green' | 'orange' | 'red' {
  if (score >= RETIREMENT_GRADE_THRESHOLDS.stable) return 'green';
  if (score >= RETIREMENT_GRADE_THRESHOLDS.caution) return 'orange';
  return 'red';
}
