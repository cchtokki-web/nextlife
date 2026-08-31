import { describe, expect, test } from 'vitest';
import { resolveSimulationVerdict } from '@/core/usecases/montecarlo/resolveSimulationVerdict';
import { resolveGoalSuccessConditions } from '@/core/usecases/goals/goalSuccessConditions';
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
    // assetSurvival만 켠 hardRequirements와 짝을 맞춘다 — 그 축을 켠 목표가
    // ASSET_SURVIVAL이라는 뜻이다(아래 「판정하지 못한 HARD 목표」 테스트가 이 값을 쓴다).
    hardRequirementGoals: { spendingTarget: [], assetSurvival: ['ASSET_SURVIVAL'], terminalAsset: [] },
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
          // 요구 축을 전부 껐으므로 그 축을 켠 목표도 없다 — hardRequirements와
          // hardRequirementGoals가 갈라지면 이 픽스처가 실제로는 만들 수 없는 조합을 말하게 된다.
          hardRequirementGoals: { spendingTarget: [], assetSurvival: [], terminalAsset: [] },
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

  // 재현 사례 1(리뷰 표 1행). ASSET_GROWTH는 isQuantitativelyJudgedGoal이 참인 «유형»이라
  // 유형 멤버십만으로 갈랐다면 judged로 들어갔을 것이다. 목표액 입력 UI가 없어 어떤 축도
  // 켜지 못하므로(hardRequirementGoals의 세 축이 모두 비어 있으므로) 실제로는 unjudged다.
  test('재현 사례 1 — 목표액 UI가 없는 ASSET_GROWTH는 유형상 판정 가능해도 unjudged다', () => {
    const goalsParams = goalParams([
      { type: 'ASSET_SURVIVAL', constraintType: 'HARD', priority: 1 },
      { type: 'ASSET_GROWTH', constraintType: 'HARD', priority: 2 },
    ]);
    const conditions = resolveGoalSuccessConditions(goalsParams);

    // 재현 표의 전제: assetSurvival만 켜지고 terminalAsset은 꺼진 채다.
    expect(conditions.hardRequirements).toEqual({
      spendingTarget: false, assetSurvival: true, terminalAsset: false,
    });

    const verdict = resolveSimulationVerdict({
      monteCarlo: mc({ goalConditions: conditions }),
      params: goalsParams,
    });

    expect(verdict.hardGoalSuccess).not.toBeNull();
    expect(verdict.hardGoalSuccess!.judged).toEqual(['ASSET_SURVIVAL']);
    expect(verdict.hardGoalSuccess!.unjudged).toEqual(['ASSET_GROWTH']);
    expect(verdict.hardGoalSuccess!.planEmbedded).toEqual([]);
  });

  // 재현 사례 2(리뷰 표 2행, 위키 「알려진 한계」와 같은 조합). 기말자산 문턱은 단일
  // 값이라 SOFT ASSET_GROWTH 5억이 HARD INHERITANCE 3억을 이긴다(terminalAssetGoalOf의
  // reduce). source가 SOFT 목표이므로 hardRequirements.terminalAsset은 false이고, 그 결과
  // 사용자가 실제로 못박은 3억 HARD 요구가 이 비율에서 통째로 빠진다 — judged가 아니라
  // unjudged여야 한다.
  test('재현 사례 2 — SOFT 목표가 문턱을 가로채면 확정 HARD 상속 요구가 unjudged로 빠진다', () => {
    const goalsParams = goalParams([
      { type: 'INHERITANCE', constraintType: 'HARD', priority: 1, targetValue: 300_000_000, targetValueSource: 'user' },
      { type: 'ASSET_GROWTH', constraintType: 'SOFT', priority: 2, targetValue: 500_000_000, targetValueSource: 'user' },
      { type: 'ASSET_SURVIVAL', constraintType: 'HARD', priority: 3 },
    ]);
    const conditions = resolveGoalSuccessConditions(goalsParams);

    expect(conditions.terminalAssetGoal).toBe(500_000_000);
    expect(conditions.hardRequirements.terminalAsset).toBe(false);

    const verdict = resolveSimulationVerdict({
      monteCarlo: mc({ goalConditions: conditions }),
      params: goalsParams,
    });

    expect(verdict.hardGoalSuccess).not.toBeNull();
    expect(verdict.hardGoalSuccess!.judged).toEqual(['ASSET_SURVIVAL']);
    expect(verdict.hardGoalSuccess!.unjudged).toEqual(['INHERITANCE']);
  });

  // EARLY_RETIREMENT는 unjudged도 judged도 아닌 세 번째 갈래다 — 계획에 이미 반영되어
  // 모든 시행이 지키므로 조건으로 세지 않는다(goalSuccessConditions.ts의
  // isPlanEmbeddedGoal 주석). unjudged에 넣으면 반영된 목표를 반영되지 않았다고
  // 말하게 된다.
  test('EARLY_RETIREMENT는 judged도 unjudged도 아닌 planEmbedded다', () => {
    const goalsParams = goalParams([
      { type: 'ASSET_SURVIVAL', constraintType: 'HARD', priority: 1 },
      { type: 'EARLY_RETIREMENT', constraintType: 'HARD', priority: 2, targetValue: 60 },
    ]);
    const conditions = resolveGoalSuccessConditions(goalsParams);

    const verdict = resolveSimulationVerdict({
      monteCarlo: mc({ goalConditions: conditions }),
      params: goalsParams,
    });

    expect(verdict.hardGoalSuccess).not.toBeNull();
    expect(verdict.hardGoalSuccess!.judged).toEqual(['ASSET_SURVIVAL']);
    expect(verdict.hardGoalSuccess!.unjudged).toEqual([]);
    expect(verdict.hardGoalSuccess!.planEmbedded).toEqual(['EARLY_RETIREMENT']);
  });
});
