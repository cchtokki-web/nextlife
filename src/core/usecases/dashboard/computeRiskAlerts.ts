import { AssetCurrency, SimulationParams, SimulationResult, SimulationYearlyResult, UtilityConfig } from '../../entities/types';
import { DEFAULT_UTILITY_CONFIG } from '../utility/utilityWeights';
import { formatManwon, formatMoney } from '../utility/utilityAnalysis';
import { resolveStrategy } from '../strategy/compileStrategy';
import { resolveTaxContext, TaxContext } from '../tax/taxContext';
import { estimateHealthInsuranceCliff } from '../healthcare/estimateHealthInsuranceCliff';
import { computePensionGapRisk, PensionGapRisk } from './computePensionGapRisk';

export interface RiskAlert {
  key:
    | 'pensionGap'
    | 'comprehensiveTax'
    | 'privatePensionLimit'
    | 'healthInsurance'
    | 'healthInsuranceCliff'
    | 'bequestShortfall';
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

// 은퇴 직후~국민연금 개시 전 구간. 다른 알림이 전부 세금·상속 위험인 것과 달리 이것은
// **계획 자체의 구조적 위험**이라, sortAge를 은퇴 나이로 두어 목록 맨 위에 오게 한다.
//
// 이 카드가 필요한 이유는 computePensionGapRisk 주석에 있다 — 요약하면, 은퇴 후 자산 잔고가
// 가장 크고 인출률도 가장 높은 구간이 여기라서 이 5년의 시장 하락이 전체 성공률을 좌우한다.
function buildPensionGapAlert(
  gap: PensionGapRisk | null,
  currency: AssetCurrency,
): RiskAlertCandidate | null {
  if (gap === null) return null;
  // gap의 금액은 전부 엔진이 낸 값이라 원화가 아니라 표시 통화 기준이다(types.ts).
  const money = (amount: number) => formatMoney(amount, currency);
  const fundingMessage = gap.shortfallYears > 0
    ? gap.monthlyAssetWithdrawal > 0
      ? `이 기간에는 자산에서 월 평균 ${money(gap.monthlyAssetWithdrawal)}을 인출하고, ` +
        `${gap.shortfallYears}년은 계획 생활비를 월 평균 ${money(gap.averageMonthlyShortfall)} 채우지 못합니다. ` +
        `인출액과 부족분을 합쳐 필요한 자금은 약 ${money(gap.bridgeAmount)}입니다.`
      : `${gap.shortfallYears}년은 일반자산 인출 시작 조건 때문에 계획 생활비를 월 평균 ` +
        `${money(gap.averageMonthlyShortfall)} 채우지 못합니다. 이 부족분을 메우는 데 필요한 ` +
        `자금은 약 ${money(gap.bridgeAmount)}입니다.`
    : `생활비를 위해 자산에서 월 평균 ${money(gap.monthlyAssetWithdrawal)}을 인출합니다. ` +
      `이 기간의 시장 하락은 회복할 원금을 줄일 수 있으므로, 약 ${money(gap.bridgeAmount)}을 ` +
      `변동성이 낮은 자금으로 확보하는 것이 좋습니다.`;
  return {
    sortAge: gap.fromAge,
    alert: {
      key: 'pensionGap',
      title: `핵심 위험구간: ${formatAgeRange(gap.fromAge, gap.toAge)} (국민연금 개시 전)`,
      message: `국민연금 개시 전 ${gap.years}년의 공백입니다. ${fundingMessage}`,
    },
  };
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

// 피부양자 자격 상실 절벽에 근접했는지 알린다.
//
// 이 시뮬레이터의 건강보험료는 "문턱 초과분에만 요율을 곱하는" 연속 함수다. 실제 제도는
// 피부양자 자격을 잃는 순간 **소득 전체**에 부과되고 재산·자동차 점수까지 붙는 계단
// 구조라, 문턱 근처에서 실제 부담이 계산값보다 훨씬 크게 뛸 수 있다.
//
// 그 계단을 계산에 넣지 않는 이유는 TaxEngine 쪽 주석에 있다(재산 입력이 없어 절벽 양쪽이
// 모두 틀리고, 불연속이 이진탐색의 단조성 전제를 깨뜨린다). 대신 위험 자체는 사용자에게
// 전달해야 하므로 경고로 낸다 — 계산의 정직성과 사용자에게 필요한 정보를 둘 다 지키는
// 이 앱 수준의 최선이다.
//
// 판정: 건보료 부과 기준 소득이 문턱의 90~110% 구간에 들어가는 해가 있는가.
// 이미 크게 넘어선 사용자는 위 '건강보험료 증가 구간' 경고가 담당하므로 상단을 110%로 막는다.
const HEALTH_INSURANCE_CLIFF_LOWER_RATIO = 0.9;
const HEALTH_INSURANCE_CLIFF_UPPER_RATIO = 1.1;

function buildHealthInsuranceCliffAlert(
  yearlyResults: SimulationYearlyResult[],
  ctx: TaxContext
): RiskAlertCandidate | null {
  const thresholdKRW = ctx.profile.financialIncomeThresholdKRW;
  const range = findFirstContiguousRange(yearlyResults, (y) => {
    const ratio = y.healthInsuranceIncomeBasis / thresholdKRW;
    return ratio >= HEALTH_INSURANCE_CLIFF_LOWER_RATIO && ratio <= HEALTH_INSURANCE_CLIFF_UPPER_RATIO;
  });
  if (!range) return null;

  // "계단식으로 뜁니다"만으로는 사용자가 대비할 수 없다 — 얼마나 뛰는지를 알아야 전략을
  // 바꿀지 판단할 수 있다. 추정은 별도 순수 함수가 맡고(시뮬레이션 본체는 건드리지 않는
  // 이유는 estimateHealthInsuranceCliff 주석 참고), 여기서는 문구로 옮기기만 한다.
  //
  // 추정이 없으면(건보료 스위치가 꺼졌거나 문턱을 넘는 해가 없으면) 금액 문장을 생략하고
  // 기존 경고만 낸다 — 경계 구간 판정과 추정의 조건이 서로 독립이라 한쪽만 성립할 수 있다.
  const estimate = estimateHealthInsuranceCliff(yearlyResults, ctx);
  const amountSentence = estimate === null
    ? ''
    : ` ${estimate.peakAge}세 기준으로 보면 현재 계산상 월 ${formatManwon(estimate.currentMonthly)}이지만, `
      + `자격을 잃으면 월 ${formatManwon(estimate.ifDependentLostMonthly)}(연 ${formatManwon(estimate.ifDependentLostAnnual)})까지 오릅니다 `
      + `— 연 ${formatManwon(estimate.annualIncrease)}의 추가 부담입니다. 이 금액은 소득분만 계산한 것이라 재산·자동차분이 더 붙습니다.`;

  return {
    sortAge: range.startAge,
    alert: {
      key: 'healthInsuranceCliff',
      title: '건강보험 피부양자 자격 경계 구간',
      message: `${formatAgeRange(range.startAge, range.endAge)} 구간, 건강보험료 부과 기준 소득이 연 ${formatManwon(thresholdKRW)} 근처입니다. 이 기준을 넘어 피부양자 자격을 잃으면 실제 보험료는 초과분이 아니라 소득 전체와 재산에 부과되어 계단식으로 뜁니다.${amountSentence}`,
    },
  };
}

// 사용자가 명시적으로 금액 목표를 세운 계획("목표 금액 유지")에서, 기대수명 시점 예상
// 잔여자산이 그 목표에 못 미치면 알림을 만든다. 다른 알림과 달리 연도별 시뮬레이션 조건이
// 아니라 단일 시점 이벤트라 sortAge는 그 시점 나이로 고정한다.
//
// 판정 기준이 "userProfile.targetBequest의 존재 여부"가 아니라 전략(resolveStrategy)인 이유:
// compileStrategy는 'leave_some'(기본 전략)에서도 targetBequest를 월 목표생활비 24개월치로
// 실체화한다. 존재 여부로 판정하면 패널에서 아무 필드나 건드려 전략이 실체화되는 순간
// 같은 계획에 없던 경고 카드가 새로 생긴다 — 사용자는 목표 금액을 입력한 적이 없고,
// 애초에 그 입력은 'target_amount'일 때만 화면에 보인다. 화면이 말하는 것과 알림이 뜨는
// 조건을 같은 함수(resolveStrategy)로 묶어 어긋날 수 없게 한다.
//
// 'spend_all'(0원, 다 쓰고 가기)은 미달이라는 개념 자체가 성립하지 않으므로(잔여자산이
// 0 이상이면 항상 목표를 만족) 대상이 아니다.
//
// 라벨과 정렬 기준 나이는 endingAssets가 관측된 시점, 즉 시뮬레이션 종료 나이
// (= 본인 기대수명)다(types.ts). 다른 나이를 쓰면 그 시점에 없던 잔액을 제시하게 된다.
function buildBequestShortfallAlert(params: SimulationParams, result: SimulationResult): RiskAlertCandidate | null {
  const { targetBequest, expectancy } = params.userProfile;
  // endingAssets는 표시 통화 기준이고, targetBequest는 같은 화면에서 같은 단위로 입력받는다.
  const money = (amount: number) => formatMoney(amount, params.displayCurrency);
  if (resolveStrategy(params).bequestStrategy !== 'target_amount') return null;
  if (targetBequest === undefined || targetBequest <= 0) return null;
  if (result.endingAssets >= targetBequest) return null;

  const timing = `기대수명(${expectancy}세) 시점`;
  const shortfall = targetBequest - result.endingAssets;
  return {
    sortAge: expectancy,
    alert: {
      key: 'bequestShortfall',
      title: '목표 상속자산에 못 미칠 것으로 예상됩니다',
      message:
        `${timing} 예상 잔여자산(약 ${money(result.endingAssets)})이 ` +
        `목표 상속자산(약 ${money(targetBequest)})보다 약 ${money(shortfall)} 부족합니다.`,
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
  // 「만원」·「억원」은 원화의 단위다. 엔진이 내놓는 금액은 표시 통화 기준이라, 이 값을
  // 구분하지 않으면 달러 사용자에게 달러 숫자가 「만원」으로 찍힌다.
  const displayCurrency = params.displayCurrency;
  // 반면 privatePensionLimit은 세법이 «원화로» 정한 한도라 언제나 만원 표기가 맞다.
  const privatePensionLimit = params.taxSettings?.privatePensionLimit ?? 15000000;

  const candidates = [
    buildPensionGapAlert(computePensionGapRisk(params, result), displayCurrency),
    buildComprehensiveTaxAlert(yearlyResults),
    buildPrivatePensionLimitAlert(yearlyResults, privatePensionLimit),
    buildHealthInsuranceAlert(yearlyResults, cfg.healthInsuranceCeiling),
    buildHealthInsuranceCliffAlert(yearlyResults, resolveTaxContext(params.taxSettings, params.taxLawVersion)),
    buildBequestShortfallAlert(params, result),
  ].filter((c): c is RiskAlertCandidate => c !== null);

  return candidates.sort((a, b) => a.sortAge - b.sortAge).map((c) => c.alert);
}
