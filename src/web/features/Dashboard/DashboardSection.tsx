'use client';

import React from 'react';
import { type LegendPayload } from 'recharts';
import { Award, Zap, TrendingUp, AlertTriangle } from 'lucide-react';
import { SimulationParams, SimulationResult, StrategyRecommendation } from '../../../core/entities/types';
import { explainBequestAdequacy } from '../../../core/usecases/utility/utilityAnalysis';
import { generateChartCaptions } from '../../../core/usecases/dashboard/generateChartCaptions';
import styles from './Dashboard.module.css';
import { formatValue as formatValueForCurrency } from './charts/chartFormatters';
import { AssetGrowthChart } from './charts/AssetGrowthChart';
import { IncomeCompositionChart } from './charts/IncomeCompositionChart';
import { SpendingCompositionChart } from './charts/SpendingCompositionChart';
import { CoreKpiGrid } from './kpi/CoreKpiGrid';
import { RecommendationChecklist } from './recommendation/RecommendationChecklist';
import { AiSummaryHero } from './hero/AiSummaryHero';
import { ExpertDetailsPanel } from './expert/ExpertDetailsPanel';
import { RiskAlertCards } from './risk/RiskAlertCards';
import { UtilityInsightSection } from './insights/UtilityInsightSection';
import { MonteCarloSection } from './montecarlo/MonteCarloSection';
import { MonteCarloResult } from '../../../core/entities/montecarlo';
import { MonteCarloStatus } from '../../hooks/useMonteCarlo';
import { SequenceRiskResult } from '../../../core/usecases/montecarlo/sequenceRisk';
import { computeRiskAlerts } from '../../../core/usecases/dashboard/computeRiskAlerts';
import { computeSustainableSpendingAdvice } from '../../../core/usecases/dashboard/computeSustainableSpendingAdvice';
import { useBeforeAfterToggle } from './hooks/useBeforeAfterToggle';
import { ExecutionRoadmap } from './roadmap/ExecutionRoadmap';
import { computeExecutionRoadmap, selectDepletionAge } from '../../../core/usecases/dashboard/computeExecutionRoadmap';
import { resolvePlanAssetStatus } from '../../../core/usecases/dashboard/resolvePlanAssetStatus';
import { computePensionStartMarkers } from '../../../core/usecases/dashboard/computePensionStartMarkers';
import { NATIONAL_PENSION_NORMAL_START_AGE } from '../../../core/usecases/pension/nationalPensionRules';
import { compileStrategy } from '../../../core/usecases/strategy/compileStrategy';
import { SentinelApplication } from '../../../core/usecases/strategy/applyAiSentinels';

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
}) => {
  const [hiddenKeys, setHiddenKeys] = React.useState<Record<string, boolean>>({});
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

  // baseline(현재 설정) 기준 월 목표 생활비 — AI 노후 설계사 의견은 Before/After 미리보기와
  // 무관하게 항상 "실제 설정"을 근거로 답해야 하므로 이 값을 그대로 쓴다.
  const monthlyTarget =
    params.spendingStrategy === 'max_sustainable' && result.calculatedTargetSpending
      ? result.calculatedTargetSpending
      : params.userProfile.targetMonthlySpending;

  // KPI/지표는 화면에 실제로 표시 중인 결과(displayedResult)를 따라가야 한다 — After 모드에서
  // 추천안이 생활비 배수(monthlySpendingMultiplier)를 포함하면 그만큼 반영한다.
  const displayedMonthlyTarget =
    mode === 'after' && recommendation?.recommendedPlan?.monthlySpendingMultiplier
      ? Math.round(monthlyTarget * recommendation.recommendedPlan.monthlySpendingMultiplier)
      : monthlyTarget;

  const captions = generateChartCaptions(displayedResult, params);
  const riskAlerts = computeRiskAlerts(displayedResult, params);

  // 차트·캡션·헤드라인이 전부 이 하나의 판정을 근거로 삼는다. 화면에 실제로 표시 중인
  // 결과(displayedResult)를 쓰는 것은 captions/riskAlerts와 같은 이유다 — After 모드에서
  // 추천안이 자산 상태 자체를 바꾸면 그 결과를 따라가야 한다.
  const planAssetStatus = resolvePlanAssetStatus(displayedResult);
  // baseline(현재 설정) 기준 상태. AI 노후 설계사 의견·과소비 배너처럼 "지금 설정이 어떤가"를
  // 말하는 조각은 Before/After 미리보기를 따라가면 자기 자신을 근거로 삼게 된다.
  const baselinePlanAssetStatus = resolvePlanAssetStatus(result);

  // 소득 차트의 연금 개시 기준선. 차트가 그리는 결과(displayedResult)와 같은 계획이어야 하므로
  // After 모드에서는 추천안의 국민연금 개시 나이를 쓴다.
  const displayedNationalPensionStartAge =
    (mode === 'after' ? recommendation?.recommendedPlan?.nationalPensionStartAge : undefined)
    ?? params.withdrawalPlan?.nationalPensionStartAge
    ?? NATIONAL_PENSION_NORMAL_START_AGE;
  const pensionStartMarkers = React.useMemo(
    () => computePensionStartMarkers(params, displayedNationalPensionStartAge),
    [params, displayedNationalPensionStartAge]
  );

  // 다른 배너와 같은 이유로 baseline(현재 설정)을 쓴다 — 이 제안은 "지금 설정을 이렇게
  // 바꿔 보라"는 말이므로 Before/After 미리보기를 따라가면 자기 자신을 근거로 삼게 된다.
  const sustainableSpendingAdvice = computeSustainableSpendingAdvice(
    params.spendingStrategy,
    params.userProfile.targetMonthlySpending,
    result.calculatedTargetSpending
  );
  // 효용 점수를 실제로 계산한 config. 목표 우선순위(strategy.objective)가 6개 항목의 배점을
  // 통째로 갈아끼우므로, 화면이 기본 배점을 가정하면 "세금 효율 21/10"처럼 만점을 넘긴
  // 분수가 나온다(compileStrategy는 전략이 없는 계획에서 기본 config를 그대로 반환한다).
  const utilityConfig = React.useMemo(() => compileStrategy(params).utilityConfig, [params]);
  const bequestAdequacyExplanation = React.useMemo(
    () => (displayedResult.utility ? explainBequestAdequacy(params, displayedResult) : undefined),
    [params, displayedResult]
  );

  return (
    <div className={styles.container}>
      {/* Strategy Indicator Banners — 항상 baseline(현재 설정) 기준, Before/After 토글과 무관 */}
      {params.spendingStrategy === 'max_sustainable' && result.calculatedTargetSpending !== undefined && (
        <div className={styles.warningCard} style={{ background: 'rgba(16, 185, 129, 0.1)', borderColor: 'rgba(16, 185, 129, 0.3)' }}>
          <Award size={22} className={styles.warningIcon} color="var(--success)" />
          <div className={styles.warningContent}>
            <span className={styles.warningTitle} style={{ color: 'var(--success)' }}>최대 고정 생활비 산출 완료</span>
            <span className={styles.warningText}>
              시뮬레이션 결과, 고갈 없이 유지 가능한 <strong>최대 월 생활비는 {formatValue(result.calculatedTargetSpending)}</strong>입니다. 모든 차트는 이 금액을 목표로 다시 그려졌습니다.
            </span>
          </div>
        </div>
      )}
      {/* 고정 목표 생활비('target') 계획에서, 엔진이 이미 계산해 둔 지속가능 생활비를
          현재 목표와 비교해 제안한다. 양방향인 이유는 computeSustainableSpendingAdvice 주석 참고. */}
      {sustainableSpendingAdvice?.kind === 'can_spend_more' && (
        <div className={styles.warningCard} style={{ background: 'rgba(16, 185, 129, 0.1)', borderColor: 'rgba(16, 185, 129, 0.3)' }}>
          <TrendingUp size={22} className={styles.warningIcon} color="var(--success)" />
          <div className={styles.warningContent}>
            <span className={styles.warningTitle} style={{ color: 'var(--success)' }}>지금보다 더 쓸 수 있습니다</span>
            <span className={styles.warningText}>
              현재 목표는 월 {formatValue(sustainableSpendingAdvice.currentMonthly)}이지만, 자산을 고갈시키지 않고{' '}
              <strong>월 {formatValue(sustainableSpendingAdvice.sustainableMonthly)}까지</strong> 쓸 수 있습니다
              (월 {formatValue(sustainableSpendingAdvice.difference)} 여유). 목표 생활비를 올리거나, 남는 자산을
              상속·증여 계획에 반영해 보세요.
            </span>
          </div>
        </div>
      )}
      {sustainableSpendingAdvice?.kind === 'overspending' && (
        <div className={styles.warningCard} style={{ background: 'rgba(239, 68, 68, 0.1)', borderColor: 'rgba(239, 68, 68, 0.3)' }}>
          <AlertTriangle size={22} className={styles.warningIcon} color="var(--danger)" />
          <div className={styles.warningContent}>
            <span className={styles.warningTitle} style={{ color: 'var(--danger)' }}>현재 목표 생활비는 지속하기 어렵습니다</span>
            <span className={styles.warningText}>
              현재 목표는 월 {formatValue(sustainableSpendingAdvice.currentMonthly)}이지만,{' '}
              {baselinePlanAssetStatus === 'no_investable_asset' ? '연금 등 고정소득만으로는' : '자산을 고갈시키지 않으려면'}{' '}
              <strong>월 {formatValue(sustainableSpendingAdvice.sustainableMonthly)} 수준</strong>이 한계입니다
              (월 {formatValue(sustainableSpendingAdvice.difference)} 초과).{' '}
              {/* 인출할 자산이 없는 계획에 "인출 전략을 검토하라"고 하면 할 수 없는 일을 시키는 것이 된다. */}
              {baselinePlanAssetStatus === 'no_investable_asset'
                ? '생활비를 줄이거나, 은퇴 시점을 늦추거나, 추가 저축·투자로 자산을 마련해야 합니다.'
                : '생활비를 조정하거나 은퇴 시점·인출 전략을 다시 검토해 보세요.'}
            </span>
          </div>
        </div>
      )}
      {params.spendingStrategy === 'dividend_only' && (
        <div className={styles.warningCard} style={{ background: 'rgba(59, 130, 246, 0.1)', borderColor: 'rgba(59, 130, 246, 0.3)' }}>
          <Zap size={22} className={styles.warningIcon} color="#3B82F6" />
          <div className={styles.warningContent}>
            <span className={styles.warningTitle} style={{ color: '#3B82F6' }}>배당금 100% 소비 모드 적용 중</span>
            <span className={styles.warningText}>
              은퇴 후 매월 발생하는 배당금 및 연금(이자)만 100% 소비하며, 원금은 전혀 매도하지 않도록 시뮬레이션 되었습니다.
            </span>
          </div>
        </div>
      )}
      {/* STEP 1: AI Summary Hero */}
      <AiSummaryHero
        formatValue={formatValue}
        mode={mode}
        onToggleMode={toggle}
        canApply={canApply}
        score={result.retirementScore}
        retirementGrade={result.retirementGrade}
        monthlyTarget={monthlyTarget}
        isPro={isPro}
        userProfile={params.userProfile}
        depletionAge={result.depletionAge}
        householdEndAge={result.householdEndAge}
        goalAchievementRate={result.goalAchievementRate}
        fireAge={result.fireAge}
        endingAssets={result.endingAssets}
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
        sustainableMonthlySpending={result.calculatedTargetSpending}
      />

      {/* STEP 2: 핵심 KPI */}
      <CoreKpiGrid
        survivalScore={displayedResult.retirementScore}
        expectancy={params.userProfile.expectancy}
        endingAssets={displayedResult.endingAssets}
        monthlyTarget={displayedMonthlyTarget}
        utilityScore={displayedResult.utility?.score}
        formatValue={formatValue}
      />

      {/* 리스크 알림 (해당되는 것만, 0~3개) */}
      <RiskAlertCards alerts={riskAlerts} />

      {/* 확률·순서 리스크는 리스크 경고 바로 다음에 둔다. 둘 다 "이 계획이 어떻게 실패할 수
          있는가"를 말하므로 같은 자리에 모이는 것이 자연스럽고, 효용 점수·체크리스트 같은
          "어떻게 개선할까" 블록보다 앞서야 개선 제안을 읽을 근거가 된다.

          몬테카를로는 워커에서 돌아 늦게 도착하므로 params와 함께 위에서 내려받는다
          (여기서 훅을 부르면 Before/After 토글이 바뀔 때마다 재계산된다). */}
      <MonteCarloSection
        status={monteCarloStatus}
        monteCarlo={monteCarlo}
        sequenceRisk={sequenceRisk}
        formatValue={formatValue}
        isPro={isPro}
      />

      {/* 평생 효용 점수 구성 + 현재 전략 강점/약점 (항상 노출, Collapse 아님) */}
      {displayedResult.utility && (
        <UtilityInsightSection
          utility={displayedResult.utility}
          utilityConfig={utilityConfig}
          bequestAdequacyExplanation={bequestAdequacyExplanation}
        />
      )}

      {/* STEP 3: AI 추천 전략 체크리스트 */}
      <RecommendationChecklist
        recommendation={recommendation}
        recommendationFailed={recommendationFailed}
        isComputingRecommendation={isComputingRecommendation}
        sentinels={sentinels}
        currentUtilityScore={result.utility?.score}
        formatValue={formatValue}
        planAssetStatus={baselinePlanAssetStatus}
      />

      {/* AI 추천 전략 실행 로드맵 (Before/After 토글과 무관하게 항상 고정 기준) */}
      {/* 자산 고갈 나이도 로드맵이 보여주는 것과 같은 기준으로 골라야 나이 이벤트와 고갈 시점이
          같은 시나리오를 가리킨다 — 선택 로직은 selectDepletionAge(computeExecutionRoadmap.ts)
          참고. 화면(여기)과 PDF(simulator/page.tsx) 양쪽이 같은 함수를 써서 동일하게 동작한다. */}
      <ExecutionRoadmap
        roadmap={computeExecutionRoadmap(
          params,
          recommendation,
          selectDepletionAge(recommendation, result),
          baselinePlanAssetStatus
        )}
      />

      {/* STEP 4: 그래프 3종 (각 상단에 rule-based AI 캡션) */}
      <AssetGrowthChart
        params={params}
        result={displayedResult}
        compareResults={compareResults}
        hiddenKeys={assetChartHiddenKeys}
        onLegendClick={handleLegendClick}
        caption={captions.assetGrowth}
        showBreakdown={showAssetBreakdown}
        onToggleBreakdown={() => setShowAssetBreakdown((v) => !v)}
        planAssetStatus={planAssetStatus}
      />
      <IncomeCompositionChart
        params={params}
        result={displayedResult}
        hiddenKeys={hiddenKeys}
        onLegendClick={handleLegendClick}
        caption={captions.incomeComposition}
        pensionStartMarkers={pensionStartMarkers}
      />
      <SpendingCompositionChart
        params={params}
        result={displayedResult}
        hiddenKeys={hiddenKeys}
        onLegendClick={handleLegendClick}
        caption={captions.spendingComposition}
      />

      {/* STEP 5: 전문가용 상세 분석 (기본 Collapse) */}
      <ExpertDetailsPanel result={displayedResult} params={params} isPro={isPro} formatValue={formatValue} />
    </div>
  );
};
export default DashboardSection;
