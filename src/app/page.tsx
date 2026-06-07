"use client";

import React, { useState, useEffect } from 'react';
import { SimulationParams } from '../core/entities/types';
import { SimulationEngine } from '../core/usecases/SimulationEngine';
import { loadParams, saveParams, initialParams } from '../infrastructure/storage/localStore';
import { AssetFormSection } from '../web/features/AssetForm/AssetFormSection';
import { ScenarioSelector } from '../web/features/Scenario/ScenarioSelector';
import { DashboardSection } from '../web/features/Dashboard/DashboardSection';
import GlassCard from '../web/components/GlassCard';
import styles from './page.module.css';
import { AlertCircle, Activity } from 'lucide-react';

export default function Home() {
  const [params, setParams] = useState<SimulationParams>(initialParams);
  const [isLoaded, setIsLoaded] = useState<boolean>(false);
  const [engine] = useState(() => new SimulationEngine());

  // Load params from LocalStorage on mount
  useEffect(() => {
    const loaded = loadParams();
    setParams(loaded);
    setIsLoaded(true);
  }, []);

  // Save params to LocalStorage when they change
  useEffect(() => {
    if (isLoaded) {
      saveParams(params);
    }
  }, [params, isLoaded]);

  // Dynamically update document body preset attribute for dynamic styling/glows
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.body.setAttribute('data-preset', params.yieldPreset || 'base');
    }
  }, [params.yieldPreset]);

  // Run simulation engine in real-time
  const result = engine.run(params);

  return (
    <main className={styles.main}>
      {/* 1. Header Area */}
      <header className={styles.header}>
        <div className={styles.logoArea}>
          <Activity size={28} color="var(--primary)" />
          <h1 className={styles.logoText}>NextLife Simulator</h1>
        </div>
        <p className={styles.tagline}>
          사용자의 자산 데이터와 라이프 플랜을 기반으로 조기 은퇴(FIRE) 가능 여부와 노후 자산 고갈 시점을 정밀하게 실시간 계산합니다.
        </p>
      </header>

      {/* 2. Content Layout */}
      <div className={styles.layoutGrid}>
        
        {/* Left Side: User Inputs & Scenarios */}
        <section className={styles.leftColumn}>
          {/* Inputs Section */}
          <GlassCard>
            <AssetFormSection params={params} onChangeParams={setParams} />
          </GlassCard>

          {/* Scenario Variables Section */}
          <GlassCard>
            <ScenarioSelector params={params} onChangeParams={setParams} />
          </GlassCard>
        </section>

        {/* Right Side: Visual Dashboard */}
        <section className={styles.rightColumn}>
          <DashboardSection params={params} result={result} />
        </section>

      </div>

      {/* 3. Footer Area & Compliance disclaimer */}
      <footer className={styles.footer}>
        <div className={styles.disclaimer}>
          <div className={styles.disclaimerTitle}>
            <AlertCircle size={14} />
            <span>중요 투자 및 시뮬레이션 법적 면책 고지</span>
          </div>
          <p>
            본 NextLife Simulator 웹 서비스에서 산출 및 표시되는 모든 결과(은퇴 점수, 자산 고갈 시점, 소득 달성률 등)는 사용자가 기입한 가정치와 과거 시장 데이터에 기반한 시뮬레이션 결과입니다. 이는 미래의 실제 자산 가치 및 수익률을 보장하지 않습니다.
          </p>
          <p style={{ marginTop: '0.4rem' }}>
            본 서비스가 제공하는 모든 분석 정보는 단순 참고용일 뿐이며, 특정 금융 상품에 대한 투자 권유나 재무적 의사 결정을 대행하지 않습니다. 실제 투자 결정 시에는 반드시 전문 공인 재무 설계사 또는 투자 자문 전문가와 상의하시기 바랍니다.
          </p>
          <div className={styles.copyright}>
            &copy; {new Date().getFullYear()} NextLife Simulator. Created by Antigravity AI. All rights reserved.
          </div>
        </div>
      </footer>
    </main>
  );
}
