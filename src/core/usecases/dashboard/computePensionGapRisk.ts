import { SimulationParams, SimulationResult } from '../../entities/types';
import { computeMonthlySpendingComposition } from '../MonthlySpendingComposition';
import { SHORTFALL_EPSILON_MONTHLY } from './computeShortfallSummary';

// 은퇴 시점과 국민연금 개시 시점 사이의 «연금 공백기».
//
// **왜 별도 위험으로 승격하는가.**
//
// 60세 은퇴 / 65세 개시 계획에서 60~64세는 생활비 대부분을 투자자산 인출로 메운다(실측
// 리포트: 월 약 250만원 인출 → 65세부터 국민연금 191만원이 들어오며 인출이 64만원으로 급감).
// 이 5년이 은퇴 전체에서 자산 잔고가 가장 크고 인출률도 가장 높은 구간이라, 여기서 하락장을
// 맞으면 회복할 원금이 그만큼 줄어 전체 성공률을 좌우한다 — 시퀀스 리스크가 실제로 작동하는
// 자리가 여기다.
//
// 그런데 화면에서 이 사실은 전문가 패널 접힌 문단 안 괄호 한 줄
// ("은퇴 후 5년의 연금 공백 기간이 있습니다")로만 존재했다.
export interface PensionGapRisk {
  fromAge: number;
  toAge: number;
  years: number;
  // 공백기 월 평균 자산인출액.
  monthlyAssetWithdrawal: number;
  // 공백기에 실제로 자산에서 인출하는 총액. 현재 구매력 기준이다.
  assetWithdrawalAmount: number;
  // 공백기 중 계획 생활비를 채우지 못하는 연수와, 그 연도들만을 기준으로 한 월평균 부족액.
  shortfallYears: number;
  averageMonthlyShortfall: number;
  // 공백기에 채우지 못한 생활비 총액. 현재 구매력 기준이다.
  shortfallAmount: number;
  // 공백기를 계획대로 건너는 데 필요한 총 자금 = 실제 자산인출 + 미충족 생활비.
  // 인출 시작 조건 때문에 자산을 쓰지 못한 계획도 0원으로 축소되지 않아야 한다.
  bridgeAmount: number;
}

// 새 시뮬레이션을 돌리지 않는다. 공백 구간 판정은 computeExpertAnalytics가 쓰던 규칙을 그대로
// 옮겨 온 것이고(그쪽이 이 함수를 쓰도록 바꿔 두 곳이 갈라지지 않게 한다), 인출액은
// computeMonthlySpendingComposition이 이미 연도별로 계산해 둔 assetWithdrawal을 읽을 뿐이다.
export function computePensionGapRisk(
  params: SimulationParams,
  result: SimulationResult
): PensionGapRisk | null {
  const { retirementAge, currentAge } = params.userProfile;
  const firstAgeWithNationalPension = findFirstAgeWithNationalPension(result);

  // 국민연금이 없으면 «공백»이라는 개념 자체가 성립하지 않는다 — 끝까지 없는 것은 공백이
  // 아니라 부재이고, 처방도 다르다(개시 시점 조정이 아니라 다른 소득원 확보다).
  if (firstAgeWithNationalPension === null) return null;

  const years = firstAgeWithNationalPension - retirementAge;
  if (years <= 0) return null;

  const gapRows = computeMonthlySpendingComposition(result.yearlyResults, params, result).filter(
    (row) => row.age >= retirementAge && row.age < firstAgeWithNationalPension
  );
  if (gapRows.length === 0) return null;

  const inflationRate = params.inflationRate ?? 2;
  const isNominal = params.inflationMode === 'nominal';

  // 명목가치 계획의 미래 금액은 물가만큼 부풀려져 있다. 그대로 더하면 "지금 얼마를 준비해야
  // 하는가"를 과장한다. 할인 규칙은 computeShortfallSummary.summarize와 **같은 것**을 쓴다 —
  // 두 카드가 나란히 놓이는데 서로 다른 자로 재면 사용자가 금액을 비교할 수 없다.
  const presentValue = (monthly: number, age: number) => {
    const annual = monthly * 12;
    if (!isNominal) return annual;
    return annual / Math.pow(1 + inflationRate / 100, age - currentAge);
  };

  const assetWithdrawalAmount = gapRows.reduce(
    (sum, row) => sum + presentValue(row.assetWithdrawal, row.age),
    0
  );

  const shortfallRows = gapRows.filter((row) => row.shortfall >= SHORTFALL_EPSILON_MONTHLY);
  const shortfallAmount = shortfallRows.reduce(
    (sum, row) => sum + presentValue(row.shortfall, row.age),
    0
  );

  const monthlyAssetWithdrawal =
    gapRows.reduce((sum, row) => sum + row.assetWithdrawal, 0) / gapRows.length;
  const averageMonthlyShortfall = shortfallRows.length === 0
    ? 0
    : shortfallRows.reduce((sum, row) => sum + row.shortfall, 0) / shortfallRows.length;

  return {
    fromAge: retirementAge,
    toAge: firstAgeWithNationalPension - 1,
    years,
    monthlyAssetWithdrawal: Math.round(monthlyAssetWithdrawal),
    assetWithdrawalAmount: Math.round(assetWithdrawalAmount),
    shortfallYears: shortfallRows.length,
    averageMonthlyShortfall: Math.round(averageMonthlyShortfall),
    shortfallAmount: Math.round(shortfallAmount),
    bridgeAmount: Math.round(assetWithdrawalAmount + shortfallAmount),
  };
}

// 「국민연금 없음」과 「65세부터 수령」을 구분하기 위해 임의 기본값(65)을 쓰지 않는다 —
// computeExpertAnalytics·generateChartCaptions와 같은 규칙이다.
export function findFirstAgeWithNationalPension(result: SimulationResult): number | null {
  return result.yearlyResults.find((r) => r.nationalPensionIncome > 0)?.age ?? null;
}
