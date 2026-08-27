import React from 'react';
import { SimulationParams } from '../../../core/entities/types';
import {
  YIELD_PRESET_RATES,
  applyYieldPreset,
  matchedYieldPreset,
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
          aria-pressed={selected === preset.key}
          className={styles.yieldPresetButton}
          onClick={() => onChangeParams(applyYieldPreset(params, preset.key))}
          title={`주식·ISA ${YIELD_PRESET_RATES[preset.key].stockGrowth}%, 사적연금 ${YIELD_PRESET_RATES[preset.key].pensionReturn}%로 채웁니다`}
        >
          {preset.label}
        </button>
      ))}
      {canRestore && (
        // **토글이 아니라 «행위»다.** 누르면 customYieldSnapshot의 값으로 수익률을 덮어쓴다.
        // aria-pressed를 붙이면 화면을 보지 않는 사용자에게 「이미 되돌아가 있음」으로 읽히는데,
        // 그 상태에서도 누르면 숫자가 바뀐다. 프리셋 셋과 달리 여기서는 선택 표시를 쓰지 않는다.
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
