import { AssetCurrency, AssetMarket, IsaAccountType, PrivatePensionTaxationMethod } from '../../entities/types';
import { InvalidTaxInputError } from '../../entities/errors';
import { TaxContext } from './taxContext';

// 세율 계산은 여기서 담당하고, 통화 변환·자산 차감 등 오케스트레이션은 SimulationEngine이 담당한다.
//
// 모든 함수가 TaxContext를 받는다. 예전에는 taxRates.ts가 모듈 로드 시점에 만든 평평한
// 상수를 import했는데, 그 형태에서는 params.taxLawVersion이 계산에 도달할 방법이 없었다
// (taxContext.ts 주석 참고). 세율표를 참조하는 함수가 어디인지 시그니처에 드러나는 것도
// 의도한 효과다 — 개정안 프로필을 추가할 때 무엇을 고쳐야 하는지 컴파일러가 알려준다.

// 한 자산의 시장 구분이 결정하는 과세 취급 전부.
//
// 예전에는 이 판정이 축별로 흩어져 있었고 서로 어긋나 있었다: getDividendTaxRate는
// US_ETF/KR_ETF가 아니면 0%를 돌려주는데(= 비과세), SimulationEngine은 그 자산의 배당을
// 금융소득종합과세 기준액에는 무조건 합산했다. 그래서 「기타 자산 (비과세 등)」을 고른
// 사용자가 배당세는 안 내면서 종합과세 문턱과 건보료 판정에는 걸렸다 — 화면 라벨이 한
// 약속과 정반대다.
//
// 한 곳에서 판정하고 모든 소비처가 그 결과를 쓰게 한다.
export interface MarketTaxTreatment {
  // 배당 원천징수율 (0~1)
  dividendTaxRate: number;
  // 이 자산의 배당이 금융소득종합과세·건강보험료 판정 기준액에 합산되는가.
  //
  // IRP/PENSION은 연금계좌 안의 수익이라 인출 시 연금소득으로 과세되고 금융소득이 아니다.
  // OTHER는 UI가 "기타 자산 (비과세 등)"이라고 약속한 대로 완전 비과세로 취급한다.
  includedInFinancialIncome: boolean;
}

export function getMarketTaxTreatment(
  market: AssetMarket | undefined,
  currency: AssetCurrency,
  ctx: TaxContext
): MarketTaxTreatment {
  const resolvedMarket = market || (currency === 'USD' ? 'US_ETF' : 'KR_ETF');
  if (resolvedMarket === 'US_ETF') {
    return { dividendTaxRate: ctx.settings.usDividendTaxRate / 100, includedInFinancialIncome: true };
  }
  if (resolvedMarket === 'KR_ETF') {
    return { dividendTaxRate: ctx.settings.domesticDividendTaxRate / 100, includedInFinancialIncome: true };
  }
  return { dividendTaxRate: 0, includedInFinancialIncome: false };
}

export function getDividendTaxRate(
  market: AssetMarket | undefined,
  currency: AssetCurrency,
  ctx: TaxContext
): number {
  return getMarketTaxTreatment(market, currency, ctx).dividendTaxRate;
}

export function getPrivatePensionIncomeTaxRate(age: number, ctx: TaxContext): number {
  const brackets = ctx.profile.privatePensionBrackets;
  const bracket = brackets.find((b) => age >= b.minAge && age < b.maxAge);
  return bracket ? bracket.rate : brackets[brackets.length - 1].rate;
}

// 연금소득공제(소득세법 §47의2). 공적연금과 사적연금을 **합산한** 총연금액에 한 번만 적용된다.
//
// 국민연금분과 사적연금분에 각각 따로 적용하면 공제를 두 번 주게 되어, 고정 세율 모델보다
// 오히려 더 틀린다. 그래서 이 함수는 항상 합산액을 받는다.
export function getPensionIncomeDeductionKRW(totalPensionIncomeKRW: number, ctx: TaxContext): number {
  if (totalPensionIncomeKRW <= 0) return 0;

  const brackets = ctx.profile.pensionIncomeDeductionBrackets;
  let bracket = brackets[0];
  for (const b of brackets) {
    if (totalPensionIncomeKRW > b.minKRW) bracket = b;
    else break;
  }

  const deduction = bracket.baseDeductionKRW + (totalPensionIncomeKRW - bracket.minKRW) * bracket.rate;
  return Math.min(deduction, ctx.profile.pensionIncomeDeductionCapKRW);
}

