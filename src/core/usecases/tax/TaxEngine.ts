import { AssetCurrency, AssetMarket, IsaAccountType, PrivatePensionTaxationMethod } from '../../entities/types';
import { InvalidTaxInputError } from '../../entities/errors';
import { TaxContext } from './taxContext';

// 세율 계산은 여기서 담당하고, 통화 변환·자산 차감 등 오케스트레이션은 SimulationEngine이 담당한다.
//
// 모든 함수가 TaxContext를 받는다. 예전에는 taxRates.ts가 모듈 로드 시점에 만든 평평한
// 상수를 import했는데, 그 형태에서는 params.taxLawVersion이 계산에 도달할 방법이 없었다
// (taxContext.ts 주석 참고). 세율표를 참조하는 함수가 어디인지 시그니처에 드러나는 것도
// 의도한 효과다 — 개정안 프로필을 추가할 때 무엇을 고쳐야 하는지 컴파일러가 알려준다.

export function getDividendTaxRate(
  market: AssetMarket | undefined,
  currency: AssetCurrency,
  ctx: TaxContext
): number {
  const resolvedMarket = market || (currency === 'USD' ? 'US_ETF' : 'KR_ETF');
  if (resolvedMarket === 'US_ETF') return ctx.settings.usDividendTaxRate / 100;
  if (resolvedMarket === 'KR_ETF') return ctx.settings.domesticDividendTaxRate / 100;
  return 0;
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
}

export function calculateComprehensiveTaxAndHealthInsuranceKRW(
  incomeBasis: TaxableIncomeBasis,
  ctx: TaxContext
): { comprehensiveTaxKRW: number; healthInsuranceKRW: number } {
  const { annualRawFinancialIncomeKRW, annualRawPensionIncomeKRW } = incomeBasis;
  if (annualRawFinancialIncomeKRW < 0 || annualRawPensionIncomeKRW < 0) {
    throw new InvalidTaxInputError('과세 대상 소득은 음수일 수 없습니다.');
  }

  if (!ctx.settings.enableComprehensiveTax) {
    return { comprehensiveTaxKRW: 0, healthInsuranceKRW: 0 };
  }

  const thresholdKRW = ctx.profile.financialIncomeThresholdKRW;

  // 금융소득종합과세 판정: 배당+이자 소득만(연금소득은 세법상 별도 과세이므로 제외)
  const comprehensiveTaxKRW =
    annualRawFinancialIncomeKRW > thresholdKRW
      ? (annualRawFinancialIncomeKRW - thresholdKRW) * (ctx.settings.comprehensiveTaxRate / 100)
      : 0;

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
