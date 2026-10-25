import { SimulationResult, StrategyRecommendation } from '../../entities/types';
import { sumYearTaxesAndLevies } from '../tax/annualTaxTotals';

function sumYears(result: SimulationResult, pick: (y: SimulationResult['yearlyResults'][number]) => number): number {
  return result.yearlyResults.reduce((sum, y) => sum + pick(y), 0);
}

function totalTaxPaid(result: SimulationResult): number {
  return sumYears(result, sumYearTaxesAndLevies);
}

function pensionEndingBalance(result: SimulationResult): number {
  const last = result.yearlyResults[result.yearlyResults.length - 1];
  return last?.pensionAssets ?? 0;
}

function comprehensiveTaxYears(result: SimulationResult): number {
  return result.yearlyResults.filter((y) => y.hasTaxWarning).length;
}

export function computeDeltas(baseline: SimulationResult, recommended: SimulationResult): StrategyRecommendation['deltas'] {
  return {
    lifetimeConsumption: sumYears(recommended, (y) => y.spending) - sumYears(baseline, (y) => y.spending),
    totalTax: totalTaxPaid(recommended) - totalTaxPaid(baseline),
    endingAssets: recommended.endingAssets - baseline.endingAssets,
    pensionEndingBalance: pensionEndingBalance(recommended) - pensionEndingBalance(baseline),
    comprehensiveTaxYears: comprehensiveTaxYears(recommended) - comprehensiveTaxYears(baseline),
    healthInsuranceTotal: sumYears(recommended, (y) => y.healthInsurancePaid) - sumYears(baseline, (y) => y.healthInsurancePaid),
    nationalPensionTotal: sumYears(recommended, (y) => y.nationalPensionIncome) - sumYears(baseline, (y) => y.nationalPensionIncome),
  };
}
