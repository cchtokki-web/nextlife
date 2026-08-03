import {
  SimulationParams,
  SimulationResult,
  SimulationYearlyResult,
  UtilityAxis,
  UtilityBreakdown,
  UtilityConfig,
  UtilityRaws,
} from '../../entities/types';
import { DEFAULT_UTILITY_CONFIG } from './utilityWeights';
import { isMaximizeBequestStrategy } from '../strategy/compileStrategy';
import { sumTotalTaxesAndLevies } from '../tax/annualTaxTotals';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function stdev(values: number[]): number {
  if (values.length === 0) return 0;
  const avg = mean(values);
  const variance = mean(values.map((v) => (v - avg) ** 2));
  return Math.sqrt(variance);
}

function sum(values: number[]): number {
  return values.reduce((s, v) => s + v, 0);
}

// 해당 연도의 목표 연간 생활비(인플레이션 + 가구 규모 반영). SimulationEngine의 목표 생활비
// 산출 로직과 동일한 규칙(명목: 매년 물가상승률 복리 반영 / 실질: 고정)을 따른다.
//
// 가구 규모 계수는 여기서 다시 유도하지 않고 엔진이 실제로 곱한 값(r.spendingFactor)을 그대로
// 쓴다 — 규칙을 두 곳에 두면 반드시 어긋나고, 이 주석의 "동일한 규칙" 문구가 배우자 기능
// 추가 때 한 번 stale해진 것이 그 증거다.
//
// 의료비(r.healthcareSpending)도 목표에 더한다. 엔진이 의료비를 spending에 합산하므로,
// 분모에 더하지 않으면 의료비를 켠 계획이 "목표를 초과 소비했다"로 잘못 보상받는다
// (consumptionYearUtility가 ratio > 1을 보너스로 처리한다). 의료비는 생활수준을 높이는
// 재량 소비가 아니라 반드시 나가는 비용이므로 목표(=필요) 쪽에 들어가는 것이 맞다.
// 이미 엔진이 inflationMode를 반영해 계산한 실제 지출액이라 물가 보정을 다시 적용하지 않는다.
function targetAnnualSpendingForYear(params: SimulationParams, r: SimulationYearlyResult): number {
  const { userProfile, inflationRate = 2, inflationMode = 'real' } = params;
  const yearIndex = r.age - userProfile.currentAge;
  const base = userProfile.targetMonthlySpending * 12 * r.spendingFactor;
  const target = inflationMode === 'nominal'
    ? base * Math.pow(1 + inflationRate / 100, yearIndex)
    : base;
  return target + r.healthcareSpending;
}

// 목표 대비 소비 충족률(ratio)의 연도별 효용. 부족분은 볼록(convex) 페널티로 강하게 반영하고,
// 초과분은 한계효용 체감(√)으로 완만하게만 보상한다.
function consumptionYearUtility(ratio: number): number {
  if (ratio >= 1) {
    return Math.min(1.3, 1 + 0.3 * Math.sqrt(ratio - 1));
  }
  return Math.pow(Math.max(0, ratio), 1.5);
}

function computeConsumptionRaw(params: SimulationParams, retirementYears: SimulationYearlyResult[]): number {
  if (retirementYears.length === 0) return 0;

  const ratios = retirementYears.map((r) => {
    const target = targetAnnualSpendingForYear(params, r);
    return target > 0 ? r.spending / target : 1;
  });

  const avgUtility = mean(ratios.map(consumptionYearUtility));
  const normalized = clamp(avgUtility / 1.3, 0, 1);

  const volatility = stdev(ratios);
  const stabilityFactor = clamp(1 - volatility, 0, 1);

  return normalized * (0.85 + 0.15 * stabilityFactor);
}

function computeDepletionSafetyRaw(params: SimulationParams, result: SimulationResult): number {
  const { retirementAge } = params.userProfile;
  if (result.depletionAge === null) return 1;
  if (result.depletionAge <= retirementAge) return 0;

  // 본인 기대수명이 아니라 가구 종료 나이로 정규화한다. 본인 기대수명으로 나누면
  // 배우자 단독 생존 기간에 고갈되는 계획도 ratio > 1이 되어 clamp에 걸려 "고갈 없음"
  // 조기 반환과 바이트 단위로 같은 만점이 나온다 — 파산 계획이 만점을 받는다.
  //
  // 규칙을 다시 유도(computeHouseholdEndAge 재호출)하지 않고 엔진이 결과에 실어 보낸
  // 값을 그대로 쓴다. depletionAge가 바로 그 루프에서 판정된 값이므로 분자와 분모가
  // 반드시 같은 기간을 가리켜야 하고, 재유도는 두 값이 어긋날 여지를 남긴다
  // (SimulationResult.householdEndAge가 존재하는 이유가 이것이다).
  const span = result.householdEndAge - retirementAge;
  if (span <= 0) return 0;
  return clamp((result.depletionAge - retirementAge) / span, 0, 1);
}

