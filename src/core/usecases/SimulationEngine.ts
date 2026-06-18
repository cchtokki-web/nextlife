import {
  SimulationParams,
  SimulationResult,
  SimulationYearlyResult,
  InvestmentAsset,
  PrivatePension,
  IsaAccount,
  AssetCurrency,
  TaxSettings,
} from '../entities/types';

interface ActiveAsset extends InvestmentAsset {
  currentValue: number;
  growthRateMonthly: number;
  divRateMonthly: number;
  taxRate: number;
}

interface ActivePension extends PrivatePension {
  currentBalance: number;
  returnRateMonthly: number;
}

interface ActiveIsa extends IsaAccount {
  currentBalance: number;
  totalInvested: number;
  monthsSinceInception: number;
  returnRateMonthly: number;
  divRateMonthly: number;
}

export class SimulationEngine {
  run(params: SimulationParams): SimulationResult {
    const strategy = params.spendingStrategy || 'target';

    if (strategy === 'max_sustainable') {
      return this.findMaxSustainable(params);
    }

    return this.runSingle(params);
  }

  private findMaxSustainable(params: SimulationParams): SimulationResult {
    let low = 0;
    let high = 50000000; // 5천만원/월
    let bestResult: SimulationResult | null = null;
    let bestTarget = 0;

    for (let i = 0; i < 30; i++) {
      const mid = (low + high) / 2;
      const trialParams = {
        ...params,
        userProfile: {
          ...params.userProfile,
          targetMonthlySpending: mid,
        },
      };
      
      const result = this.runSingle(trialParams);
      
      if (result.depletionAge === null || result.endingAssets > 0) {
        bestResult = result;
        bestTarget = mid;
        low = mid;
      } else {
        high = mid;
      }
    }

    if (!bestResult) {
      const trialParams = {
        ...params,
        userProfile: { ...params.userProfile, targetMonthlySpending: 0 },
      };
      bestResult = this.runSingle(trialParams);
    }
    
    return { ...bestResult, calculatedTargetSpending: bestTarget };
  }

  private getExchangeRate(baseExchangeRate: number, exchangeScenario: string): number {
    if (exchangeScenario === 'usd_up') return baseExchangeRate * 1.1;
    if (exchangeScenario === 'usd_down') return baseExchangeRate * 0.9;
    return baseExchangeRate;
  }

  private convertValue(amount: number, from: AssetCurrency, to: AssetCurrency, exchangeRate: number): number {
    if (from === to) return amount;
    if (from === 'USD' && to === 'KRW') return amount * exchangeRate;
    if (from === 'KRW' && to === 'USD') return amount / exchangeRate;
    return amount;
  }

  private initializeAssets(params: SimulationParams, currentTaxSettings: TaxSettings): { activeAssets: ActiveAsset[], activePensions: ActivePension[], activeIsas: ActiveIsa[], infRateAnnual: number } {
    const { assets = [], privatePensions = [], isaAccounts = [], inflationRate = 2, inflationMode = 'real' } = params;
    
    const infRateAnnual = inflationRate / 100;

    const activeAssets: ActiveAsset[] = assets.map((asset) => {
      const growthRateAnnual = inflationMode === 'real'
        ? (asset.annualGrowthRate - inflationRate) / 100
        : asset.annualGrowthRate / 100;
      const growthRateMonthly = Math.pow(Math.max(0, 1 + growthRateAnnual), 1 / 12) - 1;
      const divRateMonthly = (asset.dividendYield / 100) / 12;
      
      let taxRate = 0;
      const market = asset.assetMarket || (asset.currency === 'USD' ? 'US_ETF' : 'KR_ETF');
      if (market === 'US_ETF') taxRate = currentTaxSettings.usDividendTaxRate / 100;
      else if (market === 'KR_ETF') taxRate = currentTaxSettings.domesticDividendTaxRate / 100;

      return {
        ...asset,
        currentValue: asset.quantity * asset.averagePrice,
        growthRateMonthly,
        divRateMonthly,
        taxRate,
      };
    });

    const activePensions: ActivePension[] = privatePensions.map((p) => {
      let totalReturnAnnual = p.annualReturn;
      if (p.investmentType === 'etf' && p.dividendYield) {
        totalReturnAnnual += p.dividendYield;
      }
      const returnRateAnnual = inflationMode === 'real'
        ? (totalReturnAnnual - inflationRate) / 100
        : totalReturnAnnual / 100;
      const returnRateMonthly = Math.pow(Math.max(0, 1 + returnRateAnnual), 1 / 12) - 1;

      return {
        ...p,
        currentBalance: p.balance,
        returnRateMonthly,
      };
    });

    const activeIsas: ActiveIsa[] = (isaAccounts || []).map((isa) => {
      const returnRateAnnual = inflationMode === 'real'
        ? (isa.annualReturn - inflationRate) / 100
        : isa.annualReturn / 100;
      const returnRateMonthly = Math.pow(Math.max(0, 1 + returnRateAnnual), 1 / 12) - 1;
      const divRateMonthly = (isa.dividendYield / 100) / 12;

      return {
        ...isa,
        currentBalance: isa.balance,
        totalInvested: isa.balance,
        monthsSinceInception: 0,
        returnRateMonthly,
        divRateMonthly,
      };
    });

    return { activeAssets, activePensions, activeIsas, infRateAnnual };
  }

