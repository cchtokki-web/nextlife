import type { MonteCarloResult } from '../entities/montecarlo';
import type { SimulationResult } from '../entities/types';
import type { RetirementGoals, RetirementProfile, RetirementStrategy } from '../domain/input/retirement';
import type { RiskAlert } from '../usecases/dashboard/computeRiskAlerts';
import type { ShortfallReport } from '../usecases/dashboard/computeShortfallSummary';
import type { PlanAssetStatus } from '../usecases/dashboard/resolvePlanAssetStatus';
import type { PlanOutcome } from '../usecases/dashboard/resolvePlanOutcome';
import type { PlanConfidence } from '../usecases/dashboard/computePlanConfidence';
import type { PensionGapRisk } from '../usecases/dashboard/computePensionGapRisk';
import type { ChartCaptions } from '../usecases/dashboard/generateChartCaptions';
import type { LifetimeSpendingPlan } from '../usecases/dashboard/computeLifetimeSpendingPlan';
import type { SustainableSpendingAdvice } from '../usecases/dashboard/computeSustainableSpendingAdvice';
import type { UtilityComponentExplanations } from '../usecases/utility/explainUtilityComponents';

export interface EvaluationContext {
  monteCarlo?: MonteCarloResult;
}

export interface RetirementEvaluation {
  chartCaptions: ChartCaptions;
  riskAlerts: RiskAlert[];
  shortfall: ShortfallReport;
  planAssetStatus: PlanAssetStatus;
  planOutcome: PlanOutcome;
  planConfidence: PlanConfidence;
  pensionGap: PensionGapRisk | null;
  lifetimeSpendingPlan: LifetimeSpendingPlan | null;
  sustainableSpendingAdvice: SustainableSpendingAdvice | null;
  utilityExplanations: UtilityComponentExplanations;
  bequestAdequacyExplanation?: string;
}

/** Framework-independent evaluation boundary. */
export interface EvaluationEngine {
  evaluate(
    profile: RetirementProfile,
    goals: RetirementGoals,
    strategy: RetirementStrategy,
    result: SimulationResult,
    context?: EvaluationContext
  ): RetirementEvaluation;
}
