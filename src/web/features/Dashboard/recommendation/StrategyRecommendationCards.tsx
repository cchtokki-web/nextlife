import { useState } from 'react';
import { Loader2, Star } from 'lucide-react';
import type { SimulationParams } from '../../../../core/entities/types';
import type { RetirementGoalType } from '../../../../core/entities/retirementGoal';
import type { OptimizationOutcome } from '../../../../core/strategy/StrategyOptimizer';
// 「달라지는 점」 문구는 core가 소유한다 — PDF 리포트가 같은 함수를 쓴다.
import { describeStrategyChanges } from '../../../../core/usecases/dashboard/describeStrategyChanges';
import type { CandidateRecommendation } from '../../../../core/recommendation/RecommendationEngine';
import type { SustainableSpendingAdvice } from '../../../../core/usecases/dashboard/computeSustainableSpendingAdvice';
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
  /**
   * 현재 계획에서 「월 얼마까지 쓸 수 있는가」와 목표의 차이. 어떤 전략도 목표에 도달하지
   * 못할 때 그 격차를 숫자로 말하는 데만 쓴다.
   *
   * 새로 계산하지 않는다 — SimulationEngine이 이미 구해 둔 calculatedTargetSpending을
   * computeSustainableSpendingAdvice가 조언으로 옮긴 값이며, 화면의 다른 배너와 같은 출처다.
   * null일 수 있고(고정 생활비 계획이 아니거나 이진탐색이 0으로 수렴한 경우), 그때는 격차를
   * 숫자로 말하지 않는다.
   */
  sustainableSpendingAdvice?: SustainableSpendingAdvice | null;
  params: SimulationParams;
  formatValue: (value: number) => string;
  /**
   * 추천 전략을 사용자의 시나리오 설정에 반영한다. 없으면 적용 액션 자체를 내지 않는다 —
   * 설정을 바꿀 수 없는 읽기 전용 문맥을 위한 여지다(PDF 리포트는 이 컴포넌트가 아니라
   * pdfReportSections가 따로 그리며, 공유하는 것은 describeStrategyChanges뿐이다).
   */
  onApplyStrategy?: (recommendation: CandidateRecommendation) => void;
  /**
   * 지금 적용하면 실제로 바뀌는 설정이 있는가. 아래 「달라지는 점」의 개수로 대신 세면 안
   * 된다 — 그 목록은 센티널이 채운 계산용 params 기준이고, 적용 대상은 사용자가 입력한
   * 설정이라 국민연금·투자 성향 축에서 두 판정이 엇갈린다.
   */
  canApplyStrategy?: (recommendation: CandidateRecommendation) => boolean;
  /**
   * 방금 적용한 후보. 그 카드는 적용 버튼 대신 「적용 해제」를 낸다.
   *
   * 호출자는 «되돌릴 수 있는 동안에만» 이 값을 채워야 한다. 카드는 이 값 하나로 해제
   * 버튼을 내므로, 되돌릴 수 없는 상태에서 값이 남아 있으면 눌러도 아무 일이 없는 버튼이
   * 생긴다. 현재 호출자(page.tsx)는 그 조건에서만 값을 갖는 useAppliedStrategy의
   * snapshot에서 이 id를 가져와 조건을 만족한다.
   */
  appliedCandidateId?: string;
  /**
   * 적용한 전략을 적용 직전 설정으로 되돌린다. 없으면 적용된 카드를 「적용됨」 비활성
   * 표시로만 남긴다 — 설정을 바꿀 수 없는 읽기 전용 문맥을 위한 여지다.
   */
  onUndoStrategy?: () => void;
}

interface StrategyApplyActionProps {
  recommendation: CandidateRecommendation;
  onApply: (recommendation: CandidateRecommendation) => void;
  canApply: boolean;
  /** 카드가 「달라지는 점」을 하나라도 보여주고 있는가. 비활성 문구를 고르는 데만 쓴다. */
  hasDescribedChanges: boolean;
  applied: boolean;
  /** 적용 상태를 되돌린다. 없으면 적용된 카드는 비활성 표시로만 남는다. */
  onUndo?: () => void;
}

/**
 * 카드 하단 액션. 상태에 따라 셋 중 하나를 낸다 — 적용된 카드의 「적용 해제」, 적용할 것이
 * 없을 때의 비활성 표시, 그리고 적용 버튼과 그 자리에서 펼쳐지는 확인 단계.
 *
 * 확인 단계에 모달을 쓰지 않는 이유: 확인 모달의 값어치는 "무엇이 바뀌는지" 목록을 보여주는 데 있는데,
 * 그 목록은 바로 위 「현재 계획에서 달라지는 점」에 이미 상시 표시돼 있다. 모달을 띄우면
 * 같은 목록을 두 번 보여주면서 근거가 되는 카드 본문만 가린다.
 */