  private calculateRetirementScore(
    yearlyResults: SimulationYearlyResult[],
    userProfile: SimulationParams['userProfile'],
    goalAchievementRate: number,
    depletionAge: number | null,
    inflationMode: 'nominal' | 'real',
    inflationRate: number
  ): { retirementScore: number, retirementGrade: string } {
    const retirementStartResult = yearlyResults.find(r => r.age === userProfile.retirementAge);
    const retirementAssets = retirementStartResult ? retirementStartResult.totalAssets : 0;
    
    const yearsToRetirement = Math.max(0, userProfile.retirementAge - userProfile.currentAge);
    const targetMonthlyAtRetirement = inflationMode === 'nominal' 
      ? userProfile.targetMonthlySpending * Math.pow(1 + inflationRate / 100, yearsToRetirement)
      : userProfile.targetMonthlySpending;
    const targetAssets = targetMonthlyAtRetirement * 12 * 25;
    
    const assetScoreRaw = targetAssets > 0 ? (retirementAssets / targetAssets) * 100 : 100;
    const assetScore = Math.min(25, (assetScoreRaw * 0.25));

    const cashFlowScore = Math.min(25, (goalAchievementRate * 0.25));

    const retirementYearsResults = yearlyResults.filter((r) => r.age >= userProfile.retirementAge);
    let avgRetirementMonthlySpending = 0;
    let avgPensionIncome = 0;
    
    if (retirementYearsResults.length > 0) {
      const totalSpendingSum = retirementYearsResults.reduce((sum, r) => sum + r.spending, 0);
      const totalPensionSum = retirementYearsResults.reduce((sum, r) => sum + r.pensionIncome, 0);
      avgRetirementMonthlySpending = totalSpendingSum / retirementYearsResults.length / 12;
      avgPensionIncome = totalPensionSum / retirementYearsResults.length / 12;
    }

    const pensionRatio = avgRetirementMonthlySpending > 0 ? (avgPensionIncome / avgRetirementMonthlySpending) * 100 : 100;
    const pensionScore = Math.min(20, (pensionRatio * 0.20));

    let longevityScoreRaw = 100;
    if (depletionAge !== null) {
      if (depletionAge <= userProfile.retirementAge) {
        longevityScoreRaw = 0;
      } else {
        const retirementSpan = userProfile.expectancy - userProfile.retirementAge;
        const survivalSpan = depletionAge - userProfile.retirementAge;
        longevityScoreRaw = Math.min(100, Math.max(0, (survivalSpan / retirementSpan) * 100));
      }
    }
    const longevityScore = longevityScoreRaw * 0.15;

    const retirementStockAssets = retirementStartResult ? retirementStartResult.stockAssets : 0;
    const stockRatio = retirementAssets > 0 ? (retirementStockAssets / retirementAssets) * 100 : 0;
    const inflationScoreRaw = Math.min(100, (stockRatio / 40) * 100);
    const inflationScore = inflationScoreRaw * 0.15;

    const retirementScore = Math.round(assetScore + cashFlowScore + pensionScore + longevityScore + inflationScore);
    
    let retirementGrade = '위험';
    if (retirementScore >= 90) retirementGrade = '매우 안정';
    else if (retirementScore >= 80) retirementGrade = '안정';
    else if (retirementScore >= 70) retirementGrade = '보통';
    else if (retirementScore >= 60) retirementGrade = '주의';

    return { retirementScore, retirementGrade };
  }

