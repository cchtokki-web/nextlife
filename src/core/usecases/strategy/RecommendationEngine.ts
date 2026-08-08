import {
  BaselineWithdrawalPlan,
  ItemizedContribution,
  SimulationParams,
  SimulationResult,
  StrategyRecommendation,
  UtilityBreakdown,
  UtilityConfig,
  UtilityRaws,
  WithdrawalPlan,
} from '../../entities/types';
import { SimulationEngine } from '../SimulationEngine';
import { computeLifetimeUtility, computeUtilityRaws, scoreUtilityRaws } from '../utility/UtilityEngine';
import { DEFAULT_UTILITY_CONFIG } from '../utility/utilityWeights';
import { analyzeCurrentStrategy, formatManwon } from '../utility/utilityAnalysis';
import { getRetirementGrade } from '../../entities/retirementGrade';
import { generateCandidatePlans, generateSpendingAdjustmentCandidates, getIdentityPlan, paramsWithBaselinePlan } from './StrategyCandidateGenerator';
import { optimizeDividendReinvestment } from './DividendReinvestmentOptimizer';
import { optimizePrivatePensionChanneling } from './PrivatePensionChannelingOptimizer';
import { computeDeltas } from './deltas';
import { buildVerifiedSentinelPlan } from './verifiedSentinelPlan';
import { resolveStrategy } from './compileStrategy';
import {
  isObjectivePresetConfig, pickLowestRegret, pickMostRobust, resolveAssumptionVariants,
} from './robustness';

// 검증된 축이 하나도 없을 때 돌려주는 공유 상수. 매번 새 배열을 만들면 소비처(화면)의
// 메모이제이션이 흔한 경로에서 계속 깨진다.
const NO_VERIFIED_SENTINEL_STEPS: StrategyRecommendation['verifiedSentinelPlan'] = Object.freeze([]);

// 하위 호환: 기존에 computeDeltas를 이 모듈에서 import하던 코드(테스트 등)를 위해 재노출한다.
export { computeDeltas } from './deltas';

// AssetSellOrderStrategy/IsaMaturityDestination에 새 variant가 추가됐는데 아래 switch를
// 갱신하지 않으면 여기서 컴파일 에러가 나서 누락을 막아준다(조용히 무시되는 대신).
function assertNever(x: never): never {
  throw new Error(`Unhandled variant: ${x}`);
}

// 생활비 배수 변경을 "얼마에서 얼마로, 얼마만큼 늘/줄었는지"로 옮긴다.
//
// 방향을 하드코딩하면 안 된다. 배수는 1보다 클 수도(잔여자산 과다 해소) 작을 수도(자산이
// 부족해 목표를 낮춰야 하는 계획) 있는데, 예전에는 '증액'과 '늘리다'가 문장에 박혀 있어
// "350만원 → 280만원(약 -70만원 증액)로 늘립니다"라는 뒤집힌 문장이 화면에 나왔다.
// buildReasons와 labelForSingleFieldChange 두 곳이 같은 규칙을 쓰므로 여기 한 곳에 둔다.
function describeSpendingChange(before: number, after: number): { phrase: string; increases: boolean } {
  const increases = after > before;
  return {
    increases,
    phrase:
      `월 약 ${formatManwon(before)} → ${formatManwon(after)}` +
      `(약 ${formatManwon(Math.abs(after - before))} ${increases ? '증액' : '감액'})`,
  };
}

// buildReasons의 5번째 인자. 없으면(하위 호환) 기존 동작(정형 문구 2종)만 사용한다.
export interface BuildReasonsContext {
  currentUtility: UtilityBreakdown;
  recommendedUtility: UtilityBreakdown;
  cfg?: UtilityConfig;
  originalMonthlyTarget?: number;
  // "미지정 시 동일하게 동작하는" 기본값 plan. 필드별 문구는 이 값과 다를 때만 생성한다 —
  // 그렇지 않으면 phase 2(생활비 배수)가 만드는 identity 기반 plan(getIdentityPlan)이나,
  // 우연히 기본값과 같은 phase 1 후보가 실제로는 아무것도 바뀌지 않은 필드까지 문구로
  // 노출시킨다(예: 사적연금 계좌가 아예 없는데도 privatePensionMonthlyTarget=0이 "결정"처럼 보고됨).
  identityPlan?: BaselineWithdrawalPlan;
}