// 연금소득(공적 + 사적) 합산액에 대한 종합소득세액. 지방소득세를 포함한 총부담이다.
//
// 과세표준 = 총연금액 − 연금소득공제 − 종합소득 기본공제
//
// **알려진 과대 계상**: 국민연금은 실제로 2002년 이후 납입분에 대응하는 부분만 과세되는데,
// 이 시뮬레이터에는 납입 이력 입력이 없어 전액을 과세 대상으로 본다. 즉 국민연금 세액이
// 실제보다 높게 나온다 — 이 모델의 가장 큰 오차원이다.
export function calculatePensionIncomeTaxKRW(totalPensionIncomeKRW: number, ctx: TaxContext): number {
  if (totalPensionIncomeKRW <= 0) return 0;

  const deduction = getPensionIncomeDeductionKRW(totalPensionIncomeKRW, ctx);
  const taxableKRW = Math.max(
    0,
    totalPensionIncomeKRW - deduction - ctx.profile.basicIncomeDeductionKRW
  );

  return getComprehensiveIncomeTaxKRW(taxableKRW, ctx) * (1 + ctx.profile.localIncomeTaxRate);
}

// 국민연금(공적연금) 연간 수령액에 대한 소득세.
//
// 예전에는 수령액에 고정 2%를 곱했다. 그러면 월 50만원 수령자와 월 300만원 수령자가 같은
// 실효세율을 갖는데, 실제로는 연금소득공제와 누진세율 때문에 각각 약 0%와 8%대로 갈린다.
// 이 앱이 국민연금 개시 나이를 최적화해 추천한다는 점에서 정확도만의 문제가 아니었다 —
// 연기수령으로 연금액이 늘 때의 세부담 증가를 과소평가해 연기 전략을 과대평가했다.
export function calculateNationalPensionTaxKRW(annualAmountRawKRW: number, ctx: TaxContext): number {
  return calculatePensionIncomeTaxKRW(annualAmountRawKRW, ctx);
}

export function getIsaExemptionLimitKRW(isaType: IsaAccountType, ctx: TaxContext): number {
  return isaType === 'low_income'
    ? ctx.profile.isaExemptionLowIncomeKRW
    : ctx.profile.isaExemptionGeneralKRW;
}

export function calculateIsaMaturityTax(
  totalProfitInIsaCurrency: number,
  exemptionLimitInIsaCurrency: number,
  ctx: TaxContext
): number {
  if (totalProfitInIsaCurrency <= 0) return 0;
  return Math.max(0, totalProfitInIsaCurrency - exemptionLimitInIsaCurrency) * ctx.profile.isaMaturityTaxRate;
}

export interface TaxableIncomeBasis {
  annualRawFinancialIncomeKRW: number; // 종합과세 판정 기준: 배당+이자 등 금융소득만(세전)
  // 건보료 부과 대상이 되는 **공적연금(국민연금)** 수령액(세전).
  //
  // 사적연금(연금저축·IRP)은 건강보험료 부과 대상 소득이 아니다. 예전에는 이 필드가
  // annualRawPensionIncomeKRW라는 이름으로 국민연금 + 사적연금을 함께 받았고, 그래서
  // 사적연금을 많이 인출할수록 건보료가 늘어나는 잘못된 모델이었다. 필드 이름 자체로
  // 계약을 고정해 다시 섞이지 않게 한다.
  annualPublicPensionIncomeKRW: number;
  // 위 금융소득에서 이미 원천징수된 세액(세전 소득에 대응하는 실제 징수액, KRW).
  //
  // 비율(15%/15.4%)이 아니라 실제 금액을 받는 이유: 자산마다 원천징수율이 다르다.
  // 미국 배당은 한미 조세조약 제한세율 15%, 국내 배당은 15.4%다. 실제 징수액을 그대로
  // 기납부세액으로 공제하면 두 세율 차이가 자동으로 정확히 반영된다 — 외국납부세액공제를
  // 따로 모델링하지 않고도 근사가 성립한다.
  annualWithheldFinancialTaxKRW: number;
}

