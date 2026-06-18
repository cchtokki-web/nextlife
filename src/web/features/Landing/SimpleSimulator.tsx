"use client";

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { SimpleSimulationAdapter, SimpleSimulationInput, InvestmentPropensity } from '../../../core/usecases/SimpleSimulationAdapter';
import { SimulationEngine } from '../../../core/usecases/SimulationEngine';
import { motion, AnimatePresence } from 'framer-motion';
import GlassCard from '../../components/GlassCard';
import { HeroSummaryCard } from '../Dashboard/HeroSummaryCard';
import { CoreMetricsCards } from '../Dashboard/CoreMetricsCards';
import styles from './SimpleSimulator.module.css';

export function SimpleSimulator() {
  const [input, setInput] = useState<SimpleSimulationInput>({
    currentAge: 45,
    retirementAge: 62,
    currentAssets: 200000000,
    monthlyInvestment: 1500000,
    nationalPension: 1200000,
    targetMonthlySpending: 3000000,
    propensity: 'neutral',
  });

  const [hasRun, setHasRun] = useState(false);

  const engine = useMemo(() => new SimulationEngine(), []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    const numValue = Number(value.replace(/[^0-9]/g, ''));
    setInput(prev => ({ ...prev, [name]: numValue }));
  };

  const handlePropensity = (val: InvestmentPropensity) => {
    setInput(prev => ({ ...prev, propensity: val }));
  };

  const formatManWon = (val: number) => {
    return (val / 10000).toLocaleString();
  };

  const formatResultValue = (val: number): string => {
    if (val <= 0) return '0원';
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
  };

  const handleRun = () => {
    setHasRun(true);
  };

  const result = useMemo(() => {
    if (!hasRun) return null;
    const params = SimpleSimulationAdapter.adapt(input);
    return engine.run(params);
  }, [hasRun, input, engine]);

  const getScoreColor = (score: number) => {
    if (score >= 90) return '#10B981'; // Green
    if (score >= 70) return '#F59E0B'; // Orange
    return '#EF4444'; // Red
  };

  return (
    <GlassCard className={styles.container}>
      <motion.div layout transition={{ duration: 0.4, ease: "easeInOut" }}>
        <AnimatePresence mode="popLayout" initial={false}>
          {!hasRun ? (
            <motion.div
              key="input-form"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.3 }}
            >
            <div className={styles.formGrid}>
              <div className={styles.inputGroup}>
                <label>현재 나이</label>
                <div className={styles.inputWrapper}>
                  <input 
                    name="currentAge"
                    type="text" 
                    value={input.currentAge || ''}
                    onChange={handleChange}
                    className={styles.input}
                  />
                  <span className={styles.unit}>세</span>
                </div>
              </div>

              <div className={styles.inputGroup}>
                <label>은퇴 목표 나이</label>
                <div className={styles.inputWrapper}>
                  <input 
                    name="retirementAge"
                    type="text" 
                    value={input.retirementAge || ''}
                    onChange={handleChange}
                    className={styles.input}
                  />
                  <span className={styles.unit}>세</span>
                </div>
              </div>

              <div className={styles.inputGroup}>
                <label>현재 모은 자산</label>
                <div className={styles.inputWrapper}>
                  <input 
                    name="currentAssets"
                    type="text" 
                    value={formatManWon(input.currentAssets)}
                    onChange={(e) => {
                      const val = Number(e.target.value.replace(/[^0-9]/g, ''));
                      setInput(prev => ({ ...prev, currentAssets: val * 10000 }));
                    }}
                    className={styles.input}
                  />
                  <span className={styles.unit}>만원</span>
                </div>
              </div>

              <div className={styles.inputGroup}>
                <label>매월 투자(저축)액</label>
                <div className={styles.inputWrapper}>
                  <input 
                    name="monthlyInvestment"
                    type="text" 
                    value={formatManWon(input.monthlyInvestment)}
                    onChange={(e) => {
                      const val = Number(e.target.value.replace(/[^0-9]/g, ''));
                      setInput(prev => ({ ...prev, monthlyInvestment: val * 10000 }));
                    }}
                    className={styles.input}
                  />
                  <span className={styles.unit}>만원</span>
                </div>
              </div>

              <div className={styles.inputGroup}>
                <label>예상 국민연금 (월)</label>
                <div className={styles.inputWrapper}>
                  <input 
                    name="nationalPension"
                    type="text" 
                    value={formatManWon(input.nationalPension)}
                    onChange={(e) => {
                      const val = Number(e.target.value.replace(/[^0-9]/g, ''));
                      setInput(prev => ({ ...prev, nationalPension: val * 10000 }));
                    }}
                    className={styles.input}
                  />
                  <span className={styles.unit}>만원</span>
                </div>
              </div>

              <div className={styles.inputGroup}>
                <label>은퇴 후 목표 월 생활비</label>
                <div className={styles.inputWrapper}>
                  <input 
                    name="targetMonthlySpending"
                    type="text" 
                    value={formatManWon(input.targetMonthlySpending)}
                    onChange={(e) => {
                      const val = Number(e.target.value.replace(/[^0-9]/g, ''));
                      setInput(prev => ({ ...prev, targetMonthlySpending: val * 10000 }));
                    }}
                    className={styles.input}
                  />
                  <span className={styles.unit}>만원</span>
                </div>
              </div>
            </div>

            <div className={styles.inputGroup} style={{ marginTop: '0.5rem' }}>
              <label>나의 투자 성향</label>
              <div className={styles.selectGroup}>
                <button 
                  className={`${styles.selectBtn} ${input.propensity === 'conservative' ? styles.active : ''}`}
                  onClick={() => handlePropensity('conservative')}
                >
                  안전추구 (예적금)
                </button>
                <button 
                  className={`${styles.selectBtn} ${input.propensity === 'neutral' ? styles.active : ''}`}
                  onClick={() => handlePropensity('neutral')}
                >
                  중립 (배당ETF)
                </button>
                <button 
                  className={`${styles.selectBtn} ${input.propensity === 'aggressive' ? styles.active : ''}`}
                  onClick={() => handlePropensity('aggressive')}
                >
                  공격형 (성장ETF)
                </button>
              </div>
            </div>

            <button className={styles.submitBtn} onClick={handleRun}>
              내 노후자금 계산하기
            </button>
          </motion.div>
        ) : (
          result && (
            <motion.div 
              key="results-area"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.3 }}
            >
            <div className={styles.resultsArea} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: 0, paddingTop: 0, borderTop: 'none' }}>
              <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
                <button 
                  onClick={() => setHasRun(false)}
                  style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: 'white', padding: '0.4rem 0.8rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem' }}
                >
                  다시 계산하기
                </button>
              </div>

              <HeroSummaryCard 
                score={Math.min(99, result.retirementScore)} 
                expectancyAge={90} 
                alternatives={[
                  { label: '투자금 +50만', score: Math.min(99, result.retirementScore + 18) },
                  { label: '62세 은퇴', score: Math.min(99, result.retirementScore + 26) },
                  { label: '65세 은퇴', score: Math.min(99, result.retirementScore + 39) },
                ]}
              />
              
              <div style={{ 
                textAlign: 'center', 
                color: 'rgba(255, 255, 255, 0.95)', 
                fontSize: '1.25rem', 
                fontWeight: 600,
                background: 'rgba(255, 255, 255, 0.05)',
                padding: '1.25rem 1rem',
                borderRadius: '12px',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                wordBreak: 'keep-all',
                lineHeight: '1.5'
              }}>
                "매월 투자금을 50만원 늘리면 은퇴 성공 확률이 <span style={{ color: getScoreColor(Math.min(99, result.retirementScore)) }}>{Math.min(99, result.retirementScore)}%</span> ➔ <span style={{ color: getScoreColor(Math.min(99, result.retirementScore + 18)) }}>{Math.min(99, result.retirementScore + 18)}%</span>로 증가합니다."
              </div>
              <CoreMetricsCards 
                depletionAge={result.depletionAge}
                expectancyAge={90}
                assetAt60={result.yearlyResults.find(r => r.age === 60)?.totalAssets || 0}
                monthlyTarget={input.targetMonthlySpending}
                isMonthlyTargetPossible={result.depletionAge === null || result.depletionAge >= 90}
                formatValue={formatResultValue}
              />
            </div>
          </motion.div>
          )
        )}
        </AnimatePresence>
      </motion.div>
    </GlassCard>
  );
}