export function buildReasons(
  plan: WithdrawalPlan | null,
  deltas: StrategyRecommendation['deltas'],
  improved: boolean,
  candidateStats?: { total: number; failed: number },
  context?: BuildReasonsContext
): string[] {
  if (!improved || !plan) {
    if (candidateStats && candidateStats.total > 0 && candidateStats.failed === candidateStats.total) {
      return ['전략 후보를 평가하는 중 모두 오류가 발생해 추천을 계산하지 못했습니다. 현재 전략이 유지됩니다.'];
    }
    // 점수가 낮은데도(주의/위험 등급) 개선 후보를 못 찾았다면, "이미 충분히 합리적"이라는 단정적
    // 문구 대신 왜 개선안을 못 찾았는지와 baseline의 약점을 함께 보여주는 것이 더 정직하다.
    if (context) {
      const grade = getRetirementGrade(context.currentUtility.score);
      if (grade === '주의' || grade === '위험') {
        const { weaknesses } = analyzeCurrentStrategy(context.currentUtility, context.cfg ?? DEFAULT_UTILITY_CONFIG);
        return [
          `평생 효용 점수가 ${context.currentUtility.score}점('${grade}' 등급)으로 개선 여지가 있으나, ` +
            `탐색한 인출 시점·순서·생활비 조합(${candidateStats?.total ?? 0}개) 범위 내에서는 이보다 더 나은 조합을 찾지 못했습니다.`,
          ...weaknesses.map((w) => `- ${w}`),
        ];
      }
    }
    return ['현재 전략이 이미 평생 효용 관점에서 충분히 합리적이어서 별도로 추천할 변경 사항이 없습니다.'];
  }

  const reasons: string[] = [];

  if (
    plan.monthlySpendingMultiplier !== undefined &&
    plan.monthlySpendingMultiplier !== 1 &&
    context?.originalMonthlyTarget
  ) {
    const before = context.originalMonthlyTarget;
    const after = Math.round(before * plan.monthlySpendingMultiplier);
    const { phrase, increases } = describeSpendingChange(before, after);
    reasons.push(
      `목표 생활비를 ${phrase}로 ${increases ? '늘리면' : '줄이면'} ` +
        `평생 효용이 ${context.currentUtility.score}점 → ${context.recommendedUtility.score}점으로 개선됩니다.`
    );
  }

  if (
    plan.privatePensionMonthlyTarget !== undefined &&
    plan.privatePensionMonthlyTarget !== context?.identityPlan?.privatePensionMonthlyTarget
  ) {
    reasons.push(`사적연금의 월 정액 인출 상한을 약 ${formatManwon(plan.privatePensionMonthlyTarget)}으로 설정합니다. 실제 인출액은 해당 연도의 생활비 부족분을 넘지 않습니다.`);
  }
  switch (plan.assetSellOrderStrategy) {
    case 'low_dividend_first':
      reasons.push('배당수익률이 낮은 자산부터 매도해 배당 소득원을 오래 유지합니다.');
      break;
    case 'high_dividend_first':
      reasons.push('자산 매도 순서를 배당수익률이 높은 자산 우선으로 조정합니다. 현재 금융소득종합과세 위험이 낮다면 세금 회피를 위한 즉시 매도는 필요하지 않습니다.');
      break;
    case 'input_order':
    case undefined:
      break;
    default:
      assertNever(plan.assetSellOrderStrategy);
  }
  switch (plan.isaMaturityDestination) {
    case 'asset':
      reasons.push('ISA 만기 자금을 사적연금 대신 일반 자산으로 이동해 향후 인출 시 세금 부담을 낮춥니다.');
      break;
    case 'pension':
    case undefined:
      break;
    default:
      assertNever(plan.isaMaturityDestination);
  }
  if (
    plan.generalAssetWithdrawalStartAge !== undefined &&
    plan.generalAssetWithdrawalStartAge !== context?.identityPlan?.generalAssetWithdrawalStartAge
  ) {
    reasons.push(`${plan.generalAssetWithdrawalStartAge}세부터 일반 자산(주식/ETF) 인출을 시작합니다.`);
  }
  const nationalPensionDefaultAge = context?.identityPlan?.nationalPensionStartAge ?? 65;
  if (plan.nationalPensionStartAge !== undefined && plan.nationalPensionStartAge !== nationalPensionDefaultAge) {
    const totalChangeText = `평생 총 수령액 약 ${formatManwon(Math.abs(deltas.nationalPensionTotal))} ${deltas.nationalPensionTotal < 0 ? '감소' : '증가'}`;
    if (plan.nationalPensionStartAge < nationalPensionDefaultAge) {
      reasons.push(`국민연금을 ${plan.nationalPensionStartAge}세부터 조기 수령합니다 (${totalChangeText}).`);
    } else {
      reasons.push(`국민연금을 ${plan.nationalPensionStartAge}세까지 연기 수령해 수령액을 늘립니다 (${totalChangeText}).`);
    }
  }
  if (deltas.lifetimeConsumption > 0) {
    reasons.push(`평생 소비 가능 금액이 약 ${formatManwon(deltas.lifetimeConsumption)} 증가합니다.`);
  }
  if (deltas.pensionEndingBalance < 0) {
    reasons.push(`사망 시 연금잔액이 약 ${formatManwon(-deltas.pensionEndingBalance)} 감소해 연금을 더 효율적으로 활용합니다.`);
  } else if (deltas.pensionEndingBalance > 0) {
    reasons.push(`사망 시 연금잔액이 약 ${formatManwon(deltas.pensionEndingBalance)} 증가합니다.`);
  }
  if (deltas.comprehensiveTaxYears <= 0) {
    reasons.push('금융소득종합과세 영향이 늘지 않습니다.');
  } else {
    reasons.push(`금융소득종합과세 발생 연수가 ${deltas.comprehensiveTaxYears}년 증가하지만 전체 Utility는 개선됩니다.`);
  }
  if (deltas.healthInsuranceTotal <= 0) {
    reasons.push('건강보험료 부담이 늘지 않습니다.');
  }
  if (deltas.totalTax <= 0) {
    reasons.push(`평생 총 세금이 약 ${formatManwon(-deltas.totalTax)} 절감됩니다.`);
  } else {
    reasons.push(`평생 총 세금은 약 ${formatManwon(deltas.totalTax)} 증가하지만, 소비·연금 활용 개선 효과가 더 큽니다.`);
  }

  return reasons;
}

