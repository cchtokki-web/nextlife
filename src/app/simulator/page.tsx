"use client";

import React, { useState, useEffect, useMemo, useDeferredValue } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { SimulationEngine } from '../../core/usecases/SimulationEngine';
import { computeMonthlySpendingComposition } from '../../core/usecases/MonthlySpendingComposition';
import { computeRiskAlerts } from '../../core/usecases/dashboard/computeRiskAlerts';
import { computeExecutionRoadmap, selectDepletionAge } from '../../core/usecases/dashboard/computeExecutionRoadmap';
import { computeSensitivityAnalysis } from '../../core/usecases/dashboard/computeSensitivityAnalysis';
import { describeFireAge } from '../../core/usecases/dashboard/describeFireAge';
import { describeDepletionAge } from '../../core/usecases/dashboard/describeDepletionAge';
import { renderRiskAlertsSection, renderItemizedChecklistSection, renderExecutionRoadmapSection, renderSensitivityTableSection } from '../../web/features/Pdf/pdfReportSections';
import { recommendStrategy } from '../../core/usecases/strategy/RecommendationEngine';
import { compileStrategy } from '../../core/usecases/strategy/compileStrategy';
import { applyAiSentinels } from '../../core/usecases/strategy/applyAiSentinels';
import { analyzeCurrentStrategy, explainBequestAdequacy } from '../../core/usecases/utility/utilityAnalysis';
import { resolveTaxSettings } from '../../core/usecases/tax/taxRates';
import { NATIONAL_PENSION_NORMAL_START_AGE } from '../../core/usecases/pension/nationalPensionRules';
import { UTILITY_COMPONENT_META } from '../../web/features/Dashboard/utilityComponentMeta';
import { initialParams } from '../../infrastructure/storage/localStore';
import { AssetFormSection } from '../../web/features/AssetForm/AssetFormSection';
import { ScenarioManager } from '../../web/features/Scenario/ScenarioManager';
import { StrategySettingsPanel } from '../../web/features/StrategySettings/StrategySettingsPanel';
import { Collapse } from '../../web/components/ui';
import { DashboardSection } from '../../web/features/Dashboard/DashboardSection';
import GlassCard from '../../web/components/GlassCard';
import { Header } from '../../web/components/Header/Header';
import styles from './page.module.css';
import { AlertCircle, Activity, Download, RotateCcw, PanelLeftClose, PanelLeftOpen, LogOut, FileText } from 'lucide-react';
import { useScenarios } from '../../web/features/Scenario/useScenarios';
import { E2eeKeyManager } from '../../web/components/E2eeKeyManager';
import { generateBackupKey, encryptData } from '../../core/utils/crypto';
import { isDevMode } from '../../core/utils/isDevMode';
import { useBackgroundValue } from '../../web/hooks/useBackgroundValue';
export default function Home() {
  const { data: session, status } = useSession();
  const scenarioState = useScenarios();
  const { 
    scenarios, 
    activeScenarioId, 
    activeParams, 
    handleUpdateActiveParams, 
    compareScenarioIds, 
    isLoaded,
    handleCreateScenario,
    localKey,
    needsKeyRestore,
    isBackupKeyBackedUp,
    handleRestoreKey,
    handleAcknowledgeBackup,
    isSaving,
    saveStatus,
    lastSaved,
    loadError,
    handleRetryLoad,
    handleSendKeyToKakao,
    needsKeySetup,
    handleSetupKey
  } = scenarioState;

  const handleResetAllScenarios = async () => {
    if (confirm('모든 기존 데이터를 초기화하고 새로운 보안 키로 다시 시작하시겠습니까? 이 작업은 되돌릴 수 없으며 기본 시나리오를 제외한 나머지 시나리오는 모두 삭제되고, 기본 시나리오의 데이터는 기본값으로 초기화됩니다.')) {
      const newKey = generateBackupKey();
      const userId = (session?.user as any)?.id;
      if (userId) {
        localStorage.setItem(`nextlife_e2ee_key_${userId}`, newKey);
        localStorage.setItem(`nextlife_e2ee_backed_up_${userId}`, 'false');

        try {
          const defaultScenario = scenarios.find(s => s.isDefault) || scenarios[0];
          const otherScenarios = scenarios.filter(s => s.id !== defaultScenario?.id);

          for (const s of otherScenarios) {
            await fetch(`/api/scenarios/${s.id}`, { method: 'DELETE' });
          }

          if (defaultScenario) {
            const encrypted = await encryptData(initialParams, newKey, userId);
            await fetch(`/api/scenarios/${defaultScenario.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ data: encrypted }),
            });
          }

          const kakaoResult = await handleSendKeyToKakao(newKey);
          if (kakaoResult.success) {
            alert('데이터가 성공적으로 초기화되었으며, 새 보안키가 카카오톡으로 발송되었습니다.');
          } else {
            alert(`데이터는 초기화되었지만 새 보안키를 카카오톡으로 보내지 못했습니다.\n새 보안키: ${newKey}\n이 키를 반드시 별도로 기록해 두세요.`);
          }
          window.location.reload();
        } catch (err) {
          console.error('Failed to reset scenarios:', err);
          alert('초기화 중 오류가 발생했습니다.');
        }
      }
    }
  };

  const isPro = session?.user?.tier === 'pro' || isDevMode();

  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(true);
  const [engine] = useState(() => new SimulationEngine());
  const [hoveredBtn, setHoveredBtn] = useState<string | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState<boolean>(false);

  // Auto-collapse sidebar on mobile devices
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      setIsSidebarOpen(false);
    }
  }, []);

  // Dynamically update document body preset attribute for dynamic styling/glows
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.body.setAttribute('data-preset', activeParams.yieldPreset || 'base');
    }
  }, [activeParams.yieldPreset]);

  // Defer the parameters to unblock the main thread during rapid typing
  const deferredParams = useDeferredValue(activeParams);

  // 전략(사용자 언어)을 저수준 파라미터로 컴파일한 뒤 엔진에 넘긴다.
  // strategy가 없는 기존 시나리오는 compileStrategy가 입력을 그대로 통과시킨다.
  const compiled = useMemo(() => compileStrategy(deferredParams), [deferredParams]);

  // AI 추천 전략은 다수의 후보를 시뮬레이션하는(최악 216개) 이 화면에서 가장 무거운 계산이라,
  // 위 engine.run과 같은 렌더 패스에서 돌면 안 된다. useBackgroundValue가 compiled를 한 커밋
  // 뒤로 미뤄 트랜지션(비긴급) 우선순위에서 계산하게 하고, 아직 따라잡지 못한 렌더를
  // "탐색 중" 로딩 상태로 노출한다.
  //
  // 예전에는 useDeferredValue를 연쇄해 이것을 만들려 했지만 그 방식으로는 2단이 되지 않는다
  // (React 19의 updateDeferredValueImpl은 이미 비긴급 렌더이면 새 값을 그대로 반환한다).
  // 그래서 로딩 상태가 영구히 false였고, 추천 계산은 실제로는 result와 같은 패스에서 돌았다.
  // 자세한 근거는 useBackgroundValue와 그 테스트 참조.
  //
  // 원본 params가 아니라 compiled를 미루는 이유: compileStrategy가 같은 입력에 대해 두 번
  // 실행되지 않는다(예전에는 두 개의 useMemo가 결국 같은 params를 각자 컴파일했다).
  const [recommendationCompiled, isComputingRecommendation] = useBackgroundValue(compiled);
  // recommendation이 undefined인 이유가 "계산 실패"인지 "탐색할 최적화 여지가 없어 baseline을
  // 그대로 반환"인지 UI에서 구분할 수 있도록 실패 여부를 함께 계산한다(후자는 recommendStrategy가
  // 정상적으로 improved:false, recommendedPlan:null인 객체를 반환하므로 undefined가 되지 않는다).
  const { recommendation, recommendationFailed } = useMemo(() => {
    try {
      return {
        recommendation: recommendStrategy(
          recommendationCompiled.params,
          engine,
          recommendationCompiled.utilityConfig
        ),
        recommendationFailed: false,
      };
    } catch (err) {
      console.error('Failed to compute strategy recommendation', err);
      return { recommendation: undefined, recommendationFailed: true };
    }
  }, [engine, recommendationCompiled]);

  // 미정으로 남은 센티널 축을 추천값으로 채운다. 사용자 params는 그대로 두고 계산에만
  // 반영하므로, 추천의 입력(compiled)과 시뮬레이션의 입력(effective)이 분리된다 —
  // 이 분리가 "적용 → 재계산 → 재적용" 되먹임을 구조적으로 막는다.
  const effective = useMemo(
    () => applyAiSentinels(compiled, recommendation),
    [compiled, recommendation]
  );

  // Run simulation engine for active scenario. cfg를 넘겨야 대시보드 헤드라인 효용
  // 점수(result.utility)가 사용자가 고른 목표 우선순위를 반영한다 — 생략하면 항상
  // 기본 가중치로 계산되어 목표 우선순위를 아무리 바꿔도 점수가 그대로다.
  // engine.run에는 try/catch를 두지 않는다. 예외는 simulator/error.tsx(App Router 에러
  // 바운더리)가 받는다.
  //
  // "직전 성공 결과를 폴백으로 유지" 방식을 검토했지만 택하지 않았다. (1) 그러려면 렌더 간
  // 살아남는 가변 캐시를 렌더 중에 갱신해야 하는데 이 저장소의 lint 규칙(react-hooks/refs)이
  // 정당하게 금지한다. 상태로 대신하면 이 화면에서 가장 무거운 렌더가 매번 한 번 더 돈다.
  // (2) 더 중요하게는, 살아 있는 설정 패널 옆에 옛 결과를 보여주는 것 자체가 "화면이 말하는
  // 값과 엔진이 실제로 쓴 값이 다른" 상태다 — 이 브랜치가 반복해서 제거해 온 결함 유형이다.
  // recommendStrategy의 try/catch와 비대칭인 것도 의도적이다: 그쪽 실패는 부분적이고
  // (나머지 대시보드는 여전히 옳다) 전용 "계산하지 못했습니다" 상태가 있지만,
  // engine.run이 실패하면 진실하게 보여줄 결과가 하나도 없다.
  const result = useMemo(
    () => engine.run(effective.params, effective.utilityConfig),
    [engine, effective.params, effective.utilityConfig]
  );

  // Track simulation runs with a simple debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      const sessionId = sessionStorage.getItem('analytics_session_id');
      fetch('/api/analytics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'SIMULATION_RUN', sessionId }),
      }).catch(err => console.error('Failed to log simulation run', err));
    }, 3000);
    return () => clearTimeout(timer);
  }, [result]);

  // Run simulation engine for compared scenarios
  const compareResults = useMemo(() => {
    return compareScenarioIds.map(id => {
      const scenario = scenarios.find(s => s.id === id);
      if (!scenario) return null;
      return {
        id,
        name: scenario.name,
        result: engine.run(scenario.data)
      };
    }).filter(Boolean) as { id: string, name: string, result: any }[];
  }, [engine, scenarios, compareScenarioIds]);

  const formatValue = (val: number): string => {
    const currency = activeParams.displayCurrency;
    if (val <= 0) return '0원';
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

  const handleDownload = async () => {
    if (isGeneratingPdf) return;
    setIsGeneratingPdf(true);

    try {
      const jsPDF = (await import('jspdf')).default;
      const html2canvas = (await import('html2canvas')).default;

      const { retirementScore, retirementGrade, goalAchievementRate, fireAge, depletionAge, endingAssets, householdEndAge, yearlyResults, utility } = result;
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

      const formatValuePrint = (val: number): string => formatValue(val);

      // Lifetime Utility Score / AI 추천 전략 PDF 섹션(페이지 2)용 데이터 준비
      const utilityComponentRowsHtml = utility
        ? UTILITY_COMPONENT_META.map(({ key, label, max, color }) => {
            const value = utility.components[key];
            const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
            return `
              <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px; font-size: 12px;">
                <span style="width: 110px; color: #475569; font-weight: 600;">${label}</span>
                <div style="flex-grow: 1; height: 8px; background-color: #e2e8f0; border-radius: 4px; overflow: hidden;">
                  <div style="width: ${pct}%; height: 100%; background-color: ${color};"></div>
                </div>
                <span style="width: 50px; text-align: right; font-weight: 700; color: ${color};">${value}/${max}</span>
              </div>
            `;
          }).join('')
        : '<p style="font-size: 12px; color: #94a3b8;">효용 데이터를 계산할 수 없습니다.</p>';

      const bequestAdequacyExplanationHtml = utility
        ? `<p style="font-size: 10px; color: #94a3b8; margin: -6px 0 12px; line-height: 1.4;">* 상속 자산 적정성: ${explainBequestAdequacy(reportParams, result, effective.utilityConfig)}</p>`
        : '';

      const currentStrategyAnalysis = utility ? analyzeCurrentStrategy(utility, effective.utilityConfig) : null;
      const strengthsHtml = currentStrategyAnalysis
        ? currentStrategyAnalysis.strengths.map(s => `<li style="margin-bottom: 4px;">${s}</li>`).join('')
        : '';
      const weaknessesHtml = currentStrategyAnalysis
        ? currentStrategyAnalysis.weaknesses.map(w => `<li style="margin-bottom: 4px;">${w}</li>`).join('')
        : '';

      const hasImprovement = !!recommendation?.improved;
      const recommendationSummaryText = !recommendation
        ? 'AI 추천 전략을 계산할 수 없습니다.'
        : hasImprovement
          ? `효용 ${recommendation.currentUtility.score}점 → ${recommendation.recommendedUtility.score}점`
          : '현재 전략 유지 권장';
      const itemizedChecklistHtml = renderItemizedChecklistSection(recommendation);
      const deltaRowsHtml = (recommendation && hasImprovement)
        ? `
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 10px; font-size: 12px;">
            <div><strong>평생 소비 변화:</strong> <span style="color: ${recommendation.deltas.lifetimeConsumption >= 0 ? '#10B981' : '#EF4444'}; font-weight: 700;">${recommendation.deltas.lifetimeConsumption >= 0 ? '+' : '-'}${formatValuePrint(Math.abs(recommendation.deltas.lifetimeConsumption))}</span></div>
            <div><strong>평생 총세금 변화:</strong> <span style="color: ${recommendation.deltas.totalTax <= 0 ? '#10B981' : '#F59E0B'}; font-weight: 700;">${recommendation.deltas.totalTax >= 0 ? '+' : '-'}${formatValuePrint(Math.abs(recommendation.deltas.totalTax))}</span></div>
            <div><strong>사망 시 연금잔액 변화:</strong> <span style="color: ${recommendation.deltas.pensionEndingBalance <= 0 ? '#10B981' : '#F59E0B'}; font-weight: 700;">${recommendation.deltas.pensionEndingBalance >= 0 ? '+' : '-'}${formatValuePrint(Math.abs(recommendation.deltas.pensionEndingBalance))}</span></div>
            <div><strong>사망 시 총자산 변화:</strong> <span style="color: ${recommendation.deltas.endingAssets <= 0 ? '#10B981' : '#F59E0B'}; font-weight: 700;">${recommendation.deltas.endingAssets >= 0 ? '+' : '-'}${formatValuePrint(Math.abs(recommendation.deltas.endingAssets))}</span></div>
          </div>
        `
        : '';

      const riskAlerts = computeRiskAlerts(result, reportParams, effective.utilityConfig);
      const riskAlertsSectionHtml = renderRiskAlertsSection(riskAlerts);
      const roadmap = computeExecutionRoadmap(reportParams, recommendation, selectDepletionAge(recommendation, result));
      const executionRoadmapSectionHtml = renderExecutionRoadmapSection(roadmap);
      const sensitivityScenarios = computeSensitivityAnalysis(reportParams, result, engine);
      const sensitivityTableSectionHtml = renderSensitivityTableSection(sensitivityScenarios);

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
      `;
      container.appendChild(styleBlock);

      // Page 1: Summary and Settings
      let pagesHtml = `
        <div class="pdf-page">
          <div class="pdf-content">
            <h1 style="font-size: 26px; border-bottom: 3px solid #3b82f6; padding-bottom: 12px; color: #1e3a8a; margin-top: 0;">NextLife 은퇴 자산 시뮬레이션 결과 리포트</h1>
            <p style="font-size: 11px; color: #64748b; margin-bottom: 25px;">출력 일시: ${new Date().toLocaleString()}</p>
            
            <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; margin-bottom: 30px;">
              <h2 style="margin-top: 0; font-size: 17px; color: #0f172a; border-bottom: none; padding-bottom: 0;">1. 종합 결과 요약</h2>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 15px;">
                <div style="font-size: 13.5px; border-bottom: 1px dashed #e2e8f0; padding-bottom: 8px;">
                  <span style="font-weight: 600; color: #475569;">은퇴 준비도 점수</span>
                  <span style="float: right; font-size: 15px; color: #0f172a; font-weight: 700;">${retirementScore}점 <span style="font-size: 11.5px; color: #64748b; font-weight: 600;">(${retirementGrade})</span></span>
                </div>
                <div style="font-size: 13.5px; border-bottom: 1px dashed #e2e8f0; padding-bottom: 8px;">
                  <span style="font-weight: 600; color: #475569;">은퇴 소득 달성률<br/><span style="font-size: 10px; color: #94a3b8; font-weight: 400;">(배당·연금 등 고정소득만 반영, 자산 인출분 제외 · 2페이지 평생 효용 점수와는 별도로 계산되는 지표입니다)</span></span>
                  <span style="float: right; font-size: 15px; color: #0f172a; font-weight: 700;">${goalAchievementRate}%</span>
                </div>
                <div style="font-size: 13.5px; border-bottom: 1px dashed #e2e8f0; padding-bottom: 8px;">
                  <span style="font-weight: 600; color: #475569;">FIRE 조기은퇴 가능 나이</span>
                  <span style="float: right; font-size: 15px; color: #0f172a; font-weight: 700;">${describeFireAge(fireAge, userProfile.expectancy)}</span>
                </div>
                <div style="font-size: 13.5px; border-bottom: 1px dashed #e2e8f0; padding-bottom: 8px;">
                  <span style="font-weight: 600; color: #475569;">자산 고갈 예상 나이</span>
                  <span style="float: right; font-size: 15px; color: #0f172a; font-weight: 700;">${describeDepletionAge(depletionAge, householdEndAge, userProfile.expectancy)}</span>
                </div>
                <div style="grid-column: span 2; font-size: 13.5px; padding-top: 8px;">
                  <span style="font-weight: 600; color: #475569;">사망 시(${householdEndAge > userProfile.expectancy ? `배우자 기대수명 시점, 본인 나이 ${householdEndAge}세` : `기대수명 ${householdEndAge}세`}) 잔여 자산</span>
                  <span style="float: right; font-size: 16px; color: #3b82f6; font-weight: 700;">${formatValuePrint(endingAssets)}</span>
                </div>
              </div>
            </div>
            ${riskAlertsSectionHtml}

            <h2 style="font-size: 16px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; color: #0f172a; margin-top: 25px; margin-bottom: 10px;">2. 시뮬레이션 설정 상태</h2>
            <ul style="padding-left: 20px; margin-top: 5px; margin-bottom: 25px; font-size: 13px; line-height: 1.6;">
              <li style="margin-bottom: 6px;"><strong>현재 나이:</strong> ${userProfile.currentAge}세 / <strong>은퇴 목표 나이:</strong> ${userProfile.retirementAge}세 / <strong>기대 수명:</strong> ${userProfile.expectancy}세</li>
              <li style="margin-bottom: 6px;"><strong>목표 월 생활비:</strong> ${userProfile.targetMonthlySpending.toLocaleString()} ${displayCurrency}</li>
              <li style="margin-bottom: 6px;"><strong>인출 전략:</strong> ${reportParams.spendingStrategy === 'dividend_only' ? '배당금(이자) 100% 소비' : reportParams.spendingStrategy === 'max_sustainable' ? '최대 가능 생활비 자동계산' : '고정 목표 생활비'}</li>
              <li style="margin-bottom: 6px;"><strong>물가 상승률:</strong> ${inflationRate}% (${inflationMode === 'real' ? '실질 가치 기준 — 아래 모든 표의 생활비·연금 금액은 오늘 화폐가치로 고정 표시되며, 인플레이션은 자산 성장률에 사전 차감 반영되었습니다' : '명목 가치 기준 — 아래 모든 표의 생활비·연금 금액에 물가상승률이 매년 누적 반영되어 있습니다'})</li>
              <li style="margin-bottom: 6px;"><strong>표시 통화 / 기준 환율:</strong> ${displayCurrency} / 1 USD = ${baseExchangeRate} KRW</li>
            </ul>
          </div>
          <div class="pdf-footer">
            <span>NextLife 은퇴 자산 시뮬레이션 리포트</span>
            <span>페이지 1 / {total_pages}</span>
          </div>
        </div>

        <div class="pdf-page">
          <div class="pdf-content">
            <h2 style="font-size: 16px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; color: #0f172a; margin-top: 0; margin-bottom: 10px;">3. 평생 효용 점수 &amp; AI 추천 전략</h2>
            <p style="font-size: 11px; color: #64748b; margin-top: 0; margin-bottom: 14px;">"얼마를 남기는가"보다 "얼마나 잘 사용하는가"를 기준으로 평가한 평생 효용 점수입니다. 1페이지의 은퇴 소득 달성률과는 별도로 계산되는 독립 지표입니다.</p>

            <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px; margin-bottom: 18px;">
              <div style="display: flex; align-items: baseline; gap: 8px; margin-bottom: 12px;">
                <span style="font-size: 24px; font-weight: 800; color: #1e3a8a;">${utility ? utility.score : '-'}</span>
                <span style="font-size: 12px; color: #64748b;">/ 100점</span>
              </div>
              ${utilityComponentRowsHtml}
            </div>
            ${bequestAdequacyExplanationHtml}

            <h3 style="font-size: 13px; color: #0f172a; margin-bottom: 8px;">현재 전략 분석</h3>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 18px; font-size: 12px;">
              <div>
                <strong style="color: #10B981;">장점</strong>
                <ul style="padding-left: 18px; margin-top: 4px; margin-bottom: 0;">${strengthsHtml}</ul>
              </div>
              <div>
                <strong style="color: #F59E0B;">단점</strong>
                <ul style="padding-left: 18px; margin-top: 4px; margin-bottom: 0;">${weaknessesHtml}</ul>
              </div>
            </div>

            <h3 style="font-size: 13px; color: #0f172a; margin-bottom: 4px;">🤖 AI 추천 전략 — ${recommendationSummaryText}</h3>
            ${hasImprovement ? '<p style="font-size: 10px; color: #94a3b8; margin: 0 0 6px;">※ 아래 추천안은 시뮬레이션 결과이며 실제 설정에는 자동 반영되지 않습니다. 적용하려면 설정을 직접 변경하세요.</p>' : ''}
            <div style="margin-top: 6px;">${itemizedChecklistHtml}</div>
            ${deltaRowsHtml}
          </div>
          <div class="pdf-footer">
            <span>NextLife 은퇴 자산 시뮬레이션 리포트</span>
            <span>페이지 2 / {total_pages}</span>
          </div>
        </div>

        <div class="pdf-page">
          <div class="pdf-content">
            <h2 style="font-size: 16px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; color: #0f172a; margin-top: 0; margin-bottom: 10px;">4. 실행 로드맵 및 민감도 분석</h2>
            <p style="font-size: 11px; color: #64748b; margin-top: 0; margin-bottom: 14px;">AI 추천 전략(또는 현재 설정) 기준으로 나이별 실행 시점과, 핵심 가정이 바뀌었을 때 결과가 얼마나 민감한지를 보여줍니다.</p>

            <h3 style="font-size: 13px; color: #0f172a; margin-bottom: 8px;">실행 로드맵</h3>
            ${executionRoadmapSectionHtml}

            <h3 style="font-size: 13px; color: #0f172a; margin-top: 20px; margin-bottom: 8px;">민감도 분석 (자산 고갈 나이 기준)</h3>
            ${sensitivityTableSectionHtml}
          </div>
          <div class="pdf-footer">
            <span>NextLife 은퇴 자산 시뮬레이션 리포트</span>
            <span>페이지 3 / {total_pages}</span>
          </div>
        </div>

        <div class="pdf-page">
          <div class="pdf-content">
            <h2 style="font-size: 16px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; color: #0f172a; margin-top: 0; margin-bottom: 10px;">5. 연금 및 자산 현황</h2>
            <div style="font-size: 13px; line-height: 1.6; display: grid; grid-template-columns: 1fr; gap: 12px;">
              <div>
                <strong>국민연금:</strong> 예상 월 수령액 ${nationalPension?.expectedMonthlyAmount.toLocaleString()}원 (${reportParams.withdrawalPlan?.nationalPensionStartAge ?? NATIONAL_PENSION_NORMAL_START_AGE}세부터 수령)
              </div>
              <div>
                <strong>사적연금:</strong>
                <ul style="padding-left: 20px; margin-top: 4px; margin-bottom: 0;">
      `;

      if (privatePensions && privatePensions.length > 0) {
        privatePensions.forEach(p => {
          pagesHtml += `<li style="margin-bottom: 4px;"><strong>${p.name}</strong> (${p.type === 'irp' ? 'IRP' : p.type === 'savings' ? '연금저축' : '기타'}): 현재 잔액 ${p.balance.toLocaleString()} ${p.currency}, 매월 ${p.monthlyContribution.toLocaleString()} ${p.currency} 납입, 예상 연 수익률 ${p.annualReturn}%</li>`;
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
          pagesHtml += `<li style="margin-bottom: 4px;"><strong>${a.name}</strong> (${a.type}): ${a.quantity}주(개) x 평균단가 ${a.averagePrice.toLocaleString()} ${a.currency}, 매월 ${a.monthlyContribution.toLocaleString()} ${a.currency} 납입, 예상 연 수익률 ${a.annualGrowthRate}%, 배당률 ${a.dividendYield}%, 배당 재투자 ${a.reinvestDividend ? 'O' : 'X'}</li>`;
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
          pagesHtml += `<li style="margin-bottom: 4px;"><strong>${isa.name || 'ISA 계좌'}</strong> (${isa.type === 'general' ? '일반형' : '서민형'}): 현재 잔액 ${isa.balance.toLocaleString()} ${isa.currency}, 매월 ${isa.monthlyContribution.toLocaleString()} ${isa.currency} 납입, 예상 연 수익률 ${isa.annualReturn}%, 배당률 ${isa.dividendYield}%, 만기 ${isa.maturityYears}년</li>`;
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
          pagesHtml += `<li style="margin-bottom: 4px;"><strong>${i.label}</strong>: 매월 ${i.monthlyAmount.toLocaleString()} ${i.currency}</li>`;
        });
      } else {
        pagesHtml += `<li>등록된 기타 소득 없음</li>`;
      }

      pagesHtml += `
                </ul>
              </div>
            </div>
          </div>
          <div class="pdf-footer">
            <span>NextLife 은퇴 자산 시뮬레이션 리포트</span>
            <span>페이지 4 / {total_pages}</span>
          </div>
        </div>

        <div class="pdf-page">
          <div class="pdf-content">
            <h2 style="font-size: 16px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; color: #0f172a; margin-top: 0; margin-bottom: 10px;">6. 세금 설정</h2>
            <ul style="padding-left: 20px; margin-top: 5px; margin-bottom: 0; font-size: 13px; line-height: 1.6;">
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
            <span>페이지 5 / {total_pages}</span>
          </div>
        </div>
      `;

      // Page 5+: Tables
      const chunks: typeof yearlyResults[] = [];
      const rowsPerPage = 30; // Fits A4 page beautifully with comfortable vertical rhythm
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

      chunks.forEach((chunk, chunkIdx) => {
        const pageNum = chunkIdx + 6;
        const isLastChunk = chunkIdx === chunks.length - 1 && !hasSpendingSection;
        pagesHtml += `
          <div class="pdf-page">
            <div class="pdf-content">
              <h2 style="font-size: 15px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; color: #0f172a; margin-top: 0; margin-bottom: 12px;">
                7. 연령별 소득원 및 자산 추이 (페이지 ${chunkIdx + 1})
              </h2>
              ${realValueNoteHtml}
              ${healthcareNoteHtml}
              <table style="width: 100%; border-collapse: collapse; font-size: 10.5px;">
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

      spendingChunks.forEach((chunk, chunkIdx) => {
        const pageNum = chunks.length + 6 + chunkIdx;
        const isLastChunk = chunkIdx === spendingChunks.length - 1;
        pagesHtml += `
          <div class="pdf-page">
            <div class="pdf-content">
              <h2 style="font-size: 15px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; color: #0f172a; margin-top: 0; margin-bottom: 12px;">
                8. 은퇴 후 월 생활비 재원 구성 (페이지 ${chunkIdx + 1})
              </h2>
              ${realValueNoteHtml}
              <table style="width: 100%; border-collapse: collapse; font-size: 10.5px;">
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
              <p style="margin-top: 10px; font-size: 10px; color: #64748b;">* 월 생활비 재원 구성은 연간 금액을 월 단위로 환산한 값이며, 사적연금 열은 저율과세 한도와 무관하게 실제 시뮬레이션 인출액을 그대로 반영합니다. 한도 초과 시 발생하는 세금은 5페이지 세금 설정과 6페이지 금융소득과세 열을 참고하세요.</p>
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

      const totalPages = 5 + chunks.length + spendingChunks.length;
      pagesHtml = pagesHtml.replaceAll('{total_pages}', totalPages.toString());

      // Append pages html
      const pagesContainer = document.createElement('div');
      pagesContainer.innerHTML = pagesHtml;
      container.appendChild(pagesContainer);
      document.body.appendChild(container);

      const pages = container.querySelectorAll('.pdf-page');
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

  return (
    <main className={styles.main}>
      <Header saveStatus={saveStatus} isSaving={isSaving} lastSaved={lastSaved}>
        <div className={styles.actionContainer}>


            <button 
              onClick={handleReset}
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
              초기화
            </button>
            <button 
              onClick={handleDownload}
              disabled={isGeneratingPdf}
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
                cursor: isGeneratingPdf ? 'not-allowed' : 'pointer', 
                opacity: isGeneratingPdf ? 0.6 : 1,
                fontSize: '0.85rem', 
                fontWeight: 600, 
                transition: 'all 0.2s ease',
                whiteSpace: 'nowrap',
              }}
            >
              <FileText size={16} />
              {isGeneratingPdf ? 'PDF 생성 중...' : '결과 다운로드'}
            </button>


            <button 
              onClick={() => signOut({ callbackUrl: '/' })}
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
              로그아웃
            </button>
        </div>
      </Header>

      <E2eeKeyManager
        localKey={localKey}
        needsKeyRestore={needsKeyRestore}
        isBackupKeyBackedUp={isBackupKeyBackedUp}
        handleRestoreKey={handleRestoreKey}
        handleAcknowledgeBackup={handleAcknowledgeBackup}
        onResetScenarios={handleResetAllScenarios}
        handleSendKeyToKakao={handleSendKeyToKakao}
        needsKeySetup={needsKeySetup}
        handleSetupKey={handleSetupKey}
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
            
            {/* 내 은퇴 전략 = 6개 섹션 (기본 정보 / 은퇴 목표 / 연금 / 투자 / 경제 가정 / 고급 설정) */}
            <GlassCard>
              {/* 추천은 여기서 한 번만 계산해 내려보낸다. 패널이 자체적으로 계산하면
                  이 앱에서 가장 무거운 계산(최대 162개 후보 시뮬레이션)이 두 배가 된다. */}
              <StrategySettingsPanel
                params={activeParams}
                onChangeParams={handleUpdateActiveParams}
                recommendation={recommendation}
                recommendationFailed={recommendationFailed}
              />
            </GlassCard>

            {/* Scenario Manager Section */}
            <GlassCard>
              <ScenarioManager scenarioState={scenarioState} />
            </GlassCard>

            {/* 내 자산 — 보유 자산·연금·ISA·기타 소득 입력 (기본 닫힘) */}
            <Collapse title={<span className="text-base font-semibold">내 자산</span>}>
              <div className="flex flex-col gap-6 pt-2">
                <GlassCard>
                  <AssetFormSection params={activeParams} onChangeParams={handleUpdateActiveParams} />
                </GlassCard>
              </div>
            </Collapse>
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
            <DashboardSection
              params={effective.params}
              result={result}
              compareResults={compareResults}
              isPro={isPro}
              recommendation={recommendation}
              recommendationFailed={recommendationFailed}
              isComputingRecommendation={isComputingRecommendation}
            />
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
}
