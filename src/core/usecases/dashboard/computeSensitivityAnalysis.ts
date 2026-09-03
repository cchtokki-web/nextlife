import { SimulationEngine } from '../SimulationEngine';
import { SimulationParams } from '../../entities/types';
import { freezeSpendingPlan, mapFrozenPlan, runFrozenPlan } from '../spending/freezeSpendingPlan';
import { hasSpendingShortfall } from '../spending/spendingShortfall';
import { YIELD_PRESET_RATES } from '../scenario/applyYieldPreset';
import { weightedAverageTotalReturn } from '../returns/portfolioReturn';
import { PlanAssetStatus, resolvePlanAssetStatus } from './resolvePlanAssetStatus';
import {
  type GoalSuccessConditions,
  type HardGoalOutcome,
  type HardRequirementAxis,
  resolveGoalSuccessConditions,
  resolveHardViolations,
} from '../goals/goalSuccessConditions';

export interface SensitivityScenario {
  key: 'yieldDown' | 'yieldUp'
    | 'inflationUp' | 'inflationDown' | 'retirementEarlier' | 'retirementLater';
  label: string;
  depletionAge: number | null;
  deltaYears: number | null;
  // 기대수명 시점의 잔여자산과 baseline 대비 증감.
  //
  // depletionAge만으로는 여유 있는 계획에서 7개 시나리오가 전부 null이 되어 화면이
  // "고갈 위험 없습니다" 한 줄로 접힌다. 실제로는 수익률 가정(안정형/공격형)이 기말자산을
  // 수억 원 갈라놓는데도 사용자는 아무 차이도 보지 못했다. 재계산은 이미 하고 있었으므로
  // 추가 비용 없이 결과에서 이 값을 함께 싣는다.
  endingAssets: number;
  endingAssetsDelta: number;
  // 목표 생활비를 채우지 못한 해의 수. 자산이 남아 있어도 계획이 실패한 해다.
  // depletionAge는 이 해를 잡지 못한다(SimulationYearlyResult.unmetSpending 주석 참조).
  unmetSpendingYears: number;
  /**
   * 이 시나리오가 어기는 확정 HARD 요구. 비어 있으면 위반 없음이다.
   *
   * **endingAssetsDelta와 독립이다.** 화면·PDF는 시나리오를 depletionAge(고갈이 빠른 순,
   * 평생 유지는 뒤)로 정렬하고 endingAssetsDelta의 부호로 막대·글자색을 칠한다(초록=개선,
   * 빨강=악화) — 기말자산이 baseline보다 늘면 그 색이 「개선」으로 읽힌다. 그런데 그 늘어난
   * 자산으로도 사용자가
   * 「반드시 지키기」로 못박은 조건(자산 고갈 방지·목표 생활비·기말자산 하한)을 지키지
   * 못할 수 있다. 판정식은 resolveGoalSuccessConditions·resolveHardViolations 한 곳뿐이다
   * — MonteCarloEngine의 hardGoalSuccessProbability와 같은 함수를 쓴다. 여기서 새 술어를
   * 다시 적으면 몬테카를로와 민감도 분석이 "이 계획이 HARD를 어겼는가"에 대해 서로 다른
   * 답을 하게 된다.
   */
  hardViolations: HardRequirementAxis[];
}

