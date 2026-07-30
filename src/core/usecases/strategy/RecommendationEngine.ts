import {
  CompleteWithdrawalPlan,
  ItemizedContribution,
  SimulationParams,
  SimulationResult,
  StrategyRecommendation,
  UtilityBreakdown,
  UtilityConfig,
  WithdrawalPlan,
} from '../../entities/types';
import { SimulationEngine } from '../SimulationEngine';
import { computeLifetimeUtility } from '../utility/UtilityEngine';
import { DEFAULT_UTILITY_CONFIG } from '../utility/utilityWeights';
import { analyzeCurrentStrategy, formatManwon } from '../utility/utilityAnalysis';
import { getRetirementGrade } from '../../entities/retirementGrade';
import { generateCandidatePlans, generateSpendingAdjustmentCandidates, getIdentityPlan } from './StrategyCandidateGenerator';
import { optimizeDividendReinvestment } from './DividendReinvestmentOptimizer';
import { optimizePrivatePensionChanneling } from './PrivatePensionChannelingOptimizer';
import { computeDeltas } from './deltas';

// 하위 호환: 기존에 computeDeltas를 이 모듈에서 import하던 코드(테스트 등)를 위해 재노출한다.
export { computeDeltas } from './deltas';

// AssetSellOrderStrategy/IsaMaturityDestination에 새 variant가 추가됐는데 아래 switch를
// 갱신하지 않으면 여기서 컴파일 에러가 나서 누락을 막아준다(조용히 무시되는 대신).
function assertNever(x: never): never {
  throw new Error(`Unhandled variant: ${x}`);
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
  identityPlan?: CompleteWithdrawalPlan;
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
    reasons.push(
      `목표 생활비를 월 약 ${formatManwon(before)} → ${formatManwon(after)}(약 ${formatManwon(after - before)} 증액)로 늘리면 ` +
        `평생 효용이 ${context.currentUtility.score}점 → ${context.recommendedUtility.score}점으로 개선됩니다.`
    );
  }

  if (
    plan.privatePensionMonthlyTarget !== undefined &&
    plan.privatePensionMonthlyTarget !== context?.identityPlan?.privatePensionMonthlyTarget
  ) {
    reasons.push(`사적연금을 월 약 ${formatManwon(plan.privatePensionMonthlyTarget)} 수준으로 정액 인출합니다.`);
  }
  switch (plan.assetSellOrderStrategy) {
    case 'low_dividend_first':
      reasons.push('배당수익률이 낮은 자산부터 매도해 배당 소득원을 오래 유지합니다.');
      break;
    case 'high_dividend_first':
      reasons.push('배당수익률이 높은 자산부터 매도해 향후 금융소득종합과세 위험을 낮춥니다.');
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
function paramsForCandidate(params: SimulationParams, plan: CompleteWithdrawalPlan): SimulationParams {
  const multiplier = plan.monthlySpendingMultiplier ?? 1;
  if (multiplier === 1) {
    return { ...params, withdrawalPlan: plan };
  }
  return {
    ...params,
    userProfile: {
      ...params.userProfile,
      targetMonthlySpending: Math.round(params.userProfile.targetMonthlySpending * multiplier),
    },
    withdrawalPlan: plan,
  };
}

const PLAN_FIELDS: Array<keyof CompleteWithdrawalPlan> = [
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
  field: keyof CompleteWithdrawalPlan,
  recommendedPlan: CompleteWithdrawalPlan,
  identityPlan: CompleteWithdrawalPlan,
  itemDeltas: StrategyRecommendation['deltas'],
  originalMonthlyTarget: number
): string {
  switch (field) {
    case 'privatePensionMonthlyTarget':
      return `사적연금을 월 약 ${formatManwon(recommendedPlan.privatePensionMonthlyTarget)} 수준으로 정액 인출합니다.`;
    case 'generalAssetWithdrawalStartAge':
      return `${recommendedPlan.generalAssetWithdrawalStartAge}세부터 일반 자산(주식/ETF) 인출을 시작합니다.`;
    case 'assetSellOrderStrategy':
      if (recommendedPlan.assetSellOrderStrategy === 'low_dividend_first') {
        return '배당수익률이 낮은 자산부터 매도해 배당 소득원을 오래 유지합니다.';
      }
      if (recommendedPlan.assetSellOrderStrategy === 'high_dividend_first') {
        return '배당수익률이 높은 자산부터 매도해 향후 금융소득종합과세 위험을 낮춥니다.';
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
      return (
        `목표 생활비를 월 약 ${formatManwon(before)} → ${formatManwon(after)}` +
        `(약 ${formatManwon(after - before)} 증액)로 늘립니다.`
      );
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
  identityPlan: CompleteWithdrawalPlan,
  recommendedPlan: CompleteWithdrawalPlan,
  currentUtility: UtilityBreakdown,
  baselineResult: SimulationResult,
  engine: SimulationEngine,
  cfg: UtilityConfig
): ItemizedContribution[] {
  const changedFields = PLAN_FIELDS.filter((field) => recommendedPlan[field] !== identityPlan[field]);

  const contributions: ItemizedContribution[] = [];
  for (const field of changedFields) {
    try {
      const overridePlan: CompleteWithdrawalPlan = { ...identityPlan, [field]: recommendedPlan[field] };
      const overrideParams = paramsForCandidate(params, overridePlan);
      const singleFieldResult = engine.runForUtility(overrideParams);
      const singleFieldUtility = computeLifetimeUtility(singleFieldResult, overrideParams, cfg);
      const itemDeltas = computeDeltas(baselineResult, singleFieldResult);
      contributions.push({
        label: labelForSingleFieldChange(
          field,
          recommendedPlan,
          identityPlan,
          itemDeltas,
          params.userProfile.targetMonthlySpending
        ),
        utilityDelta: singleFieldUtility.score - currentUtility.score,
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
  bestPlan: CompleteWithdrawalPlan | null;
  failedCandidateCount: number;
}

// 후보 하나를 시뮬레이션 + Utility 평가하고, baseline(또는 지금까지의 최선) 대비 더 나으면
// state를 갱신한다. 특정 조합(예: 극단적인 나이 조합)이 SimulationEngine을 깨뜨리더라도 다른
// 후보 탐색까지 통째로 실패하지 않도록 후보 단위로 격리한다. 실패한 후보는 건너뛰고 로그만 남긴다.
function evaluateCandidate(
  plan: CompleteWithdrawalPlan,
  params: SimulationParams,
  engine: SimulationEngine,
  cfg: UtilityConfig,
  state: CandidateSearchState
): void {
  try {
    const candidateParams = paramsForCandidate(params, plan);
    const candidateResult = engine.runForUtility(candidateParams);
    const candidateUtility = computeLifetimeUtility(candidateResult, candidateParams, cfg);
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
  const currentUtility: UtilityBreakdown = computeLifetimeUtility(baselineResult, params, cfg);

  const state: CandidateSearchState = {
    bestResult: baselineResult,
    bestUtility: currentUtility,
    bestPlan: null,
    failedCandidateCount: 0,
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
  const allowSpendingIncrease =
    (params.spendingStrategy ?? 'target') === 'target' &&
    (baselineResult.depletionAge === null || baselineResult.depletionAge >= params.userProfile.expectancy);
  const identityPlan = getIdentityPlan(params);
  const spendingBasePlan = state.bestPlan ?? identityPlan;
  const spendingCandidates = generateSpendingAdjustmentCandidates(params, spendingBasePlan, {
    allowIncrease: allowSpendingIncrease,
  });
  for (const plan of spendingCandidates) {
    evaluateCandidate(plan, params, engine, cfg, state);
  }

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
  // bestPlan이 null이면(Phase 1+2에서 개선을 찾지 못한 경우) identityPlan을 대신 끼워 넣으면
  // 안 된다 — identityPlan은 privatePensionMonthlyTarget = targetMonthlySpending으로 항상 채워진
  // "완결된" plan이라 withdrawalPlan을 아예 지정하지 않았을 때(엔진의 잔여월 기준 기본 인출)와
  // 다르게 동작한다(동일 params에서 72점 vs 65점으로 갈리는 것을 확인함). 이 경우
  // params.withdrawalPlan을 원래 값 그대로 둔다.
  //
  // 알려진 한계(Phase 3 → Phase 4 baseline 이음매): bestPlan === null일 때 위 규칙 때문에
  // 여기서는 params.withdrawalPlan을 원본 그대로 쓰지만, Phase 3의 DividendReinvestmentOptimizer는
  // (`DividendReinvestmentOptimizer.ts:85`) 후보 params를 `bestPlan ?? getIdentityPlan(params)`로
  // 만든다. 즉 Phase 3가 개선을 채택하면 Phase 4에 넘어오는 baseline(reinvestOpt.finalUtility)은
  // identityPlan 아래에서 측정된 값인데, Phase 4의 두 레그는 원본 plan 아래에서 측정된다. 두
  // 기준선이 같은 계획을 가리키지 않으므로 Phase 4의 marginal delta에 5~10점 규모의 계통 오차가
  // 섞일 수 있다(이 오차는 채널링 자체와 무관하다). Phase 3의 params 구성은 이미 출시·별도 리뷰된
  // 기능이라 이번 수정 범위 밖이며(계획 문서 §범위 밖), 고치려면 Phase 3의 baseline 규칙을
  // 여기와 동일하게 맞추는 별도 작업이 필요하다.
  const baseParamsAfterPhase3: SimulationParams = bestPlan ? paramsForCandidate(params, bestPlan) : params;
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
  // (위 :385~389 주석대로 두 계획은 동일 params에서 72점 vs 65점으로 갈린다). ISA 만기 목적지를
  // 바꿔야 한다는 사실 자체는 채널링 항목 라벨(CHANNELING_LABEL)이 체크리스트·PDF·AI 프롬프트로
  // 전달하므로, 사용자가 안내를 못 받는 상황은 생기지 않는다.
  //
  // 중복 안내에 대해: computeItemizedContributions는 이 값이 아니라 bestPlan 기준
  // (withdrawalItemizedContributions)으로 이미 계산되어 있다. bestPlan이 없거나
  // bestPlan.isaMaturityDestination === 'pension'이면 ISA 목적지 항목이 만들어지지 않으므로
  // 채널링 라벨과 중복되지 않는다. 다만 Phase 1이 독립적으로 'asset'을 고르고 채널링도 채택되면
  // 두 곳(항목별 기여 + 채널링 라벨)에서 같은 지시가 언급된다 — 지시 내용이 서로 모순되지 않고
  // (둘 다 "일반 자산으로"), 항목별 기여의 점수 배분도 각자 독립 측정치라 정확하므로 그대로 둔다.
  const recommendedPlan: CompleteWithdrawalPlan | null =
    channelingOpt.recommendedPrivatePensionChanneling && bestPlan
      ? { ...bestPlan, isaMaturityDestination: 'asset' }
      : bestPlan;

  return {
    currentUtility,
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
