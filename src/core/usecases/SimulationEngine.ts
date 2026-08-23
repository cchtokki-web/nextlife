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
  StrategySimulationResult,
  YearLedgerDiagnostics,
} from '../entities/types';
import { getRetirementGrade, RetirementGrade } from '../entities/retirementGrade';
import { roundToWon } from '../entities/money';
import { computeLifetimeUtility, inflationFactorForYear } from './utility/UtilityEngine';
import { computeAnnualHealthcareCostBreakdown } from './healthcare/healthcareCosts';
import { spendingMultiplierForAge } from './spending/spendingCurve';
import { hasSpendingShortfall } from './spending/spendingShortfall';
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
import { InvalidSimulationInputError } from '../entities/errors';
import {
  getNationalPensionAdjustmentFactor,
  NATIONAL_PENSION_NORMAL_START_AGE,
  NATIONAL_PENSION_EARLY_MIN_AGE,
  NATIONAL_PENSION_DEFERRED_MAX_AGE,
} from './pension/nationalPensionRules';
import {
  PRIVATE_PENSION_MIN_START_AGE,
  canWithdrawPrivatePension,
  clampPrivatePensionStartAge,
} from './pension/privatePensionRules';
import { isIsaPrincipalExhausted, isaWithdrawableGross } from './isa/isaRules';
import { sortAssetsForWithdrawal } from './strategy/assetOrdering';
import type { SimulationEngine as SimulationEngineContract } from '../simulation/SimulationEngine';
import type { RetirementGoals, RetirementProfile, RetirementStrategy } from '../domain/input/retirement';
import { LegacySimulationAdapter } from '../domain/input/LegacySimulationAdapter';
import { calculateFundingGap, completeCashFlow } from './cashflow/CashFlowPipeline';
import {
  AssetAccount as WithdrawalAssetAccount,
  WithdrawalEngine,
  WithdrawalAccountType,
  taxFreeAccount,
} from './withdrawal/WithdrawalEngine';
import { calculateRetirementIncomeMetrics } from './metrics/SimulationMetricsCalculator';
import { priceGrowthRate } from './returns/decomposeReturn';
import { shockBeta, weightedAverageTotalReturn } from './returns/portfolioReturn';
import {
  assertLedgerConsistent,
  assertSpendingShortfallExplained,
  buildYearLedger,
} from './ledger/YearLedger';

// 원장 진단이 정의한 「깰 수 있는 선호」 집합. 타입을 여기서 다시 적지 않고 원장 계약에서
// 끌어온다 — 두 벌이 되면 값이 갈라진다.
type BrokenWithdrawalPreference = YearLedgerDiagnostics['brokenPreferences'][number];

// 투영 루프가 도는 최대 연수. 사람의 나이 상한(120세)에서 태어난 해부터 세어도 넘을 수 없는
// 값이라, 정상 입력을 자르지 않으면서 무한에 가까운 루프만 막는다.
const MAX_PROJECTION_YEARS = 121;

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
  // 이 계좌가 시장 충격을 받는 배율(shockBeta). 잔액가중 평균이 1.0이 되도록 정의되어,
  // 포트폴리오 전체 충격은 유도된 변동성 그대로이고 계좌 «간» 분산만 기대수익률을 따른다.
  shockBeta: number;
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
  // 이 계좌가 시장 충격을 받는 배율(shockBeta). 잔액가중 평균이 1.0이 되도록 정의되어,
  // 포트폴리오 전체 충격은 유도된 변동성 그대로이고 계좌 «간» 분산만 기대수익률을 따른다.
  shockBeta: number;
}

interface ActiveIsa extends IsaAccount {
  currentBalance: number;
  totalInvested: number;
  monthsSinceInception: number;
  // ActiveAsset.growthRateAnnual과 같은 이유로 보존한다.
  returnRateAnnual: number;
  returnRateMonthly: number;
  divRateMonthly: number;
  // 이 계좌가 시장 충격을 받는 배율(shockBeta). 잔액가중 평균이 1.0이 되도록 정의되어,
  // 포트폴리오 전체 충격은 유도된 변동성 그대로이고 계좌 «간» 분산만 기대수익률을 따른다.
  shockBeta: number;
}

function pensionWithdrawalAccountType(type: PrivatePension['type']): WithdrawalAccountType {
  if (type === 'irp') return 'IRP';
  if (type === 'savings') return 'PENSION_SAVINGS';
  return 'PRIVATE_PENSION';
}

// 은퇴 준비도 점수의 자산 항목(100점 중 25점)의 분모. 4% 룰(연 필요액 × 25)로 환산한 목표 자산.
//
// 분모는 "그 계획이 실제로 감당해야 할 필요"여야 한다. 다른 목표 분모들
// (goalAchievementRate / UtilityEngine / MonthlySpendingComposition)과 마찬가지로 의료비를
// 포함한다 — 켜면 실제로 필요한 자산이 늘어나는데 분모가 그대로면 의료비를 켠 계획이
// "자산이 충분하다"는 같은 점수를 받는다(FIRE 판정 목표에 의료비를 넣은 것과 같은 이유).
//
// 연령대별 생활비 곡선(spendingCurve)은 **일부러 반영하지 않는다.** 4% 룰은 "이 필요가
// 영구히 반복된다"는 가정 위에 서 있어서 특정 연령 구간의 배수를 25배로 곱하는 것이
// 의미가 없다 — 활동기 배수 1.2를 넣으면 80세 이후에도 그 소비가 영원히 계속된다는
// 목표 자산을 요구하게 되고, 반대로 은퇴 시점 배수가 0.9인 의료·돌봄 대비형은 후반
// 지출이 더 큰데도 목표 자산이 낮아진다. 어느 쪽이든 곡선의 의미와 반대다.
// 대신 곡선의 실제 영향은 assetScore가 아니라 고갈 판정·달성률·효용 소비 축에서 드러난다.
// (일회성 의료비 쇼크를 제외하는 아래 recurringHealthcare 처리와 같은 성격의 판단이다.)
export function computeRetirementTargetAssets(
  targetMonthlyAtRetirement: number,
  annualHealthcareAtRetirement: number
): number {
  const annualNeed = targetMonthlyAtRetirement * 12 + annualHealthcareAtRetirement;
  return Math.max(0, annualNeed) * 25;
}

/**
 * Original formulas retained behind the new domain boundary.
 * `run` and `runForUtility` remain compatibility entry points; `simulate` calls only
 * `runSingle`. Monte Carlo may still call `runSingle` with an explicit return path.
 */
export class LegacySimulationEngine implements SimulationEngineContract {
  simulate(profile: RetirementProfile, strategy: RetirementStrategy): StrategySimulationResult {
    const goals: RetirementGoals = {
      goals: [
        { type: 'retirement_age', targetAge: strategy.retirementAge },
        { type: 'monthly_spending', monthlyAmount: strategy.targetMonthlySpending },
        { type: 'plan_horizon', targetAge: strategy.planHorizonAge },
        ...(strategy.targetBequest === undefined
          ? []
          : [{ type: 'bequest' as const, targetAmount: strategy.targetBequest }]),
      ],
    };
    const params = LegacySimulationAdapter.toLegacy(profile, goals, strategy);

    // The public boundary evaluates exactly one supplied strategy. Utility scoring,
    // sustainable-spending search and Monte Carlo are deliberately not invoked here.
    return this.runSingle(params, undefined, strategy.simulationStartYear);
  }

