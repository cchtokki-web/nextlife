import React, { useState } from 'react';
import { SelectField } from '../../components/SelectField';
import { InputField } from '../../components/InputField';
import styles from './Scenario.module.css';
import compStyles from '../../styles/components.module.css';
import { Sliders, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';

export const SimulationSettings: React.FC<{ scenarioState: any }> = ({ scenarioState }) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetchSuccess, setFetchSuccess] = useState(false);

  const {
    activeParams: rawActiveParams,
    handleUpdateActiveParams,
  } = scenarioState;

  const activeParams: any = {
    ...rawActiveParams,
    userProfile: rawActiveParams?.userProfile || { currentAge: 35, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3000000 },
    assets: rawActiveParams?.assets || [],
    nationalPension: rawActiveParams?.nationalPension || { expectedMonthlyAmount: 0 },
    privatePensions: rawActiveParams?.privatePensions || [],
    otherIncomes: rawActiveParams?.otherIncomes || [],
    inflationRate: rawActiveParams?.inflationRate ?? 2,
    inflationMode: rawActiveParams?.inflationMode || 'real',
    baseExchangeRate: rawActiveParams?.baseExchangeRate ?? 1350,
    displayCurrency: rawActiveParams?.displayCurrency || 'KRW',
    spendingStrategy: rawActiveParams?.spendingStrategy || 'target',
  };

  const fetchExchangeRate = async () => {
    if (isFetching) return;
    setIsFetching(true);
    setFetchError(null);
    setFetchSuccess(false);
    try {
      const res = await fetch('https://open.er-api.com/v6/latest/USD');
      if (!res.ok) throw new Error('실시간 환율 데이터를 가져오지 못했습니다.');
      const data = await res.json();
      if (data && data.rates && typeof data.rates.KRW === 'number') {
        const rate = Math.round(data.rates.KRW * 10) / 10;
        handleUpdateActiveParams({
          ...activeParams,
          baseExchangeRate: rate,
          exchangeScenario: 'base',
        });
        setFetchSuccess(true);
        setTimeout(() => setFetchSuccess(false), 4000);
      } else {
        throw new Error('환율 데이터 형식이 유효하지 않습니다.');
      }
    } catch (err: any) {
      setFetchError(err.message || '환율 정보를 가져오는데 실패했습니다.');
    } finally {
      setIsFetching(false);
    }
  };

  const applyYieldPreset = (preset: 'conservative' | 'base' | 'aggressive') => {
    let stockGrowth = 8, pensionReturn = 5;
    if (preset === 'conservative') { stockGrowth = 5; pensionReturn = 3; }
    else if (preset === 'aggressive') { stockGrowth = 12; pensionReturn = 8; }

    const updatedAssets = activeParams.assets.map((a: any) => ({ ...a, annualGrowthRate: stockGrowth }));
    const updatedPensions = activeParams.privatePensions.map((p: any) => ({ ...p, annualReturn: pensionReturn }));

    handleUpdateActiveParams({
      ...activeParams,
      assets: updatedAssets,
      privatePensions: updatedPensions,
      yieldPreset: preset,
    });
  };

  const getActivePreset = () => {
    if (activeParams.yieldPreset) return activeParams.yieldPreset;
    return null;
  };

  const activePreset = getActivePreset();

  return (
    <div className={styles.container}>
      <div 
        className={styles.header}
        onClick={() => setIsExpanded(!isExpanded)}
        style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Sliders size={18} className={styles.icon} />
          <span className={styles.title}>시뮬레이션 설정</span>
        </div>
        {isExpanded ? <ChevronUp size={18} className={styles.icon} /> : <ChevronDown size={18} className={styles.icon} />}
      </div>

      {isExpanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', marginTop: '1rem' }}>
          
          {/* Yield Scenario Presets */}
          <div className={styles.presetSection}>
            <label className={compStyles.label}>
              시장 수익률 프리셋 (현재 활성 시나리오에 적용)
            </label>
            <div className={styles.presetButtons}>
              <button
                className={`${styles.presetBtn} ${styles.btnConservative} ${activePreset === 'conservative' ? styles.active : ''}`}
                onClick={() => applyYieldPreset('conservative')}
              >
                보수적 (주식 5%, 연금 3%)
              </button>
              <button
                className={`${styles.presetBtn} ${styles.btnBase} ${activePreset === 'base' ? styles.active : ''}`}
                onClick={() => applyYieldPreset('base')}
              >
                기본값 (주식 8%, 연금 5%)
              </button>
              <button
                className={`${styles.presetBtn} ${styles.btnAggressive} ${activePreset === 'aggressive' ? styles.active : ''}`}
                onClick={() => applyYieldPreset('aggressive')}
              >
                공격적 (주식 12%, 연금 8%)
              </button>
            </div>
          </div>

          {/* Inputs grid */}
          <div className={compStyles.grid}>
            <SelectField
              label="대시보드 기준 통화"
              value={activeParams.displayCurrency}
              onChange={(e) => handleUpdateActiveParams({ ...activeParams, displayCurrency: e.target.value as any })}
              options={[
                { value: 'KRW', label: 'KRW (대한민국 원)' },
                { value: 'USD', label: 'USD (미국 달러)' },
              ]}
            />
            <div className={styles.exchangeRateWrapper}>
              <InputField
                label="적용 환율"
                type="text"
                value={activeParams.baseExchangeRate ? activeParams.baseExchangeRate.toLocaleString() : ''}
                onChange={(e) => {
                  const val = e.target.value.replace(/,/g, '');
                  if (val === '' || !isNaN(Number(val))) {
                    handleUpdateActiveParams({ 
                      ...activeParams, 
                      baseExchangeRate: val === '' ? 0 : Number(val), 
                      exchangeScenario: 'base' 
                    });
                  }
                }}
                suffixText="원"
              />
              <button
                type="button"
                className={`${compStyles.button} ${compStyles.buttonSecondary} ${styles.fetchButton}`}
                onClick={fetchExchangeRate}
                disabled={isFetching}
              >
                <RefreshCw size={14} className={isFetching ? styles.spinner : ''} />
                <span>현재 환율 적용</span>
              </button>
            </div>
            <SelectField
              label="인플레이션 반영 방식"
              value={activeParams.inflationMode}
              onChange={(e) => handleUpdateActiveParams({ ...activeParams, inflationMode: e.target.value as any })}
              options={[
                { value: 'nominal', label: '명목 가치 (수익률 유지, 생활비 증액)' },
                { value: 'real', label: '실질 가치 (수익률 할인, 생활비 고정)' },
              ]}
            />
            <InputField
              label="물가상승률 설정"
              type="number"
              step="0.1"
              value={activeParams.inflationRate}
              onChange={(e) => handleUpdateActiveParams({ ...activeParams, inflationRate: Number(e.target.value) })}
              suffixText="%"
            />
          </div>
        </div>
      )}
    </div>
  );
};
export default SimulationSettings;
