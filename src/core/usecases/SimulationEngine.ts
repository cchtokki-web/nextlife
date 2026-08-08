import {
  SimulationParams,
  SimulationResult,
  SimulationYearlyResult,
  InvestmentAsset,
  PrivatePension,
  IsaAccount,
  AssetCurrency,
  PrivatePensionTaxationMethod,
  UtilityConfig,
  ReturnShockPath,
} from '../entities/types';
import { getRetirementGrade, RetirementGrade } from '../entities/retirementGrade';
import { computeLifetimeUtility } from './utility/UtilityEngine';
import { computeAnnualHealthcareCostBreakdown } from './healthcare/healthcareCosts';
import { DEFAULT_UTILITY_CONFIG } from './utility/utilityWeights';
import {
  getMarketTaxTreatment,
  getPrivatePensionIncomeTaxRate,
  calculateNationalPensionTaxKRW,
  getIsaExemptionLimitKRW,
  calculateIsaMaturityTax,
  calculateComprehensiveTaxAndHealthInsuranceKRW,
  calculatePrivatePensionExcessTaxNeededKRW,
  calculateCapitalGainsTaxKRW,
} from './tax/TaxEngine';
import { TaxContext, resolveTaxContext } from './tax/taxContext';
import {
  getNationalPensionAdjustmentFactor,
  NATIONAL_PENSION_NORMAL_START_AGE,
  NATIONAL_PENSION_EARLY_MIN_AGE,
  NATIONAL_PENSION_DEFERRED_MAX_AGE,
} from './pension/nationalPensionRules';
import { PRIVATE_PENSION_MIN_START_AGE, clampPrivatePensionStartAge } from './pension/privatePensionRules';
import { sortAssetsForWithdrawal } from './strategy/assetOrdering';
import {
  computeHouseholdEndAge, computeSpendingFactor, inheritSurvivorPension, resolveSpouse,
} from './spouse/spouseRules';

// 연 수익률(소수)을 월 복리율로. initializeAssets가 네 곳에서 같은 식을 반복하고 있었고,
// 연도별 시장 충격을 얹으려면 같은 식이 다섯 번째로 필요해져 한 곳으로 모은다.
//
// Math.max(0, ...)은 연 −100%보다 나쁜 값만 막는다(현금 이자율과 같은 규칙). 그 아래로
// 내려가면 월 복리율이 NaN이 되고 자산이 음수가 된다.
function toMonthlyCompoundRate(annualRate: number): number {
  return Math.pow(Math.max(0, 1 + annualRate), 1 / 12) - 1;
}

interface ActiveAsset extends InvestmentAsset {
  currentValue: number;
  // 물가 처리(실질 모드의 차감)까지 끝난 **연** 성장률(소수). growthRateMonthly는 이 값에서
  // 파생된 캐시다. 연도별 충격을 가산하려면 월 복리율에서 역산할 수 없으므로 원본을 남긴다.
  growthRateAnnual: number;
  growthRateMonthly: number;
  divRateMonthly: number;
  taxRate: number;
  // 이 자산의 배당이 금융소득종합과세·건보료 판정 기준액에 합산되는가
  // (getMarketTaxTreatment가 배당세율과 함께 한 번에 정한다).
  includedInFinancialIncome: boolean;
  // 매도차익에 양도소득세가 붙는가(해외주식·ETF만 해당).
  capitalGainsTaxable: boolean;
  // 총 취득원가(자산 통화 기준). 매도 시 비례 차감되며, 매도액과의 차이가 실현이익이다.
  // ActiveIsa.totalInvested와 같은 패턴이다.
  costBasis: number;
}

// 부분 매도. 자산 잔액과 취득원가를 비례적으로 줄이고 **실현이익**(자산 통화 기준)을 반환한다.
//
// 매도액 S, 직전 평가액 V, 취득원가 B일 때
//   원가 차감 = S × (B / V),  실현이익 = S × (1 − B / V)
// 즉 가중평균 원가법이다. 개별법·선입선출은 이 엔진이 매수 로트를 추적하지 않으므로
// 쓸 수 없고, 월 적립이 계속되는 모델에서는 가중평균이 현실적인 근사다.
//
// 매도 경로가 네 곳(생활비 부족분, 연말 세금 징수 2곳, ISA 만기 이관 후 재매도)이라
// 여기 한 곳으로 모은다. 예전에는 각자 asset.currentValue를 직접 깎았고, 그래서 원가 회계를
// 붙이려면 네 곳을 모두 고쳐야 했다 — 하나라도 빠지면 원가가 남아 이익이 과소 계상된다.
function applySale(asset: ActiveAsset, saleAmountInAssetCurrency: number): number {
  if (saleAmountInAssetCurrency <= 0) return 0;

  const value = asset.currentValue;
  if (value <= 0) {
    // 평가액이 0인데 파는 상황은 정상 경로에 없다. 원가만 남아 있으면 지워 정합성을 지킨다.
    asset.costBasis = 0;
    return 0;
  }

  const sale = Math.min(saleAmountInAssetCurrency, value);
  const basisRatio = Math.min(1, Math.max(0, asset.costBasis / value));
  const basisConsumed = sale * basisRatio;

  asset.currentValue = value - sale;
  asset.costBasis = Math.max(0, asset.costBasis - basisConsumed);

  return sale - basisConsumed;
}

interface ActivePension extends PrivatePension {
  currentBalance: number;
  // ActiveAsset.growthRateAnnual과 같은 이유로 보존한다.
  returnRateAnnual: number;
  returnRateMonthly: number;
}

interface ActiveIsa extends IsaAccount {
  currentBalance: number;
  totalInvested: number;
  monthsSinceInception: number;
  // ActiveAsset.growthRateAnnual과 같은 이유로 보존한다.
  returnRateAnnual: number;
  returnRateMonthly: number;
  divRateMonthly: number;
}