// plan.monthlySpendingMultiplier(1이 아닌 값)를 실제 시뮬레이션/Utility 평가에 반영하려면
// userProfile.targetMonthlySpending 자체를 스케일링한 params가 필요하다. multiplier===1이면
// (기존 5차원 후보 전부 해당) params를 그대로 반환해 기존 동작을 전혀 바꾸지 않는다.
function paramsForCandidate(params: SimulationParams, plan: BaselineWithdrawalPlan): SimulationParams {
  // paramsWithBaselinePlan이 privatePensionMonthlyTarget 미지정 시 키 자체를 지운다 —
  // undefined 값을 가진 키를 남기면 엔진 동작은 같아도 구조 비교·직렬화에서 차이가 생긴다.
  const withPlan = paramsWithBaselinePlan(params, plan);

  const multiplier = plan.monthlySpendingMultiplier ?? 1;
  if (multiplier === 1) return withPlan;

  return {
    ...withPlan,
    userProfile: {
      ...withPlan.userProfile,
      targetMonthlySpending: Math.round(withPlan.userProfile.targetMonthlySpending * multiplier),
    },
  };
}

const PLAN_FIELDS: Array<keyof BaselineWithdrawalPlan> = [
  'privatePensionMonthlyTarget',
  'nationalPensionStartAge',
  'assetSellOrderStrategy',
  'isaMaturityDestination',
  'generalAssetWithdrawalStartAge',
  'monthlySpendingMultiplier',
];

// computeItemizedContributions 전용 문구 생성. buildReasons와 문장 목적이 달라(전역 최적화 결과
// 설명 vs 단일 필드의 독립 효과 설명) 의도적으로 분리했다 — 특히 nationalPensionStartAge/
// monthlySpendingMultiplier는 buildReasons가 여러 필드가 함께 바뀐 상태의 deltas를 문구에
// 병기하는 반면, 여기서는 그 필드 하나만 바꿨을 때의 deltas(itemDeltas)를 병기한다.
function labelForSingleFieldChange(
  field: keyof BaselineWithdrawalPlan,
  recommendedPlan: BaselineWithdrawalPlan,
  identityPlan: BaselineWithdrawalPlan,
  itemDeltas: StrategyRecommendation['deltas'],
  originalMonthlyTarget: number
): string {
  switch (field) {
    case 'privatePensionMonthlyTarget':
      // 이 필드가 없으면 "잔여 개월 균등분할"(엔진 기본값)이라는 뜻이다. 추천이 정액 인출을
      // 제안했을 때만 이 라벨이 만들어지므로 값이 있는 것이 정상이지만, 반대 방향(정액 인출을
      // 쓰던 사용자에게 균등분할을 제안)도 타입상 가능하다.
      return recommendedPlan.privatePensionMonthlyTarget === undefined
        ? '사적연금을 정액 인출 대신 남은 기간에 걸쳐 균등하게 인출합니다.'
        : `사적연금의 월 정액 인출 상한을 약 ${formatManwon(recommendedPlan.privatePensionMonthlyTarget)}으로 설정합니다. 실제 인출액은 생활비 부족분을 넘지 않습니다.`;
    case 'generalAssetWithdrawalStartAge':
      return `${recommendedPlan.generalAssetWithdrawalStartAge}세부터 일반 자산(주식/ETF) 인출을 시작합니다.`;
    case 'assetSellOrderStrategy':
      if (recommendedPlan.assetSellOrderStrategy === 'low_dividend_first') {
        return '배당수익률이 낮은 자산부터 매도해 배당 소득원을 오래 유지합니다.';
      }
      if (recommendedPlan.assetSellOrderStrategy === 'high_dividend_first') {
        return '자산 매도 순서를 고배당 자산 우선으로 조정합니다. 금융소득종합과세 위험이 낮다면 즉시 매도할 필요는 없습니다.';
      }
      return '자산 매도 순서를 조정합니다.';
    case 'isaMaturityDestination':
      return recommendedPlan.isaMaturityDestination === 'asset'
        ? 'ISA 만기 자금을 사적연금 대신 일반 자산으로 이동합니다.'
        : 'ISA 만기 자금을 연금 계좌로 이동합니다.';
    case 'nationalPensionStartAge': {
      const totalChangeText =
        `평생 총 수령액 약 ${formatManwon(Math.abs(itemDeltas.nationalPensionTotal))} ` +
        `${itemDeltas.nationalPensionTotal < 0 ? '감소' : '증가'}`;
      return recommendedPlan.nationalPensionStartAge < identityPlan.nationalPensionStartAge
        ? `국민연금을 ${recommendedPlan.nationalPensionStartAge}세부터 조기 수령합니다 (${totalChangeText}).`
        : `국민연금을 ${recommendedPlan.nationalPensionStartAge}세까지 연기 수령합니다 (${totalChangeText}).`;
    }
    case 'monthlySpendingMultiplier': {
      const before = originalMonthlyTarget;
      const after = Math.round(before * recommendedPlan.monthlySpendingMultiplier);
      const { phrase, increases } = describeSpendingChange(before, after);
      return `목표 생활비를 ${phrase}로 ${increases ? '늘립니다' : '줄입니다'}.`;
    }
    default:
      return assertNever(field);
  }
}

