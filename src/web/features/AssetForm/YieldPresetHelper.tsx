import React from 'react';
import { SimulationParams } from '../../../core/entities/types';
import {
  YIELD_PRESET_RATES,
  applyYieldPreset,
  restoreCustomYieldPreset,
} from '../../../core/usecases/scenario/applyYieldPreset';
import styles from './AssetForm.module.css';

interface YieldPresetHelperProps {
  params: SimulationParams;
  onChangeParams: (params: SimulationParams) => void;
}

const PRESETS = [
  { key: 'conservative', label: '보수적 5%' },
  { key: 'base', label: '중립 7%' },
  { key: 'aggressive', label: '공격 9%' },
] as const;

/**
 * 수익률 입력칸을 한 번에 채워 주는 도우미.
 *
 * **프리셋은 계획을 지배하지 않는다.** 예전에는 「투자 전략」의 리스크 성향이 계산 시점에
 * 모든 계좌의 총수익률을 덮어썼고, 화면은 저장값을 그대로 보여줘 사용자가 자기 시뮬레이션이
 * 몇 %로 돌았는지 알 방법이 없었다. 이제 프리셋은 여기서 «저장값 자체»를 바꾼다 —
 * 값이 입력칸에 찍히고, 보이고, 개별로 고칠 수 있고, 되돌릴 수 있다.
 *
 * 되돌리기는 applyYieldPreset이 남긴 customYieldSnapshot을 쓴다.
 */
export function YieldPresetHelper({ params, onChangeParams }: YieldPresetHelperProps) {
  const canRestore = params.customYieldSnapshot !== undefined;

  return (
    <div className={styles.yieldPresetHelper}>
      <span className={styles.yieldPresetLabel}>수익률 일괄 채우기</span>
      {PRESETS.map((preset) => (
        <button
          key={preset.key}
          type="button"
          className={styles.yieldPresetButton}
          onClick={() => onChangeParams(applyYieldPreset(params, preset.key))}
          title={`주식·ISA ${YIELD_PRESET_RATES[preset.key].stockGrowth}%, 사적연금 ${YIELD_PRESET_RATES[preset.key].pensionReturn}%로 채웁니다`}
        >
          {preset.label}
        </button>
      ))}
      {canRestore && (
        <button
          type="button"
          className={styles.yieldPresetButton}
          onClick={() => onChangeParams(restoreCustomYieldPreset(params))}
        >
          직접 입력값으로 되돌리기
        </button>
      )}
    </div>
  );
}
