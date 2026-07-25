import { SimulationEngine } from '../SimulationEngine';
import { SimulationParams, SimulationResult } from '../../entities/types';

export interface SensitivityScenario {
  key: 'returnDown' | 'returnUp' | 'inflationUp' | 'inflationDown' | 'retirementEarlier' | 'retirementLater';
  label: string;
  depletionAge: number | null;
  deltaYears: number | null;
}

interface ScenarioDefinition {
  key: SensitivityScenario['key'];
  label: string;
  buildParams: (params: SimulationParams) => SimulationParams;
}

// 투자수익률 시나리오는 "시장 전체가 함께 움직인다"는 가정 하에 주식/ETF 자산, 사적연금, ISA
// 수익률을 전부 동일 폭(delta)만큼 가산한다. applyYieldPreset이 프리셋 적용 시 자산/연금에
// 동일 수익률을 일괄 적용하는 것과 같은 관례를 따르되, 값을 고정하는 대신 기존 값에 가산한다.
function shiftReturn(params: SimulationParams, delta: number): SimulationParams {
  return {
    ...params,
    assets: params.assets.map((a) => ({ ...a, annualGrowthRate: a.annualGrowthRate + delta })),
    privatePensions: params.privatePensions.map((p) => ({ ...p, annualReturn: p.annualReturn + delta })),
    isaAccounts: params.isaAccounts?.map((i) => ({ ...i, annualReturn: i.annualReturn + delta })),
  };
}

function shiftInflation(params: SimulationParams, delta: number): SimulationParams {
  return { ...params, inflationRate: params.inflationRate + delta };
}

// currentAge+1 미만, expectancy-1 초과로 은퇴시점이 넘어가지 않도록 clamp한다 — 그렇지 않으면
// "은퇴 기간이 없거나(현재나이보다 빠른 은퇴)" "은퇴 후 생존 기간이 없는(기대수명 이후 은퇴)"
// 무의미한 시나리오가 만들어진다.
function shiftRetirementAge(params: SimulationParams, delta: number): SimulationParams {
  const { currentAge, expectancy, retirementAge } = params.userProfile;
  const clamped = Math.min(expectancy - 1, Math.max(currentAge + 1, retirementAge + delta));
  return { ...params, userProfile: { ...params.userProfile, retirementAge: clamped } };
}

const SCENARIO_DEFINITIONS: ScenarioDefinition[] = [
  { key: 'returnDown', label: '투자수익률 -2%p', buildParams: (p) => shiftReturn(p, -2) },
  { key: 'returnUp', label: '투자수익률 +2%p', buildParams: (p) => shiftReturn(p, 2) },
  { key: 'inflationUp', label: '물가상승률 +1%p', buildParams: (p) => shiftInflation(p, 1) },
  { key: 'inflationDown', label: '물가상승률 -1%p', buildParams: (p) => shiftInflation(p, -1) },
  { key: 'retirementEarlier', label: '은퇴시점 -3년', buildParams: (p) => shiftRetirementAge(p, -3) },
  { key: 'retirementLater', label: '은퇴시점 +3년', buildParams: (p) => shiftRetirementAge(p, 3) },
];

// null(평생 유지)을 expectancy로 치환해 비교 가능한 숫자로 만든 뒤 차이를 낸다. 단, baseline과
// 시나리오가 둘 다 null이면 "변화 없음"을 명확히 하기 위해 0이 아닌 null을 반환한다.
function computeDeltaYears(
  baselineDepletionAge: number | null,
  depletionAge: number | null,
  expectancy: number
): number | null {
  if (baselineDepletionAge === null && depletionAge === null) return null;
  const baselineEffective = baselineDepletionAge ?? expectancy;
  const scenarioEffective = depletionAge ?? expectancy;
  return scenarioEffective - baselineEffective;
}

// 6개 시나리오(투자수익률/물가상승률/은퇴시점 각 ±)를 재실행해 자산 고갈 나이가 얼마나
// 민감하게 변하는지 반환한다. 개별 시나리오가 예외를 던지면 해당 시나리오만 제외한다.
// 반환 순서는 가장 위험한(고갈이 빠른) 시나리오가 먼저이며, 평생 유지(null)는 항상 뒤로 간다.
export function computeSensitivityAnalysis(
  params: SimulationParams,
  baselineResult: SimulationResult,
  engine: SimulationEngine
): SensitivityScenario[] {
  const { expectancy } = params.userProfile;
  const baselineDepletionAge = baselineResult.depletionAge;

  const withSortKey: (SensitivityScenario & { sortAge: number })[] = [];

  for (const def of SCENARIO_DEFINITIONS) {
    try {
      const modifiedParams = def.buildParams(params);
      const result = engine.runForUtility(modifiedParams);
      const depletionAge = result.depletionAge;
      withSortKey.push({
        key: def.key,
        label: def.label,
        depletionAge,
        deltaYears: computeDeltaYears(baselineDepletionAge, depletionAge, expectancy),
        sortAge: depletionAge ?? Infinity,
      });
    } catch {
      // 개별 시나리오 실패는 무시하고 나머지는 계속 계산한다 (RecommendationEngine의
      // 후보별 실패 격리와 동일 원칙).
    }
  }

  return withSortKey
    .sort((a, b) => a.sortAge - b.sortAge)
    .map(({ sortAge, ...scenario }) => scenario);
}
