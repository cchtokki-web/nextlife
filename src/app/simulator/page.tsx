"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { useSession, signOut } from 'next-auth/react';
import type { SimulationParams } from '../../core/entities/types';
import { LegacySimulationEngine } from '../../core/simulation/LegacySimulationEngine';
import { computeRiskAlerts } from '../../core/usecases/dashboard/computeRiskAlerts';
import { computeExecutionRoadmap, selectDepletionAge } from '../../core/usecases/dashboard/computeExecutionRoadmap';
import { computeSensitivityAnalysis } from '../../core/usecases/dashboard/computeSensitivityAnalysis';
import { resolvePlanAssetStatus } from '../../core/usecases/dashboard/resolvePlanAssetStatus';
import { computeShortfallSummary } from '../../core/usecases/dashboard/computeShortfallSummary';
import { describeDepletionAge } from '../../core/usecases/dashboard/describeDepletionAge';
import { formatCurrencyUnit, renderRiskAlertsSection, renderStrategyRecommendationSection, renderExecutionRoadmapSection, renderSensitivityTableSection, renderMonteCarloSection, renderShortfallSummarySection, renderPlanVerdictSection, renderNationalPensionSection, renderKeyLeversSection } from '../../web/features/Pdf/pdfReportSections';
import { buildReportHtml } from '../../web/features/Pdf/buildReportHtml';
import { generateReportPdf, ReportPageOverflowError } from '../../web/features/Pdf/generateReportPdf';
import { computePlanConfidence } from '../../core/usecases/dashboard/computePlanConfidence';
import { computeKeyLevers } from '../../core/usecases/dashboard/computeKeyLevers';
import { computePensionGapRisk } from '../../core/usecases/dashboard/computePensionGapRisk';
import { computeSustainableSpendingAdvice } from '../../core/usecases/dashboard/computeSustainableSpendingAdvice';
import { explainNationalPension } from '../../core/usecases/pension/explainNationalPension';
import { resolveTaxSettings } from '../../core/usecases/tax/taxRates';
import { useMediaQuery } from '../../web/hooks/useBrowserEnvironment';
import { initialParams } from '../../infrastructure/storage/localStore';
import { ScenarioManager } from '../../web/features/Scenario/ScenarioManager';
import { StrategySettingsPanel } from '../../web/features/StrategySettings/StrategySettingsPanel';
import { RetirementInputFlow } from '../../web/features/RetirementGoals/RetirementInputFlow';
import { Collapse } from '../../web/components/ui';
import { DashboardSection } from '../../web/features/Dashboard/DashboardSection';
import { useAppliedStrategy } from '../../web/hooks/useAppliedStrategy';
import GlassCard from '../../web/components/GlassCard';
import { Header } from '../../web/components/Header/Header';
import styles from './page.module.css';
import { AlertCircle, BarChart3, RotateCcw, PanelLeftClose, PanelLeftOpen, LogOut, FileText } from 'lucide-react';
import { useScenarios } from '../../web/features/Scenario/useScenarios';
import { E2eeKeyManager } from '../../web/components/E2eeKeyManager';
import { WithdrawAccountButton } from '../../web/features/Account/WithdrawAccountButton';
import { useWithdrawAccount } from '../../web/features/Account/useWithdrawAccount';
import { isDevMode } from '../../core/utils/isDevMode';
import {
  AnalysisBoundary,
  type AnalysisRequest,
  type AnalysisRuntimeValue,
} from '../../web/features/RetirementAnalysis/AnalysisRuntime';
import { useAnalysisRequest } from '../../web/features/RetirementAnalysis/useAnalysisRequest';

