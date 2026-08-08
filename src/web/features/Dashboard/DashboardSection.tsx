'use client';

import React, { type ReactNode } from 'react';
import { type LegendPayload } from 'recharts';
import { Award, Zap, TrendingUp, AlertTriangle } from 'lucide-react';
import { SimulationParams, SimulationResult, StrategyRecommendation } from '../../../core/entities/types';
import { explainBequestAdequacy } from '../../../core/usecases/utility/utilityAnalysis';
import { explainUtilityComponents } from '../../../core/usecases/utility/explainUtilityComponents';
import { generateChartCaptions } from '../../../core/usecases/dashboard/generateChartCaptions';
import styles from './Dashboard.module.css';
import { formatValue as formatValueForCurrency } from './charts/chartFormatters';
import { AssetGrowthChart } from './charts/AssetGrowthChart';
import { IncomeCompositionChart } from './charts/IncomeCompositionChart';
import { SpendingCompositionChart } from './charts/SpendingCompositionChart';
import { CoreKpiGrid } from './kpi/CoreKpiGrid';
import { ShortfallSummaryCard } from './kpi/ShortfallSummaryCard';
import { computeShortfallSummary } from '../../../core/usecases/dashboard/computeShortfallSummary';
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
  // 화면에 표시 중인 결과를 따라간다 — 추천을 적용해 부족이 해소되면 카드도 함께 사라져야
  // KPI·차트와 같은 이야기를 한다.
  const shortfallSummary = React.useMemo(
    () => computeShortfallSummary(params, displayedResult),
    [params, displayedResult]
  );
  // 축별 점수 근거. 막대와 같은 결과·같은 config에서 파생돼야 두 숫자가 어긋나지 않는다.
  const utilityExplanations = React.useMemo(
    () => explainUtilityComponents(params, displayedResult, utilityConfig),
    [params, displayedResult, utilityConfig]
  );
  const bequestAdequacyExplanation = React.useMemo(
    () => (displayedResult.utility ? explainBequestAdequacy(params, displayedResult) : undefined),
    [params, displayedResult]
  );

  return (
    <div className={styles.container}>
      <DashboardGroup title="결과 요약" description="현재 계획의 결론과 가장 중요한 숫자를 한곳에서 확인하세요.">
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
        monteCarloSuccessRate={monteCarlo?.successRate}
        monteCarloFullSpendingRate={monteCarlo?.fullSpendingRate}
        />

        <CoreKpiGrid
        survivalScore={displayedResult.retirementScore}
        expectancy={params.userProfile.expectancy}
        endingAssets={displayedResult.endingAssets}
        monthlyTarget={displayedMonthlyTarget}
        utilityScore={displayedResult.utility?.score}
        formatValue={formatValue}
        resultBasis={mode === 'after' ? 'recommended' : 'current'}
        />

        <div className={styles.statusList} aria-label="현재 계획 상태">
          {params.spendingStrategy === 'max_sustainable' && result.calculatedTargetSpending !== undefined && (
            <StatusNotice tone="success" icon={<Award size={19} aria-hidden="true" />} title="최대 고정 생활비 산출 완료">
              고갈 없이 유지 가능한 최대 월 생활비는 <strong>{formatValue(result.calculatedTargetSpending)}</strong>입니다.
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

        {shortfallSummary && <ShortfallSummaryCard summary={shortfallSummary} formatValue={formatValue} />}
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
          보여주는데 로드맵만 추천안(예: 국민연금 60세 조기수령)을 보여줬다. 게다가 배우자
          국민연금은 추천 엔진의 최적화 축이 아니라 현재 설정 그대로 그려져, 한 타임라인 안에
          두 기준이 섞여 "본인이 배우자보다 먼저 받는다"는 잘못된 인상을 만들었다.

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
        planAssetStatus={planAssetStatus}
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
          />
        )}
        <ExpertDetailsPanel result={displayedResult} params={params} isPro={isPro} formatValue={formatValue} />
      </DashboardGroup>
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
