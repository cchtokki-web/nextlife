"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { useSession, signOut } from 'next-auth/react';
import type { SimulationParams } from '../../core/entities/types';
import { LegacySimulationEngine } from '../../core/simulation/LegacySimulationEngine';
import { computeMonthlySpendingComposition } from '../../core/usecases/MonthlySpendingComposition';
import { computeRiskAlerts } from '../../core/usecases/dashboard/computeRiskAlerts';
import { computeExecutionRoadmap, selectDepletionAge } from '../../core/usecases/dashboard/computeExecutionRoadmap';
import { computeSensitivityAnalysis } from '../../core/usecases/dashboard/computeSensitivityAnalysis';
import { resolvePlanAssetStatus } from '../../core/usecases/dashboard/resolvePlanAssetStatus';
import { computeShortfallSummary } from '../../core/usecases/dashboard/computeShortfallSummary';
import { describeDepletionAge } from '../../core/usecases/dashboard/describeDepletionAge';
import { formatCurrencyUnit, renderRiskAlertsSection, renderStrategyRecommendationSection, renderExecutionRoadmapSection, renderSensitivityTableSection, renderMonteCarloSection, renderShortfallSummarySection, renderPlanVerdictSection, renderNationalPensionSection, renderKeyLeversSection } from '../../web/features/Pdf/pdfReportSections';
import { computePlanConfidence } from '../../core/usecases/dashboard/computePlanConfidence';
import { computeKeyLevers } from '../../core/usecases/dashboard/computeKeyLevers';
import { computePensionGapRisk } from '../../core/usecases/dashboard/computePensionGapRisk';
import { explainNationalPension } from '../../core/usecases/pension/explainNationalPension';
import { resolveTaxSettings } from '../../core/usecases/tax/taxRates';
import { NATIONAL_PENSION_NORMAL_START_AGE } from '../../core/usecases/pension/nationalPensionRules';
import { useMediaQuery } from '../../web/hooks/useBrowserEnvironment';
import { initialParams } from '../../infrastructure/storage/localStore';
import { ScenarioManager } from '../../web/features/Scenario/ScenarioManager';
import { StrategySettingsPanel } from '../../web/features/StrategySettings/StrategySettingsPanel';
import { RetirementInputFlow } from '../../web/features/RetirementGoals/RetirementInputFlow';
import { Collapse } from '../../web/components/ui';
import { DashboardSection } from '../../web/features/Dashboard/DashboardSection';
import { AppliedStrategyBanner } from '../../web/features/Dashboard/recommendation/AppliedStrategyBanner';
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

  // 추천 카드의 「이 전략 적용」과 그 되돌리기.
  //
  // 설정 갱신과 재분석 요청이 **같은 커밋에서 같은 params 참조**를 받는 것이 중요하다.
  // 아래 analysisIsCurrent가 참조 비교라, 둘이 어긋나면 적용 직후 대시보드가 "다시 분석해
  // 주세요"로 한 프레임 사라진다.
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
      const jsPDF = (await import('jspdf')).default;
      const html2canvas = (await import('html2canvas')).default;

      // retirementGrade는 꺼내지 않는다 — 1페이지 판정은 시장 변동을 반영한 밴드
      // (PlanConfidence.band)가 말하고, 결정론 등급만 크게 찍는 것이 정확히 이번에 없앤 문제다.
      //
      // goalAchievementRate·fireAge·avgRetirementMonthlyIncome도 더는 꺼내지 않는다. 옛 1페이지
      // 요약 그리드가 쓰던 값인데, 그 그리드는 「사망 시 잔여 자산」을 같은 페이지의 판정 블록과
      // 중복 인쇄했고 나머지 두 지표는 각주 세 줄을 붙여야 뜻이 통하는 파생 지표였다.
      const { retirementScore, depletionAge, endingAssets, yearlyResults } = result;
      // 리포트가 인쇄하는 모든 값은 "결과(result)를 만든 params", 즉 effective.params에서 읽는다.
      // compiled.params(AI 센티널 적용 전)나 activeParams(사용자가 입력한 원본)를 읽으면
      // 경제 시나리오·리스크 성향·연금 전략이 지배하는 필드에서 화면에 찍힌 숫자와
      // 실제 시뮬레이션이 쓴 숫자가 달라진다
      // (물가상승률·국민연금 개시 나이·저율과세 한도 내 인출 등).
      // 예외는 "사용자가 무엇을 입력했는가"를 보여주는 설정 UI뿐이며 이 리포트는 결과 설명이다.
      const reportParams = effective.params;
      const {
        userProfile,
        assets,
        privatePensions,
        isaAccounts,
        nationalPension,
        otherIncomes,
        inflationRate,
        inflationMode,
        baseExchangeRate,
        displayCurrency,
        taxSettings
      } = reportParams;

      const currentTaxSettings = resolveTaxSettings(taxSettings);
      const displayCurrencyUnit = formatCurrencyUnit(displayCurrency);

      const formatValuePrint = (val: number): string => formatValue(val);

      // 「NextLife 추천」. 화면의 추천 카드와 같은 데이터·같은 문구를 쓴다.
      //
      // 예전 이 자리에는 레거시 「🤖 AI 추천 전략」 체크리스트와 평생 효용 점수 페이지가
      // 있었다. 둘 다 효용 점수로 말했는데, 화면은 이미 목표 달성 확률로 말하는 다른 추천을
      // 내고 있어 같은 계획의 두 문서가 서로 다른 축으로 서로 다른 전략을 권했다.
      const strategyRecommendationHtml = renderStrategyRecommendationSection({
        recommendations: strategyOptimization?.recommendations?.recommendations,
        status: strategyOptimizationStatus,
        currentGoalProbability: monteCarlo?.goalSuccessProbability,
        unsupportedHardGoals: strategyOptimization?.debug?.unsupportedHardGoals,
        outcome: strategyOptimization?.outcome,
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

      // Create a temporary container
      const container = document.createElement('div');
      container.style.position = 'absolute';
      container.style.left = '-9999px';
      container.style.top = '0';
      container.style.width = '800px';

      const styleBlock = document.createElement('style');
      styleBlock.innerHTML = `
        .pdf-page {
          width: 794px;
          height: 1123px;
          padding: 50px 50px 40px 50px;
          box-sizing: border-box;
          background-color: #ffffff;
          color: #1e293b;
          font-family: 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          position: relative;
        }
        .pdf-content {
          flex-grow: 1;
          min-height: 0;
        }
        .pdf-data-table th,
        .pdf-data-table td {
          padding: 4px 5px !important;
          line-height: 1.15;
        }
        .pdf-footer {
          font-size: 10px;
          color: #94a3b8;
          border-top: 1px solid #cbd5e1;
          padding-top: 10px;
          display: flex;
          justify-content: space-between;
        }
        .pdf-page ul {
          list-style: disc;
        }
        .summary-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          column-gap: 22px;
          margin-top: 15px;
        }
        .summary-item {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          grid-template-rows: auto minmax(30px, auto);
          column-gap: 14px;
          min-height: 78px;
          padding: 10px 0;
          border-bottom: 1px dashed #e2e8f0;
          box-sizing: border-box;
        }
        .summary-label {
          margin: 0;
          font-size: 13.5px;
          font-weight: 600;
          color: #475569;
          line-height: 1.35;
        }
        .summary-note {
          margin: 5px 0 0;
          font-size: 9.5px;
          font-weight: 400;
          color: #94a3b8;
          line-height: 1.45;
        }
        .summary-value {
          grid-column: 2;
          grid-row: 1 / span 2;
          align-self: center;
          max-width: 235px;
          font-size: 15px;
          color: #0f172a;
          font-weight: 700;
          line-height: 1.35;
          text-align: right;
        }
      `;
      container.appendChild(styleBlock);

      // **페이지·섹션 번호를 리터럴로 쓰지 않는다.**
      //
      // 예전에는 두 번호가 전부 하드코딩이었고, 조건부인 시장 변동성 페이지 때문에 실제로
      // 어긋나 있었다: 「7. 시장 변동성 분석」과 「7. 연령별 소득원…」이 둘 다 7번이었고,
      // 재원 구성 각주는 "5페이지 세금 설정과 6페이지 금융소득과세"를 고정 문자열로 가리켰다.
      // 섹션 하나만 넣거나 빼도 문서 전체의 번호가 조용히 틀어지는 구조였다.
      //
      // 두 카운터는 **문서에 등장하는 순서대로** 소비된다(템플릿 리터럴은 왼쪽부터 평가된다).
      let sectionNo = 0;
      const nextSection = () => (sectionNo += 1);
      let pageNo = 0;
      const nextPage = () => (pageNo += 1);
      // 각주가 가리키는 페이지 번호를 나중에 채우기 위한 자리표. 실제 번호는 그 페이지를
      // 만들 때 확정되므로, 하드코딩 대신 치환으로 잇는다.
      let taxSettingsPageNo = 0;
      let firstYearlyTablePageNo = 0;

      // 시장 변동 검증은 **진단·추천 바로 뒤에 둔다**(화면의 「계획의 근거」 첫 항목과 같다).
      //
      // 예전에는 마지막 고정 페이지였다. 그래서 1페이지의 "기대수명까지 고갈 없음"을 읽은
      // 사용자가 여섯 페이지 뒤에야 "1,000회 중 37%만 남음"을 보게 됐다. 앞의 좋은 결과를
      // 강조하고 뒤의 위험을 별도 페이지에 숨긴 구조였다. 수익률 순서 위험(같은 평균,
      // 다른 순서)은 이 리포트에서 가장 값어치 있는 분석이기도 하다.
      //
      // 워커가 아직 끝나지 않았으면 이 페이지는 생략된다. 그때도 1페이지의 판정 블록이
      // "아직 계산되지 않았습니다"라고 밝히므로(renderPlanVerdictSection), 리포트가
      // 결정론 결과만 담은 채 완결된 문서처럼 보이는 일은 없다.
      const monteCarloHtml = renderMonteCarloSection(monteCarlo, sequenceRisk);
      const monteCarloPageHtml = () => monteCarloHtml === '' ? '' : `
        <div class="pdf-page">
          <div class="pdf-content">
            <h2 style="font-size: 16px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; color: #0f172a; margin-top: 0; margin-bottom: 10px;">${nextSection()}. 시장 변동 검증</h2>
            ${monteCarloHtml}
          </div>
          <div class="pdf-footer">
            <span>NextLife 은퇴 자산 시뮬레이션 리포트</span>
            <span>페이지 ${nextPage()} / {total_pages}</span>
          </div>
        </div>
      `;

      // Page 1: Summary and Settings
      let pagesHtml = `
        <div class="pdf-page">
          <div class="pdf-content">
            <h1 style="font-size: 26px; border-bottom: 3px solid #3b82f6; padding-bottom: 12px; color: #1e3a8a; margin-top: 0;">NextLife 은퇴 자산 시뮬레이션 결과 리포트</h1>
            <p style="font-size: 11px; color: #64748b; margin-bottom: 25px;">출력 일시: ${new Date().toLocaleString()}</p>
            
            <h2 style="margin-top: 0; font-size: 17px; color: #0f172a; border-bottom: none; padding-bottom: 0; margin-bottom: 12px;">${nextSection()}. 현재 계획 진단</h2>
            ${planVerdictSectionHtml}
            ${shortfallSummarySectionHtml}
            ${riskAlertsSectionHtml}

            <h2 style="font-size: 16px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; color: #0f172a; margin-top: 25px; margin-bottom: 10px;">${nextSection()}. 시뮬레이션 설정 상태</h2>
            <ul style="padding-left: 20px; margin-top: 5px; margin-bottom: 25px; font-size: 13px; line-height: 1.6;">
              <li style="margin-bottom: 6px;"><strong>현재 나이:</strong> ${userProfile.currentAge}세 / <strong>은퇴 목표 나이:</strong> ${userProfile.retirementAge}세 / <strong>기대 수명:</strong> ${userProfile.expectancy}세</li>
              <li style="margin-bottom: 6px;"><strong>목표 월 생활비:</strong> ${userProfile.targetMonthlySpending.toLocaleString()} ${displayCurrencyUnit}</li>
              <li style="margin-bottom: 6px;"><strong>인출 전략:</strong> ${reportParams.spendingStrategy === 'dividend_only' ? '배당금(이자) 100% 소비' : reportParams.spendingStrategy === 'max_sustainable' ? '최대 가능 생활비 자동계산' : '고정 목표 생활비'}</li>
              <li style="margin-bottom: 6px;"><strong>물가 상승률:</strong> ${inflationRate}% (${inflationMode === 'real' ? '실질 가치 기준 — 아래 모든 표의 생활비·연금 금액은 오늘 화폐가치로 고정 표시되며, 인플레이션은 자산 성장률에 사전 차감 반영되었습니다' : '명목 가치 기준 — 아래 모든 표의 생활비·연금 금액에 물가상승률이 매년 누적 반영되어 있습니다'})</li>
              <li style="margin-bottom: 6px;"><strong>표시 통화 / 기준 환율:</strong> ${displayCurrencyUnit} / 1 $ = ${baseExchangeRate.toLocaleString()}원</li>
            </ul>
          </div>
          <div class="pdf-footer">
            <span>NextLife 은퇴 자산 시뮬레이션 리포트</span>
            <span>페이지 ${nextPage()} / {total_pages}</span>
          </div>
        </div>

        <div class="pdf-page">
          <div class="pdf-content">
            <h2 style="font-size: 16px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; color: #0f172a; margin-top: 0; margin-bottom: 10px;">${nextSection()}. NextLife 추천</h2>
            <p style="font-size: 11px; color: #64748b; margin-top: 0; margin-bottom: 14px;">목표에 가장 가까운 최종 전략과, 현재 계획에서 바뀌는 점만 비교합니다.</p>
            ${strategyRecommendationHtml}
          </div>
          <div class="pdf-footer">
            <span>NextLife 은퇴 자산 시뮬레이션 리포트</span>
            <span>페이지 ${nextPage()} / {total_pages}</span>
          </div>
        </div>

        ${monteCarloPageHtml()}

        <div class="pdf-page">
          <div class="pdf-content">
            <h2 style="font-size: 16px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; color: #0f172a; margin-top: 0; margin-bottom: 10px;">${nextSection()}. 실행 시점 및 민감도 분석</h2>
            <p style="font-size: 11px; color: #64748b; margin-top: 0; margin-bottom: 14px;">무엇부터 손대야 하는지, 현재 설정에서 나이별로 무슨 일이 일어나는지, 그리고 핵심 가정이 바뀌었을 때 결과가 얼마나 민감한지를 보여줍니다.</p>

            ${keyLeversSectionHtml}

            <h3 style="font-size: 13px; color: #0f172a; margin-bottom: 8px;">실행 로드맵</h3>
            ${executionRoadmapSectionHtml}

            <h3 style="font-size: 13px; color: #0f172a; margin-top: 20px; margin-bottom: 8px;">민감도 분석 (자산 고갈 나이 기준)</h3>
            ${sensitivityTableSectionHtml}
          </div>
          <div class="pdf-footer">
            <span>NextLife 은퇴 자산 시뮬레이션 리포트</span>
            <span>페이지 ${nextPage()} / {total_pages}</span>
          </div>
        </div>

        <div class="pdf-page">
          <div class="pdf-content">
            <h2 style="font-size: 16px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; color: #0f172a; margin-top: 0; margin-bottom: 10px;">${nextSection()}. 연금·자산 현황 및 세금 설정</h2>
            <div style="font-size: 13px; line-height: 1.6; display: grid; grid-template-columns: 1fr; gap: 12px;">
              <div>
                <strong>국민연금:</strong> 예상 월 수령액 ${nationalPension?.expectedMonthlyAmount.toLocaleString()}원 (${reportParams.withdrawalPlan?.nationalPensionStartAge ?? NATIONAL_PENSION_NORMAL_START_AGE}세부터 수령)
                ${nationalPensionSectionHtml}
              </div>
              <div>
                <strong>사적연금:</strong>
                <ul style="padding-left: 20px; margin-top: 4px; margin-bottom: 0;">
      `;

      if (privatePensions && privatePensions.length > 0) {
        privatePensions.forEach(p => {
          pagesHtml += `<li style="margin-bottom: 4px;"><strong>${p.name}</strong> (${p.type === 'irp' ? 'IRP' : p.type === 'savings' ? '연금저축' : '기타'}): 현재 잔액 ${p.balance.toLocaleString()} ${formatCurrencyUnit(p.currency)}, 매월 ${p.monthlyContribution.toLocaleString()} ${formatCurrencyUnit(p.currency)} 납입, 예상 연 수익률 ${p.annualReturn}%</li>`;
        });
      } else {
        pagesHtml += `<li>등록된 사적연금 없음</li>`;
      }

      pagesHtml += `
                </ul>
              </div>
              <div>
                <strong>투자 자산:</strong>
                <ul style="padding-left: 20px; margin-top: 4px; margin-bottom: 0;">
      `;

      if (assets && assets.length > 0) {
        assets.forEach(a => {
          pagesHtml += `<li style="margin-bottom: 4px;"><strong>${a.name}</strong> (${a.type}): ${a.quantity}주(개) x 평균단가 ${a.averagePrice.toLocaleString()} ${formatCurrencyUnit(a.currency)}, 매월 ${a.monthlyContribution.toLocaleString()} ${formatCurrencyUnit(a.currency)} 납입, 예상 연 수익률 ${a.annualGrowthRate}%, 배당률 ${a.dividendYield}%, 배당 재투자 ${a.reinvestDividend ? 'O' : 'X'}</li>`;
        });
      } else {
        pagesHtml += `<li>등록된 투자 자산 없음</li>`;
      }

      pagesHtml += `
                </ul>
              </div>
              <div>
                <strong>ISA 계좌:</strong>
                <ul style="padding-left: 20px; margin-top: 4px; margin-bottom: 0;">
      `;

      if (isaAccounts && isaAccounts.length > 0) {
        isaAccounts.forEach(isa => {
          pagesHtml += `<li style="margin-bottom: 4px;"><strong>${isa.name || 'ISA 계좌'}</strong> (${isa.type === 'general' ? '일반형' : '서민형'}): 현재 잔액 ${isa.balance.toLocaleString()} ${formatCurrencyUnit(isa.currency)}, 매월 ${isa.monthlyContribution.toLocaleString()} ${formatCurrencyUnit(isa.currency)} 납입, 예상 연 수익률 ${isa.annualReturn}%, 배당률 ${isa.dividendYield}%, 만기 ${isa.maturityYears}년</li>`;
        });
      } else {
        pagesHtml += `<li>등록된 ISA 계좌 없음</li>`;
      }

      pagesHtml += `
                </ul>
              </div>
              <div>
                <strong>기타 소득:</strong>
                <ul style="padding-left: 20px; margin-top: 4px; margin-bottom: 0;">
      `;

      if (otherIncomes && otherIncomes.length > 0) {
        otherIncomes.forEach(i => {
          pagesHtml += `<li style="margin-bottom: 4px;"><strong>${i.label}</strong>: 매월 ${i.monthlyAmount.toLocaleString()} ${formatCurrencyUnit(i.currency)}</li>`;
        });
      } else {
        pagesHtml += `<li>등록된 기타 소득 없음</li>`;
      }

      pagesHtml += `
                </ul>
              </div>
            </div>

            <h3 style="font-size: 13px; color: #0f172a; margin-top: 18px; margin-bottom: 6px;">세금 설정 (2024년 기준 단순화 모델)</h3>
            <p style="font-size: 9.5px; color: #94a3b8; margin: 0 0 6px;">실제 과세는 계좌·상품·소득 구간과 최신 세법에 따라 달라질 수 있으며, 세액공제·지방소득세 등 일부 항목은 포함하지 않습니다.</p>
            <ul style="padding-left: 20px; margin-top: 5px; margin-bottom: 0; font-size: 11px; line-height: 1.45;">
              <li style="margin-bottom: 6px;"><strong>금융소득종합과세 반영:</strong> ${currentTaxSettings.enableComprehensiveTax ? `반영 (2천만원 초과분 ${currentTaxSettings.comprehensiveTaxRate}% 추가 과세)` : '미반영'}</li>
              <li style="margin-bottom: 6px;"><strong>추가 건강보험료 반영:</strong> ${currentTaxSettings.enableHealthInsurance ? `반영 (초과분 ${currentTaxSettings.healthInsuranceRate}%)` : '미반영'}</li>
              <li style="margin-bottom: 6px;"><strong>배당소득세율:</strong> 해외 주식/ETF ${currentTaxSettings.usDividendTaxRate}% / 국내 주식/ETF ${currentTaxSettings.domesticDividendTaxRate}%</li>
              <li style="margin-bottom: 6px;"><strong>사적연금 고세율 과세 반영:</strong> ${currentTaxSettings.enablePrivatePensionTax ? '반영 - 한도 초과 시 고세율 적용' : '미반영 - 연령별 저율과세 유지'}</li>
              <li style="margin-bottom: 6px;"><strong>사적연금 저율과세 한도(연간):</strong> ${currentTaxSettings.privatePensionLimit.toLocaleString()}원, 한도 초과 시 세율 ${currentTaxSettings.privatePensionExcessTaxRate}%</li>
              <li style="margin-bottom: 6px;"><strong>사적연금 저율과세 한도 내 인출:</strong> ${currentTaxSettings.limitPrivatePensionToTaxLimit ? '한도 내 인출 (절세 최적화)' : '기본 인출 (일반 인출 계획)'}</li>
            </ul>
          </div>
          <div class="pdf-footer">
            <span>NextLife 은퇴 자산 시뮬레이션 리포트</span>
            <span>페이지 ${(taxSettingsPageNo = nextPage())} / {total_pages}</span>
          </div>
        </div>
      `;

      // Tables (이후 페이지 수는 데이터 양에 따라 달라진다)
      const chunks: typeof yearlyResults[] = [];
      // 9pt 표와 4px 셀 여백에서는 A4 한 장에 42행이 잘림 없이 들어간다. 기존 30행은
      // 10~12행짜리 반쪽 페이지를 반복해서 만들어 동일 샘플이 10페이지까지 늘어났다.
      const rowsPerPage = 42;
      for (let i = 0; i < yearlyResults.length; i += rowsPerPage) {
        chunks.push(yearlyResults.slice(i, i + rowsPerPage));
      }

      const spendingComposition = computeMonthlySpendingComposition(yearlyResults, reportParams, result);
      const spendingChunks: typeof spendingComposition[] = [];
      for (let i = 0; i < spendingComposition.length; i += rowsPerPage) {
        spendingChunks.push(spendingComposition.slice(i, i + rowsPerPage));
      }
      const hasSpendingSection = spendingChunks.length > 0;

      // 의료비는 spending에 이미 합산되어 있어 "생활비" 열만 보면 왜 커졌는지 알 수 없다.
      // 의료비 가정을 실제로 켠 시나리오에서만 열 이름과 각주로 포함 사실을 밝힌다.
      //
      // "별도 지출이 아니다"를 무조건 단언하면 안 된다. 자산이 고갈된 해에는 엔진이 실제
      // 인출액을 가능한 만큼으로 깎으므로 spending < healthcareSpending이 되고, 그 해의
      // 「생활비」 열에는 의료비 전액이 들어 있지 않다(types.ts SimulationYearlyResult
      // .healthcareSpending의 "예외" 참조). 각주는 PDF에 그대로 인쇄되므로 단서를 붙인다.
      const hasHealthcareCost = yearlyResults.some((yr) => yr.healthcareSpending > 0);
      const healthcareNoteHtml = hasHealthcareCost
        ? '<p style="font-size: 9.5px; color: #94a3b8; margin: 0 0 8px;">* 「생활비」 열에는 의료비·장기요양비가 합산되어 있습니다(별도 지출이 아니라 같은 금액의 내역입니다). 다만 자산이 고갈된 해에는 인출 가능한 금액까지만 표시되므로 의료비 전액이 반영되지 않을 수 있습니다.</p>'
        : '';

      const realValueNoteHtml = inflationMode === 'real'
        ? '<p style="font-size: 9.5px; color: #94a3b8; margin: 0 0 8px;">* 아래 금액은 모두 오늘 시점 기준 실질 가치입니다(물가상승률은 자산 성장률에 사전 차감 반영되었습니다). 명목(미래 실제 지급) 금액이 아닙니다.</p>'
        : '<p style="font-size: 9.5px; color: #94a3b8; margin: 0 0 8px;">* 아래 금액은 물가상승률이 매년 누적 반영된 명목 가치입니다.</p>';

      // 섹션 번호는 여러 페이지로 나뉘어도 하나다 — 첫 청크에서만 소비한다.
      const yearlyTableSectionNo = nextSection();
      chunks.forEach((chunk, chunkIdx) => {
        const pageNum = nextPage();
        if (chunkIdx === 0) firstYearlyTablePageNo = pageNum;
        const isLastChunk = chunkIdx === chunks.length - 1 && !hasSpendingSection;
        pagesHtml += `
          <div class="pdf-page">
            <div class="pdf-content">
              <h2 style="font-size: 15px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; color: #0f172a; margin-top: 0; margin-bottom: 12px;">
                ${yearlyTableSectionNo}. 연령별 소득원 및 자산 추이 (${chunkIdx + 1}/${chunks.length})
              </h2>
              ${realValueNoteHtml}
              ${healthcareNoteHtml}
              <table class="pdf-data-table" style="width: 100%; border-collapse: collapse; font-size: 9px;">
                <thead>
                  <tr>
                    <th style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: center; background-color: #f1f5f9; font-weight: 700; color: #334155;">나이</th>
                    <th style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: center; background-color: #f1f5f9; font-weight: 700; color: #334155;">연도</th>
                    <th style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: right; background-color: #f1f5f9; font-weight: 700; color: #334155;">총 자산</th>
                    <th style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: right; background-color: #f1f5f9; font-weight: 700; color: #334155;">총 소득</th>
                    <th style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: right; background-color: #f1f5f9; font-weight: 700; color: #334155;">생활비${hasHealthcareCost ? '<br/>(의료비 포함)' : ''}</th>
                    <th style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: right; background-color: #f1f5f9; font-weight: 700; color: #334155;">배당/투자</th>
                    <th style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: right; background-color: #f1f5f9; font-weight: 700; color: #334155;">연금</th>
                    <th style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: right; background-color: #f1f5f9; font-weight: 700; color: #334155;">기타</th>
                    <th style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: right; background-color: #f1f5f9; font-weight: 700; color: #334155;">금융소득과세</th>
                  </tr>
                </thead>
                <tbody>
        `;

        chunk.forEach((yr, idx) => {
          const bg = idx % 2 === 1 ? 'background-color: #f8fafc;' : '';
          pagesHtml += `
            <tr style="${bg}">
              <td style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: center;">${yr.age}세</td>
              <td style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: center;">${yr.year}</td>
              <td style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: right;">${formatValuePrint(yr.totalAssets)}</td>
              <td style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: right;">${formatValuePrint(yr.totalIncome)}</td>
              <td style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: right;">${formatValuePrint(yr.spending)}</td>
              <td style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: right;">${formatValuePrint(yr.dividendIncome)}</td>
              <td style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: right;">${formatValuePrint(yr.pensionIncome)}</td>
              <td style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: right;">${formatValuePrint(yr.otherIncome)}</td>
              <td style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: right; ${yr.hasTaxWarning ? 'color: #ef4444; font-weight: bold;' : ''}">${formatValuePrint(yr.comprehensiveTaxPaid)}${yr.hasTaxWarning ? ' ⚠️' : ''}</td>
            </tr>
          `;
        });

        pagesHtml += `
                </tbody>
              </table>
        `;

        if (isLastChunk) {
          pagesHtml += `
            <div style="margin-top: 25px; font-size: 10px; color: #64748b; border-top: 1px solid #cbd5e1; padding-top: 10px;">
              <p style="margin: 0 0 4px 0;"><strong>중요 투자 및 시뮬레이션 법적 면책 고지</strong></p>
              <p style="margin: 0; line-height: 1.4;">본 NextLife 웹 서비스에서 산출 및 표시되는 모든 결과는 사용자가 가정치와 과거 시장 데이터에 기반한 시뮬레이션 결과입니다. 이는 미래의 실제 자산 가치 및 수익률을 보장하지 않습니다. 실제 투자 결정 시에는 반드시 전문 공인 재무 설계사와 상의하시기 바랍니다.</p>
              <p style="margin: 4px 0 0 0;">&copy; ${new Date().getFullYear()} NextLife. Created by TokkiLab. All rights reserved.</p>
            </div>
          `;
        }

        pagesHtml += `
            </div>
            <div class="pdf-footer">
              <span>NextLife 은퇴 자산 시뮬레이션 리포트</span>
              <span>페이지 ${pageNum} / {total_pages}</span>
            </div>
          </div>
        `;
      });

      const spendingTableSectionNo = hasSpendingSection ? nextSection() : 0;
      spendingChunks.forEach((chunk, chunkIdx) => {
        const pageNum = nextPage();
        const isLastChunk = chunkIdx === spendingChunks.length - 1;
        pagesHtml += `
          <div class="pdf-page">
            <div class="pdf-content">
              <h2 style="font-size: 15px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; color: #0f172a; margin-top: 0; margin-bottom: 12px;">
                ${spendingTableSectionNo}. 은퇴 후 월 생활비 재원 구성 (${chunkIdx + 1}/${spendingChunks.length})
              </h2>
              ${realValueNoteHtml}
              <table class="pdf-data-table" style="width: 100%; border-collapse: collapse; font-size: 9px;">
                <thead>
                  <tr>
                    <th style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: center; background-color: #f1f5f9; font-weight: 700; color: #334155;">나이</th>
                    <th style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: right; background-color: #f1f5f9; font-weight: 700; color: #334155;">국민연금</th>
                    <th style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: right; background-color: #f1f5f9; font-weight: 700; color: #334155;">사적연금</th>
                    <th style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: right; background-color: #f1f5f9; font-weight: 700; color: #334155;">배당소득</th>
                    <th style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: right; background-color: #f1f5f9; font-weight: 700; color: #334155;">기타소득</th>
                    <th style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: right; background-color: #f1f5f9; font-weight: 700; color: #334155;">자산인출</th>
                    <th style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: right; background-color: #f1f5f9; font-weight: 700; color: #334155;">자산부족</th>
                  </tr>
                </thead>
                <tbody>
        `;

        chunk.forEach((d, idx) => {
          const bg = idx % 2 === 1 ? 'background-color: #f8fafc;' : '';
          pagesHtml += `
            <tr style="${bg}">
              <td style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: center;">${d.age}세</td>
              <td style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: right;">${formatValuePrint(d.nationalUsed)}</td>
              <td style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: right;">${formatValuePrint(d.privatePenUsed)}</td>
              <td style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: right;">${formatValuePrint(d.dividendUsed)}</td>
              <td style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: right;">${formatValuePrint(d.otherUsed)}</td>
              <td style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: right;">${formatValuePrint(d.assetWithdrawal)}</td>
              <td style="border: 1px solid #cbd5e1; padding: 7px 8px; text-align: right; ${d.shortfall > 0 ? 'color: #ef4444; font-weight: bold;' : ''}">${formatValuePrint(d.shortfall)}</td>
            </tr>
          `;
        });

        pagesHtml += `
                </tbody>
              </table>
              <p style="margin-top: 10px; font-size: 10px; color: #64748b;">* 월 생활비 재원 구성은 연간 금액을 월 단위로 환산한 값이며, 사적연금 열은 저율과세 한도와 무관하게 실제 시뮬레이션 인출액을 그대로 반영합니다. 한도 초과 시 발생하는 세금은 {tax_page}페이지 세금 설정과 {yearly_page}페이지 금융소득과세 열을 참고하세요.</p>
        `;

        if (isLastChunk) {
          pagesHtml += `
            <div style="margin-top: 25px; font-size: 10px; color: #64748b; border-top: 1px solid #cbd5e1; padding-top: 10px;">
              <p style="margin: 0 0 4px 0;"><strong>중요 투자 및 시뮬레이션 법적 면책 고지</strong></p>
              <p style="margin: 0; line-height: 1.4;">본 NextLife 웹 서비스에서 산출 및 표시되는 모든 결과는 사용자가 가정치와 과거 시장 데이터에 기반한 시뮬레이션 결과입니다. 이는 미래의 실제 자산 가치 및 수익률을 보장하지 않습니다. 실제 투자 결정 시에는 반드시 전문 공인 재무 설계사와 상의하시기 바랍니다.</p>
              <p style="margin: 4px 0 0 0;">&copy; ${new Date().getFullYear()} NextLife. Created by TokkiLab. All rights reserved.</p>
            </div>
          `;
        }

        pagesHtml += `
            </div>
            <div class="pdf-footer">
              <span>NextLife 은퇴 자산 시뮬레이션 리포트</span>
              <span>페이지 ${pageNum} / {total_pages}</span>
            </div>
          </div>
        `;
      });

      // 카운터가 실제로 만들어 낸 장수 그대로다 — 더 이상 따로 세지 않는다.
      pagesHtml = pagesHtml
        .replaceAll('{total_pages}', pageNo.toString())
        .replaceAll('{tax_page}', taxSettingsPageNo.toString())
        .replaceAll('{yearly_page}', firstYearlyTablePageNo.toString());

      // Append pages html
      const pagesContainer = document.createElement('div');
      pagesContainer.innerHTML = pagesHtml;
      container.appendChild(pagesContainer);
      document.body.appendChild(container);

      const pages = container.querySelectorAll('.pdf-page');
      const overflowingPages = Array.from(pages).flatMap((page, index) => {
        const content = page.querySelector('.pdf-content') as HTMLElement | null;
        return content && content.scrollHeight > content.clientHeight + 1 ? [index + 1] : [];
      });
      if (overflowingPages.length > 0) {
        document.body.removeChild(container);
        throw new Error(`PDF page overflow detected: ${overflowingPages.join(', ')}`);
      }
      const pdf = new jsPDF('p', 'mm', 'a4');

      for (let i = 0; i < pages.length; i++) {
        if (i > 0) {
          pdf.addPage();
        }
        
        const pageEl = pages[i] as HTMLElement;
        const canvas = await html2canvas(pageEl, {
          scale: 2, // High resolution
          useCORS: true,
          logging: false,
          width: 794,
          height: 1123
        });

        const imgData = canvas.toDataURL('image/jpeg', 1.0);
        pdf.addImage(imgData, 'JPEG', 0, 0, 210, 297);
      }

      // Remove the temporary container
      document.body.removeChild(container);

      pdf.save('NextLife_Simulation_Report.pdf');
    } catch (error) {
      console.error('Failed to generate PDF:', error);
      alert('PDF 생성 중 오류가 발생했습니다. 다시 시도해 주세요.');
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
      // 초기화한 설정 위에 "추천 전략을 적용했다"는 배너가 남으면 안 된다.
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
            {/* 삼항 «밖»에 둔다. 설정이 바뀌어 결과가 stale이 되면 아래 대시보드가 통째로
                사라지는데, 그때도 되돌리기 경로는 살아 있어야 한다. */}
            {appliedStrategy.snapshot && (
              <AppliedStrategyBanner
                snapshot={appliedStrategy.snapshot}
                onUndo={appliedStrategy.undo}
              />
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
                canApplyStrategy={appliedStrategy.canApply}
                appliedCandidateId={appliedStrategy.snapshot?.candidateId}
                onUndoStrategy={appliedStrategy.undo}
              />
            ) : (
              <GlassCard>
                <div className="flex min-h-64 flex-col items-center justify-center px-6 py-12 text-center">
                  <BarChart3 size={30} className="text-primary" aria-hidden="true" />
                  <h2 className="mt-4 text-lg font-bold text-foreground">
                    {analysis ? '입력 변경사항을 다시 분석해 주세요' : '은퇴 계획을 만들어 보세요'}
                  </h2>
                  <p className="mt-2 max-w-md text-sm leading-relaxed text-foreground-muted">
                    {analysis
                      ? '현재 결과는 이전 입력 기준이므로 숨겼습니다. 목표 단계에서 분석 시작을 다시 눌러 주세요.'
                      : <>개인정보와 자산정보를 확인하고 원하는 은퇴 목표를 선택한 뒤
                        &lsquo;분석 시작&rsquo;을 눌러 주세요.</>}
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