export default function Home() {
  const { data: session } = useSession();
  const scenarioState = useScenarios();
  const { 
    scenarios,
    activeParams,
    activeScenarioId,
    handleUpdateActiveParams,
    compareScenarioIds,
    setScenarioAnalyzed,
    isLoaded,
    needsKeyRestore,
    handleRestoreKey,
    isSaving,
    saveStatus,
    lastSaved,
    loadError,
    handleRetryLoad,
    keyNotice,
    handleAcknowledgeKey,
    handleRetrySendKey,
    restoreError,
    restoreUnverifiable,
    handleResetAndReissueKey,
    disarmUnsavedGuard
  } = scenarioState;

  // 탈퇴 후 signOut으로 페이지를 떠날 때 미저장 경고가 뜨면, 사용자가 "머무르기"를 눌러
  // 이미 삭제된 계정 위에 남을 수 있다.
  const handleWithdraw = useWithdrawAccount({ onBeforeSignOut: disarmUnsavedGuard });

  const isPro = session?.user?.tier === 'pro' || isDevMode();

  // 좁은 화면에서는 사이드바를 접어 둔다. 사용자가 직접 접거나 편 뒤에는 그 선택이 이긴다.
  //
  // 예전에는 마운트 이펙트에서 window.innerWidth를 읽어 setState했는데, 그러면 펼친 상태로
  // 한 번 커밋한 뒤 접혀서 모바일에서 사이드바가 깜빡였다. 미디어 쿼리를 구독하면 첫 렌더부터
  // 올바르고, 창 크기가 바뀔 때도 따라간다.
  const isNarrowScreen = useMediaQuery('(max-width: 1023px)');
  const [sidebarOverride, setSidebarOverride] = useState<boolean | null>(null);
  const isSidebarOpen = sidebarOverride ?? !isNarrowScreen;
  const setIsSidebarOpen = setSidebarOverride;
  const [engine] = useState(() => new LegacySimulationEngine());
  const [hoveredBtn, setHoveredBtn] = useState<string | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState<boolean>(false);

  // 분석 요청을 만드는 곳은 여기 하나다. 「분석 시작」 버튼과 추천 전략 적용·되돌리기, 그리고
  // 저장된 계획의 복원이 같은 요청을 만들어야 비교 시나리오가 어느 경로에서든 함께 따라간다.
  const buildAnalysisRequest = useCallback((params: SimulationParams): AnalysisRequest => ({
    params,
    compareScenarios: scenarios
      .filter((scenario) => compareScenarioIds.includes(scenario.id))
      .map(({ id, name, data }) => ({ id, name, data })),
  }), [scenarios, compareScenarioIds]);

  // 다시 로그인해도 분석했던 계획이 그대로 열려야 한다. 결과를 저장해 두는 것이 아니라,
  // 시나리오에 남은 「분석함」 표시를 보고 저장된 params로 같은 계산을 다시 돌린다.
  const activeScenario = scenarios.find((scenario) => scenario.id === activeScenarioId) ?? null;
  const { request: analysisRequest, setRequest: setAnalysisRequest } = useAnalysisRequest({
    isLoaded,
    activeScenarioId,
    analyzedAt: activeScenario?.analyzedAt ?? null,
    buildRequest: () => buildAnalysisRequest(activeParams),
  });

  // 추천 카드의 「적용」과 그 되돌리기.
  //
  // 설정 갱신과 재분석 요청이 **같은 커밋에서 같은 params 참조**를 받는 것이 중요하다.
  // 아래 analysisIsCurrent가 참조 비교라, 둘이 어긋나면 적용 직후 대시보드가 "다시 분석해
  // 주세요"로 한 프레임 사라진다. 되돌리기 버튼은 그 대시보드 «안»의 추천 카드에만 있으므로,
  // 사라지는 순간 사용자는 방금 누른 적용을 취소할 경로를 잃는다.
  const appliedStrategy = useAppliedStrategy({
    activeParams,
    activeScenarioId,
    onChangeParams: handleUpdateActiveParams,
    onReanalyze: (params) => setAnalysisRequest(buildAnalysisRequest(params)),
  });

  // Dynamically update document body preset attribute for dynamic styling/glows
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.body.setAttribute('data-preset', activeParams.yieldPreset || 'base');
    }
  }, [activeParams.yieldPreset]);

  const formatValue = (val: number): string => {
    const currency = activeParams.displayCurrency;
    if (val <= 0) return currency === 'KRW' ? '0원' : '$ 0';
    if (currency === 'KRW') {
      const valueInMan = Math.round(val / 10000);
      if (valueInMan === 0) return '0원';

      const gyeong = Math.floor(valueInMan / 1000000000000);
      const jo = Math.floor((valueInMan % 1000000000000) / 100000000);
      const eok = Math.floor((valueInMan % 100000000) / 10000);
      const man = valueInMan % 10000;

      const parts = [];
      if (gyeong > 0) parts.push(`${gyeong.toLocaleString()}경`);
      if (jo > 0) parts.push(`${jo.toLocaleString()}조`);
      if (eok > 0) parts.push(`${eok.toLocaleString()}억`);
      if (man > 0) parts.push(`${man.toLocaleString()}만`);

      return parts.join(' ') + '원';
    } else {
      if (val >= 1000000) {
        return `$ ${(val / 1000000).toFixed(2)}M`;
      }
      if (val >= 1000) {
        return `$ ${(val / 1000).toFixed(1)}K`;
      }
      return `$ ${Math.round(val).toLocaleString()}`;
    }
  };

  const handleDownload = async (analysis: AnalysisRuntimeValue | null) => {
    if (isGeneratingPdf || !analysis) return;
    const {
      effective, recommendation, result, monteCarlo, sequenceRisk,
      strategyOptimization, strategyOptimizationStatus,
    } = analysis;
    setIsGeneratingPdf(true);

    try {

      // retirementGrade는 꺼내지 않는다 — 1페이지 판정은 시장 변동을 반영한 밴드
      // (PlanConfidence.band)가 말하고, 결정론 등급만 크게 찍는 것이 정확히 이번에 없앤 문제다.
      //
      // goalAchievementRate·fireAge·avgRetirementMonthlyIncome도 더는 꺼내지 않는다. 옛 1페이지
      // 요약 그리드가 쓰던 값인데, 그 그리드는 「사망 시 잔여 자산」을 같은 페이지의 판정 블록과
      // 중복 인쇄했고 나머지 두 지표는 각주 세 줄을 붙여야 뜻이 통하는 파생 지표였다.
      const { retirementScore, depletionAge, endingAssets } = result;
      // 리포트가 인쇄하는 모든 값은 "결과(result)를 만든 params", 즉 effective.params에서 읽는다.
      // compiled.params(AI 센티널 적용 전)나 activeParams(사용자가 입력한 원본)를 읽으면
      // 경제 시나리오·리스크 성향·연금 전략이 지배하는 필드에서 화면에 찍힌 숫자와
      // 실제 시뮬레이션이 쓴 숫자가 달라진다
      // (물가상승률·국민연금 개시 나이·저율과세 한도 내 인출 등).
      // 예외는 "사용자가 무엇을 입력했는가"를 보여주는 설정 UI뿐이며 이 리포트는 결과 설명이다.
      const reportParams = effective.params;
      // 조립에 필요한 나머지 필드(자산·연금·물가 등)는 buildReportHtml이 params에서 직접 읽는다.
      const { userProfile, displayCurrency, taxSettings } = reportParams;

      const currentTaxSettings = resolveTaxSettings(taxSettings);
      const displayCurrencyUnit = formatCurrencyUnit(displayCurrency);

      const formatValuePrint = (val: number): string => formatValue(val);

      // 시계는 한 번만 읽는다. 예전에는 출력 일시와 저작권 연도가 각각 new Date()를 불러,
      // 자정을 걸치면 한 문서 안에서 두 값이 다른 날짜를 가리킬 수 있었다.
      // 아래 조립부에 넘길 때는 이미 포맷된 문자열로 넘긴다 — toLocaleString()은 실행
      // 환경의 로케일에 따라 결과가 달라져, 조립을 순수 함수로 뽑은 뒤 테스트에서
      // 재현할 수 없게 된다.
      const generatedAt = new Date();
      const generatedAtText = generatedAt.toLocaleString();
      const copyrightYear = generatedAt.getFullYear();

      // 「NextLife 추천」. 화면의 추천 카드와 같은 데이터·같은 문구를 쓴다.
      //
      // 예전 이 자리에는 레거시 「🤖 AI 추천 전략」 체크리스트와 평생 효용 점수 페이지가
      // 있었다. 둘 다 효용 점수로 말했는데, 화면은 이미 목표 달성 확률로 말하는 다른 추천을
      // 내고 있어 같은 계획의 두 문서가 서로 다른 축으로 서로 다른 전략을 권했다.
      const strategyRecommendationHtml = renderStrategyRecommendationSection({
        recommendations: strategyOptimization?.recommendations?.recommendations,
        // 화면의 ☆추천과 같은 출처. 넘기지 않으면 리포트가 제 규칙으로 다시 고른다.
        primary: strategyOptimization?.recommendations?.primary,
        status: strategyOptimizationStatus,
        unsupportedHardGoals: strategyOptimization?.debug?.unsupportedHardGoals,
        outcome: strategyOptimization?.outcome,
        // 화면이 쓰는 것과 같은 헬퍼·같은 입력이다. 리포트가 따로 역산하면 두 문서가 다른
        // 「지속 가능한 생활비」를 말할 수 있다.
        sustainableSpendingAdvice: computeSustainableSpendingAdvice(
          reportParams.spendingStrategy,
          reportParams.userProfile.targetMonthlySpending,
          result.calculatedTargetSpending,
        ),
        params: reportParams,
        formatValue: formatValuePrint,
      });

      const riskAlerts = computeRiskAlerts(result, reportParams, effective.utilityConfig);
      const riskAlertsSectionHtml = renderRiskAlertsSection(riskAlerts);
      const shortfallSummarySectionHtml = renderShortfallSummarySection(
        computeShortfallSummary(reportParams, result),
        formatValuePrint,
        { expectancy: userProfile.expectancy, spendingSuccessRate: monteCarlo?.spendingSuccessRate }
      );
      // 화면(DashboardSection)과 같은 함수로 자산 상태를 판정한다 — PDF와 화면이 서로 다른
      // 근거로 "고갈"과 "미보유"를 말하면 같은 계획의 두 문서가 어긋난다.
      const planAssetStatus = resolvePlanAssetStatus(result, reportParams);
      // 설정액(월 200만원)이 표의 금액(월 135만원)이 되기까지의 단계. 이 내역이 없으면
      // 사용자는 두 숫자의 차이를 계산 오류로 읽는다.
      const nationalPensionSectionHtml = renderNationalPensionSection(
        explainNationalPension(reportParams),
        formatValuePrint
      );
      // 결정론 점수에 시장 변동 성공률을 반영한 판정. 화면의 진단 카드와 같은 함수를 쓴다.
      // MC가 아직 계산되지 않았으면 basis가 'deterministic'으로 떨어지고, 리포트는 그 사실을
      // 조용히 넘기지 않고 명시한다(renderPlanVerdictSection).
      const planConfidence = computePlanConfidence(
        retirementScore,
        monteCarlo && {
          spendingSuccessRate: monteCarlo.spendingSuccessRate,
          assetSuccessRate: monteCarlo.successRate,
          goalSuccessProbability: monteCarlo.goalSuccessProbability,
        }
      );
      const planVerdictSectionHtml = renderPlanVerdictSection({
        expectancy: userProfile.expectancy,
        deterministicDepletionText: describeDepletionAge(depletionAge, userProfile.expectancy, planAssetStatus),
        endingAssets,
        confidence: planConfidence,
        monteCarlo,
        formatValue: formatValuePrint,
      });
      // **로드맵은 현재 계획 기준이다(화면과 같다).** 추천안을 넘기면 리포트의 다른 모든
      // 숫자는 현재 계획인데 로드맵만 추천 나이를 그린다. 추천안의 연령별 변경은 위
      // 「NextLife 추천」의 "달라지는 점"이 담당한다. 고갈 나이도 같은 기준이어야 한다
      // (selectDepletionAge 주석 참고).
      const roadmap = computeExecutionRoadmap(reportParams, undefined, selectDepletionAge(undefined, result), planAssetStatus);
      const executionRoadmapSectionHtml = renderExecutionRoadmapSection(roadmap);
      // 기준선을 넘기지 않는다 — computeSensitivityAnalysis가 6개 시나리오와 같은 고정 계획으로
      // 직접 계산한다. 예전에는 화면과 PDF가 서로 다른 기준선을 넘겨(화면은 runForUtility(params),
      // 여기는 run()의 result) 같은 계획의 두 문서가 다른 증감을 보여줄 수 있었다.
      const sensitivity = computeSensitivityAnalysis(reportParams, engine);
      const sensitivityTableSectionHtml = renderSensitivityTableSection(sensitivity.scenarios, {
        depletionAge: sensitivity.baselineDepletionAge,
        unmetSpendingYears: sensitivity.baselineUnmetSpendingYears,
        planAssetStatus: sensitivity.baselinePlanAssetStatus,
        frozenMonthlySpending: sensitivity.frozenMonthlySpending,
      });
      // 화면(KeyLeversCard)과 같은 함수·같은 순서를 쓴다. 같은 계획의 두 문서가 서로 다른
      // 우선순위를 제시하면 안 된다.
      const keyLeversSectionHtml = renderKeyLeversSection(
        computeKeyLevers({
          sensitivity,
          pensionGap: computePensionGapRisk(reportParams, result),
          shortfall: computeShortfallSummary(reportParams, result),
          recommendation,
          formatValue: formatValuePrint,
        })
      );


      // 페이지 HTML 조립은 buildReportHtml이 전담한다 — DOM도 jsPDF도 모르는 순수 함수라
      // 골든 스냅샷으로 잠글 수 있다(buildReportHtml.test.ts). 예전에는 이 자리에 376줄이
      // 들어 있었고, 조립 결과만 따로 확인할 방법이 없어 표기 결함이 실물 PDF를 눈으로
      // 훑기 전까지 드러나지 않았다.
      const pagesHtml = buildReportHtml({
        params: reportParams,
        result,
        taxSettings: currentTaxSettings,
        displayCurrencyUnit,
        formatValue: formatValuePrint,
        generatedAtText,
        copyrightYear,
        sections: {
          planVerdict: planVerdictSectionHtml,
          strategyRecommendation: strategyRecommendationHtml,
          riskAlerts: riskAlertsSectionHtml,
          shortfallSummary: shortfallSummarySectionHtml,
          nationalPension: nationalPensionSectionHtml,
          executionRoadmap: executionRoadmapSectionHtml,
          sensitivityTable: sensitivityTableSectionHtml,
          keyLevers: keyLeversSectionHtml,
          monteCarlo: renderMonteCarloSection(monteCarlo, sequenceRisk),
        },
      });

      await generateReportPdf(pagesHtml, 'NextLife_Simulation_Report.pdf');
    } catch (error) {
      console.error('Failed to generate PDF:', error);
      // 오류를 구분해서 알린다. 예전에는 무엇이 터졌든 "다시 시도해 주세요"였는데, 이 자리에
      // 오는 오류는 대부분 «결정적»이라 다시 눌러도 똑같이 실패한다. 사용자를 무한 재시도로
      // 보내는 안내이자, ReportPageOverflowError가 일부러 실어 온 「몇 쪽이 넘쳤는가」를
      // 유일한 표시 지점에서 버리는 처리였다.
      if (error instanceof ReportPageOverflowError) {
        alert(
          `리포트 ${error.pageNumbers.join(', ')}쪽의 내용이 페이지를 넘어서 저장을 중단했습니다.\n`
          + '잘린 문서가 만들어지지 않도록 막은 것이며, 화면의 분석 결과는 정상입니다.'
        );
      } else if (error instanceof Error && /dynamically imported module/i.test(error.message)) {
        // jspdf·html2canvas는 동적 import다. 오프라인이거나 배포 직후 낡은 청크를 물고 있으면
        // 여기로 온다 — 이때만 「다시 시도」가 실제로 통하고, 필요한 것은 새로고침이다.
        alert('리포트 생성 모듈을 불러오지 못했습니다. 네트워크를 확인한 뒤 새로고침해 주세요.');
      } else {
        alert('리포트를 만드는 중 오류가 발생했습니다. 화면의 분석 결과는 정상입니다.');
      }
    } finally {
      setIsGeneratingPdf(false);
    }
  };





  const handleReset = () => {
    if (confirm('현재 시나리오의 입력사항이 기본값으로 초기화됩니다. 계속하시겠습니까?')) {
      handleUpdateActiveParams(initialParams);
      setAnalysisRequest(null);
      // 「분석함」 표시도 함께 지운다. 남겨 두면 다음 로그인에서 기본값 위에 결과 화면이
      // 복원되어, 초기화가 그 시나리오에서만 잠깐 통한 것처럼 보인다.
      if (activeScenarioId) setScenarioAnalyzed(activeScenarioId, false);
      // 초기화한 설정 위에 "추천 전략을 적용했다"는 표시(카드의 「적용 해제」)가 남으면 안 된다.
      appliedStrategy.forget();
    }
  };

  if (loadError) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh',
        color: 'var(--foreground, #f8fafc)',
        backgroundColor: 'var(--background, #0b0f19)',
        gap: '1.5rem',
        padding: '2rem',
        textAlign: 'center'
      }}>
        <div style={{ color: 'var(--danger, #ef4444)', fontSize: '1.2rem', fontWeight: 600 }}>
          시나리오 데이터를 불러오는 데 실패했습니다.
        </div>
        <p style={{ color: 'var(--foreground-muted, #94a3b8)', maxWidth: '400px', margin: 0, fontSize: '0.9rem', lineHeight: 1.5 }}>
          {loadError}
        </p>
        <button
          onClick={handleRetryLoad}
          style={{
            padding: '0.6rem 1.5rem',
            backgroundColor: 'var(--primary, #3b82f6)',
            color: '#fff',
            border: 'none',
            borderRadius: '12px',
            fontSize: '0.9rem',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'opacity 0.2s',
          }}
          onMouseEnter={(e) => e.currentTarget.style.opacity = '0.9'}
          onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
        >
          다시 시도
        </button>
      </div>
    );
  }

  if (!isLoaded) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', color: 'var(--foreground-muted)' }}>시뮬레이션 엔진을 준비하고 있습니다...</div>;
  }

  const renderPage = (analysis: AnalysisRuntimeValue | null) => {
    const analysisIsCurrent = analysis?.sourceParams === activeParams;
    // 「분석 시작」만은 추천 검증이 실패했을 때 다시 열어 둔다. 워커 오류는 일시적일 수 있는데,
    // 결과가 「최신」이라는 이유로 버튼을 잠그면 설정을 억지로 건드리거나 새로고침하는 것 외에
    // 재시도할 방법이 없다. 대시보드와 PDF는 analysisIsCurrent 그대로 둔다 — 결정론 결과와
    // Monte Carlo는 멀쩡하므로 화면을 내릴 이유가 없다.
    const canReanalyze = !analysisIsCurrent || analysis?.strategyOptimizationStatus === 'error';
    return (
    <main className={styles.main}>
      <Header saveStatus={saveStatus} isSaving={isSaving} lastSaved={lastSaved}>
        <div className={styles.actionContainer}>


            <button 
              onClick={handleReset}
              aria-label="초기화"
              title="초기화"
              onMouseEnter={() => setHoveredBtn('reset')}
              onMouseLeave={() => setHoveredBtn(null)}
              style={{
                display: 'flex', 
                alignItems: 'center', 
                gap: '0.5rem', 
                padding: '0.6rem 1.2rem', 
                background: hoveredBtn === 'reset' ? 'rgba(255, 77, 79, 0.1)' : 'var(--card-bg)', 
                border: `1px solid ${hoveredBtn === 'reset' ? 'var(--danger, #ff4d4f)' : 'var(--card-border)'}`, 
                borderRadius: '12px', 
                color: 'var(--danger, #ff4d4f)', 
                cursor: 'pointer', 
                fontSize: '0.85rem', 
                fontWeight: 600, 
                transition: 'all 0.2s ease',
                whiteSpace: 'nowrap',
              }}
            >
              <RotateCcw size={16} />
              <span className={styles.buttonLabel}>초기화</span>
            </button>
            <button 
              onClick={() => handleDownload(analysisIsCurrent ? analysis : null)}
              disabled={isGeneratingPdf || !analysisIsCurrent}
              aria-label="결과 다운로드"
              title="결과 다운로드"
              onMouseEnter={() => setHoveredBtn('download')}
              onMouseLeave={() => setHoveredBtn(null)}
              style={{
                display: 'flex', 
                alignItems: 'center', 
                gap: '0.5rem', 
                padding: '0.6rem 1.2rem', 
                background: hoveredBtn === 'download' ? 'rgba(255, 255, 255, 0.05)' : 'var(--card-bg)', 
                border: `1px solid ${hoveredBtn === 'download' ? 'var(--primary)' : 'var(--card-border)'}`, 
                borderRadius: '12px', 
                color: hoveredBtn === 'download' ? 'var(--primary)' : 'var(--foreground-muted)', 
                cursor: isGeneratingPdf || !analysisIsCurrent ? 'not-allowed' : 'pointer',
                opacity: isGeneratingPdf || !analysisIsCurrent ? 0.6 : 1,
                fontSize: '0.85rem', 
                fontWeight: 600, 
                transition: 'all 0.2s ease',
                whiteSpace: 'nowrap',
              }}
            >
              <FileText size={16} />
              {/* 생성 중 문구는 느린 PDF 렌더의 유일한 진행 표시라 모바일에서도 남긴다. */}
              <span className={isGeneratingPdf ? undefined : styles.buttonLabel}>
                {isGeneratingPdf ? 'PDF 생성 중...' : '결과 다운로드'}
              </span>
            </button>


            <button 
              onClick={() => signOut({ callbackUrl: '/' })}
              aria-label="로그아웃"
              title="로그아웃"
              onMouseEnter={() => setHoveredBtn('logout')}
              onMouseLeave={() => setHoveredBtn(null)}
              style={{
                display: 'flex', 
                alignItems: 'center', 
                gap: '0.5rem', 
                padding: '0.6rem 1.2rem', 
                background: hoveredBtn === 'logout' ? 'rgba(255, 255, 255, 0.05)' : 'var(--card-bg)', 
                border: `1px solid ${hoveredBtn === 'logout' ? 'var(--foreground)' : 'var(--card-border)'}`, 
                borderRadius: '12px', 
                color: hoveredBtn === 'logout' ? 'var(--foreground)' : 'var(--foreground-muted)', 
                cursor: 'pointer', 
                fontSize: '0.85rem', 
                fontWeight: 600, 
                transition: 'all 0.2s ease',
                whiteSpace: 'nowrap',
              }}
            >
              <LogOut size={16} />
              <span className={styles.buttonLabel}>로그아웃</span>
            </button>

            {/* 가장 바깥에 둔다. 자주 쓰는 로그아웃으로 가는 길에 포인터가 이 위를 지나지 않는다. */}
            <WithdrawAccountButton
              onWithdraw={handleWithdraw}
              scenarioCount={scenarios.length}
              hovered={hoveredBtn === 'withdraw'}
              onHoverChange={(h) => setHoveredBtn(h ? 'withdraw' : null)}
              labelClassName={styles.buttonLabel}
            />
        </div>
      </Header>

      <E2eeKeyManager
        keyNotice={keyNotice}
        onAcknowledgeKey={handleAcknowledgeKey}
        onRetrySendKey={handleRetrySendKey}
        needsKeyRestore={needsKeyRestore}
        handleRestoreKey={handleRestoreKey}
        restoreError={restoreError}
        onResetScenarios={handleResetAndReissueKey}
        restoreUnverifiable={restoreUnverifiable}
      />

      {/* 2. Content Layout */}
      <div style={{ position: 'relative' }}>
        <div className={styles.layoutGrid}>
          
          {/* Left Side: User Inputs & Scenarios */}
          <section className={`${styles.leftColumn} ${!isSidebarOpen ? styles.leftColumnHidden : ''}`}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '-0.5rem' }}>
              <button 
                onClick={() => setIsSidebarOpen(false)}
                style={{
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '0.5rem', 
                  padding: '0.4rem 0.8rem', 
                  background: 'var(--card-bg)', 
                  border: '1px solid var(--card-border)', 
                  borderRadius: '8px', 
                  color: 'var(--foreground-muted)', 
                  cursor: 'pointer', 
                  fontSize: '0.8rem', 
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--primary)'; e.currentTarget.style.borderColor = 'var(--primary)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--foreground-muted)'; e.currentTarget.style.borderColor = 'var(--card-border)'; }}
              >
                <PanelLeftClose size={14} />
                설정 패널 접기
              </button>
            </div>
            
            {/* 시나리오가 상위 컨텍스트이고, 아래 설정은 선택한 시나리오에 종속된다. */}
            <GlassCard>
              <ScenarioManager scenarioState={scenarioState} />

              <div className="pt-5">
                <RetirementInputFlow
                  params={activeParams}
                  onChangeParams={handleUpdateActiveParams}
                  // 결과가 현재 설정으로 계산된 것이면 다시 누를 이유가 없다. 판정은 두 값을
                  // 모두 쥔 이곳에서만 할 수 있다(추천 검증 실패는 예외 — canReanalyze 주석).
                  analysisIsCurrent={!canReanalyze}
                  onStartAnalysis={() => {
                    setAnalysisRequest(buildAnalysisRequest(activeParams));
                    // 이 시나리오를 분석했다는 사실만 남긴다. 결과는 저장하지 않는다 —
                    // 다음 접속에서 같은 params로 다시 계산해 이 화면을 세운다.
                    if (activeScenarioId) setScenarioAnalyzed(activeScenarioId, true);
                    if (isNarrowScreen) setIsSidebarOpen(false);
                  }}
                />
              </div>
            </GlassCard>

            {/* 기존의 세부 전략·연금·경제·세금 입력은 삭제하지 않고 기본 흐름 밖에 보존한다. */}
            <GlassCard>
              <Collapse title={<span className="text-sm font-semibold">고급 / 전문가 설정</span>}>
                <div className="pt-4">
                  {/* 추천은 여기서 한 번만 계산해 내려보낸다. 패널이 자체적으로 계산하면
                      이 앱에서 가장 무거운 계산(최대 218개 후보 시뮬레이션)이 두 배가 된다. */}
                  <StrategySettingsPanel
                    params={activeParams}
                    onChangeParams={handleUpdateActiveParams}
                    recommendation={analysisIsCurrent ? analysis.recommendation : undefined}
                    recommendationFailed={analysisIsCurrent ? analysis.recommendationFailed : false}
                    sentinels={analysisIsCurrent ? analysis.sentinels : undefined}
                  />
                </div>
              </Collapse>
            </GlassCard>
          </section>

          {/* Right Side: Visual Dashboard */}
          <section className={styles.rightColumn}>
            {!isSidebarOpen && (
              <div style={{ display: 'flex' }}>
                <button 
                  onClick={() => setIsSidebarOpen(true)}
                  style={{
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '0.5rem', 
                    padding: '0.5rem 1rem', 
                    background: 'var(--card-bg)', 
                    border: '1px solid var(--card-border)', 
                    borderRadius: '8px', 
                    color: 'var(--foreground)', 
                    cursor: 'pointer', 
                    fontSize: '0.85rem',
                    fontWeight: 500,
                    transition: 'all 0.2s ease',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--primary)'; e.currentTarget.style.borderColor = 'var(--primary)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--foreground)'; e.currentTarget.style.borderColor = 'var(--card-border)'; }}
                >
                  <PanelLeftOpen size={16} />
                  설정 패널 열기
                </button>
              </div>
            )}
            {analysisIsCurrent ? (
              <DashboardSection
                params={analysis.effective.params}
                result={analysis.result}
                compareResults={analysis.compareResults}
                isPro={isPro}
                recommendation={analysis.recommendation}
                sentinels={analysis.sentinels}
                monteCarlo={analysis.monteCarlo}
                monteCarloStatus={analysis.monteCarloStatus}
                sequenceRisk={analysis.sequenceRisk}
                strategyOptimization={analysis.strategyOptimization}
                strategyOptimizationStatus={analysis.strategyOptimizationStatus}
                // 적용 대상은 센티널이 적용된 analysis.effective.params가 아니라 사용자가
                // 입력한 activeParams다. 그 결정을 훅 한 곳에 두어 둘을 혼동할 여지를 없앤다.
                onApplyStrategy={appliedStrategy.applyRecommendation}
                previewStrategyApply={appliedStrategy.previewApply}
                appliedStrategy={appliedStrategy.snapshot ?? undefined}
                onUndoStrategy={appliedStrategy.undo}
              />
            ) : (
              <GlassCard>
                <div className="flex min-h-64 flex-col items-center justify-center px-6 py-12 text-center">
                  <BarChart3 size={30} className="text-primary" aria-hidden="true" />
                  <h2 className="mt-4 text-lg font-bold text-foreground">
                    {analysis ? '입력 변경사항을 다시 분석해 주세요' : '은퇴 계획을 만들어 보세요'}
                  </h2>
                  {/* 한국어 문장이 '눌러 / 주세요.'처럼 어절 중간에서 끊기지 않도록
                      break-keep으로 어절을 붙이고 text-balance로 줄 길이를 고르게 맞춘다. */}
                  <p className="mt-2 max-w-md text-sm leading-relaxed text-balance break-keep text-foreground-muted">
                    {analysis
                      ? '현재 결과는 이전 입력 기준이므로 숨겼습니다. 입력 패널 위쪽의 분석 시작을 다시 눌러 주세요.'
                      : <>개인정보와 자산정보를 확인하고 원하는 은퇴 목표를 선택한 뒤 &lsquo;분석 시작&rsquo;을 눌러 주세요.</>}
                  </p>
                </div>
              </GlassCard>
            )}
          </section>

        </div>
      </div>

      {/* 3. Footer Area & Compliance disclaimer */}
      <footer className={styles.footer}>
        <div className={styles.disclaimer}>
          <div className={styles.disclaimerTitle}>
            <AlertCircle size={14} />
            <span>중요 투자 및 시뮬레이션 법적 면책 고지</span>
          </div>
          <p>
            본 NextLife 웹 서비스에서 산출 및 표시되는 모든 결과(은퇴 점수, 자산 고갈 시점, 소득 달성률 등)는 사용자가 기입한 가정치와 과거 시장 데이터에 기반한 시뮬레이션 결과입니다. 이는 미래의 실제 자산 가치 및 수익률을 보장하지 않습니다.
          </p>
          <p style={{ marginTop: '0.4rem' }}>
            본 서비스가 제공하는 모든 분석 정보는 단순 참고용일 뿐이며, 특정 금융 상품에 대한 투자 권유나 재무적 의사 결정을 대행하지 않습니다. 실제 투자 결정 시에는 반드시 전문 공인 재무 설계사 또는 투자 자문 전문가와 상의하시기 바랍니다.
          </p>
          <div className={styles.copyright}>
            &copy; {new Date().getFullYear()} NextLife. Created by TokkiLab. All rights reserved.
          </div>
        </div>
      </footer>
    </main>
    );
  };

  return (
    <AnalysisBoundary request={analysisRequest} engine={engine}>
      {renderPage}
    </AnalysisBoundary>
  );
}
