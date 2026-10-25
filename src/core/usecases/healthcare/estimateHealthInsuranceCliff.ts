import { SimulationYearlyResult } from '../../entities/types';
import { TaxContext } from '../tax/taxContext';

// 피부양자 자격을 잃었을 때의 건강보험료를 **금액으로** 추정한다.
//
// ## 왜 시뮬레이션 본체가 아니라 별도 추정인가
//
// 이 앱의 건보료는 "문턱 초과분에만 요율을 곱하는" 연속 함수다. 실제 제도는 피부양자
// 자격을 잃는 순간 소득 **전체**에 부과되는 계단(cliff)이라, 문턱 근처에서 실제 부담이
// 계산값보다 훨씬 크게 뛴다.
//
// 그 계단을 계산에 넣지 않는 이유는 TaxEngine.calculateComprehensiveTaxAndHealthInsuranceKRW
// 주석에 있다: ① 재산 입력이 없어 절벽 양쪽이 모두 틀리고 ② 불연속이
// findMaxSustainableValue/findMaxSustainable의 30회 이진탐색이 전제하는 단조성을 깨뜨린다.
// 두 번째는 세법 문제가 아니라 아키텍처 문제라 도입 비용이 훨씬 크다.
//
// 그래서 계산은 그대로 두고, 사용자가 실제로 알아야 할 금액만 여기서 따로 구한다.
// 시뮬레이션 결과를 읽기만 하는 순수 함수이므로 어떤 숫자도 되돌려 바꾸지 않는다.
//
// ## 반영하지 않는 것
//
// **재산·자동차 점수분은 계산하지 않는다.** 입력 자체가 없으므로 지어내지 않는다
// (확정되지 않은 숫자를 만들지 않는다는 이 저장소의 원칙). 따라서 이 추정도 실제
// 부담보다 **낮다** — 화면 문구가 그 사실을 반드시 함께 말해야 한다.
export interface HealthInsuranceCliffEstimate {
  // 부과 기준 소득이 가장 높은 해. 부담이 가장 큰 시점을 보여주는 것이 목적이므로
  // 첫 초과 연도가 아니라 최대 연도를 고른다.
  peakAge: number;
  // 아래 금액은 모두 시뮬레이션의 표시 통화 기준이다(yearlyResults가 그렇다).
  incomeBasis: number;
  // 현재 모델이 실제로 부과한 금액 = (기준소득 − 문턱) × 요율.
  currentAnnual: number;
  currentMonthly: number;
  // 피부양자 자격 상실 시 = 기준소득 전체 × 요율 (지역가입자 소득분).
  ifDependentLostAnnual: number;
  ifDependentLostMonthly: number;
  // 두 값의 차이. 문턱 × 요율과 같지만, 소비처가 다시 유도하지 않도록 실어 보낸다.
  annualIncrease: number;
}

export function estimateHealthInsuranceCliff(
  yearlyResults: readonly SimulationYearlyResult[],
  ctx: TaxContext
): HealthInsuranceCliffEstimate | null {
  // 건보료를 부과하지 않은 계획에서 "자격을 잃으면 얼마"를 말하면 화면의 다른 숫자와
  // 근거가 어긋난다. 엔진은 enableComprehensiveTax가 꺼져도 건보료를 통째로 0으로
  // 반환하므로(TaxEngine) 두 스위치를 모두 본다.
  if (!ctx.settings.enableHealthInsurance || !ctx.settings.enableComprehensiveTax) return null;

  const thresholdKRW = ctx.profile.financialIncomeThresholdKRW;
  const ratePercent = ctx.settings.healthInsuranceRate;

  let peak: SimulationYearlyResult | null = null;
  for (const year of yearlyResults) {
    // 문턱을 넘지 않으면 피부양자 자격 자체가 유지되므로 절벽이 없다.
    if (year.healthInsuranceIncomeBasis <= thresholdKRW) continue;
    if (peak === null || year.healthInsuranceIncomeBasis > peak.healthInsuranceIncomeBasis) {
      peak = year;
    }
  }
  if (peak === null) return null;

  const incomeBasis = peak.healthInsuranceIncomeBasis;
  const rate = ratePercent / 100;

  // 현재 모델 값을 year.healthInsurancePaid가 아니라 여기서 다시 계산하는 이유:
  // healthInsurancePaid는 **실제 징수액**이라 자산이 모자란 해에는 부과액보다 작다
  // (collectTax 주석). 두 금액을 나란히 비교하는 자리에서는 같은 기준(부과액)이어야
  // 차이가 "자격 상실 때문"으로만 읽힌다.
  const currentAnnual = (incomeBasis - thresholdKRW) * rate;
  const ifDependentLostAnnual = incomeBasis * rate;

  return {
    peakAge: peak.age,
    incomeBasis,
    currentAnnual,
    currentMonthly: currentAnnual / 12,
    ifDependentLostAnnual,
    ifDependentLostMonthly: ifDependentLostAnnual / 12,
    annualIncrease: ifDependentLostAnnual - currentAnnual,
  };
}