  // cfg는 목표 우선순위(UtilityConfig.weights)를 반영한 효용 계산에 쓰인다. 생략하면
  // 기본 가중치(DEFAULT_UTILITY_CONFIG)로 계산되어 호출부 9곳(RecommendationEngine 등,
  // 전부 자체적으로 cfg를 다루거나 기본값으로 충분한 곳)의 기존 동작이 그대로 유지된다.
  run(params: SimulationParams, cfg: UtilityConfig = DEFAULT_UTILITY_CONFIG): SimulationResult {
    const strategy = params.spendingStrategy || 'target';

    let result: SimulationResult;
    if (strategy === 'max_sustainable') {
      result = this.findMaxSustainable(params);
    } else {
      const mainResult = this.evaluateProjection(params, this.runSingle(params));
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
    const result = this.evaluateProjection(params, this.runSingle(params));
    const utility = computeLifetimeUtility(result, params, cfg);
    return { ...result, utility };
  }

  // 이진탐색 한 회의 시행 params. 목표 생활비만 바꾸고, **두 바닥은 떼어 낸다.**
  //
  // 상속 하한선(assetFloor)을 인출 경로에 건 채로 탐색하면 이진탐색이 깨진다: 인출이 막힐 뿐
  // 자산은 늘 하한선 위에 남으므로 어떤 생활비를 넣어도 "성공"으로 읽혀 탐색이 상한(5천만원)까지
  // 올라간다. 여기서는 생활비 자체가 자유변수이므로, 하한선은 인출 제약이 아니라
  // **탐색의 성공 조건**(meetsSustainabilityGoal)으로 표현하는 것이 옳다.
  private sustainabilityTrialParams(
    params: SimulationParams,
    targetMonthlySpending: number,
    // 이 시행을 «바닥을 존중한 실행»으로 돌리고 싶을 때의 바닥. 미지정이면 종전대로 바닥을
    // 뗀 채 돈다(아래 delete). 지정하면 사용자의 바닥이 아니라 «호출부가 정한» 바닥이
    // 걸리므로, 탐색이 사용자 입력으로 수렴하는 일(아래 주석의 2,499,999)은 여전히 없다.
    honoredSpendingFloor?: number
  ): SimulationParams {
    const trial: SimulationParams = {
      ...params,
      userProfile: { ...params.userProfile, targetMonthlySpending },
    };
    delete trial.assetFloor;
    // assetFloor와 같은 이유로 HARD 생활비 바닥도 뗀다. 다만 깨지는 방식이 다르다 —
    // **탐색이 바닥을 그대로 되돌려 준다.**
    //
    // 1단계는 바닥까지만 선호를 깨고 그 위로는 지킨다(hardFloorNetNeed). 그래서 선호가
    // 인출을 막고 있는 계획에서는 시행 ≤ 바닥이면 부족분 전체를 선호를 깨고 채워 성공하고,
    // 시행 > 바닥이면 바닥 위쪽이 선호에 막혀 실패한다. 이진탐색이 정확히 바닥으로 수렴한다.
    // 사용자가 넣은 입력값을 계산 결과라고 내놓는 셈이다.
    //
    // 실측(연금 5억·저율과세 한도 ON·60→70세). 이 계획의 «실제» 용량은 선호를 지키면
    // 월 1,181,250원, 선호를 깨면 월 3,446,596원 두 개다:
    //   바닥 없음 → 1,181,250 / 바닥 100만 → 1,181,250 / 바닥 250만 → **2,499,999**
    //   바닥 400만 → 3,446,596 / 바닥 1,000만 → 3,446,596
    // 바닥이 두 용량 사이에 있으면 답이 둘 중 어느 것도 아닌 바닥 자신이 된다.
    //
    // 바닥은 탐색의 **성공 조건이 아니라 탐색 결과와 비교할 기준**이다. 탐색이 끝난 뒤
    // 그 둘을 견주어 «전달되는 계획»을 정하는 것은 findMaxSustainable의 몫이다 — 바닥이
    // 탐색값을 넘으면 계층 1이 개입해 바닥을 존중한 실행으로 다시 잰다.
    delete trial.hardSpendingFloor;
    if (honoredSpendingFloor !== undefined) trial.hardSpendingFloor = honoredSpendingFloor;
    return trial;
  }

  // 이 시행이 "지속 가능"한가. 하한선이 없으면 기존 판정("고갈되지 않았거나 기말자산이 남음")을
  // 비트 단위로 그대로 쓴다.
  private meetsSustainabilityGoal(
    result: StrategySimulationResult,
    assetFloor: number,
    trialParams: SimulationParams
  ): boolean {
    // 잔액이 아주 조금 남았더라도 목표 생활비를 못 쓴 해가 있으면 그 금액은 "지속 가능한
    // 생활비"가 아니다. depletionAge만 보면 인출 가능한 잔액만 쓰고 멈춘 경로가 성공으로
    // 오인되어 탐색 상한(월 5천만원)까지 치솟는다.
    if (result.yearlyResults.some(hasSpendingShortfall)) return false;

    // unmetSpending은 인출 경로가 남긴 진단값이다. 특정 소득/연금 조합에서 그 값이 0으로
    // 남더라도 실제 spending이 목표보다 작으면 지속 가능하다고 볼 수 없다. 탐색이 시험한
    // 월 목표액으로 연도별 필요액을 직접 재구성해 이 두 번째 불변식으로 검증한다.
    const { userProfile, inflationMode, inflationRate } = trialParams;
    const fullyFunded = result.yearlyResults
      .filter((year) => year.age >= userProfile.retirementAge)
      .every((year) => {
        const elapsedYears = year.age - userProfile.currentAge;
        // 연령대별 배수를 여기서도 곱해야 한다. 빼먹으면 배수가 1을 넘는 구간이 언제나
        // "미충당"으로 읽혀 어떤 생활비도 성공 판정을 받지 못하고, 이진탐색이 0으로 붕괴한다.
        const baseAnnualTarget = userProfile.targetMonthlySpending * 12
          * (inflationMode === 'nominal'
            ? Math.pow(1 + inflationRate / 100, elapsedYears)
            : 1)
          * spendingMultiplierForAge(trialParams.spendingCurve, year.age);
        const requiredAnnualSpending = baseAnnualTarget + year.healthcareSpending;
        // 월별 부동소수 계산을 12회 합산하므로 표시 통화 1원 미만의 오차만 허용한다.
        return year.spending + 1 >= requiredAnnualSpending;
      });
    if (!fullyFunded) return false;

    if (assetFloor > 0) return result.endingAssets >= assetFloor;
    return result.depletionAge === null || result.endingAssets > 0;
  }

  // 이진탐색 본체. 두 호출부(findMaxSustainableValue·findMaxSustainable)가 같은 루프를
  // 두 벌로 갖고 있으면 「탐색이 무엇을 재는가」가 조용히 갈라진다 — 한 곳에만 둔다.
  //
  // floorTracksTrial이면 시행마다 **그 시행값 자체**를 HARD 바닥으로 걸고 돈다. 그때 재는
  // 것은 「바닥을 존중한 실행에서 이 계획이 감당하는 최대 생활비」다. 사용자의 바닥값은
  // 여기에 들어오지 않으므로(sustainabilityTrialParams가 먼저 지운다) 탐색이 입력을
  // 되돌려 주는 일은 이 모드에서도 없다 — 바닥을 얼마로 넣든 같은 값이 나온다.
  private searchSustainable(
    params: SimulationParams,
    floorTracksTrial: boolean
  ): {
    bestTarget: number;
    bestResult: StrategySimulationResult | null;
    bestTrialParams: SimulationParams | null;
  } {
    const assetFloor = Math.max(0, params.assetFloor ?? 0);
    let low = 0;
    let high = 50000000; // 5천만원/월
    let bestResult: StrategySimulationResult | null = null;
    let bestTrialParams: SimulationParams | null = null;
    let bestTarget = 0;

    for (let i = 0; i < 30; i++) {
      const mid = (low + high) / 2;
      const trialParams = this.sustainabilityTrialParams(
        params, mid, floorTracksTrial ? mid : undefined
      );
      const result = this.runSingle(trialParams);

      if (this.meetsSustainabilityGoal(result, assetFloor, trialParams)) {
        bestResult = result;
        bestTrialParams = trialParams;
        bestTarget = mid;
        low = mid;
      } else {
        high = mid;
      }
    }
    return { bestTarget, bestResult, bestTrialParams };
  }

  // 'target' 전략이 참고치로 쓰는 값. **바닥을 뗀 채로** 잰다.
  //
  // 고정 생활비 계획에서 이 값은 계획이 쓰는 금액이 아니라 참고치이고, 그 계획의 바닥 미달은
  // 탐색값이 아니라 원장으로 재야 한다(computeSustainableSpendingAdvice 주석). 그래서 아래
  // findMaxSustainable과 달리 여기서는 바닥이 답을 움직이지 않는다.
  private findMaxSustainableValue(params: SimulationParams): number {
    return this.searchSustainable(params, false).bestTarget;
  }

  // max_sustainable 계획의 «전달되는 계획»을 만든다.
  //
  // 탐색은 선호(세제 최적화·계좌 순서·월 인출 목표)를 지킬 때의 용량을 재고, 그 값이 바닥
  // 이상이면 종전과 완전히 같은 결과를 돌려준다. 바닥이 그 값을 **넘을 때만** 계층이 개입한다:
  // HARD 생활비 바닥은 계층 1, 세제 최적화는 계층 5다. 상위 제약을 지키지 못하는 계획을
  // 「이것이 한계입니다」라며 내보내면서 계좌에 돈을 남기는 것이 결함이었다(known-issues 3번).
  //
  // 실측(사적연금 5억·저율과세 한도 ON·60→70세, 바닥 250만):
  //   종전  월 1,181,250 · 기말자산 3.35억 · 세금 890만
  //   지금  월 3,446,597 · 기말자산 0      · 세금 4,505만
  private findMaxSustainable(params: SimulationParams): SimulationResult {
    const searched = this.searchSustainable(params, false);
    const hardSpendingFloor = params.hardSpendingFloor ?? 0;

    // 바닥이 없거나 탐색값이 이미 바닥 이상이면 바닥은 **구속하지 않는다.** 계층은 「필요할
    // 때만」 아래를 깨므로(원장 진단의 brokenPreferences와 같은 규칙) 여기서는 아무것도
    // 깨지 않고 종전 원장을 그대로 돌려준다 — 목표가 없는 계획, 바닥이 낮은 계획, 그리고
    // 바닥이 탐색값과 «정확히 같은» 계획이 여기 해당한다.
    if (!(hardSpendingFloor > searched.bestTarget)) {
      let bestResult = searched.bestResult;
      let bestTrialParams = searched.bestTrialParams;
      if (!bestResult) {
        bestTrialParams = this.sustainabilityTrialParams(params, 0);
        bestResult = this.runSingle(bestTrialParams);
      }
      return {
        ...this.evaluateProjection(bestTrialParams ?? params, bestResult),
        calculatedTargetSpending: searched.bestTarget,
      };
    }

    // 바닥이 구속한다. 이 계획이 실제로 지급하려면 인출이 바닥을 존중해야 하고(2단계 인출),
    // 그 실행에서의 용량은 선호를 지킬 때와 «다른 값»이다. 그래서 같은 실행으로 다시 잰다.
    const honored = this.searchSustainable(params, true);

    // 전달되는 생활비. 바닥을 존중한 용량이 바닥에 못 미치면 그래도 바닥을 지급한다 —
    // 「반드시 지키기」의 뜻이 그것이고, 그 대가인 조기 고갈은 원장의 depletionAge에 남는다.
    const deliveredMonthly = Math.max(hardSpendingFloor, honored.bestTarget);

    // **전달 계획의 바닥은 전달 생활비 자신이다.** 사용자의 바닥(예: 250만)을 그대로 걸면
    // 1단계는 거기까지만 선호를 깨고 그 위(예: 344만까지의 94만)는 세제 한도에 막혀
    // 지급되지 않는다 — 「월 344만원까지 쓸 수 있습니다」라고 답하면서 원장에는 250만원을
    // 찍는, 고치려던 것과 같은 종류의 어긋남이 된다. max_sustainable에서 탐색값은 곧 그
    // 계획의 생활비이므로, 사용자가 생활비를 「반드시 지키기」로 못박은 이상 그 생활비
    // 전체가 계층 1이다. 이것이 스펙의 「런타임 동등」이다.
    const deliveredParams = this.sustainabilityTrialParams(params, deliveredMonthly, deliveredMonthly);
    const deliveredResult = honored.bestResult !== null && deliveredMonthly === honored.bestTarget
      ? honored.bestResult
      : this.runSingle(deliveredParams);

    return {
      ...this.evaluateProjection(deliveredParams, deliveredResult),
      calculatedTargetSpending: deliveredMonthly,
      // 탐색값과 전달 계획이 갈라진 폭을 남긴다(SustainableSpendingFloorOverride 주석).
      sustainableSpendingOverride: {
        preferenceRespectingMonthly: searched.bestTarget,
        floorHonoringMonthly: honored.bestTarget,
        deliveredMonthly,
        hardSpendingFloor,
      },
    };
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

    // **계좌마다 배율이 다르다.** 예전에는 사적연금만 상수 배율(4/7)을 받고 나머지는
    // 1.0이었다. 그 상수는 연금 계좌에 무엇이 들어 있든 언제나 43%를 깎아, 총수익률
    // 14%짜리 커버드콜을 담은 IRP도 채권처럼 흔들렸다. 지금은 각 계좌의 기대수익률과
    // 포트폴리오 가중평균의 비를 쓴다(shockBeta 주석). 잔액가중 평균이 1.0이므로
    // 포트폴리오 전체가 받는 충격의 크기는 유도된 변동성 그대로다.
    for (const asset of activeAssets) {
      asset.growthRateMonthly = toMonthlyCompoundRate(asset.growthRateAnnual + shock * asset.shockBeta);
    }
    for (const pension of activePensions) {
      pension.returnRateMonthly = toMonthlyCompoundRate(pension.returnRateAnnual + shock * pension.shockBeta);
    }
    for (const isa of activeIsas) {
      isa.returnRateMonthly = toMonthlyCompoundRate(isa.returnRateAnnual + shock * isa.shockBeta);
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
  // ISA는 의도적으로 제외한다. 생활비 경로의 WithdrawalEngine은 추적 가능한 납입원금까지만
  // 중도인출하지만, 세금 징수를 위해 ISA 수익금까지 강제 인출할 세제 규칙은 이 모델에 없다.
  // 근거 없는 규칙을 만드는 대신 ISA는 건드리지 않는다 — ISA에만 돈이 남은 해에는 세금이
  // 과소 징수될 수 있으며, 이는 알려진 근사다.
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

    // 계좌별 충격 배율의 분모. 시장 연동 계좌 전체의 잔액가중 평균 총수익률이다.
    // 유도할 잔액이 없으면(전부 0) shockBeta가 모든 계좌에 1을 준다.
    const portfolioAverageReturn = weightedAverageTotalReturn(params) ?? 0;

    const activeAssets: ActiveAsset[] = assets.map((asset) => {
      // 총수익률에서 배당분을 뺀 나머지가 가격상승분이다. 배당은 아래 divRateMonthly로
      // 따로 흐르므로, 여기서 빼지 않으면 배당이 두 번 계산된다.
      const priceGrowthPercent = priceGrowthRate(asset.totalReturn, asset.dividendYield);
      const growthRateAnnual = inflationMode === 'real'
        ? (priceGrowthPercent - inflationRate) / 100
        : priceGrowthPercent / 100;
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
        shockBeta: shockBeta(asset.totalReturn, portfolioAverageReturn),
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
      // **분해하지 않는다.** 연금 계좌 안에는 배당세도 재투자 선택지도 없어 총수익률만이
      // 결과를 결정하고, 성장(기하 복리)과 배당(단리)의 월율 규약이 달라 분해하면 의미
      // 변경을 넘어 산술까지 바뀐다. p.dividendYield는 표시 전용이다(타입 주석 참조).
      const returnRateAnnual = inflationMode === 'real'
        ? (p.totalReturn - inflationRate) / 100
        : p.totalReturn / 100;
      const returnRateMonthly = toMonthlyCompoundRate(returnRateAnnual);

      return {
        ...p,
        currentBalance: p.balance,
        returnRateAnnual,
        returnRateMonthly,
        shockBeta: shockBeta(p.totalReturn, portfolioAverageReturn),
      };
    });

    const activeIsas: ActiveIsa[] = (isaAccounts || []).map((isa) => {
      const priceGrowthPercent = priceGrowthRate(isa.totalReturn, isa.dividendYield);
      const returnRateAnnual = inflationMode === 'real'
        ? (priceGrowthPercent - inflationRate) / 100
        : priceGrowthPercent / 100;
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
        shockBeta: shockBeta(isa.totalReturn, portfolioAverageReturn),
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
      // 안정소득 = 국민연금 + 배당 + 기타소득. 종신 지급이거나 원금을 유지한 채 나오는
      // 흐름이라 계좌가 비어 멈추지 않는다.
      //
      // 사적연금 인출은 뺀다. pensionIncome에는 국민연금과 사적연금이 함께 들어 있는데,
      // 사적연금 인출은 연금계좌라는 자산을 헐어 쓰는 것이라 수동소득이 아니다. 세면
      // 원금 인출이 이 20점을 채운다 — 실측으로 같은 6억을 사적연금으로 들면 69세에
      // 고갈되는데 47점, 일반주식으로 들면 71세까지 버티는데 30점이었다. 더 빨리 고갈되는
      // 계획이 그릇 때문에 17점 높게 나온 것이다.
      //
      // goalAchievementRate(cashFlowScore)와 fireAge도 같은 기준을 쓴다. 두 항목이 같은
      // 개념을 서로 다르게 세면 점수를 설명할 수 없다. 그래서 기타소득도 함께 센다 —
      // 저 둘은 totalIncome(= 배당 + 연금 + 기타)에서 사적연금만 빼는 식이라 기타소득이
      // 들어 있고, 여기만 빼면 임대소득이 있는 사용자가 25점짜리 cashFlowScore·FIRE
      // 판정에서는 인정받고 20점짜리 이 축에서만 0으로 세이는 설명 불가능한 상태가 된다.
      const totalStableIncomeSum = retirementYearsResults.reduce(
        (sum, r) => sum + (r.pensionIncome - r.privatePensionIncome) + r.dividendIncome + r.otherIncome, 0
      );
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
    
    // Logical override: goalAchievementRate는 배당·국민연금·기타소득만 반영하고 자산 매도와
    // 사적연금 인출은 제외한 지표라서, 원금을 계획적으로 인출하며 사는 정상적인 시나리오에서는
    // 100%에 거의 도달하지 못한다. 따라서 이 오버라이드는 goalAchievementRate 대신 실제 자산 추이(은퇴 시작 시점 대비
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

  /** Adds legacy evaluation fields outside the deterministic projection path. */
  private evaluateProjection(
    params: SimulationParams,
    projection: StrategySimulationResult
  ): SimulationResult {
    if (projection.yearlyResults.length === 0) {
      return {
        ...projection,
        fireAge: null,
        retirementScore: 0,
        retirementGrade: '위험',
        goalAchievementRate: 0,
        retirementAssetsAtRetirement: 0,
      };
    }

    const { userProfile, inflationMode, inflationRate } = params;
    const incomeMetrics = calculateRetirementIncomeMetrics(projection.yearlyResults, params);
    const recurringHealthcareByAge = new Map<number, number>();

    for (const year of projection.yearlyResults) {
      recurringHealthcareByAge.set(year.age, computeAnnualHealthcareCostBreakdown({
        healthcare: params.healthcare,
        currentAge: year.age,
        retirementAge: userProfile.retirementAge,
        simulationStartAge: userProfile.currentAge,
        yearsSinceRetirement: year.age - userProfile.retirementAge,
        inflationMode,
        inflationRate,
      }).recurring);
    }

    const fireYear = projection.yearlyResults.find((year) => {
      const elapsedYears = year.age - userProfile.currentAge;
      const curveMultiplier = year.age >= userProfile.retirementAge
        ? spendingMultiplierForAge(params.spendingCurve, year.age)
        : 1;
      const targetSpending = (inflationMode === 'nominal'
        ? userProfile.targetMonthlySpending * 12 * curveMultiplier
          * Math.pow(1 + inflationRate / 100, elapsedYears)
        : userProfile.targetMonthlySpending * 12 * curveMultiplier)
        + year.healthcareSpending;

      // 사적연금 인출은 FIRE 소득이 아니다. 연금저축·IRP는 본인이 적립한 «자산»이고
      // 인출은 원금 소진이라 계좌가 비면 멈춘다. 그것까지 세면 자산을 헐어 쓰는 계획이
      // 「달성」으로 찍히고, 잔액이 클수록 FIRE가 빨라진다 — 사실과 반대 방향이다.
      // (실측: 사적연금 10억을 넣으면 달성 나이가 65세에서 60세로 앞당겨졌다.)
      //
      // 국민연금·배당·기타소득은 남긴다. 종신 지급이거나 원금을 유지한 채 나오는 흐름이라
      // 계좌가 비어 멈추지 않는다. 자산 매도는 애초에 totalIncome에 들어 있지 않다.
      const sustainableIncome = year.totalIncome - year.privatePensionIncome;
      return sustainableIncome >= targetSpending;
    });

    const { retirementScore, retirementGrade, retirementAssetsAtRetirement } =
      this.calculateRetirementScore(
        projection.yearlyResults,
        userProfile,
        incomeMetrics.fixedIncomeCoverageRate,
        projection.depletionAge,
        inflationMode,
        inflationRate,
        recurringHealthcareByAge
      );

    return {
      ...projection,
      fireAge: fireYear === undefined || fireYear.age >= userProfile.expectancy
        ? null
        : fireYear.age,
      retirementScore,
      retirementGrade,
      goalAchievementRate: incomeMetrics.fixedIncomeCoverageRate,
      avgRetirementMonthlyIncome: incomeMetrics.averageMonthlyIncome,
      avgTargetMonthlySpending: incomeMetrics.averageMonthlyTarget,
      retirementAssetsAtRetirement,
    };
  }

  // returnPath는 몬테카를로·시퀀스 리스크 전용 통로다(ReturnShockPath 주석 참고).
  //
  // run()/runForUtility()/findMaxSustainableValue()는 이 인자를 넘기지 않는다 — 저장된
  // 시나리오의 숫자를 한 자리도 바꾸지 않기 위해서다. 확률 경로가 필요한 호출부는
  // runSingle을 직접 부른다(run()은 시행당 이진탐색 30회를 더 돌아 1000시행이면 31,000회가 된다).
  runSingle(
    params: SimulationParams,
    returnPath?: ReturnShockPath,
    simulationStartYear: number = new Date().getFullYear()
  ): StrategySimulationResult {
    if (!params || !params.userProfile) {
      return {
        yearlyResults: [], depletionAge: null, endingAssets: 0,
      };
    }

    // 모든 투영 경로(run, findMaxSustainable, 몬테카를로)가 여기를 지나므로 검증을 한 곳에 둔다.
    //
    // 음수 목표 생활비는 지출이 수입처럼 작동해 기말자산을 **늘린다**(실측: 82.7억 → 103억).
    // 오류 없이 계획이 실제보다 좋아 보이므로 0으로 보정하지 않고 거부한다. 0으로 두어도
    // "생활비를 쓰지 않는 계획"이라 마찬가지로 비현실적으로 낙관적이기 때문이다.
    // 0 자체는 의미가 있으므로 허용하고, 음수 수익률은 정당한 비관 가정이므로 막지 않는다.
    if (params.userProfile.targetMonthlySpending < 0) {
      throw new InvalidSimulationInputError(
        `목표 생활비는 음수일 수 없습니다. 입력값: ${params.userProfile.targetMonthlySpending}`,
      );
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
    const withdrawalEngine = new WithdrawalEngine();

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

    const currentTotalAssetsDisplay = (reservedTaxCashDisplay = 0) =>
      activeAssets.reduce((sum, a) => sum + this.convertValue(a.currentValue, a.currency, displayCurrency, exchangeRate), 0)
      + activePensions.reduce((sum, p) => sum + this.convertValue(p.currentBalance, p.currency, displayCurrency, exchangeRate), 0)
      + activeIsas.reduce((sum, i) => sum + this.convertValue(i.currentBalance, i.currency, displayCurrency, exchangeRate), 0)
      + cashBucketDisplay
      + reservedTaxCashDisplay;

    // 해외주식 양도세는 실현 다음 해 5월에 확정신고·납부한다. 생활비 매도 외의 매도에서
    // 생긴 세액은 금액으로 확정해 다음 해에 징수한다. 차익 흐름을 둘로 나눠 이월하면 각 흐름이
    // 연 250만원 기본공제를 따로 받게 되므로, 연말에 모든 당해 차익을 반드시 합산한다.
    let deferredUnreservedCapitalGainsTaxDisplay = 0;
    // 생활비 매도에서 gross-up한 양도세는 현금으로 유보했다가 다음 해에 납부한다. 유보금은
    // 자산이지만 생활비로 다시 쓸 수 없는 부채 대응 현금이므로 cashBucket과 분리한다.
    let deferredWithdrawalCapitalGainsTaxReserveDisplay = 0;

    const startAge = userProfile.currentAge;
    const endAge = userProfile.expectancy;
    const totalYears = endAge - startAge + 1;

    // 상한도 함께 막는다. 이 루프는 totalYears번 도는데, expectancy가 사람의 나이가 아닌
    // 값이면(저장 데이터는 사용자가 직접 고칠 수 있다) 오류 없이 수억 번을 돌아 탭이 멈춘다.
    // 멈춘 탭은 잘못된 숫자보다 진단하기 어렵다 — 아무 메시지도 남지 않기 때문이다.
    // 로드 경계(normalizeSimulationParams)가 먼저 걸러 내지만, 엔진은 그 경계를 지나지 않은
    // params로도 불릴 수 있으므로 계산하는 쪽에서도 스스로를 지킨다.
    if (isNaN(totalYears) || totalYears <= 0 || totalYears > MAX_PROJECTION_YEARS) {
      return {
        yearlyResults: [], depletionAge: null, endingAssets: 0,
      };
    }

    // 일반자산 인출 개시 나이 — 전략 «선호»(계층 4)이지 법이 막는 것이 아니다. 한 군데서만
    // 정하고 인출 계좌 구성과 아래 withdrawableNowDisplay가 같은 값을 본다.
    const generalAssetStartAgePreference =
      withdrawalPlan?.generalAssetWithdrawalStartAge ?? userProfile.retirementAge;

    /**
     * 그 나이에 인출 엔진이 «실제로 닿을 수 있는» 금액(표시 통화).
     *
     * 원시 잔액이 아니다. 이 엔진은 연말 세금 징수에서 인출 엔진 밖으로도 자산을 팔기 때문에
     * 「잔액이 남았다」와 「인출 엔진이 거기에 닿을 수 있었다」는 서로 다른 질문이고,
     * 설명되지 않는 부족을 판정할 때 필요한 것은 두 번째 질문이다.
     *
     * 단계를 «파라미터»로 받는다. 1단계(HARD 생활비 바닥 충당)는 일반자산 개시 나이를 깨므로
     * 그 제한만 빠지고 계층 밖(법정) 제약 — 사적연금 55세, ISA 납입원금 — 은 두 단계 모두
     * 그대로다. 두 벌로 갈라 두면 인출 계좌 구성과 반드시 어긋난다.
     *
     * 세금 유보금(deferredWithdrawalCapitalGainsTaxReserveDisplay)은 세지 않는다 — 자산이지만
     * 인출 계좌로 등록되지 않아 생활비로 다시 쓸 수 없다.
     */
    const withdrawableNowDisplay = (age: number, fundingHardFloor: boolean): number => {
      let total = cashBucketDisplay;
      if (age >= (fundingHardFloor ? 0 : generalAssetStartAgePreference)) {
        for (const asset of withdrawalOrderedAssets) {
          total += this.convertValue(
            asset.currentValue, asset.currency, displayCurrency, exchangeRate
          );
        }
      }
      for (const isa of activeIsas) {
        total += this.convertValue(
          isaWithdrawableGross(isa.currentBalance, isa.totalInvested),
          isa.currency, displayCurrency, exchangeRate
        );
      }
      if (canWithdrawPrivatePension(age)) {
        for (const pension of activePensions) {
          total += this.convertValue(
            pension.currentBalance, pension.currency, displayCurrency, exchangeRate
          );
        }
      }
      return Math.max(0, total);
    };

    const yearlyResults: SimulationYearlyResult[] = [];
    let depletionAge: number | null = null;

    for (let y = 0; y < totalYears; y++) {
      // 연초자산은 그 해의 수익률 충격을 적용하기 전에 확정한다. applyReturnShock은 현재
      // 잔액을 바꾸지 않지만, 이 순서를 고정해야 향후 충격 구현이 바뀌어도 연초/수익 경계가
      // 흐려지지 않는다. 충격이 반영된 월 성장액은 아래 annualInvestmentReturn에 누적된다.
      const openingAssets = currentTotalAssetsDisplay(
        deferredWithdrawalCapitalGainsTaxReserveDisplay
      );
      // 경로가 없으면 아예 호출하지 않는다(applyReturnShock 주석 참고). 경로가 짧으면
      // 남은 해는 충격 0으로 본다 — 던지지 않는다.
      if (returnPath !== undefined) {
        this.applyReturnShock(activeAssets, activePensions, activeIsas, returnPath[y] ?? 0);
      }
      const currentAge = startAge + y;
      const currentYear = simulationStartYear + y;
      const isRetired = currentAge >= userProfile.retirementAge;

      let annualDividendIncome = 0;
      let annualNationalPensionIncome = 0;
      let annualPrivatePensionIncome = 0;
      let annualOtherIncome = 0;
      let annualTargetSpending = 0;
      let annualSpending = 0;
      // 목표 생활비 중 재원이 모자라 채우지 못한 금액. 인출 경로가 잔액을 넘겨 인출하지
      // 않으므로 부족분은 자산을 마이너스로 만드는 대신 지출에서 조용히 깎인다 —
      // 그 깎인 양을 여기 남긴다(SimulationYearlyResult.unmetSpending 주석 참조).
      let annualUnmetSpending = 0;
      // 진단(YearLedgerDiagnostics). 회계 항등식과 분리된 사실만 모은다 — 무엇을 깼고
      // 무엇에 막혔는가. 목표의 «이름»은 여기 들어오지 않는다(엔진은 목표를 모른다).
      const brokenPreferences = new Set<BrokenWithdrawalPreference>();
      let annualUnmetHardSpending = 0;
      // 인출이 막힌 사유. **연말에 포트폴리오를 훑어 추론하지 않는다.** 그 방식은 「그 순간
      // 이 인출을 막은 것」이 아니라 「연말에 어떤 캡이 존재했는가」를 세므로, 실제 원인이
      // 아닌 캡이 사유 자리를 차지해 진짜 원인을 가린다 — 수익이 조금이라도 난 ISA를 가진
      // 계정이면 언제나 그 ISA가 사유가 되어, 다른 모든 원인이 조용히 설명된 것으로 처리된다.
      // 그래서 «관찰된 사실»로만 기록한다(recordBlockedWithdrawal 호출부 참고).
      //
      // 칸은 «단계마다» 따로 둔다. 한 칸을 두 단계가 나눠 쓰면, 뒤에 도는 2단계의 assetFloor가
      // 앞서 1단계가 본 legalAge·isaPrincipalExhausted를 덮는다 — assetFloor 우선 규칙 때문에.
      // 그러면 그 해를 실제로 막은 사실(계층 1이 법정 캡에 막혔다)이 사라지고, 그 위층 이야기가
      // 원인 자리를 차지한다. 단계를 나누면 아래 우선순위는 «한 단계 안»의 규칙으로 남는다.
      const blockedWithdrawalReasonByPhase: {
        hardFloor?: NonNullable<YearLedgerDiagnostics['blockedWithdrawalReason']>;
        target?: NonNullable<YearLedgerDiagnostics['blockedWithdrawalReason']>;
      } = {};
      const recordBlockedWithdrawal = (
        fundingHardFloor: boolean,
        reason: NonNullable<YearLedgerDiagnostics['blockedWithdrawalReason']>
      ) => {
        const phase = fundingHardFloor ? 'hardFloor' : 'target';
        const recorded = blockedWithdrawalReasonByPhase[phase];
        // assetFloor는 «닿을 수 있는 돈»을 막은 유일한 사유다. 한 단계에서 여러 사유가
        // 관찰되면 그것이 남는다 — 나머지는 애초에 닿을 수 없던 돈에 대한 설명이라 그 위에
        // 덮으면 사용자가 읽는 이유가 실제 원인에서 멀어진다.
        if (recorded === 'assetFloor') return;
        if (recorded !== undefined && reason !== 'assetFloor') return;
        blockedWithdrawalReasonByPhase[phase] = reason;
      };
      // 계층 밖 사유로 상속 하한선이 침범당했는가(YearLedgerDiagnostics.assetFloorBreachedBy).
      let assetFloorBreachedBy: YearLedgerDiagnostics['assetFloorBreachedBy'];
      let annualDividendTaxPaid = 0;
      let annualPensionTaxPaid = 0;
      let annualNationalPensionTaxPaid = 0;
      let annualIsaTaxPaid = 0;
      let annualGeneralAssetWithdrawal = 0;
      let annualIsaWithdrawal = 0;
      let annualPrivatePensionWithdrawal = 0;
      let annualWithdrawal = 0;
      let annualInvestmentReturn = 0;
      let annualPreTaxTotalIncome = 0;
      let annualRawFinancialIncomeKRW = 0;
      // 생활비 외의 매도(종합과세·연금세·전년도 양도세 납부)에서 그 해 실현된 해외주식
      // 양도차익(KRW). 연말에는 생활비 매도 차익과 합쳐 하나의 연간 과세표준을 만든다.
      let annualRealizedCapitalGainKRW = 0;
      // 생활비 인출 차익은 세후 필요액 gross-up을 위해 월중 별도 누적하지만, 기본공제는
      // 아래 연말 정산에서 annualRealizedCapitalGainKRW와 합친 총액에 정확히 한 번만 적용한다.
      let annualWithdrawalRealizedCapitalGainKRW = 0;
      let annualWithdrawalCapitalGainsTaxReserveDisplay = 0;
      // 위 금융소득에서 실제로 원천징수된 세액(KRW). 비교과세의 기납부세액 공제에 쓴다.
      let annualWithheldFinancialTaxKRW = 0;
      let annualPrivatePensionPreTaxKRW = 0;
      let annualNationalPensionPreTaxKRW = 0;
      // 일반계좌·ISA에서 발생한 **세전** 배당 총액(표시 통화). 재투자 여부와 무관하게
      // 전액이 여기 쌓인다 — 회계식에서 배당은 「투자 총수익」의 일부이지 외부에서 새로
      // 들어온 돈이 아니기 때문이다(YearlyLedger 주석).
      let annualGrossDividendDisplay = 0;
      // 위 세전 배당에서 배당세를 뺀 몫이 어디로 갔는가. 계좌 밖으로 나온 것(생활비 재원)과
      // 계좌 안에 남은 것(재투자·ISA 내부)을 나눠 센다 — 「쓸 수 있는 돈인가」가 갈리기 때문이다.
      let annualDividendRetainedNetDisplay = 0;
      // 그 해 실제로 납입된 금액(한도로 잘린 뒤). ISA 납입은 법정 한도에 걸려 입력값보다
      // 작을 수 있으므로 입력에서 되계산할 수 없고, 실제 납입 지점에서 세어야 한다.
      let annualContributionsDisplay = 0;
      // 국민연금·기타소득의 «세전» 연간 합계(표시 통화). 원장의 외부유입 항이다.
      let annualNationalPensionPreTaxDisplay = 0;
      let annualOtherPreTaxDisplay = 0;

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
      });
      const annualHealthcareCost = healthcareCost.total;
      const monthlyHealthcareCost = annualHealthcareCost / 12;

      let monthlyTargetSpending = 0;
      if (isRetired && spendingStrategy !== 'dividend_only') {
        const baseMonthly = inflationMode === 'nominal'
          ? userProfile.targetMonthlySpending * Math.pow(1 + infRateAnnual, y)
          : userProfile.targetMonthlySpending;
        // 연령대별 배수. 곡선이 없으면 1이라 기존 계산과 비트 단위로 같다.
        // meetsSustainabilityGoal·UtilityEngine·MonthlySpendingComposition이 같은 함수를
        // 써야 한다(SimulationParams.spendingCurve 주석).
        monthlyTargetSpending = baseMonthly * spendingMultiplierForAge(params.spendingCurve, currentAge);
      }
      // 의료비는 목표 생활비와 같은 재원(자산 인출)에서 나가므로 월 단위로 환산해 더한다.
      monthlyTargetSpending += monthlyHealthcareCost;

      // HARD 생활비 목표에서 유도된 이 해의 월 바닥(SimulationParams.hardSpendingFloor 주석).
      // 목표 생활비와 **같은** 물가 처리를 한다 — 명목 모드에서 바닥만 물가를 안 타면 해가
      // 갈수록 바닥이 조용히 낮아져 「반드시 지키기」가 이름만 남는다. 그래서 물가 배수는
      // 평가 계층이 쓰는 것과 같은 함수(inflationFactorForYear) 하나에서만 나온다.
      //
      // 연령대별 배수(spendingCurve)는 곱하지 않는다. 그 곡선은 「이만큼 쓰겠다」는 선호이지
      // 「이만큼은 반드시 쓴다」가 아니다. 곡선이 목표를 바닥 아래로 내린 해에는 아래
      // hardFloorNetNeed 계산이 그 해의 부족분(funding.fundingGap)으로 자동으로 잘라 준다 —
      // 계획이 겨냥하지 않은 금액을 엔진이 새로 만들어 쓰지는 않는다.
      //
      // 은퇴 전에는 목표 생활비가 0이라 부족분도 0이므로 바닥도 서지 않는다.
      const monthlyHardSpendingFloorDisplay = (params.hardSpendingFloor !== undefined && isRetired)
        ? params.hardSpendingFloor * inflationFactorForYear(params, currentAge)
        : 0;

      let monthlyNationalPensionDisplay = 0;
      let monthlyNatTaxDisplay = 0;
      let monthlyNatPreTaxTotalDisplay = 0;
      const nationalPensionStartAge = Math.min(
        NATIONAL_PENSION_DEFERRED_MAX_AGE,
        Math.max(NATIONAL_PENSION_EARLY_MIN_AGE, withdrawalPlan?.nationalPensionStartAge ?? NATIONAL_PENSION_NORMAL_START_AGE)
      );
      if (currentAge >= nationalPensionStartAge) {
        const nationalPensionAdjustmentFactor = getNationalPensionAdjustmentFactor(nationalPensionStartAge);
        const natAmountRaw = (inflationMode === 'nominal'
          ? nationalPension.expectedMonthlyAmount * Math.pow(1 + infRateAnnual, y)
          : nationalPension.expectedMonthlyAmount) * nationalPensionAdjustmentFactor;

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
        const cashReturn = cashBucketDisplay * cashYieldRateMonthly;
        cashBucketDisplay += cashReturn;
        annualInvestmentReturn += cashReturn;

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
          annualInvestmentReturn += this.convertValue(
            growth, isa.currency, displayCurrency, exchangeRate
          );
          isa.totalInvested += contribution;
          isa.monthsSinceInception += 1;
          annualContributionsDisplay += this.convertValue(contribution, isa.currency, displayCurrency, exchangeRate);

          // **ISA 계좌 «안에서» 생긴 배당은 사용자의 배당소득이 아니다.** 위에서 보듯
          // 전액이 계좌 잔액에 남고 한 푼도 손에 들어오지 않는다. 그런데도 예전에는
          // annualDividendIncome에 더해져, 화면의 「배당소득」과 생활비 재원 구성이
          // 실재하지 않는 소득을 세고 있었다(커버드콜 ISA의 21.2% 분배율이 그대로
          // 배당소득으로 잡혔다). 실제로 ISA에서 자금을 «인출»했을 때만 외부 현금흐름이
          // 되며, 그 경로는 아래 WithdrawalEngine의 ISA 계좌가 담당한다.
          //
          // 대신 원장의 투자 총수익에는 반드시 들어간다 — 잔액은 실제로 그만큼 늘었으므로
          // 어디에도 세지 않으면 총자산 항등식이 깨진다.
          const divDisplay = this.convertValue(dividend, isa.currency, displayCurrency, exchangeRate);
          annualGrossDividendDisplay += divDisplay;
          // ISA는 만기에 한 번에 정산하므로 발생 시점의 원천징수가 없다 — 세전 전액이 계좌에 남는다.
          annualDividendRetainedNetDisplay += divDisplay;
          annualPreTaxTotalIncome += divDisplay;

          if (isa.monthsSinceInception >= isa.maturityYears * 12) {
            const totalProfit = isa.currentBalance - isa.totalInvested;
            const exemptionLimit = this.convertValue(getIsaExemptionLimitKRW(isa.type, taxCtx), 'KRW', isa.currency, exchangeRate);
            const taxAmount = calculateIsaMaturityTax(totalProfit, exemptionLimit, taxCtx);
            annualIsaTaxPaid += this.convertValue(
              taxAmount, isa.currency, displayCurrency, exchangeRate
            );
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
          annualInvestmentReturn += this.convertValue(
            growth, asset.currency, displayCurrency, exchangeRate
          );
          // 세전 배당은 재투자 여부와 무관하게 전액이 투자 총수익이다(YearlyLedger 주석).
          annualGrossDividendDisplay += this.convertValue(dividendRaw, asset.currency, displayCurrency, exchangeRate);
          annualContributionsDisplay += this.convertValue(contribution, asset.currency, displayCurrency, exchangeRate);
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
            // **재투자한 배당은 배당«소득»이 아니다.** 현금이 계좌를 떠나지 않으므로
            // 생활비로 쓸 수 없고, 쓰려면 자산을 팔아야 한다(그때는 양도세가 붙는다).
            // 예전에는 여기서 annualDividendIncome에 더해, 배당을 전액 재투자하는 계획도
            // 화면에는 「배당소득 월 40만원」이 찍혔다. 그 숫자를 재원으로 세는
            // MonthlySpendingComposition은 그만큼 자산인출을 과소 표시했고,
            // 은퇴 준비도의 「고정소득」 축과 목표 달성률도 함께 부풀었다.
            //
            // 잔액이 늘어난 사실은 위 annualGrossDividendDisplay가 투자 총수익으로 세므로
            // 총자산 항등식은 그대로 성립한다.
            annualDividendRetainedNetDisplay += this.convertValue(dividendNet, asset.currency, displayCurrency, exchangeRate);
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

        // 정기 인출(잔액 ÷ 잔여개월)이 넘어서면 안 되는 이 달의 «순» 필요액.
        //
        // 균등분할액은 나이가 들수록 커진다(60세 3.3% → 70세 5% → 80세 10%). 상한이 없으면
        // 어느 시점부터 생활비를 넘겨 인출되고, 남은 돈은 갈 곳이 없어 잉여현금이 된다.
        // 현금을 자산으로 되돌리는 경로가 없어 그대로 단조 누적되므로, 사용자는 연금소득세를
        // 물고 실질수익률 -2%인 계좌에 돈을 재워 두게 된다.
        //
        // 균등분할식은 법정 연금수령한도(평가액 ÷ (11 - 연금수령연차) × 120%)가 아니라
        // 기대수명까지 나누는 편의 가정이다. 실제 연금저축·IRP는 수령 개시 후에도 수령액을
        // 조절할 수 있고 최소 의무 수령액이 없다 — 제도가 두는 것은 상한뿐이므로, 필요액까지만
        // 빼는 것은 제도를 왜곡하지 않는다. 새 가정을 더하는 것이 아니라 근거 없는 강제 인출을
        // 걷어내는 쪽이다.
        //
        // 아래 funding gap(calculateFundingGap)과 같은 뺄셈이지만, 연금 인출액을 정하려면
        // 그보다 먼저 알아야 해서 여기서 구한다. 계좌가 여럿이면 이 잔여액을 공유한다 —
        // 계좌마다 필요액을 새로 주면 계좌 수만큼 중복 인출된다.
        let remainingMonthlyNeedDisplay = Math.max(0, calculateFundingGap(monthlyTargetSpending, {
          employment: 0,
          nationalPension: monthlyNationalPensionDisplay,
          privatePension: 0,
          dividend: monthlyDividendIncomeNetDisplay,
          other: monthlyOtherIncomeTotalDisplay,
        }).fundingGap);

        activePensions.forEach((pension) => {
          if (pension.currentBalance < 0) pension.currentBalance = 0;
          const growth = pension.currentBalance * pension.returnRateMonthly;
          const contribution = isRetired ? 0 : pension.monthlyContribution;
          pension.currentBalance += growth + contribution;
          annualInvestmentReturn += this.convertValue(
            growth, pension.currency, displayCurrency, exchangeRate
          );
          annualContributionsDisplay += this.convertValue(contribution, pension.currency, displayCurrency, exchangeRate);

          // 계좌군 정책을 명시한 새 경로에서는 사적연금을 여기서 선지급하지 않는다. Funding Gap
          // 아래의 단일 WithdrawalEngine 호출이 GENERAL/ISA/PENSION 우선순위를 실제로 결정한다.
          // 정책 미지정 시에만 기존의 정기 균등분할/정액 지급을 유지해 저장 시나리오를 보존한다.
          if (
            isRetired
            && pension.currentBalance > 0
            && withdrawalPlan?.accountWithdrawalPolicy === undefined
          ) {
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
                const evenSplit = pension.currentBalance / remainingMonths;
                // 균등분할액은 「이만큼까지 뺄 수 있다」이지 「이만큼 빼야 한다」가 아니다.
                // 필요액은 세후 기준이므로 세율만큼 그로스업해 비교한다 — 그러지 않으면
                // 세금만큼 덜 빼서 매달 생활비가 모자란다.
                const taxRateForCap = getPrivatePensionIncomeTaxRate(currentAge, taxCtx);
                const needGrossInPensionCurrency = this.convertValue(
                  remainingMonthlyNeedDisplay / Math.max(1e-9, 1 - taxRateForCap),
                  displayCurrency, pension.currency, exchangeRate
                );
                drawAmountRaw = Math.min(evenSplit, needGrossInPensionCurrency);
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
                Math.max(0, currentTotalAssetsDisplay(
                  deferredWithdrawalCapitalGainsTaxReserveDisplay
                    + annualWithdrawalCapitalGainsTaxReserveDisplay
                ) - assetFloorDisplay),
                displayCurrency, pension.currency, exchangeRate
              );
              drawAmountRaw = Math.min(drawAmountRaw, headroomInPensionCurrency);
            }

            // pensionWithdrawalsStarted가 false면 drawAmountRaw는 항상 0이라 세율 값 자체는 결과에
            // 영향을 주지 않지만, getPrivatePensionIncomeTaxRate는 "55세 미만으로 호출되지 않는다"는
            // 불변식을 전제하므로(taxRates.ts 주석 참고) 그 불변식을 실제로 지키기 위해 게이트를 건다.
            const taxRate = pensionWithdrawalsStarted ? getPrivatePensionIncomeTaxRate(currentAge, taxCtx) : 0;

            // 정기 사적연금 지급도 계좌 잔액을 직접 깎지 않고 WithdrawalEngine을 통한다.
            // 이 호출은 계획이 정한 지급액을 실행할 뿐, 엔진이 지급 전략을 추천하지 않는다.
            const plannedWithdrawal = withdrawalEngine.withdraw({
              age: currentAge,
              year: currentYear,
              netCashRequired: drawAmountRaw - drawAmountRaw * taxRate,
              accounts: [{
                id: pension.id,
                type: pensionWithdrawalAccountType(pension.type),
                balance: pension.currentBalance,
                minimumWithdrawalAge: PRIVATE_PENSION_MIN_START_AGE,
                withdrawalLimit: drawAmountRaw,
                estimatedTaxRate: taxRate,
                availableGross: () => pension.currentBalance,
                withdrawForNet: (_netRequested, grossLimit) => {
                  const gross = grossLimit;
                  pension.currentBalance -= gross;
                  const tax = gross * taxRate;
                  return { gross, tax, net: gross - tax };
                },
              }],
              strategy: { policy: 'CUSTOM', customOrder: [pension.id] },
            });
            const drawAmountActual = plannedWithdrawal.grossWithdrawal;
            const drawAmountTax = plannedWithdrawal.tax;
            const drawAmountNet = plannedWithdrawal.netWithdrawal;

            const drawAmountNetDisplay = this.convertValue(drawAmountNet, pension.currency, displayCurrency, exchangeRate);
            // 다음 계좌는 이미 채워진 만큼을 빼고 본다.
            remainingMonthlyNeedDisplay = Math.max(0, remainingMonthlyNeedDisplay - drawAmountNetDisplay);
            monthlyPensionIncomeNetDisplay += drawAmountNetDisplay;
            annualPensionTaxPaid += this.convertValue(drawAmountTax, pension.currency, displayCurrency, exchangeRate);
            annualPreTaxTotalIncome += this.convertValue(drawAmountActual, pension.currency, displayCurrency, exchangeRate);
            annualPrivatePensionPreTaxKRW += this.convertValue(drawAmountActual, pension.currency, 'KRW', exchangeRate);
            const drawAmountDisplay = this.convertValue(
              drawAmountActual, pension.currency, displayCurrency, exchangeRate
            );
            annualPrivatePensionWithdrawal += drawAmountDisplay;
            annualWithdrawal += drawAmountDisplay;
          } else if (
            !isRetired &&
            canWithdrawPrivatePension(currentAge) &&
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
              const bridgeWithdrawal = withdrawalEngine.withdraw({
                age: currentAge,
                year: currentYear,
                netCashRequired: drawAmountRaw - drawAmountRaw * taxRate,
                accounts: [{
                  id: pension.id,
                  type: pensionWithdrawalAccountType(pension.type),
                  balance: pension.currentBalance,
                  minimumWithdrawalAge: PRIVATE_PENSION_MIN_START_AGE,
                  withdrawalLimit: drawAmountRaw,
                  estimatedTaxRate: taxRate,
                  availableGross: () => pension.currentBalance,
                  withdrawForNet: (_netRequested, grossLimit) => {
                    const gross = grossLimit;
                    pension.currentBalance -= gross;
                    const tax = gross * taxRate;
                    return { gross, tax, net: gross - tax };
                  },
                }],
                strategy: { policy: 'CUSTOM', customOrder: [pension.id] },
              });
              const drawAmountActual = bridgeWithdrawal.grossWithdrawal;
              const drawAmountTax = bridgeWithdrawal.tax;
              const drawAmountNet = bridgeWithdrawal.netWithdrawal;
              remainingBridgeLimitKRW -= this.convertValue(drawAmountActual, pension.currency, 'KRW', exchangeRate);

              // 인출액이 이미 ISA 룸으로 캡되어 있으므로 순액은 전액 적립된다(소실 없음).
              const netInIsaCurrency = this.convertValue(drawAmountNet, pension.currency, activeIsas[0].currency, exchangeRate);
              activeIsas[0].currentBalance += netInIsaCurrency;
              activeIsas[0].totalInvested += netInIsaCurrency;
              isaBridgeRoomRemainingInIsaCurrency = Math.max(0, isaBridgeRoomRemainingInIsaCurrency - netInIsaCurrency);

              annualPensionTaxPaid += this.convertValue(drawAmountTax, pension.currency, displayCurrency, exchangeRate);
              annualPreTaxTotalIncome += this.convertValue(drawAmountActual, pension.currency, displayCurrency, exchangeRate);
              annualPrivatePensionPreTaxKRW += this.convertValue(drawAmountActual, pension.currency, 'KRW', exchangeRate);
              const drawAmountDisplay = this.convertValue(
                drawAmountActual, pension.currency, displayCurrency, exchangeRate
              );
              annualPrivatePensionWithdrawal += drawAmountDisplay;
              annualWithdrawal += drawAmountDisplay;
            }
          }
        });
        annualPrivatePensionIncome += monthlyPensionIncomeNetDisplay;

        // Incomes
        annualNationalPensionIncome += monthlyNationalPensionDisplay;
        annualNationalPensionTaxPaid += monthlyNatTaxDisplay;
        annualPreTaxTotalIncome += monthlyNatPreTaxTotalDisplay;
        annualNationalPensionPreTaxDisplay += monthlyNatPreTaxTotalDisplay;

        annualOtherIncome += monthlyOtherIncomeTotalDisplay;
        annualPreTaxTotalIncome += monthlyOtherPreTaxTotalDisplay;
        annualOtherPreTaxDisplay += monthlyOtherPreTaxTotalDisplay;

        const monthlyTotalIncome = monthlyDividendIncomeNetDisplay + monthlyPensionIncomeNetDisplay + monthlyNationalPensionDisplay + monthlyOtherIncomeTotalDisplay;
        // dividend_only는 목표 생활비를 쓰지 않고 "그달 들어온 소득만큼만" 쓰는 전략이라
        // monthlyTargetSpending을 참조하지 않는다. 그래서 의료비를 여기에 따로 더해 준다 —
        // 더하지 않으면 healthcareSpending은 기록되는데 실제로는 한 푼도 나가지 않아
        // "spending에 포함된 금액"이라는 필드 정의가 이 전략에서만 거짓이 된다.
        // 의료비는 배당으로 감당되지 않으면 자산 인출로 충당된다(아래 shortfall 로직).
        const targetMonthlyCashNeed = (isRetired && spendingStrategy === 'dividend_only')
          ? monthlyTotalIncome + monthlyHealthcareCost
          : monthlyTargetSpending;
        annualTargetSpending += targetMonthlyCashNeed;

        // Cash-flow pipeline: 목표액과 모든 가용소득을 먼저 확정한 뒤 Funding Gap만 인출 엔진에
        // 요청한다. Shortfall은 인출 결과(세후 현금)가 돌아온 뒤 completeCashFlow에서만 계산된다.
        const funding = calculateFundingGap(targetMonthlyCashNeed, {
          // 현재 도메인에는 별도 근로소득 필드가 없고 은퇴 전 목표 생활비도 0이다. 근거 없는
          // 소득을 만들지 않고 0으로 명시해 파이프라인의 계산 순서만 고정한다.
          employment: 0,
          nationalPension: monthlyNationalPensionDisplay,
          privatePension: monthlyPensionIncomeNetDisplay,
          dividend: monthlyDividendIncomeNetDisplay,
          other: monthlyOtherIncomeTotalDisplay,
        });

        if (funding.surplus > 0) {
          // 쓰고 남은 돈은 현금으로 둔다. 자산에 도로 집어넣으면 "재투자하지 않겠다"는
          // 선택이 조용히 재투자가 된다(cashBucketDisplay 선언부 주석 참고).
          cashBucketDisplay += funding.surplus;
        }

        // 인출 계좌 구성은 「지금 채우는 것이 HARD 생활비 바닥인가」 하나로 갈린다.
        // 인출 루프를 두 벌로 복제하지 않는다 — 세금 누적·양도차익 이연·원장 항등식이 모두
        // 그 위에 서 있어 두 벌이 되면 반드시 갈라진다. 대신 이 함수 하나에 단계를 넘겨
        // «클램프 적용 여부»만 가른다.
        const buildWithdrawalAccounts = (fundingHardFloor: boolean): WithdrawalAssetAccount[] => {
          const withdrawalAccounts: WithdrawalAssetAccount[] = [];
          // 이미 손에 있는 현금은 법정 인출 나이와 무관하며 세금도 없다.
          withdrawalAccounts.push(taxFreeAccount({
            id: 'simulation-cash',
            type: 'CASH',
            balance: () => cashBucketDisplay,
            withdraw: (gross) => {
              const actual = Math.min(cashBucketDisplay, gross);
              cashBucketDisplay -= actual;
              return actual;
            },
          }));

          // 일반자산 인출 개시 나이는 전략 «선호»(계층 4)다. HARD 생활비 바닥(계층 1)을
          // 채우는 1단계에서는 깬다 — 법이 막는 것이 아니라 계획이 미뤄 둔 것뿐이다.
          const generalAssetWithdrawalStartAge = fundingHardFloor
            ? 0
            : generalAssetStartAgePreference;
          for (const asset of withdrawalOrderedAssets) {
              withdrawalAccounts.push({
                id: asset.id,
                type: 'GENERAL',
                balance: this.convertValue(
                  asset.currentValue, asset.currency, displayCurrency, exchangeRate
                ),
                minimumWithdrawalAge: generalAssetWithdrawalStartAge,
                estimatedTaxRate: asset.capitalGainsTaxable
                  ? (currentTaxSettings.capitalGainsTaxRate !== undefined
                    ? currentTaxSettings.capitalGainsTaxRate / 100
                    : taxCtx.profile.overseasCapitalGainsTaxRate)
                  : 0,
                availableGross: () => this.convertValue(
                  asset.currentValue, asset.currency, displayCurrency, exchangeRate
                ),
                withdrawForNet: (netRequested, grossLimit) => {
                  const availableDisplay = this.convertValue(
                    asset.currentValue, asset.currency, displayCurrency, exchangeRate
                  );
                  const cappedGross = Math.min(availableDisplay, grossLimit);
                  const valueBefore = asset.currentValue;
                  const basisRatio = valueBefore > 0
                    ? Math.min(1, Math.max(0, asset.costBasis / valueBefore))
                    : 1;

                  const preview = (grossDisplay: number) => {
                    if (!asset.capitalGainsTaxable) return { taxDisplay: 0, netDisplay: grossDisplay };
                    const grossAssetCurrency = this.convertValue(
                      grossDisplay, displayCurrency, asset.currency, exchangeRate
                    );
                    const gainKRW = this.convertValue(
                      grossAssetCurrency * (1 - basisRatio), asset.currency, 'KRW', exchangeRate
                    );
                    const priorTaxKRW = calculateCapitalGainsTaxKRW(
                      annualWithdrawalRealizedCapitalGainKRW, taxCtx
                    );
                    const totalTaxKRW = calculateCapitalGainsTaxKRW(
                      annualWithdrawalRealizedCapitalGainKRW + gainKRW, taxCtx
                    );
                    const taxDisplay = this.convertValue(
                      Math.max(0, totalTaxKRW - priorTaxKRW), 'KRW', displayCurrency, exchangeRate
                    );
                    return { taxDisplay, netDisplay: Math.max(0, grossDisplay - taxDisplay) };
                  };

                  let grossDisplay = cappedGross;
                  if (preview(cappedGross).netDisplay > netRequested) {
                    let low = 0;
                    let high = cappedGross;
                    // 단조인 세후 매도대금의 역산. 원 단위보다 충분히 작은 오차로 수렴한다.
                    for (let i = 0; i < 48; i++) {
                      const mid = (low + high) / 2;
                      if (preview(mid).netDisplay < netRequested) low = mid;
                      else high = mid;
                    }
                    grossDisplay = high;
                  }

                  // 「1단계가 돌았다」가 아니라 「개시 나이를 넘겨 «실제로» 팔았다」일 때만
                  // 기록한다. 이미 개시 나이가 지난 해에는 1단계도 아무것도 깨지 않는다.
                  if (
                    fundingHardFloor
                    && grossDisplay > 0
                    && currentAge < generalAssetStartAgePreference
                  ) {
                    brokenPreferences.add('generalAssetStartAge');
                  }

                  const gainAssetCurrency = applySale(
                    asset,
                    this.convertValue(grossDisplay, displayCurrency, asset.currency, exchangeRate)
                  );
                  const gainKRW = asset.capitalGainsTaxable
                    ? this.convertValue(gainAssetCurrency, asset.currency, 'KRW', exchangeRate)
                    : 0;
                  const priorTaxKRW = calculateCapitalGainsTaxKRW(
                    annualWithdrawalRealizedCapitalGainKRW, taxCtx
                  );
                  annualWithdrawalRealizedCapitalGainKRW += gainKRW;
                  const taxKRW = calculateCapitalGainsTaxKRW(
                    annualWithdrawalRealizedCapitalGainKRW, taxCtx
                  ) - priorTaxKRW;
                  const taxDisplay = this.convertValue(taxKRW, 'KRW', displayCurrency, exchangeRate);
                  annualWithdrawalCapitalGainsTaxReserveDisplay += taxDisplay;

                  return {
                    gross: grossDisplay,
                    tax: taxDisplay,
                    net: Math.max(0, grossDisplay - taxDisplay),
                  };
                },
              });
          }

          // ISA도 인출 계좌로 등록한다. 예전에는 계좌군 정책을 «명시»한 경로에서만
          // 등록했는데(옛 시나리오 호환), 그 게이트가 정책 기본값과 모순이었다 —
          // 아래 withdrawalEngine 호출은 정책 미지정 시 'GENERAL_FIRST'를 쓰고
          // 그 순서에는 ISA가 마지막으로 들어 있다(WithdrawalEngine의 POLICY_ORDER).
          // 즉 엔진은 「GENERAL_FIRST를 쓴다」고 말하면서 정렬할 ISA를 주지 않았고,
          // ISA만 들고 있는 계획은 잔액이 그대로인 채 매년 생활비 전액이 미충족으로
          // 기록됐다(총자산이 줄지 않아 고갈로도 잡히지 않는다).
          //
          // 중도인출은 프로젝트가 확실히 추적하는 납입원금(totalInvested) 범위로
          // 제한한다 — 한국 ISA가 그 범위의 중도인출을 허용하므로 모델이 현실과 맞고,
          // 수익금은 만기까지 남아 비과세 한도 계산에 그대로 들어간다.
          // 순서상 마지막이므로 다른 계좌를 다 쓴 뒤에만 헐린다.
          for (const isa of activeIsas) {
            withdrawalAccounts.push(taxFreeAccount({
              id: isa.id,
              type: 'ISA',
              balance: () => this.convertValue(
                isa.currentBalance, isa.currency, displayCurrency, exchangeRate
              ),
              availableGross: () => this.convertValue(
                isaWithdrawableGross(isa.currentBalance, isa.totalInvested),
                isa.currency, displayCurrency, exchangeRate
              ),
              withdraw: (grossDisplay) => {
                const grossIsaCurrency = this.convertValue(
                  grossDisplay, displayCurrency, isa.currency, exchangeRate
                );
                const actual = Math.min(
                  isaWithdrawableGross(isa.currentBalance, isa.totalInvested),
                  grossIsaCurrency
                );
                isa.currentBalance -= actual;
                isa.totalInvested -= actual;
                return this.convertValue(actual, isa.currency, displayCurrency, exchangeRate);
              },
            }));
          }

          // 사적연금은 55세부터만 법적으로 인출할 수 있다. 세후 필요액을 기준으로 세전 인출액을
          // 역산하며, 사용자 전략의 월 목표와 저율과세 한도는 계약상 가용액으로 유지한다.
          if (canWithdrawPrivatePension(currentAge)) {
            const taxRate = getPrivatePensionIncomeTaxRate(currentAge, taxCtx);
            for (const pension of activePensions) {
              withdrawalAccounts.push({
                id: pension.id,
                type: pensionWithdrawalAccountType(pension.type),
                balance: this.convertValue(
                  pension.currentBalance, pension.currency, displayCurrency, exchangeRate
                ),
                minimumWithdrawalAge: PRIVATE_PENSION_MIN_START_AGE,
                estimatedTaxRate: taxRate,
                availableGross: () => {
                  let available = this.convertValue(
                    pension.currentBalance, pension.currency, displayCurrency, exchangeRate
                  );
                  // 저율과세 한도(계층 5)와 월 인출 목표(계층 4)는 1단계에서 깬다.
                  // 「인출 가능 여부 ≠ 저율과세 여부」 — 한도를 넘으면 세율이 오를 뿐이고,
                  // 초과분 정산(연말 16.5% 분리과세 vs 종합과세 비교)은 이미 아래에 있다.
                  // 세금을 아끼려고 굶는 계획을 만들지 않는다.
                  //
                  // 55세 게이트(위 if)와 ISA 납입원금 한도는 계층 밖(법정)이라 그대로 지킨다.
                  if (!fundingHardFloor && currentTaxSettings.limitPrivatePensionToTaxLimit) {
                    available = Math.min(available, this.convertValue(
                      Math.max(0, monthlyPensionPreTaxLimitRemainingKRW),
                      'KRW', displayCurrency, exchangeRate
                    ));
                  }
                  if (!fundingHardFloor && remainingMonthlyPensionTargetKRW !== undefined) {
                    available = Math.min(available, this.convertValue(
                      Math.max(0, remainingMonthlyPensionTargetKRW),
                      'KRW', displayCurrency, exchangeRate
                    ));
                  }
                  return Math.max(0, available);
                },
                withdrawForNet: (netRequested, grossLimit) => {
                  const grossDisplay = Math.min(
                    grossLimit,
                    taxRate < 1 ? netRequested / (1 - taxRate) : 0
                  );
                  const grossPensionCurrency = this.convertValue(
                    grossDisplay, displayCurrency, pension.currency, exchangeRate
                  );
                  pension.currentBalance -= grossPensionCurrency;
                  const grossKRW = this.convertValue(grossDisplay, displayCurrency, 'KRW', exchangeRate);
                  // 클램프를 «넘겨» 꺼냈을 때만 깬 것으로 센다. 1단계라도 남은 한도 안에서
                  // 끝난 달은 아무것도 깨지 않았다. 아래 차감보다 «먼저» 재야 남은 한도가
                  // 이 인출 직전 값이다. 원 미만 초과는 세후 필요액 역산의 잔돈이라 뺀다.
                  if (fundingHardFloor && grossKRW > 0) {
                    if (
                      currentTaxSettings.limitPrivatePensionToTaxLimit
                      && grossKRW > Math.max(0, monthlyPensionPreTaxLimitRemainingKRW) + 1
                    ) {
                      brokenPreferences.add('pensionTaxLimit');
                    }
                    if (
                      remainingMonthlyPensionTargetKRW !== undefined
                      && grossKRW > Math.max(0, remainingMonthlyPensionTargetKRW) + 1
                    ) {
                      brokenPreferences.add('pensionMonthlyTarget');
                    }
                  }
                  // 한도 잔량은 **단계와 무관하게** 계속 차감한다. 1단계가 한도를 넘겨 꺼낸
                  // 만큼도 여기서 빠져야 (1) 2단계가 남지 않은 한도를 다시 쓰지 않고
                  // (2) 연말 정산이 총 인출액을 봐야 초과분에 세금이 제대로 붙는다.
                  // «클램프»만 끄고 «부기»는 끄지 않는다.
                  if (currentTaxSettings.limitPrivatePensionToTaxLimit) {
                    monthlyPensionPreTaxLimitRemainingKRW -= grossKRW;
                  }
                  if (remainingMonthlyPensionTargetKRW !== undefined) {
                    remainingMonthlyPensionTargetKRW -= grossKRW;
                  }

                  const taxDisplay = grossDisplay * taxRate;
                  const netDisplay = grossDisplay - taxDisplay;
                  monthlyPensionIncomeNetDisplay += netDisplay;
                  annualPrivatePensionIncome += netDisplay;
                  annualPensionTaxPaid += taxDisplay;
                  annualPreTaxTotalIncome += grossDisplay;
                  annualPrivatePensionPreTaxKRW += grossKRW;
                  return { gross: grossDisplay, tax: taxDisplay, net: netDisplay };
                },
              });
            }
          }
          return withdrawalAccounts;
        };

        // 한 단계의 인출. 계좌 «구성»만 단계로 갈리고 세금·원장 누적은 이 한 경로를 지난다.
        const withdrawForPhase = (fundingHardFloor: boolean, netCashRequired: number): number => {
          // 필요액이 없으면 계좌를 만들지도 않는다. 예전에도 부족분이 0인 달은 빈 계좌 목록으로
          // 호출해 전부 0을 돌려받았으므로 결과는 같다.
          if (netCashRequired <= 0) return 0;
          // 보호자산(assetFloor) 여유는 단계마다 다시 잰다 — 1단계가 이미 자산을 줄였기
          // 때문이다. 한 번만 재면 2단계가 이미 쓴 여유를 다시 쓴다. 1단계가 하한선 «아래»로
          // 내려간 해에는 이 값이 음수가 되는데, Math.max(0, ...)이 0으로 눌러 2단계는
          // 아무것도 더 꺼내지 못한다(WithdrawalEngine은 headroom이 0이면 루프를 끊는다).
          const floorHeadroom = assetFloorDisplay > 0
            ? Math.max(0, currentTotalAssetsDisplay(
              deferredWithdrawalCapitalGainsTaxReserveDisplay
                + annualWithdrawalCapitalGainsTaxReserveDisplay
            ) - assetFloorDisplay)
            : Infinity;
          // 계층 1(HARD 생활비 바닥)이 계층 2(assetFloor = 상속 하한선·고갈 방지)를 «이긴다».
          // 1단계는 하한선을 넘겨서라도 바닥을 채운다. 2단계(계층 3)는 그대로 지킨다 —
          // 목표 생활비까지 채우자고 상속 하한선을 깨지는 않는다.
          const protectedHeadroom = fundingHardFloor ? Infinity : floorHeadroom;
          const withdrawal = withdrawalEngine.withdraw({
            age: currentAge,
            year: currentYear,
            netCashRequired,
            accounts: buildWithdrawalAccounts(fundingHardFloor),
            strategy: {
              policy: withdrawalPlan?.accountWithdrawalPolicy ?? 'GENERAL_FIRST',
              customOrder: withdrawalPlan?.customWithdrawalOrder,
            },
            liquidatableHeadroom: protectedHeadroom,
          });
          // 무엇이 이 인출을 막았는가 — «이 호출에서 관찰된» 사실만 적는다.
          //
          // 전제부터가 관찰이다. 필요액이 남은 채로 끝났을 때만 무언가가 막은 것이고,
          // 원 미만의 잔여는 세후 필요액 역산의 잔돈이라 막힌 것이 아니다.
          if (withdrawal.unfulfilledAmount > 1) {
            if (
              // 1단계에서는 도달할 수 없는 가지다(위에서 Infinity를 넘긴다). 그래도 조건에
              // «명시»해 둔다 — 하한선이 인출을 막는 것은 이제 2단계 전용 사실이고, 그
              // 의도가 코드에 남아 있어야 나중에 Infinity가 사라져도 뜻이 흐려지지 않는다.
              !fundingHardFloor
              && Number.isFinite(protectedHeadroom)
              && withdrawal.grossWithdrawal + 1 >= protectedHeadroom
            ) {
              // 여유를 다 쓰고 멈췄다. WithdrawalEngine은 headroom이 마르면 «루프를 끊으므로»
              // 뒤에 남은 계좌는 닿아 보지도 못했다. 그 계좌들의 캡을 사유로 적으면 이 인출을
              // 막은 적 없는 원인을 지어내는 것이고, 진짜 원인인 하한선이 가려진다.
              recordBlockedWithdrawal(fundingHardFloor, 'assetFloor');
            } else if (
              // 여유가 아니라 «가용액»이 말랐다 — 엔진이 적격 계좌를 끝까지 돌고도 모자랐다.
              // 그렇다면 닿지 못한 돈은 정확히 계층 밖(법정) 캡 뒤에 있는 돈이고 그 캡이 원인이다.
              !canWithdrawPrivatePension(currentAge)
              && activePensions.some((p) => p.currentBalance > 0)
            ) {
              recordBlockedWithdrawal(fundingHardFloor, 'legalAge');
            } else if (
              activeIsas.some((i) => isIsaPrincipalExhausted(i.currentBalance, i.totalInvested))
            ) {
              recordBlockedWithdrawal(fundingHardFloor, 'isaPrincipalExhausted');
            }
          }
          // 하한선을 «실제로» 넘겨 꺼냈을 때만 깬 것으로 센다. 1단계라도 여유 안에서 끝난
          // 달은 아무것도 깨지 않았다 — 계층은 「필요할 때만」 아래를 깬다. 원 미만 초과는
          // 세후 필요액 역산의 잔돈이라 뺀다. floorHeadroom이 Infinity면(하한선이 없으면)
          // 이 조건은 언제나 거짓이다 — 깰 것이 없다.
          if (fundingHardFloor && withdrawal.grossWithdrawal > floorHeadroom + 1) {
            brokenPreferences.add('assetFloor');
          }
          annualWithdrawal += withdrawal.grossWithdrawal;
          for (const item of withdrawal.withdrawalsByAccount) {
            if (item.accountType === 'GENERAL') annualGeneralAssetWithdrawal += item.gross;
            else if (item.accountType === 'ISA') annualIsaWithdrawal += item.gross;
            else if (
              item.accountType === 'PENSION_SAVINGS'
              || item.accountType === 'IRP'
              || item.accountType === 'PRIVATE_PENSION'
            ) {
              annualPrivatePensionWithdrawal += item.gross;
            }
          }
          return withdrawal.netWithdrawal;
        };

        // 1단계 — HARD 생활비 바닥 충당(계층 1). 소득은 바닥에도 그대로 쓰이므로,
        // «인출»로 메워야 하는 몫은 바닥에서 이미 들어온 소득을 뺀 만큼이다.
        //   바닥 부족분 = max(0, 바닥 - 소득)
        //             = max(0, (목표 - 소득) - (목표 - 바닥))
        //             = max(0, fundingGap - max(0, 목표 - 바닥))
        // 소득이 이미 바닥을 넘긴 달에는 0이 되어 1단계가 아예 돌지 않는다 — 필요도 없는데
        // 선호를 깨지 않기 위해서다. 바닥이 목표를 넘는 해에는 fundingGap 전체가 되어,
        // 계획이 겨냥한 금액 이상을 새로 만들어 쓰지는 않는다.
        const hardFloorNetNeed = monthlyHardSpendingFloorDisplay > 0
          ? Math.max(0, funding.fundingGap
            - Math.max(0, targetMonthlyCashNeed - monthlyHardSpendingFloorDisplay))
          : 0;
        const hardFloorNetWithdrawn = withdrawForPhase(true, hardFloorNetNeed);
        // 2단계 — 목표 생활비까지 추가 충당(계층 3). 전략 선호와 세제 최적화를 지킨다.
        // 여기서 못 채운 몫은 미충족으로 기록될 뿐 추가 인출을 강제하지 않는다.
        const targetNetWithdrawn = withdrawForPhase(
          false, funding.fundingGap - hardFloorNetWithdrawn
        );
        const completedCashFlow = completeCashFlow(
          funding, hardFloorNetWithdrawn + targetNetWithdrawn
        );
        annualSpending += completedCashFlow.actualSpending;
        annualUnmetSpending += completedCashFlow.shortfall;
        // HARD 바닥 미달(계층 1 실패). 바닥을 그 달의 필요액으로 자르는 것은 1단계가
        // 겨냥한 금액과 «같은» 것을 재기 위해서다 — 1단계는 계획이 겨냥하지 않은 금액을
        // 새로 만들어 쓰지 않으므로(hardFloorNetNeed 주석), 그보다 위쪽의 미달은 인출이
        // 실패한 것이 아니라 계획이 바닥보다 낮게 겨냥한 것이다. 그 «계획» 실패는 목표
        // 생활비와 바닥을 직접 비교해야 보이고, 그것은 평가 계층의 일이다.
        // 미달액은 목표 생활비 쪽(completedCashFlow.shortfall)과 «같은 자»로 잰다 — 원 단위다.
        // 같은 뺄셈에서 같은 1e-9원 잔돈이 나오고, 여기서는 그것이 진단(unmetHardSpending)과
        // 「사유 없는 부족」 불변식으로 흘러간다.
        annualUnmetHardSpending += roundToWon(Math.max(
          0,
          Math.min(monthlyHardSpendingFloorDisplay, targetMonthlyCashNeed)
            - completedCashFlow.actualSpending
        ));
      }

      // 연말 세금 징수 «직전»의 총자산. 아래 collectTax들은 인출 엔진을 거치지 않고 자산을
      // 직접 팔므로 상속 하한선을 지키지 않는다 — 그리고 그것이 옳다(계층 밖). 여기서 재는
      // 이유는 그 침범이 조용히 일어나지 않게 하기 위해서다. 이 시점부터 아래 총자산 확정까지
      // 잔액을 건드리는 것은 collectTax뿐이므로, 줄어든 만큼은 전부 세금이다.
      const assetsBeforeYearEndTaxDisplay = currentTotalAssetsDisplay(
        deferredWithdrawalCapitalGainsTaxReserveDisplay
          + annualWithdrawalCapitalGainsTaxReserveDisplay
      );

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

      // 해외주식 양도소득세. 생활비 매도 차익과 세금 납부 등을 위한 매도 차익을 합산한 뒤
      // 연간 기본공제를 한 번만 적용한다. 생활비 gross-up 유보액은 그 총세액의 선확보분이며,
      // 나머지만 다음 해 자산에서 추가 징수한다.
      // 작년 생활비 매도에서 따로 보관한 세금을 실제 납부한다. 해당 현금은 이미 gross 매도대금
      // 안에 있었으므로 다른 자산을 다시 팔지 않는다.
      let annualCapitalGainsTaxPaidDisplay = deferredWithdrawalCapitalGainsTaxReserveDisplay;
      deferredWithdrawalCapitalGainsTaxReserveDisplay = 0;
      {
        const isLastYear = y === totalYears - 1;
        if (deferredUnreservedCapitalGainsTaxDisplay > 0) {
          annualCapitalGainsTaxPaidDisplay += this.collectTax(
            deferredUnreservedCapitalGainsTaxDisplay,
            withdrawalOrderedAssets,
            activePensions,
            displayCurrency,
            exchangeRate,
            (gainKRW) => { annualRealizedCapitalGainKRW += gainKRW; }
          );
          deferredUnreservedCapitalGainsTaxDisplay = 0;
        }

        const totalAnnualCapitalGainsTaxDisplay = () => this.convertValue(
          calculateCapitalGainsTaxKRW(
            annualWithdrawalRealizedCapitalGainKRW + annualRealizedCapitalGainKRW,
            taxCtx
          ),
          'KRW',
          displayCurrency,
          exchangeRate
        );

        if (isLastYear) {
          // 기대수명 마지막 해에는 이월할 다음 해가 없다. 추가 세금을 내기 위한 매도도 차익을
          // 만들 수 있으므로 총세액과 실제 확보액의 차이가 없어질 때까지 짧게 고정점을 푼다.
          let currentYearAdditionalTaxPaidDisplay = 0;
          for (let i = 0; i < 16; i++) {
            const additionalTaxDueDisplay = Math.max(
              0,
              totalAnnualCapitalGainsTaxDisplay()
                - annualWithdrawalCapitalGainsTaxReserveDisplay
                - currentYearAdditionalTaxPaidDisplay
            );
            if (additionalTaxDueDisplay <= 0.01) break;

            const collectedDisplay = this.collectTax(
              additionalTaxDueDisplay,
              withdrawalOrderedAssets,
              activePensions,
              displayCurrency,
              exchangeRate,
              (gainKRW) => { annualRealizedCapitalGainKRW += gainKRW; }
            );
            currentYearAdditionalTaxPaidDisplay += collectedDisplay;
            if (collectedDisplay + 0.01 < additionalTaxDueDisplay) break;
          }
          annualCapitalGainsTaxPaidDisplay += annualWithdrawalCapitalGainsTaxReserveDisplay;
          annualCapitalGainsTaxPaidDisplay += currentYearAdditionalTaxPaidDisplay;
        } else {
          deferredWithdrawalCapitalGainsTaxReserveDisplay = annualWithdrawalCapitalGainsTaxReserveDisplay;
          deferredUnreservedCapitalGainsTaxDisplay = Math.max(
            0,
            totalAnnualCapitalGainsTaxDisplay()
              - annualWithdrawalCapitalGainsTaxReserveDisplay
          );
        }
      }

      const stockAssetsDisplay = activeAssets.reduce((sum, a) => sum + this.convertValue(a.currentValue, a.currency, displayCurrency, exchangeRate), 0);
      const pensionAssetsDisplay = activePensions.reduce((sum, p) => sum + this.convertValue(p.currentBalance, p.currency, displayCurrency, exchangeRate), 0);
      const isaAssetsDisplay = activeIsas.reduce((sum, i) => sum + this.convertValue(i.currentBalance, i.currency, displayCurrency, exchangeRate), 0);
      const reservedTaxCashDisplay = deferredWithdrawalCapitalGainsTaxReserveDisplay;
      const cashAssetsDisplay = cashBucketDisplay + reservedTaxCashDisplay;
      const totalAssetsDisplay = stockAssetsDisplay + pensionAssetsDisplay + isaAssetsDisplay + cashAssetsDisplay;

      // 납세로 하한선이 깨졌다면 «기록»한다. 고치지 않는다 — 세금을 하한선 앞에서 멈추게
      // 만들면 국가가 돈을 안 받는 세계를 시뮬레이션하게 된다. 조건은 「세금이 실제로 자산을
      // 줄였고(원 단위 잔돈은 제외), 그 결과가 하한선 아래」다. 이미 하한선 아래였던 해에도
      // 세금이 더 팔았다면 그 돈은 하한선 «아래»에서 나온 것이므로 침범으로 센다.
      if (
        assetFloorDisplay > 0
        && totalAssetsDisplay < assetFloorDisplay
        && totalAssetsDisplay + 1 < assetsBeforeYearEndTaxDisplay
      ) {
        assetFloorBreachedBy = 'taxObligation';
      }

      const hasTaxWarning = annualRawFinancialIncomeKRW > taxCtx.profile.financialIncomeThresholdKRW;
      const pensionIncome = annualNationalPensionIncome + annualPrivatePensionIncome;
      const totalIncome = annualDividendIncome + pensionIncome + annualOtherIncome;
      const taxes = annualDividendTaxPaid
        + annualPensionTaxPaid
        + annualNationalPensionTaxPaid
        + annualIsaTaxPaid
        + annualComprehensiveTaxPaidDisplay
        + annualHealthInsurancePaidDisplay
        + annualCapitalGainsTaxPaidDisplay;

      // 남은 잔액 중 인출 엔진이 «닿을 수 있는» 금액. 연말 세금 징수까지 끝난 뒤에 재므로
      // 그 해 어느 시점보다도 작다 — 불변식이 과하게 울지 않는 쪽으로 안전하다.
      const withdrawableAtFloorPhase = withdrawableNowDisplay(currentAge, true);

      // 한 해에 하나만 표시하므로 «앞선·더 구체적인» 관찰이 남는다. 1단계는 계층 1(HARD
      // 생활비 바닥)을 막은 사실이라 2단계(목표 생활비)보다 먼저 일어나고 더 좁게 말한다.
      // 1단계가 아무것도 보지 못한 해에만 2단계 사유가 올라온다 — 바닥이 없는 계획은
      // 1단계가 아예 돌지 않으므로(hardFloorNetNeed = 0) 예전과 같은 값이 나온다.
      const blockedWithdrawalReason = blockedWithdrawalReasonByPhase.hardFloor
        ?? blockedWithdrawalReasonByPhase.target;

      const diagnostics: YearLedgerDiagnostics = {
        brokenPreferences: [...brokenPreferences],
        // 선호를 깬 «유일한» 사유가 HARD 생활비 바닥이다. 깬 것이 없으면 사유도 없다.
        ...(brokenPreferences.size > 0 ? { overrideReason: 'hardSpendingFloor' as const } : {}),
        unmetHardSpending: annualUnmetHardSpending,
        unmetTargetSpending: annualUnmetSpending,
        ...(blockedWithdrawalReason !== undefined ? { blockedWithdrawalReason } : {}),
        ...(assetFloorBreachedBy !== undefined ? { assetFloorBreachedBy } : {}),
      };

      // 한 해의 회계 원장. 결과에 실린 스칼라들이 하나의 항등식으로 설명되는지를 여기서
      // 매년 확인한다 — 설명되지 않으면 던진다(assertLedgerConsistent 주석).
      const ledger = buildYearLedger({
        age: currentAge,
        beginningAssets: openingAssets,
        endingAssets: totalAssetsDisplay,
        priceGain: annualInvestmentReturn,
        grossDividend: annualGrossDividendDisplay,
        dividendPaidOutNet: annualDividendIncome,
        dividendRetainedNet: annualDividendRetainedNetDisplay,
        nationalPensionPreTax: annualNationalPensionPreTaxDisplay,
        otherIncome: annualOtherPreTaxDisplay,
        contributions: annualContributionsDisplay,
        privatePensionWithdrawal: annualPrivatePensionWithdrawal,
        taxableAccountWithdrawal: annualGeneralAssetWithdrawal,
        isaWithdrawal: annualIsaWithdrawal,
        living: annualSpending,
        // 건보료는 원장에서 따로 세므로 여기서 뺀다. taxes 자체는 화면 계약이라 그대로 둔다.
        tax: taxes - annualHealthInsurancePaidDisplay,
        healthInsurance: annualHealthInsurancePaidDisplay,
        diagnostics,
      });
      assertLedgerConsistent(ledger);
      // 설명되지 않는 생활비 부족은 항등식 위반과 같은 급의 결함이다 — 같은 자리에서 던진다.
      assertSpendingShortfallExplained(ledger, withdrawableAtFloorPhase);

      yearlyResults.push({
        age: currentAge, year: currentYear, totalAssets: totalAssetsDisplay,
        employmentIncome: 0,
        stockAssets: stockAssetsDisplay, pensionAssets: pensionAssetsDisplay,
        isaAssets: isaAssetsDisplay,
        cashAssets: cashAssetsDisplay,
        dividendIncome: annualDividendIncome, nationalPensionIncome: annualNationalPensionIncome,
        privatePensionIncome: annualPrivatePensionIncome, pensionIncome, otherIncome: annualOtherIncome,
        totalIncome,
        targetSpending: annualTargetSpending,
        actualSpending: annualSpending,
        shortfall: annualUnmetSpending,
        generalAssetWithdrawal: annualGeneralAssetWithdrawal,
        isaWithdrawal: annualIsaWithdrawal,
        privatePensionWithdrawal: annualPrivatePensionWithdrawal,
        withdrawal: annualWithdrawal,
        taxes,
        openingAssets,
        investmentReturn: annualInvestmentReturn,
        closingAssets: totalAssetsDisplay,
        spending: annualSpending, unmetSpending: annualUnmetSpending,
        healthcareSpending: annualHealthcareCost,
        hasTaxWarning,
        ledger,
        preTaxTotalIncome: annualPreTaxTotalIncome,
        dividendTaxPaid: annualDividendTaxPaid, pensionTaxPaid: annualPensionTaxPaid,
        nationalPensionTaxPaid: annualNationalPensionTaxPaid, comprehensiveTaxPaid: annualComprehensiveTaxPaidDisplay,
        healthInsurancePaid: annualHealthInsurancePaidDisplay,
        healthInsuranceIncomeBasis: this.convertValue(healthInsuranceIncomeBasisKRW, 'KRW', displayCurrency, exchangeRate),
        capitalGainsTaxPaid: annualCapitalGainsTaxPaidDisplay,
        privatePensionTaxMethod,
      });

      if (totalAssetsDisplay <= 0 && depletionAge === null) depletionAge = currentAge;
    }

    const endingAssets = yearlyResults.length > 0 ? yearlyResults[yearlyResults.length - 1].totalAssets : 0;

    return {
      yearlyResults,
      depletionAge,
      endingAssets,
    };
  }
}

/** @deprecated Use LegacySimulationEngine through the SimulationEngine interface. */
export class SimulationEngine extends LegacySimulationEngine {}
