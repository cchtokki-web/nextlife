import { SimulationParams } from '../../entities/types';

// SimulationSettings.tsx에 있던 "시장 수익률 프리셋 적용" 로직을 순수 함수로 추출한 것.
// QuickSettingsSummary.tsx도 동일한 프리셋 버튼을 제공해야 해서, 로직이 두 곳에 따로 복붙되어
// 나중에 어긋나지 않도록 이 함수를 공유한다.
//
// assets/privatePensions를 ?? []로 방어하는 이유: 이 함수를 호출하는 쪽(page.tsx가 넘기는
// activeParams)이 과거 시나리오 데이터라서 최신 필드를 다 갖추지 못했을 가능성이 있다 —
// AssetFormSection.tsx/DashboardSection.tsx가 이미 쓰고 있는 방어적 기본값 관례와 동일하다.
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

  return {
    ...params,
    assets: (params.assets ?? []).map((a) => ({ ...a, annualGrowthRate: stockGrowth })),
    privatePensions: (params.privatePensions ?? []).map((p) => ({ ...p, annualReturn: pensionReturn })),
    yieldPreset: preset,
  };
}