  runSingle(params: SimulationParams): SimulationResult {
    if (!params || !params.userProfile) {
      return {
        yearlyResults: [], fireAge: null, depletionAge: null,
        endingAssets: 0, retirementScore: 0, retirementGrade: '위험', goalAchievementRate: 0,
      };
    }

    const {
      userProfile, nationalPension = { expectedMonthlyAmount: 0 }, otherIncomes = [],
      inflationRate = 2, inflationMode = 'real', baseExchangeRate = 1350,
      exchangeScenario = 'base', displayCurrency = 'KRW', taxSettings, spendingStrategy
    } = params;

    const currentTaxSettings: TaxSettings = taxSettings || {
      enableComprehensiveTax: true, enableHealthInsurance: true,
      usDividendTaxRate: 15, domesticDividendTaxRate: 15.4,
      comprehensiveTaxRate: 15, healthInsuranceRate: 5,
    };

    const exchangeRate = this.getExchangeRate(baseExchangeRate, exchangeScenario);
    const { activeAssets, activePensions, activeIsas, infRateAnnual } = this.initializeAssets(params, currentTaxSettings);

    const startAge = userProfile.currentAge;
    const endAge = userProfile.expectancy;
    const totalYears = endAge - startAge + 1;

    if (isNaN(totalYears) || totalYears <= 0) {
      return {
        yearlyResults: [], fireAge: null, depletionAge: null,
        endingAssets: 0, retirementScore: 0, retirementGrade: '위험', goalAchievementRate: 0,
      };
    }

    const yearlyResults: SimulationYearlyResult[] = [];
    let fireAge: number | null = null;
    let depletionAge: number | null = null;

    for (let y = 0; y < totalYears; y++) {
      const currentAge = startAge + y;
      const currentYear = new Date().getFullYear() + y;
      const isRetired = currentAge >= userProfile.retirementAge;

      let annualDividendIncome = 0;
      let annualNationalPensionIncome = 0;
      let annualPrivatePensionIncome = 0;
      let annualOtherIncome = 0;
      let annualSpending = 0;
      let annualDividendTaxPaid = 0;
      let annualPensionTaxPaid = 0;
      let annualNationalPensionTaxPaid = 0;
      let annualPreTaxTotalIncome = 0;
      let annualRawFinancialIncomeKRW = 0;

      let monthlyTargetSpending = 0;
      if (isRetired && spendingStrategy !== 'dividend_only') {
        monthlyTargetSpending = inflationMode === 'nominal'
          ? userProfile.targetMonthlySpending * Math.pow(1 + infRateAnnual, y)
          : userProfile.targetMonthlySpending;
      }

      let monthlyNationalPensionDisplay = 0;
      let monthlyNatTaxDisplay = 0;
      let monthlyNatPreTaxTotalDisplay = 0;
      if (currentAge >= 65) {
        let natAmountRaw = inflationMode === 'nominal'
          ? nationalPension.expectedMonthlyAmount * Math.pow(1 + infRateAnnual, y)
          : nationalPension.expectedMonthlyAmount;
        const natTax = natAmountRaw * 0.02;
        monthlyNationalPensionDisplay = this.convertValue(natAmountRaw - natTax, 'KRW', displayCurrency, exchangeRate);
        monthlyNatTaxDisplay = this.convertValue(natTax, 'KRW', displayCurrency, exchangeRate);
        monthlyNatPreTaxTotalDisplay = this.convertValue(natAmountRaw, 'KRW', displayCurrency, exchangeRate);
      }

      let monthlyOtherIncomeTotalDisplay = 0;
      let monthlyOtherPreTaxTotalDisplay = 0;
      otherIncomes.forEach((income) => {
        let amount = inflationMode === 'nominal'
          ? income.monthlyAmount * Math.pow(1 + infRateAnnual, y)
          : income.monthlyAmount;
        const amountDisplay = this.convertValue(amount, income.currency, displayCurrency, exchangeRate);
        monthlyOtherIncomeTotalDisplay += amountDisplay;
        monthlyOtherPreTaxTotalDisplay += amountDisplay;
      });

      for (let m = 0; m < 12; m++) {
        // ISA Processing
        activeIsas.forEach((isa) => {
          if (isa.currentBalance < 0) isa.currentBalance = 0;
          const growth = isa.currentBalance * isa.returnRateMonthly;
          const dividend = isa.currentBalance * isa.divRateMonthly;
          const monthlyLimit = this.convertValue(20000000 / 12, 'KRW', isa.currency, exchangeRate);
          let contribution = isRetired ? 0 : isa.monthlyContribution;
          if (contribution > monthlyLimit) contribution = monthlyLimit;

          isa.currentBalance += growth + dividend + contribution;
          isa.totalInvested += contribution;
          isa.monthsSinceInception += 1;

          if (isa.monthsSinceInception >= isa.maturityYears * 12) {
            const totalProfit = isa.currentBalance - isa.totalInvested;
            let taxAmount = 0;
            if (totalProfit > 0) {
              const exemptionLimit = this.convertValue(isa.type === 'low_income' ? 4000000 : 2000000, 'KRW', isa.currency, exchangeRate);
              taxAmount = Math.max(0, totalProfit - exemptionLimit) * 0.099;
            }
            const netBalance = isa.currentBalance - taxAmount;
            
            if (activePensions.length > 0) {
              activePensions[0].currentBalance += this.convertValue(netBalance, isa.currency, activePensions[0].currency, exchangeRate);
            } else if (activeAssets.length > 0) {
              activeAssets[0].currentValue += this.convertValue(netBalance, isa.currency, activeAssets[0].currency, exchangeRate);
            }
            isa.currentBalance = 0; isa.totalInvested = 0; isa.monthsSinceInception = 0;
          }
        });

        // Assets Processing
        let monthlyDividendIncomeNetDisplay = 0;
        activeAssets.forEach((asset) => {
          if (asset.currentValue < 0) asset.currentValue = 0;
          const growth = asset.currentValue * asset.growthRateMonthly;
          const dividendRaw = asset.currentValue * asset.divRateMonthly;
          const dividendTax = dividendRaw * asset.taxRate;
          const dividendNet = dividendRaw - dividendTax;

          annualRawFinancialIncomeKRW += this.convertValue(dividendRaw, asset.currency, 'KRW', exchangeRate);

          const contribution = isRetired ? 0 : asset.monthlyContribution;
          asset.currentValue += growth + contribution;

          if (!isRetired && asset.reinvestDividend) {
            asset.currentValue += dividendNet;
          } else {
            monthlyDividendIncomeNetDisplay += this.convertValue(dividendNet, asset.currency, displayCurrency, exchangeRate);
            annualDividendTaxPaid += this.convertValue(dividendTax, asset.currency, displayCurrency, exchangeRate);
            annualPreTaxTotalIncome += this.convertValue(dividendRaw, asset.currency, displayCurrency, exchangeRate);
          }
        });
        annualDividendIncome += monthlyDividendIncomeNetDisplay;

        // Pensions Processing
        let monthlyPensionIncomeNetDisplay = 0;
        activePensions.forEach((pension) => {
          if (pension.currentBalance < 0) pension.currentBalance = 0;
          const growth = pension.currentBalance * pension.returnRateMonthly;
          const contribution = isRetired ? 0 : pension.monthlyContribution;
          pension.currentBalance += growth + contribution;

          if (isRetired && pension.currentBalance > 0) {
            let drawAmountRaw = 0;
            if (spendingStrategy === 'dividend_only' || spendingStrategy === 'max_sustainable') {
              drawAmountRaw = Math.max(0, growth);
            } else {
              const remainingMonths = Math.max(1, (endAge - currentAge) * 12 + (12 - m));
              drawAmountRaw = pension.currentBalance / remainingMonths;
            }
            pension.currentBalance -= drawAmountRaw;

            let taxRate = 0.055;
            if (currentAge >= 70 && currentAge < 80) taxRate = 0.044;
            else if (currentAge >= 80) taxRate = 0.033;

            const drawAmountTax = drawAmountRaw * taxRate;
            const drawAmountNet = drawAmountRaw - drawAmountTax;

            annualRawFinancialIncomeKRW += this.convertValue(drawAmountRaw, pension.currency, 'KRW', exchangeRate);
            monthlyPensionIncomeNetDisplay += this.convertValue(drawAmountNet, pension.currency, displayCurrency, exchangeRate);
            annualPensionTaxPaid += this.convertValue(drawAmountTax, pension.currency, displayCurrency, exchangeRate);
            annualPreTaxTotalIncome += this.convertValue(drawAmountRaw, pension.currency, displayCurrency, exchangeRate);
          }
        });
        annualPrivatePensionIncome += monthlyPensionIncomeNetDisplay;

        // Incomes
        annualNationalPensionIncome += monthlyNationalPensionDisplay;
        annualNationalPensionTaxPaid += monthlyNatTaxDisplay;
        annualPreTaxTotalIncome += monthlyNatPreTaxTotalDisplay;
        
        annualOtherIncome += monthlyOtherIncomeTotalDisplay;
        annualPreTaxTotalIncome += monthlyOtherPreTaxTotalDisplay;

        const monthlyTotalIncome = monthlyDividendIncomeNetDisplay + monthlyPensionIncomeNetDisplay + monthlyNationalPensionDisplay + monthlyOtherIncomeTotalDisplay;
        let actualMonthlySpending = (isRetired && spendingStrategy === 'dividend_only') ? monthlyTotalIncome : monthlyTargetSpending;

        const shortfall = actualMonthlySpending - monthlyTotalIncome;
        if (shortfall < 0 && activeAssets.length > 0) {
          activeAssets[0].currentValue += this.convertValue(-shortfall, displayCurrency, activeAssets[0].currency, exchangeRate);
        } else if (shortfall > 0) {
          let remainingShortfall = shortfall;
          for (const asset of activeAssets) {
            const assetValueDisplay = this.convertValue(asset.currentValue, asset.currency, displayCurrency, exchangeRate);
            if (assetValueDisplay >= remainingShortfall) {
              asset.currentValue -= this.convertValue(remainingShortfall, displayCurrency, asset.currency, exchangeRate);
              remainingShortfall = 0; break;
            } else {
              remainingShortfall -= assetValueDisplay; asset.currentValue = 0;
            }
          }

          if (remainingShortfall > 0) {
            let taxRate = currentAge >= 80 ? 0.033 : (currentAge >= 70 ? 0.044 : 0.055);
            for (const pension of activePensions) {
              const pensionValueNetDisplay = this.convertValue(pension.currentBalance, pension.currency, displayCurrency, exchangeRate) * (1 - taxRate);
              if (pensionValueNetDisplay >= remainingShortfall) {
                pension.currentBalance -= this.convertValue(remainingShortfall / (1 - taxRate), displayCurrency, pension.currency, exchangeRate);
                remainingShortfall = 0; break;
              } else {
                remainingShortfall -= pensionValueNetDisplay; pension.currentBalance = 0;
              }
            }
          }
          if (remainingShortfall > 0) actualMonthlySpending -= remainingShortfall;
        }
        annualSpending += actualMonthlySpending;
      }

      // Taxes
      let annualComprehensiveTaxPaidDisplay = 0;
      let annualHealthInsurancePaidDisplay = 0;
      if (currentTaxSettings.enableComprehensiveTax && annualRawFinancialIncomeKRW > 20000000) {
        const excessKRW = annualRawFinancialIncomeKRW - 20000000;
        annualComprehensiveTaxPaidDisplay = this.convertValue(excessKRW * (currentTaxSettings.comprehensiveTaxRate / 100), 'KRW', displayCurrency, exchangeRate);
        if (currentTaxSettings.enableHealthInsurance) {
          annualHealthInsurancePaidDisplay = this.convertValue(excessKRW * (currentTaxSettings.healthInsuranceRate / 100), 'KRW', displayCurrency, exchangeRate);
        }
        
        let remainingTax = annualComprehensiveTaxPaidDisplay + annualHealthInsurancePaidDisplay;
        for (const asset of activeAssets) {
            const assetValueDisplay = this.convertValue(asset.currentValue, asset.currency, displayCurrency, exchangeRate);
            const deduct = Math.min(remainingTax, assetValueDisplay);
            asset.currentValue -= this.convertValue(deduct, displayCurrency, asset.currency, exchangeRate);
            remainingTax -= deduct;
            if (remainingTax <= 0) break;
        }
      }

      let stockAssetsDisplay = activeAssets.reduce((sum, a) => sum + this.convertValue(a.currentValue, a.currency, displayCurrency, exchangeRate), 0);
      let pensionAssetsDisplay = activePensions.reduce((sum, p) => sum + this.convertValue(p.currentBalance, p.currency, displayCurrency, exchangeRate), 0);
      let isaAssetsDisplay = activeIsas.reduce((sum, i) => sum + this.convertValue(i.currentBalance, i.currency, displayCurrency, exchangeRate), 0);
      const totalAssetsDisplay = stockAssetsDisplay + pensionAssetsDisplay + isaAssetsDisplay;

      const hasTaxWarning = annualRawFinancialIncomeKRW > 20000000;
      const pensionIncome = annualNationalPensionIncome + annualPrivatePensionIncome;
      const totalIncome = annualDividendIncome + pensionIncome + annualOtherIncome - annualComprehensiveTaxPaidDisplay - annualHealthInsurancePaidDisplay;

      yearlyResults.push({
        age: currentAge, year: currentYear, totalAssets: totalAssetsDisplay,
        stockAssets: stockAssetsDisplay, pensionAssets: pensionAssetsDisplay,
        dividendIncome: annualDividendIncome, nationalPensionIncome: annualNationalPensionIncome,
        privatePensionIncome: annualPrivatePensionIncome, pensionIncome, otherIncome: annualOtherIncome,
        totalIncome, spending: annualSpending, hasTaxWarning, preTaxTotalIncome: annualPreTaxTotalIncome,
        dividendTaxPaid: annualDividendTaxPaid, pensionTaxPaid: annualPensionTaxPaid,
        nationalPensionTaxPaid: annualNationalPensionTaxPaid, comprehensiveTaxPaid: annualComprehensiveTaxPaidDisplay,
        healthInsurancePaid: annualHealthInsurancePaidDisplay,
      });

      if (totalAssetsDisplay <= 0 && depletionAge === null) depletionAge = currentAge;

      const targetSpendingForFIRE = inflationMode === 'nominal'
        ? userProfile.targetMonthlySpending * 12 * Math.pow(1 + inflationRate / 100, y)
        : userProfile.targetMonthlySpending * 12;
      
      if (totalIncome >= targetSpendingForFIRE && fireAge === null) fireAge = currentAge;
    }

    const retirementYearsResults = yearlyResults.filter((r) => r.age >= userProfile.retirementAge);
    let avgRetirementMonthlyIncome = 0;
    let avgTargetMonthlySpending = 0;
    
    if (retirementYearsResults.length > 0) {
      const totalIncomeSum = retirementYearsResults.reduce((sum, r) => sum + r.totalIncome, 0);
      let totalTargetSum = 0;
      retirementYearsResults.forEach(r => {
          let annualTarget = userProfile.targetMonthlySpending * 12;
          if (inflationMode === 'nominal') {
              annualTarget = annualTarget * Math.pow(1 + inflationRate / 100, r.age - startAge);
          }
          totalTargetSum += annualTarget;
      });

      avgRetirementMonthlyIncome = totalIncomeSum / retirementYearsResults.length / 12;
      avgTargetMonthlySpending = totalTargetSum / retirementYearsResults.length / 12;
    }

    const goalAchievementRate = avgTargetMonthlySpending > 0
      ? Math.min(200, Math.max(0, Math.round((avgRetirementMonthlyIncome / avgTargetMonthlySpending) * 100))) : 0;

    const endingAssets = yearlyResults.length > 0 ? yearlyResults[yearlyResults.length - 1].totalAssets : 0;

    const { retirementScore, retirementGrade } = this.calculateRetirementScore(
      yearlyResults, userProfile, goalAchievementRate, depletionAge, inflationMode, inflationRate
    );

    return {
      yearlyResults,
      fireAge: fireAge === null || fireAge >= userProfile.expectancy ? null : fireAge,
      depletionAge,
      endingAssets,
      retirementScore,
      retirementGrade,
      goalAchievementRate,
    };
  }
}
