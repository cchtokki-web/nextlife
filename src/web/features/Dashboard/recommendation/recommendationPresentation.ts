import {
  ItemizedContribution,
  ItemizedContributionField,
} from '../../../../core/entities/types';

export interface RecommendationItemGroups {
  applied: ItemizedContribution[];
  recommended: ItemizedContribution[];
  conditional: ItemizedContribution[];
}

// 개별 항목 점수는 baseline에 그 항목 하나만 적용한 단독 효과다. 전체 조합에서만 이득이 나는
// 항목을 일반 권장 체크박스로 섞으면 사용자가 손해 보는 단일 변경을 실행할 수 있으므로 분리한다.
export function groupRecommendationItems(
  items: readonly ItemizedContribution[],
  appliedFields: ReadonlyArray<ItemizedContributionField> = []
): RecommendationItemGroups {
  const applied = items.filter((item) => appliedFields.includes(item.field));
  const remaining = items.filter((item) => !appliedFields.includes(item.field));
  return {
    applied,
    recommended: remaining.filter((item) => item.utilityDelta > 0),
    conditional: remaining.filter((item) => item.utilityDelta <= 0),
  };
}

export function formatTaxImpact(
  totalTaxDelta: number,
  formatValue: (value: number) => string
): string | null {
  if (totalTaxDelta === 0) return null;
  return totalTaxDelta < 0
    ? `절세 +${formatValue(-totalTaxDelta)}`
    : `추가 세금 +${formatValue(totalTaxDelta)}`;
}
