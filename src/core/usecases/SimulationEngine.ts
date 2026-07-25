import {
  SimulationParams,
  SimulationResult,
  SimulationYearlyResult,
  InvestmentAsset,
  PrivatePension,
  IsaAccount,
  AssetCurrency,
  TaxSettings,
  PrivatePensionTaxationMethod,
} from '../entities/types';
import { getRetirementGrade, RetirementGrade } from '../entities/retirementGrade';
import { computeLifetimeUtility } from './utility/UtilityEngine';
import {
  getDividendTaxRate,
  getPrivatePensionIncomeTaxRate,
  calculateNationalPensionTaxKRW,
  getIsaExemptionLimitKRW,
  calculateIsaMaturityTax,
  calculateComprehensiveTaxAndHealthInsuranceKRW,
  calculatePrivatePensionExcessTaxNeededKRW,
} from './tax/TaxEngine';
import { resolveTaxSettings } from './tax/taxRates';
import {
  getNationalPensionAdjustmentFactor,
  NATIONAL_PENSION_NORMAL_START_AGE,
  NATIONAL_PENSION_EARLY_MIN_AGE,
  NATIONAL_PENSION_DEFERRED_MAX_AGE,
} from './pension/nationalPensionRules';
import { PRIVATE_PENSION_MIN_START_AGE, clampPrivatePensionStartAge } from './pension/privatePensionRules';
import { sortAssetsForWithdrawal } from './strategy/assetOrdering';

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

    let result: SimulationResult;
    if (strategy === 'max_sustainable') {
      result = this.findMaxSustainable(params);
    } else {
      const mainResult = this.runSingle(params);
      const maxSustainable = this.findMaxSustainableValue(params);
      result = { ...mainResult, calculatedTargetSpending: maxSustainable };
    }

    const utility = computeLifetimeUtility(result, params);
    return { ...result, utility };
  }

  // Utility(효용) 계산 목적으로만 결과가 필요할 때 쓰는 경량 버전. run()은 'max_sustainable'이
  // 아닌 전략에서도 항상 findMaxSustainableValue()로 30회 이진탐색을 추가 수행해
  // calculatedTargetSpending을 구하지만, computeLifetimeUtility는 이 값을 쓰지 않으므로
  // 후보를 대량으로 평가하는 RecommendationEngine 같은 곳에서는 이 탐색이 순수 낭비다.
  // 'max_sustainable' 전략은 이진탐색 자체가 실제 인출액을 결정하는 계산이라 생략할 수 없다.
  runForUtility(params: SimulationParams): SimulationResult {
    const strategy = params.spendingStrategy || 'target';
    if (strategy === 'max_sustainable') {
      return this.run(params);
    }
    const result = this.runSingle(params);
    const utility = computeLifetimeUtility(result, params);
    return { ...result, utility };
  }

  private findMaxSustainableValue(params: SimulationParams): number {
    let low = 0;
    let high = 50000000; // 5천만원/월
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
        bestTarget = mid;
        low = mid;
      } else {
        high = mid;
      }
    }
    return bestTarget;
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
      
      const taxRate = getDividendTaxRate(asset.assetMarket, asset.currency, currentTaxSettings);

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
  ): { retirementScore: number, retirementGrade: RetirementGrade, retirementAssetsAtRetirement: number } {
    // 이미 은퇴 나이를 지난 상태로 입력된 경우(currentAge > retirementAge) yearlyResults에는
    // retirementAge 시점 행이 없으므로, 관측 가능한 첫 해(yearlyResults[0])를 은퇴 시점 자산의
    // 대용치로 사용한다. 0으로 폴백하면 아래 오버라이드 조건이 사실상 항상 참이 되어버린다.
    const retirementStartResult = yearlyResults.find(r => r.age === userProfile.retirementAge) ?? yearlyResults[0];
    const retirementAssets = retirementStartResult.totalAssets;
    
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
    let avgStableIncome = 0;
    
    if (retirementYearsResults.length > 0) {
      const totalSpendingSum = retirementYearsResults.reduce((sum, r) => sum + r.spending, 0);
      // Include dividend income as a stable passive income source
      const totalStableIncomeSum = retirementYearsResults.reduce((sum, r) => sum + r.pensionIncome + r.dividendIncome, 0);
      avgRetirementMonthlySpending = totalSpendingSum / retirementYearsResults.length / 12;
      avgStableIncome = totalStableIncomeSum / retirementYearsResults.length / 12;
    }

    const stableIncomeRatio = avgRetirementMonthlySpending > 0 ? (avgStableIncome / avgRetirementMonthlySpending) * 100 : 100;
    const pensionScore = Math.min(20, (stableIncomeRatio * 0.20));

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

    // Use total invested assets (stock + pension + ISA) to calculate inflation hedge score
    const retirementInvestedAssets = retirementStartResult.stockAssets + retirementStartResult.pensionAssets;
    const investedRatio = retirementAssets > 0 ? (retirementInvestedAssets / retirementAssets) * 100 : 0;
    const inflationScoreRaw = Math.min(100, (investedRatio / 40) * 100);
    const inflationScore = inflationScoreRaw * 0.15;

    let retirementScore = Math.round(assetScore + cashFlowScore + pensionScore + longevityScore + inflationScore);
    
    // Logical override: goalAchievementRate는 배당·연금 등 고정소득만 반영하고 자산 매도·인출분은
    // 제외한 지표라서, 원금을 계획적으로 인출하며 사는 정상적인 시나리오에서는 100%에 거의 도달하지
    // 못한다. 따라서 이 오버라이드는 goalAchievementRate 대신 실제 자산 추이(은퇴 시작 시점 대비
    // 순감소 여부)로 판단한다: 기대수명까지 고갈되지 않고 자산이 은퇴 시작 시점보다 줄지 않았다면
    // 실질적으로 매우 안전한 시나리오이므로 점수 하한을 95점으로 보정한다.
    const endingAssets = yearlyResults.length > 0 ? yearlyResults[yearlyResults.length - 1].totalAssets : 0;
    if (depletionAge === null && endingAssets >= retirementAssets) {
      retirementScore = Math.max(retirementScore, 95);
    }

    // Ensure max score is 100
    retirementScore = Math.min(100, retirementScore);

    const retirementGrade = getRetirementGrade(retirementScore);

    return { retirementScore, retirementGrade, retirementAssetsAtRetirement: retirementAssets };
  }

  runSingle(params: SimulationParams): SimulationResult {
    if (!params || !params.userProfile) {
      return {
        yearlyResults: [], fireAge: null, depletionAge: null,
        endingAssets: 0, retirementScore: 0, retirementGrade: '위험', goalAchievementRate: 0, retirementAssetsAtRetirement: 0,
      };
    }

    const {
      userProfile, nationalPension = { expectedMonthlyAmount: 0 }, otherIncomes = [],
      inflationRate = 2, inflationMode = 'real', baseExchangeRate = 1350,
      exchangeScenario = 'base', displayCurrency = 'KRW', taxSettings, spendingStrategy,
      withdrawalPlan
    } = params;

    const currentTaxSettings: TaxSettings = resolveTaxSettings(taxSettings);

    const exchangeRate = this.getExchangeRate(baseExchangeRate, exchangeScenario);
    const { activeAssets, activePensions, activeIsas, infRateAnnual } = this.initializeAssets(params, currentTaxSettings);
    // dividendYield는 시간에 따라 변하지 않으므로 인출 순서를 한 번만 계산해 재사용한다.
    // 원본 activeAssets 배열(순서)은 잉여현금 재투자·ISA 만기 이동 등 다른 로직에서 그대로 쓰인다.
    const withdrawalOrderedAssets = sortAssetsForWithdrawal(activeAssets, withdrawalPlan?.assetSellOrderStrategy);

    const startAge = userProfile.currentAge;
    const endAge = userProfile.expectancy;
    const totalYears = endAge - startAge + 1;

    if (isNaN(totalYears) || totalYears <= 0) {
      return {
        yearlyResults: [], fireAge: null, depletionAge: null,
        endingAssets: 0, retirementScore: 0, retirementGrade: '위험', goalAchievementRate: 0, retirementAssetsAtRetirement: 0,
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
      let annualPrivatePensionPreTaxKRW = 0;
      let annualNationalPensionPreTaxKRW = 0;

      let monthlyTargetSpending = 0;
      if (isRetired && spendingStrategy !== 'dividend_only') {
        monthlyTargetSpending = inflationMode === 'nominal'
          ? userProfile.targetMonthlySpending * Math.pow(1 + infRateAnnual, y)
          : userProfile.targetMonthlySpending;
      }

      let monthlyNationalPensionDisplay = 0;
      let monthlyNatTaxDisplay = 0;
      let monthlyNatPreTaxTotalDisplay = 0;
      const nationalPensionStartAge = Math.min(
        NATIONAL_PENSION_DEFERRED_MAX_AGE,
        Math.max(NATIONAL_PENSION_EARLY_MIN_AGE, withdrawalPlan?.nationalPensionStartAge ?? NATIONAL_PENSION_NORMAL_START_AGE)
      );
      if (currentAge >= nationalPensionStartAge) {
        const nationalPensionAdjustmentFactor = getNationalPensionAdjustmentFactor(nationalPensionStartAge);
        let natAmountRaw = (inflationMode === 'nominal'
          ? nationalPension.expectedMonthlyAmount * Math.pow(1 + infRateAnnual, y)
          : nationalPension.expectedMonthlyAmount) * nationalPensionAdjustmentFactor;
        const natTax = calculateNationalPensionTaxKRW(natAmountRaw);
        monthlyNationalPensionDisplay = this.convertValue(natAmountRaw - natTax, 'KRW', displayCurrency, exchangeRate);
        monthlyNatTaxDisplay = this.convertValue(natTax, 'KRW', displayCurrency, exchangeRate);
        monthlyNatPreTaxTotalDisplay = this.convertValue(natAmountRaw, 'KRW', displayCurrency, exchangeRate);
        annualNationalPensionPreTaxKRW = natAmountRaw * 12;
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

          const divDisplay = this.convertValue(dividend, isa.currency, displayCurrency, exchangeRate);
          annualDividendIncome += divDisplay;
          annualPreTaxTotalIncome += divDisplay;

          if (isa.monthsSinceInception >= isa.maturityYears * 12) {
            const totalProfit = isa.currentBalance - isa.totalInvested;
            const exemptionLimit = this.convertValue(getIsaExemptionLimitKRW(isa.type), 'KRW', isa.currency, exchangeRate);
            const taxAmount = calculateIsaMaturityTax(totalProfit, exemptionLimit);
            const netBalance = isa.currentBalance - taxAmount;
            const preferPension = (withdrawalPlan?.isaMaturityDestination ?? 'pension') === 'pension';

            if (preferPension && activePensions.length > 0) {
              activePensions[0].currentBalance += this.convertValue(netBalance, isa.currency, activePensions[0].currency, exchangeRate);
            } else if (!preferPension && activeAssets.length > 0) {
              activeAssets[0].currentValue += this.convertValue(netBalance, isa.currency, activeAssets[0].currency, exchangeRate);
            } else if (activePensions.length > 0) {
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
            annualDividendIncome += this.convertValue(dividendNet, asset.currency, displayCurrency, exchangeRate);
            annualDividendTaxPaid += this.convertValue(dividendTax, asset.currency, displayCurrency, exchangeRate);
            annualPreTaxTotalIncome += this.convertValue(dividendRaw, asset.currency, displayCurrency, exchangeRate);
          } else {
            monthlyDividendIncomeNetDisplay += this.convertValue(dividendNet, asset.currency, displayCurrency, exchangeRate);
            annualDividendTaxPaid += this.convertValue(dividendTax, asset.currency, displayCurrency, exchangeRate);
            annualPreTaxTotalIncome += this.convertValue(dividendRaw, asset.currency, displayCurrency, exchangeRate);
          }
        });
        annualDividendIncome += monthlyDividendIncomeNetDisplay;

        // Pensions Processing
        let monthlyPensionIncomeNetDisplay = 0;
        let monthlyPensionPreTaxLimitRemainingKRW = (currentTaxSettings.privatePensionLimit ?? 15000000) / 12;
        // privatePensionMonthlyTarget은 계좌 개별이 아닌 "전체 사적연금 계좌 합산" 목표액이다.
        // 계좌를 순서대로 처리하며 이 잔여 목표액만큼만 인출하도록 공유 상태로 관리한다.
        let remainingMonthlyPensionTargetKRW = withdrawalPlan?.privatePensionMonthlyTarget;

        activePensions.forEach((pension) => {
          if (pension.currentBalance < 0) pension.currentBalance = 0;
          const growth = pension.currentBalance * pension.returnRateMonthly;
          const contribution = isRetired ? 0 : pension.monthlyContribution;
          pension.currentBalance += growth + contribution;

          if (isRetired && pension.currentBalance > 0) {
            let drawAmountRaw = 0;
            const planStartAge = clampPrivatePensionStartAge(withdrawalPlan?.privatePensionStartAge ?? userProfile.retirementAge);
            const pensionWithdrawalsStarted = currentAge >= planStartAge;

            if (pensionWithdrawalsStarted) {
              if (remainingMonthlyPensionTargetKRW !== undefined) {
                const targetInPensionCurrency = this.convertValue(
                  Math.max(0, remainingMonthlyPensionTargetKRW), 'KRW', pension.currency, exchangeRate
                );
                drawAmountRaw = Math.min(pension.currentBalance, targetInPensionCurrency);
                remainingMonthlyPensionTargetKRW -= this.convertValue(drawAmountRaw, pension.currency, 'KRW', exchangeRate);
              } else if (spendingStrategy === 'dividend_only' || spendingStrategy === 'max_sustainable') {
                drawAmountRaw = Math.max(0, growth);
              } else {
                const remainingMonths = Math.max(1, (endAge - currentAge) * 12 + (12 - m));
                drawAmountRaw = pension.currentBalance / remainingMonths;
              }
            }

            if (currentTaxSettings.limitPrivatePensionToTaxLimit) {
              const remainingLimitInPensionCurrency = this.convertValue(monthlyPensionPreTaxLimitRemainingKRW, 'KRW', pension.currency, exchangeRate);
              drawAmountRaw = Math.min(drawAmountRaw, Math.max(0, remainingLimitInPensionCurrency));
              monthlyPensionPreTaxLimitRemainingKRW -= this.convertValue(drawAmountRaw, pension.currency, 'KRW', exchangeRate);
            }

            pension.currentBalance -= drawAmountRaw;

            const taxRate = getPrivatePensionIncomeTaxRate(currentAge);

            const drawAmountTax = drawAmountRaw * taxRate;
            const drawAmountNet = drawAmountRaw - drawAmountTax;

            monthlyPensionIncomeNetDisplay += this.convertValue(drawAmountNet, pension.currency, displayCurrency, exchangeRate);
            annualPensionTaxPaid += this.convertValue(drawAmountTax, pension.currency, displayCurrency, exchangeRate);
            annualPreTaxTotalIncome += this.convertValue(drawAmountRaw, pension.currency, displayCurrency, exchangeRate);
            annualPrivatePensionPreTaxKRW += this.convertValue(drawAmountRaw, pension.currency, 'KRW', exchangeRate);
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
          const generalAssetWithdrawalStartAge = withdrawalPlan?.generalAssetWithdrawalStartAge ?? userProfile.retirementAge;
          if (currentAge >= generalAssetWithdrawalStartAge) {
            for (const asset of withdrawalOrderedAssets) {
              const assetValueDisplay = this.convertValue(asset.currentValue, asset.currency, displayCurrency, exchangeRate);
              if (assetValueDisplay >= remainingShortfall) {
                asset.currentValue -= this.convertValue(remainingShortfall, displayCurrency, asset.currency, exchangeRate);
                remainingShortfall = 0; break;
              } else {
                remainingShortfall -= assetValueDisplay; asset.currentValue = 0;
              }
            }
          }

          // 55세 미만은 사적연금(IRP/연금저축) 법정 인출 자체가 불가능하므로, 부족분이 있어도
          // 조기 인출로 충당하지 않는다 — 이 경우 부족분은 실제 생활비 미충족으로 남는다.
          if (remainingShortfall > 0 && currentAge >= PRIVATE_PENSION_MIN_START_AGE) {
            const taxRate = getPrivatePensionIncomeTaxRate(currentAge);
            for (const pension of activePensions) {
              let pensionValueNetDisplay = this.convertValue(pension.currentBalance, pension.currency, displayCurrency, exchangeRate) * (1 - taxRate);
              
              if (currentTaxSettings.limitPrivatePensionToTaxLimit) {
                const remainingLimitInPensionCurrency = this.convertValue(monthlyPensionPreTaxLimitRemainingKRW, 'KRW', pension.currency, exchangeRate);
                const maxAllowedDrawNetDisplay = this.convertValue(remainingLimitInPensionCurrency * (1 - taxRate), pension.currency, displayCurrency, exchangeRate);
                pensionValueNetDisplay = Math.min(pensionValueNetDisplay, Math.max(0, maxAllowedDrawNetDisplay));
              }

              if (pensionValueNetDisplay >= remainingShortfall) {
                const drawPreTax = remainingShortfall / (1 - taxRate);
                pension.currentBalance -= this.convertValue(drawPreTax, displayCurrency, pension.currency, exchangeRate);
                if (currentTaxSettings.limitPrivatePensionToTaxLimit) {
                  monthlyPensionPreTaxLimitRemainingKRW -= this.convertValue(drawPreTax, displayCurrency, 'KRW', exchangeRate);
                }
                
                // Update pension income variables with the shortfall drawing
                const drawAmountTax = drawPreTax * taxRate;
                const drawAmountNet = drawPreTax - drawAmountTax;
                const drawAmountNetDisplay = this.convertValue(drawAmountNet, pension.currency, displayCurrency, exchangeRate);
                monthlyPensionIncomeNetDisplay += drawAmountNetDisplay;
                annualPrivatePensionIncome += drawAmountNetDisplay;
                annualPensionTaxPaid += this.convertValue(drawAmountTax, pension.currency, displayCurrency, exchangeRate);
                annualPreTaxTotalIncome += this.convertValue(drawPreTax, pension.currency, displayCurrency, exchangeRate);
                annualPrivatePensionPreTaxKRW += this.convertValue(drawPreTax, pension.currency, 'KRW', exchangeRate);

                remainingShortfall = 0; break;
              } else {
                if (pensionValueNetDisplay > 0) {
                  const drawPreTax = pensionValueNetDisplay / (1 - taxRate);
                  remainingShortfall -= pensionValueNetDisplay;
                  pension.currentBalance -= this.convertValue(drawPreTax, displayCurrency, pension.currency, exchangeRate);
                  if (currentTaxSettings.limitPrivatePensionToTaxLimit) {
                    monthlyPensionPreTaxLimitRemainingKRW -= this.convertValue(drawPreTax, displayCurrency, 'KRW', exchangeRate);
                  }

                  const drawAmountTax = drawPreTax * taxRate;
                  const drawAmountNet = drawPreTax - drawAmountTax;
                  const drawAmountNetDisplay = this.convertValue(drawAmountNet, pension.currency, displayCurrency, exchangeRate);
                  monthlyPensionIncomeNetDisplay += drawAmountNetDisplay;
                  annualPrivatePensionIncome += drawAmountNetDisplay;
                  annualPensionTaxPaid += this.convertValue(drawAmountTax, pension.currency, displayCurrency, exchangeRate);
                  annualPreTaxTotalIncome += this.convertValue(drawPreTax, pension.currency, displayCurrency, exchangeRate);
                  annualPrivatePensionPreTaxKRW += this.convertValue(drawPreTax, pension.currency, 'KRW', exchangeRate);
                }
              }
            }
          }
          if (remainingShortfall > 0) actualMonthlySpending -= remainingShortfall;
        }
        annualSpending += actualMonthlySpending;
      }

      // Taxes
      const { comprehensiveTaxKRW, healthInsuranceKRW } = calculateComprehensiveTaxAndHealthInsuranceKRW(
        {
          annualRawFinancialIncomeKRW,
          annualRawPensionIncomeKRW: annualPrivatePensionPreTaxKRW + annualNationalPensionPreTaxKRW,
        },
        currentTaxSettings
      );
      const annualComprehensiveTaxPaidDisplay = this.convertValue(comprehensiveTaxKRW, 'KRW', displayCurrency, exchangeRate);
      const annualHealthInsurancePaidDisplay = this.convertValue(healthInsuranceKRW, 'KRW', displayCurrency, exchangeRate);

      {
        let remainingTax = annualComprehensiveTaxPaidDisplay + annualHealthInsurancePaidDisplay;
        for (const asset of withdrawalOrderedAssets) {
            const assetValueDisplay = this.convertValue(asset.currentValue, asset.currency, displayCurrency, exchangeRate);
            const deduct = Math.min(remainingTax, assetValueDisplay);
            asset.currentValue -= this.convertValue(deduct, displayCurrency, asset.currency, exchangeRate);
            remainingTax -= deduct;
            if (remainingTax <= 0) break;
        }

        // 초과세도 실질적으로 배당소득에서 빠져나가는 비용이므로 표시되는 배당소득에도 반영한다.
        annualDividendIncome = Math.max(0, annualDividendIncome - annualComprehensiveTaxPaidDisplay - annualHealthInsurancePaidDisplay);
      }

      // Private pension high tax threshold adjustment
      let privatePensionTaxMethod: PrivatePensionTaxationMethod = 'none';
      {
        const { taxKRW: totalPensionTaxNeededKRW, method } = calculatePrivatePensionExcessTaxNeededKRW(annualPrivatePensionPreTaxKRW, currentTaxSettings);
        privatePensionTaxMethod = method;
        const totalPensionTaxNeededDisplay = this.convertValue(totalPensionTaxNeededKRW, 'KRW', displayCurrency, exchangeRate);
        const pensionTaxAdjustmentDisplay = Math.max(0, totalPensionTaxNeededDisplay - annualPensionTaxPaid);

        let remainingTax = pensionTaxAdjustmentDisplay;
        for (const asset of withdrawalOrderedAssets) {
          const assetValueDisplay = this.convertValue(asset.currentValue, asset.currency, displayCurrency, exchangeRate);
          const deduct = Math.min(remainingTax, assetValueDisplay);
          asset.currentValue -= this.convertValue(deduct, displayCurrency, asset.currency, exchangeRate);
          remainingTax -= deduct;
          if (remainingTax <= 0) break;
        }
        if (remainingTax > 0) {
          for (const pension of activePensions) {
            const pensionValueDisplay = this.convertValue(pension.currentBalance, pension.currency, displayCurrency, exchangeRate);
            const deduct = Math.min(remainingTax, pensionValueDisplay);
            pension.currentBalance -= this.convertValue(deduct, displayCurrency, pension.currency, exchangeRate);
            remainingTax -= deduct;
            if (remainingTax <= 0) break;
          }
        }
        annualPensionTaxPaid += pensionTaxAdjustmentDisplay;
        // 초과세도 실질적으로 사적연금 소득에서 빠져나가는 비용이므로 표시되는 소득에도 반영한다.
        annualPrivatePensionIncome = Math.max(0, annualPrivatePensionIncome - pensionTaxAdjustmentDisplay);
      }

      let stockAssetsDisplay = activeAssets.reduce((sum, a) => sum + this.convertValue(a.currentValue, a.currency, displayCurrency, exchangeRate), 0);
      let pensionAssetsDisplay = activePensions.reduce((sum, p) => sum + this.convertValue(p.currentBalance, p.currency, displayCurrency, exchangeRate), 0);
      let isaAssetsDisplay = activeIsas.reduce((sum, i) => sum + this.convertValue(i.currentBalance, i.currency, displayCurrency, exchangeRate), 0);
      const totalAssetsDisplay = stockAssetsDisplay + pensionAssetsDisplay + isaAssetsDisplay;

      const hasTaxWarning = annualRawFinancialIncomeKRW > 20000000;
      const pensionIncome = annualNationalPensionIncome + annualPrivatePensionIncome;
      const totalIncome = annualDividendIncome + pensionIncome + annualOtherIncome;

      yearlyResults.push({
        age: currentAge, year: currentYear, totalAssets: totalAssetsDisplay,
        stockAssets: stockAssetsDisplay, pensionAssets: pensionAssetsDisplay,
        dividendIncome: annualDividendIncome, nationalPensionIncome: annualNationalPensionIncome,
        privatePensionIncome: annualPrivatePensionIncome, pensionIncome, otherIncome: annualOtherIncome,
        totalIncome, spending: annualSpending, hasTaxWarning, preTaxTotalIncome: annualPreTaxTotalIncome,
        dividendTaxPaid: annualDividendTaxPaid, pensionTaxPaid: annualPensionTaxPaid,
        nationalPensionTaxPaid: annualNationalPensionTaxPaid, comprehensiveTaxPaid: annualComprehensiveTaxPaidDisplay,
        healthInsurancePaid: annualHealthInsurancePaidDisplay, privatePensionTaxMethod,
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

    const { retirementScore, retirementGrade, retirementAssetsAtRetirement } = this.calculateRetirementScore(
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
      retirementAssetsAtRetirement,
    };
  }
}
