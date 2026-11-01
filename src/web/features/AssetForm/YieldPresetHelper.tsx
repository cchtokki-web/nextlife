import React from 'react';
import { InvestmentCategory, SimulationParams, YieldPreset } from '../../../core/entities/types';
import {
  YIELD_PRESET_RATES, applyYieldPreset, YIELD_PRESET_LABELS, matchedYieldPreset,
  INVESTMENT_CATEGORIES, categoryYieldRate, applyCustomCategoryYields,
} from '../../../core/usecases/scenario/applyYieldPreset';
import { NumberField } from '../../components/fields/NumberField';
import styles from './AssetForm.module.css';

interface YieldPresetHelperProps {
  params: SimulationParams;
  onChangeParams: (params: SimulationParams) => void;
}

const PRESETS: YieldPreset[] = ['conservative', 'base', 'aggressive'];

export function YieldPresetHelper({ params, onChangeParams }: YieldPresetHelperProps) {
  const selected = params.autoUpdateEtfReturns ? 'auto'
    : params.categoryYieldMode === 'custom' && params.categoryCustomYieldRates ? 'custom'
      : params.categoryYieldMode !== 'auto' && params.categoryYieldMode !== 'custom' && params.categoryYieldMode
        ? params.categoryYieldMode : matchedYieldPreset(params);
  const displayed = selected && selected !== 'auto' ? selected : undefined;

  function changeRate(category: InvestmentCategory, rate: number) {
    if (!displayed || !Number.isFinite(rate)) return;
    const current = displayed === 'custom' ? params.categoryCustomYieldRates?.[category]
      : categoryYieldRate(params, category, displayed);
    if (current === rate) return;
    const rates = Object.fromEntries(INVESTMENT_CATEGORIES.map(({ value }) => [value,
      displayed === 'custom' ? params.categoryCustomYieldRates?.[value] ?? categoryYieldRate(params, value, 'base')
        : categoryYieldRate(params, value, displayed),
    ])) as NonNullable<SimulationParams['categoryCustomYieldRates']>;
    onChangeParams(applyCustomCategoryYields({ ...params, categoryCustomYieldRates: { ...rates, [category]: rate } }));
  }

  return (
    <div className={styles.yieldPresetHelper}>
      <span className={styles.yieldPresetLabel}>수익률 일괄 채우기</span>
      <div className={styles.yieldPresetButtons} role="group" aria-label="수익률 유형">
        {PRESETS.map((preset) => (
          <button key={preset} type="button" aria-pressed={selected === preset}
            className={styles.yieldPresetButton}
            title={`ETF는 카테고리별 수익률 적용, 그 외 ISA ${YIELD_PRESET_RATES[preset].stockGrowth}%, 사적연금 ${YIELD_PRESET_RATES[preset].pensionReturn}%`}
            onClick={() => onChangeParams({ ...applyYieldPreset(params, preset), categoryYieldMode: preset })}>
            {YIELD_PRESET_LABELS[preset]}
          </button>
        ))}
        <button type="button" aria-pressed={selected === 'auto'} className={styles.yieldPresetButton}
          onClick={() => onChangeParams({ ...params, autoUpdateEtfReturns: true, categoryYieldMode: 'auto',
            assets: params.assets.map((asset) => asset.type === 'etf' ? { ...asset, autoHistoricalReturn: true } : asset),
            yieldPreset: 'custom' })}>
          자동 수익률
        </button>
        {params.categoryCustomYieldRates && (
          <button type="button" aria-pressed={selected === 'custom'} className={styles.yieldPresetButton}
            onClick={() => onChangeParams(applyCustomCategoryYields(params))}>사용자</button>
        )}
      </div>
      {displayed && (
        <div className={styles.categoryYieldSettings}>
          <p className={styles.categoryYieldTitle}>카테고리별 수익률</p>
          <div className={styles.categoryYieldGrid}>
            {INVESTMENT_CATEGORIES.map(({ value, label }) => (
              <NumberField key={value} label={label} step="0.1" suffixText="%"
                value={displayed === 'custom' ? params.categoryCustomYieldRates?.[value] ?? categoryYieldRate(params, value, 'base')
                  : categoryYieldRate(params, value, displayed)}
                onChangeValue={(rate) => changeRate(value, rate)} />
            ))}
          </div>
        </div>
      )}
      {selected === 'auto' && <p className="basis-full text-xs text-foreground-muted">ETF 과거 수익률은 미래 성과를 보장하지 않습니다.</p>}
    </div>
  );
}
