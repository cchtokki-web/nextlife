import { SimulationEngine } from '../SimulationEngine';
import { SimulationParams } from '../../entities/types';
import { freezeSpendingPlan, mapFrozenPlan, runFrozenPlan } from '../spending/freezeSpendingPlan';
import { PlanAssetStatus, resolvePlanAssetStatus } from './resolvePlanAssetStatus';

export interface SensitivityScenario {
  key: 'returnDown' | 'returnUp' | 'inflationUp' | 'inflationDown' | 'retirementEarlier' | 'retirementLater';
  label: string;
  depletionAge: number | null;
  deltaYears: number | null;
  // 기대수명 시점의 잔여자산과 baseline 대비 증감.
  //
  // depletionAge만으로는 여유 있는 계획에서 6개 시나리오가 전부 null이 되어 화면이
  // "고갈 위험 없습니다" 한 줄로 접힌다. 실제로는 수익률 ±2%p가 기말자산을 수억 원
  // 갈라놓는데도 사용자는 아무 차이도 보지 못했다. 재계산은 이미 하고 있었으므로
  // 추가 비용 없이 결과에서 이 값을 함께 싣는다.
  endingAssets: number;
  endingAssetsDelta: number;
  // 목표 생활비를 채우지 못한 해의 수. 자산이 남아 있어도 계획이 실패한 해다.
  // depletionAge는 이 해를 잡지 못한다(SimulationYearlyResult.unmetSpending 주석 참조).
  unmetSpendingYears: number;
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
//
// **일반자산 인출 개시 나이도 함께 옮긴다.** 엔진은 일반자산 매도 시작을
// `withdrawalPlan.generalAssetWithdrawalStartAge ?? userProfile.retirementAge`로 읽는데,
// 센티널 단계(verifiedSentinelPlan의 SENTINEL_AXES)가 이 필드를 항상 채워 넣는다. 그래서
// retirementAge만 옮긴 예전 구현에서는 은퇴만 3년 당겨지고 자산 인출은 옛 나이에 그대로
// 머물러, "은퇴시점 ±3년" 시나리오가 사실상 아무것도 검증하지 못했다.
//
// clamp된 실제 이동량(clamped − retirementAge)을 쓴다. delta를 그대로 더하면 은퇴 나이는
// clamp에 걸려 멈췄는데 인출 나이만 계속 움직여 둘의 간격이 벌어진다.
//
// 미설정(undefined)이면 채워 넣지 않는다 — 미설정은 "은퇴 나이를 따른다"는 뜻이라 이미
// 함께 움직이고, 여기서 값을 만들면 사용자가 세우지 않은 계획을 시나리오가 지어내게 된다.
function shiftRetirementAge(params: SimulationParams, delta: number): SimulationParams {
  const { currentAge, expectancy, retirementAge } = params.userProfile;
  const clamped = Math.min(expectancy - 1, Math.max(currentAge + 1, retirementAge + delta));
  const appliedDelta = clamped - retirementAge;

  const generalAssetWithdrawalStartAge = params.withdrawalPlan?.generalAssetWithdrawalStartAge;
  const withdrawalPlan = generalAssetWithdrawalStartAge === undefined
    ? params.withdrawalPlan
    : { ...params.withdrawalPlan, generalAssetWithdrawalStartAge: generalAssetWithdrawalStartAge + appliedDelta };

  return {
    ...params,
    userProfile: { ...params.userProfile, retirementAge: clamped },
    withdrawalPlan,
  };
}

const SCENARIO_DEFINITIONS: ScenarioDefinition[] = [
  { key: 'returnDown', label: '투자수익률 -2%p', buildParams: (p) => shiftReturn(p, -2) },
  { key: 'returnUp', label: '투자수익률 +2%p', buildParams: (p) => shiftReturn(p, 2) },
  { key: 'inflationUp', label: '물가상승률 +1%p', buildParams: (p) => shiftInflation(p, 1) },
  { key: 'inflationDown', label: '물가상승률 -1%p', buildParams: (p) => shiftInflation(p, -1) },
  { key: 'retirementEarlier', label: '은퇴시점 -3년', buildParams: (p) => shiftRetirementAge(p, -3) },
  { key: 'retirementLater', label: '은퇴시점 +3년', buildParams: (p) => shiftRetirementAge(p, 3) },
];

// null(평생 유지)을 "고갈 없음" 센티널 나이로 치환해 비교 가능한 숫자로 만든 뒤 차이를 낸다.
// 단, baseline과 시나리오가 둘 다 null이면 "변화 없음"을 명확히 하기 위해 0이 아닌 null을 반환한다.
//
// 센티널은 시뮬레이션 루프가 끝나는 나이(expectancy)여야 한다. 그래야 "고갈 없음"이
// depletionAge와 같은 눈금 위에 놓여 두 값의 차이가 의미를 가진다.
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

export interface SensitivityAnalysis {
  // 가장 위험한(고갈이 빠른) 시나리오가 먼저이며, 평생 유지(null)는 항상 뒤로 간다.
  scenarios: SensitivityScenario[];
  // 6개 시나리오가 **공통으로 고정한** 월 생활비. 화면과 PDF는 이 값을 반드시 밝혀야 한다 —
  // 밝히지 않으면 사용자는 자기가 입력한 목표 생활비 기준으로 표를 읽는다.
  frozenMonthlySpending: number;
  // 기준선도 같은 고정 계획에서 나온다(아래 주석 참조). 호출부가 따로 계산해 넘기지 않는다.
  baselineDepletionAge: number | null;
  baselineEndingAssets: number;
  // 시나리오의 unmetSpendingYears와 같은 식으로 센다 — 두 값을 나란히 비교해
  // "결과가 baseline과 정말 같은가"를 판정하는 화면이 있다(SensitivityAnalysisSection).
  baselineUnmetSpendingYears: number;
  // 화면이 "투자자산이 없어 전부 동일" 분기를 타는 근거. 이 판정도 시나리오와 같은 고정
  // 계획에서 나와야 하므로 여기서 함께 낸다 — 호출부가 다른 실행 결과로 판정하면
  // "표는 갈리는데 안내문은 동일하다고 말하는" 상태가 된다.
  baselinePlanAssetStatus: PlanAssetStatus;
}

// 6개 시나리오(투자수익률/물가상승률/은퇴시점 각 ±)를 재실행해 자산 고갈 나이가 얼마나
// 민감하게 변하는지 반환한다. 개별 시나리오가 예외를 던지면 해당 시나리오만 제외한다.
//
// **생활비는 고정한다.** 민감도 분석은 "이 계획을 그대로 유지했을 때 가정 하나가 바뀌면
// 어떻게 되는가"를 묻는 것이다. 예전에는 「평생 소비 최적화」 계획에서 시나리오마다
// runForUtility가 이진탐색을 다시 돌려(SimulationEngine.ts:161) 생활비를 재최적화했고,
// 그 결과 기준 시나리오가 90세에 정확히 0원인 계획인데도 수익률 -2%p·물가 +1%p가 전부
// "평생 유지"로 나왔다. 그건 민감도가 아니라 "가정이 나빴다면 얼마나 덜 썼을까"였다.
//
// **기준선도 같은 고정 계획으로 계산한다.** 예전에는 호출부가 baseline을 넘겼는데 두 곳이
// 서로 다른 것을 넘기고 있었다(화면은 runForUtility(params), PDF는 run()의 result).
// 시나리오와 다른 기준선으로 뺀 endingAssetsDelta는 의미가 없으므로 인자를 없앤다.
export function computeSensitivityAnalysis(
  params: SimulationParams,
  engine: SimulationEngine
): SensitivityAnalysis {
  const frozen = freezeSpendingPlan(params, engine);
  const baseline = runFrozenPlan(engine, frozen);
  const baselineDepletionAge = baseline.depletionAge;
  const { expectancy } = params.userProfile;

  const withSortKey: (SensitivityScenario & { sortAge: number })[] = [];

  for (const def of SCENARIO_DEFINITIONS) {
    try {
      const result = runFrozenPlan(engine, mapFrozenPlan(frozen, def.buildParams));
      const depletionAge = result.depletionAge;
      withSortKey.push({
        key: def.key,
        label: def.label,
        depletionAge,
        deltaYears: computeDeltaYears(baselineDepletionAge, depletionAge, expectancy),
        endingAssets: result.endingAssets,
        endingAssetsDelta: result.endingAssets - baseline.endingAssets,
        unmetSpendingYears: result.yearlyResults.filter((y) => y.unmetSpending > 0).length,
        sortAge: depletionAge ?? Infinity,
      });
    } catch {
      // 개별 시나리오 실패는 무시하고 나머지는 계속 계산한다 (RecommendationEngine의
      // 후보별 실패 격리와 동일 원칙).
    }
  }

  return {
    scenarios: withSortKey
      .sort((a, b) => a.sortAge - b.sortAge)
      .map(({ sortAge: _sortAge, ...scenario }) => scenario),
    frozenMonthlySpending: frozen.monthlyTargetSpending,
    baselineDepletionAge,
    baselineEndingAssets: baseline.endingAssets,
    baselineUnmetSpendingYears: baseline.yearlyResults.filter((y) => y.unmetSpending > 0).length,
    baselinePlanAssetStatus: resolvePlanAssetStatus(baseline, params),
  };
}