interface ScenarioDefinition {
  key: SensitivityScenario['key'];
  label: string;
  buildParams: (params: SimulationParams) => SimulationParams;
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

/**
 * 수익률 축의 이동 폭(%p). 위·아래로 같은 크기를 쓴다.
 *
 * **새 가정을 만들지 않는다.** 이 값은 `YIELD_PRESET_RATES`의 주식 수익률 간격에서 «유도»한다 —
 * 안정형 5% · 중립형 7% · 공격형 9%로 두 간격이 모두 2%p다. 저장소가 이미 「한 단계 다른
 * 수익률 세계」라고 부르던 폭을 그대로 쓴다.
 *
 * 숫자를 적어 두지 않고 유도하는 이유: 적어 두면 그 근거가 주석에만 남는다. 프리셋 표를
 * 고치는 날 이 축의 폭만 옛 값에 남고, 「한 단계」라는 말이 앱 안에서 두 뜻을 갖게 된다.
 *
 * **유도가 성립하려면 두 간격이 같아야 한다.** 오늘은 같고, 그 전제는 테스트가 잠근다
 * (「수익률 축의 폭은 프리셋 표의 간격에서 온다」). 표를 5/7/10처럼 고치면 그 테스트가 먼저
 * 멈춰 세운다 — 어느 간격을 「한 단계」로 볼지는 그때 정할 결정이지 여기서 조용히 고를
 * 것이 아니다.
 *
 * 이 유도는 축의 «방식»과는 무관하다. 축이 절대 앵커를 그만 쓰는 것과, 그 폭을 어디서
 * 빌려 오는가는 다른 이야기다(아래 SCENARIO_DEFINITIONS 주석).
 */
const YIELD_SHIFT_POINTS =
  YIELD_PRESET_RATES.base.stockGrowth - YIELD_PRESET_RATES.conservative.stockGrowth;

/**
 * 모든 위험자산의 총수익률을 함께 옮긴 사본.
 *
 * **배당률은 그대로 둔다.** `totalReturn`이 배당을 포함하므로 이동분은 가격상승분이
 * 흡수한다(AGENTS.md: 총수익률에 배당을 더해 이중 계상하지 않는다). 프리셋이 배당률을
 * 「같은 비율로」 함께 옮기는 것은 총수익률을 절대값으로 «덮어쓰기» 때문이다 — 덮어쓰면
 * 배당률이 새 총수익률을 넘겨 가격상승률이 음수가 되는 조합을 지어낼 수 있다. 상대 이동은
 * 그 문제가 없다.
 *
 * 사적연금도 같은 폭으로 옮긴다. 연금 계좌는 총수익률만이 결과를 결정하므로 분해할 것이
 * 없다(`applyYieldPreset`의 같은 판단).
 *
 * 하한을 두지 «않는다». 「모든 위험자산 수익률이 2%p 낮다면」은 그 자체로 유효한 질문이고,
 * 저수익 자산이 음수로 내려가는 것도 그 세계의 일부다. 여기서 0으로 자르면 자산마다 다른
 * 크기의 충격을 받게 되어 이 축이 재려는 것이 흐려진다.
 */
function shiftYield(params: SimulationParams, delta: number): SimulationParams {
  const shift = <T extends { totalReturn: number }>(account: T): T =>
    ({ ...account, totalReturn: account.totalReturn + delta });

  // 키가 없는 옛 시나리오에 빈 배열을 새로 심지 않는다(applyYieldPreset의 같은 방어).
  const isaAccounts = params.isaAccounts?.map(shift);
  return {
    ...params,
    assets: (params.assets ?? []).map(shift),
    privatePensions: (params.privatePensions ?? []).map(shift),
    ...(isaAccounts ? { isaAccounts } : {}),
  };
}

// **수익률 축은 다른 축과 «같은 방식»으로 잰다 — 내 가정 대비 상대 이동이다.**
//
// 예전에는 이 세 행만 «절대 앵커»였다(안정형 5% / 중립형 7% / 공격형 9%를 통째로 갈아끼움).
// 표의 나머지 축은 전부 상대다 — 물가 ±1%p는 내 물가 가정 대비, 은퇴시점 ±3년은 내 계획
// 대비. 그런데 사용자는 「물가상승률 +1%p」 바로 옆에 놓인 「안정형 가정 (주식 5%)」이 다른
// 방식으로 측정된다고 생각할 이유가 없다.
//
// 절대 앵커는 두 가지로 틀렸다. 첫째, 같은 이름의 행이 사람마다 다른 크기의 충격을 잰다 —
// 내 가정이 12%면 안정형은 −7%p 충격이고 6%면 −1%p 충격이다. 둘째, 내 가정이 9%보다 높으면
// 세 행이 «전부» 기준선 아래로 내려가고, 실제 리포트에서 사용자는 그것을 「공격형으로
// 바꿨는데 왜 돈이 줄지」로 읽었다(known-issues 16번).
//
// **「내 가정이 시장 통념 대비 어디쯤인가」는 여기서 답할 질문이 아니다.** 그 질문의 제자리는
// 입력 화면이다 — YieldPresetHelper의 프리셋 버튼이 「지금 입력값이 이 프리셋과 같은가」를
// aria-pressed로 말하고, returnProvenance가 포트폴리오가 어느 프리셋과 일치하는지 유도한다.
// 민감도 표에서 그 질문에 답하려다 정작 민감도를 재지 못하고 있었다.
//
// YIELD_PRESET_RATES 자체는 그대로다. 이 축이 그 표를 «그만 쓰는» 것이지 표를 옮기는 것이
// 아니므로, 변동성 유도선(volatilityForStockReturn)·robustness의 가정 변형·입력 도우미는
// 한 줄도 바뀌지 않는다.
//
// 몬테카를로의 σ와 겹치지 않는다 — σ는 「기대는 맞지만 해마다 흔들린다면」이고,
// 이 두 행은 「기대 자체가 다르다면」이다.
const SCENARIO_DEFINITIONS: ScenarioDefinition[] = [
  { key: 'yieldDown', label: `수익률 -${YIELD_SHIFT_POINTS}%p`, buildParams: (p) => shiftYield(p, -YIELD_SHIFT_POINTS) },
  { key: 'yieldUp', label: `수익률 +${YIELD_SHIFT_POINTS}%p`, buildParams: (p) => shiftYield(p, YIELD_SHIFT_POINTS) },
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
  // 7개 시나리오가 **공통으로 고정한** 월 생활비. 화면과 PDF는 이 값을 반드시 밝혀야 한다 —
  // 밝히지 않으면 사용자는 자기가 입력한 목표 생활비 기준으로 표를 읽는다.
  frozenMonthlySpending: number;
  // 기준선도 같은 고정 계획에서 나온다(아래 주석 참조). 호출부가 따로 계산해 넘기지 않는다.
  baselineDepletionAge: number | null;
  baselineEndingAssets: number;
  // 시나리오의 unmetSpendingYears와 같은 식으로 센다 — 두 값을 나란히 비교해
  // "결과가 baseline과 정말 같은가"를 판정하는 화면이 있다(SensitivityAnalysisSection).
  baselineUnmetSpendingYears: number;
  /**
   * baseline(현재 가정) 자신이 어기는 확정 HARD 요구. SensitivityScenario.hardViolations와
   * 같은 판정식이다.
   *
   * **시나리오와 나란히 봐야 하는 이유.** baseline이 이미 위반 중이면, 같은 위반을 반복하는
   * 시나리오는 「이 시나리오 때문에 새로 생긴 문제」가 아니라 「오늘 계획도 이미 겪는 문제」다.
   * 화면·PDF가 이 값을 따로 밝히지 않으면 둘을 구별할 방법이 없다.
   */
  baselineHardViolations: HardRequirementAxis[];
  /**
   * 확정 HARD 요구 세 축('spendingTarget' 등)을 «켠» 목표 유형. scenarios[].hardViolations와
   * baselineHardViolations의 각 값이 실제로 어떤 목표를 가리키는지는 여기 없이는 알 수 없다
   * — resolveGoalSuccessConditions(params).hardRequirementGoals를 그대로 옮긴 값이다.
   * 화면·PDF가 위반 축을 사람이 읽는 목표 이름으로 바꿀 때 이 값과
   * hardViolationGoalTypes(goalSuccessConditions.ts)를 함께 쓴다.
   */
  hardRequirementGoals: GoalSuccessConditions['hardRequirementGoals'];
  // 화면이 "투자자산이 없어 전부 동일" 분기를 타는 근거. 이 판정도 시나리오와 같은 고정
  // 계획에서 나와야 하므로 여기서 함께 낸다 — 호출부가 다른 실행 결과로 판정하면
  // "표는 갈리는데 안내문은 동일하다고 말하는" 상태가 된다.
  baselinePlanAssetStatus: PlanAssetStatus;
  // **사용자 «자신의» 수익률 가정**(잔액가중 평균 총수익률, % 단위). 굴릴 잔액이 없으면 null.
  //
  // 수익률 3행이 절대 앵커라는 사실(위 SCENARIO_DEFINITIONS 주석)은 이 값을 함께 보여주지
  // 않으면 화면에서 «보이지 않는다». 실제 리포트에서 기준선이 14.58억인데 안정형·중립형·
  // 공격형이 전부 그 아래로 나왔고, 사용자는 「수익률을 높였는데 왜 돈이 줄지」라고 읽었다.
  // 답은 「당신의 가정이 9%보다 높기 때문」인데 화면 어디에도 그 숫자가 없었다.
  //
  // 새로 계산하지 않는다 — 몬테카를로 변동성 유도가 이미 쓰는 함수를 그대로 부른다
  // (volatilityPresets → weightedAverageTotalReturn). 같은 「내 포트폴리오의 수익률」을
  // 두 곳이 각자 재면 화면과 σ가 다른 값을 말하게 된다.
  baselineWeightedTotalReturn: number | null;
}

// 7개 시나리오(수익률 프리셋 3종/물가상승률 ±/은퇴시점 ±)를 재실행해 자산 고갈 나이가
// 얼마나 민감하게 변하는지 반환한다. 개별 시나리오가 예외를 던지면 해당 시나리오만 제외한다.
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
  const baselineUnmetSpendingYears = baseline.yearlyResults.filter(hasSpendingShortfall).length;
  const { expectancy } = params.userProfile;