// ratio(실제/적정)가 1 이하면 완만하게, 1을 초과하면(과다 잔여) 지수적으로 감점한다.
// 선형 감쇠 대신 지수 감쇠를 쓰는 이유: ratio가 매우 큰 값들(예: 3배 vs 15배 과다) 사이에서도
// 0으로 뭉개지지 않고 상대적 크기 차이가 계속 반영되어야 하기 때문이다.
function bellShapedAdequacyRaw(ratio: number, baseFloor: number, excessDecayRate: number): number {
  if (ratio <= 1) return baseFloor + (1 - baseFloor) * ratio;
  return Math.exp(-excessDecayRate * (ratio - 1));
}

// "최대 상속"을 고른 사용자에게 쓰는 채점 곡선. 종형 곡선은 적정선을 넘으면 감점하므로
// "가능한 한 많이 남기는" 전략에 그대로 쓰면 많이 남길수록 점수가 깎여 옵션 이름과
// 정반대로 동작한다. 단조증가하되 상한이 필요하므로 포화 곡선 1 - exp(-k * ratio)를 쓴다:
// 0에서 시작해 1로 수렴하므로 다른 축과 같은 0~1 정규화를 유지하고, 상속 한 축이 무한히
// 커져 총점을 지배하는 일이 없다.
//
// k = 0.35(≈ ln2 / 2)는 "적정선(월생활비 24개월치)의 2배를 남기면 절반 점수"라는 앵커에서
// 나왔다. 이 값이면 적정선의 6배에서 약 0.88, 10배에서 약 0.97로, 현실적인 잔여자산
// 구간 전체에서 기울기가 살아 있어 RecommendationEngine이 후보들을 상속 관점으로
// 서열화할 수 있다. k를 크게 잡으면(예: ln2) 2~3배에서 이미 포화해 후보 간 차이가 사라진다.
const MAXIMIZE_BEQUEST_SATURATION_K = 0.35;

function monotonicAdequacyRaw(ratio: number): number {
  return 1 - Math.exp(-MAXIMIZE_BEQUEST_SATURATION_K * Math.max(0, ratio));
}

// "연금 활용도"는 사적연금 계좌 잔액의 과다/과소 여부가 아니라, 국민연금 수급 여부·사적연금
// 실인출 활용도·저율과세 한도 준수도를 종합해 실제 "연금을 얼마나 잘 활용했는지"를 측정한다.
// 사망 시 잔여자산이 과다한지는 이미 computeBequestAdequacyRaw가 endingAssets(사적연금 포함
// 전체 자산)로 평가하므로, 여기서 사적연금 잔액을 다시 감점하면 이중 페널티가 된다.
function computePensionUtilizationRaw(
  params: SimulationParams,
  retirementYears: SimulationYearlyResult[],
  cfg: UtilityConfig
): number {
  if (retirementYears.length === 0) return 0;

  const yearsWithNationalPension = retirementYears.filter((r) => r.nationalPensionIncome > 0).length;
  const nationalRaw =
    params.nationalPension.expectedMonthlyAmount > 0 ? yearsWithNationalPension / retirementYears.length : 1;

  const privatePensions = params.privatePensions ?? [];
  const yearsWithPrivateWithdrawal = retirementYears.filter((r) => r.privatePensionIncome > 0).length;
  const privateWithdrawalRaw = privatePensions.length > 0 ? yearsWithPrivateWithdrawal / retirementYears.length : 0;

  const withdrawalYears = retirementYears.filter((r) => r.privatePensionIncome > 0 || r.pensionTaxPaid > 0);
  let taxEfficiencyRaw = 1;
  if (withdrawalYears.length > 0) {
    const totalNet = sum(withdrawalYears.map((r) => r.privatePensionIncome));
    const totalTax = sum(withdrawalYears.map((r) => r.pensionTaxPaid));
    const effectiveRate = totalNet + totalTax > 0 ? totalTax / (totalNet + totalTax) : 0;
    taxEfficiencyRaw = clamp(1 - effectiveRate / cfg.privatePensionEffectiveTaxCeiling, 0, 1);
  }

  const w = cfg.pensionUtilizationSubWeights;
  return clamp(
    nationalRaw * w.nationalPension +
      privateWithdrawalRaw * w.privatePensionWithdrawal +
      taxEfficiencyRaw * w.privatePensionTaxEfficiency,
    0,
    1
  );
}

