import type { SimulationResult } from '../entities/types';
import type { LegacySimulationConfig, RetirementGoals, RetirementProfile, RetirementStrategy } from '../domain/input/retirement';
import { LegacySimulationAdapter } from '../domain/input/LegacySimulationAdapter';
import type { EvaluationContext, EvaluationEngine, RetirementEvaluation } from './EvaluationEngine';
import { DefaultGoalEvaluationEngine, type GoalEvaluationEngine } from './GoalEvaluationEngine';
import { LegacySimulationEngine } from '../simulation/LegacySimulationEngine';
import { generateChartCaptions } from '../usecases/dashboard/generateChartCaptions';
import { computeRiskAlerts } from '../usecases/dashboard/computeRiskAlerts';
import { computeShortfallSummary } from '../usecases/dashboard/computeShortfallSummary';
import { resolvePlanAssetStatus } from '../usecases/dashboard/resolvePlanAssetStatus';
import { resolvePlanOutcome } from '../usecases/dashboard/resolvePlanOutcome';
import { computePlanConfidence } from '../usecases/dashboard/computePlanConfidence';
import { computePensionGapRisk } from '../usecases/dashboard/computePensionGapRisk';
import { computeLifetimeSpendingPlan } from '../usecases/dashboard/computeLifetimeSpendingPlan';
import { computeSustainableSpendingAdvice } from '../usecases/dashboard/computeSustainableSpendingAdvice';
import { explainUtilityComponents } from '../usecases/utility/explainUtilityComponents';
import { explainBequestAdequacy } from '../usecases/utility/utilityAnalysis';
import { computeSensitivityAnalysis, type SensitivityAnalysis } from '../usecases/dashboard/computeSensitivityAnalysis';
import { SimulationMetricsCalculator } from '../usecases/metrics/SimulationMetricsCalculator';

/** Preserves the current result interpretation while removing its orchestration from React. */
export class LegacyEvaluationEngine implements EvaluationEngine {
  constructor(
    private readonly simulationEngine = new LegacySimulationEngine(),
    private readonly metricsCalculator = new SimulationMetricsCalculator(),
    /**
     * 충돌 판정은 «규칙을 가진 쪽»에게 묻는다. 여기서 다시 구현하면 최적화기가 후보에게
     * 내리는 판정과 화면이 현재 계획에 내리는 판정이 갈라져, 같은 계획인데 카드와 진단이
     * 서로 다른 말을 하게 된다.
     */
    private readonly goalEvaluationEngine: GoalEvaluationEngine = new DefaultGoalEvaluationEngine(),
  ) {}

  evaluate(
    profile: RetirementProfile,
    goals: RetirementGoals,
    strategy: RetirementStrategy,
    result: SimulationResult,
    context: EvaluationContext = {}
  ): RetirementEvaluation {
    const params = LegacySimulationAdapter.toLegacy(profile, goals, strategy);
    const monteCarloRates = context.monteCarlo && {
      spendingSuccessRate: context.monteCarlo.spendingSuccessRate,
      assetSuccessRate: context.monteCarlo.successRate,
      goalSuccessProbability: context.monteCarlo.goalSuccessProbability,
    };

    // `StrategySimulationResult`가 요구하는 것(yearlyResults·depletionAge·endingAssets)은
    // `SimulationResult`가 이미 전부 가지고 있어 그대로 넘어간다. 변환도, 두 번째 시뮬레이션도
    // 필요 없다 — 화면은 입력이 바뀔 때마다 재평가되므로 그 한 번이 곧 체감된다.
    const {
      goalConflict, conflictingGoals, yieldedGoal,
    } = this.goalEvaluationEngine.evaluate(profile, goals, strategy, result);

    return {
      metrics: this.metricsCalculator.calculate(
        params,
        result,
        context.monteCarlo,
        context.sustainableSpendingEstimate,
      ),
      chartCaptions: generateChartCaptions(result, params),
      riskAlerts: computeRiskAlerts(result, params),
      shortfall: computeShortfallSummary(params, result),
      planAssetStatus: resolvePlanAssetStatus(result, params),
      planOutcome: resolvePlanOutcome(result, params),
      planConfidence: computePlanConfidence(result.retirementScore, monteCarloRates),
      pensionGap: computePensionGapRisk(params, result),
      lifetimeSpendingPlan: computeLifetimeSpendingPlan(params, result),
      sustainableSpendingAdvice: computeSustainableSpendingAdvice(
        params.spendingStrategy,
        params.userProfile.targetMonthlySpending,
        result.calculatedTargetSpending,
        params.hardSpendingFloor
      ),
      utilityExplanations: explainUtilityComponents(
        params,
        result,
        strategy.utilityConfig,
        context.monteCarlo
      ),
      bequestAdequacyExplanation: result.utility
        ? explainBequestAdequacy(params, result)
        : undefined,
      goalConflict: { goalConflict, conflictingGoals, yieldedGoal },
    };
  }

  analyzeSensitivity(config: LegacySimulationConfig): SensitivityAnalysis {
    return computeSensitivityAnalysis(config, this.simulationEngine);
  }
}
