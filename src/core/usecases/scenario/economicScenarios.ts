import { EconomicScenario, SimulationParams } from '../../entities/types';

export interface EconomicScenarioProfile {
  inflationRate: number; // %
  // % — 모든 주식/ETF 자산과 ISA 계좌에 일괄 적용.
  // ISA에 별도 요율을 두지 않는 이유: 이 모델에서 ISA는 assets와 구조가 같은 시장 연동
  // 계좌다(annualReturn + dividendYield로 굴러가고 세제만 다르다). 반면 사적연금은 더
  // 보수적인 배분을 가정해 별도 요율을 쓴다. computeSensitivityAnalysis.shiftReturn도
  // "시장 전체가 함께 움직인다"는 같은 전제로 세 버킷을 동일 폭만큼 움직인다.
  stockGrowthRate: number;
  pensionReturnRate: number; // % — 모든 사적연금 계좌에 일괄 적용
  exchangeScenario: SimulationParams['exchangeScenario'];
}

// 경제 시나리오 프리셋. 몬테카를로가 아니라 결정론적 단일 경로다 —
// 시나리오를 고르면 그 가정 하나로 계산하며, 확률 분포는 산출하지 않는다.
//
// 침체·고물가에서 exchangeScenario를 'usd_up'으로 두는 이유: 두 국면 모두 원화 약세
// 압력이 커진다는 경험적 관찰을 단순화한 것이다. 정밀한 환율 모형이 아니다.
// 'ai_recommended'는 이 테이블에 없다. "미정"이지 "장기 평균"이 아니기 때문이다 —
// 프로필을 주면 사용자가 ⑤경제 가정에서 직접 입력한 물가상승률이 매 컴파일마다
// 조용히 덮어써진다(Task 8 리뷰에서 발견, Task 7의 'ai_optimized'와 같은 버그).
export const ECONOMIC_SCENARIO_PROFILES: Partial<Record<EconomicScenario, EconomicScenarioProfile>> = {
  long_term_average: {
    inflationRate: 2.5, stockGrowthRate: 7, pensionReturnRate: 4, exchangeScenario: 'base',
  },
  recession: {
    inflationRate: 1.5, stockGrowthRate: 3, pensionReturnRate: 2, exchangeScenario: 'usd_up',
  },
  high_inflation: {
    inflationRate: 5, stockGrowthRate: 6, pensionReturnRate: 3, exchangeScenario: 'usd_up',
  },
  low_growth: {
    inflationRate: 2, stockGrowthRate: 4, pensionReturnRate: 2.5, exchangeScenario: 'base',
  },
};

// 특정 시나리오가 경제 변수를 지배하는지. false면 사용자가 직접 입력한
// 물가상승률/환율이 그대로 쓰이므로 UI는 그 입력 필드를 열어두어야 한다.
export function isEconomicScenarioGoverning(scenario: EconomicScenario): boolean {
  return ECONOMIC_SCENARIO_PROFILES[scenario] !== undefined;
}

// 시나리오 프로필을 params에 적용한다. 순수 함수이며, 'ai_recommended'(미정)이거나
// 알 수 없는 값이면 입력을 그대로 돌려준다 — 사용자가 직접 입력한 값을 보존하기 위해서다.
export function applyEconomicScenario(
  params: SimulationParams,
  scenario: EconomicScenario
): SimulationParams {
  const profile = ECONOMIC_SCENARIO_PROFILES[scenario];
  if (!profile) return params;

  // isaAccounts는 키가 없을 수도 있으므로(옛 시나리오 데이터) 있을 때만 교체한다.
  // 빈 배열을 새로 심으면 "ISA를 만든 적 없음"과 "ISA를 다 지움"이 구분되지 않는다.
  const isaAccounts = params.isaAccounts?.map((i) => ({ ...i, annualReturn: profile.stockGrowthRate }));

  return {
    ...params,
    inflationRate: profile.inflationRate,
    exchangeScenario: profile.exchangeScenario,
    assets: (params.assets ?? []).map((a) => ({ ...a, annualGrowthRate: profile.stockGrowthRate })),
    privatePensions: (params.privatePensions ?? []).map((p) => ({
      ...p, annualReturn: profile.pensionReturnRate,
    })),
    ...(isaAccounts ? { isaAccounts } : {}),
  };
}