// 적정 잔여자산(= 월 목표생활비 * appropriateBequestMonths). 사용자가 목표 금액을 지정하지
// 않았을 때의 기준선이며 'maximize'의 ratio 분모이기도 하다.
function appropriateBequestBalance(params: SimulationParams, cfg: UtilityConfig): number {
  return params.userProfile.targetMonthlySpending * cfg.appropriateBequestMonths;
}

// 분모가 0(목표 생활비 미입력)이면 비율을 정의할 수 없다. 잔여자산이 있으면 "적정선의 2배"로
// 간주하던 기존 폴백을 그대로 유지한다.
function bequestRatio(endingAssets: number, appropriateBalance: number): number {
  if (appropriateBalance > 0) return endingAssets / appropriateBalance;
  return endingAssets > 0 ? 2 : 0;
}

function computeBequestAdequacyRaw(params: SimulationParams, result: SimulationResult, cfg: UtilityConfig): number {
  const { targetBequest } = params.userProfile;

  // "최대 상속" 판정이 가장 먼저다. compileStrategy는 이 전략에서 targetBequest 키를 지우지만,
  // 컴파일을 거치지 않은 params(레거시 저장값 등)에는 옛 금액이 남아 있을 수 있어 아래
  // targetBequest 분기에 먼저 걸리면 전략과 다른 곡선으로 채점된다.
  if (isMaximizeBequestStrategy(params)) {
    return monotonicAdequacyRaw(bequestRatio(result.endingAssets, appropriateBequestBalance(params, cfg)));
  }

  // 사용자가 명시적으로 목표 상속자산을 지정한 경우: 0원("다 쓰고 가기")은 일반 공식(분모 0)으로
  // 표현할 수 없는 별도 케이스라 분리한다 — 잔여자산이 0 이하면 목표를 정확히 달성한 것이므로
  // 만점, 남으면 그만큼(연 목표생활비 대비 배수) 초과로 간주해 감점한다.
  if (targetBequest !== undefined && targetBequest <= 0) {
    if (result.endingAssets <= 0) return 1;
    const excessScale = params.userProfile.targetMonthlySpending > 0 ? params.userProfile.targetMonthlySpending * 12 : 1;
    return bellShapedAdequacyRaw(1 + result.endingAssets / excessScale, 0.7, 0.4);
  }

  const appropriateBalance =
    targetBequest !== undefined ? targetBequest : appropriateBequestBalance(params, cfg);
  return bellShapedAdequacyRaw(bequestRatio(result.endingAssets, appropriateBalance), 0.7, 0.4);
}

// 세부담 비율(총세금 / 총소득)로 세금 효율을 채점한다.
//
// 분모에서 기타소득을 뺀다. 이 시뮬레이터는 기타소득에 세금을 매기지 않으므로
// (AssetFormSection이 "세후 실수령액"을 입력받기로 한 계약), 분모에 넣으면 세금이 붙지 않는
// 소득이 비율을 희석시켜 점수를 부풀린다. 월세·임대소득을 입력한 사용자일수록 세금 효율이
// 좋아지는 셈인데, 그 사용자가 실제로 세금을 덜 내는 것은 아니다.
//
// preTaxTotalIncome 자체는 건드리지 않는다 — YearlyChart가 "세전 총소득"으로 그리고
// computeExpertAnalytics가 평균을 내므로, 필드의 정의를 바꾸면 화면 쪽이 틀어진다.
// 여기서 분모만 좁히는 것이 국소적이고 옳다.
function computeTaxEfficiencyRaw(yearlyResults: SimulationYearlyResult[], cfg: UtilityConfig): number {
  const totalTaxPaid = sumTotalTaxesAndLevies(yearlyResults);
  const totalGrossIncome = sum(yearlyResults.map((r) => r.preTaxTotalIncome - r.otherIncome));
  if (totalGrossIncome <= 0) return 1;

  const taxRatio = totalTaxPaid / totalGrossIncome;
  return clamp(1 - taxRatio / cfg.taxBurdenCeiling, 0, 1);
}

function computeTaxationRiskRaw(yearlyResults: SimulationYearlyResult[], cfg: UtilityConfig): number {
  if (yearlyResults.length === 0) return 1;

  const warningRatio = yearlyResults.filter((r) => r.hasTaxWarning).length / yearlyResults.length;
  const healthInsuranceTotal = sum(yearlyResults.map((r) => r.healthInsurancePaid));
  const totalIncomeAll = sum(yearlyResults.map((r) => r.totalIncome));
  const healthInsuranceRatio = totalIncomeAll > 0 ? healthInsuranceTotal / totalIncomeAll : 0;

  const penalty = 0.7 * warningRatio + 0.3 * clamp(healthInsuranceRatio / cfg.healthInsuranceCeiling, 0, 1);
  return clamp(1 - penalty, 0, 1);
}

