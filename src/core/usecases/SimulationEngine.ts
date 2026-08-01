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
  UtilityConfig,
} from '../entities/types';
import { getRetirementGrade, RetirementGrade } from '../entities/retirementGrade';
import { computeLifetimeUtility } from './utility/UtilityEngine';
import { computeAnnualHealthcareCost } from './healthcare/healthcareCosts';
import { DEFAULT_UTILITY_CONFIG } from './utility/utilityWeights';
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
import {
  computeHouseholdEndAge, computeSpendingFactor, computeSpouseNationalPensionMonthly,
  computeSurvivorPensionMonthly, resolveSpouse,
} from './spouse/spouseRules';

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
  // cfg는 목표 우선순위(UtilityConfig.weights)를 반영한 효용 계산에 쓰인다. 생략하면
  // 기본 가중치(DEFAULT_UTILITY_CONFIG)로 계산되어 호출부 9곳(RecommendationEngine 등,
  // 전부 자체적으로 cfg를 다루거나 기본값으로 충분한 곳)의 기존 동작이 그대로 유지된다.
  run(params: SimulationParams, cfg: UtilityConfig = DEFAULT_UTILITY_CONFIG): SimulationResult {
    const strategy = params.spendingStrategy || 'target';

    let result: SimulationResult;
    if (strategy === 'max_sustainable') {
      result = this.findMaxSustainable(params);
    } else {
      const mainResult = this.runSingle(params);
      const maxSustainable = this.findMaxSustainableValue(params);
      result = { ...mainResult, calculatedTargetSpending: maxSustainable };
    }

    const utility = computeLifetimeUtility(result, params, cfg);
    return { ...result, utility };
  }

  // Utility(효용) 계산 목적으로만 결과가 필요할 때 쓰는 경량 버전. run()은 'max_sustainable'이
  // 아닌 전략에서도 항상 findMaxSustainableValue()로 30회 이진탐색을 추가 수행해
  // calculatedTargetSpending을 구하지만, computeLifetimeUtility는 이 값을 쓰지 않으므로
  // 후보를 대량으로 평가하는 RecommendationEngine 같은 곳에서는 이 탐색이 순수 낭비다.
  // 'max_sustainable' 전략은 이진탐색 자체가 실제 인출액을 결정하는 계산이라 생략할 수 없다.
  runForUtility(params: SimulationParams, cfg: UtilityConfig = DEFAULT_UTILITY_CONFIG): SimulationResult {
    const strategy = params.spendingStrategy || 'target';
    if (strategy === 'max_sustainable') {
      return this.run(params, cfg);
    }
    const result = this.runSingle(params);
    const utility = computeLifetimeUtility(result, params, cfg);
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
    inflationRate: number,
    // 시뮬레이션이 실제로 돈 종료 나이(= computeHouseholdEndAge). 배우자가 본인보다 오래 살면
    // userProfile.expectancy보다 크다. 호출부가 루프에 쓴 값을 그대로 넘겨받아 재유도하지 않는다.
    householdEndAge: number
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
        // 본인 기대수명이 아니라 가구 종료 나이로 정규화한다. 배우자 단독 생존 기간에
        // 고갈되는 계획이 clamp(=100) 때문에 "고갈 없음"과 같은 점수를 받으면 안 된다.
        const retirementSpan = householdEndAge - userProfile.retirementAge;
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
        householdEndAge: 0,
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
    const resolvedSpouse = resolveSpouse(params.spouse, userProfile);
    const endAge = computeHouseholdEndAge(userProfile, resolvedSpouse);
    const totalYears = endAge - startAge + 1;

    if (isNaN(totalYears) || totalYears <= 0) {
      return {
        yearlyResults: [], fireAge: null, depletionAge: null,
        endingAssets: 0, retirementScore: 0, retirementGrade: '위험', goalAchievementRate: 0, retirementAssetsAtRetirement: 0,
        householdEndAge: isNaN(endAge) ? 0 : endAge,
      };
    }

    const yearlyResults: SimulationYearlyResult[] = [];
    let fireAge: number | null = null;
    let depletionAge: number | null = null;

    for (let y = 0; y < totalYears; y++) {
      const currentAge = startAge + y;
      const currentYear = new Date().getFullYear() + y;
      const isRetired = currentAge >= userProfile.retirementAge;

      // 생존 판정. 기대수명 "까지"는 생존으로 본다(기존 endAge 포함 루프와 일관).
      const selfAlive = currentAge <= userProfile.expectancy;
      const spouseAlive = resolvedSpouse !== null && currentAge <= resolvedSpouse.deathAtSelfAge;
      // 배우자가 없으면 본인 생존 기간만 돌므로 계수는 항상 1이다.
      const spendingFactor = resolvedSpouse === null ? 1 : computeSpendingFactor(selfAlive, spouseAlive);

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

      // 생활비와 별개의 지출 라인. 은퇴 후에만 발생하며 spending에 합산된다.
      // infRateAnnual은 소수(inflationRate / 100)이므로 % 단위로 되돌려 넘긴다.
      const annualHealthcareCost = computeAnnualHealthcareCost({
        healthcare: params.healthcare,
        currentAge,
        retirementAge: userProfile.retirementAge,
        yearsSinceRetirement: currentAge - userProfile.retirementAge,
        inflationMode,
        inflationRate: infRateAnnual * 100,
        // 생활비와 같은 계수를 쓴다 — 의료비만 안 줄면 본인 사후에도 전액이 나간다.
        spendingFactor,
      });
      const monthlyHealthcareCost = annualHealthcareCost / 12;

      let monthlyTargetSpending = 0;
      if (isRetired && spendingStrategy !== 'dividend_only') {
        const baseMonthly = inflationMode === 'nominal'
          ? userProfile.targetMonthlySpending * Math.pow(1 + infRateAnnual, y)
          : userProfile.targetMonthlySpending;
        monthlyTargetSpending = baseMonthly * spendingFactor;
      }
      // 의료비는 목표 생활비와 같은 재원(자산 인출)에서 나가므로 월 단위로 환산해 더한다.
      // 가구 규모 계수는 computeAnnualHealthcareCost 안에서 이미 곱해져 있으므로 여기서
      // 다시 곱하지 않는다(이중 적용 금지).
      monthlyTargetSpending += monthlyHealthcareCost;

      let monthlyNationalPensionDisplay = 0;
      let monthlyNatTaxDisplay = 0;
      let monthlyNatPreTaxTotalDisplay = 0;
      const nationalPensionStartAge = Math.min(
        NATIONAL_PENSION_DEFERRED_MAX_AGE,
        Math.max(NATIONAL_PENSION_EARLY_MIN_AGE, withdrawalPlan?.nationalPensionStartAge ?? NATIONAL_PENSION_NORMAL_START_AGE)
      );
      // 본인과 배우자는 각자의 개시 나이로 따로 판정한다. 배우자가 본인보다 나이가 많으면
      // 본인이 아직 개시 전이어도 배우자는 이미 수령 중일 수 있으므로, 이 블록의 진입 조건을
      // 본인 개시 나이에만 걸면 그 기간의 배우자 연금이 조용히 사라진다.
      // 배우자가 없으면(resolvedSpouse === null) 조건은 기존과 완전히 동일하다.
      const selfNationalPensionStarted = currentAge >= nationalPensionStartAge;
      if (selfNationalPensionStarted || resolvedSpouse !== null) {
        const nationalPensionAdjustmentFactor = getNationalPensionAdjustmentFactor(nationalPensionStartAge);
        let natAmountRaw = selfNationalPensionStarted
          ? (inflationMode === 'nominal'
            ? nationalPension.expectedMonthlyAmount * Math.pow(1 + infRateAnnual, y)
            : nationalPension.expectedMonthlyAmount) * nationalPensionAdjustmentFactor
          : 0;

        // 배우자 국민연금 합산. 사망자가 생기면 중복조정으로 큰 쪽만 남는다.
        if (resolvedSpouse !== null) {
          const spouseMonthlyBase = computeSpouseNationalPensionMonthly(resolvedSpouse, currentAge);
          const spouseMonthly = inflationMode === 'nominal'
            ? spouseMonthlyBase * Math.pow(1 + infRateAnnual, y)
            : spouseMonthlyBase;

          if (selfAlive && spouseAlive) {
            natAmountRaw += spouseMonthly;
          } else if (spouseAlive) {
            // 본인 사망 → 배우자가 생존자. 본인 연금을 유족연금으로 승계 판정.
            natAmountRaw = computeSurvivorPensionMonthly(spouseMonthly, natAmountRaw);
          } else {
            // 배우자 사망 → 본인이 생존자.
            natAmountRaw = computeSurvivorPensionMonthly(natAmountRaw, spouseMonthly);
          }
        }

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
        // 사적연금 조기수령 채널링(Phase 4)의 브릿지 인출은 activeIsas[0]에 별도 크레딧을
        // 더하는데(Pensions Processing 블록, 이달 뒤에서 실행), 이 크레딧도 월 법정 한도
        // (20,000,000/12원)를 공유해야 한다 — 그렇지 않으면 이미 한도를 다 채운 ISA가 브릿지
        // 크레딧으로 한도를 초과해 납입받는 셈이 된다. activeIsas[0]의 이번 달 잔여 한도(=
        // monthlyLimit - contribution, isa.currency 기준)를 여기 기록해 뒀다가 Pensions
        // Processing에서 그대로 재사용한다. 매달(이 for-m 블록) 새로 계산되므로 자동으로 리셋된다.
        let isaBridgeRoomRemainingInIsaCurrency = 0;
        activeIsas.forEach((isa, isaIdx) => {
          if (isa.currentBalance < 0) isa.currentBalance = 0;
          const growth = isa.currentBalance * isa.returnRateMonthly;
          const dividend = isa.currentBalance * isa.divRateMonthly;
          const monthlyLimit = this.convertValue(20000000 / 12, 'KRW', isa.currency, exchangeRate);
          let contribution = isRetired ? 0 : isa.monthlyContribution;
          if (contribution > monthlyLimit) contribution = monthlyLimit;
          if (isaIdx === 0) {
            isaBridgeRoomRemainingInIsaCurrency = Math.max(0, monthlyLimit - contribution);
          }

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
        // 사적연금 조기수령 채널링(Phase 4)의 월별 저율과세 한도. 여러 계좌가 earlyChannelingEnabled면
        // 이 잔여한도를 계좌 간에 공유한다(remainingBridgeLimitKRW는 forEach 밖, 이 m 루프 안에서
        // 선언되어 있으므로 계좌마다 새로 리셋되지 않는다 — forEach 안으로 옮기면 계좌당 한도를
        // 따로 주는 세법 위반 버그가 된다).
        //
        // 위 monthlyPensionPreTaxLimitRemainingKRW와는 별개의 변수지만, 같은 법정 한도(연
        // 1,500만원 — 인출 사유와 무관하게 1인당 적용되는 단일 한도)를 추적한다. 두 캡의 적용
        // 조건은 비대칭이다: 이 브릿지 캡은 설정과 무관하게 항상 적용되지만,
        // monthlyPensionPreTaxLimitRemainingKRW(정상/후행 인출 캡)는 limitPrivatePensionToTaxLimit가
        // 켜졌을 때만 적용된다(기본값 false — 기본 설정에서는 정상 인출이 한도를 초과할 수 있다).
        // 어느 경로로 인출됐든 세전 금액은 annualPrivatePensionPreTaxKRW에 함께 누적되고,
        // calculatePrivatePensionExcessTaxNeededKRW가 연말에 그 누적치 전체를 기준으로 초과분을
        // 합산 과세하므로, 인출 시점의 캡이 느슨해도 결국 과세 단계에서 법정 한도 초과분이
        // 보정된다. 이 브릿지 분기는 !isRetired, 정상/후행 인출 분기는 isRetired(또는 은퇴 전엔
        // monthlyTargetSpending이 0으로 강제돼 shortfall이 발생하지 않음)로 갈리므로, 실제로는
        // 두 캡이 같은 해에 함께 소진되는 일은 없다.
        let remainingBridgeLimitKRW = (currentTaxSettings.privatePensionLimit ?? 15000000) / 12;

        activePensions.forEach((pension) => {
          if (pension.currentBalance < 0) pension.currentBalance = 0;
          const growth = pension.currentBalance * pension.returnRateMonthly;
          const contribution = isRetired ? 0 : pension.monthlyContribution;
          pension.currentBalance += growth + contribution;

          if (isRetired && pension.currentBalance > 0) {
            let drawAmountRaw = 0;
            // 사용자가 개별 조정할 수 있는 필드가 아니라 항상 이 식이다 — computeExecutionRoadmap.ts의
            // 로드맵 이벤트 나이 계산과 동일해야 한다.
            const planStartAge = clampPrivatePensionStartAge(userProfile.retirementAge);
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

            // pensionWithdrawalsStarted가 false면 drawAmountRaw는 항상 0이라 세율 값 자체는 결과에
            // 영향을 주지 않지만, getPrivatePensionIncomeTaxRate는 "55세 미만으로 호출되지 않는다"는
            // 불변식을 전제하므로(taxRates.ts 주석 참고) 그 불변식을 실제로 지키기 위해 게이트를 건다.
            const taxRate = pensionWithdrawalsStarted ? getPrivatePensionIncomeTaxRate(currentAge) : 0;

            const drawAmountTax = drawAmountRaw * taxRate;
            const drawAmountNet = drawAmountRaw - drawAmountTax;

            monthlyPensionIncomeNetDisplay += this.convertValue(drawAmountNet, pension.currency, displayCurrency, exchangeRate);
            annualPensionTaxPaid += this.convertValue(drawAmountTax, pension.currency, displayCurrency, exchangeRate);
            annualPreTaxTotalIncome += this.convertValue(drawAmountRaw, pension.currency, displayCurrency, exchangeRate);
            annualPrivatePensionPreTaxKRW += this.convertValue(drawAmountRaw, pension.currency, 'KRW', exchangeRate);
          } else if (
            !isRetired &&
            currentAge >= PRIVATE_PENSION_MIN_START_AGE &&
            pension.earlyChannelingEnabled &&
            pension.currentBalance > 0 &&
            activeIsas.length > 0
          ) {
            // 사적연금 조기수령 채널링(Phase 4): 은퇴 전(재직 중)이라도 55세부터 저율과세 한도
            // 내에서 조기 인출해 ISA로 재투자한다. 생활비 재원이 아니므로 monthlyPensionIncomeNetDisplay/
            // annualPrivatePensionIncome(소득 표시용 필드)에는 더하지 않는다 — 재직 중이라 생활비는
            // 이 시뮬레이터가 모델링하지 않는 근로소득으로 충당된다고 가정한다.
            const limitInPensionCurrency = this.convertValue(
              Math.max(0, remainingBridgeLimitKRW), 'KRW', pension.currency, exchangeRate
            );
            const taxRate = getPrivatePensionIncomeTaxRate(currentAge);

            // 인출액은 ISA가 이번 달 실제로 받을 수 있는 만큼으로 제한한다 — 놓을 곳이 없는 돈을
            // 먼저 빼서 과세한 뒤 버리면 자금이 소멸한다(총자산 보존 위반). 이 엔진의 다른 캡들
            // (ISA 월 납입 캡, 정상 인출 시 연금 잔액 상한)도 모두 유출 자체를 줄이는 방식이며,
            // 이 분기만 예외가 되어서는 안 된다. ISA 잔여 룸(세후 기준)을 세전으로 역산해 상한에 포함한다.
            const roomInPensionCurrency = this.convertValue(
              isaBridgeRoomRemainingInIsaCurrency, activeIsas[0].currency, pension.currency, exchangeRate
            );
            const maxRawByIsaRoom = taxRate < 1 ? roomInPensionCurrency / (1 - taxRate) : 0;
            const drawAmountRaw = Math.max(
              0,
              Math.min(pension.currentBalance, limitInPensionCurrency, maxRawByIsaRoom)
            );

            if (drawAmountRaw > 0) {
              remainingBridgeLimitKRW -= this.convertValue(drawAmountRaw, pension.currency, 'KRW', exchangeRate);
              pension.currentBalance -= drawAmountRaw;

              const drawAmountTax = drawAmountRaw * taxRate;
              const drawAmountNet = drawAmountRaw - drawAmountTax;

              // 인출액이 이미 ISA 룸으로 캡되어 있으므로 순액은 전액 적립된다(소실 없음).
              const netInIsaCurrency = this.convertValue(drawAmountNet, pension.currency, activeIsas[0].currency, exchangeRate);
              activeIsas[0].currentBalance += netInIsaCurrency;
              activeIsas[0].totalInvested += netInIsaCurrency;
              isaBridgeRoomRemainingInIsaCurrency = Math.max(0, isaBridgeRoomRemainingInIsaCurrency - netInIsaCurrency);

              annualPensionTaxPaid += this.convertValue(drawAmountTax, pension.currency, displayCurrency, exchangeRate);
              annualPreTaxTotalIncome += this.convertValue(drawAmountRaw, pension.currency, displayCurrency, exchangeRate);
              annualPrivatePensionPreTaxKRW += this.convertValue(drawAmountRaw, pension.currency, 'KRW', exchangeRate);
            }
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
        // dividend_only는 목표 생활비를 쓰지 않고 "그달 들어온 소득만큼만" 쓰는 전략이라
        // monthlyTargetSpending을 참조하지 않는다. 그래서 의료비를 여기에 따로 더해 준다 —
        // 더하지 않으면 healthcareSpending은 기록되는데 실제로는 한 푼도 나가지 않아
        // "spending에 포함된 금액"이라는 필드 정의가 이 전략에서만 거짓이 된다.
        // 의료비는 배당으로 감당되지 않으면 자산 인출로 충당된다(아래 shortfall 로직).
        let actualMonthlySpending = (isRetired && spendingStrategy === 'dividend_only')
          ? monthlyTotalIncome + monthlyHealthcareCost
          : monthlyTargetSpending;

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
          // 55세 이상이면 법정 최저 나이(55세)부터 바로 후행 인출한다 — 부족분이 생긴 응급
          // 상황에서는 있는 돈을 최대한 활용하는 쪽(조기에라도 인출)이 맞다.
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
        totalIncome, spending: annualSpending, healthcareSpending: annualHealthcareCost,
        hasTaxWarning, spouseAlive, spendingFactor,
        preTaxTotalIncome: annualPreTaxTotalIncome,
        dividendTaxPaid: annualDividendTaxPaid, pensionTaxPaid: annualPensionTaxPaid,
        nationalPensionTaxPaid: annualNationalPensionTaxPaid, comprehensiveTaxPaid: annualComprehensiveTaxPaidDisplay,
        healthInsurancePaid: annualHealthInsurancePaidDisplay, privatePensionTaxMethod,
      });

      if (totalAssetsDisplay <= 0 && depletionAge === null) depletionAge = currentAge;

      // 의료비도 소득으로 감당해야 할 지출이다. 빼면 "의료비를 못 내는데 FIRE 달성"이 된다.
      const targetSpendingForFIRE = (inflationMode === 'nominal'
        ? userProfile.targetMonthlySpending * 12 * Math.pow(1 + inflationRate / 100, y)
        : userProfile.targetMonthlySpending * 12) + annualHealthcareCost;

      if (totalIncome >= targetSpendingForFIRE && fireAge === null) fireAge = currentAge;
    }

    const retirementYearsResults = yearlyResults.filter((r) => r.age >= userProfile.retirementAge);
    let avgRetirementMonthlyIncome = 0;
    let avgTargetMonthlySpending = 0;
    
    if (retirementYearsResults.length > 0) {
      const totalIncomeSum = retirementYearsResults.reduce((sum, r) => sum + r.totalIncome, 0);
      let totalTargetSum = 0;
      retirementYearsResults.forEach(r => {
          // 목표액에도 그 해의 가구 규모 계수를 곱한다. 한 명만 남은 해의 실제 지출은 이미
          // 0.7배로 줄어 있으므로, 분모만 2인 기준으로 두면 줄어든 필요를 완벽히 충족한
          // 계획이 영구적 결손으로 채점된다(아래 avgRetirementMonthlySpending과도 어긋난다).
          let annualTarget = userProfile.targetMonthlySpending * 12 * r.spendingFactor;
          if (inflationMode === 'nominal') {
              annualTarget = annualTarget * Math.pow(1 + inflationRate / 100, r.age - startAge);
          }
          // 의료비도 목표(=충족해야 할 필요)의 일부다. 더하지 않으면 의료비를 켠 순간
          // 분자(totalIncome)만 커진다 — 의료비를 메우려 사적연금을 더 인출한 금액이
          // 소득으로 집계되기 때문이다 — 분모는 그대로라서 달성률이 부풀려진다.
          // 물가 보정을 적용하지 않는 이유: healthcareSpending은 이미 엔진이 그 해의
          // inflationMode에 맞춰 계산해 둔 실제 지출액이다(중복 보정 금지).
          annualTarget += r.healthcareSpending;
          totalTargetSum += annualTarget;
      });

      avgRetirementMonthlyIncome = totalIncomeSum / retirementYearsResults.length / 12;
      avgTargetMonthlySpending = totalTargetSum / retirementYearsResults.length / 12;
    }

    const goalAchievementRate = avgTargetMonthlySpending > 0
      ? Math.min(200, Math.max(0, Math.round((avgRetirementMonthlyIncome / avgTargetMonthlySpending) * 100))) : 0;

    const endingAssets = yearlyResults.length > 0 ? yearlyResults[yearlyResults.length - 1].totalAssets : 0;

    const { retirementScore, retirementGrade, retirementAssetsAtRetirement } = this.calculateRetirementScore(
      yearlyResults, userProfile, goalAchievementRate, depletionAge, inflationMode, inflationRate, endAge
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
      householdEndAge: endAge,
    };
  }
}
