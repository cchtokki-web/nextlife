'use client';

import { useEffect, useState } from 'react';
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
  // 시뮬레이션이 실제로 돈 마지막 나이(SimulationResult.householdEndAge). depletionAge가
  // 이 나이까지의 루프에서 판정되므로 헤드라인의 고갈 여부도 이 값과 비교해야 한다.
  //
  // optional이 아닌 이유: 폴백(userProfile.expectancy)이 있으면 새 호출부가 이 prop을
  // 빠뜨려도 타입 에러 없이 통과하고, 파산하는 계획에 "고갈 위험 없음"이 다시 표시된다
  // (C2 결함). 필수로 두면 그 재발이 구조적으로 불가능하다 — 이 값은 항상
  // SimulationResult에 들어 있으므로 호출부에 부담도 없다.
  householdEndAge: number;
}

// 결과 화면 최상단 Hero. 한줄 요약(rule-based) + Before/After Utility 비교 + 절세/자산증가
// 요약 + 추천 적용 버튼을 보여주고, LLM이 생성한 전체 AI 의견은 Collapse 안에 격리한다.
export function AiSummaryHero({
  formatValue, mode, onToggleMode, canApply, householdEndAge, ...advisorInput
}: AiSummaryHeroProps) {
  const { data: session } = useSession();
  const userNamePrefix = session?.user?.name ? `${session.user.name}님의 ` : '';
  const { utility, recommendation, depletionAge } = advisorInput;
  const aiAdvisor = useAiAdvisor(advisorInput);

  // 에러/rule-based 폴백은 사용자가 반드시 알아야 할 신호라, 접힌 패널 안에 숨어있지 않도록
  // 발생 즉시 자동으로 펼친다(닫는 것은 여전히 사용자가 직접 할 수 있음 — controlled 모드).
  const [isAdviceOpen, setIsAdviceOpen] = useState(false);
  useEffect(() => {
    if (aiAdvisor.error || (aiAdvisor.isRuleBased && !aiAdvisor.isLoading)) {
      setIsAdviceOpen(true);
    }
  }, [aiAdvisor.error, aiAdvisor.isRuleBased, aiAdvisor.isLoading]);

  if (!utility) return null;

  const headline = buildHeroHeadline(utility.score, depletionAge, householdEndAge);
  const hasImprovement = !!recommendation?.improved;

  return (
    <GlassCard>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display flex items-center gap-4 text-xl font-bold sm:text-2xl">
            <span className="text-xs sm:text-sm">{headline.emoji}</span>
            <span>
              {userNamePrefix}
              {headline.text}
            </span>
          </h2>
          {hasImprovement && recommendation && (
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-foreground-muted">
              <span>
                추천 전략 적용 시 평생 효용{' '}
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

      <Collapse
        title={
          <span className="inline-flex items-center gap-2">
            AI 노후 설계사 상세 의견 보기
            {aiAdvisor.error && (
              <span className="rounded-full bg-danger/10 px-2 py-0.5 text-xs font-semibold text-danger">오류 발생</span>
            )}
            {!aiAdvisor.error && aiAdvisor.isRuleBased && !aiAdvisor.isLoading && (
              <span className="rounded-full border border-card-border px-2 py-0.5 text-xs font-semibold text-foreground-muted">
                기본 안내 표시 중
              </span>
            )}
          </span>
        }
        open={isAdviceOpen}
        onOpenChange={setIsAdviceOpen}
        className="mt-6"
      >
        <div
          style={{ padding: '24px 28px' }}
          className="mt-2.5 rounded-2xl border border-card-border bg-foreground/5 px-6 py-5 sm:p-7"
        >
          <AiAdviceText
            displayAdvice={aiAdvisor.displayAdvice}
            isLoading={aiAdvisor.isLoading}
            error={aiAdvisor.error}
            isRuleBased={aiAdvisor.isRuleBased}
            isStale={aiAdvisor.isStale}
            onRetry={aiAdvisor.retry}
          />
        </div>
      </Collapse>
    </GlassCard>
  );
}
