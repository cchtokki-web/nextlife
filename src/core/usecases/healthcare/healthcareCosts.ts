import { HealthcareAssumptions } from '../../entities/types';

interface HealthcareCostInput {
  healthcare: HealthcareAssumptions | undefined;
  currentAge: number;
  retirementAge: number;
  // 은퇴 후 경과 연수. 은퇴 전이면 음수다.
  yearsSinceRetirement: number;
  inflationMode: 'nominal' | 'real';
  inflationRate: number; // %
}

// 해당 연도의 추가 의료비 지출(생활비와 별개 라인).
//
// 은퇴 전에는 0이다 — 이 앱은 근로소득을 모델링하지 않으므로 은퇴 전 의료비를
// 넣으면 자산이 부당하게 깎인다(실제로는 급여에서 나가는 돈이다).
//
// 실질 모드에서는 물가 초과분만 적용한다. 시뮬레이션 전체가 오늘 화폐가치로
// 표시되므로, 여기서도 "물가보다 얼마나 더 빨리 오르는가"만 반영해야 일관된다.
export function computeAnnualHealthcareCost({
  healthcare, currentAge, retirementAge, yearsSinceRetirement, inflationMode, inflationRate,
}: HealthcareCostInput): number {
  if (!healthcare || !healthcare.enabled) return 0;
  if (currentAge < retirementAge) return 0;

  const effectiveGrowthRate = inflationMode === 'real'
    ? healthcare.costGrowthRate - inflationRate
    : healthcare.costGrowthRate;
  const growthFactor = Math.pow(1 + effectiveGrowthRate / 100, Math.max(0, yearsSinceRetirement));

  let annual = healthcare.baseMonthlyCost * 12 * growthFactor;

  if (healthcare.longTermCareEnabled && currentAge >= healthcare.longTermCareStartAge) {
    annual += healthcare.longTermCareMonthlyCost * 12 * growthFactor;
  }

  // 쇼크는 "오늘 화폐가치의 일회성 목돈"으로 정의한다. 증가율을 곱하지 않는 이유는
  // 사용자가 입력하는 값이 "그 나이에 실제로 나갈 금액"이기 때문이다.
  if (healthcare.shockEnabled && currentAge === healthcare.shockAge) {
    annual += healthcare.shockAmount;
  }

  return annual;
}
