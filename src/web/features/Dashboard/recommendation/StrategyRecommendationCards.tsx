import { Loader2, Star } from 'lucide-react';
import type { SimulationParams } from '../../../../core/entities/types';
import type { RetirementGoalType } from '../../../../core/entities/retirementGoal';
import type { OptimizationOutcome } from '../../../../core/strategy/StrategyOptimizer';
// 「달라지는 점」 문구는 core가 소유한다 — PDF 리포트가 같은 함수를 쓴다.
import { describeStrategyChanges } from '../../../../core/usecases/dashboard/describeStrategyChanges';
import type { CandidateRecommendation } from '../../../../core/recommendation/RecommendationEngine';
import type { StrategyOptimizationStatus } from '../../../hooks/useStrategyOptimization';
import { RETIREMENT_GOAL_CATALOG } from '../../RetirementGoals/goalCatalog';
import GlassCard from '../../../components/GlassCard';
import styles from '../Dashboard.module.css';

interface StrategyRecommendationCardsProps {
  recommendations?: readonly CandidateRecommendation[];
  status: StrategyOptimizationStatus;
  currentGoalProbability?: number;
  /** Worker failure detail. Without it an "오류" card cannot tell the user or support what broke. */
  errorMessage?: string;
  /**
   * HARD goals the engine could not quantify. They do NOT fail a candidate, so a strategy can be
   * recommended while one of the user's non-negotiable goals was never actually checked. Hiding
   * this turns "not verified" into an implied "verified".
   */
  unsupportedHardGoals?: readonly RetirementGoalType[];
  /** Why the run produced no recommendation. Absent means the caller has no result to explain. */
  outcome?: OptimizationOutcome;
  params: SimulationParams;
  formatValue: (value: number) => string;
}

function goalLabel(type: RetirementGoalType): string {
  return RETIREMENT_GOAL_CATALOG.find((goal) => goal.type === type)?.label ?? type;
}

const HARD_CONSTRAINT_LABELS: Record<string, string> = {
  HARD_RETIREMENT_AGE: '희망 은퇴 나이',
  HARD_SPENDING_SHORTFALL: '목표 생활비 유지',
  HARD_ASSET_SURVIVAL: '자산 고갈 방지',
  HARD_MINIMUM_ENDING_ASSETS: '최소 기말자산',
  HARD_UNSPECIFIED: '사유가 기록되지 않은 필수 조건',
};

/**
 * 결과가 없을 때 원인별로 다른 안내를 낸다. 예전에는 네 가지 원인이 모두
 * "현재 목표 조건을 만족하는 추천 후보가 없습니다" 하나로 표시돼, 엔진이 전부 예외로 죽은
 * 경우에도 사용자에게는 "당신의 목표가 불가능하다"는 뜻으로 읽혔다.
 */
function EmptyOutcomeCard({ outcome }: { outcome?: OptimizationOutcome }) {
  if (outcome?.kind === 'no_candidate_generated') {
    return (
      <GlassCard className="text-sm text-foreground-muted">
        입력만으로는 비교할 전략을 만들지 못했습니다. 자산과 연금 정보가 입력되어 있는지
        확인해 주세요.
      </GlassCard>
    );
  }

  if (outcome?.kind === 'no_persona_matched') {
    return (
      <GlassCard className="text-sm text-foreground-muted">
        전략 {outcome.validatedCount}개를 검증했지만 안정형·균형형·여유형 중 어느 특성에도
        해당하지 않아 추천 카드를 만들지 못했습니다. 상세 분석에서 개별 전략은 계속 확인할 수
        있습니다.
      </GlassCard>
    );
  }

  if (outcome?.kind === 'no_candidate_survived') {
    const blocked = outcome.blockedBy
      .map((code) => HARD_CONSTRAINT_LABELS[code] ?? code)
      .join(', ');
    return (
      <GlassCard className="text-sm text-foreground-muted">
        {outcome.hardConstraintRejectedCount > 0 && (
          <p>
            선택한 필수(HARD) 목표를 동시에 만족하는 전략을 찾지 못했습니다
            {blocked && <> — 후보를 막은 조건: {blocked}</>}. 해당 목표를 선택 목표(SOFT)로
            바꾸거나 목표치를 조정하면 후보를 찾을 수 있습니다.
          </p>
        )}
        {outcome.failedCount > 0 && (
          <p className={outcome.hardConstraintRejectedCount > 0 ? styles.recommendationErrorDetail : undefined}>
            또한 전략 {outcome.failedCount}개는 계산 중 오류로 평가하지 못했습니다.
            {outcome.firstFailureReason && <> (원인: {outcome.firstFailureReason})</>}
          </p>
        )}
      </GlassCard>
    );
  }

  return (
    <GlassCard className="text-sm text-foreground-muted">
      현재 목표 조건을 만족하는 추천 후보가 없습니다.
    </GlassCard>
  );
}