// 금융소득종합과세 초과분에 대한 추가 납부세액(비교과세).
//
// 소득세법 §62의 비교과세는 다음 둘 중 큰 쪽을 산출세액으로 한다:
//   (a) 2천만원 × 14% + [2천만 초과 금융소득 + 다른 종합소득]에 대한 누진세액
//   (b) 금융소득 전액 × 14% + [다른 종합소득]에 대한 누진세액
// 그리고 원천징수된 세액을 기납부세액으로 공제한다.
//
// 이 앱은 은퇴 후 금융소득만 가정하므로(다른 종합소득 0), (a)에서 기납부세액을 뺀 것이
// 곧 "초과분의 누진세액 − 초과분에 대한 원천징수액"으로 정리된다. 2천만원 이하 구간은
// 원천징수 14%와 산출세액 14%가 상쇄되어 사라지기 때문이다.
//
// **예전 모델의 결함**: 초과분에 그냥 15%를 더 물렸다. 이미 15.4%를 원천징수해 놓고
// 공제하지 않았으므로 초과분 실효세율이 약 30.4%가 됐다. 배당 3,000만원인 사용자는
// 실제로는 추가 납부가 0원인데 150만원을 내는 것으로 계산됐다.
function calculateProgressiveCreditTaxKRW(
  excessKRW: number,
  withheldOnExcessKRW: number,
  ctx: TaxContext
): number {
  if (excessKRW <= 0) return 0;

  // 누진세율표는 국세 기준이고 원천징수율(15.4%)은 지방세를 포함한 값이라, 지방소득세를
  // 얹어 두 값의 기준을 맞춘다.
  const progressiveWithLocalKRW =
    getComprehensiveIncomeTaxKRW(excessKRW, ctx) * (1 + ctx.profile.localIncomeTaxRate);

  return Math.max(0, progressiveWithLocalKRW - withheldOnExcessKRW);
}

export function calculateComprehensiveTaxAndHealthInsuranceKRW(
  incomeBasis: TaxableIncomeBasis,
  ctx: TaxContext
): { comprehensiveTaxKRW: number; healthInsuranceKRW: number; healthInsuranceIncomeBasisKRW: number } {
  const {
    annualRawFinancialIncomeKRW,
    annualPublicPensionIncomeKRW,
    annualWithheldFinancialTaxKRW,
  } = incomeBasis;
  if (annualRawFinancialIncomeKRW < 0 || annualPublicPensionIncomeKRW < 0) {
    throw new InvalidTaxInputError('과세 대상 소득은 음수일 수 없습니다.');
  }

  if (!ctx.settings.enableComprehensiveTax) {
    return { comprehensiveTaxKRW: 0, healthInsuranceKRW: 0, healthInsuranceIncomeBasisKRW: 0 };
  }

  const thresholdKRW = ctx.profile.financialIncomeThresholdKRW;

  // 금융소득종합과세 판정: 배당+이자 소득만(연금소득은 세법상 별도 과세이므로 제외)
  const excessKRW = Math.max(0, annualRawFinancialIncomeKRW - thresholdKRW);

  // 초과분에 대응하는 원천징수액. 자산마다 세율이 달라도(미국 15% / 국내 15.4%) 총 징수액을
  // 소득 비율로 안분하면 실효 원천징수율이 자연히 반영된다.
  const withheldOnExcessKRW = annualRawFinancialIncomeKRW > 0
    ? annualWithheldFinancialTaxKRW * (excessKRW / annualRawFinancialIncomeKRW)
    : 0;

  const comprehensiveTaxKRW = ctx.settings.comprehensiveTaxMode === 'flat'
    ? excessKRW * (ctx.settings.comprehensiveTaxRate / 100)
    : calculateProgressiveCreditTaxKRW(excessKRW, withheldOnExcessKRW, ctx);

  // 건강보험료 부과 기준 소득 = 금융소득 + 공적연금 × 반영비율(50%).
  // 사적연금은 부과 대상이 아니라 제외한다.
  //
  // ## 이 모델이 반영하지 않는 것 (의도적)
  //
  // 실제 지역가입자 보험료는 문턱 초과분이 아니라 **소득 전체**에 부과되고, 피부양자
  // 자격을 잃는 순간 계단식으로 뛴다(cliff). 재산·자동차 점수도 별도로 붙는다.
  // 그런데도 초과분(marginal) 방식을 유지하는 이유는 두 가지다:
  //
  // 1. 재산 입력이 없어 절벽 양쪽이 모두 틀린다. cliff만 넣으면 아래쪽은 0원, 위쪽은
  //    재산분 누락으로 과소가 되어, 정밀도는 그대로인 채 오차 구조만 복잡해진다.
  // 2. 불연속이 이진탐색을 깨뜨린다. findMaxSustainableValue/findMaxSustainable은
  //    "목표 지출이 늘면 고갈이 빨라진다"는 단조성을 30회 이진탐색으로 이용하는데,
  //    계단이 생기면 잘못된 값에 수렴하고 추천 후보 비교도 불안정해진다.
  //    이건 세법 문제가 아니라 아키텍처 문제라 도입 비용이 훨씬 크다.
  //
  // 대신 절벽 근접은 계산이 아니라 경고로 알린다(computeRiskAlerts의 healthInsuranceCliff).
  // 그 결과 이 모델의 건보료는 실제보다 **낮게** 나올 수 있으며, 화면 문구에 명시한다.
  const publicPensionForHealthInsuranceKRW =
    annualPublicPensionIncomeKRW * ctx.profile.healthInsurancePublicPensionInclusionRate;
  const combinedIncomeForHealthInsuranceKRW =
    annualRawFinancialIncomeKRW + publicPensionForHealthInsuranceKRW;
  const healthInsuranceKRW =
    ctx.settings.enableHealthInsurance && combinedIncomeForHealthInsuranceKRW > thresholdKRW
      ? (combinedIncomeForHealthInsuranceKRW - thresholdKRW) * (ctx.settings.healthInsuranceRate / 100)
      : 0;

  return {
    comprehensiveTaxKRW,
    healthInsuranceKRW,
    healthInsuranceIncomeBasisKRW: combinedIncomeForHealthInsuranceKRW,
  };
}

