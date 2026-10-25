import type { MonteCarloResult } from '../entities/montecarlo';
import type { SimulationResult } from '../entities/types';
import type { RetirementGoals, RetirementProfile, RetirementStrategy } from '../domain/input/retirement';
import type { GoalEvaluationResult } from './GoalEvaluationEngine';
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
import type { SimulationMetrics } from '../usecases/metrics/SimulationMetricsCalculator';

/**
 * 평가에 «결과 바깥»에서 들어오는 재료. 오늘은 몬테카를로 하나뿐이다.
 *
 * 한때 `sustainableSpendingEstimate`가 함께 있었다. 어떤 호출부도 그것을 채우지 않아
 * 이 필드는 언제나 undefined였고, 그 결과 지표의 basis가 언제나 'deterministic'으로만
 * 섰다(known-issues 17번). 여기에 필드를 더할 때는 «채우는 호출부»를 같은 커밋에서
 * 함께 만든다 — 생산자 없는 선택 필드는 타입이 없는 기능을 약속하게 한다.
 */
export interface EvaluationContext {
  monteCarlo?: MonteCarloResult;
}

/**
 * 「내가 고른 목표들이 서로 맞지 않는다」는 판정. `GoalEvaluationResult`에서 «그 셋만» 뽑는다.
 *
 * 전체를 내보내지 않는 이유는 나머지가 최적화기의 작업 재료이기 때문이다 — weightedScore·
 * utility·goalEvaluations는 후보를 «줄 세우는» 값이라 화면에는 비교 대상이 없고, 내보내면
 * 화면이 순위 없는 점수를 그리게 된다. 화면에 필요한 것은 판정 하나다.
 */
export type GoalConflictVerdict =
  Pick<GoalEvaluationResult, 'goalConflict' | 'conflictingGoals' | 'yieldedGoal'>;

export interface RetirementEvaluation {
  metrics: SimulationMetrics;
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
  /**
   * 사용자의 «현재 계획»에 대한 목표 충돌 판정. 지금까지 이 판정은 StrategyOptimizer 안에서
   * 후보마다만 서고 화면이 보는 계획에는 아무데서도 계산되지 않았다.
   *
   * 선택 필드로 두지 않는다 — 빠뜨려도 컴파일이 통과하면 충돌은 「없다」가 아니라 조용히
   * 사라지고, 그 침묵은 「목표가 서로 맞는다」와 구분되지 않는다.
   */
  goalConflict: GoalConflictVerdict;
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
