import {
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
import { generateCandidatePlans } from './StrategyCandidateGenerator';

function sumYears(result: SimulationResult, pick: (y: SimulationResult['yearlyResults'][number]) => number): number {
  return result.yearlyResults.reduce((sum, y) => sum + pick(y), 0);
}

function totalTaxPaid(result: SimulationResult): number {
  return sumYears(
    result,
    (y) => y.dividendTaxPaid + y.pensionTaxPaid + y.nationalPensionTaxPaid + y.healthInsurancePaid + y.comprehensiveTaxPaid
  );
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
  };
}

function formatManwon(amountKRW: number): string {
  return `${Math.round(amountKRW / 10000).toLocaleString('ko-KR')}만원`;
}

export function buildReasons(
  plan: WithdrawalPlan | null,
  deltas: StrategyRecommendation['deltas'],
  improved: boolean
): string[] {
  if (!improved || !plan) {
    return ['현재 전략이 이미 Lifetime Utility 관점에서 충분히 합리적이어서 별도로 추천할 변경 사항이 없습니다.'];
  }

  const reasons: string[] = [];

  if (plan.privatePensionStartAge !== undefined) {
    reasons.push(`${plan.privatePensionStartAge}세부터 사적연금 인출을 시작합니다.`);
  }
  if (plan.privatePensionMonthlyTarget !== undefined) {
    reasons.push(`사적연금을 월 약 ${formatManwon(plan.privatePensionMonthlyTarget)} 수준으로 정액 인출합니다.`);
  }
  if (plan.assetSellOrderStrategy === 'low_dividend_first') {
    reasons.push('배당수익률이 낮은 자산부터 매도해 배당 소득원을 오래 유지합니다.');
  } else if (plan.assetSellOrderStrategy === 'high_dividend_first') {
    reasons.push('배당수익률이 높은 자산부터 매도해 향후 금융소득종합과세 위험을 낮춥니다.');
  }
  if (plan.isaMaturityDestination === 'asset') {
    reasons.push('ISA 만기 자금을 사적연금 대신 일반 자산으로 이동해 향후 인출 시 세금 부담을 낮춥니다.');
  }
  if (plan.generalAssetWithdrawalStartAge !== undefined) {
    reasons.push(`${plan.generalAssetWithdrawalStartAge}세부터 일반 자산(주식/ETF) 인출을 시작합니다.`);
  }
  if (plan.nationalPensionStartAge !== undefined && plan.nationalPensionStartAge !== 65) {
    if (plan.nationalPensionStartAge < 65) {
      reasons.push(`국민연금을 ${plan.nationalPensionStartAge}세부터 조기 수령합니다.`);
    } else {
      reasons.push(`국민연금을 ${plan.nationalPensionStartAge}세까지 연기 수령해 수령액을 늘립니다.`);
    }
  }
  if (deltas.lifetimeConsumption > 0) {
    reasons.push(`평생 소비 가능 금액이 약 ${formatManwon(deltas.lifetimeConsumption)} 증가합니다.`);
  }
  if (deltas.pensionEndingBalance < 0) {
    reasons.push(`사망 시 연금잔액이 약 ${formatManwon(-deltas.pensionEndingBalance)} 감소해 연금을 더 효율적으로 활용합니다.`);
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

// 후보 전략 생성(StrategyCandidateGenerator) + Utility 평가(UtilityEngine)를 결합해
// 기존 로직(baseline) 대비 Lifetime Utility가 가장 높은 인출 전략을 찾는다.
// MC(Monte Carlo) 확장 시에는 이 함수 내부의 engine.run() 호출을 시나리오 평균으로
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

  const candidates = generateCandidatePlans(params);

  let bestResult = baselineResult;
  let bestUtility = currentUtility;
  let bestPlan: WithdrawalPlan | null = null;

  for (const plan of candidates) {
    // 특정 조합(예: 극단적인 나이 조합)이 SimulationEngine을 깨뜨리더라도 다른 후보 탐색까지
    // 통째로 실패하지 않도록 후보 단위로 격리한다. 실패한 후보는 건너뛰고 로그만 남긴다.
    try {
      const candidateResult = engine.runForUtility({ ...params, withdrawalPlan: plan });
      const candidateUtility = computeLifetimeUtility(candidateResult, params, cfg);
      if (candidateUtility.score > bestUtility.score) {
        bestUtility = candidateUtility;
        bestResult = candidateResult;
        bestPlan = plan;
      }
    } catch (err) {
      console.warn('Skipping withdrawal plan candidate that failed to simulate', plan, err);
    }
  }

  const deltas = computeDeltas(baselineResult, bestResult);
  const improved = bestPlan !== null;
  const reasons = buildReasons(bestPlan, deltas, improved);

  return {
    currentUtility,
    recommendedUtility: bestUtility,
    recommendedPlan: bestPlan,
    improved,
    reasons,
    deltas,
  };
}
