import React from 'react';
import { SimulationParams } from '../../../core/entities/types';
import {
  YIELD_PRESET_RATES,
  applyYieldPreset,
  YIELD_PRESET_LABELS,
  matchedYieldPreset,
  INVESTMENT_CATEGORIES,
  categoryYieldRate,
} from '../../../core/usecases/scenario/applyYieldPreset';
import styles from './AssetForm.module.css';

interface YieldPresetHelperProps {
  params: SimulationParams;
  onChangeParams: (params: SimulationParams) => void;
}

// 미분류 자산에 쓰는 기존 공통값이다. 분류된 자산이 있거나 사용자 설정이 있으면
// 버튼에 단일 수치를 표시하지 않는다.
const PRESETS = (['conservative', 'base', 'aggressive'] as const).map((key) => ({
  key,
  label: `${YIELD_PRESET_LABELS[key]} ${YIELD_PRESET_RATES[key].stockGrowth}%`,
}));

/**
 * 수익률 입력칸을 한 번에 채워 주는 도우미.
 *
 * **프리셋은 계획을 지배하지 않는다.** 예전에는 「투자 전략」의 리스크 성향이 계산 시점에
 * 모든 계좌의 총수익률을 덮어썼고, 화면은 저장값을 그대로 보여줘 사용자가 자기 시뮬레이션이
 * 몇 %로 돌았는지 알 방법이 없었다. 이제 프리셋은 여기서 «저장값 자체»를 바꾼다 —
 * 값이 입력칸에 찍히고 보인다. 기존 스냅샷 데이터는 저장 경로에 보존한다.
 */
export function YieldPresetHelper({ params, onChangeParams }: YieldPresetHelperProps) {
  // 「지금 입력칸의 수익률이 이 버튼이 채우는 값과 «같은가»」. params.yieldPreset을 읽지
  // 않는 이유는 matchedYieldPreset에 적혀 있다 — 요약하면 그 필드는 저장 계층이 키 없는
  // 시나리오에 'base'를 채워 넣어(normalizeSimulationParams) 누른 적 없는 프리셋을 켜고,
  // 자산 삭제·티커 자동조회처럼 수익률을 고친 적 없는 경로에서도 'custom'으로 떨어진다.
  //
  // 값에서 유도하면 표시가 스스로 참이 된다 — 켜져 있으면 입력칸의 총수익률이 정말 그 값이고,
  // 사용자가 하나라도 고치면 그 순간 꺼진다. 어느 프리셋과도 같지 않거나 비교할 계좌가 없으면
  // 아무것도 켜지 않는다.
  const selected = matchedYieldPreset(params);

  return (
    <div className={styles.yieldPresetHelper}>
      <span className={styles.yieldPresetLabel}>수익률 일괄 채우기</span>
      {PRESETS.map((preset) => (
        <button
          key={preset.key}
          type="button"
          // 선택 상태를 색으로만 말하지 않는다 — aria-pressed가 있어야 화면을 보지 않는
          // 사용자에게도 지금 어떤 가정이 적용돼 있는지 드러난다.
          aria-pressed={!params.autoUpdateEtfReturns && selected === preset.key}
          className={styles.yieldPresetButton}
          onClick={() => onChangeParams(applyYieldPreset(params, preset.key))}
          title={`분류된 자산은 카테고리 설정, 미분류·ISA는 ${YIELD_PRESET_RATES[preset.key].stockGrowth}%, 사적연금은 ${YIELD_PRESET_RATES[preset.key].pensionReturn}%를 적용합니다`}
        >
          {params.assets.some((asset) => asset.category) || (params.categoryYieldRates && Object.keys(params.categoryYieldRates).length) ? YIELD_PRESET_LABELS[preset.key] : preset.label}
        </button>
      ))}
      <button type="button" aria-pressed={params.autoUpdateEtfReturns === true} className={styles.yieldPresetButton}
        title="ETF 과거 수정 종가로 계산한 연환산 수익률을 자동 반영합니다"
        onClick={() => onChangeParams({ ...params, autoUpdateEtfReturns: true,
          assets: params.assets.map((asset) => asset.type === 'etf' ? { ...asset, autoHistoricalReturn: true } : asset),
          yieldPreset: 'custom' })}>
        자동 수익률
      </button>
      <details className="basis-full">
        <summary>카테고리별 수익률 설정</summary>
        <p>자산의 카테고리를 선택하고 총수익률 가정을 조정하세요.</p>
        {INVESTMENT_CATEGORIES.map(({ value, label }) => (
          <div key={value} className="flex flex-wrap items-center gap-2 mt-2">
            <span>{label}</span>
            {PRESETS.map(({ key }) => (
              <label key={key} className="flex items-center gap-1">
                {YIELD_PRESET_LABELS[key]}
                <input type="number" step="0.1" aria-label={`${label} ${YIELD_PRESET_LABELS[key]} 수익률`}
                  className="w-20 rounded border border-slate-600 bg-transparent px-2 py-1"
                  key={`${value}-${key}-${categoryYieldRate(params, value, key)}`}
                  defaultValue={categoryYieldRate(params, value, key)}
                  onBlur={(event) => {
                    if (!event.target.value.trim()) return;
                    const rate = Number(event.target.value);
                    if (!Number.isFinite(rate)) return;
                    const next = { ...params, categoryYieldRates: { ...params.categoryYieldRates,
                      [value]: { ...params.categoryYieldRates?.[value], [key]: rate } } };
                    onChangeParams(!params.autoUpdateEtfReturns && selected === key ? applyYieldPreset(next, key) : next);
                  }} />%
              </label>
            ))}
          </div>
        ))}
      </details>
      {params.autoUpdateEtfReturns && <p className="basis-full text-xs text-foreground-muted">ETF 과거 수익률은 미래 성과를 보장하지 않습니다.</p>}
    </div>
  );
}
