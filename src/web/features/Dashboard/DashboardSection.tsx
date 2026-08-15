'use client';

import React, { type ReactNode } from 'react';
import { type LegendPayload } from 'recharts';
import { Award, Zap, TrendingUp, AlertTriangle } from 'lucide-react';
import { SimulationParams, SimulationResult, StrategyRecommendation } from '../../../core/entities/types';
import styles from './Dashboard.module.css';
import { formatValue as formatValueForCurrency } from './charts/chartFormatters';
import { AssetGrowthChart, DEFAULT_HIDDEN_PERCENTILE_KEYS } from './charts/AssetGrowthChart';
import { IncomeCompositionChart } from './charts/IncomeCompositionChart';
import { SpendingCompositionChart } from './charts/SpendingCompositionChart';
import { CoreKpiGrid } from './kpi/CoreKpiGrid';
import { ShortfallSummaryCard } from './kpi/ShortfallSummaryCard';
import { RecommendationChecklist } from './recommendation/RecommendationChecklist';
import { AiSummaryHero } from './hero/AiSummaryHero';
import { ExpertDetailsPanel } from './expert/ExpertDetailsPanel';
import { RiskAlertCards } from './risk/RiskAlertCards';
import { UtilityInsightSection } from './insights/UtilityInsightSection';
import { MonteCarloSection } from './montecarlo/MonteCarloSection';
import { MonteCarloResult } from '../../../core/entities/montecarlo';
import { MonteCarloStatus } from '../../hooks/useMonteCarlo';
import { SequenceRiskResult } from '../../../core/usecases/montecarlo/sequenceRisk';
import { useBeforeAfterToggle } from './hooks/useBeforeAfterToggle';
import { ExecutionRoadmap } from './roadmap/ExecutionRoadmap';
import { computeExecutionRoadmap, selectDepletionAge } from '../../../core/usecases/dashboard/computeExecutionRoadmap';
import { computeKeyLevers } from '../../../core/usecases/dashboard/computeKeyLevers';
import {
  getPlanConfidenceBand,
  PLAN_CONFIDENCE_BAND_TIER,
} from '../../../core/usecases/dashboard/computePlanConfidence';
import { KeyLeversCard } from './recommendation/KeyLeversCard';
import { NATIONAL_PENSION_NORMAL_START_AGE } from '../../../core/usecases/pension/nationalPensionRules';
import { compileStrategy, resolveStrategy } from '../../../core/usecases/strategy/compileStrategy';
import { SentinelApplication } from '../../../core/usecases/strategy/applyAiSentinels';
import { LegacySimulationAdapter } from '../../../core/domain/input/LegacySimulationAdapter';
import { LegacyEvaluationEngine } from '../../../core/evaluation/LegacyEvaluationEngine';
import type { StrategyOptimizationResult } from '../../../core/strategy/StrategyOptimizer';
import type { StrategyOptimizationStatus } from '../../hooks/useStrategyOptimization';
import { StrategyRecommendationCards } from './recommendation/StrategyRecommendationCards';

interface DashboardSectionProps {
  params: SimulationParams;
  result: SimulationResult;
  compareResults?: { id: string, name: string, result: SimulationResult }[];
  isPro?: boolean;
  recommendation?: StrategyRecommendation;
  recommendationFailed?: boolean;
  isComputingRecommendation?: boolean;
  // AI 센티널이 자동으로 계산에 넣은 축. 체크리스트가 "이미 반영됨"과 "남은 할 일"을
  // 가르는 데 쓴다.
  sentinels?: SentinelApplication;
  // 몬테카를로는 워커에서 돌아 결과가 늦게 도착한다. 여기서 훅을 부르지 않고 위에서
  // 내려받는 이유: 이 컴포넌트는 Before/After 토글로 자주 리렌더되는데, 그때마다 워커를
  // 다시 띄우면 스켈레톤이 깜빡인다. 훅은 params가 실제로 바뀌는 곳(page.tsx)에 둔다.
  monteCarlo?: MonteCarloResult;
  monteCarloStatus?: MonteCarloStatus;
  sequenceRisk?: SequenceRiskResult;
  strategyOptimization?: StrategyOptimizationResult;
  strategyOptimizationStatus?: StrategyOptimizationStatus;
  strategyOptimizationError?: string;
}

