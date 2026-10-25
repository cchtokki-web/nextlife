import { Loader2, Star } from 'lucide-react';
import type { SimulationParams } from '../../../../core/entities/types';
import type { RetirementGoalType } from '../../../../core/entities/retirementGoal';
import type { OptimizationOutcome } from '../../../../core/strategy/StrategyOptimizer';
// 「달라지는 점」 문구는 core가 소유한다 — PDF 리포트가 같은 함수를 쓴다.
import { describeStrategyChanges } from '../../../../core/usecases/dashboard/describeStrategyChanges';
// 「달라지는 수치」도 core가 소유한다 — 같은 이유로 PDF 리포트가 같은 함수를 쓴다.
import { describeStrategyOutcomeChanges } from '../../../../core/usecases/dashboard/describeStrategyOutcomeChanges';
import type { StrategyPlanOutcome } from '../../../../core/usecases/dashboard/summarizePlanOutcome';
import { improvesOnCurrentPlan, PRIMARY_SELECTION_NOTE, type CandidateRecommendation } from '../../../../core/recommendation/RecommendationEngine';
import type { StrategyApplyPreview } from '../../../../core/usecases/dashboard/applyStrategyToParams';
import type { SustainableSpendingAdvice } from '../../../../core/usecases/dashboard/computeSustainableSpendingAdvice';
import type { StrategyOptimizationStatus } from '../../../hooks/useStrategyOptimization';
import type { AppliedStrategySnapshot } from '../../../hooks/useAppliedStrategy';
import { RETIREMENT_GOAL_CONSTRAINT_LABELS } from '../../../../core/entities/retirementGoal';
import { describeGoalSuccessCriteria } from '../../../../core/usecases/goals/goalSuccessConditions';
import { hardConstraintLabel, RETIREMENT_GOAL_CATALOG } from '../../RetirementGoals/goalCatalog';
import GlassCard from '../../../components/GlassCard';
import styles from '../Dashboard.module.css';

interface StrategyRecommendationCardsProps {
  recommendations?: readonly CandidateRecommendation[];
  /**
   * ☆추천이 붙을 카드. 선정 규칙은 RecommendationEngine.selectPrimary 한 곳에만 있다.
   * 화면이 규칙을 다시 구현하면 코어가 규칙을 바꿔도 ☆만 옛 규칙으로 남는다.
   */
  primary?: CandidateRecommendation | null;
  /**
   * 진단 카드가 보여주는 «현재 계획»의 목표 달성 확률. 세 카드가 그보다 나은지 판정하는 데
   * 쓴다 — 페르소나는 「더 나은가」가 아니라 「특성을 가졌는가」로 뽑히므로, 지금보다 나쁜
   * 안이 ☆추천을 달고 올라올 수 있다(improvesOnCurrentPlan 주석).
   *
   * 몬테카를로가 끝나기 전에는 undefined다. 그때는 비교를 «말하지 않는다» — 측정되지 않은
   * 것을 나쁜 것으로 표시하면 안 된다.
   */
  currentGoalProbability?: number;
  status: StrategyOptimizationStatus;
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
   * 현상 유지(= 현재 계획) 후보의 결정론 요약. 「적용하면 달라지는 수치」의 «전» 쪽이다.
   *
   * 화면이 들고 있는 현재 계획 실행 결과가 아니라 옵티마이저가 낸 값을 쓴다 — 이유는
   * StrategyOptimizationResult.baselineOutcome 주석에 있다(전·후가 같은 경로에서 나와야
   * 차이가 곧 변경의 효과가 된다). 없으면 이 블록을 그리지 않는다.
   */
  baselineOutcome?: StrategyPlanOutcome;
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
   *
   * previewStrategyApply와 같은 이유로 서술 기준 params를 함께 넘긴다 — 반영 대상을 사용자
   * 설정만으로 고르면 카드가 말한 축이 반영에서 빠질 수 있다.
   */
  onApplyStrategy?: (
    recommendation: CandidateRecommendation,
    simulatedParams: SimulationParams,
  ) => void;
  /**
   * 지금 적용하면 무슨 일이 일어나는가 — 버튼을 열지 여부와, 「달라지는 점」에 적지 않았지만
   * 함께 확정될 축.
   *
   * 「달라지는 점」의 «개수»로 대신 세면 안 된다 — 목록은 센티널이 채운 계산용 params
   * 기준이고 적용 대상은 사용자가 입력한 설정이라, 국민연금처럼 센티널이 채우는 축에서 두
   * 판정이 엇갈린다. 그래서 판정은 호출자에게 맡기되, 카드가 서술에 쓴 params(아래 `params`)를
   * 함께 넘겨 호출자가 «같은 기준»으로 대조하게 한다.
   */
  previewStrategyApply?: (
    recommendation: CandidateRecommendation,
    simulatedParams: SimulationParams,
  ) => StrategyApplyPreview;
  /**
   * 방금 적용한 전략. 그 후보의 카드는 적용 버튼 대신 「적용 해제」를 낸다.
   *
   * 호출자는 «되돌릴 수 있는 동안에만» 이 값을 채워야 한다. 화면은 이 값 하나로 해제
   * 버튼을 내므로, 되돌릴 수 없는 상태에서 값이 남아 있으면 눌러도 아무 일이 없는 버튼이
   * 생긴다. 현재 호출자(page.tsx)는 그 조건에서만 값을 갖는 useAppliedStrategy의 snapshot을
   * 그대로 넘겨 조건을 만족한다.
   */
  appliedStrategy?: AppliedStrategySnapshot;
  /**
   * 적용한 전략을 적용 직전 설정으로 되돌린다. 없으면 적용된 카드를 「적용됨」 비활성
   * 표시로만 남긴다 — 설정을 바꿀 수 없는 읽기 전용 문맥을 위한 여지다.
   */
  onUndoStrategy?: () => void;
}

