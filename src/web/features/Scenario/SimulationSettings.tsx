import React, { useState } from 'react';
import { SelectField } from '../../components/SelectField';
import { InputField } from '../../components/InputField';
import styles from './Scenario.module.css';
import compStyles from '../../styles/components.module.css';
import { Sliders, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { applyYieldPreset } from '../../../core/usecases/scenario/applyYieldPreset';

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

  React.useEffect(() => {
    if (activeParams.useLatestExchangeRate !== false) {
      fetchExchangeRate();
    }
  }, [activeParams.useLatestExchangeRate]);

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

  const applyYieldPresetToActiveScenario = (preset: 'conservative' | 'base' | 'aggressive') => {
    handleUpdateActiveParams(applyYieldPreset(activeParams, preset));
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
        style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: isExpanded ? '1rem' : '0' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Sliders size={18} className={styles.icon} />
          <span className={styles.title}>시뮬레이션 설정</span>
        </div>
        {isExpanded ? <ChevronUp size={18} className={styles.icon} /> : <ChevronDown size={18} className={styles.icon} />}
      </div>

      {isExpanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', marginTop: '0.5rem' }}>
          
          {/* Yield Scenario Presets */}
          <div className={styles.presetSection}>
            <label className={compStyles.label}>
              시장 수익률 프리셋 (현재 활성 시나리오에 적용)
            </label>
            <div className={styles.presetButtons}>
              <button
                className={`${styles.presetBtn} ${styles.btnConservative} ${activePreset === 'conservative' ? styles.active : ''}`}
                onClick={() => applyYieldPresetToActiveScenario('conservative')}
              >
                보수적 (주식 5%, 연금 3%)
              </button>
              <button
                className={`${styles.presetBtn} ${styles.btnBase} ${activePreset === 'base' ? styles.active : ''}`}
                onClick={() => applyYieldPresetToActiveScenario('base')}
              >
                기본값 ⭐ (주식 7%, 연금 4%)
              </button>
              <button
                className={`${styles.presetBtn} ${styles.btnAggressive} ${activePreset === 'aggressive' ? styles.active : ''}`}
                onClick={() => applyYieldPresetToActiveScenario('aggressive')}
              >
                공격적 (주식 9%, 연금 6%)
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
            <div className={styles.exchangeRateWrapper} style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', width: '100%', alignItems: 'center' }}>
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
                        exchangeScenario: 'base',
                        useLatestExchangeRate: false 
                      });
                    }
                  }}
                  disabled={activeParams.useLatestExchangeRate !== false}
                  suffixText="원"
                />
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', cursor: 'pointer', userSelect: 'none', color: 'var(--foreground-muted, #94a3b8)' }}>
                <input
                  type="checkbox"
                  checked={activeParams.useLatestExchangeRate !== false}
                  onChange={(e) => {
                    const isChecked = e.target.checked;
                    handleUpdateActiveParams({
                      ...activeParams,
                      useLatestExchangeRate: isChecked,
                    });
                  }}
                  style={{ cursor: 'pointer' }}
                />
                최신 환율 적용
              </label>
            </div>
            <div className={styles.toggleWrapper}>
              <span className={styles.toggleLabel}>실질 수익률 적용</span>
              <div 
                className={styles.toggleContainer}
                onClick={() => handleUpdateActiveParams({
                  ...activeParams,
                  inflationMode: activeParams.inflationMode === 'real' ? 'nominal' : 'real'
                })}
              >
                <div className={styles.switch}>
                  <input 
                    type="checkbox" 
                    checked={activeParams.inflationMode === 'real'} 
                    readOnly
                  />
                  <span className={styles.slider}></span>
                </div>
                <div className={styles.toggleTextContent}>
                  <span className={styles.toggleText}>물가상승률을 반영하여 실질 성장률로 계산</span>
                  <span className={styles.toggleDescription}>
                    자산 성장률에서 물가상승률({activeParams.inflationRate}%)을 차감하고, 목표 생활비·국민연금
                    수령액은 오늘 화폐가치로 고정 표시하여 시뮬레이션 전체를 실질 가치 기준으로 일관되게
                    계산합니다(표에 나오는 생활비·연금 금액이 매년 그대로인 것은 버그가 아니라 이 설정 때문입니다). (추천)
                  </span>
                </div>
              </div>
            </div>
            <InputField
              label="물가상승률 설정"
              type="number"
              step="0.1"
              value={activeParams.inflationRate}
              onChange={(e) => handleUpdateActiveParams({ ...activeParams, inflationRate: Number(e.target.value) })}
              suffixText="%"
            />
            <SelectField
              label="사적연금 저율과세 한도 내 인출"
              value={activeParams.taxSettings?.limitPrivatePensionToTaxLimit ? 'true' : 'false'}
              onChange={(e) => handleUpdateActiveParams({
                ...activeParams,
                taxSettings: { ...activeParams.taxSettings, limitPrivatePensionToTaxLimit: e.target.value === 'true' },
              })}
              options={[
                { value: 'true', label: '한도 내 인출 (절세 최적화)' },
                { value: 'false', label: '기본 인출 (일반 인출 계획)' },
              ]}
            />
          </div>
        </div>
      )}
    </div>
  );
};
export default SimulationSettings;
