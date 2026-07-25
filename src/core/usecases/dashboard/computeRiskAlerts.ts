import { SimulationParams, SimulationResult, SimulationYearlyResult, UtilityConfig } from '../../entities/types';
import { DEFAULT_UTILITY_CONFIG } from '../utility/utilityWeights';
import { formatManwon } from '../utility/utilityAnalysis';

export interface RiskAlert {
  key: 'comprehensiveTax' | 'privatePensionLimit' | 'healthInsurance' | 'bequestShortfall';
  title: string;
  message: string;
}

interface RiskAlertCandidate {
  alert: RiskAlert;
  sortAge: number;
}

// 조건을 만족하는 첫 연속 구간의 [시작 나이, 끝 나이]를 반환한다. yearlyResults는 나이 오름차순으로
// 정렬되어 있다고 가정한다(SimulationEngine의 산출 순서와 동일). 만족하는 연도가 없으면 null.
// 조건을 만족하는 구간이 끝난 뒤(startAge가 채워진 뒤) 조건이 다시 꺼지면 그 시점에서 멈춘다 —
// 이후 다시 조건을 만족하는 두 번째 구간이 있어도 무시하고 "첫 구간"만 본다.
function findFirstContiguousRange(
  yearlyResults: SimulationYearlyResult[],
  predicate: (year: SimulationYearlyResult) => boolean
): { startAge: number; endAge: number } | null {
  let startAge: number | null = null;
  let endAge: number | null = null;

  for (const year of yearlyResults) {
    if (predicate(year)) {
      if (startAge === null) startAge = year.age;
      endAge = year.age;
    } else if (startAge !== null) {
      break;
    }
  }

  if (startAge === null || endAge === null) return null;
  return { startAge, endAge };
}

function formatAgeRange(startAge: number, endAge: number): string {
  return startAge === endAge ? `${startAge}세` : `${startAge}~${endAge}세`;
}

function buildComprehensiveTaxAlert(yearlyResults: SimulationYearlyResult[]): RiskAlertCandidate | null {
  const firstWarningYear = yearlyResults.find((y) => y.hasTaxWarning);
  if (!firstWarningYear) return null;
  return {
    sortAge: firstWarningYear.age,
    alert: {
      key: 'comprehensiveTax',
      title: '금융소득종합과세 진입 가능성',
      message: `${firstWarningYear.age}세 이후 배당·이자소득이 연 2,000만원을 초과하는 해가 있습니다.`,
    },
  };
}

function buildPrivatePensionLimitAlert(
  yearlyResults: SimulationYearlyResult[],
  privatePensionLimit: number
): RiskAlertCandidate | null {
  const range = findFirstContiguousRange(
    yearlyResults,
    (y) => y.privatePensionIncome + y.pensionTaxPaid > privatePensionLimit
  );
  if (!range) return null;
  return {
    sortAge: range.startAge,
    alert: {
      key: 'privatePensionLimit',
      title: '세금 급증 구간 (사적연금 저율과세 한도 초과)',
      message: `${formatAgeRange(range.startAge, range.endAge)} 구간, 사적연금이 저율과세 한도(연 ${formatManwon(privatePensionLimit)})를 초과해 세금 부담이 늘어납니다.`,
    },
  };
}

function buildHealthInsuranceAlert(
  yearlyResults: SimulationYearlyResult[],
  healthInsuranceCeiling: number
): RiskAlertCandidate | null {
  const range = findFirstContiguousRange(
    yearlyResults,
    (y) => y.totalIncome > 0 && y.healthInsurancePaid / y.totalIncome >= healthInsuranceCeiling
  );
  if (!range) return null;
  const ceilingPercent = Math.round(healthInsuranceCeiling * 100);
  return {
    sortAge: range.startAge,
    alert: {
      key: 'healthInsurance',
      title: '건강보험료 증가 구간',
      message: `${formatAgeRange(range.startAge, range.endAge)} 구간, 건강보험료가 소득의 ${ceilingPercent}%를 초과합니다.`,
    },
  };
}

// 목표 상속자산(userProfile.targetBequest)이 설정되어 있고, 기대수명 시점 예상 잔여자산이 그
// 목표에 못 미치면 알림을 만든다. 0원("다 쓰고 가기")은 미달이라는 개념 자체가 성립하지 않으므로
// (잔여자산이 0 이상이면 항상 목표를 만족) 대상에서 제외한다. 다른 알림과 달리 연도별 시뮬레이션
// 조건이 아니라 "기대수명 시점"이라는 단일 이벤트라 sortAge는 expectancy로 고정한다.
function buildBequestShortfallAlert(params: SimulationParams, result: SimulationResult): RiskAlertCandidate | null {
  const { targetBequest, expectancy } = params.userProfile;
  if (targetBequest === undefined || targetBequest <= 0) return null;
  if (result.endingAssets >= targetBequest) return null;

  const shortfall = targetBequest - result.endingAssets;
  return {
    sortAge: expectancy,
    alert: {
      key: 'bequestShortfall',
      title: '목표 상속자산에 못 미칠 것으로 예상됩니다',
      message:
        `기대수명(${expectancy}세) 시점 예상 잔여자산(약 ${formatManwon(result.endingAssets)})이 ` +
        `목표 상속자산(약 ${formatManwon(targetBequest)})보다 약 ${formatManwon(shortfall)} 부족합니다.`,
    },
  };
}

// 이미 존재하는 임계값(healthInsuranceCeiling/privatePensionLimit)과 판정 조건을 재사용하되, 이번엔
// boolean이 아니라 "몇 세부터 몇 세까지" 구간까지 계산해 반환한다.
//
// 주의: UtilityEngine.ts는 healthInsuranceCeiling을 은퇴 전체 기간 "합산" 비율에 적용해 taxationRisk
// 점수를 매기지만, 여기서는 같은 임계값을 "연도별"로 적용한다(연령대를 보여줘야 하므로). 따라서 개별
// 연도는 이 카드에 걸리지만 전체 평균은 임계값 밑이라 Utility 점수는 만점인 경우가 있을 수 있다 —
// 의도된 차이이며 버그가 아니다.
//
// 반환 순서는 가장 이른 시작 연령 순이며, 해당 사항이 없는 리스크는 배열에서 제외된다(0~4개).
export function computeRiskAlerts(
  result: SimulationResult,
  params: SimulationParams,
  cfg: UtilityConfig = DEFAULT_UTILITY_CONFIG
): RiskAlert[] {
  const { yearlyResults } = result;
  const privatePensionLimit = params.taxSettings?.privatePensionLimit ?? 15000000;

  const candidates = [
    buildComprehensiveTaxAlert(yearlyResults),
    buildPrivatePensionLimitAlert(yearlyResults, privatePensionLimit),
    buildHealthInsuranceAlert(yearlyResults, cfg.healthInsuranceCeiling),
    buildBequestShortfallAlert(params, result),
  ].filter((c): c is RiskAlertCandidate => c !== null);

  return candidates.sort((a, b) => a.sortAge - b.sortAge).map((c) => c.alert);
}