// 사적연금 인출액(세전) 단독을 종합소득세 누진세율표에 그대로 적용했을 때의 세액.
// 근로/사업/다른 종합소득과의 합산, 각종 소득공제는 반영하지 않는 근사치다.
export function getComprehensiveIncomeTaxKRW(taxableIncomeKRW: number, ctx: TaxContext): number {
  if (taxableIncomeKRW < 0) throw new InvalidTaxInputError('과세표준은 음수일 수 없습니다.');
  if (taxableIncomeKRW === 0) return 0;

  const brackets = ctx.profile.comprehensiveIncomeBrackets;
  let bracket = brackets[0];
  for (const b of brackets) {
    if (taxableIncomeKRW > b.minKRW) bracket = b;
    else break;
  }
  return taxableIncomeKRW * bracket.rate - bracket.deductionKRW;
}

export interface PrivatePensionExcessTaxResult {
  taxKRW: number;
  method: PrivatePensionTaxationMethod;
}

export function calculatePrivatePensionExcessTaxNeededKRW(
  annualPrivatePensionPreTaxKRW: number,
  ctx: TaxContext,
  // 같은 해의 국민연금 수령액(세전). 종합과세를 고를 때 두 연금은 합산되어 하나의
  // 과세표준을 이루므로, 사적연금분의 세부담은 "국민연금이 이미 채운 구간 위에 얹히는
  // 증분"이다. 0으로 두면 사적연금만 단독 과세되는 근사가 된다.
  annualNationalPensionPreTaxKRW: number = 0
): PrivatePensionExcessTaxResult {
  if (annualPrivatePensionPreTaxKRW < 0) {
    throw new InvalidTaxInputError('사적연금 인출액은 음수일 수 없습니다.');
  }

  const limit = ctx.settings.privatePensionLimit ?? ctx.profile.privatePensionLimitKRW;
  if (!ctx.settings.enablePrivatePensionTax || annualPrivatePensionPreTaxKRW <= limit) {
    return { taxKRW: 0, method: 'none' };
  }

  const excessRate = ctx.settings.privatePensionExcessTaxRate ?? ctx.profile.privatePensionExcessTaxRate;
  const separateTaxKRW = annualPrivatePensionPreTaxKRW * (excessRate / 100);

  const compareEnabled = ctx.settings.enablePensionComprehensiveComparison ?? true;
  if (!compareEnabled) return { taxKRW: separateTaxKRW, method: 'separate' };

  // 종합과세를 고를 때의 세부담은 "국민연금까지 합산한 세액 − 국민연금만의 세액"이다.
  // 이렇게 증분으로 구해야 연금소득공제(한도 900만원)와 기본공제(150만원)가 두 연금에
  // 걸쳐 정확히 한 번만 적용된다. 예전에는 사적연금 인출액을 그대로 과세표준으로 삼아
  // (공제 없이, 국민연금과 무관하게) 계산했다.
  const nationalOnlyTaxKRW = calculatePensionIncomeTaxKRW(annualNationalPensionPreTaxKRW, ctx);
  const combinedTaxKRW = calculatePensionIncomeTaxKRW(
    annualNationalPensionPreTaxKRW + annualPrivatePensionPreTaxKRW,
    ctx
  );
  const comprehensiveTaxKRW = Math.max(0, combinedTaxKRW - nationalOnlyTaxKRW);

  return comprehensiveTaxKRW < separateTaxKRW
    ? { taxKRW: comprehensiveTaxKRW, method: 'comprehensive' }
    : { taxKRW: separateTaxKRW, method: 'separate' };
}
