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

// 프로필을 갖는(= 경제 변수를 지배하는) 시나리오. 'ai_recommended'는 "미정"이라
// 프로필이 없어야 하므로 키 도메인에서 아예 제거한다.
//
// Partial<Record<EconomicScenario, ...>>가 아니라 Record<Exclude<...>>인 이유:
// Partial은 'ai_recommended' 항목을 채워 넣어도 컴파일이 통과한다. 이 브랜치에서
// 같은 실수(= 'ai_*' 센티널에 값을 채워 사용자 입력을 조용히 덮어씀)가 저율과세 한도·
// 물가상승률·경제 시나리오에서 세 번 반복됐다. Exclude로 키를 지우면 리터럴 객체의
// 초과 프로퍼티 검사가 네 번째 시도를 컴파일 타임에 막는다.
export type GoverningEconomicScenario = Exclude<EconomicScenario, 'ai_recommended'>;

// 경제 시나리오 프리셋. 몬테카를로가 아니라 결정론적 단일 경로다 —
// 시나리오를 고르면 그 가정 하나로 계산하며, 확률 분포는 산출하지 않는다.
//
// 침체·고물가에서 exchangeScenario를 'usd_up'으로 두는 이유: 두 국면 모두 원화 약세
// 압력이 커진다는 경험적 관찰을 단순화한 것이다. 정밀한 환율 모형이 아니다.
// 'ai_recommended'는 이 테이블에 없다. "미정"이지 "장기 평균"이 아니기 때문이다 —
// 프로필을 주면 사용자가 경제 가정에서 직접 입력한 물가상승률이 매 컴파일마다
// 조용히 덮어써진다.
export const ECONOMIC_SCENARIO_PROFILES: Record<GoverningEconomicScenario, EconomicScenarioProfile> = {
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

// 시나리오 값이 프로필을 가질 수 있는 키인지. "미정"(ai_recommended)을 여기서 한 번만
// 걸러내고, 그 분기 자체가 "여기가 미정을 처리하는 자리"임을 코드 흐름으로 드러낸다.
function isGoverningScenarioKey(scenario: EconomicScenario): scenario is GoverningEconomicScenario {
  return scenario !== 'ai_recommended';
}

// 시나리오에 대응하는 프로필. "미정"이거나 알 수 없는 값이면 null이다.
// 알 수 없는 값(저장된 옛 시나리오에 남은 없어진 enum 등)은 타입 가드를 통과하지만
// 테이블에는 없으므로, 런타임 폴백(?? null)을 유지해야 한다.
export function resolveEconomicScenarioProfile(
  scenario: EconomicScenario
): EconomicScenarioProfile | null {
  if (!isGoverningScenarioKey(scenario)) return null;
  return ECONOMIC_SCENARIO_PROFILES[scenario] ?? null;
}

// 특정 시나리오가 경제 변수를 지배하는지. false면 사용자가 직접 입력한
// 물가상승률/환율이 그대로 쓰이므로 UI는 그 입력 필드를 열어두어야 한다.
export function isEconomicScenarioGoverning(scenario: EconomicScenario): boolean {
  return resolveEconomicScenarioProfile(scenario) !== null;
}

// 시나리오 프로필을 params에 적용한다. 순수 함수이며, 'ai_recommended'(미정)이거나
// 알 수 없는 값이면 입력을 그대로 돌려준다 — 사용자가 직접 입력한 값을 보존하기 위해서다.
export function applyEconomicScenario(
  params: SimulationParams,
  scenario: EconomicScenario
): SimulationParams {
  const profile = resolveEconomicScenarioProfile(scenario);
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