// recommendedPlan이 identityPlan 대비 실제로 바뀐 필드 각각에 대해, "그 필드 하나만 baseline에
// 적용했을 때"의 독립적인(marginal) Utility/절세/자산 효과를 계산한다. 바뀐 필드가 N개면 N번의
// 추가 시뮬레이션이 발생한다(N은 보통 1~6) — 기존 최대 218개 후보 평가 대비 무시할 수준이다.
// 필드 간 상호작용은 반영하지 않으므로, 반환값의 utilityDelta 합계는 recommendStrategy가 최종
// 반환하는 전체 개선폭(recommendedUtility.score - currentUtility.score)과 정확히 일치하지 않을 수 있다.
export function computeItemizedContributions(
  params: SimulationParams,
  identityPlan: BaselineWithdrawalPlan,
  recommendedPlan: BaselineWithdrawalPlan,
  currentUtility: UtilityBreakdown,
  baselineResult: SimulationResult,
  engine: SimulationEngine,
  cfg: UtilityConfig
): ItemizedContribution[] {
  const changedFields = PLAN_FIELDS.filter((field) => recommendedPlan[field] !== identityPlan[field]);

  const contributions: ItemizedContribution[] = [];
  for (const field of changedFields) {
    try {
      const overridePlan: BaselineWithdrawalPlan = { ...identityPlan, [field]: recommendedPlan[field] };
      const overrideParams = paramsForCandidate(params, overridePlan);
      const singleFieldResult = engine.runForUtility(overrideParams);
      const singleFieldUtility = computeLifetimeUtility(singleFieldResult, overrideParams, cfg);
      const itemDeltas = computeDeltas(baselineResult, singleFieldResult);
      const utilityDelta = singleFieldUtility.score - currentUtility.score;

      // 적용해도 **아무것도** 바뀌지 않는 항목은 할 일이 아니라 소음이다. 실제로 사적연금
      // 계좌가 없는 사용자 화면에 "사적연금을 정액 인출 대신 균등하게 인출합니다 (효용 +0점)"이
      // 떴다 — 그 필드는 계좌가 없으면 어떤 값이어도 결과가 같다.
      //
      // 판정에 **deltas 전부가 0**까지 포함하는 것이 중요하다. utilityDelta만 0이고 절세·자산
      // 효과가 있는 항목은 정상이며(만점·바닥에 가까운 축), 화면 각주가 이미 그 경우를
      // 설명하고 있다. 그것까지 걸러내면 실제 효과가 있는 제안을 숨기게 된다.
      if (utilityDelta === 0 && Object.values(itemDeltas).every((v) => v === 0)) continue;

      contributions.push({
        field,
        label: labelForSingleFieldChange(
          field,
          recommendedPlan,
          identityPlan,
          itemDeltas,
          params.userProfile.targetMonthlySpending
        ),
        utilityDelta,
        deltas: itemDeltas,
      });
    } catch (err) {
      console.warn('Skipping itemized contribution that failed to simulate', field, err);
    }
  }
  return contributions;
}

interface CandidateSearchState {
  bestResult: SimulationResult;
  bestUtility: UtilityBreakdown;
  bestPlan: BaselineWithdrawalPlan | null;
  failedCandidateCount: number;
  // 강건성 모드 재평가 대상. 점수 상위 몇 개만 남긴다 — 재평가는 후보 하나당 국면 수만큼
  // 시뮬레이션을 돌리므로 전수로 하면 비용이 곱해진다.
  topCandidates: ScoredCandidate[];
}

// 강건성 재평가에 필요한 최소 정보. raws를 함께 보관하는 이유는 목표 우선순위 후회 계산이
// **재시뮬레이션 없이** 5개 목표 전부를 채점할 수 있기 때문이다(UtilityEngine.computeUtilityRaws).
interface ScoredCandidate {
  // null이면 baseline(사용자의 현재 계획). 강건성 판정에서도 후보의 하나로 남아야
  // "모든 개선안이 특정 국면에서 무너지면 현행 유지"가 표현된다.
  plan: BaselineWithdrawalPlan | null;
  result: SimulationResult;
  utility: UtilityBreakdown;
  raws: UtilityRaws;
}

