import { AssetCurrency, AssetMarket, IsaAccountType, PrivatePensionTaxationMethod, TaxSettings } from '../../entities/types';
import { InvalidTaxInputError } from '../../entities/errors';
import {
  FINANCIAL_INCOME_COMPREHENSIVE_TAX_THRESHOLD_KRW,
  ISA_EXEMPTION_LIMIT_GENERAL_KRW,
  ISA_EXEMPTION_LIMIT_LOW_INCOME_KRW,
  ISA_MATURITY_TAX_RATE,
  NATIONAL_PENSION_TAX_RATE,
  PRIVATE_PENSION_TAX_BRACKETS,
  DEFAULT_PRIVATE_PENSION_LIMIT_KRW,
  DEFAULT_PRIVATE_PENSION_EXCESS_TAX_RATE,
  KOREA_COMPREHENSIVE_INCOME_TAX_BRACKETS_2024,
} from './taxRates';

// 세율 계산은 여기서 담당하고, 통화 변환·자산 차감 등 오케스트레이션은 SimulationEngine이 담당한다.

export function getDividendTaxRate(
  market: AssetMarket | undefined,
  currency: AssetCurrency,
  taxSettings: TaxSettings
): number {
  const resolvedMarket = market || (currency === 'USD' ? 'US_ETF' : 'KR_ETF');
  if (resolvedMarket === 'US_ETF') return taxSettings.usDividendTaxRate / 100;
  if (resolvedMarket === 'KR_ETF') return taxSettings.domesticDividendTaxRate / 100;
  return 0;
}

export function getPrivatePensionIncomeTaxRate(age: number): number {
  const bracket = PRIVATE_PENSION_TAX_BRACKETS.find((b) => age >= b.minAge && age < b.maxAge);
  return bracket ? bracket.rate : PRIVATE_PENSION_TAX_BRACKETS[PRIVATE_PENSION_TAX_BRACKETS.length - 1].rate;
}

export function calculateNationalPensionTaxKRW(amountRawKRW: number): number {
  return amountRawKRW * NATIONAL_PENSION_TAX_RATE;
}

export function getIsaExemptionLimitKRW(isaType: IsaAccountType): number {
  return isaType === 'low_income' ? ISA_EXEMPTION_LIMIT_LOW_INCOME_KRW : ISA_EXEMPTION_LIMIT_GENERAL_KRW;
}

export function calculateIsaMaturityTax(totalProfitInIsaCurrency: number, exemptionLimitInIsaCurrency: number): number {
  if (totalProfitInIsaCurrency <= 0) return 0;
  return Math.max(0, totalProfitInIsaCurrency - exemptionLimitInIsaCurrency) * ISA_MATURITY_TAX_RATE;
}

export interface TaxableIncomeBasis {
  annualRawFinancialIncomeKRW: number; // 종합과세 판정 기준: 배당+이자 등 금융소득만(세전)
  annualRawPensionIncomeKRW: number; // 건보료 판정에만 "추가로" 합산되는 연금소득(국민+사적, 세전)
}

export function calculateComprehensiveTaxAndHealthInsuranceKRW(
  incomeBasis: TaxableIncomeBasis,
  taxSettings: TaxSettings
): { comprehensiveTaxKRW: number; healthInsuranceKRW: number } {
  const { annualRawFinancialIncomeKRW, annualRawPensionIncomeKRW } = incomeBasis;
  if (annualRawFinancialIncomeKRW < 0 || annualRawPensionIncomeKRW < 0) {
    throw new InvalidTaxInputError('과세 대상 소득은 음수일 수 없습니다.');
  }

  if (!taxSettings.enableComprehensiveTax) {
    return { comprehensiveTaxKRW: 0, healthInsuranceKRW: 0 };
  }

  // 금융소득종합과세 판정: 배당+이자 소득만(연금소득은 세법상 별도 과세이므로 제외)
  const comprehensiveTaxKRW =
    annualRawFinancialIncomeKRW > FINANCIAL_INCOME_COMPREHENSIVE_TAX_THRESHOLD_KRW
      ? (annualRawFinancialIncomeKRW - FINANCIAL_INCOME_COMPREHENSIVE_TAX_THRESHOLD_KRW) * (taxSettings.comprehensiveTaxRate / 100)
      : 0;

  // 건강보험료 판정: 금융소득 + 연금소득(국민+사적) 합산 기준(단순 확장 — 실제 피부양자/지역가입자
  // 판정 기준과는 다른 근사치)
  const combinedIncomeForHealthInsuranceKRW = annualRawFinancialIncomeKRW + annualRawPensionIncomeKRW;
  const healthInsuranceKRW =
    taxSettings.enableHealthInsurance && combinedIncomeForHealthInsuranceKRW > FINANCIAL_INCOME_COMPREHENSIVE_TAX_THRESHOLD_KRW
      ? (combinedIncomeForHealthInsuranceKRW - FINANCIAL_INCOME_COMPREHENSIVE_TAX_THRESHOLD_KRW) * (taxSettings.healthInsuranceRate / 100)
      : 0;

  return { comprehensiveTaxKRW, healthInsuranceKRW };
}

// 사적연금 인출액(세전) 단독을 종합소득세 누진세율표에 그대로 적용했을 때의 세액.
// 근로/사업/다른 종합소득과의 합산, 각종 소득공제는 반영하지 않는 근사치다.
export function getComprehensiveIncomeTaxKRW(taxableIncomeKRW: number): number {
  if (taxableIncomeKRW < 0) throw new InvalidTaxInputError('과세표준은 음수일 수 없습니다.');
  if (taxableIncomeKRW === 0) return 0;

  let bracket = KOREA_COMPREHENSIVE_INCOME_TAX_BRACKETS_2024[0];
  for (const b of KOREA_COMPREHENSIVE_INCOME_TAX_BRACKETS_2024) {
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
  taxSettings: TaxSettings
): PrivatePensionExcessTaxResult {
  if (annualPrivatePensionPreTaxKRW < 0) {
    throw new InvalidTaxInputError('사적연금 인출액은 음수일 수 없습니다.');
  }

  const limit = taxSettings.privatePensionLimit ?? DEFAULT_PRIVATE_PENSION_LIMIT_KRW;
  if (!taxSettings.enablePrivatePensionTax || annualPrivatePensionPreTaxKRW <= limit) {
    return { taxKRW: 0, method: 'none' };
  }

  const excessRate = taxSettings.privatePensionExcessTaxRate ?? DEFAULT_PRIVATE_PENSION_EXCESS_TAX_RATE;
  const separateTaxKRW = annualPrivatePensionPreTaxKRW * (excessRate / 100);

  const compareEnabled = taxSettings.enablePensionComprehensiveComparison ?? true;
  if (!compareEnabled) return { taxKRW: separateTaxKRW, method: 'separate' };

  // 단순 비교 모델: 사적연금 인출액 "그 자체만" 종합소득세 누진세율에 단독 적용했을 때의 세액과
  // 비교해 더 유리한(낮은) 쪽을 선택한다. 다른 종합소득과의 합산은 반영하지 않는 근사치다.
  const comprehensiveTaxKRW = getComprehensiveIncomeTaxKRW(annualPrivatePensionPreTaxKRW);

  return comprehensiveTaxKRW < separateTaxKRW
    ? { taxKRW: comprehensiveTaxKRW, method: 'comprehensive' }
    : { taxKRW: separateTaxKRW, method: 'separate' };
}
