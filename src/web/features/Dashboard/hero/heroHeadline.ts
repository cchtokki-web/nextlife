import { getRetirementGrade, getRetirementGradeColorTier } from '../../../../core/entities/retirementGrade';
import { PlanAssetStatus } from '../../../../core/usecases/dashboard/resolvePlanAssetStatus';

export interface HeroHeadline {
  emoji: '🟢' | '🟡' | '🔴';
  text: string;
}

const TIER_EMOJI = { green: '🟢', orange: '🟡', red: '🔴' } as const;

// AI Summary Hero 최상단의 한 줄 요약. 새 LLM 호출을 추가하지 않고, 이미 계산된 Utility 점수/
// 등급과 depletionAge만으로 규칙 기반 문구를 만든다.
//
// status가 optional이 아닌 이유: 폴백이 있으면 새 호출부가 이 인자를 빠뜨려도 조용히 통과하고,
// 투자자산이 없는 계획에 "51세에 자산이 고갈될 위험이 있습니다"가 다시 표시된다. 이 값은 항상
// SimulationResult로부터 얻을 수 있으므로(resolvePlanAssetStatus) 호출부에 부담이 없다.
export function buildHeroHeadline(
  utilityScore: number,
  depletionAge: number | null,
  expectancy: number,
  status: PlanAssetStatus,
  monteCarlo?: { successRate: number; fullSpendingRate: number }
): HeroHeadline {
  const grade = getRetirementGrade(utilityScore);
  const tier = getRetirementGradeColorTier(utilityScore);

  // 고갈 여부는 status가 이미 판정해 두었다 — 여기서 다시 유도하면 두 규칙이 어긋날 수 있다.
  const deterministicSurvivalClause =
    status === 'no_investable_asset'
      ? '등록된 투자자산이 없어, 연금 등 고정소득만으로 생활하는 계획입니다.'
      : status === 'depleted'
        ? `${depletionAge}세에 자산이 고갈될 위험이 있습니다.`
        : `${expectancy}세까지 자산 고갈 위험이 없습니다.`;

  const survivalClause = status === 'sustained' && monteCarlo && monteCarlo.successRate < 0.95
    ? `기준 시나리오에서는 ${expectancy}세까지 유지되지만, 시장 변동 반영 시 자산 유지 확률은 ${Math.round(monteCarlo.successRate * 100)}%, 목표 생활비 완전 유지 확률은 ${Math.round(monteCarlo.fullSpendingRate * 100)}%입니다.`
    : deterministicSurvivalClause;

  const headlineTier = status === 'sustained' && monteCarlo && monteCarlo.successRate < 0.95
    ? 'orange'
    : tier;
  const statusPrefix = status === 'sustained' && monteCarlo && monteCarlo.successRate < 0.95
    ? '기준 시나리오는 안정적이나 시장 변동성 대응이 필요합니다.'
    : grade === '위험' || grade === '주의'
      ? `${grade} 수준의 은퇴 준비 상태입니다.`
      : `${grade === '매우 안정' ? '매우 안정적인' : '안정적인'} 은퇴입니다.`;

  return {
    emoji: TIER_EMOJI[headlineTier],
    text: `${statusPrefix} ${survivalClause}`,
  };
}