  // **몬테카를로와 같은 함수로 HARD 위반을 묻는다.** runFrozenPlan이 이미 depletionAge·
  // endingAssets·(원장 기준) 생활비 부족 해 수를 냈으므로 새 시뮬레이션은 필요 없다 —
  // resolveGoalSuccessConditions·resolveHardViolations만 그 결과에 적용한다. successAge는
  // MonteCarloEngine과 같은 값(expectancy)이어야 두 경로가 "고갈"을 같은 나이로 잰다.
  const conditions = resolveGoalSuccessConditions(params);
  const toHardGoalOutcome = (
    depletionAge: number | null,
    endingAssets: number,
    unmetSpendingYears: number,
  ): HardGoalOutcome => ({
    depletionAge,
    endingAssets,
    hasSpendingShortfall: unmetSpendingYears > 0,
  });
  const hardViolationsOf = (depletionAge: number | null, endingAssets: number, unmetSpendingYears: number) =>
    resolveHardViolations(toHardGoalOutcome(depletionAge, endingAssets, unmetSpendingYears), conditions, expectancy);

  const withSortKey: (SensitivityScenario & { sortAge: number })[] = [];

  for (const def of SCENARIO_DEFINITIONS) {
    try {
      const result = runFrozenPlan(engine, mapFrozenPlan(frozen, def.buildParams));
      const depletionAge = result.depletionAge;
      const unmetSpendingYears = result.yearlyResults.filter(hasSpendingShortfall).length;
      withSortKey.push({
        key: def.key,
        label: def.label,
        depletionAge,
        deltaYears: computeDeltaYears(baselineDepletionAge, depletionAge, expectancy),
        endingAssets: result.endingAssets,
        endingAssetsDelta: result.endingAssets - baseline.endingAssets,
        unmetSpendingYears,
        hardViolations: hardViolationsOf(depletionAge, result.endingAssets, unmetSpendingYears),
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
    baselineUnmetSpendingYears,
    baselineHardViolations: hardViolationsOf(baselineDepletionAge, baseline.endingAssets, baselineUnmetSpendingYears),
    hardRequirementGoals: conditions.hardRequirementGoals,
    baselinePlanAssetStatus: resolvePlanAssetStatus(baseline, params),
    // 고정 계획이 아니라 «원본» params로 잰다. freezeSpendingPlan은 생활비만 고정하고
    // 수익률은 건드리지 않으므로 두 값은 같지만, 이 값이 답하는 질문은 「사용자가 입력한
    // 가정이 무엇인가」이므로 사용자가 준 것에서 직접 읽는다.
    baselineWeightedTotalReturn: weightedAverageTotalReturn(params),
  };
}

/**
 * 수익률 축 두 행이 «무엇을 어떻게» 바꾼 것인지 밝히는 한 문장. 화면과 PDF가 같은 문장을 쓴다.
 *
 * **가중평균과 나란히 놓을 때 정확해야 한다.** 화면은 이 문장 앞에 사용자의 잔액가중 평균
 * 총수익률(사적연금 포함)을 인쇄한다. 상대 축에서는 그 값이 곧 «기준»이므로 둘이 어긋날
 * 일이 없다 — 예전 절대 앵커에서는 「주식 5%」와 그 평균을 곧바로 견주면 어긋났고, 그래서
 * 두 축의 숫자를 모두 적어야 했다.
 *
 * 폭은 상수에서 읽는다. 여기에 숫자를 다시 적으면 YIELD_SHIFT_POINTS를 바꾸는 날 문구만
 * 옛 값으로 남는다.
 */
export function describeYieldAxisAnchors(): string {
  return `아래 수익률 2행은 입력한 모든 위험자산(사적연금 포함)의 총수익률을 `
    + `${YIELD_SHIFT_POINTS}%p씩 함께 낮추고 올린 결과이며, 위 현재 가정이 그 기준입니다.`;
}
