import { CustomYieldSnapshot, SimulationParams } from '../../entities/types';

// 리스크 성향별 연 기대수익률. **단위는 %** (0.05가 아니라 5), 자산의 totalReturn와
// 사적연금 expectedReturn에 그대로 대입된다.
//
// **출처(git 이력 추적 결과)**: 근거 문서는 이 저장소에 없다. 확인된 것은 변경 이력뿐이다.
//   - 최초 커밋 5eaff3e: ScenarioSelector.tsx에 conservative 5/3, base 8/5, aggressive 12/8.
//   - 8a08aff "투자성향 프리셋 적용 로직을 순수 함수(applyYieldPreset)로 추출"(2026-07-25):
//     순수 추출을 표방했으나 실제로는 base 8/5 → 7/4, aggressive 12/8 → 9/6으로 **값을 함께
//     낮췄다.** 커밋 메시지에 근거 설명이 없다. conservative(5/3)만 최초값 그대로다.
// 즉 현재 base·aggressive 값의 근거는 기록된 적이 없다. 임의로 다시 바꾸지 말고, 근거를 아는
// 사람이 여기에 출처를 남길 것. 바꿔야 한다면 그때는 반드시 근거를 함께 적는다.
//
// **명목/실질**: 명목 수익률이다. inflationMode가 'real'이면 엔진이 inflationRate를 별도로
// 차감하므로, 이 값 자체를 실질로 바꾸면 물가가 두 번 반영된다.
//
// 이 상수는 applyYieldPreset 외에 volatilityPresets의 volatilityForStockReturn도 소비한다 —
// 프리셋 수익률과 프리셋 변동성을 잇는 직선의 양 끝 앵커다. 값을 바꾸면 몬테카를로 σ도 함께
// 움직인다. (2026-08-22부터 StrategyGenerator는 이 표를 쓰지 않는다 — 추천 후보는 사용자가
// 입력한 수익률 가정을 그대로 물려받는다.) computeSensitivityAnalysis의 수익률 축(안정형/
// 중립형/공격형 3행)도 이 표를 소비한다 — 계획을 바꾸지 않고 결과만 비교하는 렌즈다.
export const YIELD_PRESET_RATES = {
  conservative: { stockGrowth: 5, pensionReturn: 3 },
  base: { stockGrowth: 7, pensionReturn: 4 },
  aggressive: { stockGrowth: 9, pensionReturn: 6 },
} as const;

// 구 설정 UI(시뮬레이션 설정/핵심 설정 카드)에 있던 "시장 수익률 프리셋 적용" 로직을 순수
// 함수로 추출한 것. 그 UI들은 제거되었고, 지금은 compileStrategy가 「투자 전략」의 리스크 성향을
// 프리셋으로 번역할 때 이 함수를 호출한다.
//
// restoreCustomYieldPreset은 프리셋 버튼과 함께 사라진 "사용자 프리셋 복원" 동작을 위한 것이라
// 현재 호출부가 없다. customYieldSnapshot을 되돌릴 UI가 다시 생기면 그대로 쓸 수 있도록 남겨 둔다.
//
// assets/privatePensions를 ?? []로 방어하는 이유: 이 함수를 호출하는 쪽(page.tsx가 넘기는
// activeParams)이 과거 시나리오 데이터라서 최신 필드를 다 갖추지 못했을 가능성이 있다 —
// AssetFormSection.tsx/DashboardSection.tsx가 이미 쓰고 있는 방어적 기본값 관례와 동일하다.
//
// yieldPreset이 'custom'인 상태(자산별 직접입력)에서 다른 프리셋을 적용하면 직접입력 값이
// 사라지므로, 덮어쓰기 직전의 값을 customYieldSnapshot에 보관해 둔다 — restoreCustomYieldPreset이
// 이 스냅샷으로 되돌린다. 이미 프리셋 상태에서 다른 프리셋으로 바꾸는 경우는 되돌릴 직접입력 값이
// 없으므로 기존 스냅샷(있다면 더 이전의 직접입력 값)을 그대로 유지한다.
export function applyYieldPreset(
  params: SimulationParams,
  preset: 'conservative' | 'base' | 'aggressive'
): SimulationParams {
  const { stockGrowth, pensionReturn } = YIELD_PRESET_RATES[preset];

  const customYieldSnapshot = params.yieldPreset === 'custom' ? captureCustomYieldSnapshot(params) : params.customYieldSnapshot;

  // ISA도 totalReturn을 가진 시장 연동 계좌이므로 주식과 같은 값으로 맞춘다 —
  // 여기서만 빼두면 "보수적"을 골라도 ISA 홀로 높은 수익률을 유지해 계좌 간 서열이
  // 프리셋이 아니라 사용자 입력값으로 결정된다(economicScenarios.ts의 같은 판단 참조).
  // 키가 없는 옛 시나리오 데이터에 빈 배열을 새로 심지 않도록 있을 때만 교체한다.
  const isaAccounts = params.isaAccounts?.map((i) => ({ ...i, totalReturn: stockGrowth }));

  return {
    ...params,
    assets: (params.assets ?? []).map((a) => ({ ...a, totalReturn: stockGrowth })),
    privatePensions: (params.privatePensions ?? []).map((p) => ({ ...p, totalReturn: pensionReturn })),
    ...(isaAccounts ? { isaAccounts } : {}),
    yieldPreset: preset,
    customYieldSnapshot,
  };
}

function captureCustomYieldSnapshot(params: SimulationParams): CustomYieldSnapshot {
  return {
    assets: Object.fromEntries((params.assets ?? []).map((a) => [a.id, a.totalReturn])),
    privatePensions: Object.fromEntries((params.privatePensions ?? []).map((p) => [p.id, p.totalReturn])),
    isaAccounts: Object.fromEntries((params.isaAccounts ?? []).map((i) => [i.id, i.totalReturn])),
  };
}

// "사용자 프리셋" 재선택 시 마지막으로 저장된 직접입력 값(customYieldSnapshot)으로 복원한다.
// 스냅샷이 아직 없으면(직접입력 후 프리셋으로 전환한 적이 없는 경우) 되돌릴 값이 없으므로
// yieldPreset만 'custom'으로 맞추고 현재 값은 그대로 둔다.
export function restoreCustomYieldPreset(params: SimulationParams): SimulationParams {
  const snapshot = params.customYieldSnapshot;
  if (!snapshot) {
    return { ...params, yieldPreset: 'custom' };
  }

  // isaAccounts는 이 필드가 추가되기 전에 저장된 스냅샷에는 없다. 그런 스냅샷으로도
  // 복원이 터지지 않도록 빈 맵으로 방어한다(그 경우 ISA는 현재 값을 유지한다).
  const isaSnapshot = snapshot.isaAccounts ?? {};
  const isaAccounts = params.isaAccounts?.map((i) =>
    i.id in isaSnapshot ? { ...i, totalReturn: isaSnapshot[i.id] } : i
  );

  return {
    ...params,
    assets: (params.assets ?? []).map((a) => (a.id in snapshot.assets ? { ...a, totalReturn: snapshot.assets[a.id] } : a)),
    privatePensions: (params.privatePensions ?? []).map((p) =>
      p.id in snapshot.privatePensions ? { ...p, totalReturn: snapshot.privatePensions[p.id] } : p
    ),
    ...(isaAccounts ? { isaAccounts } : {}),
    yieldPreset: 'custom',
  };
}