// 은퇴 준비도 점수의 자산 항목(100점 중 25점)의 분모. 4% 룰(연 필요액 × 25)로 환산한 목표 자산.
//
// 분모는 "그 계획이 실제로 감당해야 할 필요"여야 한다. 다른 목표 분모 세 곳
// (goalAchievementRate / UtilityEngine / MonthlySpendingComposition)과 같은 규칙을 쓴다:
//   - spendingFactor: 은퇴 시점의 가구 규모 계수. 배우자가 나이가 많아 은퇴 전에 사망하면
//     은퇴 기간 전체의 필요가 0.7배인데, 분모만 2인 기준으로 두면 assetScore가 약 30%
//     과소평가된다.
//   - 의료비: 켜면 실제로 필요한 자산이 늘어난다. 분모가 그대로면 의료비를 켠 계획이
//     "자산이 충분하다"는 같은 점수를 받는다(FIRE 판정 목표에 의료비를 넣은 것과 같은 이유).
//     엔진이 이미 spendingFactor를 곱해 둔 값이므로 여기서 다시 곱하지 않는다.
export function computeRetirementTargetAssets(
  targetMonthlyAtRetirement: number,
  spendingFactorAtRetirement: number,
  annualHealthcareAtRetirement: number
): number {
  const annualNeed = targetMonthlyAtRetirement * 12 * spendingFactorAtRetirement
    + annualHealthcareAtRetirement;
  return Math.max(0, annualNeed) * 25;
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

  // 이진탐색 한 회의 시행 params. 목표 생활비만 바꾸고, **상속 하한선은 떼어 낸다.**
  //
  // 하한선을 인출 경로에 건 채로 탐색하면 이진탐색이 깨진다: 인출이 막힐 뿐 자산은 늘
  // 하한선 위에 남으므로 어떤 생활비를 넣어도 "성공"으로 읽혀 탐색이 상한(5천만원)까지
  // 올라간다. 여기서는 생활비 자체가 자유변수이므로, 하한선은 인출 제약이 아니라
  // **탐색의 성공 조건**(meetsSustainabilityGoal)으로 표현하는 것이 옳다.
  private sustainabilityTrialParams(params: SimulationParams, targetMonthlySpending: number): SimulationParams {
    const trial: SimulationParams = {
      ...params,
      userProfile: { ...params.userProfile, targetMonthlySpending },
    };
    delete trial.assetFloor;
    return trial;
  }

  // 이 시행이 "지속 가능"한가. 하한선이 없으면 기존 판정("고갈되지 않았거나 기말자산이 남음")을
  // 비트 단위로 그대로 쓴다.
  private meetsSustainabilityGoal(result: SimulationResult, assetFloor: number): boolean {
    // 잔액이 아주 조금 남았더라도 목표 생활비를 못 쓴 해가 있으면 그 금액은 "지속 가능한
    // 생활비"가 아니다. depletionAge만 보면 인출 가능한 잔액만 쓰고 멈춘 경로가 성공으로
    // 오인되어 탐색 상한(월 5천만원)까지 치솟는다.
    if (result.yearlyResults.some((year) => year.unmetSpending > 0)) return false;
    if (assetFloor > 0) return result.endingAssets >= assetFloor;
    return result.depletionAge === null || result.endingAssets > 0;
  }

  private findMaxSustainableValue(params: SimulationParams): number {
    const assetFloor = Math.max(0, params.assetFloor ?? 0);
    let low = 0;
    let high = 50000000; // 5천만원/월
    let bestTarget = 0;

    for (let i = 0; i < 30; i++) {
      const mid = (low + high) / 2;
      const result = this.runSingle(this.sustainabilityTrialParams(params, mid));

      if (this.meetsSustainabilityGoal(result, assetFloor)) {
        bestTarget = mid;
        low = mid;
      } else {
        high = mid;
      }
    }
    return bestTarget;
  }

  private findMaxSustainable(params: SimulationParams): SimulationResult {
    const assetFloor = Math.max(0, params.assetFloor ?? 0);
    let low = 0;
    let high = 50000000; // 5천만원/월
    let bestResult: SimulationResult | null = null;
    let bestTarget = 0;

    for (let i = 0; i < 30; i++) {
      const mid = (low + high) / 2;
      const result = this.runSingle(this.sustainabilityTrialParams(params, mid));

      if (this.meetsSustainabilityGoal(result, assetFloor)) {
        bestResult = result;
        bestTarget = mid;
        low = mid;
      } else {
        high = mid;
      }
    }

    if (!bestResult) {
      bestResult = this.runSingle(this.sustainabilityTrialParams(params, 0));
    }

    return { ...bestResult, calculatedTargetSpending: bestTarget };
  }

  // 그 해의 시장 충격(%p)을 각 계좌의 월 복리율에 반영한다.
  //
  // **곱해지는 지점(현금·ISA·일반자산·사적연금의 성장 계산)은 건드리지 않는다.** 그 네 곳은
  // 배당·적립·취득원가 회계와 얽혀 있고 골든 테스트(tax/)와 총자산 보존 테스트가 정확히 그
  // 경로를 지킨다. 대신 그들이 읽는 요율 필드만 연초에 갈아 끼운다. Active* 객체는 이미 이
  // 실행 전용 가변 사본이라(currentValue·costBasis·totalInvested를 매달 고친다) 요율을 해마다
  // 고치는 것도 같은 성격의 변경이다.
  //
  // returnPath가 없으면 이 메서드는 **호출조차 되지 않는다** — 결정론 실행은 예전과 완전히
  // 같은 명령 순서를 돈다. 이것이 "경로 미지정 시 비트 단위 동일"의 근거다.
  private applyReturnShock(
    activeAssets: readonly ActiveAsset[],
    activePensions: readonly ActivePension[],
    activeIsas: readonly ActiveIsa[],
    shockAnnualPercentPoints: number
  ): void {
    const shock = shockAnnualPercentPoints / 100;
    for (const asset of activeAssets) {
      asset.growthRateMonthly = toMonthlyCompoundRate(asset.growthRateAnnual + shock);
    }
    for (const pension of activePensions) {
      pension.returnRateMonthly = toMonthlyCompoundRate(pension.returnRateAnnual + shock);
    }
    for (const isa of activeIsas) {
      isa.returnRateMonthly = toMonthlyCompoundRate(isa.returnRateAnnual + shock);
    }
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

  // 세금을 계좌에서 순서대로 징수하고, **실제로 징수한 금액**(표시 통화)을 반환한다.
  //
  // 호출부는 부과액이 아니라 이 반환값을 결과에 기록해야 한다. 부과액을 기록하면 자산이
  // 바닥난 해에 "내지 않은 세금"이 납부액으로 잡히고, 총자산 보존 불변식
  // (SimulationEngine.conservation.test.ts)이 깨진다. 결과를 읽는 모든 계층 —
  // 효용 점수의 세금효율(UtilityEngine.computeTaxEfficiencyRaw), 전문가 분석, PDF —
  // 이 있지도 않은 지출을 세게 되므로 표시상의 문제로 끝나지도 않는다.
  //
  // 징수 순서는 일반자산 → 사적연금으로 고정한다. 예전에는 종합과세·건보료가 일반자산에서만
  // 징수되고(연금 폴백 없이 잔액을 버림) 사적연금 초과세만 연금까지 폴백해, 같은 성격의 두
  // 세금이 서로 다르게 처리됐다.
  //
  // ISA는 의도적으로 제외한다. ISA 잔액을 중도 인출하면 만기 정산의 과세표준
  // (totalInvested 대비 수익)이 어긋나는데, 이 엔진에는 중도 인출 시 ISA 세제 혜택이
  // 어떻게 되는지에 대한 모델이 없다. 근거 없는 규칙을 만드는 대신 ISA는 건드리지 않는다 —
  // 그 결과 ISA에만 돈이 남은 해에는 세금이 과소 징수되며, 이는 알려진 근사다.
  private collectTax(
    amountDisplay: number,
    assets: readonly ActiveAsset[],
    pensions: readonly ActivePension[],
    displayCurrency: AssetCurrency,
    exchangeRate: number,
    // 세금을 내려고 판 자산에서도 양도차익이 실현된다. 호출부가 그 해 누적기에 더한다.
    onRealizedGainKRW: (gainKRW: number) => void
  ): number {
    let remaining = amountDisplay;
    if (remaining <= 0) return 0;

    for (const asset of assets) {
      const availableDisplay = this.convertValue(asset.currentValue, asset.currency, displayCurrency, exchangeRate);
      const deduct = Math.min(remaining, Math.max(0, availableDisplay));
      const gain = applySale(asset, this.convertValue(deduct, displayCurrency, asset.currency, exchangeRate));
      if (asset.capitalGainsTaxable) {
        onRealizedGainKRW(this.convertValue(gain, asset.currency, 'KRW', exchangeRate));
      }
      remaining -= deduct;
      if (remaining <= 0) return amountDisplay;
    }

    for (const pension of pensions) {
      const availableDisplay = this.convertValue(pension.currentBalance, pension.currency, displayCurrency, exchangeRate);
      const deduct = Math.min(remaining, Math.max(0, availableDisplay));
      pension.currentBalance -= this.convertValue(deduct, displayCurrency, pension.currency, exchangeRate);
      remaining -= deduct;
      if (remaining <= 0) return amountDisplay;
    }

    return amountDisplay - remaining;
  }

  private initializeAssets(params: SimulationParams, taxCtx: TaxContext): { activeAssets: ActiveAsset[], activePensions: ActivePension[], activeIsas: ActiveIsa[], infRateAnnual: number } {
    const { assets = [], privatePensions = [], isaAccounts = [], inflationRate = 2, inflationMode = 'real' } = params;
    
    const infRateAnnual = inflationRate / 100;

    const activeAssets: ActiveAsset[] = assets.map((asset) => {
      const growthRateAnnual = inflationMode === 'real'
        ? (asset.annualGrowthRate - inflationRate) / 100
        : asset.annualGrowthRate / 100;
      const growthRateMonthly = toMonthlyCompoundRate(growthRateAnnual);
      const divRateMonthly = (asset.dividendYield / 100) / 12;
      
      const { dividendTaxRate, includedInFinancialIncome, capitalGainsTaxable } =
        getMarketTaxTreatment(asset.assetMarket, asset.currency, taxCtx);

      const currentValue = asset.quantity * asset.averagePrice;

      return {
        ...asset,
        currentValue,
        growthRateAnnual,
        growthRateMonthly,
        divRateMonthly,
        taxRate: dividendTaxRate,
        includedInFinancialIncome,
        capitalGainsTaxable,
        // 취득원가 미입력 시 현재 평가액을 원가로 본다 = 지금까지의 평가차익은 과세하지 않는다.
        // 확정되지 않은 숫자(예: 평가액 × 0.6)를 지어내지 않는다는 이 저장소의 원칙을 따른다.
        //
        // 이 폴백은 엔진 초기화 한 곳에만 둔다. 시나리오 로드 정규화에 넣으면 "저장값 없음"이
        // 소실되어 사용자가 나중에 취득원가를 입력해도 반영되지 않는다.
        costBasis: asset.acquisitionCostBasis ?? currentValue,
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
      const returnRateMonthly = toMonthlyCompoundRate(returnRateAnnual);

      return {
        ...p,
        currentBalance: p.balance,
        returnRateAnnual,
        returnRateMonthly,
      };
    });

    const activeIsas: ActiveIsa[] = (isaAccounts || []).map((isa) => {
      const returnRateAnnual = inflationMode === 'real'
        ? (isa.annualReturn - inflationRate) / 100
        : isa.annualReturn / 100;
      const returnRateMonthly = toMonthlyCompoundRate(returnRateAnnual);
      const divRateMonthly = (isa.dividendYield / 100) / 12;

      return {
        ...isa,
        currentBalance: isa.balance,
        totalInvested: isa.balance,
        monthsSinceInception: 0,
        returnRateAnnual,
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
    householdEndAge: number,
    // 나이 → 그 해 의료비 중 반복 구성요소. 4% 룰 분모에는 이 값만 들어간다.
    recurringHealthcareByAge: ReadonlyMap<number, number>
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
    // 4% 룰(연 필요액 × 25)은 "이 필요가 영구히 반복된다"는 가정이다. 그래서 그 해 총
    // 의료비가 아니라 반복 구성요소만 넘긴다 — 일회성 쇼크가 은퇴 연도에 걸리면 기본값
    // 3천만원이 25배로 곱해져 목표 자산에 7.5억이 더해지고 assetScore(25점 만점)가 0에
    // 수렴했다. 쇼크의 실제 영향은 그 해 자산이 줄어드는 것으로 이미 반영되어 있다.
    // 루프가 모든 연도를 기록하므로 조회가 실패할 일은 없지만, 미래에 누락되더라도
    // 반복 의료비를 과대계상하지 않도록 0으로 폴백한다.
    const recurringHealthcareAtRetirement =
      recurringHealthcareByAge.get(retirementStartResult.age) ?? 0;
    const targetAssets = computeRetirementTargetAssets(
      targetMonthlyAtRetirement,
      retirementStartResult.spendingFactor,
      recurringHealthcareAtRetirement
    );

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

    // 인플레이션 헤지 점수의 분자 = 투자 자산(주식 + 사적연금 + ISA).
    //
    // 예전에는 주석만 ISA를 포함한다고 말하고 코드는 빼고 있었다. 그래서 ISA 보유자의
    // 헤지 점수가 과소 산정됐고, 전 재산이 ISA인 사용자는 투자 비중이 0으로 잡혀 0점이었다.
    const retirementInvestedAssets = retirementStartResult.stockAssets
      + retirementStartResult.pensionAssets
      + retirementStartResult.isaAssets;
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

  // returnPath는 몬테카를로·시퀀스 리스크 전용 통로다(ReturnShockPath 주석 참고).
  //
  // run()/runForUtility()/findMaxSustainableValue()는 이 인자를 넘기지 않는다 — 저장된
  // 시나리오의 숫자를 한 자리도 바꾸지 않기 위해서다. 확률 경로가 필요한 호출부는
  // runSingle을 직접 부른다(run()은 시행당 이진탐색 30회를 더 돌아 1000시행이면 31,000회가 된다).
  runSingle(params: SimulationParams, returnPath?: ReturnShockPath): SimulationResult {
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

    // 세법 프로필 + 사용자 설정을 한 번만 확정해 전 계산 경로가 같은 것을 본다.
    // params.taxLawVersion이 계산에 실제로 도달하는 유일한 지점이다(taxContext.ts 주석 참고).
    const taxCtx = resolveTaxContext(taxSettings, params.taxLawVersion);
    // 아래 로직 다수가 설정만 참조하므로 별칭을 둔다. 프로필이 필요한 곳은 taxCtx를 직접 쓴다.
    const currentTaxSettings = taxCtx.settings;

    const exchangeRate = this.getExchangeRate(baseExchangeRate, exchangeScenario);
    const { activeAssets, activePensions, activeIsas, infRateAnnual } = this.initializeAssets(params, taxCtx);
    // dividendYield는 시간에 따라 변하지 않으므로 인출 순서를 한 번만 계산해 재사용한다.
    // 원본 activeAssets 배열(순서)은 잉여현금 재투자·ISA 만기 이동 등 다른 로직에서 그대로 쓰인다.
    const withdrawalOrderedAssets = sortAssetsForWithdrawal(activeAssets, withdrawalPlan?.assetSellOrderStrategy);

    // 상속 하한선. 총자산 정의(stock + pension + isa)는 연말에 yearlyResults에 싣는 것과
    // 정확히 같아야 한다 — 다르면 "하한선을 지켰다"는 판정과 화면이 보여주는 총자산이 갈린다.
    const assetFloorDisplay = Math.max(0, params.assetFloor ?? 0);

    // 쓰고 남은 현금. 성장하지 않고 표시 통화 그대로 쌓인다.
    //
    // 예전에는 잉여 현금을 activeAssets[0]에 도로 집어넣었다. 그래서 "배당 재투자 끄기"가
    // 실제로는 "첫 번째 자산에 재투자하기"였고, 자산이 하나뿐이면 스위치를 켜나 끄나 결과가
    // 비트 단위로 같았다. 게다가 그 돈이 자산의 성장률로 불어나고 취득원가까지 부풀렸다 —
    // 팔지도 않은 배당금이 양도차익 계산의 원가에 들어갔다는 뜻이다.
    let cashBucketDisplay = 0;

    // 현금 이자율. 물가 처리를 자산·연금·ISA와 똑같이 맞춘다(initializeAssets 참고) —
    // 실질 기준인데 현금만 명목 이율로 굴리면 같은 화면의 다른 자산과 기준이 어긋나고,
    // 물가에 지는 현금이 오히려 불어나는 것처럼 보인다.
    //
    // Math.max(0, ...)은 연 −100%보다 더 나쁜 값만 막는다. 물가보다 낮은 이율에서
    // 실질 수익률이 음수가 되는 것은 정상이고, 그 손실이 드러나야 한다.
    const cashYieldAnnual = inflationMode === 'real'
      ? ((params.cashYieldRate ?? 0) - inflationRate) / 100
      : (params.cashYieldRate ?? 0) / 100;
    const cashYieldRateMonthly = Math.pow(Math.max(0, 1 + cashYieldAnnual), 1 / 12) - 1;

    const currentTotalAssetsDisplay = () =>
      activeAssets.reduce((sum, a) => sum + this.convertValue(a.currentValue, a.currency, displayCurrency, exchangeRate), 0)
      + activePensions.reduce((sum, p) => sum + this.convertValue(p.currentBalance, p.currency, displayCurrency, exchangeRate), 0)
      + activeIsas.reduce((sum, i) => sum + this.convertValue(i.currentBalance, i.currency, displayCurrency, exchangeRate), 0)
      + cashBucketDisplay;

    // 해외주식 양도세는 실현 다음 해 5월에 확정신고·납부한다. 같은 해에 부과하면 순환이
    // 생긴다 — 양도세를 내려고 자산을 팔면 그 매도가 다시 양도차익을 만든다. 고정점을
    // 반복 계산으로 풀어야 하고, 그 반복이 findMaxSustainableValue의 30회 이진탐색 안에서
    // 매년 돌아 비용이 곱해진다. 연 단위 손익통산과 250만원 기본공제도 연 마감이 자연스럽다.
    let deferredCapitalGainKRW = 0;

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
    // 나이 → 그 해 의료비 중 "매년 반복되는" 부분. SimulationYearlyResult.healthcareSpending은
    // 실제 인출액(일회성 쇼크 포함)이라 4% 룰 분모로 쓸 수 없어 따로 모아 둔다.
    // 결과 객체에 필드를 추가하지 않는 이유: 이 값은 점수 계산의 중간 산물일 뿐
    // 화면·PDF·AI 프롬프트가 읽을 지표가 아니다.
    const recurringHealthcareByAge = new Map<number, number>();
    let fireAge: number | null = null;
    let depletionAge: number | null = null;

    for (let y = 0; y < totalYears; y++) {
      // 경로가 없으면 아예 호출하지 않는다(applyReturnShock 주석 참고). 경로가 짧으면
      // 남은 해는 충격 0으로 본다 — 던지지 않는다.
      if (returnPath !== undefined) {
        this.applyReturnShock(activeAssets, activePensions, activeIsas, returnPath[y] ?? 0);
      }
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
      // 목표 생활비 중 재원이 모자라 채우지 못한 금액. 인출 경로가 잔액을 넘겨 인출하지
      // 않으므로 부족분은 자산을 마이너스로 만드는 대신 지출에서 조용히 깎인다 —
      // 그 깎인 양을 여기 남긴다(SimulationYearlyResult.unmetSpending 주석 참조).
      let annualUnmetSpending = 0;
      let annualDividendTaxPaid = 0;
      let annualPensionTaxPaid = 0;
      let annualNationalPensionTaxPaid = 0;
      let annualPreTaxTotalIncome = 0;
      let annualRawFinancialIncomeKRW = 0;
      // 그 해 실현된 해외주식 양도차익(KRW). 다음 해에 과세된다.
      let annualRealizedCapitalGainKRW = 0;
      // 위 금융소득에서 실제로 원천징수된 세액(KRW). 비교과세의 기납부세액 공제에 쓴다.
      let annualWithheldFinancialTaxKRW = 0;
      let annualPrivatePensionPreTaxKRW = 0;
      let annualNationalPensionPreTaxKRW = 0;

      // 생활비와 별개의 지출 라인. 은퇴 후에만 발생하며 spending에 합산된다.
      // infRateAnnual은 소수(inflationRate / 100)이므로 % 단위로 되돌려 넘긴다.
      const healthcareCost = computeAnnualHealthcareCostBreakdown({
        healthcare: params.healthcare,
        currentAge,
        retirementAge: userProfile.retirementAge,
        simulationStartAge: startAge,
        yearsSinceRetirement: currentAge - userProfile.retirementAge,
        inflationMode,
        inflationRate: infRateAnnual * 100,
        // 생활비와 같은 계수를 쓴다 — 의료비만 안 줄면 본인 사후에도 전액이 나간다.
        spendingFactor,
      });
      const annualHealthcareCost = healthcareCost.total;
      // 4% 룰 분모에 넣을 반복 구성요소만 따로 기록해 둔다(일회성 쇼크 제외).
      recurringHealthcareByAge.set(currentAge, healthcareCost.recurring);
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
      // 배우자 명의 국민연금은 다루지 않으므로, 본인이 아직 개시 전이면 지급할 것도
      // 승계할 것도 없다(예전에는 배우자 몫 때문에 `|| resolvedSpouse !== null`이 필요했다).
      if (selfNationalPensionStarted) {
        const nationalPensionAdjustmentFactor = getNationalPensionAdjustmentFactor(nationalPensionStartAge);
        let natAmountRaw = (inflationMode === 'nominal'
          ? nationalPension.expectedMonthlyAmount * Math.pow(1 + infRateAnnual, y)
          : nationalPension.expectedMonthlyAmount) * nationalPensionAdjustmentFactor;

        // 본인 사망 → 배우자가 본인 국민연금을 유족연금으로 이어받는다.
        // 배우자가 먼저 사망한 경우에는 본인 연금이 그대로 유지되므로 분기가 필요 없다.
        if (resolvedSpouse !== null && !selfAlive && spouseAlive) {
          natAmountRaw = inheritSurvivorPension(natAmountRaw);
        }

        // 연금소득세는 연 단위로 계산해야 한다 — 연금소득공제와 누진세율이 모두 연간 총액
        // 기준이기 때문이다. natAmountRaw는 이 해 동안 고정이므로(연도 루프에서 한 번 계산)
        // 연간 세액을 구한 뒤 12로 나누면 월별 표시가 정확해진다.
        annualNationalPensionPreTaxKRW = natAmountRaw * 12;
        const annualNatTax = calculateNationalPensionTaxKRW(annualNationalPensionPreTaxKRW, taxCtx);
        const natTax = annualNatTax / 12;
        monthlyNationalPensionDisplay = this.convertValue(natAmountRaw - natTax, 'KRW', displayCurrency, exchangeRate);
        monthlyNatTaxDisplay = this.convertValue(natTax, 'KRW', displayCurrency, exchangeRate);
        monthlyNatPreTaxTotalDisplay = this.convertValue(natAmountRaw, 'KRW', displayCurrency, exchangeRate);
      }

      let monthlyOtherIncomeTotalDisplay = 0;
      let monthlyOtherPreTaxTotalDisplay = 0;
      otherIncomes.forEach((income) => {
        const amount = inflationMode === 'nominal'
          ? income.monthlyAmount * Math.pow(1 + infRateAnnual, y)
          : income.monthlyAmount;
        const amountDisplay = this.convertValue(amount, income.currency, displayCurrency, exchangeRate);
        monthlyOtherIncomeTotalDisplay += amountDisplay;
        monthlyOtherPreTaxTotalDisplay += amountDisplay;
      });

      for (let m = 0; m < 12; m++) {
        // 쌓아 둔 현금에 이자를 붙인다. 다른 자산과 같은 월 복리 규칙이며, 이자율이 0이면
        // 곱이 1이라 결과가 비트 단위로 보존된다(기본값이 0인 이유).
        //
        // 다음 달치 잉여가 들어오기 **전에** 굴린다 — 이번 달에 막 생긴 현금에 이달치 이자를
        // 주면 하루도 두지 않은 돈에 한 달치가 붙는다.
        cashBucketDisplay *= 1 + cashYieldRateMonthly;

        // ISA Processing
        // 사적연금 조기수령 채널링(Phase 4)의 브릿지 인출은 activeIsas[0]에 별도 크레딧을
        // 더하는데(Pensions Processing 블록, 이달 뒤에서 실행), 이 크레딧도 월 법정 한도
        // (20,000,000/12원)를 공유해야 한다 — 그렇지 않으면 이미 한도를 다 채운 ISA가 브릿지
        // 크레딧으로 한도를 초과해 납입받는 셈이 된다. activeIsas[0]의 이번 달 잔여 한도(=
        // monthlyLimit - contribution, isa.currency 기준)를 여기 기록해 뒀다가 Pensions
        // Processing에서 그대로 재사용한다. 매달(이 for-m 블록) 새로 계산되므로 자동으로 리셋된다.
        // ISA 납입한도는 계좌가 아니라 사람에게 붙는다(ISA는 1인 1계좌가 원칙이고 한도도 1인
        // 기준이다). 예전에는 이 한도를 forEach 안에서 계좌마다 새로 계산해, 계좌를 2개
        // 만드는 것만으로 연 4천만원을 납입할 수 있었다. 아래 사적연금 저율과세 한도
        // (monthlyPensionPreTaxLimitRemainingKRW / remainingBridgeLimitKRW)가 이미 같은
        // "계좌 간 공유 잔여 한도" 패턴을 쓰고 있고, 그쪽 주석이 계좌당 한도를 따로 주는 것을
        // 명시적으로 세법 위반 버그라고 부른다 — 같은 논리가 여기에는 적용되지 않고 있었다.
        //
        // 이 for-m 블록 안에서 선언되므로 매달 자동으로 리셋된다.
        let isaMonthlyRoomRemainingKRW = taxCtx.profile.isaAnnualLimitKRW / 12;
        activeIsas.forEach((isa) => {
          if (isa.currentBalance < 0) isa.currentBalance = 0;
          const growth = isa.currentBalance * isa.returnRateMonthly;
          const dividend = isa.currentBalance * isa.divRateMonthly;
          const monthlyLimit = this.convertValue(Math.max(0, isaMonthlyRoomRemainingKRW), 'KRW', isa.currency, exchangeRate);
          let contribution = isRetired ? 0 : isa.monthlyContribution;
          if (contribution > monthlyLimit) contribution = monthlyLimit;
          isaMonthlyRoomRemainingKRW -= this.convertValue(contribution, isa.currency, 'KRW', exchangeRate);

          isa.currentBalance += growth + dividend + contribution;
          isa.totalInvested += contribution;
          isa.monthsSinceInception += 1;

          const divDisplay = this.convertValue(dividend, isa.currency, displayCurrency, exchangeRate);
          annualDividendIncome += divDisplay;
          annualPreTaxTotalIncome += divDisplay;

          if (isa.monthsSinceInception >= isa.maturityYears * 12) {
            const totalProfit = isa.currentBalance - isa.totalInvested;
            const exemptionLimit = this.convertValue(getIsaExemptionLimitKRW(isa.type, taxCtx), 'KRW', isa.currency, exchangeRate);
            const taxAmount = calculateIsaMaturityTax(totalProfit, exemptionLimit, taxCtx);
            const netBalance = isa.currentBalance - taxAmount;
            const preferPension = (withdrawalPlan?.isaMaturityDestination ?? 'pension') === 'pension';

            if (preferPension && activePensions.length > 0) {
              activePensions[0].currentBalance += this.convertValue(netBalance, isa.currency, activePensions[0].currency, exchangeRate);
            } else if (!preferPension && activeAssets.length > 0) {
              const transferred = this.convertValue(netBalance, isa.currency, activeAssets[0].currency, exchangeRate);
              activeAssets[0].currentValue += transferred;
              // ISA 만기 정산을 마친 세후 자금으로 새로 사들이는 것이므로 전액이 취득원가다.
              activeAssets[0].costBasis += transferred;
            } else if (activePensions.length > 0) {
              activePensions[0].currentBalance += this.convertValue(netBalance, isa.currency, activePensions[0].currency, exchangeRate);
            } else if (activeAssets.length > 0) {
              const transferred = this.convertValue(netBalance, isa.currency, activeAssets[0].currency, exchangeRate);
              activeAssets[0].currentValue += transferred;
              activeAssets[0].costBasis += transferred;
            }
            isa.currentBalance = 0; isa.totalInvested = 0; isa.monthsSinceInception = 0;
          }
        });

        // 사적연금 조기수령 채널링(Phase 4)의 브릿지 인출은 activeIsas[0]에 별도 크레딧을
        // 더하는데(아래 Pensions Processing), 이 크레딧도 같은 월 법정 한도를 공유해야 한다 —
        // 그렇지 않으면 이미 한도를 다 채운 ISA가 브릿지 크레딧으로 한도를 초과해 납입받는
        // 셈이 된다. 모든 계좌가 납입을 마친 뒤 남은 잔여 한도가 브릿지가 쓸 수 있는 전부다.
        // (예전에는 계좌 0의 한도에서 계좌 0의 납입만 뺀 값이었다. 계좌가 하나면 같은 값이지만,
        //  둘 이상이면 뒤 계좌들의 납입분을 세지 않아 한도를 넘겼다.)
        // (브릿지가 실제로 채널링한 만큼 아래에서 차감되므로 let이다.)
        let isaBridgeRoomRemainingInIsaCurrency = activeIsas.length > 0
          ? this.convertValue(Math.max(0, isaMonthlyRoomRemainingKRW), 'KRW', activeIsas[0].currency, exchangeRate)
          : 0;

        // Assets Processing
        let monthlyDividendIncomeNetDisplay = 0;
        activeAssets.forEach((asset) => {
          if (asset.currentValue < 0) asset.currentValue = 0;
          const growth = asset.currentValue * asset.growthRateMonthly;
          const dividendRaw = asset.currentValue * asset.divRateMonthly;
          const dividendTax = dividendRaw * asset.taxRate;
          const dividendNet = dividendRaw - dividendTax;

          // 비과세 자산(OTHER)·연금계좌(IRP/PENSION)의 배당은 금융소득이 아니므로 종합과세·건보료
          // 판정 기준액에 넣지 않는다. 배당세율 0%와 같은 판정에서 나온 값이다(getMarketTaxTreatment).
          if (asset.includedInFinancialIncome) {
            annualRawFinancialIncomeKRW += this.convertValue(dividendRaw, asset.currency, 'KRW', exchangeRate);
            // 비교과세의 기납부세액. 비율이 아니라 실제 징수액을 누적하므로 자산별 세율 차이
            // (미국 15% / 국내 15.4%)가 그대로 반영된다.
            annualWithheldFinancialTaxKRW += this.convertValue(dividendTax, asset.currency, 'KRW', exchangeRate);
          }

          const contribution = isRetired ? 0 : asset.monthlyContribution;
          asset.currentValue += growth + contribution;
          // 적립금은 새로 취득한 금액이므로 원가에 더한다. 성장분(growth)은 평가차익이라 더하지 않는다.
          asset.costBasis += contribution;

          // 은퇴 후에도 자산별 재투자 설정을 존중한다.
          //
          // 예전에는 `!isRetired`가 앞에 붙어 있어 은퇴하는 순간 이 스위치가 무시됐다.
          // 화면은 "받은 배당을 쓰지 않고 다시 사들여 복리로 굴립니다"라고 말하는데,
          // 정작 그 복리가 가장 오래 작동할 은퇴 후 30여 년 동안 꺼져 있었다.
          //
          // 재투자한 배당은 소득이 아니므로 그만큼 생활비 부족분이 늘고, 필요하면 자산을
          // 매도해 충당한다. 그 매도에는 양도세가 붙으므로 "배당으로 받아 쓰기"와 완전히
          // 같지는 않다 — 어느 쪽이 유리한지는 시나리오에 따라 다르고, 그 판단이 바로
          // 이 스위치가 존재하는 이유다.
          if (asset.reinvestDividend) {
            asset.currentValue += dividendNet;
            // 세후 배당으로 다시 사들인 것이므로 새 취득이다.
            asset.costBasis += dividendNet;
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
        let monthlyPensionPreTaxLimitRemainingKRW = (currentTaxSettings.privatePensionLimit ?? taxCtx.profile.privatePensionLimitKRW) / 12;
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
        let remainingBridgeLimitKRW = (currentTaxSettings.privatePensionLimit ?? taxCtx.profile.privatePensionLimitKRW) / 12;

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

            // 상속 하한선은 정상 인출도 막는다. 이 인출은 부족분과 무관하게 매달 일어나므로
            // (잔액 ÷ 잔여개월), 여기서 막지 않으면 아래 부족분 경로를 아무리 조여도 연금이
            // 계속 소득으로 바뀌어 소비되고 총자산이 새어 나간다 — 실제로 그랬다.
            //
            // 인출한 돈이 소비되지 않으면 잉여현금으로 자산에 되돌아오므로, 막아서 손해 볼 일은
            // 없다. 오히려 인출 시 연금소득세를 내지 않게 되어 하한선 유지에 유리하다.
            if (assetFloorDisplay > 0) {
              const headroomInPensionCurrency = this.convertValue(
                Math.max(0, currentTotalAssetsDisplay() - assetFloorDisplay),
                displayCurrency, pension.currency, exchangeRate
              );
              drawAmountRaw = Math.min(drawAmountRaw, headroomInPensionCurrency);
            }

            pension.currentBalance -= drawAmountRaw;

            // pensionWithdrawalsStarted가 false면 drawAmountRaw는 항상 0이라 세율 값 자체는 결과에
            // 영향을 주지 않지만, getPrivatePensionIncomeTaxRate는 "55세 미만으로 호출되지 않는다"는
            // 불변식을 전제하므로(taxRates.ts 주석 참고) 그 불변식을 실제로 지키기 위해 게이트를 건다.
            const taxRate = pensionWithdrawalsStarted ? getPrivatePensionIncomeTaxRate(currentAge, taxCtx) : 0;

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
            const taxRate = getPrivatePensionIncomeTaxRate(currentAge, taxCtx);

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
        if (shortfall < 0) {
          // 쓰고 남은 돈은 현금으로 둔다. 자산에 도로 집어넣으면 "재투자하지 않겠다"는
          // 선택이 조용히 재투자가 된다(cashBucketDisplay 선언부 주석 참고).
          cashBucketDisplay += -shortfall;
        } else if (shortfall > 0) {
          // 상속 하한선. 총자산이 이 선 아래로 내려가는 인출은 하지 않는다.
          //
          // 막힌 금액은 아래 `actualMonthlySpending -= ...`로 흘러 소비가 깎인다 —
          // "상속을 지키려면 생활비를 줄여야 한다"가 새 메커니즘 없이 consumption 원점수
          // 하락으로 정직하게 나타난다.
          //
          // 사적연금 인출은 세전 잔액이 세후 충당액보다 많이 줄어들므로, 마지막 구간에서
          // 그 세액만큼 하한선을 넘어설 수 있다. 다음 달에는 여유가 0이 되어 인출이 멈추므로
          // 오차가 누적되지 않고, 후보 탐색은 실제 기말자산으로 하한선을 다시 판정한다
          // (RecommendationEngine.evaluateCandidate).
          const withdrawableDisplay = assetFloorDisplay > 0
            ? Math.max(0, currentTotalAssetsDisplay() - assetFloorDisplay)
            : Infinity;
          const blockedByFloor = Math.max(0, shortfall - withdrawableDisplay);

          let remainingShortfall = shortfall - blockedByFloor;

          // 현금이 1순위다. 팔면 세금이 붙는 자산보다 먼저 쓰는 것이 자연스럽고,
          // 일반자산 인출 개시 나이 제한도 받지 않는다(이미 손에 있는 돈이다).
          const fromCash = Math.min(cashBucketDisplay, remainingShortfall);
          cashBucketDisplay -= fromCash;
          remainingShortfall -= fromCash;

          const generalAssetWithdrawalStartAge = withdrawalPlan?.generalAssetWithdrawalStartAge ?? userProfile.retirementAge;
          if (currentAge >= generalAssetWithdrawalStartAge) {
            for (const asset of withdrawalOrderedAssets) {
              const assetValueDisplay = this.convertValue(asset.currentValue, asset.currency, displayCurrency, exchangeRate);
              const saleDisplay = Math.min(assetValueDisplay, remainingShortfall);
              const gain = applySale(asset, this.convertValue(saleDisplay, displayCurrency, asset.currency, exchangeRate));
              if (asset.capitalGainsTaxable) {
                annualRealizedCapitalGainKRW += this.convertValue(gain, asset.currency, 'KRW', exchangeRate);
              }
              remainingShortfall -= saleDisplay;
              if (remainingShortfall <= 0) { remainingShortfall = 0; break; }
            }
          }

          // 55세 미만은 사적연금(IRP/연금저축) 법정 인출 자체가 불가능하므로, 부족분이 있어도
          // 조기 인출로 충당하지 않는다 — 이 경우 부족분은 실제 생활비 미충족으로 남는다.
          // 55세 이상이면 법정 최저 나이(55세)부터 바로 후행 인출한다 — 부족분이 생긴 응급
          // 상황에서는 있는 돈을 최대한 활용하는 쪽(조기에라도 인출)이 맞다.
          if (remainingShortfall > 0 && currentAge >= PRIVATE_PENSION_MIN_START_AGE) {
            const taxRate = getPrivatePensionIncomeTaxRate(currentAge, taxCtx);
            for (const pension of activePensions) {
              let pensionValueNetDisplay = this.convertValue(pension.currentBalance, pension.currency, displayCurrency, exchangeRate) * (1 - taxRate);
              
              if (currentTaxSettings.limitPrivatePensionToTaxLimit) {
                const remainingLimitInPensionCurrency = this.convertValue(monthlyPensionPreTaxLimitRemainingKRW, 'KRW', pension.currency, exchangeRate);
                const maxAllowedDrawNetDisplay = this.convertValue(remainingLimitInPensionCurrency * (1 - taxRate), pension.currency, displayCurrency, exchangeRate);
                pensionValueNetDisplay = Math.min(pensionValueNetDisplay, Math.max(0, maxAllowedDrawNetDisplay));
              }

              // 월 인출 목표를 정했으면 후행 인출도 그 한도 안에서만 한다.
              //
              // 이것이 빠져 있어서 「연금 전략」의 인출 비율(100%/50%/25%)이 **총액을 바꾸지
              // 못했다.** 정상 인출에서 25%만 뽑아도 남은 75%를 이 경로가 곧바로 채워, 세 선택지가
              // 인출 "순서"만 다르고 결과는 같은 두 종류로 뭉쳤다. 화면은 세 개의 다른 전략을
              // 보여주는데 엔진에는 두 개만 있었다.
              //
              // 목표를 정하지 않은 경우(spending_first / ai_optimized)에는 이 캡이 걸리지 않고
              // 기존대로 잔액 전체가 후행 인출 대상이다.
              if (remainingMonthlyPensionTargetKRW !== undefined) {
                const remainingTargetNetDisplay = this.convertValue(
                  Math.max(0, remainingMonthlyPensionTargetKRW), 'KRW', displayCurrency, exchangeRate
                ) * (1 - taxRate);
                pensionValueNetDisplay = Math.min(pensionValueNetDisplay, Math.max(0, remainingTargetNetDisplay));
              }

              if (pensionValueNetDisplay >= remainingShortfall) {
                const drawPreTax = remainingShortfall / (1 - taxRate);
                pension.currentBalance -= this.convertValue(drawPreTax, displayCurrency, pension.currency, exchangeRate);
                if (currentTaxSettings.limitPrivatePensionToTaxLimit) {
                  monthlyPensionPreTaxLimitRemainingKRW -= this.convertValue(drawPreTax, displayCurrency, 'KRW', exchangeRate);
                }
                if (remainingMonthlyPensionTargetKRW !== undefined) {
                  remainingMonthlyPensionTargetKRW -= this.convertValue(drawPreTax, displayCurrency, 'KRW', exchangeRate);
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
                  if (remainingMonthlyPensionTargetKRW !== undefined) {
                    remainingMonthlyPensionTargetKRW -= this.convertValue(drawPreTax, displayCurrency, 'KRW', exchangeRate);
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
          const unmet = remainingShortfall + blockedByFloor;
          if (unmet > 0) {
            actualMonthlySpending -= unmet;
            annualUnmetSpending += unmet;
          }
        }
        annualSpending += actualMonthlySpending;
      }

      // Taxes
      const { comprehensiveTaxKRW, healthInsuranceKRW, healthInsuranceIncomeBasisKRW } = calculateComprehensiveTaxAndHealthInsuranceKRW(
        {
          annualRawFinancialIncomeKRW,
          // 사적연금(annualPrivatePensionPreTaxKRW)은 건보료 부과 대상이 아니라 넘기지 않는다.
          annualPublicPensionIncomeKRW: annualNationalPensionPreTaxKRW,
          annualWithheldFinancialTaxKRW,
        },
        taxCtx
      );
      // 부과액이 아니라 실제 징수액을 기록한다(collectTax 주석 참조).
      let annualComprehensiveTaxPaidDisplay = this.convertValue(comprehensiveTaxKRW, 'KRW', displayCurrency, exchangeRate);
      let annualHealthInsurancePaidDisplay = this.convertValue(healthInsuranceKRW, 'KRW', displayCurrency, exchangeRate);

      {
        // 두 세금은 한 번에 징수한다(원래부터 합산해 차감했다). 일부만 걷힌 해에는
        // 부과 비율대로 나눠 배분한다 — 어느 한쪽을 먼저 채우는 규칙에는 근거가 없다.
        const chargedDisplay = annualComprehensiveTaxPaidDisplay + annualHealthInsurancePaidDisplay;
        const collectedDisplay = this.collectTax(
          chargedDisplay, withdrawalOrderedAssets, activePensions, displayCurrency, exchangeRate,
          (gainKRW) => { annualRealizedCapitalGainKRW += gainKRW; }
        );
        if (collectedDisplay < chargedDisplay) {
          const collectedRatio = chargedDisplay > 0 ? collectedDisplay / chargedDisplay : 0;
          annualComprehensiveTaxPaidDisplay *= collectedRatio;
          annualHealthInsurancePaidDisplay *= collectedRatio;
        }

        // 초과세도 실질적으로 배당소득에서 빠져나가는 비용이므로 표시되는 배당소득에도 반영한다.
        annualDividendIncome = Math.max(0, annualDividendIncome - collectedDisplay);
      }

      // Private pension high tax threshold adjustment
      let privatePensionTaxMethod: PrivatePensionTaxationMethod = 'none';
      {
        // 국민연금 수령액을 함께 넘긴다 — 종합과세를 고를 때 두 연금은 합산되어 하나의
        // 과세표준을 이루므로, 연금소득공제·기본공제가 두 연금에 걸쳐 한 번만 적용되어야 한다.
        const { taxKRW: totalPensionTaxNeededKRW, method } = calculatePrivatePensionExcessTaxNeededKRW(
          annualPrivatePensionPreTaxKRW, taxCtx, annualNationalPensionPreTaxKRW
        );
        privatePensionTaxMethod = method;
        const totalPensionTaxNeededDisplay = this.convertValue(totalPensionTaxNeededKRW, 'KRW', displayCurrency, exchangeRate);
        const pensionTaxAdjustmentDisplay = Math.max(0, totalPensionTaxNeededDisplay - annualPensionTaxPaid);

        const collectedAdjustmentDisplay = this.collectTax(
          pensionTaxAdjustmentDisplay, withdrawalOrderedAssets, activePensions, displayCurrency, exchangeRate,
          (gainKRW) => { annualRealizedCapitalGainKRW += gainKRW; }
        );
        annualPensionTaxPaid += collectedAdjustmentDisplay;
        // 초과세도 실질적으로 사적연금 소득에서 빠져나가는 비용이므로 표시되는 소득에도 반영한다.
        annualPrivatePensionIncome = Math.max(0, annualPrivatePensionIncome - collectedAdjustmentDisplay);
      }

      // 해외주식 양도소득세 — 작년에 실현한 이익을 올해 낸다(위 deferredCapitalGainKRW 주석 참고).
      //
      // 마지막 해에는 이월분과 당해 실현분을 함께 부과한다. 그러지 않으면 마지막 해에 실현된
      // 이익이 영원히 과세되지 않고 사라진다.
      let annualCapitalGainsTaxPaidDisplay = 0;
      {
        const isLastYear = y === totalYears - 1;
        const taxableGainKRW = deferredCapitalGainKRW + (isLastYear ? annualRealizedCapitalGainKRW : 0);
        const capitalGainsTaxKRW = calculateCapitalGainsTaxKRW(taxableGainKRW, taxCtx);

        if (capitalGainsTaxKRW > 0) {
          const chargedDisplay = this.convertValue(capitalGainsTaxKRW, 'KRW', displayCurrency, exchangeRate);
          // 세금을 내려고 판 자산에서도 차익이 실현되지만, 그 몫은 다음 해로 넘어가므로
          // 여기서 다시 올해 과세표준에 들어가지 않는다(순환이 생기지 않는 이유다).
          annualCapitalGainsTaxPaidDisplay = this.collectTax(
            chargedDisplay, withdrawalOrderedAssets, activePensions, displayCurrency, exchangeRate,
            (gainKRW) => { annualRealizedCapitalGainKRW += gainKRW; }
          );
        }

        deferredCapitalGainKRW = isLastYear ? 0 : annualRealizedCapitalGainKRW;
      }

      const stockAssetsDisplay = activeAssets.reduce((sum, a) => sum + this.convertValue(a.currentValue, a.currency, displayCurrency, exchangeRate), 0);
      const pensionAssetsDisplay = activePensions.reduce((sum, p) => sum + this.convertValue(p.currentBalance, p.currency, displayCurrency, exchangeRate), 0);
      const isaAssetsDisplay = activeIsas.reduce((sum, i) => sum + this.convertValue(i.currentBalance, i.currency, displayCurrency, exchangeRate), 0);
      const totalAssetsDisplay = stockAssetsDisplay + pensionAssetsDisplay + isaAssetsDisplay + cashBucketDisplay;

      const hasTaxWarning = annualRawFinancialIncomeKRW > taxCtx.profile.financialIncomeThresholdKRW;
      const pensionIncome = annualNationalPensionIncome + annualPrivatePensionIncome;
      const totalIncome = annualDividendIncome + pensionIncome + annualOtherIncome;

      yearlyResults.push({
        age: currentAge, year: currentYear, totalAssets: totalAssetsDisplay,
        stockAssets: stockAssetsDisplay, pensionAssets: pensionAssetsDisplay,
        isaAssets: isaAssetsDisplay,
        cashAssets: cashBucketDisplay,
        dividendIncome: annualDividendIncome, nationalPensionIncome: annualNationalPensionIncome,
        privatePensionIncome: annualPrivatePensionIncome, pensionIncome, otherIncome: annualOtherIncome,
        totalIncome, spending: annualSpending, unmetSpending: annualUnmetSpending,
        healthcareSpending: annualHealthcareCost,
        hasTaxWarning, spouseAlive, spendingFactor,
        preTaxTotalIncome: annualPreTaxTotalIncome,
        dividendTaxPaid: annualDividendTaxPaid, pensionTaxPaid: annualPensionTaxPaid,
        nationalPensionTaxPaid: annualNationalPensionTaxPaid, comprehensiveTaxPaid: annualComprehensiveTaxPaidDisplay,
        healthInsurancePaid: annualHealthInsurancePaidDisplay,
        healthInsuranceIncomeBasis: this.convertValue(healthInsuranceIncomeBasisKRW, 'KRW', displayCurrency, exchangeRate),
        capitalGainsTaxPaid: annualCapitalGainsTaxPaidDisplay,
        privatePensionTaxMethod,
      });

      if (totalAssetsDisplay <= 0 && depletionAge === null) depletionAge = currentAge;

      // 의료비도 소득으로 감당해야 할 지출이다. 빼면 "의료비를 못 내는데 FIRE 달성"이 된다.
      // 생활비에는 그 해의 가구 규모 계수를 곱한다 — 위 monthlyTargetSpending(실제 인출 목표)과
      // 아래 goalAchievementRate의 분모가 모두 곱하므로, 여기만 빼면 한 명만 남아 실제 필요가
      // 0.7배로 줄어든 해에도 2인 기준 소득을 요구해 fireAge가 늦어지거나 null이 된다.
      // annualHealthcareCost에는 computeAnnualHealthcareCost가 이미 곱해 두었으므로 다시 곱하지 않는다.
      const targetSpendingForFIRE = (inflationMode === 'nominal'
        ? userProfile.targetMonthlySpending * 12 * Math.pow(1 + inflationRate / 100, y)
        : userProfile.targetMonthlySpending * 12) * spendingFactor + annualHealthcareCost;

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
      yearlyResults, userProfile, goalAchievementRate, depletionAge, inflationMode, inflationRate, endAge,
      recurringHealthcareByAge
    );

    return {
      yearlyResults,
      // 종료 판정은 같은 반환 객체의 depletionAge/endingAssets/householdEndAge와 같은 기준
      // (가구 종료 나이)을 써야 한다. 본인 기대수명으로 게이트하면 배우자 단독 생존 기간에
      // 달성한 FIRE가 "달성 불가(null)"로 지워진다. 배우자가 없으면 endAge === expectancy라
      // 기존 동작과 완전히 동일하다.
      fireAge: fireAge === null || fireAge >= endAge ? null : fireAge,
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
