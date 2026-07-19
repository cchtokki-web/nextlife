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

function computeDeltas(baseline: SimulationResult, recommended: SimulationResult): StrategyRecommendation['deltas'] {
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

function buildReasons(
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
  const baselineResult = engine.run(params);
  const currentUtility: UtilityBreakdown = computeLifetimeUtility(baselineResult, params, cfg);

  const candidates = generateCandidatePlans(params);

  let bestResult = baselineResult;
  let bestUtility = currentUtility;
  let bestPlan: WithdrawalPlan | null = null;

  for (const plan of candidates) {
    const candidateResult = engine.run({ ...params, withdrawalPlan: plan });
    const candidateUtility = computeLifetimeUtility(candidateResult, params, cfg);
    if (candidateUtility.score > bestUtility.score) {
      bestUtility = candidateUtility;
      bestResult = candidateResult;
      bestPlan = plan;
    }
  }

  const deltas = computeDeltas(baselineResult, bestResult);
  const improved = bestPlan !== null;
  const reasons = buildReasons(bestPlan, deltas, improved);

  return {
    currentUtility,
    recommendedUtility: bestUtility,
    recommendedPlan: bestPlan ?? {},
    reasons,
    deltas,
  };
}
