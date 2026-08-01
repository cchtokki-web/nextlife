import { HealthcareAssumptions } from '../../entities/types';

interface HealthcareCostInput {
  healthcare: HealthcareAssumptions | undefined;
  currentAge: number;
  retirementAge: number;
  // 시뮬레이션 시작 나이(userProfile.currentAge). 명목 모드에서 "오늘 화폐가치"로 입력된
  // 의료비를 해당 연도의 명목 금액으로 환산하는 기준점이다.
  simulationStartAge: number;
  // 은퇴 후 경과 연수. 은퇴 전이면 음수다.
  yearsSinceRetirement: number;
  inflationMode: 'nominal' | 'real';
  inflationRate: number; // %
  // 생존 인원에 따른 생활비 축소 계수(spouseRules.computeSpendingFactor). 배우자
  // 미설정이면 항상 1이다. 의료비도 생활비와 같은 규칙으로 줄어야 한다.
  spendingFactor: number;
}

// 해당 연도의 추가 의료비 지출(생활비와 별개 라인).
//
// 은퇴 전에는 0이다 — 이 앱은 근로소득을 모델링하지 않으므로 은퇴 전 의료비를
// 넣으면 자산이 부당하게 깎인다(실제로는 급여에서 나가는 돈이다).
//
// 실질 모드에서는 물가 초과분만 적용한다. 시뮬레이션 전체가 오늘 화폐가치로
// 표시되므로, 여기서도 "물가보다 얼마나 더 빨리 오르는가"만 반영해야 일관된다.
//
// spendingFactor(생존 인원에 따른 축소 계수)를 곱한다. 의료비는 생활비와 같은
// 성격의 반복 가구 지출이므로 한 명만 남으면 함께 줄어야 한다. 곱하지 않으면
// 연도 루프가 둘 중 늦게 죽는 쪽까지 도는 탓에(computeHouseholdEndAge) 본인 사후에도
// 본인 기준 의료비·장기요양비가 전액 계속 인출되고, shockAge가 본인 기대수명을
// 넘으면 사망 후에 쇼크가 발생한다.
export function computeAnnualHealthcareCost({
  healthcare, currentAge, retirementAge, simulationStartAge, yearsSinceRetirement,
  inflationMode, inflationRate, spendingFactor,
}: HealthcareCostInput): number {
  if (!healthcare || !healthcare.enabled) return 0;
  if (currentAge < retirementAge) return 0;

  const effectiveGrowthRate = inflationMode === 'real'
    ? healthcare.costGrowthRate - inflationRate
    : healthcare.costGrowthRate;
  // 실효 증가율이 -100% 이하면 Math.pow(음수, y)가 연도마다 부호를 뒤집어
  // 음수 의료비(= 공짜 돈)를 만든다. 밑을 0에서 잘라 막는다.
  const growthBase = Math.max(0, 1 + effectiveGrowthRate / 100);
  const growthFactor = Math.pow(growthBase, Math.max(0, yearsSinceRetirement));

  // 명목 모드에서 오늘 화폐가치 입력을 그 시점의 명목 금액으로 올리는 계수.
  // baseMonthlyCost는 "은퇴 시점 월 의료비"를 오늘 화폐가치로 받고 growthFactor가
  // yearsSinceRetirement = 0부터 복리를 시작하므로, 은퇴까지의 물가상승분이 아무 데도
  // 반영되지 않는다. 주변의 모든 명목 금액(목표 생활비·국민연금 등)은 시뮬레이션
  // 시작 나이부터 인플레이션을 누적하므로 의료비만 (1+물가)^(은퇴나이-현재나이)만큼
  // 작아진다. 실질 모드에서는 모든 금액이 오늘 화폐가치이므로 계수가 1이다.
  const nominalFactorAt = (age: number): number =>
    inflationMode === 'nominal'
      ? Math.pow(Math.max(0, 1 + inflationRate / 100), Math.max(0, age - simulationStartAge))
      : 1;
  const retirementNominalFactor = nominalFactorAt(retirementAge);

  let annual = healthcare.baseMonthlyCost * 12 * growthFactor * retirementNominalFactor;

  // 장기요양비의 기준 시점은 은퇴가 아니라 "장기요양이 시작되는 나이"다.
  //
  // 세 항목이 같은 규약을 쓴다: **사용자가 입력하는 금액은 그 항목이 시작되는 시점의
  // 오늘 화폐가치 금액이며, 시작 이후에는 의료비 증가율로 오른다.** 기본 의료비의 시작은
  // 은퇴 시점(라벨도 "은퇴 시점 월 의료비"), 장기요양비는 longTermCareStartAge, 쇼크는
  // shockAge(일회성이라 이후 증가가 없다)다.
  //
  // 은퇴 시점 기준으로 해석하던 예전 규약은 기본값(은퇴 60 / 시작 80 / 증가율 5%)에서
  // 입력한 150만원을 발생 시점에 1.05^20 = 2.65배로 부풀렸고, 같은 함수의 쇼크가 정반대
  // 규약을 쓰고 있어 한 화면의 두 입력이 서로 다른 의미를 갖고 있었다. 사용자는 요양
  // 비용을 "지금 요양원이 얼마인가"로 조사해 넣지, "내 은퇴 시점에 얼마일까"로 넣지 않는다.
  if (healthcare.longTermCareEnabled && currentAge >= healthcare.longTermCareStartAge) {
    const yearsSinceLongTermCare = Math.max(0, currentAge - healthcare.longTermCareStartAge);
    annual += healthcare.longTermCareMonthlyCost * 12
      * Math.pow(growthBase, yearsSinceLongTermCare)
      * nominalFactorAt(healthcare.longTermCareStartAge);
  }

  // 쇼크는 "오늘 화폐가치의 일회성 목돈"으로 정의한다. 의료비 증가율을 곱하지 않는 이유는
  // 사용자가 입력하는 값이 "그 나이에 실제로 나갈 금액(오늘 기준)"이기 때문이다.
  // 다만 명목 모드에서는 그 해의 다른 모든 금액과 같은 화폐가치로 맞춰야 하므로
  // 발생 나이까지의 물가상승분은 곱한다(곱하지 않으면 쇼크만 홀로 과소 계상된다).
  if (healthcare.shockEnabled && currentAge === healthcare.shockAge) {
    annual += healthcare.shockAmount * nominalFactorAt(currentAge);
  }

  return annual * spendingFactor;
}
