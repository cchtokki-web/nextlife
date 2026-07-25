import {
  SimulationParams,
  SimulationResult,
  SimulationYearlyResult,
  UtilityBreakdown,
  UtilityConfig,
} from '../../entities/types';
import { DEFAULT_UTILITY_CONFIG } from './utilityWeights';

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

// 해당 연도의 목표 연간 생활비(인플레이션 반영). SimulationEngine의 목표 생활비 산출 로직과
// 동일한 규칙(명목: 매년 물가상승률 복리 반영 / 실질: 고정)을 따른다.
function targetAnnualSpendingForYear(params: SimulationParams, r: SimulationYearlyResult): number {
  const { userProfile, inflationRate = 2, inflationMode = 'real' } = params;
  const yearIndex = r.age - userProfile.currentAge;
  return inflationMode === 'nominal'
    ? userProfile.targetMonthlySpending * 12 * Math.pow(1 + inflationRate / 100, yearIndex)
    : userProfile.targetMonthlySpending * 12;
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
  const { retirementAge, expectancy } = params.userProfile;
  if (result.depletionAge === null) return 1;
  if (result.depletionAge <= retirementAge) return 0;

  const span = expectancy - retirementAge;
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

function computeBequestAdequacyRaw(params: SimulationParams, result: SimulationResult, cfg: UtilityConfig): number {
  const { targetBequest } = params.userProfile;

  // 사용자가 명시적으로 목표 상속자산을 지정한 경우: 0원("다 쓰고 가기")은 일반 공식(분모 0)으로
  // 표현할 수 없는 별도 케이스라 분리한다 — 잔여자산이 0 이하면 목표를 정확히 달성한 것이므로
  // 만점, 남으면 그만큼(연 목표생활비 대비 배수) 초과로 간주해 감점한다.
  if (targetBequest !== undefined && targetBequest <= 0) {
    if (result.endingAssets <= 0) return 1;
    const excessScale = params.userProfile.targetMonthlySpending > 0 ? params.userProfile.targetMonthlySpending * 12 : 1;
    return bellShapedAdequacyRaw(1 + result.endingAssets / excessScale, 0.7, 0.4);
  }

  const appropriateBalance =
    targetBequest !== undefined ? targetBequest : params.userProfile.targetMonthlySpending * cfg.appropriateBequestMonths;
  const ratio = appropriateBalance > 0 ? result.endingAssets / appropriateBalance : (result.endingAssets > 0 ? 2 : 0);
  return bellShapedAdequacyRaw(ratio, 0.7, 0.4);
}

function computeTaxEfficiencyRaw(yearlyResults: SimulationYearlyResult[], cfg: UtilityConfig): number {
  const totalTaxPaid = sum(
    yearlyResults.map(
      (r) => r.dividendTaxPaid + r.pensionTaxPaid + r.nationalPensionTaxPaid + r.healthInsurancePaid + r.comprehensiveTaxPaid
    )
  );
  const totalGrossIncome = sum(yearlyResults.map((r) => r.preTaxTotalIncome));
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

export function computeLifetimeUtility(
  result: SimulationResult,
  params: SimulationParams,
  cfg: UtilityConfig = DEFAULT_UTILITY_CONFIG
): UtilityBreakdown {
  if (!result.yearlyResults || result.yearlyResults.length === 0) {
    return {
      score: 0,
      components: {
        consumption: 0,
        depletionSafety: 0,
        pensionUtilization: 0,
        taxEfficiency: 0,
        taxationRisk: 0,
        bequestAdequacy: 0,
      },
    };
  }

  const retirementYears = result.yearlyResults.filter((r) => r.age >= params.userProfile.retirementAge);

  const consumption = Math.round(computeConsumptionRaw(params, retirementYears) * cfg.weights.consumption);
  const depletionSafety = Math.round(computeDepletionSafetyRaw(params, result) * cfg.weights.depletionSafety);
  const pensionUtilization = Math.round(computePensionUtilizationRaw(params, retirementYears, cfg) * cfg.weights.pensionUtilization);
  const taxEfficiency = Math.round(computeTaxEfficiencyRaw(result.yearlyResults, cfg) * cfg.weights.taxEfficiency);
  const taxationRisk = Math.round(computeTaxationRiskRaw(result.yearlyResults, cfg) * cfg.weights.taxationRisk);
  const bequestAdequacy = Math.round(computeBequestAdequacyRaw(params, result, cfg) * cfg.weights.bequestAdequacy);

  const score = clamp(
    consumption + depletionSafety + pensionUtilization + taxEfficiency + taxationRisk + bequestAdequacy,
    0,
    100
  );

  return {
    score,
    components: {
      consumption,
      depletionSafety,
      pensionUtilization,
      taxEfficiency,
      taxationRisk,
      bequestAdequacy,
    },
  };
}
