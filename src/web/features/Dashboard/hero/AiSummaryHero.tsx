'use client';

import { useSession } from 'next-auth/react';
import GlassCard from '../../../components/GlassCard';
import { Collapse } from '../../../components/ui';
import { useAiAdvisor, UseAiAdvisorInput } from '../hooks/useAiAdvisor';
import { BeforeAfterMode } from '../hooks/useBeforeAfterToggle';
import { ApplyRecommendationButton } from '../recommendation/ApplyRecommendationButton';
import { buildHeroHeadline } from './heroHeadline';
import { AiAdviceText } from './AiAdviceText';

interface AiSummaryHeroProps extends UseAiAdvisorInput {
  formatValue: (val: number) => string;
  mode: BeforeAfterMode;
  onToggleMode: () => void;
  canApply: boolean;
}

// 결과 화면 최상단 Hero. 한줄 요약(rule-based) + Before/After Utility 비교 + 절세/자산증가
// 요약 + 추천 적용 버튼을 보여주고, LLM이 생성한 전체 AI 의견은 Collapse 안에 격리한다.
export function AiSummaryHero({ formatValue, mode, onToggleMode, canApply, ...advisorInput }: AiSummaryHeroProps) {
  const { data: session } = useSession();
  const userNamePrefix = session?.user?.name ? `${session.user.name}님의 ` : '';
  const { utility, recommendation, depletionAge, userProfile } = advisorInput;
  const aiAdvisor = useAiAdvisor(advisorInput);

  if (!utility) return null;

  const headline = buildHeroHeadline(utility.score, depletionAge, userProfile?.expectancy ?? 90);
  const hasImprovement = !!recommendation?.improved;

  return (
    <GlassCard className="mb-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-bold sm:text-2xl">
            {headline.emoji} {userNamePrefix}
            {headline.text}
          </h2>
          {hasImprovement && recommendation && (
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-foreground-muted">
              <span>
                추천 전략 적용 시 Lifetime Utility{' '}
                <strong className="text-success">
                  {utility.score} → {recommendation.recommendedUtility.score}
                </strong>
              </span>
              {recommendation.deltas.totalTax !== 0 && (
                <span>
                  예상 절세{' '}
                  <strong className={recommendation.deltas.totalTax <= 0 ? 'text-success' : 'text-danger'}>
                    {recommendation.deltas.totalTax <= 0
                      ? formatValue(-recommendation.deltas.totalTax)
                      : `-${formatValue(recommendation.deltas.totalTax)}`}
                  </strong>
                </span>
              )}
              {recommendation.deltas.endingAssets !== 0 && (
                <span>
                  예상 자산 변화{' '}
                  <strong className={recommendation.deltas.endingAssets >= 0 ? 'text-success' : 'text-danger'}>
                    {recommendation.deltas.endingAssets >= 0 ? '+' : '-'}
                    {formatValue(Math.abs(recommendation.deltas.endingAssets))}
                  </strong>
                </span>
              )}
            </div>
          )}
        </div>
        {canApply && <ApplyRecommendationButton mode={mode} onToggle={onToggleMode} />}
      </div>

      <Collapse title="AI 노후 설계사 상세 의견 보기" className="mt-4">
        <AiAdviceText
          displayAdvice={aiAdvisor.displayAdvice}
          isLoading={aiAdvisor.isLoading}
          error={aiAdvisor.error}
          isRuleBased={aiAdvisor.isRuleBased}
          isStale={aiAdvisor.isStale}
          onRetry={aiAdvisor.retry}
        />
      </Collapse>
    </GlassCard>
  );
}
