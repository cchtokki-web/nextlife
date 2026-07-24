import { getRetirementGrade, getRetirementGradeColorTier } from '../../../../core/entities/retirementGrade';

export interface HeroHeadline {
  emoji: '🟢' | '🟡' | '🔴';
  text: string;
}

const TIER_EMOJI = { green: '🟢', orange: '🟡', red: '🔴' } as const;

// AI Summary Hero 최상단의 한 줄 요약. 새 LLM 호출을 추가하지 않고, 이미 계산된 Utility 점수/
// 등급과 depletionAge만으로 규칙 기반 문구를 만든다.
export function buildHeroHeadline(utilityScore: number, depletionAge: number | null, expectancy: number): HeroHeadline {
  const grade = getRetirementGrade(utilityScore);
  const tier = getRetirementGradeColorTier(utilityScore);
  const isDepleted = depletionAge !== null && depletionAge < expectancy;

  const survivalClause = isDepleted
    ? `${depletionAge}세에 자산이 고갈될 위험이 있습니다.`
    : `${expectancy}세까지 자산 고갈 위험이 없습니다.`;

  return {
    emoji: TIER_EMOJI[tier],
    text: `${grade === '위험' || grade === '주의' ? `${grade} 수준의 은퇴 준비 상태입니다.` : `${grade === '매우 안정' ? '매우 안정적인' : '안정적인'} 은퇴입니다.`} ${survivalClause}`,
  };
}
