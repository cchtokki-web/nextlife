import { CustomYieldSnapshot, SimulationParams } from '../../entities/types';

// 구 설정 UI(시뮬레이션 설정/핵심 설정 카드)에 있던 "시장 수익률 프리셋 적용" 로직을 순수
// 함수로 추출한 것. 그 UI들은 제거되었고, 지금은 compileStrategy가 ④투자 전략의 리스크 성향을
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
  let stockGrowth = 7;
  let pensionReturn = 4;
  if (preset === 'conservative') {
    stockGrowth = 5;
    pensionReturn = 3;
  } else if (preset === 'aggressive') {
    stockGrowth = 9;
    pensionReturn = 6;
  }

  const customYieldSnapshot = params.yieldPreset === 'custom' ? captureCustomYieldSnapshot(params) : params.customYieldSnapshot;

  return {
    ...params,
    assets: (params.assets ?? []).map((a) => ({ ...a, annualGrowthRate: stockGrowth })),
    privatePensions: (params.privatePensions ?? []).map((p) => ({ ...p, annualReturn: pensionReturn })),
    yieldPreset: preset,
    customYieldSnapshot,
  };
}

function captureCustomYieldSnapshot(params: SimulationParams): CustomYieldSnapshot {
  return {
    assets: Object.fromEntries((params.assets ?? []).map((a) => [a.id, a.annualGrowthRate])),
    privatePensions: Object.fromEntries((params.privatePensions ?? []).map((p) => [p.id, p.annualReturn])),
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

  return {
    ...params,
    assets: (params.assets ?? []).map((a) => (a.id in snapshot.assets ? { ...a, annualGrowthRate: snapshot.assets[a.id] } : a)),
    privatePensions: (params.privatePensions ?? []).map((p) =>
      p.id in snapshot.privatePensions ? { ...p, annualReturn: snapshot.privatePensions[p.id] } : p
    ),
    yieldPreset: 'custom',
  };
}