// 상위 후보 보관 개수. 국면 수(최대 7)와 곱해지므로 작게 유지한다 — 5면 최대 35회다.
const ROBUSTNESS_TOP_K = 5;

function rememberCandidate(state: CandidateSearchState, candidate: ScoredCandidate): void {
  state.topCandidates.push(candidate);
  state.topCandidates.sort((a, b) => b.utility.score - a.utility.score);
  if (state.topCandidates.length > ROBUSTNESS_TOP_K) state.topCandidates.length = ROBUSTNESS_TOP_K;
}

// 후보 하나를 시뮬레이션 + Utility 평가하고, baseline(또는 지금까지의 최선) 대비 더 나으면
// state를 갱신한다. 특정 조합(예: 극단적인 나이 조합)이 SimulationEngine을 깨뜨리더라도 다른
// 후보 탐색까지 통째로 실패하지 않도록 후보 단위로 격리한다. 실패한 후보는 건너뛰고 로그만 남긴다.
function evaluateCandidate(
  plan: BaselineWithdrawalPlan,
  params: SimulationParams,
  engine: SimulationEngine,
  cfg: UtilityConfig,
  state: CandidateSearchState
): void {
  try {
    const candidateParams = paramsForCandidate(params, plan);
    const candidateResult = engine.runForUtility(candidateParams);

    // 상속 하한선을 못 지키는 후보는 점수와 무관하게 탈락시킨다. 하한선은 선호가 아니라
    // 제약이므로, 효용 점수로 다른 축과 맞바꿀 수 있는 대상이 아니다.
    //
    // 엔진이 인출 경로에서 이미 하한선을 지키지만 세금과 배당 소비까지 막을 수는 없어
    // 미세하게 밑돌 수 있다. 그 오차로 정상적인 후보가 전멸하지 않도록 여유(1%)를 둔다.
    const assetFloor = candidateParams.assetFloor ?? 0;
    if (assetFloor > 0 && candidateResult.endingAssets < assetFloor * 0.99) return;

    const raws = computeUtilityRaws(candidateResult, candidateParams, cfg);
    const candidateUtility = scoreUtilityRaws(raws, cfg.weights);
    rememberCandidate(state, { plan, result: candidateResult, utility: candidateUtility, raws });

    if (candidateUtility.score > state.bestUtility.score) {
      state.bestUtility = candidateUtility;
      state.bestResult = candidateResult;
      state.bestPlan = plan;
    }
  } catch (err) {
    state.failedCandidateCount++;
    console.warn('Skipping withdrawal plan candidate that failed to simulate', plan, err);
  }
}

// 강건성 모드. 사용자가 미정으로 둔 축에 대해 상위 후보를 다시 서열화하고, 이긴 후보를
// state의 최선으로 승격한다.
//
// 여기서 돌린 시뮬레이션은 totalCandidateCount에 더하지 않는다. 이미 평가한 후보를 다른
// 국면에서 다시 재는 것이지 새 후보가 아니고, 그 수는 AI advisor의 "후보를 전부 실패했다"
// 판정(failed === total)에 섞이면 안 된다.
//
// **사용자의 가정을 절대 덮어쓰지 않는다.** 국면 params는 평가에만 쓰고 버리며,
// state에 남는 result/utility는 언제나 사용자 가정으로 계산한 값이다 — 화면에 그려지는
// 곡선과 점수가 사용자가 입력한 미래 그대로여야 하기 때문이다.
function applyRobustness(
  state: CandidateSearchState,
  params: SimulationParams,
  engine: SimulationEngine,
  cfg: UtilityConfig
): void {
  // 후보가 baseline 하나뿐이면 서열화할 것이 없다.
  if (state.topCandidates.length <= 1) return;

  // (1) 가정 축 — 여러 국면에서 최악이 가장 나은 계획.
  const variants = resolveAssumptionVariants(params);
  if (variants.length > 0) {
    const winner = pickMostRobust(state.topCandidates, variants, (candidate, variant) => {
      const candidateParams = variant.apply(
        candidate.plan ? paramsForCandidate(params, candidate.plan) : params
      );
      try {
        return computeLifetimeUtility(engine.runForUtility(candidateParams), candidateParams, cfg).score;
      } catch (err) {
        console.warn('Skipping robustness variant that failed to simulate', variant.label, err);
        return null;
      }
    });
    if (winner) promoteCandidate(state, winner);
  }

  // (2) 목표 우선순위 — 정규화된 최대 후회의 최소화. 원점수를 이미 갖고 있으므로
  // 추가 시뮬레이션이 0회다.
  //
  // cfg가 목표 프리셋 표 위에 있지 않으면(사용자 정의 가중치) 후회 계산의 전제가 없다.
  if (resolveStrategy(params).objective === 'ai_recommended' && isObjectivePresetConfig(cfg)) {
    const winner = pickLowestRegret(state.topCandidates);
    if (winner) promoteCandidate(state, winner);
  }
}

