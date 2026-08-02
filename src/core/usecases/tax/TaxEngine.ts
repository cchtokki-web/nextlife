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

export function calculateNationalPensionTaxKRW(amountRawKRW: number, ctx: TaxContext): number {
  return amountRawKRW * ctx.profile.nationalPensionTaxRate;
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
  annualRawPensionIncomeKRW: number; // 건보료 판정에만 "추가로" 합산되는 연금소득(국민+사적, 세전)
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
): { comprehensiveTaxKRW: number; healthInsuranceKRW: number } {
  const {
    annualRawFinancialIncomeKRW,
    annualRawPensionIncomeKRW,
    annualWithheldFinancialTaxKRW,
  } = incomeBasis;
  if (annualRawFinancialIncomeKRW < 0 || annualRawPensionIncomeKRW < 0) {
    throw new InvalidTaxInputError('과세 대상 소득은 음수일 수 없습니다.');
  }

  if (!ctx.settings.enableComprehensiveTax) {
    return { comprehensiveTaxKRW: 0, healthInsuranceKRW: 0 };
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

  // 건강보험료 판정: 금융소득 + 연금소득(국민+사적) 합산 기준(단순 확장 — 실제 피부양자/지역가입자
  // 판정 기준과는 다른 근사치)
  const combinedIncomeForHealthInsuranceKRW = annualRawFinancialIncomeKRW + annualRawPensionIncomeKRW;
  const healthInsuranceKRW =
    ctx.settings.enableHealthInsurance && combinedIncomeForHealthInsuranceKRW > thresholdKRW
      ? (combinedIncomeForHealthInsuranceKRW - thresholdKRW) * (ctx.settings.healthInsuranceRate / 100)
      : 0;

  return { comprehensiveTaxKRW, healthInsuranceKRW };
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
  ctx: TaxContext
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

  // 단순 비교 모델: 사적연금 인출액 "그 자체만" 종합소득세 누진세율에 단독 적용했을 때의 세액과
  // 비교해 더 유리한(낮은) 쪽을 선택한다. 다른 종합소득과의 합산은 반영하지 않는 근사치다.
  const comprehensiveTaxKRW = getComprehensiveIncomeTaxKRW(annualPrivatePensionPreTaxKRW, ctx);

  return comprehensiveTaxKRW < separateTaxKRW
    ? { taxKRW: comprehensiveTaxKRW, method: 'comprehensive' }
    : { taxKRW: separateTaxKRW, method: 'separate' };
}
