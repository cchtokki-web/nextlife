import type { SimulationParams } from '../../entities/types';
import type { MonteCarloConfig } from '../../entities/montecarlo';
import { LegacySimulationAdapter } from '../../domain/input/LegacySimulationAdapter';
import { DefaultGoalEvaluationEngine } from '../../evaluation/GoalEvaluationEngine';
import { LegacySimulationEngine } from '../../simulation/LegacySimulationEngine';
import { StrategyGenerator } from '../../strategy/StrategyGenerator';
import { HardConstraintFilter } from '../../strategy/HardConstraintFilter';
import { runMonteCarlo } from '../montecarlo/MonteCarloEngine';
import { resolveMonteCarloConfig } from '../montecarlo/volatilityPresets';
import { runStrategyPipeline } from '../strategy/runStrategyPipeline';
import { generateGoalChangeProposals } from './goalChangeProposals';

/** 같은 시드와 시장 가정으로 변경된 목표를 별도 검증한다. */
export function evaluateGoalChanges(params: SimulationParams, configOverride?: MonteCarloConfig) {
  const engine = new LegacySimulationEngine();
  const baseline = runStrategyPipeline(params, engine).effective.params;
  const config = configOverride ?? resolveMonteCarloConfig(baseline);
  const current = runMonteCarlo(baseline, engine, config);
  const filter = new HardConstraintFilter();
  const evaluator = new DefaultGoalEvaluationEngine();
  const proposals = generateGoalChangeProposals(params).flatMap((proposal) => {
    const effective = runStrategyPipeline(proposal.params, engine).effective.params;
    const input = LegacySimulationAdapter.fromLegacy(effective);
    const candidate = new StrategyGenerator().generate(input.profile, input.goals, input.strategy, { maxCandidates: 1 }).candidates[0];
    if (filter.beforeSimulation(candidate, input.goals).length) return [];
    const simulation = engine.simulate(input.profile, candidate.strategy);
    const evaluation = evaluator.evaluate(input.profile, input.goals, candidate.strategy, simulation);
    if (filter.afterEvaluation(evaluation).length || evaluation.unsupportedHardGoals.length) return [];
    const result = runMonteCarlo(effective, engine, config);
    if (Math.round(result.goalSuccessProbability * 100) <= Math.round(current.goalSuccessProbability * 100)) return [];
    return [{ ...proposal, probability: result.goalSuccessProbability, conditions: result.goalConditions }];
  });
  return { baselineProbability: current.goalSuccessProbability, baselineConditions: current.goalConditions, trials: config.trials, proposals };
}
