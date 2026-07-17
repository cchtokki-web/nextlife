"use client";

import React, { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SimpleSimulationAdapter, SimpleSimulationInput, InvestmentPropensity } from '../../../core/usecases/SimpleSimulationAdapter';
import { SimulationEngine } from '../../../core/usecases/SimulationEngine';
import { motion, AnimatePresence } from 'framer-motion';
import GlassCard from '../../components/GlassCard';
import { Target, TrendingUp, Coins } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { initialParams } from '../../../infrastructure/storage/localStore';

import { ScenarioComparisonCards } from '../Dashboard/ScenarioComparisonCards';
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
  const { data: session, status } = useSession();
  const isDevMode = process.env.NODE_ENV === 'development' || process.env.NEXT_PUBLIC_DEV_MODE === 'true';
  const [isRuntimeDevMode, setIsRuntimeDevMode] = useState(isDevMode);
  const isKakaoUser = isRuntimeDevMode || session?.user?.provider === 'kakao';
  const router = useRouter();

  useEffect(() => {
    fetch('/api/dev-mode')
      .then(res => res.json())
      .then(data => {
        if (data && typeof data.isDevMode === 'boolean') {
          setIsRuntimeDevMode(data.isDevMode);
        }
      })
      .catch(err => console.error('Failed to fetch dev mode:', err));
  }, []);

  useEffect(() => {
    if (status === 'authenticated') {
      setHasRun(true);
      sessionStorage.setItem('nextlife_simple_simulator_has_run', 'true');
    }
  }, [status]);

  useEffect(() => {
    const saved = localStorage.getItem('nextlife_simple_simulator_input');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setInput(prev => ({ ...prev, ...parsed }));
      } catch (e) {
        console.error('Failed to parse saved input', e);
      }
    }
    
    if (sessionStorage.getItem('nextlife_simple_simulator_has_run') === 'true') {
      setHasRun(true);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('nextlife_simple_simulator_input', JSON.stringify(input));
  }, [input]);

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
    sessionStorage.setItem('nextlife_simple_simulator_has_run', 'true');
    const sessionId = sessionStorage.getItem('analytics_session_id');
    fetch('/api/analytics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'SIMULATION_RUN', sessionId }),
    }).catch(err => console.error('Failed to log simulation run', err));
  };

  const { result, resultPlus50 } = useMemo(() => {
    if (!hasRun) return { result: null, resultPlus50: null };
    const params = SimpleSimulationAdapter.adapt(input);
    const paramsPlus50 = SimpleSimulationAdapter.adapt({
      ...input,
      monthlyInvestment: input.monthlyInvestment + 500000
    });
    return {
      result: engine.run(params),
      resultPlus50: engine.run(paramsPlus50)
    };
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
                  className={`${styles.selectBtn} ${styles.conservative} ${input.propensity === 'conservative' ? styles.active : ''}`}
                  onClick={() => handlePropensity('conservative')}
                >
                  안전추구<br />(예적금)
                </button>
                <button 
                  className={`${styles.selectBtn} ${styles.neutral} ${input.propensity === 'neutral' ? styles.active : ''}`}
                  onClick={() => handlePropensity('neutral')}
                >
                  중립형<br />(배당ETF)
                </button>
                <button 
                  className={`${styles.selectBtn} ${styles.aggressive} ${input.propensity === 'aggressive' ? styles.active : ''}`}
                  onClick={() => handlePropensity('aggressive')}
                >
                  공격형<br />(성장ETF)
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
              <div className={styles.resultsGrid} style={{ marginBottom: '1rem' }}>
                <div className={styles.resultCard}>
                  <div className={styles.iconWrapper}>
                    <Target size={24} />
                  </div>
                  <div className={styles.resultLabel}>주요 투자 종목</div>
                  <div className={styles.resultValue} style={{ fontSize: '1.25rem', marginTop: '0.25rem' }}>
                    {input.propensity === 'conservative' && '예금 및 우량 채권'}
                    {input.propensity === 'neutral' && '국내 미국배당다우존스'}
                    {input.propensity === 'aggressive' && '국내 미국나스닥100'}
                  </div>
                </div>

                <div className={styles.resultCard}>
                  <div className={styles.iconWrapper}>
                    <TrendingUp size={24} />
                  </div>
                  <div className={styles.resultLabel}>기대 자산 성장</div>
                  <div className={styles.resultValue} style={{ fontSize: '1.5rem', marginTop: '0.25rem' }}>
                    {input.propensity === 'conservative' && '연 1%'}
                    {input.propensity === 'neutral' && '연 3%'}
                    {input.propensity === 'aggressive' && '연 8%'}
                  </div>
                </div>

                <div className={styles.resultCard}>
                  <div className={styles.iconWrapper}>
                    <Coins size={24} />
                  </div>
                  <div className={styles.resultLabel}>기대 배당/이자 수익</div>
                  <div className={styles.resultValue} style={{ fontSize: '1.5rem', marginTop: '0.25rem' }}>
                    {input.propensity === 'conservative' && '연 3%'}
                    {input.propensity === 'neutral' && '연 4%'}
                    {input.propensity === 'aggressive' && '연 1.5%'}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
                <button 
                  onClick={() => {
                    setHasRun(false);
                    sessionStorage.setItem('nextlife_simple_simulator_has_run', 'false');
                  }}
                  style={{ background: 'var(--card-border)', border: '1px solid var(--card-border-hover)', color: 'var(--foreground)', padding: '0.4rem 0.8rem', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, fontSize: '0.9rem' }}
                >
                  다시 계산하기
                </button>
              </div>

              {resultPlus50 && (
                <ScenarioComparisonCards 
                  baseData={result.yearlyResults}
                  plus50Data={resultPlus50.yearlyResults}
                  targetAge={75}
                  formatValue={formatResultValue}
                />
              )}
              
              {isKakaoUser && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  style={{ marginTop: '1rem', padding: '1.5rem', backgroundColor: 'rgba(16, 185, 129, 0.05)', borderRadius: '16px', textAlign: 'center', border: '1px solid rgba(16, 185, 129, 0.2)' }}
                >
                  <p style={{ color: 'var(--foreground)', marginBottom: '1rem', lineHeight: '1.6', fontSize: '0.95rem' }}>
                    <strong style={{ color: '#10B981', fontSize: '1.05rem' }}>{session?.user?.name || '회원'}</strong>님의 자산 성향에 맞춘 상세 투자 비중과 월 배당금 예측 시뮬레이션은 회원님에게만 공개됩니다.<br/>
                    아래 이동하기 버튼을 클릭하세요.
                  </p>
                  <button 
                    onClick={async (e) => {
                      e.preventDefault();
                      const adapted = SimpleSimulationAdapter.adapt(input);
                      const finalParams = {
                        ...initialParams,
                        userProfile: {
                          ...initialParams.userProfile,
                          currentAge: input.currentAge || initialParams.userProfile.currentAge,
                          retirementAge: input.retirementAge || initialParams.userProfile.retirementAge,
                          targetMonthlySpending: input.targetMonthlySpending || initialParams.userProfile.targetMonthlySpending,
                        },
                        assets: (input.currentAssets > 0 || input.monthlyInvestment > 0) ? adapted.assets : initialParams.assets,
                        nationalPension: input.nationalPension > 0 ? adapted.nationalPension : initialParams.nationalPension,
                        privatePensions: [],
                        taxSettings: adapted.taxSettings,
                      };
                      
                      localStorage.setItem('nextlife_simulator_params', JSON.stringify(finalParams));
                      
                      if (session?.user) {
                        try {
                          const res = await fetch('/api/scenarios');
                          if (res.ok) {
                            const { data } = await res.json();
                            const defaultScenario = data?.find((s: any) => s.isDefault) || (data && data.length > 0 ? data[0] : null);
                            if (defaultScenario) {
                              await fetch(`/api/scenarios/${defaultScenario.id}`, {
                                method: 'PUT',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ data: finalParams })
                              });
                            }
                          }
                        } catch (err) {
                          console.error('Failed to sync scenario', err);
                        }
                      }
                      router.push('/simulator');
                    }}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '0.6rem', backgroundColor: '#10B981', color: '#ffffff', padding: '1rem 2.5rem', borderRadius: '14px', fontWeight: 700, fontSize: '1.2rem', textDecoration: 'none', transition: 'all 0.2s', boxShadow: '0 6px 16px rgba(16, 185, 129, 0.3)', cursor: 'pointer', border: 'none' }}
                  >
                    이동하기
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12h14"></path>
                      <path d="M12 5l7 7-7 7"></path>
                    </svg>
                  </button>
                </motion.div>
              )}

            </div>
          </motion.div>
          )
        )}
        </AnimatePresence>
      </motion.div>
    </GlassCard>
  );
}