interface StrategyApplyActionProps {
  recommendation: CandidateRecommendation;
  /** 서술 기준 params는 카드가 이미 채워 넘긴다 — 액션은 그대로 부르기만 한다. */
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
 * 없을 때의 비활성 표시, 그리고 적용 버튼.
 *
 * 확인 단계를 두지 않는다: 확인의 값어치는 "무엇이 바뀌는지"를 보여주는 데 있는데, 그 목록은
 * 바로 위 「현재 계획에서 달라지는 점」에 이미 상시 표시돼 있다. 적용 결과도 같은 자리의
 * 「적용 해제」로 한 번에 되돌릴 수 있어, 확인 단계는 한 번 더 누르게 할 뿐이었다.
 */
function StrategyApplyAction({
  recommendation, onApply, canApply, hasDescribedChanges, applied, onUndo,
}: StrategyApplyActionProps) {
  // 적용한 자리에서 바로 되돌린다. 화면에 남은 «유일한» 취소 경로다 — 대시보드 바깥의
  // 되돌리기 배너는 제거했다.
  //
  // 되돌릴 수 있을 때에만 이 버튼이 뜬다는 보장은 호출부가 한다(appliedStrategy 주석).
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

  return (
    <div className={styles.strategyCardActions}>
      <button
        type="button"
        className={styles.applyStrategyButton}
        onClick={() => onApply(recommendation)}
      >
        적용
      </button>
    </div>
  );
}

function goalLabel(type: RetirementGoalType): string {
  return RETIREMENT_GOAL_CATALOG.find((goal) => goal.type === type)?.label ?? type;
}

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
    const blocked = outcome.blockedBy.map(hardConstraintLabel).join(', ');
    return (
      <GlassCard className="text-sm text-foreground-muted">
        {outcome.hardConstraintRejectedCount > 0 && (
          <p>
            「{RETIREMENT_GOAL_CONSTRAINT_LABELS.HARD}」로 정한 목표를 동시에 만족하는 전략을
            찾지 못했습니다{blocked && <> — 후보를 막은 조건: {blocked}</>}. 해당 목표의 조건
            강도를 「{RETIREMENT_GOAL_CONSTRAINT_LABELS.SOFT}」으로 바꾸거나 목표치를 조정하면
            후보를 찾을 수 있습니다.
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

/**
 * 적용 상태를 카드 그리드 «밖»에서 한 번 더 말한다.
 *
 * 그리드는 검증 상태에 따라 통째로 사라진다 — 「적용」을 누르면 재분석이 걸리고, 그 순간
 * useStrategyOptimization이 status를 idle로 되돌린 뒤 400ms 디바운스와 워커 검증이 끝날
 * 때까지 스피너만 남는다(수 초). 되돌리기 버튼이 카드 안에만 있으면, 사용자가 되돌리고 싶어
 * 할 «바로 그 순간»에 유일한 취소 경로가 사라진다. 그 사이 자동저장은 이미 돌고 있고
 * 스냅샷은 메모리에만 있어(useAppliedStrategy), 새로고침하면 원본은 영영 사라진다.
 *
 * 반영하지 못한 축도 여기서 밝힌다. 밝히지 않으면 「전략을 적용했다」는 화면의 약속과 실제가
 * 조용히 어긋난다(applyStrategyToParams의 skipped 계약).
 */
function AppliedStrategyStatus({
  snapshot, onUndo, showUndo,
}: {
  snapshot: AppliedStrategySnapshot;
  onUndo: () => void;
  /** 적용된 카드가 화면에 있으면 그 카드의 버튼이 해제를 맡는다 — 같은 버튼을 두 번 두지 않는다. */
  showUndo: boolean;
}) {
  return (
    <div className={styles.appliedStrategyStatus} role="status">
      <div>
        <p className={styles.appliedStrategyStatusTitle}>
          <strong>{snapshot.label}</strong> 전략을 적용했습니다
          {snapshot.appliedLabels.length > 0 && <> · {snapshot.appliedLabels.join(', ')}</>}
        </p>
        {snapshot.skippedLabels.length > 0 && (
          <p className={styles.appliedStrategySkippedNote}>
            {snapshot.skippedLabels.join(', ')}은(는) 반영하지 못했습니다.
          </p>
        )}
      </div>
      {showUndo && (
        <button type="button" className={styles.undoAppliedStrategyButton} onClick={onUndo}>
          적용 해제
        </button>
      )}
    </div>
  );
}

export function StrategyRecommendationCards(props: StrategyRecommendationCardsProps) {
  const { recommendations, status, outcome, appliedStrategy, onUndoStrategy } = props;

  // 적용된 카드가 실제로 그려지는 경우에만 카드가 해제를 맡는다. 검증 중이거나(idle/running)
  // 결과가 카드 대신 안내로 대체된 경우(도달 불가·후보 없음), 그리고 재생성된 후보 목록에
  // 그 id가 없는 경우까지 여기서 함께 판정한다.
  const appliedCardIsVisible = status === 'done'
    && outcome?.kind !== 'no_candidate_reaches_goal'
    && (recommendations ?? []).some(
      (item) => item.candidate.candidate.id === appliedStrategy?.candidateId
    );

  return (
    <>
      {appliedStrategy && onUndoStrategy && (
        <AppliedStrategyStatus
          snapshot={appliedStrategy}
          onUndo={onUndoStrategy}
          showUndo={!appliedCardIsVisible}
        />
      )}
      <RecommendationBody {...props} />
    </>
  );
}

function RecommendationBody({
  recommendations,
  primary,
  currentGoalProbability,
  status,
  errorMessage,
  unsupportedHardGoals,
  outcome,
  baselineOutcome,
  sustainableSpendingAdvice,
  params,
  formatValue,
  onApplyStrategy,
  previewStrategyApply,
  appliedStrategy,
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

  // 카드 그리드보다 «먼저» 판정한다. 여기서 돌아서면 그리드가 통째로 건너뛰어져,
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

  // 워커를 건너온 primary는 구조적 복제라 배열 원소와 다른 객체다. 참조로 비교하면 ☆이
  // 어느 카드에도 붙지 않는다. 후보 id로 짚는다.
  //
  // primary가 없으면 ☆을 아예 붙이지 않는다. 첫 카드로 폴백하면 엔진이 고르지 않은 카드가
  // 「NextLife가 고른 안」으로 보인다 — 0%뿐인 후보군에서 ☆을 거두는 것과 같은 이유다.
  //
  // 지금 계획보다 나쁜 안에는 ☆을 붙이지 않는다. ☆는 「고를 만한 안」이라는 뜻이고,
  // 그 뜻이 거짓이 되면 배지가 사용자를 잘못된 조작으로 이끈다. 판정은 core가 소유한다.
  const recommendedId = primary?.candidate.candidate.id;
  const recommended = recommendedId === undefined
    ? undefined
    : finalRecommendations
      .filter((item) => improvesOnCurrentPlan(item.candidate, currentGoalProbability))
      .find((item) => item.candidate.candidate.id === recommendedId);

  // 세 카드가 모두 지금보다 나쁘면 사용자가 할 «옳은 일»은 아무것도 하지 않는 것이다.
  // 그 말을 하지 않으면 화면은 셋 중 하나를 고르라는 뜻으로만 읽힌다.
  const noneImproves = currentGoalProbability !== undefined
    && finalRecommendations.every((item) => !improvesOnCurrentPlan(item.candidate, currentGoalProbability));
  return (
    <>
      {unsupportedHardGoals && unsupportedHardGoals.length > 0 && (
        <GlassCard className={styles.unsupportedHardGoalNotice} role="note">
          <strong>
            다음 「{RETIREMENT_GOAL_CONSTRAINT_LABELS.HARD}」 목표는 현재 검증할 수 없습니다:
          </strong>{' '}
          {unsupportedHardGoals.map(goalLabel).join(', ')}. 아래 추천은 이 목표를 만족하는지
          확인하지 않은 결과입니다.
        </GlassCard>
      )}

      {/* 「현재 계획 N% → 추천 전략 적용 M%」 비교 바는 제거했다. 왼쪽 숫자는 바로 위 진단
          카드의 「목표 달성 확률」과 같은 값이고, 오른쪽 숫자는 아래 ☆추천 카드의 「목표 달성
          확률」과 같은 값이라 화면에 같은 두 숫자가 세 번 나왔다. */}
      {/* **추천할 것이 없으면 「아무것도 바꾸지 않는 것」 자체를 추천한다.**

          예전에는 이 자리가 작은 안내 문장 하나였고 그 아래에 세 카드가 평소와 똑같은 비중으로
          섰다. 그러면 화면은 여전히 「셋 중 하나를 고르라」는 뜻으로 읽히고, 사용자는 「그럼
          추천은 왜 보여주지?」에서 멈춘다. 판정(improvesOnCurrentPlan)은 이미 core가 내리고
          있었는데 화면이 그 결론을 카드로 «세우지» 않았을 뿐이다.

          세 카드를 지우지는 않는다. 축을 바꿔 보고 싶은 사용자의 유일한 경로이고, 무엇을
          검토했는지가 곧 이 판정의 근거이기도 하다. 비중만 낮춘다. */}
      {noneImproves && (
        <GlassCard className={styles.keepCurrentPlanCard} role="note" aria-labelledby="keep-current-plan-title">
          <p className={styles.keepCurrentPlanTitle} id="keep-current-plan-title">추천: 현재 계획 유지</p>
          {currentGoalProbability !== undefined && (
            <p className={styles.keepCurrentPlanProbability}>{Math.round(currentGoalProbability * 100)}%</p>
          )}
          <p className={styles.keepCurrentPlanBody}>
            현재 설정이 분석된 대안 {finalRecommendations.length}개 중 가장 높은 목표 달성 확률을 보입니다.
            아래 추천은 모두 지금보다 목표 달성 확률이 낮습니다.
          </p>
        </GlassCard>
      )}

      {noneImproves && (
        <p className={styles.alternativesHeading}>다른 선택을 검토하고 싶다면</p>
      )}

      <div className={`${styles.recommendationGrid} ${noneImproves ? styles.deemphasizedGrid : ''}`}>
        {finalRecommendations.map((recommendation) => {
          const candidate = recommendation.candidate;
          const probability = candidate.monteCarlo.goalSuccessProbability;
          const averageFulfillment = candidate.monteCarlo.averageSpendingFulfillmentRate;
          const criteria = candidate.monteCarlo.goalConditions
            ? describeGoalSuccessCriteria(
              candidate.monteCarlo.goalConditions,
              params.userProfile.expectancy,
              formatValue,
            )
            : null;
          const changes = describeStrategyChanges(params, candidate, formatValue);
          // 축이 아니라 «결과»의 전후. 현상 유지 후보가 시뮬레이션까지 가지 못했으면
          // (HARD 제약 탈락) 비교할 「전」이 없어 빈 배열이고, 아래 블록이 통째로 빠진다.
          const outcomeChanges = describeStrategyOutcomeChanges(
            baselineOutcome, candidate.outcome, formatValue,
          );
          // 테두리 강조는 «지금 적용된» 카드에만 준다. 엔진이 고른 ☆추천은 배지가 말하고,
          // 적용 상태는 그 카드가 다른 카드와 다르게 보인다는 것으로 말한다. 아무것도
          // 적용하지 않았으면 어떤 카드도 강조하지 않는다 — 강조된 카드가 늘 하나 있으면
          // 사용자는 그것을 "이미 골라 둔 것"으로 읽는다.
          const applied = candidate.candidate.id === appliedStrategy?.candidateId;
          // 버튼 활성화와 예고 문구는 «한 번의» 판정에서 나온다. 두 번 물으면 "확정됩니다"만
          // 뜨고 버튼은 잠긴 카드가 생길 수 있다.
          //
          // 판정자가 없는 읽기 전용 문맥에서는 카드가 아는 것만으로 폴백한다 — 그 문맥에는
          // 반영 대상 자체가 없으므로 예고할 축도 없다.
          const preview = previewStrategyApply?.(recommendation, params)
            ?? { canApply: changes.length > 0, pinned: [] };
          return (
            <article
              key={candidate.candidate.id}
              className={`${styles.strategyCard} ${applied ? styles.appliedStrategyCard : ''}`}
              // 강조를 색으로만 말하지 않는다. 화면을 보지 않는 사용자에게도 어느 카드가
              // 적용 중인지 드러나야 한다.
              aria-current={applied ? 'true' : undefined}
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
              {/* 헤더 아래의 «모든 것»을 한 덩어리로 묶는다. 카드 설명이 한 줄인 카드와
                  두 줄인 카드가 섞여도 세 카드의 첫 지표(「목표 달성 확률」)가 같은
                  높이에서 시작하도록, 그리드가 [헤더][본문] 두 행을 카드에 물려준다.
                  정렬을 «만드는» 것은 이 div가 아니라 Dashboard.module.css의
                  .recommendationGrid(grid-template-rows: auto 1fr)와 .strategyCard
                  (grid-template-rows: subgrid)다 — 이 div는 그 두 번째 행에 들어가는 쪽이다.
                  그래서 카드의 직계 자식은 header와 이 div «둘»이어야 한다. 셋이 되면
                  물려받은 행이 모자라 암묵 행이 생기고 정렬이 깨진다. */}
              <div className={styles.strategyCardBody}>
                <dl className={styles.strategyMetrics}>
                  <div>
                    <dt>목표 달성 확률</dt>
                    <dd>
                      {Math.round(probability * 100)}%
                      {/* 증감을 백분율«점»으로 말한다. 확률의 차이는 비율이 아니다 —
                          67%에서 47%로 내려간 것을 "30% 감소"로 적으면 다른 뜻이 된다. */}
                      {currentGoalProbability !== undefined && (
                        <span className={styles.strategyDelta}>
                          현재 계획 {Math.round(currentGoalProbability * 100)}%보다{' '}
                          {Math.abs(Math.round(probability * 100) - Math.round(currentGoalProbability * 100))}%p{' '}
                          {improvesOnCurrentPlan(candidate, currentGoalProbability) ? '높음' : '낮음'}
                        </span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>목표생활비 완전 충족률</dt>
                    <dd>{Math.round(candidate.monteCarlo.spendingSuccessProbability * 100)}%</dd>
                  </div>
                  {averageFulfillment !== undefined && (
                    <div>
                      <dt>평균 목표생활비 충족도</dt>
                      <dd>{Math.round(averageFulfillment * 1000) / 10}%</dd>
                    </div>
                  )}
                  <div>
                    <dt>{params.userProfile.expectancy}세까지 자산 유지 확률</dt>
                    <dd>{Math.round(candidate.monteCarlo.assetSurvivalProbability * 100)}%</dd>
                  </div>
                  {/* 결정론 경로의 endingAssets로 대체하지 않는다. 같은 라벨 아래에서 1,000회
                      시행의 중앙값과 단일 경로 값이 섞이면 사용자는 둘을 구분할 수 없다. */}
                  <div><dt>예상 잔여자산(중앙값)</dt><dd>{formatValue(candidate.monteCarlo.terminalAssetMedian)}</dd></div>
                </dl>
                {criteria && (
                  <p className={styles.strategyProbabilityCriteria}>
                    목표 달성 확률 판정 조건: {criteria}
                  </p>
                )}

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
                  {/* 위 목록이 "이것만 바뀐다"는 약속으로 읽히지 않게, 함께 확정될 축을 누르기
                      «전»에 말한다. 적용 후의 알림에만 있으면 사용자는 되돌리기로만 알게 된다.
                      버튼이 잠긴 카드에서는 일어날 일 자체가 없으므로 내지 않는다. */}
                  {preview.canApply && preview.pinned.length > 0 && (
                    <p className={styles.strategyPinNote}>
                      적용하면 NextLife가 자동으로 고른{' '}
                      {preview.pinned.map((field) => field.label).join(', ')}이(가) 지금 값 그대로
                      설정에 함께 확정됩니다.
                    </p>
                  )}
                </div>

                {/* **설정이 아니라 결과를 말하는 자리.** 「국민연금 65세 → 60세」만 보고
                    적용하면 수령액이 30% 깎이는 것을 누른 뒤에 알게 된다. 그 대가를 누르기
                    전에 같은 카드에서 보여준다(describeStrategyOutcomeChanges). */}
                {outcomeChanges.length > 0 && (
                  <div className={styles.strategyOutcomeChanges}>
                    <h4>적용하면 달라지는 수치</h4>
                    <dl>
                      {outcomeChanges.map((change) => (
                        <div key={change.key}>
                          <dt>{change.label}</dt>
                          <dd>
                            <span>{change.before}</span>
                            <b aria-hidden="true">→</b>
                            <strong
                              className={change.direction === 'neutral'
                                ? undefined
                                : (change.difference > 0) === (change.direction === 'higher_is_better')
                                  ? styles.outcomeBetter
                                  : styles.outcomeWorse}
                            >
                              {change.after}
                            </strong>
                          </dd>
                        </div>
                      ))}
                    </dl>
                    <p className={styles.strategyOutcomeNote}>
                      현재 계획과 이 전략을 같은 기준 수익률 경로로 각각 다시 계산한 값입니다.
                      위 확률과 달리 시장 변동은 반영하지 않습니다.
                    </p>
                  </div>
                )}

                {onApplyStrategy && (
                  <StrategyApplyAction
                    recommendation={recommendation}
                    onApply={(item) => onApplyStrategy(item, params)}
                    canApply={preview.canApply}
                    hasDescribedChanges={changes.length > 0}
                    applied={applied}
                    onUndo={onUndoStrategy}
                  />
                )}
              </div>
            </article>
          );
        })}
      </div>
      {/* ☆이 왜 저 카드에 붙었는지 밝힌다. 규칙이 「확률 최고」가 아니게 된 뒤로는 밝히지
          않으면 확률이 더 높은 카드가 옆에 있을 때 배지가 오류로 읽힌다. */}
      {recommended !== undefined && (
        <p className={styles.primarySelectionNote}>{PRIMARY_SELECTION_NOTE}</p>
      )}
    </>
  );
}
