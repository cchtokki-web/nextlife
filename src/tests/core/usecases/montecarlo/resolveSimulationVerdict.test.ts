import { describe, expect, test } from 'vitest';
import { resolveSimulationVerdict } from '@/core/usecases/montecarlo/resolveSimulationVerdict';
import { initialParams } from '@/infrastructure/storage/localStore';
import type { MonteCarloResult } from '@/core/entities/montecarlo';
import type { SimulationParams } from '@/core/entities/types';

const mc = (over: Partial<MonteCarloResult> = {}): MonteCarloResult => ({
  trials: 1000, seed: 42, successAge: 90,
  successRate: 0.92, spendingSuccessRate: 0.82, averageSpendingFulfillmentRate: 0.97,
  goalSuccessProbability: 0.78, hardGoalSuccessProbability: 0.91,
  goalFailure: {
    spendingShortfall: 0, assetDepletion: 0,
    observedAssetDepletionCount: 0, observedEarliestDepletionAge: null,
    terminalShortfall: 0, medianFirstShortfallAge: null, terminalAssetGoal: 0,
  },
  goalConditions: {
    basis: 'selected_goals', requireSpendingTarget: true,
    requireAssetSurvival: true, terminalAssetGoal: 0, unmeasuredGoals: [],
    hardRequirements: { spendingTarget: false, assetSurvival: true, terminalAsset: false },
  },
  plannedMonthlySpending: 3_000_000,
  endingAssets: { p10: 0, p50: 0, p90: 0 }, assetBands: [],
  depletion: { count: 0, earliestAge: null, medianAge: null },
  deterministicEndingAssets: 0,
  ...over,
} as MonteCarloResult);

const goalParams = (goals: unknown[]): SimulationParams => {
  const base = structuredClone(initialParams);
  base.retirementGoals = goals as SimulationParams['retirementGoals'];
  return base;
};

describe('resolveSimulationVerdict', () => {
  test('Monte Carlo 결과가 없으면 available=false이고 어떤 비율도 0으로 짜내지 않는다', () => {
    const verdict = resolveSimulationVerdict({ monteCarlo: undefined, params: initialParams });

    expect(verdict.available).toBe(false);
    expect(verdict.goalSuccess.rate).toBeNaN();
  });

  test('세 지표는 서로 대체하지 않는다', () => {
    // spendingSuccessRate가 goalSuccess를 메우던 옛 폴백이 되살아나면 이 단언이 깨진다.
    const verdict = resolveSimulationVerdict({ monteCarlo: mc(), params: initialParams });

    expect(verdict.goalSuccess.rate).toBe(0.78);
    expect(verdict.spendingFulfillment.fullRate).toBe(0.82);
    expect(verdict.assetSurvival.rate).toBe(0.92);
  });

  test('success/failure 개수가 trials와 맞는다', () => {
    const verdict = resolveSimulationVerdict({ monteCarlo: mc(), params: initialParams });

    expect(verdict.goalSuccess.succeeded + verdict.goalSuccess.failed).toBe(1000);
    expect(verdict.goalSuccess.succeeded).toBe(780);
  });

  test('확정 HARD 목표가 없으면 hardGoalSuccess는 null이다', () => {
    const verdict = resolveSimulationVerdict({
      monteCarlo: mc({
        goalConditions: {
          ...mc().goalConditions,
          hardRequirements: { spendingTarget: false, assetSurvival: false, terminalAsset: false },
        },
      }),
      params: goalParams([{ type: 'ASSET_SURVIVAL', constraintType: 'SOFT', priority: 1 }]),
    });

    expect(verdict.hardGoalSuccess).toBeNull();
  });

  test('판정하지 못한 HARD 목표를 unjudged로 드러낸다', () => {
    // 주거 안정은 MEASURABLE_GOALS에 없어 HARD로 골라도 이 비율이 판정하지 않는다.
    // 이것을 숨기면 known-issues 1번을 지표 하나 더 만들어 되풀이한다.
    const verdict = resolveSimulationVerdict({
      monteCarlo: mc(),
      params: goalParams([
        { type: 'ASSET_SURVIVAL', constraintType: 'HARD', priority: 1 },
        { type: 'HOUSING_STABILITY', constraintType: 'HARD', priority: 2 },
      ]),
    });

    expect(verdict.hardGoalSuccess).not.toBeNull();
    expect(verdict.hardGoalSuccess!.judged).toContain('ASSET_SURVIVAL');
    expect(verdict.hardGoalSuccess!.unjudged).toContain('HOUSING_STABILITY');
    expect(verdict.hardGoalSuccess!.judged).not.toContain('HOUSING_STABILITY');
  });
});
