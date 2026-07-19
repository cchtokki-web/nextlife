import { AssetCurrency, AssetMarket, IsaAccountType, TaxSettings } from '../../entities/types';
import {
  FINANCIAL_INCOME_COMPREHENSIVE_TAX_THRESHOLD_KRW,
  ISA_EXEMPTION_LIMIT_GENERAL_KRW,
  ISA_EXEMPTION_LIMIT_LOW_INCOME_KRW,
  ISA_MATURITY_TAX_RATE,
  NATIONAL_PENSION_TAX_RATE,
  PRIVATE_PENSION_TAX_BRACKETS,
  DEFAULT_PRIVATE_PENSION_LIMIT_KRW,
  DEFAULT_PRIVATE_PENSION_EXCESS_TAX_RATE,
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

export function calculateComprehensiveTaxAndHealthInsuranceKRW(
  annualRawFinancialIncomeKRW: number,
  taxSettings: TaxSettings
): { comprehensiveTaxKRW: number; healthInsuranceKRW: number } {
  if (!taxSettings.enableComprehensiveTax || annualRawFinancialIncomeKRW <= FINANCIAL_INCOME_COMPREHENSIVE_TAX_THRESHOLD_KRW) {
    return { comprehensiveTaxKRW: 0, healthInsuranceKRW: 0 };
  }

  const excessKRW = annualRawFinancialIncomeKRW - FINANCIAL_INCOME_COMPREHENSIVE_TAX_THRESHOLD_KRW;
  const comprehensiveTaxKRW = excessKRW * (taxSettings.comprehensiveTaxRate / 100);
  const healthInsuranceKRW = taxSettings.enableHealthInsurance ? excessKRW * (taxSettings.healthInsuranceRate / 100) : 0;

  return { comprehensiveTaxKRW, healthInsuranceKRW };
}

export function calculatePrivatePensionExcessTaxNeededKRW(
  annualPrivatePensionPreTaxKRW: number,
  taxSettings: TaxSettings
): number {
  const limit = taxSettings.privatePensionLimit ?? DEFAULT_PRIVATE_PENSION_LIMIT_KRW;
  if (!taxSettings.enablePrivatePensionTax || annualPrivatePensionPreTaxKRW <= limit) return 0;

  const excessRate = taxSettings.privatePensionExcessTaxRate ?? DEFAULT_PRIVATE_PENSION_EXCESS_TAX_RATE;
  return annualPrivatePensionPreTaxKRW * (excessRate / 100);
}
