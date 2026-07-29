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

  const hasImprovement = !!recommendation?.improved;
  // 신규 연금계좌 납입 레그(Phase 4-B)가 채택된 경우, 개선분의 일부는 "인출 전략 조정"이 아니라
  // 사용자가 계획 밖에서 새로 마련해 납입하는 자금에서 나온다. 이 단서를 빼면 헤드라인 문구가
  // 기존 자산만 재배치해도 그 점수에 도달하는 것처럼 읽힌다(단서가 지금은 체크리스트 항목
  // 라벨에만 있다).
  const newPensionCaveat = recommendation?.recommendedNewPensionContribution
    ? ' 다만 이 점수에는 연금 계좌를 새로 열어 월 75만원을 추가로 납입한다는 가정이 포함되어 있어, 기존 자산 재배치만으로는 전부 달성되지 않습니다.'
    : '';
  const utilityText = hasImprovement
    ? ` AI 분석 결과, 인출 전략을 조정하면 평생 효용 점수를 **${recommendation!.currentUtility.score}점**에서 **${recommendation!.recommendedUtility.score}점**까지 높일 수 있습니다.${newPensionCaveat}`
    : '';

  return `${statusText} ${possibilityText}${utilityText}`;
}