export function StrategyRecommendationCards({
  recommendations,
  status,
  currentGoalProbability,
  errorMessage,
  unsupportedHardGoals,
  outcome,
  params,
  formatValue,
}: StrategyRecommendationCardsProps) {
  if (status === 'running') {
    return (
      <GlassCard className="flex items-center gap-2 text-sm text-foreground-muted">
        <Loader2 size={16} className="animate-spin" aria-hidden="true" />
        최종 후보의 시장 변동 경로를 검증하고 있습니다...
      </GlassCard>
    );
  }

  // idle은 "아무것도 실행 중이 아님"이다. 예전에는 running과 함께 스피너를 돌려서, 검증이
  // 시작조차 못한 상태가 "검증 중"으로 보였다.
  if (status === 'idle') {
    return (
      <GlassCard className="text-sm text-foreground-muted">
        입력이 준비되면 추천 전략 검증을 시작합니다.
      </GlassCard>
    );
  }

  if (status === 'unsupported') {
    return (
      <GlassCard className="text-sm text-foreground-muted">
        이 브라우저에서는 백그라운드 검증(Web Worker)을 실행할 수 없어 추천 전략을 계산하지
        못했습니다. 최신 브라우저에서 다시 시도해 주세요. 현재 계획 분석과 상세 분석은 계속
        확인할 수 있습니다.
      </GlassCard>
    );
  }

  if (status === 'error') {
    return (
      <GlassCard className="text-sm text-foreground-muted">
        <p>추천 전략을 검증하는 중 오류가 발생했습니다. 현재 계획 분석과 상세 분석은 계속 확인할 수 있습니다.</p>
        {errorMessage && <p className={styles.recommendationErrorDetail}>오류 내용: {errorMessage}</p>}
      </GlassCard>
    );
  }

  // 페르소나 배정은 RecommendationEngine 한 곳에서만 한다. 예전의 UI 폴백은 rank로 persona를
  // 지어내고 "목표 달성확률과 전략 특성을 기준으로 선택했습니다"라는 근거까지 붙였는데,
  // 그 선택은 실제로 일어난 적이 없었다.
  const finalRecommendations = recommendations ?? [];

  if (finalRecommendations.length === 0) {
    return <EmptyOutcomeCard outcome={outcome} />;
  }

  const recommended = finalRecommendations.find((item) => item.persona === 'BALANCED')
    ?? finalRecommendations[0];
  return (
    <>
      {unsupportedHardGoals && unsupportedHardGoals.length > 0 && (
        <GlassCard className={styles.unsupportedHardGoalNotice} role="note">
          <strong>다음 필수(HARD) 목표는 현재 검증할 수 없습니다:</strong>{' '}
          {unsupportedHardGoals.map(goalLabel).join(', ')}. 아래 추천은 이 목표를 만족하는지
          확인하지 않은 결과입니다.
        </GlassCard>
      )}

      <div className={styles.recommendationComparison} aria-label="현재 계획과 추천 전략 비교">
        {/* 라벨은 진단 카드의 「목표 달성 확률」과 같은 값이다. 여기서 '달성률' 같은 다른
            이름을 쓰면 사용자는 서로 다른 지표로 읽는다 — 이 비교바가 말하는 것은 "무엇을"이
            아니라 "현재 → 추천"이므로 좌측은 계획의 이름만 적는다. */}
        <div>
          <span>현재 계획</span>
          <strong>{currentGoalProbability === undefined ? '계산 중' : `${Math.round(currentGoalProbability * 100)}%`}</strong>
        </div>
        <span className={styles.comparisonArrow} aria-hidden="true">→</span>
        <div>
          <span>추천 전략 적용</span>
          <strong>{Math.round(recommended.candidate.monteCarlo.goalSuccessProbability * 100)}%</strong>
        </div>
      </div>

      <div className={styles.recommendationGrid}>
        {finalRecommendations.map((recommendation) => {
          const candidate = recommendation.candidate;
          const probability = candidate.monteCarlo.goalSuccessProbability;
          const changes = describeStrategyChanges(params, candidate, formatValue);
          return (
            <article
              key={candidate.candidate.id}
              className={`${styles.strategyCard} ${recommendation === recommended ? styles.recommendedStrategyCard : ''}`}
            >
              <header className={styles.strategyCardHeader}>
                <div>
                  <p className={styles.strategyLabel}>{recommendation.label}</p>
                  <p className={styles.strategySummary}>
                    {recommendation.reason}
                  </p>
                </div>
                {recommendation === recommended && (
                  <span className={styles.recommendedBadge}><Star size={13} aria-hidden="true" /> 추천</span>
                )}
              </header>

              <dl className={styles.strategyMetrics}>
                <div><dt>목표 달성 확률</dt><dd>{Math.round(probability * 100)}%</dd></div>
                <div><dt>생활비</dt><dd>월 {formatValue(candidate.candidate.strategy.targetMonthlySpending)}</dd></div>
                {/* 결정론 경로의 endingAssets로 대체하지 않는다. 같은 라벨 아래에서 1,000회
                    시행의 중앙값과 단일 경로 값이 섞이면 사용자는 둘을 구분할 수 없다. */}
                <div><dt>예상 잔여자산(중앙값)</dt><dd>{formatValue(candidate.monteCarlo.terminalAssetMedian)}</dd></div>
              </dl>

              <div className={styles.strategyChanges}>
                <h4>현재 계획에서 달라지는 점</h4>
                {changes.length > 0 ? (
                  <dl>
                    {changes.map((change) => (
                      <div key={change.label}>
                        <dt>{change.label}</dt>
                        <dd><span>{change.before}</span><b aria-hidden="true">→</b><strong>{change.after}</strong></dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p>핵심 설정은 유지하고 시장 변동 안정성만 재검증한 전략입니다.</p>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
