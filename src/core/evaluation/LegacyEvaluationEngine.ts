import type { SimulationResult } from '../entities/types';
import type { LegacySimulationConfig, RetirementGoals, RetirementProfile, RetirementStrategy } from '../domain/input/retirement';
import { LegacySimulationAdapter } from '../domain/input/LegacySimulationAdapter';
import type { EvaluationContext, EvaluationEngine, RetirementEvaluation } from './EvaluationEngine';
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
    };
  }

  analyzeSensitivity(config: LegacySimulationConfig): SensitivityAnalysis {
    return computeSensitivityAnalysis(config, this.simulationEngine);
  }
}
