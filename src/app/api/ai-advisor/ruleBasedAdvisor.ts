import { UserProfile } from '../../../core/entities/types';

export function generateRuleBasedAdvice(
  score: number,
  monthlyTarget: number,
  isPro: boolean,
  userProfile?: UserProfile,
  depletionAge?: number | null
): string {
  const targetInManwon = Math.round(monthlyTarget / 10000);

  let statusText = '';
  if (score >= 90) {
    statusText = `은퇴 성공 확률이 **${score}%**로 매우 안정적입니다.`;
  } else if (score >= 70) {
    statusText = `은퇴 성공 확률은 **${score}%**로 양호하지만 보완이 필요합니다.`;
  } else {
    statusText = depletionAge === null
      ? `점수가 **${score}점**으로 낮아 은퇴 구조가 불안정합니다.`
      : `**${depletionAge}세** 무렵 자산이 고갈될 위험이 있습니다.`;
  }

  const possibilityText = score >= 70
    ? `목표하신 월 **${targetInManwon}만원**의 생활비 유지가 충분히 가능합니다.`
    : `목표 월 **${targetInManwon}만원** 유지를 위해 투자금을 늘리거나 은퇴를 늦추는 것을 추천합니다.`;

  return `${statusText} ${possibilityText}`;
}
