'use client';

import React from 'react';
import { type LegendPayload } from 'recharts';
import { Award, Zap } from 'lucide-react';
import { SimulationParams, SimulationResult, StrategyRecommendation } from '../../../core/entities/types';
import { explainBequestAdequacy } from '../../../core/usecases/utility/utilityAnalysis';
import { generateChartCaptions } from '../../../core/usecases/dashboard/generateChartCaptions';
import styles from './Dashboard.module.css';
import { formatValue as formatValueForCurrency } from './charts/chartFormatters';
import { AssetGrowthChart } from './charts/AssetGrowthChart';
import { IncomeCompositionChart } from './charts/IncomeCompositionChart';
import { SpendingCompositionChart } from './charts/SpendingCompositionChart';
import { CoreKpiGrid } from './kpi/CoreKpiGrid';
import { SecondaryKpiCollapse } from './kpi/SecondaryKpiCollapse';
import { RecommendationChecklist } from './recommendation/RecommendationChecklist';
import { AiSummaryHero } from './hero/AiSummaryHero';
import { ExpertDetailsPanel } from './expert/ExpertDetailsPanel';
import { useBeforeAfterToggle } from './hooks/useBeforeAfterToggle';

interface DashboardSectionProps {
  params: SimulationParams;
  result: SimulationResult;
  compareResults?: { id: string, name: string, result: SimulationResult }[];
  isPro?: boolean;
  recommendation?: StrategyRecommendation;
  recommendationFailed?: boolean;
  isComputingRecommendation?: boolean;
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
}) => {
  const [hiddenKeys, setHiddenKeys] = React.useState<Record<string, boolean>>({});

  const handleLegendClick = (data: LegendPayload) => {
    const dataKey = data.dataKey;
    if (dataKey !== undefined) {
      const key = String(dataKey);
      setHiddenKeys((prev) => ({ ...prev, [key]: !prev[key] }));
    }
  };

  const params: SimulationParams = {
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
  };

  const currency = params.displayCurrency;
  const formatValue = (val: number) => formatValueForCurrency(val, currency);

  const { mode, toggle, canApply } = useBeforeAfterToggle({ recommendation });
  const displayedResult = mode === 'after' && recommendation ? recommendation.recommendedResult : result;

  const isMonthlyTargetPossible = result.depletionAge === null || result.depletionAge >= params.userProfile.expectancy;
  const monthlyTarget =
    params.spendingStrategy === 'max_sustainable' && result.calculatedTargetSpending
      ? result.calculatedTargetSpending
      : params.userProfile.targetMonthlySpending;

  const captions = generateChartCaptions(displayedResult, params);

  return (
    <div className={styles.container}>
      {/* Strategy Indicator Banners — 항상 baseline(현재 설정) 기준, Before/After 토글과 무관 */}
      {params.spendingStrategy === 'max_sustainable' && result.calculatedTargetSpending !== undefined && (
        <div className={styles.warningCard} style={{ background: 'rgba(16, 185, 129, 0.1)', borderColor: 'rgba(16, 185, 129, 0.3)', marginBottom: '1.5rem' }}>
          <Award size={22} className={styles.warningIcon} color="var(--success)" />
          <div className={styles.warningContent}>
            <span className={styles.warningTitle} style={{ color: 'var(--success)' }}>최대 고정 생활비 산출 완료</span>
            <span className={styles.warningText}>
              시뮬레이션 결과, 고갈 없이 유지 가능한 <strong>최대 월 생활비는 {formatValue(result.calculatedTargetSpending)}</strong>입니다. 모든 차트는 이 금액을 목표로 다시 그려졌습니다.
            </span>
          </div>
        </div>
      )}
      {params.spendingStrategy === 'dividend_only' && (
        <div className={styles.warningCard} style={{ background: 'rgba(59, 130, 246, 0.1)', borderColor: 'rgba(59, 130, 246, 0.3)', marginBottom: '1.5rem' }}>
          <Zap size={22} className={styles.warningIcon} color="#3B82F6" />
          <div className={styles.warningContent}>
            <span className={styles.warningTitle} style={{ color: '#3B82F6' }}>배당금 100% 소비 모드 적용 중</span>
            <span className={styles.warningText}>
              은퇴 후 매월 발생하는 배당금 및 연금(이자)만 100% 소비하며, 원금은 전혀 매도하지 않도록 시뮬레이션 되었습니다.
            </span>
          </div>
        </div>
      )}
      {result.depletionAge === null
        && result.goalAchievementRate < 100
        && result.endingAssets >= result.retirementAssetsAtRetirement && (
        <div className={styles.warningCard} style={{ background: 'rgba(16, 185, 129, 0.1)', borderColor: 'rgba(16, 185, 129, 0.3)', marginBottom: '1.5rem' }}>
          <Award size={22} className={styles.warningIcon} color="var(--success)" />
          <div className={styles.warningContent}>
            <span className={styles.warningTitle} style={{ color: 'var(--success)' }}>자산이 고갈되지 않고 유지·증가하는 추세입니다</span>
            <span className={styles.warningText}>
              은퇴 소득 달성률({result.goalAchievementRate}%)은 배당·연금 등 고정소득만 반영한 수치입니다.
              기대수명({params.userProfile.expectancy}세)까지 자산이 전혀 고갈되지 않고 은퇴 시작 시점보다
              최종 자산이 더 큰 것으로 나타나, 원금을 계획적으로 인출하며 사는 안정적인 은퇴 설계로 평가됩니다.
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
        goalAchievementRate={result.goalAchievementRate}
        fireAge={result.fireAge}
        endingAssets={result.endingAssets}
        assets={params.assets}
        privatePensions={params.privatePensions}
        nationalPension={params.nationalPension}
        otherIncomes={params.otherIncomes}
        taxSettings={params.taxSettings}
        spendingStrategy={params.spendingStrategy}
        inflationRate={params.inflationRate}
        inflationMode={params.inflationMode}
        utility={result.utility}
        recommendation={recommendation}
      />

      {/* STEP 2: 핵심 KPI */}
      <CoreKpiGrid
        survivalScore={displayedResult.retirementScore}
        expectancy={params.userProfile.expectancy}
        endingAssets={displayedResult.endingAssets}
        monthlyTarget={monthlyTarget}
        utilityScore={displayedResult.utility?.score}
        formatValue={formatValue}
      />
      <SecondaryKpiCollapse
        depletionAge={displayedResult.depletionAge}
        expectancyAge={params.userProfile.expectancy}
        monthlyTarget={monthlyTarget}
        isMonthlyTargetPossible={isMonthlyTargetPossible}
        formatValue={formatValue}
        calculatedTargetSpending={result.calculatedTargetSpending}
      />

      {/* STEP 3: AI 추천 전략 체크리스트 */}
      <RecommendationChecklist
        recommendation={recommendation}
        recommendationFailed={recommendationFailed}
        isComputingRecommendation={isComputingRecommendation}
        formatValue={formatValue}
      />

      {/* STEP 4: 그래프 3종 (각 상단에 rule-based AI 캡션) */}
      <AssetGrowthChart
        params={params}
        result={displayedResult}
        compareResults={compareResults}
        hiddenKeys={hiddenKeys}
        onLegendClick={handleLegendClick}
        caption={captions.assetGrowth}
      />
      <IncomeCompositionChart
        params={params}
        result={displayedResult}
        hiddenKeys={hiddenKeys}
        onLegendClick={handleLegendClick}
        caption={captions.incomeComposition}
      />
      <SpendingCompositionChart
        params={params}
        result={displayedResult}
        hiddenKeys={hiddenKeys}
        onLegendClick={handleLegendClick}
        caption={captions.spendingComposition}
      />

      {/* STEP 5: 전문가용 상세 분석 (기본 Collapse) */}
      <ExpertDetailsPanel
        result={displayedResult}
        params={params}
        utility={displayedResult.utility}
        bequestAdequacyExplanation={displayedResult.utility ? explainBequestAdequacy(params, displayedResult) : undefined}
        isPro={isPro}
        formatValue={formatValue}
      />
    </div>
  );
};
export default DashboardSection;
