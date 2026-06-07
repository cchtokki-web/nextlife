import React, { useState } from 'react';
import { SimulationParams } from '../../../core/entities/types';
import { SelectField } from '../../components/SelectField';
import { InputField } from '../../components/InputField';
import styles from './Scenario.module.css';
import compStyles from '../../styles/components.module.css';
import { Sliders, HelpCircle, RefreshCw } from 'lucide-react';

interface ScenarioSelectorProps {
  params: SimulationParams;
  onChangeParams: (newParams: SimulationParams) => void;
}

export const ScenarioSelector: React.FC<ScenarioSelectorProps> = ({ params, onChangeParams }) => {
  const [isFetching, setIsFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetchSuccess, setFetchSuccess] = useState(false);

  const fetchExchangeRate = async () => {
    if (isFetching) return;
    setIsFetching(true);
    setFetchError(null);
    setFetchSuccess(false);
    try {
      const res = await fetch('https://open.er-api.com/v6/latest/USD');
      if (!res.ok) {
        throw new Error('실시간 환율 데이터를 가져오지 못했습니다.');
      }
      const data = await res.json();
      if (data && data.rates && typeof data.rates.KRW === 'number') {
        const rate = Math.round(data.rates.KRW * 10) / 10;
        onChangeParams({
          ...params,
          baseExchangeRate: rate,
          exchangeScenario: 'base',
        });
        setFetchSuccess(true);
        setTimeout(() => setFetchSuccess(false), 4000);
      } else {
        throw new Error('환율 데이터 형식이 유효하지 않습니다.');
      }
    } catch (err: any) {
      console.error(err);
      setFetchError(err.message || '환율 정보를 가져오는데 실패했습니다.');
    } finally {
      setIsFetching(false);
    }
  };
  // 1. Apply global market yield preset
  const applyYieldPreset = (preset: 'conservative' | 'base' | 'aggressive') => {
    let stockGrowth = 8;
    let pensionReturn = 5;

    if (preset === 'conservative') {
      stockGrowth = 5;
      pensionReturn = 3;
    } else if (preset === 'aggressive') {
      stockGrowth = 12;
      pensionReturn = 8;
    }

    const updatedAssets = params.assets.map((asset) => ({
      ...asset,
      annualGrowthRate: stockGrowth,
    }));

    const updatedPensions = params.privatePensions.map((p) => ({
      ...p,
      annualReturn: pensionReturn,
    }));

    onChangeParams({
      ...params,
      assets: updatedAssets,
      privatePensions: updatedPensions,
      yieldPreset: preset,
    });
  };

  const getActivePreset = () => {
    if (params.yieldPreset) {
      return params.yieldPreset;
    }
    const hasAssets = params.assets.length > 0;
    const hasPensions = params.privatePensions.length > 0;
    if (!hasAssets && !hasPensions) return null;

    const allAssetsMatch = (rate: number) => params.assets.every(a => a.annualGrowthRate === rate);
    const allPensionsMatch = (rate: number) => params.privatePensions.every(p => p.annualReturn === rate);

    if (
      (!hasAssets || allAssetsMatch(5)) &&
      (!hasPensions || allPensionsMatch(3))
    ) {
      return 'conservative';
    }
    if (
      (!hasAssets || allAssetsMatch(8)) &&
      (!hasPensions || allPensionsMatch(5))
    ) {
      return 'base';
    }
    if (
      (!hasAssets || allAssetsMatch(12)) &&
      (!hasPensions || allPensionsMatch(8))
    ) {
      return 'aggressive';
    }
    return null;
  };

  const activePreset = getActivePreset();

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <Sliders size={18} className={styles.icon} />
        <span className={styles.title}>시뮬레이션 시나리오 및 변수 설정</span>
      </div>

      {/* Yield Scenario Presets */}
      <div className={styles.presetSection}>
        <label className={compStyles.label}>
          시장 수익률 프리셋 
          <span className={styles.helpText}>
            (클릭 시 모든 자산의 기대 수익률이 일괄 조정됩니다)
          </span>
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
        {/* displayCurrency */}
        <SelectField
          label="대시보드 기준 통화"
          value={params.displayCurrency}
          onChange={(e) => onChangeParams({ ...params, displayCurrency: e.target.value as any })}
          options={[
            { value: 'KRW', label: 'KRW (대한민국 원)' },
            { value: 'USD', label: 'USD (미국 달러)' },
          ]}
        />

        {/* 적용 환율 */}
        <div className={styles.exchangeRateWrapper}>
          <InputField
            label="적용 환율"
            type="number"
            value={params.baseExchangeRate}
            onChange={(e) => {
              const val = Number(e.target.value);
              onChangeParams({ ...params, baseExchangeRate: val, exchangeScenario: 'base' });
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

          <div className={styles.exchangeRateDetails} style={{ marginTop: '0.5rem', marginBottom: 0 }}>
            {isFetching && (
              <div className={styles.fetchingStatus}>
                <span>실시간 환율 데이터를 조회하고 있습니다...</span>
              </div>
            )}
            {fetchSuccess && (
              <div className={styles.successStatus}>
                실시간 환율(${params.baseExchangeRate}원)이 성공적으로 반영되었습니다!
              </div>
            )}
            {fetchError && <div className={styles.errorStatus}>❌ {fetchError}</div>}
          </div>
        </div>

        {/* inflationMode */}
        <SelectField
          label="인플레이션 반영 방식"
          value={params.inflationMode}
          onChange={(e) => onChangeParams({ ...params, inflationMode: e.target.value as any })}
          options={[
            { value: 'nominal', label: '명목 가치 (수익률 유지, 생활비 증액)' },
            { value: 'real', label: '실질 가치 (수익률 할인, 생활비 고정)' },
          ]}
        />

        {/* inflationRate */}
        <InputField
          label="물가상승률 설정"
          type="number"
          step="0.1"
          value={params.inflationRate}
          onChange={(e) => onChangeParams({ ...params, inflationRate: Number(e.target.value) })}
          suffixText="%"
        />
      </div>
    </div>
  );
};
export default ScenarioSelector;
