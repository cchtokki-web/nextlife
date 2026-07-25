'use client';

import { Check, Loader2 } from 'lucide-react';
import { StrategyRecommendation } from '../../../../core/entities/types';
import GlassCard from '../../../components/GlassCard';

interface RecommendationChecklistProps {
  recommendation?: StrategyRecommendation;
  recommendationFailed?: boolean;
  isComputingRecommendation?: boolean;
  formatValue: (val: number) => string;
}

// AI 추천 전략을 긴 문장 나열 대신 체크리스트로 보여준다. itemizedContributions(항목별 marginal
// utility/절세/자산 효과)가 있으면 그것을, 없으면(개선안이 없거나 예외적으로 비어있으면) 기존
// reasons 문장으로 폴백한다.
export function RecommendationChecklist({
  recommendation,
  recommendationFailed = false,
  isComputingRecommendation = false,
  formatValue,
}: RecommendationChecklistProps) {
  if (isComputingRecommendation) {
    return (
      <GlassCard className="mb-6 flex items-center gap-2 text-sm text-foreground-muted">
        <Loader2 size={14} className="animate-spin" aria-hidden="true" />
        <span>AI가 최적 인출 전략을 탐색하고 있습니다...</span>
      </GlassCard>
    );
  }

  if (recommendationFailed) {
    return (
      <GlassCard className="mb-6 text-sm text-foreground-muted">
        🤖 AI 추천 전략을 계산하지 못했습니다. 잠시 후 다시 시도해주세요.
      </GlassCard>
    );
  }

  if (!recommendation) return null;

  if (!recommendation.improved || recommendation.itemizedContributions.length === 0) {
    return (
      <GlassCard className="mb-6">
        <h3 className="mb-2 text-base font-semibold">🤖 AI 추천 전략</h3>
        <ul className="flex flex-col gap-1.5 pl-5 text-sm text-foreground-muted">
          {recommendation.reasons.map((reason, i) => (
            <li key={i}>{reason}</li>
          ))}
        </ul>
      </GlassCard>
    );
  }

  const totalUtilityDelta = recommendation.recommendedUtility.score - recommendation.currentUtility.score;

  return (
    <GlassCard className="mb-6">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-base font-semibold">🤖 AI 추천 전략</h3>
        <span className="text-sm font-semibold text-success">총 효용 +{totalUtilityDelta}점</span>
      </div>
      <ul className="flex flex-col gap-3">
        {recommendation.itemizedContributions.map((item, i) => (
          <li key={i} className="border-b border-card-border pb-3 last:border-none">
            <div className="flex items-start justify-between gap-2">
              <span className="flex items-start gap-2 text-sm">
                <Check size={16} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
                {item.label}
              </span>
              <span className={`shrink-0 text-sm font-semibold ${item.utilityDelta >= 0 ? 'text-success' : 'text-danger'}`}>
                효용 {item.utilityDelta >= 0 ? '+' : ''}
                {item.utilityDelta}점
              </span>
            </div>
            <div className="ml-6 mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground-muted">
              {item.deltas.totalTax !== 0 && (
                <span>
                  절세 {item.deltas.totalTax <= 0 ? formatValue(-item.deltas.totalTax) : `-${formatValue(item.deltas.totalTax)}`}
                </span>
              )}
              {item.deltas.endingAssets !== 0 && (
                <span>
                  자산 {item.deltas.endingAssets >= 0 ? '+' : '-'}
                  {formatValue(Math.abs(item.deltas.endingAssets))}
                </span>
              )}
              {item.deltas.lifetimeConsumption !== 0 && (
                <span>
                  생활비 {item.deltas.lifetimeConsumption >= 0 ? '+' : '-'}
                  {formatValue(Math.abs(item.deltas.lifetimeConsumption))}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-foreground-muted">
        * 각 항목의 효용 기여도는 그 변경 하나만 단독 적용했을 때의 값으로, 항목 간 상호작용을
        반영하지 않아 합계가 위 총 개선폭과 정확히 일치하지 않을 수 있습니다. 평생 효용 점수는
        6개 항목을 각각 0~100점 만점으로 반올림해 합산하는 방식이라, 이미 만점(자산 고갈 방지)이거나
        바닥(상속 자산 적정성 등 과다 잔여 페널티)에 가까운 항목은 실제 절세·자산 효과가 커도
        점수에는 반영되지 않아 +0점으로 보일 수 있습니다.
      </p>
    </GlassCard>
  );
}
