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
import { AlertCircle, Activity, Download, RotateCcw, PanelLeftClose, PanelLeftOpen, LogOut } from 'lucide-react';
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
    handleRetryLoad
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

  const handleDownload = () => {
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
    
    let md = `# 시뮬레이션 결과 리포트\n\n`;
    md += `출력 일시: ${new Date().toLocaleString()}\n\n`;
    
    md += `## 1. 종합 결과 요약\n`;
    md += `- **은퇴 준비도 점수:** ${retirementScore}점\n`;
    md += `- **은퇴 소득 달성률:** ${goalAchievementRate}%\n`;
    md += `- **FIRE 조기은퇴 가능 나이:** ${fireAge ? `${fireAge}세` : '달성 불가능'}\n`;
    md += `- **자산 고갈 예상 나이:** ${depletionAge ? `${depletionAge}세` : '기대수명 내 고갈 없음'}\n`;
    md += `- **사망 시(기대수명 ${userProfile.expectancy}세) 잔여 자산:** ${formatValue(endingAssets)}\n\n`;

    md += `## 2. 시뮬레이션 설정 상태\n`;
    md += `- **현재 나이:** ${userProfile.currentAge}세\n`;
    md += `- **은퇴 목표 나이:** ${userProfile.retirementAge}세\n`;
    md += `- **기대 수명:** ${userProfile.expectancy}세\n`;
    md += `- **목표 월 생활비:** ${userProfile.targetMonthlySpending.toLocaleString()} ${displayCurrency}\n`;
    md += `- **인출 전략:** ${spendingStrategy === 'dividend_only' ? '배당금(이자) 100% 소비' : spendingStrategy === 'max_sustainable' ? '최대 가능 생활비 자동계산' : '고정 목표 생활비'}\n`;
    md += `- **물가 상승률:** ${inflationRate}% (${inflationMode === 'real' ? '실질 가치 - 인플레이션 차감' : '명목 가치 - 인플레이션 미차감'})\n`;
    md += `- **표시 통화 / 기준 환율:** ${displayCurrency} / 1 USD = ${baseExchangeRate} KRW\n\n`;

    md += `## 3. 연금 및 자산 현황\n`;
    md += `### 국민연금\n`;
    md += `- **예상 월 수령액:** ${nationalPension?.expectedMonthlyAmount.toLocaleString()}원 (65세부터 수령)\n\n`;

    md += `### 사적연금 (퇴직연금/개인연금)\n`;
    if (privatePensions && privatePensions.length > 0) {
      privatePensions.forEach(p => {
        md += `- **${p.name}** (${p.type === 'irp' ? 'IRP' : p.type === 'savings' ? '연금저축' : '기타'}): 현재 잔액 ${p.balance.toLocaleString()} ${p.currency}, 매월 ${p.monthlyContribution.toLocaleString()} ${p.currency} 납입, 예상 연 수익률 ${p.annualReturn}%\n`;
      });
    } else {
      md += `- 등록된 사적연금 없음\n`;
    }
    md += `\n### 투자 자산 (주식/ETF/부동산 등)\n`;
    if (assets && assets.length > 0) {
      assets.forEach(a => {
        md += `- **${a.name}** (${a.type}): ${a.quantity}주(개) x 평균단가 ${a.averagePrice.toLocaleString()} ${a.currency}, 매월 ${a.monthlyContribution.toLocaleString()} ${a.currency} 납입, 예상 연 수익률 ${a.annualGrowthRate}%, 배당률 ${a.dividendYield}%\n`;
      });
    } else {
      md += `- 등록된 투자 자산 없음\n`;
    }
    md += `\n### 기타 소득\n`;
    if (otherIncomes && otherIncomes.length > 0) {
      otherIncomes.forEach(i => {
        md += `- **${i.label}**: 매월 ${i.monthlyAmount.toLocaleString()} ${i.currency}\n`;
      });
    } else {
      md += `- 등록된 기타 소득 없음\n`;
    }
    md += `\n`;

    md += `## 4. 연령별 소득원 및 자산 추이\n`;
    md += `| 나이 | 연도 | 총 자산 | 총 소득 | 생활비 지출 | 배당/투자 소득 | 연금 소득 | 기타 소득 | 금융소득종합과세 |\n`;
    md += `| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n`;
    if (yearlyResults && yearlyResults.length > 0) {
      yearlyResults.forEach(yr => {
        md += `| ${yr.age}세 | ${yr.year} | ${formatValue(yr.totalAssets)} | ${formatValue(yr.totalIncome)} | ${formatValue(yr.spending)} | ${formatValue(yr.dividendIncome)} | ${formatValue(yr.pensionIncome)} | ${formatValue(yr.otherIncome)} | ${yr.hasTaxWarning ? '⚠️ 주의' : '-'} |\n`;
      });
    } else {
      md += `| 데이터가 없습니다. |\n`;
    }
    md += `\n`;
    
    const dataStr = "data:text/markdown;charset=utf-8," + encodeURIComponent(md);
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", `nextlife_simulation_${new Date().toISOString().slice(0, 10)}.md`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
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
                cursor: 'pointer', 
                fontSize: '0.85rem', 
                fontWeight: 600, 
                transition: 'all 0.2s ease',
                whiteSpace: 'nowrap',
              }}
            >
              <Download size={16} />
              데이터 다운로드
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
