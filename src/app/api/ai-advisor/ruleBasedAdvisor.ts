import { StrategyRecommendation, UserProfile, UtilityBreakdown } from '../../../core/entities/types';
import { getRetirementGrade, RetirementGrade } from '../../../core/entities/retirementGrade';

export function generateRuleBasedAdvice(
  score: number,
  monthlyTarget: number,
  isPro: boolean,
  userProfile?: UserProfile,
  depletionAge?: number | null,
  retirementGrade?: RetirementGrade,
  utility?: UtilityBreakdown,
  recommendation?: StrategyRecommendation
): string {
  const targetInManwon = Math.round(monthlyTarget / 10000);
  const grade = retirementGrade ?? getRetirementGrade(score);

  let statusText: string;
  let isFavorable: boolean;
  switch (grade) {
    case '매우 안정':
    case '안정':
      statusText = `은퇴 준비도가 **${grade}** 등급(${score}점)으로, 자산이 고갈되지 않고 안정적으로 유지될 것으로 예상됩니다.`;
      isFavorable = true;
      break;
    case '보통':
      statusText = `은퇴 준비도는 **보통** 등급(${score}점)으로 양호하지만 일부 보완이 필요합니다.`;
      isFavorable = true;
      break;
    case '주의':
    case '위험':
      statusText = depletionAge === null
        ? `은퇴 준비도가 **${grade}** 등급(${score}점)으로 다소 낮아 구조 개선이 필요합니다.`
        : `**${depletionAge}세** 무렵 자산이 고갈될 위험이 있어 **${grade}** 등급으로 평가됩니다.`;
      isFavorable = false;
      break;
  }

  const possibilityText = isFavorable
    ? `목표하신 월 **${targetInManwon}만원**의 생활비 유지가 가능할 것으로 보입니다.`
    : `목표 월 **${targetInManwon}만원** 유지를 위해 투자금을 늘리거나 은퇴를 늦추는 것을 추천합니다.`;

  const hasImprovement = !!recommendation && recommendation.recommendedUtility.score > recommendation.currentUtility.score;
  const utilityText = hasImprovement
    ? ` AI 분석 결과, 인출 전략을 조정하면 평생 효용(Lifetime Utility) 점수를 **${recommendation!.currentUtility.score}점**에서 **${recommendation!.recommendedUtility.score}점**까지 높일 수 있습니다.`
    : '';

  return `${statusText} ${possibilityText}${utilityText}`;
}
