'use client';

import { Check, Loader2, Square } from 'lucide-react';
import { ItemizedContribution, StrategyRecommendation } from '../../../../core/entities/types';
import { SentinelApplication } from '../../../../core/usecases/strategy/applyAiSentinels';
import { PlanAssetStatus } from '../../../../core/usecases/dashboard/resolvePlanAssetStatus';
import GlassCard from '../../../components/GlassCard';
import { formatTaxImpact, groupRecommendationItems } from './recommendationPresentation';

interface RecommendationChecklistProps {
  recommendation?: StrategyRecommendation;
  recommendationFailed?: boolean;
  isComputingRecommendation?: boolean;
  // AI 센티널이 이미 계산에 넣은 축. 이 항목들은 "할 일"이 아니라 "이미 반영됨"이다.
  sentinels?: SentinelApplication;
  // 지금 화면이 보여주는 효용 점수(result.utility.score). 헤드라인을 "여기서 더 얻을 수
  // 있는 것"으로 만들기 위해 필요하다 — 자동 채움분은 이미 이 값에 들어 있다.
  currentUtilityScore?: number;
  formatValue: (val: number) => string;
  planAssetStatus?: PlanAssetStatus;
}

// AI 추천 전략을 긴 문장 나열 대신 체크리스트로 보여준다. itemizedContributions(항목별 marginal
// utility/절세/자산 효과)가 있으면 그것을, 없으면(개선안이 없거나 예외적으로 비어있으면) 기존
// reasons 문장으로 폴백한다.
export function RecommendationChecklist({
  recommendation,
  recommendationFailed = false,
  isComputingRecommendation = false,
  sentinels,
  currentUtilityScore,
  formatValue,
  planAssetStatus,
}: RecommendationChecklistProps) {
  if (isComputingRecommendation) {
    return (
      <GlassCard className="flex items-center gap-2 text-sm text-foreground-muted">
        <Loader2 size={14} className="animate-spin" aria-hidden="true" />
        <span>AI가 최적 인출 전략을 탐색하고 있습니다...</span>
      </GlassCard>
    );
  }

  if (recommendationFailed) {
    return (
      <GlassCard className="text-sm text-foreground-muted">
        🤖 AI 추천 전략을 계산하지 못했습니다. 잠시 후 다시 시도해주세요.
      </GlassCard>
    );
  }

  if (!recommendation) return null;

  if (!recommendation.improved || recommendation.itemizedContributions.length === 0) {
    return (
      <GlassCard>
        <h3 className="mb-2 text-base font-semibold">🤖 AI 추천 전략</h3>
        <ul className="flex flex-col gap-1.5 pl-5 text-sm text-foreground-muted">
          {recommendation.reasons.map((reason, i) => (
            <li key={i}>{reason}</li>
          ))}
        </ul>
      </GlassCard>
    );
  }

  // AI 센티널이 이미 계산에 넣은 축은 "할 일"이 아니다.
  //
  // 이 분리가 없으면 엔진이 이미 70세로 도는데 체크리스트는 "국민연금을 70세까지 연기
  // 수령하세요"를 체크 아이콘과 함께 할 일로 계속 제시한다. 사용자가 그 지시를 따라 버튼을
  // 눌러도 숫자는 하나도 움직이지 않는다.
  //
  // 라벨 문자열이 아니라 field로 가른다 — 문구에는 수치가 섞여 있어 매칭 기준이 될 수 없다.
  const appliedFields = sentinels?.appliedFields ?? [];
  const { applied: alreadyApplied, recommended, conditional } = groupRecommendationItems(
    recommendation.itemizedContributions,
    appliedFields
  );
  const remaining = [...recommended, ...conditional];

  // 헤드라인은 "여기서 더 얻을 수 있는 것"이다. 자동 채움분은 이미 화면의 KPI에 반영돼
  // 있으므로, baseline 대비 총 개선폭을 쓰면 사용자가 이미 가진 몫까지 앞으로 얻을 것처럼
  // 말하게 된다. currentScore는 지금 화면이 보여주는 효용 점수다.
  const currentScore = currentUtilityScore ?? recommendation.currentUtility.score;
  const furtherUtilityDelta = recommendation.recommendedUtility.score - currentScore;

  // 국민연금 조기 수령은 "평생 총 수령액이 줄어드는" 제안이라, 왜 그게 더 나은지를 밝히지
  // 않으면 손해 보는 조언으로만 읽힌다. 투자자산이 없는 계획에서는 그 이유가 분명하고
  // 데이터로 뒷받침되므로(은퇴 직후를 메울 다른 재원이 없다) 한 줄 덧붙인다.
  const earlyPensionRationale = (item: ItemizedContribution): string | null => {
    if (planAssetStatus !== 'no_investable_asset') return null;
    if (item.field !== 'nationalPensionStartAge') return null;
    if (!item.label.includes('조기 수령')) return null;
    return '투자자산이 없어 은퇴 직후 생활비를 메울 재원이 국민연금뿐이므로, 평생 총 수령액이 줄더라도 수령을 앞당겨 초기 공백을 줄이는 쪽이 평생 효용에서 앞섭니다.';
  };

  const renderItem = (item: ItemizedContribution, i: number, applied: boolean) => (
    <li key={i} className="border-b border-card-border pb-3 last:border-none">
      <div className="flex items-start justify-between gap-2">
        <span className="flex items-start gap-2 text-sm">
          {applied ? (
            <Check size={16} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
          ) : (
            <Square size={16} className="mt-0.5 shrink-0 text-foreground-muted" aria-hidden="true" />
          )}
          {item.label}
        </span>
        <span className={`shrink-0 text-sm font-semibold ${item.utilityDelta >= 0 ? 'text-success' : 'text-danger'}`}>
          단독 효용 {item.utilityDelta >= 0 ? '+' : ''}
          {item.utilityDelta}점
        </span>
      </div>
      {earlyPensionRationale(item) && (
        <p className="ml-6 mt-1 text-xs text-foreground-muted">{earlyPensionRationale(item)}</p>
      )}
      <div className="ml-6 mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground-muted">
        {applied && <span className="text-primary">이 값으로 계산 중</span>}
        {formatTaxImpact(item.deltas.totalTax, formatValue) && (
          <span>{formatTaxImpact(item.deltas.totalTax, formatValue)}</span>
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
  );

  return (
    <GlassCard>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold">🤖 AI 추천 전략</h3>
        {furtherUtilityDelta > 0 && (
          <span className="shrink-0 text-sm font-semibold text-success">
            {alreadyApplied.length > 0 ? '남은 개선' : '총 효용'} +{furtherUtilityDelta}점
          </span>
        )}
      </div>

      {alreadyApplied.length > 0 && (
        <>
          <h4 className="mb-2 text-xs font-semibold text-primary">이미 반영됨</h4>
          <ul className="mb-4 flex flex-col gap-3">
            {alreadyApplied.map((item, i) => renderItem(item, i, true))}
          </ul>
        </>
      )}

      {recommended.length > 0 && (
        <>
          {alreadyApplied.length > 0 && (
            <h4 className="mb-2 text-xs font-semibold text-foreground-muted">단독으로도 권장</h4>
          )}
          <ul className="flex flex-col gap-3">
            {recommended.map((item, i) => renderItem(item, i, false))}
          </ul>
        </>
      )}

      {conditional.length > 0 && (
        <section className={recommended.length > 0 ? 'mt-4' : undefined}>
          <h4 className="mb-1 text-xs font-semibold text-warning">전체 조합에서만 유효</h4>
          <p className="mb-2 text-xs text-foreground-muted">
            아래 변경은 단독으로 적용하면 점수가 오르지 않습니다. 위 추천과 함께 적용할 때의 최종
            종합 결과를 확인한 뒤 선택하세요.
          </p>
          <ul className="flex flex-col gap-3">
            {conditional.map((item, i) => renderItem(item, i, false))}
          </ul>
        </section>
      )}

      {remaining.length === 0 && alreadyApplied.length > 0 && (
        <p className="text-sm text-foreground-muted">
          AI가 찾은 개선안은 이미 모두 계산에 반영되어 있습니다. 추가로 하실 일은 없습니다.
        </p>
      )}

      <p className="mt-2 text-xs text-foreground-muted">
        * 단독 효용 점수는 해당 항목 하나만 적용한 결과라 합계가 최종 종합 개선폭과 다를 수 있고, 이미 만점·바닥에
        가까운 항목은 절세·자산 효과가 있어도 +0점으로 보일 수 있습니다.
      </p>
    </GlassCard>
  );
}
