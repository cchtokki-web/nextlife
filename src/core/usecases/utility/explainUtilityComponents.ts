import { SimulationParams, SimulationResult, UtilityAxis, UtilityConfig } from '../../entities/types';
import { DEFAULT_UTILITY_CONFIG } from './utilityWeights';
import { explainBequestAdequacy, formatManwon } from './utilityAnalysis';
import { sumTotalTaxesAndLevies } from '../tax/annualTaxTotals';

export type UtilityComponentExplanations = Record<UtilityAxis, string>;

// 효용 막대는 `6/25`, `0/15`처럼 점수만 보여줄 뿐 **왜 그 점수인지**를 말하지 않는다.
// 사용자가 개선할 수 있으려면 그 숫자를 만든 입력이 보여야 한다.
//
// 새 계산을 하지 않는다. UtilityEngine의 raw 함수들이 읽는 것과 **같은 필드**를 읽어 문장으로
// 옮길 뿐이다 — 산식을 여기서 다시 유도하면 점수와 설명이 어긋난다(그러면 설명이 없느니만
// 못하다). 문장은 근거가 되는 수치를 반드시 포함한다.
export function explainUtilityComponents(
  params: SimulationParams,
  result: SimulationResult,
  cfg: UtilityConfig = DEFAULT_UTILITY_CONFIG
): UtilityComponentExplanations {
  const { yearlyResults } = result;
  const { retirementAge } = params.userProfile;
  const retirementYears = yearlyResults.filter((r) => r.age >= retirementAge);

  return {
    consumption: explainConsumption(params, retirementYears),
    depletionSafety: explainDepletionSafety(params, result, retirementYears.length),
    pensionUtilization: explainPensionUtilization(params, retirementYears),
    taxEfficiency: explainTaxEfficiency(yearlyResults),
    taxationRisk: explainTaxationRisk(yearlyResults),
    bequestAdequacy: explainBequestAdequacy(params, result, cfg),
  };
}

type YearlyResults = SimulationResult['yearlyResults'];

// computeConsumptionRaw는 연도별 (실제 지출 / 목표 지출) 비율의 효용 평균을 쓴다.
// 화면에는 그 비율을 만든 두 금액을 월 단위로 보여주는 것이 가장 읽기 쉽다.
function explainConsumption(params: SimulationParams, retirementYears: YearlyResults): string {
  if (retirementYears.length === 0) return '은퇴 후 구간이 없어 소비를 평가할 수 없습니다.';

  const avgActualMonthly =
    retirementYears.reduce((sum, r) => sum + r.spending, 0) / retirementYears.length / 12;
  const avgTargetMonthly =
    retirementYears.reduce(
      (sum, r) => sum + params.userProfile.targetMonthlySpending + r.healthcareSpending / 12,
      0
    ) / retirementYears.length;

  if (avgTargetMonthly <= 0) return '목표 생활비가 설정되지 않아 소비 충족도를 계산할 수 없습니다.';

  const rate = Math.round((avgActualMonthly / avgTargetMonthly) * 100);
  return `은퇴 후 목표 월 ${formatManwon(avgTargetMonthly)} 대비 실제 소비는 평균 월 ${formatManwon(avgActualMonthly)}(${rate}%)입니다.`;
}

function explainDepletionSafety(
  params: SimulationParams,
  result: SimulationResult,
  retirementYearCount: number
): string {
  const { retirementAge, expectancy } = params.userProfile;
  const { depletionAge } = result;

  if (depletionAge === null) {
    return `${expectancy}세까지 자산이 고갈되지 않아 만점입니다.`;
  }
  // 은퇴 시점 이전에 이미 0이면 자산으로 메울 수 있는 기간 자체가 없다(raw = 0).
  if (depletionAge <= retirementAge) {
    return `은퇴 시점에 이미 인출할 자산이 없어, 은퇴 후 ${retirementYearCount}년 동안 자산으로 메울 수 있는 기간이 없습니다.`;
  }
  const span = expectancy - retirementAge;
  const survived = depletionAge - retirementAge;
  return `은퇴 후 ${span}년 중 ${survived}년까지만 자산으로 버티고 ${depletionAge}세에 고갈됩니다.`;
}

// computePensionUtilizationRaw의 세 서브축(국민연금 수급 연수 / 사적연금 실인출 연수 /
// 저율과세 한도 준수도) 중 사용자가 손댈 수 있는 앞의 둘을 말한다.
function explainPensionUtilization(params: SimulationParams, retirementYears: YearlyResults): string {
  if (retirementYears.length === 0) return '은퇴 후 구간이 없어 연금 활용도를 평가할 수 없습니다.';

  const total = retirementYears.length;
  const parts: string[] = [];

  if ((params.nationalPension?.expectedMonthlyAmount ?? 0) > 0) {
    const years = retirementYears.filter((r) => r.nationalPensionIncome > 0).length;
    parts.push(`은퇴 후 ${total}년 중 ${years}년 국민연금을 받습니다`);
  } else {
    parts.push('국민연금 수령액이 등록돼 있지 않습니다');
  }

  if ((params.privatePensions?.length ?? 0) > 0) {
    const years = retirementYears.filter((r) => r.privatePensionIncome > 0).length;
    parts.push(`사적연금은 ${years}년 인출합니다`);
  } else {
    parts.push('사적연금은 등록돼 있지 않습니다');
  }

  return `${parts.join('. ')}.`;
}

function explainTaxEfficiency(yearlyResults: YearlyResults): string {
  const totalTaxPaid = sumTotalTaxesAndLevies(yearlyResults);
  // 분모에서 기타소득을 빼는 것은 computeTaxEfficiencyRaw와 같은 규칙이다 — 이 시뮬레이터는
  // 기타소득을 세후 실수령액으로 받으므로 분모에 넣으면 비율이 희석된다.
  const totalGrossIncome = yearlyResults.reduce((sum, r) => sum + r.preTaxTotalIncome - r.otherIncome, 0);

  if (totalGrossIncome <= 0) return '과세 대상 소득이 없어 세금 부담이 발생하지 않습니다.';

  const rate = (totalTaxPaid / totalGrossIncome) * 100;
  return `평생 세전 소득 ${formatManwon(totalGrossIncome)} 중 약 ${rate.toFixed(1)}%(${formatManwon(totalTaxPaid)})를 세금·건강보험료로 냅니다.`;
}

function explainTaxationRisk(yearlyResults: YearlyResults): string {
  if (yearlyResults.length === 0) return '평가할 연도가 없습니다.';

  const warningYears = yearlyResults.filter((r) => r.hasTaxWarning).length;
  const healthInsuranceTotal = yearlyResults.reduce((sum, r) => sum + r.healthInsurancePaid, 0);

  if (warningYears === 0 && healthInsuranceTotal === 0) {
    return '금융소득종합과세 위험 연도가 없고 건강보험료 부담도 발생하지 않습니다.';
  }
  if (warningYears === 0) {
    return `금융소득종합과세 위험 연도는 없고, 평생 건강보험료는 ${formatManwon(healthInsuranceTotal)}입니다.`;
  }
  return `배당·이자소득이 연 2,000만원을 넘는 해가 ${warningYears}년 있어 금융소득종합과세 위험이 있습니다.`;
}