// 강건성 판정이 고른 후보를 최선으로 승격한다. utility/result는 국면 평가값이 아니라
// **사용자 가정으로 계산한 원래 값**이다(applyRobustness 주석 참고).
function promoteCandidate(state: CandidateSearchState, winner: ScoredCandidate): void {
  state.bestPlan = winner.plan;
  state.bestResult = winner.result;
  state.bestUtility = winner.utility;
}

// 후보 전략 생성(StrategyCandidateGenerator) + Utility 평가(UtilityEngine)를 결합해
// 기존 로직(baseline) 대비 Lifetime Utility가 가장 높은 인출 전략을 찾는다.
// MC(Monte Carlo) 확장 시에는 이 함수 내부의 engine.runForUtility() 호출을 시나리오 평균으로
// 교체하는 방식으로 확장 가능하다.
export function recommendStrategy(
  params: SimulationParams,
  engine: SimulationEngine,
  cfg: UtilityConfig = DEFAULT_UTILITY_CONFIG
): StrategyRecommendation {
  // 후보 평가는 Utility 계산에만 쓰이므로 run()의 findMaxSustainableValue() 이진탐색(30회)이
  // 필요 없는 runForUtility()로 실행한다. run()을 그대로 썼다면 후보 1개당 runSingle이 최대
  // 31회 호출되는 낭비가 있었다.
  const baselineResult = engine.runForUtility(params);
  const baselineRaws = computeUtilityRaws(baselineResult, params, cfg);
  const currentUtility: UtilityBreakdown = scoreUtilityRaws(baselineRaws, cfg.weights);

  const state: CandidateSearchState = {
    bestResult: baselineResult,
    bestUtility: currentUtility,
    bestPlan: null,
    failedCandidateCount: 0,
    // baseline도 강건성 재평가의 후보다. 모든 개선안이 특정 국면에서 무너지면
    // "현행 유지"가 답이어야 하는데, 여기 없으면 그 답을 고를 수 없다.
    topCandidates: [{ plan: null, result: baselineResult, utility: currentUtility, raws: baselineRaws }],
  };

  // Phase 1: 인출 시점/순서/목적지 5차원 그리드 탐색 (기존 로직, 변경 없음)
  const candidates = generateCandidatePlans(params);
  for (const plan of candidates) {
    evaluateCandidate(plan, params, engine, cfg, state);
  }

  // Phase 2: 생활비 배수 조정 (신규). Phase 1이 찾은 최선(또는 없으면 identity plan) 위에
  // 배수만 얹은 소규모 후보를 추가 평가한다 — 그리드 곱셈이 아니라 고정 O(그리드 크기) 비용.
  // baseline이 이미 기대수명 전에 고갈되거나(depletion 위험), 목표 생활비 자체가 인출액을
  // 결정하지 않는 전략(dividend_only/max_sustainable)이거나, 목표 생활비가 0 이하이면 생활비를
  // 늘리는 후보를 생성하지 않는다.
  //
  // 고갈 판정 기준은 본인 기대수명이 아니라 시뮬레이션이 실제로 돈 마지막 나이
  // (baselineResult.householdEndAge)다. 본인 기대수명과 비교하면 장수 배우자가 있는 계획에서
  // 배우자 단독 생존 구간의 파산이 통째로 숨어, 파산하는 계획에 "생활비를 더 쓰라"고 권한다.
  const allowSpendingIncrease =
    (params.spendingStrategy ?? 'target') === 'target' &&
    (baselineResult.depletionAge === null || baselineResult.depletionAge >= baselineResult.householdEndAge);
  const identityPlan = getIdentityPlan(params);
  const spendingBasePlan = state.bestPlan ?? identityPlan;
  const spendingCandidates = generateSpendingAdjustmentCandidates(params, spendingBasePlan, {
    allowIncrease: allowSpendingIncrease,
  });
  for (const plan of spendingCandidates) {
    evaluateCandidate(plan, params, engine, cfg, state);
  }

  // Phase 2.5: 강건성 모드. 사용자가 미정으로 둔 가정 축(경제 시나리오·리스크 성향)과
  // 목표 우선순위에 대해, 상위 후보를 다시 서열화한다. 자세한 근거는 robustness.ts.
  applyRobustness(state, params, engine, cfg);

  const { bestResult, bestUtility, bestPlan } = state;
  const withdrawalPlanDeltas = computeDeltas(baselineResult, bestResult);
  const withdrawalPlanImproved = bestPlan !== null;
  const candidateStats = { total: candidates.length + spendingCandidates.length, failed: state.failedCandidateCount };
  const baseReasons = buildReasons(bestPlan, withdrawalPlanDeltas, withdrawalPlanImproved, candidateStats, {
    currentUtility,
    recommendedUtility: bestUtility,
    cfg,
    originalMonthlyTarget: params.userProfile.targetMonthlySpending,
    identityPlan,
  });
  const withdrawalItemizedContributions = bestPlan
    ? computeItemizedContributions(params, identityPlan, bestPlan, currentUtility, baselineResult, engine, cfg)
    : [];

  // Phase 3: 배당 재투자 최적화 (신규). Phase 1+2 결과 위에서 자산별 reinvestDividend를
  // 독립 평가(O(N)) + 통합 검증한다. WithdrawalPlan(bestPlan)과는 다른 축(축적기 파라미터)이라
  // bestPlan 자체는 바꾸지 않고, 최종 결과와 추가 itemized 항목/reasons만 병합한다.
  const reinvestOpt = optimizeDividendReinvestment(params, bestPlan, bestResult, bestUtility, engine, cfg);
  const additionalItemizedContributions: ItemizedContribution[] = reinvestOpt.perAssetResults.map((r) => ({
    field: 'assetReinvestment',
    label: r.flippedValue
      ? `"${r.assetName}"의 배당을 재투자로 전환합니다.`
      : `"${r.assetName}"의 배당 재투자를 중단하고 현금으로 인출합니다.`,
    utilityDelta: r.utilityDelta,
    deltas: r.deltas,
  }));

  // Phase 4: 사적연금 조기수령 채널링(4-A)과 신규 연금계좌 추가 납입(4-B). Phase 1+2+3 최종
  // 결과(reinvestOpt.finalResult/finalUtility)를 공통 baseline으로 두 레그를 독립 평가한다.
  // paramsAfterPhase3는 Phase 3까지의 결정(인출계획 + 자산별 reinvestDividend)을 반영한 params로,
  // PrivatePensionChannelingOptimizer가 이 위에 각 레그의 candidate를 만든다.
  //
  // bestPlan이 있으면 반드시 paramsForCandidate를 재사용한다 — 직접 손으로
  // { ...params, withdrawalPlan: bestPlan }을 만들면 monthlySpendingMultiplier 스케일링
  // (userProfile.targetMonthlySpending 조정)이 누락되어 Phase 2가 고른 생활비 배수가 Phase 4
  // 평가에 반영되지 않는다.
  // bestPlan이 null이면(Phase 1+2에서 개선을 찾지 못한 경우) identityPlan을 끼워 넣는다.
  // getIdentityPlan이 진짜 identity가 된 뒤로 두 방식이 같은 시뮬레이션을 만들기 때문이다
  // (identityPlan.test.ts가 결과 전체 동일성을 증명한다). Phase 3(DividendReinvestmentOptimizer)도
  // 같은 규칙을 쓰므로 두 단계의 baseline이 정확히 같은 계획을 가리킨다.
  //
  // 예전에는 identityPlan이 privatePensionMonthlyTarget을 targetMonthlySpending으로 항상 채워
  // 엔진 기본값(잔여월 균등분할)과 다르게 동작했고("동일 params에서 72점 vs 65점"), 그래서
  // 여기서는 원본 params를, Phase 3에서는 identityPlan을 쓰는 비대칭이 생겼다. 그 비대칭이
  // Phase 4의 marginal delta에 5~10점 규모의 계통 오차를 섞고 있었다. 이제 사라졌다.
  const baseParamsAfterPhase3: SimulationParams = paramsForCandidate(params, bestPlan ?? identityPlan);
  const paramsAfterPhase3: SimulationParams = {
    ...baseParamsAfterPhase3,
    assets: reinvestOpt.recommendedAssetReinvestment
      ? baseParamsAfterPhase3.assets.map((a) =>
          a.id in reinvestOpt.recommendedAssetReinvestment!
            ? { ...a, reinvestDividend: reinvestOpt.recommendedAssetReinvestment![a.id] }
            : a
        )
      : baseParamsAfterPhase3.assets,
  };
  const channelingOpt = optimizePrivatePensionChanneling(
    paramsAfterPhase3,
    reinvestOpt.finalResult,
    reinvestOpt.finalUtility,
    engine,
    cfg
  );
  additionalItemizedContributions.push(...channelingOpt.itemizedContributions);
  const additionalReasons = additionalItemizedContributions.map((c) => c.label);

  // withdrawalPlanImproved면 기존 reasons 뒤에 자연스럽게 이어붙이고, WithdrawalPlan 차원에서는
  // 개선이 없었는데 Phase 3/4만 개선을 찾았다면 "개선 없음" 문구(baseReasons) 대신 그 문구만
  // 보여준다(둘 다 없으면 기존 baseReasons의 "개선 없음" 문구를 그대로 유지).
  const reasons = withdrawalPlanImproved
    ? [...baseReasons, ...additionalReasons]
    : additionalReasons.length > 0
      ? additionalReasons
      : baseReasons;
  const itemizedContributions = [...withdrawalItemizedContributions, ...additionalItemizedContributions];
  const improved = channelingOpt.finalUtility.score > currentUtility.score;
  const deltas = computeDeltas(baselineResult, channelingOpt.finalResult);

  // Phase 3/4의 시도량/실패량을 후보 통계에 합산해 AI advisor(계산 실패 감지)까지 흐르게 한다.
  // params.assets.length는 Phase 3가 시도한 작업량의 근사치이고, Phase 4는 실제로 실행한
  // 시뮬레이션 횟수(attemptedCount, 전제 조건 미충족이면 0)를 그대로 더한다. 무조건 +1을 더하면
  // 시뮬레이션을 한 번도 안 돌린 사용자(예: ISA·사적연금 미보유)에게도 후보가 1개 있는 것으로
  // 집계되어, AI advisor의 "전부 실패" 판정(failedCandidateCount === totalCandidateCount)이
  // 영원히 성립하지 않는다.
  const totalCandidateCount = candidateStats.total + params.assets.length + channelingOpt.attemptedCount;
  const failedCandidateCount = candidateStats.failed + reinvestOpt.failedAssetCount + channelingOpt.failedCount;

  // 채널링 후보는 isaMaturityDestination을 'asset'으로 강제해 평가됐다. 그 전제가 추천안에
  // 담기지 않으면 사용자가 체크리스트대로 실행해도 화면에 표시된 수치를 재현할 수 없고,
  // 오히려 이 override가 제거하려던 트레드밀 손실을 그대로 맞게 된다.
  //
  // bestPlan이 null이면 여기서도 null을 그대로 돌려준다. identityPlan을 채워 넣으면 안 된다 —
  // 그 경우 채널링 후보는 `{ ...params.withdrawalPlan(=대개 undefined), isaMaturityDestination: 'asset' }`
  // 으로 평가됐으므로, identityPlan 기반 plan은 한 번도 시뮬레이션되지 않은 전혀 다른 계획이다
  // (위 baseParamsAfterPhase3 주석대로 두 계획은 동일 params에서 72점 vs 65점으로 갈린다). ISA 만기 목적지를
  // 바꿔야 한다는 사실 자체는 채널링 항목 라벨(CHANNELING_LABEL)이 체크리스트·PDF·AI 프롬프트로
  // 전달하므로, 사용자가 안내를 못 받는 상황은 생기지 않는다.
  //
  // 중복 안내에 대해: computeItemizedContributions는 이 값이 아니라 bestPlan 기준
  // (withdrawalItemizedContributions)으로 이미 계산되어 있다. bestPlan이 없거나
  // bestPlan.isaMaturityDestination === 'pension'이면 ISA 목적지 항목이 만들어지지 않으므로
  // 채널링 라벨과 중복되지 않는다. 다만 Phase 1이 독립적으로 'asset'을 고르고 채널링도 채택되면
  // 두 곳(항목별 기여 + 채널링 라벨)에서 같은 지시가 언급된다 — 지시 내용이 서로 모순되지 않고
  // (둘 다 "일반 자산으로"), 항목별 기여의 점수 배분도 각자 독립 측정치라 정확하므로 그대로 둔다.
  const recommendedPlan: BaselineWithdrawalPlan | null =
    channelingOpt.recommendedPrivatePensionChanneling && bestPlan
      ? { ...bestPlan, isaMaturityDestination: 'asset' }
      : bestPlan;

  // 추천안의 각 축을 사용자의 실제 인출계획 위에 얹었을 때 정말로 개선이 되는지 검증한다.
  //
  // AI 센티널 자동 채움(applyAiSentinels)이 넣는 것이 정확히 이 조합인데, 후보 평가는
  // withdrawalPlan을 통째로 교체하며 이뤄지므로 이 조합 자체는 위 그리드에서 한 번도 평가되지
  // 않았다. 그래서 "추천이 개선을 준다"가 이 조합에는 그대로 옮겨오지 않는다.
  //
  // computeItemizedContributions의 동명 항목으로 대신할 수 없다. 그쪽은 화면 설명용이라
  // 생활비 배수(자동 채움 대상이 아님)와 Phase 3/4 항목까지 섞여 있고, 축별 단독 효과만
  // 재기 때문에 "각각 +1인데 합치면 −3"인 조합을 걸러내지 못한다.
  //
  // 비용은 축 N개(≤5)에 대해 runForUtility 최대 2N−1회다. 이미 최대 218개 후보를 돌리는
  // 함수이고 호출부가 이 계산을 트랜지션(비긴급) 우선순위에서 실행한다.
  const verifiedSentinelPlan = recommendedPlan
    ? buildVerifiedSentinelPlan(params, identityPlan, recommendedPlan, currentUtility, engine, cfg)
    : NO_VERIFIED_SENTINEL_STEPS;

  return {
    currentUtility,
    verifiedSentinelPlan,
    recommendedUtility: channelingOpt.finalUtility,
    recommendedPlan,
    recommendedAssetReinvestment: reinvestOpt.recommendedAssetReinvestment,
    recommendedPrivatePensionChanneling: channelingOpt.recommendedPrivatePensionChanneling,
    recommendedNewPensionContribution: channelingOpt.recommendedNewPensionContribution,
    channelingIncludesAccountTransfer: channelingOpt.channelingIncludesAccountTransfer,
    improved,
    reasons,
    totalCandidateCount,
    failedCandidateCount,
    deltas,
    recommendedResult: channelingOpt.finalResult,
    itemizedContributions,
  };
}
