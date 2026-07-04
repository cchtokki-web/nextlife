"use client";

import React, { useState, useEffect, useMemo, useDeferredValue } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { SimulationEngine } from '../../core/usecases/SimulationEngine';
import { initialParams } from '../../infrastructure/storage/localStore';
import { AssetFormSection } from '../../web/features/AssetForm/AssetFormSection';
import { TaxSettingsSection } from '../../web/features/AssetForm/TaxSettingsSection';
import { ScenarioManager } from '../../web/features/Scenario/ScenarioManager';
import { SimulationSettings } from '../../web/features/Scenario/SimulationSettings';
import { DashboardSection } from '../../web/features/Dashboard/DashboardSection';
import GlassCard from '../../web/components/GlassCard';
import { Header } from '../../web/components/Header/Header';
import styles from './page.module.css';
import { AlertCircle, Activity, Download, RotateCcw, PanelLeftClose, PanelLeftOpen, LogOut, FileText } from 'lucide-react';
import { useScenarios } from '../../web/features/Scenario/useScenarios';
import { E2eeKeyManager } from '../../web/components/E2eeKeyManager';
import { generateBackupKey, encryptData } from '../../core/utils/crypto';
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
    if (confirm('모든 기존 데이터를 초기화하고 새로운 보안 키로 다시 시작하시겠습니까? 이 작업은 되돌릴 수 없으며 기존 암호화된 모든 시나리오 데이터가 기본값으로 초기화됩니다.')) {
      const newKey = generateBackupKey();
      const userId = (session?.user as any)?.id;
      if (userId) {
        localStorage.setItem(`nextlife_e2ee_key_${userId}`, newKey);
        localStorage.setItem(`nextlife_e2ee_backed_up_${userId}`, 'false');
        
        try {
          for (const s of scenarios) {
            const encrypted = await encryptData(initialParams, newKey, userId);
            await fetch(`/api/scenarios/${s.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ data: encrypted }),
            });
          }
          alert('데이터가 성공적으로 초기화되었습니다.');
          window.location.reload();
        } catch (err) {
          console.error('Failed to reset scenarios:', err);
          alert('초기화 중 오류가 발생했습니다.');
        }
      }
    }
  };

  const isPro = session?.user?.tier === 'pro';

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

  // Run simulation engine for active scenario
  const result = useMemo(() => engine.run(deferredParams), [engine, deferredParams]);

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

      const { retirementScore, goalAchievementRate, fireAge, depletionAge, endingAssets, yearlyResults } = result;
      const { 
        userProfile, 
        assets, 
        privatePensions, 
        nationalPension, 
        otherIncomes, 
        inflationRate, 
        inflationMode, 
        baseExchangeRate, 
        displayCurrency,
        spendingStrategy 
      } = activeParams;

      const formatValuePrint = (val: number): string => formatValue(val);

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
          padding: 60px;
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
      `;
      container.appendChild(styleBlock);

      // Page 1: Summary and Settings
      let pagesHtml = `
        <div class="pdf-page">
          <div class="pdf-content">
            <h1 style="font-size: 26px; border-bottom: 3px solid #3b82f6; padding-bottom: 12px; color: #1e3a8a; margin-top: 0;">NextLife 은퇴 자산 시뮬레이션 결과 리포트</h1>
            <p style="font-size: 11px; color: #64748b; margin-bottom: 20px;">출력 일시: ${new Date().toLocaleString()}</p>
            
            <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin-bottom: 20px;">
              <h2 style="margin-top: 0; font-size: 16px; color: #0f172a; border-bottom: none; padding-bottom: 0;">1. 종합 결과 요약</h2>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 10px;">
                <div style="font-size: 13px; border-bottom: 1px dashed #e2e8f0; padding-bottom: 6px;">
                  <span style="font-weight: 600; color: #475569;">은퇴 준비도 점수</span>
                  <span style="float: right; font-size: 14px; color: #0f172a; font-weight: 700;">${retirementScore}점</span>
                </div>
                <div style="font-size: 13px; border-bottom: 1px dashed #e2e8f0; padding-bottom: 6px;">
                  <span style="font-weight: 600; color: #475569;">은퇴 소득 달성률</span>
                  <span style="float: right; font-size: 14px; color: #0f172a; font-weight: 700;">${goalAchievementRate}%</span>
                </div>
                <div style="font-size: 13px; border-bottom: 1px dashed #e2e8f0; padding-bottom: 6px;">
                  <span style="font-weight: 600; color: #475569;">FIRE 조기은퇴 가능 나이</span>
                  <span style="float: right; font-size: 14px; color: #0f172a; font-weight: 700;">${fireAge ? `${fireAge}세` : '달성 불가능'}</span>
                </div>
                <div style="font-size: 13px; border-bottom: 1px dashed #e2e8f0; padding-bottom: 6px;">
                  <span style="font-weight: 600; color: #475569;">자산 고갈 예상 나이</span>
                  <span style="float: right; font-size: 14px; color: #0f172a; font-weight: 700;">${depletionAge ? `${depletionAge}세` : '기대수명 내 고갈 없음'}</span>
                </div>
                <div style="grid-column: span 2; font-size: 13px; padding-top: 4px;">
                  <span style="font-weight: 600; color: #475569;">사망 시(기대수명 ${userProfile.expectancy}세) 잔여 자산</span>
                  <span style="float: right; font-size: 15px; color: #3b82f6; font-weight: 700;">${formatValuePrint(endingAssets)}</span>
                </div>
              </div>
            </div>

            <h2 style="font-size: 15px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; color: #0f172a; margin-top: 15px; margin-bottom: 8px;">2. 시뮬레이션 설정 상태</h2>
            <ul style="padding-left: 20px; margin-top: 5px; margin-bottom: 15px; font-size: 12.5px; line-height: 1.5;">
              <li style="margin-bottom: 3px;"><strong>현재 나이:</strong> ${userProfile.currentAge}세 / <strong>은퇴 목표 나이:</strong> ${userProfile.retirementAge}세 / <strong>기대 수명:</strong> ${userProfile.expectancy}세</li>
              <li style="margin-bottom: 3px;"><strong>목표 월 생활비:</strong> ${userProfile.targetMonthlySpending.toLocaleString()} ${displayCurrency}</li>
              <li style="margin-bottom: 3px;"><strong>인출 전략:</strong> ${spendingStrategy === 'dividend_only' ? '배당금(이자) 100% 소비' : spendingStrategy === 'max_sustainable' ? '최대 가능 생활비 자동계산' : '고정 목표 생활비'}</li>
              <li style="margin-bottom: 3px;"><strong>물가 상승률:</strong> ${inflationRate}% (${inflationMode === 'real' ? '실질 가치 - 인플레이션 차감' : '명목 가치 - 인플레이션 미차감'})</li>
              <li style="margin-bottom: 3px;"><strong>표시 통화 / 기준 환율:</strong> ${displayCurrency} / 1 USD = ${baseExchangeRate} KRW</li>
            </ul>

            <h2 style="font-size: 15px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; color: #0f172a; margin-top: 15px; margin-bottom: 8px;">3. 연금 및 자산 현황</h2>
            <div style="font-size: 12.5px; line-height: 1.5; display: grid; grid-template-columns: 1fr; gap: 8px;">
              <div>
                <strong>국민연금:</strong> 예상 월 수령액 ${nationalPension?.expectedMonthlyAmount.toLocaleString()}원 (65세부터 수령)
              </div>
              <div>
                <strong>사적연금:</strong>
                <ul style="padding-left: 20px; margin-top: 3px; margin-bottom: 0;">
      `;

      if (privatePensions && privatePensions.length > 0) {
        privatePensions.forEach(p => {
          pagesHtml += `<li style="margin-bottom: 2px;"><strong>${p.name}</strong> (${p.type === 'irp' ? 'IRP' : p.type === 'savings' ? '연금저축' : '기타'}): 현재 잔액 ${p.balance.toLocaleString()} ${p.currency}, 매월 ${p.monthlyContribution.toLocaleString()} ${p.currency} 납입, 예상 연 수익률 ${p.annualReturn}%</li>`;
        });
      } else {
        pagesHtml += `<li>등록된 사적연금 없음</li>`;
      }

      pagesHtml += `
                </ul>
              </div>
              <div>
                <strong>투자 자산:</strong>
                <ul style="padding-left: 20px; margin-top: 3px; margin-bottom: 0;">
      `;

      if (assets && assets.length > 0) {
        assets.forEach(a => {
          pagesHtml += `<li style="margin-bottom: 2px;"><strong>${a.name}</strong> (${a.type}): ${a.quantity}주(개) x 평균단가 ${a.averagePrice.toLocaleString()} ${a.currency}, 매월 ${a.monthlyContribution.toLocaleString()} ${a.currency} 납입, 예상 연 수익률 ${a.annualGrowthRate}%, 배당률 ${a.dividendYield}%</li>`;
        });
      } else {
        pagesHtml += `<li>등록된 투자 자산 없음</li>`;
      }

      pagesHtml += `
                </ul>
              </div>
              <div>
                <strong>기타 소득:</strong>
                <ul style="padding-left: 20px; margin-top: 3px; margin-bottom: 0;">
      `;

      if (otherIncomes && otherIncomes.length > 0) {
        otherIncomes.forEach(i => {
          pagesHtml += `<li style="margin-bottom: 2px;"><strong>${i.label}</strong>: 매월 ${i.monthlyAmount.toLocaleString()} ${i.currency}</li>`;
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
            <span>페이지 1 / {total_pages}</span>
          </div>
        </div>
      `;

      // Page 2+: Tables
      const chunks: typeof yearlyResults[] = [];
      const rowsPerPage = 23; // Fits nicely on A4 page with headers and footers
      for (let i = 0; i < yearlyResults.length; i += rowsPerPage) {
        chunks.push(yearlyResults.slice(i, i + rowsPerPage));
      }

      chunks.forEach((chunk, chunkIdx) => {
        const pageNum = chunkIdx + 2;
        const isLastChunk = chunkIdx === chunks.length - 1;
        pagesHtml += `
          <div class="pdf-page">
            <div class="pdf-content">
              <h2 style="font-size: 15px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; color: #0f172a; margin-top: 0; margin-bottom: 10px;">
                4. 연령별 소득원 및 자산 추이 (페이지 ${chunkIdx + 1})
              </h2>
              <table style="width: 100%; border-collapse: collapse; font-size: 10.5px;">
                <thead>
                  <tr>
                    <th style="border: 1px solid #cbd5e1; padding: 5px 6px; text-align: center; background-color: #f1f5f9; font-weight: 700; color: #334155;">나이</th>
                    <th style="border: 1px solid #cbd5e1; padding: 5px 6px; text-align: center; background-color: #f1f5f9; font-weight: 700; color: #334155;">연도</th>
                    <th style="border: 1px solid #cbd5e1; padding: 5px 6px; text-align: right; background-color: #f1f5f9; font-weight: 700; color: #334155;">총 자산</th>
                    <th style="border: 1px solid #cbd5e1; padding: 5px 6px; text-align: right; background-color: #f1f5f9; font-weight: 700; color: #334155;">총 소득</th>
                    <th style="border: 1px solid #cbd5e1; padding: 5px 6px; text-align: right; background-color: #f1f5f9; font-weight: 700; color: #334155;">생활비</th>
                    <th style="border: 1px solid #cbd5e1; padding: 5px 6px; text-align: right; background-color: #f1f5f9; font-weight: 700; color: #334155;">배당/투자</th>
                    <th style="border: 1px solid #cbd5e1; padding: 5px 6px; text-align: right; background-color: #f1f5f9; font-weight: 700; color: #334155;">연금</th>
                    <th style="border: 1px solid #cbd5e1; padding: 5px 6px; text-align: right; background-color: #f1f5f9; font-weight: 700; color: #334155;">기타</th>
                    <th style="border: 1px solid #cbd5e1; padding: 5px 6px; text-align: center; background-color: #f1f5f9; font-weight: 700; color: #334155;">금융소득과세</th>
                  </tr>
                </thead>
                <tbody>
        `;

        chunk.forEach((yr, idx) => {
          const bg = idx % 2 === 1 ? 'background-color: #f8fafc;' : '';
          pagesHtml += `
            <tr style="${bg}">
              <td style="border: 1px solid #cbd5e1; padding: 5px 6px; text-align: center;">${yr.age}세</td>
              <td style="border: 1px solid #cbd5e1; padding: 5px 6px; text-align: center;">${yr.year}</td>
              <td style="border: 1px solid #cbd5e1; padding: 5px 6px; text-align: right;">${formatValuePrint(yr.totalAssets)}</td>
              <td style="border: 1px solid #cbd5e1; padding: 5px 6px; text-align: right;">${formatValuePrint(yr.totalIncome)}</td>
              <td style="border: 1px solid #cbd5e1; padding: 5px 6px; text-align: right;">${formatValuePrint(yr.spending)}</td>
              <td style="border: 1px solid #cbd5e1; padding: 5px 6px; text-align: right;">${formatValuePrint(yr.dividendIncome)}</td>
              <td style="border: 1px solid #cbd5e1; padding: 5px 6px; text-align: right;">${formatValuePrint(yr.pensionIncome)}</td>
              <td style="border: 1px solid #cbd5e1; padding: 5px 6px; text-align: right;">${formatValuePrint(yr.otherIncome)}</td>
              <td style="border: 1px solid #cbd5e1; padding: 5px 6px; text-align: center; ${yr.hasTaxWarning ? 'color: #ef4444; font-weight: bold;' : ''}">${yr.hasTaxWarning ? '⚠️ 주의' : '-'}</td>
            </tr>
          `;
        });

        pagesHtml += `
                </tbody>
              </table>
        `;

        if (isLastChunk) {
          pagesHtml += `
            <div style="margin-top: 30px; font-size: 10px; color: #64748b; border-top: 1px solid #cbd5e1; padding-top: 10px;">
              <p style="margin: 0 0 4px 0;"><strong>중요 투자 및 시뮬레이션 법적 면책 고지</strong></p>
              <p style="margin: 0;">본 NextLife 웹 서비스에서 산출 및 표시되는 모든 결과는 사용자가 가정치와 과거 시장 데이터에 기반한 시뮬레이션 결과입니다. 이는 미래의 실제 자산 가치 및 수익률을 보장하지 않습니다. 실제 투자 결정 시에는 반드시 전문 공인 재무 설계사와 상의하시기 바랍니다.</p>
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

      const totalPages = chunks.length + 1;
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
            
            {/* Scenario Manager Section */}
            <GlassCard>
              <ScenarioManager scenarioState={scenarioState} />
            </GlassCard>

            {/* Inputs Section */}
            <GlassCard>
              <AssetFormSection params={activeParams} onChangeParams={handleUpdateActiveParams} />
            </GlassCard>

            {/* Simulation Settings Section */}
            <GlassCard>
              <SimulationSettings scenarioState={scenarioState} />
            </GlassCard>

            {/* Tax Settings Section */}
            {isPro && (
              <GlassCard>
                <TaxSettingsSection params={activeParams} onChangeParams={handleUpdateActiveParams} />
              </GlassCard>
            )}
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
              params={deferredParams} 
              result={result} 
              compareResults={compareResults} 
              isPro={isPro}
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