// 6개 축의 순서. 채점·순회에서 필드를 손으로 나열하지 않도록 한 곳에 둔다.
export const UTILITY_AXES = [
  'consumption',
  'depletionSafety',
  'pensionUtilization',
  'taxEfficiency',
  'taxationRisk',
  'bequestAdequacy',
] as const satisfies readonly UtilityAxis[];

// 축을 추가하고 UTILITY_AXES에 넣는 것을 잊으면 그 축은 score 합산에서 조용히 빠진다
// (components에는 있는데 총점에는 없는 상태 — 화면에서 "항목 합 ≠ 총점"으로 나타난다).
// annualTaxTotals가 세금 필드에 쓰는 것과 같은 컴파일 타임 누락 검사다.
type MissingUtilityAxes = Exclude<UtilityAxis, (typeof UTILITY_AXES)[number]>;
type UtilityAxesExhaustive = MissingUtilityAxes extends never
  ? true
  : ['UTILITY_AXES에 빠진 축이 있습니다', MissingUtilityAxes];
const _utilityAxesAreExhaustive: UtilityAxesExhaustive = true;
void _utilityAxesAreExhaustive;

const ZERO_RAWS: UtilityRaws = {
  consumption: 0,
  depletionSafety: 0,
  pensionUtilization: 0,
  taxEfficiency: 0,
  taxationRisk: 0,
  bequestAdequacy: 0,
};

// 가중치를 곱하기 전의 원점수 6개(각 0~1).
//
// **이 값들은 cfg.weights와 무관하다.** 목표(objective)가 바꾸는 것은 weights뿐이고
// (OBJECTIVE_WEIGHT_PRESETS), 나머지 설정은 compileStrategy가 UTILITY_CONFIG_REST로 고정한다.
// 따라서 raw를 한 번 계산해 두면 **같은 시뮬레이션 결과를 5개 목표 전부로 재시뮬 없이
// 채점**할 수 있다 — 목표 우선순위 축과 강건성 모드가 서 있는 지렛대가 이것이다.
//
// computeLifetimeUtility가 돌려주는 components로는 이걸 대신할 수 없다. 그쪽은 이미
// Math.round(raw × weight)라서 weight로 나눠도 반올림 손실 때문에 원본이 복원되지 않고,
// weight가 0인 축은 아예 정보가 사라진다.
export function computeUtilityRaws(
  result: SimulationResult,
  params: SimulationParams,
  cfg: UtilityConfig = DEFAULT_UTILITY_CONFIG
): UtilityRaws {
  if (!result.yearlyResults || result.yearlyResults.length === 0) return { ...ZERO_RAWS };

  const retirementYears = result.yearlyResults.filter((r) => r.age >= params.userProfile.retirementAge);

  return {
    consumption: computeConsumptionRaw(params, retirementYears),
    depletionSafety: computeDepletionSafetyRaw(params, result),
    pensionUtilization: computePensionUtilizationRaw(params, retirementYears, cfg),
    taxEfficiency: computeTaxEfficiencyRaw(result.yearlyResults, cfg),
    taxationRisk: computeTaxationRiskRaw(result.yearlyResults, cfg),
    bequestAdequacy: computeBequestAdequacyRaw(params, result, cfg),
  };
}

// 원점수에 가중치를 곱해 최종 점수로 만든다. 축별 반올림 후 합산하는 순서를 지킨다 —
// 합산 후 반올림하면 components의 합과 score가 어긋난다(화면이 둘을 나란히 보여준다).
export function scoreUtilityRaws(raws: UtilityRaws, weights: UtilityConfig['weights']): UtilityBreakdown {
  const components = {
    consumption: Math.round(raws.consumption * weights.consumption),
    depletionSafety: Math.round(raws.depletionSafety * weights.depletionSafety),
    pensionUtilization: Math.round(raws.pensionUtilization * weights.pensionUtilization),
    taxEfficiency: Math.round(raws.taxEfficiency * weights.taxEfficiency),
    taxationRisk: Math.round(raws.taxationRisk * weights.taxationRisk),
    bequestAdequacy: Math.round(raws.bequestAdequacy * weights.bequestAdequacy),
  };

  const score = clamp(
    UTILITY_AXES.reduce((total, axis) => total + components[axis], 0),
    0,
    100
  );

  return { score, components };
}

export function computeLifetimeUtility(
  result: SimulationResult,
  params: SimulationParams,
  cfg: UtilityConfig = DEFAULT_UTILITY_CONFIG
): UtilityBreakdown {
  return scoreUtilityRaws(computeUtilityRaws(result, params, cfg), cfg.weights);
}