function StrategyApplyAction({
  recommendation, onApply, canApply, hasDescribedChanges, applied, onUndo,
}: StrategyApplyActionProps) {
  const [confirming, setConfirming] = useState(false);

  // 적용한 자리에서 바로 되돌린다. 되돌리기 배너는 대시보드 «바깥»에 있어서 카드를 보고
  // 있는 사용자에게는 취소 경로가 보이지 않는다.
  //
  // 되돌릴 수 있을 때에만 이 버튼이 뜬다는 보장은 호출부가 한다(appliedCandidateId 주석).
  //
  // 확인 단계를 두지 않는 이유: 적용할 때 이미 한 번 확인했고, 해제는 그 확인을 취소하는
  // 방향이라 사용자가 잃을 것이 없다.
  if (applied && onUndo) {
    return (
      <div className={styles.strategyCardActions}>
        <button
          type="button"
          className={styles.undoAppliedStrategyButton}
          onClick={onUndo}
        >
          적용 해제
        </button>
      </div>
    );
  }

  if (applied || !canApply) {
    // 「달라지는 점」은 있는데 적용할 것이 없는 경우를 구분한다. 생활비 배분처럼 현재
    // 계획과 다르지만 반영 경로가 없는 축만 남았을 때 "달라지는 점이 없습니다"라고 하면
    // 바로 위 목록과 정면으로 모순된다.
    const label = applied ? '적용됨'
      : hasDescribedChanges ? '반영할 수 있는 설정이 없습니다'
      : '달라지는 점이 없습니다';
    return (
      <div className={styles.strategyCardActions}>
        <button type="button" className={styles.applyStrategyButton} disabled>
          {label}
        </button>
      </div>
    );
  }

  if (!confirming) {
    return (
      <div className={styles.strategyCardActions}>
        <button
          type="button"
          className={styles.applyStrategyButton}
          onClick={() => setConfirming(true)}
        >
          이 전략 적용
        </button>
      </div>
    );
  }

  return (
    <div className={styles.strategyCardActions} aria-live="polite">
      {/* 되돌리기는 이 세션에서만 가능하다(스냅샷을 저장하지 않는다). 누르기 전에 밝힌다. */}
      <p className={styles.applyStrategyNotice}>
        현재 시나리오 설정이 바뀝니다. 되돌리기는 이 화면을 새로고침하기 전까지만 가능합니다.
      </p>
      <div className={styles.applyStrategyConfirm}>
        <button
          type="button"
          className={styles.applyStrategyCancel}
          onClick={() => setConfirming(false)}
        >
          취소
        </button>
        <button
          type="button"
          className={styles.applyStrategyButton}
          onClick={() => {
            setConfirming(false);
            onApply(recommendation);
          }}
        >
          적용
        </button>
      </div>
    </div>
  );
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

/**
 * 어떤 전략으로도 목표에 도달하지 못할 때, 전략 카드 대신 «격차»를 보여준다.
 *
 * 카드를 그대로 두고 경고만 얹지 않는 이유: 모든 후보가 0%면 세 비교자가 전부 동률이라
 * 카드의 순서도 ☆추천도 근거가 없고(noRecommendationReachesGoal 주석), 수치까지 서로 같아
 * 두 장이 나란히 서면 "둘 중 하나를 고르라"는 뜻으로만 읽힌다. 실제로 사용자가 할 수 있는
 * 일은 전략을 고르는 것이 아니라 목표나 저축을 바꾸는 것이므로, 화면도 그것을 말해야 한다.
 */
function UnreachableGoalCard({
  outcome,
  advice,
  formatValue,
}: {
  outcome: Extract<OptimizationOutcome, { kind: 'no_candidate_reaches_goal' }>;
  advice?: SustainableSpendingAdvice | null;
  formatValue: (value: number) => string;
}) {
  return (
    <GlassCard className={styles.unreachableGoal} role="note">
      <div className={styles.unreachableGoalHeadline}>
        <span aria-hidden="true">🔴</span>
        <h3>어떤 전략으로도 목표에 도달하지 못합니다</h3>
      </div>
      <p className={styles.unreachableGoalSummary}>
        전략 {outcome.validatedCount}개를 검증했지만 모두 목표 달성 확률이 0%입니다.
      </p>
      {/* 격차는 계산됐을 때만 말한다. computeSustainableSpendingAdvice는 고정 생활비 계획이
          아니거나 지속가능액이 0으로 수렴하면 null을 내는데, 그때 0원을 찍으면 측정하지 못한
          값을 확신에 찬 숫자로 보여주게 된다. */}
      {advice?.kind === 'overspending' && (
        <dl className={styles.unreachableGoalGap} aria-label="목표와 지속 가능한 생활비의 격차">
          <div><dt>월 생활비 목표</dt><dd>{formatValue(advice.currentMonthly)}</dd></div>
          <div><dt>지속 가능한 월 생활비</dt><dd>{formatValue(advice.sustainableMonthly)}</dd></div>
          <div><dt>부족</dt><dd>{formatValue(advice.difference)}</dd></div>
        </dl>
      )}
      <p className={styles.unreachableGoalAction}>
        목표 생활비를 낮추거나, 은퇴 전 저축·연금 납입을 늘려야 합니다.
      </p>
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
  sustainableSpendingAdvice,
  params,
  formatValue,
  onApplyStrategy,
  canApplyStrategy,
  appliedCandidateId,
  onUndoStrategy,
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

  // 카드 그리드보다 «먼저» 판정한다. 여기서 돌아서면 비교 바와 그리드가 통째로 건너뛰어져,
  // 아래 렌더 경로 곳곳에 0% 조건을 흩뿌리지 않아도 된다.
  if (outcome?.kind === 'no_candidate_reaches_goal') {
    return (
      <UnreachableGoalCard
        outcome={outcome}
        advice={sustainableSpendingAdvice}
        formatValue={formatValue}
      />
    );
  }

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

              {onApplyStrategy && (
                <StrategyApplyAction
                  recommendation={recommendation}
                  onApply={onApplyStrategy}
                  canApply={canApplyStrategy?.(recommendation) ?? changes.length > 0}
                  hasDescribedChanges={changes.length > 0}
                  applied={candidate.candidate.id === appliedCandidateId}
                  onUndo={onUndoStrategy}
                />
              )}
            </article>
          );
        })}
      </div>
    </>
  );
}