// 결과 화면 오케스트레이터. 하위 조각(Hero/KPI/체크리스트/차트/전문가상세)을 IA 순서대로
// 배치만 하고, 각 조각의 렌더링/계산 책임은 해당 컴포넌트/usecase가 갖는다.
export const DashboardSection: React.FC<DashboardSectionProps> = ({
  params: rawParams,
  result,
  compareResults = [],
  isPro = false,
  recommendation,
  recommendationFailed = false,
  isComputingRecommendation = false,
  sentinels,
  monteCarlo,
  monteCarloStatus = 'idle',
  sequenceRisk,
  strategyOptimization,
  strategyOptimizationStatus = 'idle',
  strategyOptimizationError,
}) => {
  // 초기값이 빈 객체가 아닌 이유: 몬테카를로 상위 10% 선은 처음 화면에서 꺼 둔다
  // (DEFAULT_HIDDEN_PERCENTILE_KEYS 주석 참고 — 켜 두면 축이 그 선에 끌려가 주 곡선이 눌린다).
  //
  // **아래 assetChartHiddenKeys처럼 덮어쓰기(overlay)로 두지 않는다.** 덮어쓰면 사용자가
  // 범례 버튼으로 켜도 다시 꺼져서 버튼이 동작하지 않는 것처럼 보인다. 기본값은 초기 상태로만
  // 두고, 그 뒤로는 사용자의 선택이 이긴다.
  const [hiddenKeys, setHiddenKeys] = React.useState<Record<string, boolean>>(
    () => ({ ...DEFAULT_HIDDEN_PERCENTILE_KEYS })
  );
  const [compositionChart, setCompositionChart] = React.useState<'income' | 'spending'>('income');
  // 자산 추이 차트 기본 단순화 모드: 켜지기 전까지는 주식자산/연금자산 breakdown을 숨기고
  // 자산총액/월생활비만 보여준다. 범례 클릭으로 저장된 hiddenKeys는 그대로 두고 덮어씌우기만 한다.
  const [showAssetBreakdown, setShowAssetBreakdown] = React.useState(false);

  const handleLegendClick = (data: LegendPayload) => {
    const dataKey = data.dataKey;
    if (dataKey !== undefined) {
      const key = String(dataKey);
      setHiddenKeys((prev) => ({ ...prev, [key]: !prev[key] }));
    }
  };

  const assetChartHiddenKeys = showAssetBreakdown
    ? hiddenKeys
    : { ...hiddenKeys, 주식자산: true, 연금자산: true };

  const params: SimulationParams = React.useMemo(() => ({
    ...rawParams,
    userProfile: rawParams?.userProfile || { currentAge: 35, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3000000 },
    assets: rawParams?.assets || [],
    nationalPension: rawParams?.nationalPension || { expectedMonthlyAmount: 0 },
    privatePensions: rawParams?.privatePensions || [],
    otherIncomes: rawParams?.otherIncomes || [],
    inflationRate: rawParams?.inflationRate ?? 2,
    inflationMode: rawParams?.inflationMode || 'real',
    baseExchangeRate: rawParams?.baseExchangeRate ?? 1350,
    displayCurrency: rawParams?.displayCurrency || 'KRW',
    spendingStrategy: rawParams?.spendingStrategy || 'target',
  }), [rawParams]);

  const currency = params.displayCurrency;
  const formatValue = (val: number) => formatValueForCurrency(val, currency);

  const { mode, toggle, canApply } = useBeforeAfterToggle({
    recommendation, params: rawParams, currentUtilityScore: result.utility?.score,
  });
  const displayedResult = mode === 'after' && recommendation ? recommendation.recommendedResult : result;

  // 목표 우선순위가 정한 효용 배점을 포함해 legacy 입력을 새 Domain/Input 경계로 변환한다.
  const utilityConfig = React.useMemo(() => compileStrategy(params).utilityConfig, [params]);
  const domainInput = React.useMemo(
    () => LegacySimulationAdapter.fromLegacy(params, utilityConfig),
    [params, utilityConfig]
  );
  const evaluationEngine = React.useMemo(() => new LegacyEvaluationEngine(), []);

  // MC는 baseline으로만 계산되므로 After 미리보기에는 결합하지 않는다.
  const monteCarloForDisplay =
    mode === 'after' || monteCarloStatus !== 'done' ? undefined : monteCarlo;
  const displayedEvaluation = React.useMemo(
    () => evaluationEngine.evaluate(
      domainInput.profile,
      domainInput.goals,
      domainInput.strategy,
      displayedResult,
      { monteCarlo: monteCarloForDisplay }
    ),
    [domainInput, displayedResult, evaluationEngine, monteCarloForDisplay]
  );
  const baselineEvaluation = React.useMemo(
    () => evaluationEngine.evaluate(
      domainInput.profile,
      domainInput.goals,
      domainInput.strategy,
      result,
      { monteCarlo: monteCarloForDisplay }
    ),
    [domainInput, result, evaluationEngine, monteCarloForDisplay]
  );

  const {
    metrics: displayedMetrics,
    chartCaptions: captions,
    riskAlerts,
    planAssetStatus,
    planOutcome,
    planConfidence,
    shortfall: shortfallReport,
    utilityExplanations,
    bequestAdequacyExplanation,
  } = displayedEvaluation;
  const {
    metrics: baselineMetrics,
    riskAlerts: baselineRiskAlerts,
    planAssetStatus: baselinePlanAssetStatus,
    planOutcome: baselinePlanOutcome,
    planConfidence: baselinePlanConfidence,
    lifetimeSpendingPlan,
    sustainableSpendingAdvice,
    pensionGap,
  } = baselineEvaluation;

  // 로드맵이 볼 추천안. After 모드에서만 넘긴다 — computeExecutionRoadmap은 undefined면
  // getIdentityPlan(현재 설정)으로 폴백하므로, Before에서는 사용자의 실제 계획이 그려진다.
  const roadmapRecommendation = mode === 'after' ? recommendation : undefined;
  const roadmapPlanAssetStatus = mode === 'after' ? planAssetStatus : baselinePlanAssetStatus;

  // 소득 차트의 국민연금 개시 기준선. 차트가 그리는 결과(displayedResult)와 같은 계획이어야
  // 하므로 After 모드에서는 추천안의 개시 나이를 쓴다. 수령액이 0이면 그 해에 아무 일도
  // 일어나지 않으므로 기준선을 그리지 않는다.
  const displayedNationalPensionStartAge =
    (params.nationalPension?.expectedMonthlyAmount ?? 0) > 0
      ? (mode === 'after' ? recommendation?.recommendedPlan?.nationalPensionStartAge : undefined)
        ?? params.withdrawalPlan?.nationalPensionStartAge
        ?? NATIONAL_PENSION_NORMAL_START_AGE
      : undefined;

  // 민감도 분석은 예전에 ExpertDetailsPanel 안에서만 계산됐다. 핵심 레버 카드가 같은 값을
  // 인용해야 하므로 여기로 끌어올려 한 번만 계산하고 아래로 내려준다 — 두 곳에서 각자 돌리면
  // 시뮬레이션 7회가 두 배가 되고, 더 나쁘게는 두 카드가 다른 실행 결과를 말할 수 있다.
  //
  // Before/After 토글과 무관하게 항상 "현재 설정(params)"의 취약성을 본다(기존 규칙 유지).
  const sensitivity = React.useMemo(
    () => evaluationEngine.analyzeSensitivity(params),
    [evaluationEngine, params]
  );
  const keyLevers = React.useMemo(
    () => computeKeyLevers({ sensitivity, pensionGap, shortfall: shortfallReport, recommendation, formatValue }),
    // formatValue는 매 렌더 새 참조지만 currency에만 의존하므로 통화를 의존성으로 쓴다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sensitivity, pensionGap, shortfallReport, recommendation, currency]
  );
  // spendingSuccessRate로 대체하지 않는다. 그것은 "고갈 여부를 묻지 않는" 다른 지표라
  // 언제나 목표 성공확률보다 관대하고(montecarlo.ts 주석), 대체하면 목표를 못 지키는 계획이
  // 🟢으로 표시될 수 있다. 측정되지 않았으면 아래에서 '확인 불가'로 내려간다.
  const currentGoalProbability = monteCarloStatus === 'done' && monteCarlo
    ? monteCarlo.goalSuccessProbability
    : undefined;
  // 임계값은 computePlanConfidence가 소유한다. 같은 화면에 이미 그 밴드로 그린 지표가 있어
  // (planConfidence) 별도 임계값을 두면 0.85에서 한쪽은 '안정', 한쪽은 🟡으로 갈린다.
  const diagnosisTier = currentGoalProbability !== undefined
    ? PLAN_CONFIDENCE_BAND_TIER[getPlanConfidenceBand(currentGoalProbability)]
    : undefined;
  const diagnosis = diagnosisTier !== undefined
    ? diagnosisTier === 'green'
      ? { emoji: '🟢', text: '현재 계획으로 안정적인 은퇴가 가능합니다.', tone: 'success' as const }
      : diagnosisTier === 'orange'
        ? { emoji: '🟡', text: '조금 조정하면 안정적인 은퇴가 가능합니다.', tone: 'warning' as const }
        : { emoji: '🔴', text: '목표를 지키려면 현재 계획의 조정이 필요합니다.', tone: 'danger' as const }
    : baselinePlanOutcome.spendingShortfall || baselinePlanOutcome.assetStatus === 'depleted'
      ? { emoji: '🔴', text: '기준 시나리오에서 현재 계획의 조정이 필요합니다.', tone: 'danger' as const }
      : baselinePlanOutcome.investableDepletionAge !== null
        ? { emoji: '🟡', text: '기준 시나리오는 유지되지만 투자자산 소진에 대비해야 합니다.', tone: 'warning' as const }
        : { emoji: '🟢', text: '기준 시나리오에서는 계획한 생활비와 자산이 유지됩니다.', tone: 'success' as const };
  const probabilityLabel = currentGoalProbability !== undefined
    ? `${Math.round(currentGoalProbability * 100)}%`
    : monteCarloStatus === 'error' || monteCarloStatus === 'unsupported'
      ? '확인 불가'
      : '계산 중';
  const biggestRisk = baselineRiskAlerts[0]?.title
    ?? (result.depletionAge !== null
      ? `${result.depletionAge}세에 투자자산이 소진될 가능성`
      : currentGoalProbability !== undefined && currentGoalProbability < 0.9
        ? '시장 하락 시 생활비 목표를 유지할 여유 부족'
        : '현재 가정에서 발견된 중대한 위험 없음');

  return (
    <div className={styles.container}>
      <DashboardGroup title="현재 계획 진단" description="나는 지금 괜찮은지, 무엇이 가장 취약한지부터 확인하세요.">
        <section className={`${styles.planDiagnosis} ${styles[diagnosis.tone]}`} aria-label="현재 계획 분석">
          <div className={styles.diagnosisHeadline}>
            <span aria-hidden="true">{diagnosis.emoji}</span>
            <h3>{diagnosis.text}</h3>
          </div>
          <div className={styles.diagnosisGrid}>
            <div>
              <span>목표 달성 확률</span>
              <strong>{probabilityLabel}</strong>
            </div>
            <div>
              <span>가장 큰 위험</span>
              <strong>{biggestRisk}</strong>
            </div>
          </div>
          <dl className={styles.currentPlanFacts} aria-label="현재 계획">
            <div><dt>은퇴</dt><dd>{params.userProfile.retirementAge}세</dd></div>
            <div><dt>월 생활비 목표</dt><dd>{formatValue(baselineMetrics.targetSpending)}</dd></div>
            <div><dt>{params.userProfile.expectancy}세 예상자산</dt><dd>{formatValue(baselineMetrics.terminalAssets)}</dd></div>
          </dl>
          {currentGoalProbability === undefined && (
            <p className={styles.deterministicNote}>확률 검증 전에는 기준 시나리오의 생존·생활비 부족 여부만 진단합니다.</p>
          )}
        </section>
      </DashboardGroup>

      <DashboardGroup title="NextLife 추천" description="목표에 가장 가까운 최종 전략과 현재 계획에서 바뀌는 점만 비교합니다.">
        <StrategyRecommendationCards
          recommendations={strategyOptimization?.recommendations?.recommendations}
          status={strategyOptimizationStatus}
          currentGoalProbability={currentGoalProbability}
          errorMessage={strategyOptimizationError}
          unsupportedHardGoals={strategyOptimization?.debug?.unsupportedHardGoals}
          outcome={strategyOptimization?.outcome}
          params={params}
          formatValue={formatValue}
        />
      </DashboardGroup>

      <details className={styles.detailedAnalysis}>
        <summary>
          <span>
            <strong>상세 분석</strong>
            <small>연령별 자산·소득, 세금, 건강보험료, Monte Carlo 분위수와 연도별 현금흐름</small>
          </span>
        </summary>
        <div className={styles.detailedAnalysisContent}>
      <DashboardGroup title="결과 요약" description="현재 계획의 결론과 가장 중요한 숫자를 한곳에서 확인하세요.">
        <AiSummaryHero
        formatValue={formatValue}
        mode={mode}
        onToggleMode={toggle}
        canApply={canApply}
        score={result.retirementScore}
        retirementGrade={result.retirementGrade}
        monthlyTarget={baselineMetrics.targetSpending}
        isPro={isPro}
        userProfile={params.userProfile}
        depletionAge={result.depletionAge}
        expectancy={params.userProfile.expectancy}
        goalAchievementRate={baselineMetrics.fixedIncomeCoverageRate}
        fireAge={result.fireAge}
        endingAssets={baselineMetrics.terminalAssets}
        assets={params.assets}
        privatePensions={params.privatePensions}
        nationalPension={params.nationalPension}
        nationalPensionStartAge={params.withdrawalPlan?.nationalPensionStartAge}
        otherIncomes={params.otherIncomes}
        taxSettings={params.taxSettings}
        spendingStrategy={params.spendingStrategy}
        inflationRate={params.inflationRate}
        inflationMode={params.inflationMode}
        utility={result.utility}
        utilityWeights={utilityConfig.weights}
        recommendation={recommendation}
        planAssetStatus={baselinePlanAssetStatus}
        planOutcome={baselinePlanOutcome}
        planConfidence={baselinePlanConfidence}
        sustainableMonthlySpending={baselineMetrics.sustainableSpending}
        monteCarloSuccessRate={monteCarlo?.successRate}
        monteCarloSpendingSuccessRate={monteCarlo?.spendingSuccessRate}
        pensionGap={pensionGap ?? undefined}
        />

        <CoreKpiGrid
        confidence={planConfidence}
        expectancy={params.userProfile.expectancy}
        metrics={displayedMetrics}
        utilityScore={displayedResult.utility?.score}
        formatValue={formatValue}
        resultBasis={mode === 'after' ? 'recommended' : 'current'}
        />

        <div className={styles.statusList} aria-label="현재 계획 상태">
          {lifetimeSpendingPlan && (
            <StatusNotice tone="success" icon={<Award size={19} aria-hidden="true" />} title="평생 소비 최적화 결과">
              {lifetimeSpendingPlan.assetFloor !== undefined
                ? <>{params.userProfile.expectancy}세에 <strong>{formatValue(lifetimeSpendingPlan.assetFloor)}</strong>을 남기면서, </>
                : <>고갈 없이 유지하면서, </>}
              {lifetimeSpendingPlan.segments.length > 0
                ? (
                  <>
                    연령대별로 다음 금액까지 쓸 수 있습니다.
                    <ul className={styles.spendingPlanList}>
                      {lifetimeSpendingPlan.segments.map((s) => (
                        <li key={s.fromAge}>
                          {s.fromAge}~{s.toAge ?? params.userProfile.expectancy}세{' '}
                          <strong>{formatValue(s.monthlyAmount)}</strong>
                        </li>
                      ))}
                    </ul>
                  </>
                )
                : <>월 <strong>{formatValue(lifetimeSpendingPlan.baseMonthly)}</strong>까지 쓸 수 있습니다.</>}
              {/*
                결정론 한 경로의 결과이므로 확률을 함께 보여준다. 계산이 끝났을 때만 —
                없는 숫자를 기다리게 하지 않는다.

                **successRate가 아니라 spendingSuccessRate를 쓴다.** 이 배너의 주장은 "이만큼 쓸 수
                있다"이므로, 물어야 할 확률은 "그 금액을 실제로 다 쓰는 비율"이다. 자산 고갈
                여부(successRate)는 여기서 거의 정보가 없다 — 목표 상속자산을 정하면 엔진이
                그 선 아래로 인출을 막아 고갈이 구조적으로 일어나지 않는다. 하니스 실측:
                성공률 100%인 계획의 완전소비율이 43%였다. 그 계획에 "성공확률 100%"라고
                말하는 것은 사용자를 오도한다.

                이 논거는 spendingSuccessRate의 새 정의(자산 고갈과 독립)에서 오히려 더 정확해진다.
                옛 정의는 자산이 살아남은 시행 안에서만 셌기 때문에, 투자자산이 88세에 바닥나도
                연금으로 90세까지 이 금액을 다 쓴 경로를 실패로 세어 배너 숫자를 실제보다 낮게
                보고했다.
              */}
              {monteCarloStatus === 'done' && monteCarlo && (
                <> 다만 시장 변동을 반영하면 이 금액을 한 해도 줄이지 않고 유지할 확률은{' '}
                  <strong>{Math.round(monteCarlo.spendingSuccessRate * 100)}%</strong>입니다.</>
              )}
            </StatusNotice>
          )}
          {lifetimeSpendingPlan?.belowMinimum && (
            <StatusNotice
              tone="danger" icon={<AlertTriangle size={19} aria-hidden="true" />}
              title="역산된 생활비가 최소 기준에 못 미칩니다"
            >
              가장 적은 구간이 월 <strong>{formatValue(lifetimeSpendingPlan.belowMinimum.lowestMonthly)}</strong>으로,
              설정한 최소 생활비({formatValue(lifetimeSpendingPlan.belowMinimum.minMonthlySpending)})보다 낮습니다.
              목표 상속자산을 줄이거나 은퇴 시점을 늦추는 방향을 검토해 보세요.
            </StatusNotice>
          )}
          {sustainableSpendingAdvice?.kind === 'can_spend_more' && (
            <StatusNotice tone="success" icon={<TrendingUp size={19} aria-hidden="true" />} title="지금보다 더 쓸 수 있습니다">
              현재 목표보다 월 <strong>{formatValue(sustainableSpendingAdvice.difference)}</strong> 여유가 있습니다.
              지속 가능한 한도는 월 {formatValue(sustainableSpendingAdvice.sustainableMonthly)}입니다.
            </StatusNotice>
          )}
          {sustainableSpendingAdvice?.kind === 'overspending' && (
            <StatusNotice tone="danger" icon={<AlertTriangle size={19} aria-hidden="true" />} title="현재 목표 생활비는 지속하기 어렵습니다">
              지속 가능한 한도는 월 <strong>{formatValue(sustainableSpendingAdvice.sustainableMonthly)}</strong>으로,
              현재 목표보다 월 {formatValue(sustainableSpendingAdvice.difference)} 낮습니다.
              {baselinePlanAssetStatus === 'no_investable_asset'
                ? ' 생활비를 줄이거나, 은퇴 시점을 늦추거나, 추가 저축·투자로 자산을 마련해야 합니다.'
                : ' 생활비·은퇴 시점·인출 전략을 조정해 보세요.'}
            </StatusNotice>
          )}
          {params.spendingStrategy === 'dividend_only' && (
            <StatusNotice tone="info" icon={<Zap size={19} aria-hidden="true" />} title="배당금 100% 소비 모드 적용 중">
              은퇴 후 배당금과 연금만 소비하며 원금은 매도하지 않습니다.
            </StatusNotice>
          )}
        </div>

        <ShortfallSummaryCard
          report={shortfallReport}
          formatValue={formatValue}
          expectancy={params.userProfile.expectancy}
          spendingSuccessRate={monteCarloForDisplay?.spendingSuccessRate}
        />
      </DashboardGroup>

      <DashboardGroup title="위험 분석" description="계획이 실패할 수 있는 조건과 시장 변동의 영향을 함께 봅니다.">
        <RiskAlertCards alerts={riskAlerts} />
        <MonteCarloSection
        status={monteCarloStatus}
        monteCarlo={monteCarlo}
        sequenceRisk={sequenceRisk}
        formatValue={formatValue}
        isPro={isPro}
        />
      </DashboardGroup>

      <DashboardGroup title="실행 계획" description="추천 변경 사항과 실행 시점을 이어서 확인하세요.">
        {/* 인출 전략 체크리스트보다 위에 둔다. 이유는 computeKeyLevers 주석 참고 —
            체크리스트가 탐색하는 축(매도 순서·인출 개시 나이)은 이 계획에서 다섯 번째로
            중요한 레버인데, 예전에는 그것이 실행 계획의 첫 카드였다. */}
        <KeyLeversCard levers={keyLevers} />

        <RecommendationChecklist
        recommendation={recommendation}
        recommendationFailed={recommendationFailed}
        isComputingRecommendation={isComputingRecommendation}
        sentinels={sentinels}
        currentUtilityScore={result.utility?.score}
        formatValue={formatValue}
        planAssetStatus={baselinePlanAssetStatus}
        />

      {/* 실행 로드맵.

          **Before/After 토글을 따른다.** 예전에는 토글과 무관하게 항상 추천안을 그렸고, 그래서
          추천을 적용하지 않은 화면(Hero 버튼이 "추천 적용하기" 상태)에서 KPI·차트는 현재 설정을
          보여주는데 로드맵만 추천안(예: 국민연금 60세 조기수령)을 보여줬다.

          자산 고갈 나이·자산 상태도 반드시 같은 기준을 써야 한다 — 셋이 어긋나면 마일스톤과
          고갈 시점이 서로 다른 시나리오를 가리킨다(selectDepletionAge 주석 참고). */}
        <ExecutionRoadmap
        roadmap={computeExecutionRoadmap(
          params,
          roadmapRecommendation,
          selectDepletionAge(roadmapRecommendation, result),
          roadmapPlanAssetStatus
        )}
        isRecommendedPlan={!!roadmapRecommendation?.recommendedPlan}
        />
      </DashboardGroup>

      <DashboardGroup title="자산 흐름" description="전체 자산 추이와 연령별 소득·지출 구성을 살펴보세요.">
        <AssetGrowthChart
        params={params}
        result={displayedResult}
        compareResults={compareResults}
        hiddenKeys={assetChartHiddenKeys}
        onLegendClick={handleLegendClick}
        caption={captions.assetGrowth}
        showBreakdown={showAssetBreakdown}
        onToggleBreakdown={() => setShowAssetBreakdown((v) => !v)}
        planOutcome={planOutcome}
        monteCarlo={monteCarloForDisplay}
        />
        <div className={styles.chartTabs} role="tablist" aria-label="현금흐름 차트 선택">
          <button type="button" role="tab" aria-selected={compositionChart === 'income'} onClick={() => setCompositionChart('income')}>소득 구성</button>
          <button type="button" role="tab" aria-selected={compositionChart === 'spending'} onClick={() => setCompositionChart('spending')}>지출 구성</button>
        </div>
        <div role="tabpanel">
          {compositionChart === 'income' ? (
            <IncomeCompositionChart
              params={params}
              result={displayedResult}
              hiddenKeys={hiddenKeys}
              onLegendClick={handleLegendClick}
              caption={captions.incomeComposition}
              nationalPensionStartAge={displayedNationalPensionStartAge}
            />
          ) : (
            <SpendingCompositionChart
              params={params}
              result={displayedResult}
              hiddenKeys={hiddenKeys}
              onLegendClick={handleLegendClick}
              caption={captions.spendingComposition}
            />
          )}
        </div>
      </DashboardGroup>

      <DashboardGroup title="상세 분석" description="평생 효용의 근거와 세금·연금 세부 내용을 확인하세요.">
        {displayedResult.utility && (
          <UtilityInsightSection
            utility={displayedResult.utility}
            utilityConfig={utilityConfig}
            planAssetStatus={planAssetStatus}
            utilityExplanations={utilityExplanations}
            bequestAdequacyExplanation={bequestAdequacyExplanation}
            bequestStrategy={resolveStrategy(params).bequestStrategy}
          />
        )}
        <ExpertDetailsPanel
          result={displayedResult}
          params={params}
          isPro={isPro}
          formatValue={formatValue}
          sensitivity={sensitivity}
        />
      </DashboardGroup>
        </div>
      </details>
    </div>
  );
};

function DashboardGroup({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className={styles.dashboardGroup} aria-labelledby={`dashboard-${title}`}>
      <header className={styles.groupHeader}>
        <h2 id={`dashboard-${title}`} className={styles.groupTitle}>{title}</h2>
        <p className={styles.groupDescription}>{description}</p>
      </header>
      <div className={styles.groupContent}>{children}</div>
    </section>
  );
}

function StatusNotice({ tone, icon, title, children }: {
  tone: 'success' | 'danger' | 'info';
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className={`${styles.statusNotice} ${styles[tone]}`}>
      <span className={styles.statusIcon}>{icon}</span>
      <div>
        <p className={styles.statusTitle}>{title}</p>
        <p className={styles.statusText}>{children}</p>
      </div>
    </div>
  );
}
export default DashboardSection;
