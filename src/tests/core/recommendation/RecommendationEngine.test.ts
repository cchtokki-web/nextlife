import { describe, expect, test } from 'vitest';
import { RecommendationEngine, noRecommendationReachesGoal } from '@/core/recommendation/RecommendationEngine';
import type { RankedStrategyCandidate } from '@/core/strategy/StrategyOptimizer';
import { LegacySimulationAdapter } from '@/core/domain/input/LegacySimulationAdapter';
import { initialParams } from '@/infrastructure/storage/localStore';
import { normalizeRetirementGoals } from '@/core/entities/retirementGoal';
import type { RetirementGoal, RetirementGoalType } from '@/core/entities/retirementGoal';
import type { RetirementGoals } from '@/core/domain/input/retirement';

/** 선택 목표를 우선순위 순으로 만든다. 배열 순서가 곧 1순위, 2순위… 다. */
function goalsOf(...types: RetirementGoalType[]): RetirementGoals {
  const selectedGoals: RetirementGoal[] = types.map((type, index) => ({
    type,
    priority: index + 1,
    constraintType: 'SOFT',
  }));
  return { goals: [], selectedGoals };
}

/**
 * `goalEvaluations`는 `normalizeRetirementGoals(selectedGoals)`와 위치가 맞아야 한다.
 * DefaultGoalEvaluationEngine이 그 순서로 map 하므로, 테스트도 같은 규칙을 따른다.
 */
function evaluationsFor(goals: RetirementGoals, missed: readonly RetirementGoalType[]) {
  return normalizeRetirementGoals(goals.selectedGoals ?? []).map((goal) => ({
    goalType: goal.type,
    score: missed.includes(goal.type) ? 0 : 100,
    achieved: !missed.includes(goal.type),
    measurement: { unit: 'NONE' } as const,
    reason: '',
  }));
}

function candidate(input: {
  id: string;
  allocation: 'CONSERVATIVE' | 'BALANCED' | 'GROWTH';
  spending: 'FIXED' | 'FRONT_LOADED' | 'CARE_HEAVY';
  goalProbability: number;
  spendingProbability?: number;
  survivalProbability?: number;
  p10?: number;
  goals?: RetirementGoals;
  missed?: readonly RetirementGoalType[];
}): RankedStrategyCandidate {
  const domain = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
  return {
    rank: 1,
    candidate: {
      id: input.id,
      strategy: domain.strategy,
      dimensions: {
        retirementAge: domain.strategy.retirementAge,
        nationalPensionTiming: 'NORMAL',
        nationalPensionStartAge: 65,
        withdrawalPolicy: 'GENERAL_FIRST',
        spendingPattern: input.spending,
        assetAllocation: input.allocation,
      },
    },
    simulation: { yearlyResults: [], depletionAge: null, endingAssets: 100 },
    evaluation: {
      hardConstraintsSatisfied: true,
      goalEvaluations: input.goals ? evaluationsFor(input.goals, input.missed ?? []) : [],
      weightedScore: Math.round(input.goalProbability * 100),
      score: 0,
      utility: {
        score: 0,
        components: {
          consumption: 0,
          depletionSafety: 0,
          pensionUtilization: 0,
          taxEfficiency: 0,
          taxationRisk: 0,
          bequestAdequacy: 0,
        },
      },
      hardConstraintFailures: [],
      unsupportedHardGoals: [],
    },
    monteCarlo: {
      trials: 100,
      seed: 42,
      goalSuccessProbability: input.goalProbability,
      spendingSuccessProbability: input.spendingProbability ?? input.goalProbability,
      assetSurvivalProbability: input.survivalProbability ?? input.goalProbability,
      terminalAssetMedian: 100,
      terminalAssetP10: input.p10 ?? 50,
      terminalAssetP90: 150,
      shortfallProbability: 1 - (input.spendingProbability ?? input.goalProbability),
    },
  };
}

describe('RecommendationEngine', () => {
  test('Monte Carlo 검증 후보를 서로 다른 안정형·균형형·여유형으로 선택한다', () => {
    const candidates = [
      candidate({ id: 'stable', allocation: 'CONSERVATIVE', spending: 'FIXED', goalProbability: 0.8, survivalProbability: 0.99, p10: 90 }),
      candidate({ id: 'balanced', allocation: 'BALANCED', spending: 'FIXED', goalProbability: 0.95 }),
      candidate({ id: 'comfortable', allocation: 'GROWTH', spending: 'FRONT_LOADED', goalProbability: 0.9, spendingProbability: 0.97 }),
      candidate({ id: 'growth', allocation: 'GROWTH', spending: 'FIXED', goalProbability: 0.99 }),
    ];

    const result = new RecommendationEngine().recommend(candidates);

    expect(result.recommendations.map((item) => item.label)).toEqual(['안정형', '균형형', '여유형']);
    expect(result.recommendations.map((item) => item.candidate.candidate.id)).toEqual([
      'stable', 'balanced', 'comfortable',
    ]);
    expect(new Set(result.recommendations.map((item) => item.candidate.candidate.id)).size).toBe(3);
    expect(result.primary?.persona).toBe('BALANCED');
  });

  test('검증되지 않은 후보를 추천하거나 후보 수를 부풀리지 않는다', () => {
    const validated = candidate({
      id: 'validated', allocation: 'BALANCED', spending: 'FIXED', goalProbability: 0.9,
    });
    const unvalidated = { ...validated, candidate: { ...validated.candidate, id: 'unvalidated' } };
    delete unvalidated.monteCarlo;

    const result = new RecommendationEngine().recommend([validated, unvalidated]);

    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0].candidate.candidate.id).toBe('validated');
  });

  // C7: qualifies가 하드 필터가 된 뒤로, CONSERVATIVE + FRONT_LOADED 후보는 안정형과 여유형
  // 양쪽 조건을 동시에 만족한다. 그래서 `used` Set이 실제로 중재를 하게 됐는데, 기존 테스트
  // 입력(CONSERVATIVE/FIXED, GROWTH/FRONT_LOADED)은 애초에 겹칠 수 없어 이를 검증하지 못했다.
  test('두 페르소나 조건을 동시에 만족하는 후보를 중복 배정하지 않는다', () => {
    const dual = candidate({
      id: 'dual', allocation: 'CONSERVATIVE', spending: 'FRONT_LOADED', goalProbability: 0.9,
    });

    const result = new RecommendationEngine().recommend([dual]);

    const ids = result.recommendations.map((item) => item.candidate.candidate.id);
    expect(ids).toEqual(['dual']);
    // 배열 순서상 안정형이 먼저 선점한다. 여유형은 남은 후보가 없으므로 비어야 한다.
    expect(result.recommendations.map((item) => item.persona)).toEqual(['STABLE']);
  });

  test('겹치는 후보가 있어도 각 페르소나에는 서로 다른 후보가 간다', () => {
    const dual = candidate({
      id: 'dual', allocation: 'CONSERVATIVE', spending: 'FRONT_LOADED', goalProbability: 0.9,
    });
    const frontLoaded = candidate({
      id: 'front-loaded', allocation: 'GROWTH', spending: 'FRONT_LOADED', goalProbability: 0.8,
    });

    const result = new RecommendationEngine().recommend([dual, frontLoaded]);

    const ids = result.recommendations.map((item) => item.candidate.candidate.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(['dual', 'front-loaded']);
  });
});

/**
 * ☆추천 배지의 의미는 「목표를 지키면서 가장 확률 높은 안」이다.
 *
 * 예전에는 균형형 고정이었다. 그래서 화면에 안정형 70% / 균형형 47%가 나란히 찍힌 채
 * 47% 카드에 ☆이 붙었고, 사용자에게는 근거 없는 선택으로 보였다. 반대로 확률 최고만 고르면
 * 은퇴를 늦추고 보수적으로 굴리는 안이 구조적으로 거의 항상 이겨, 목표 기반 서비스가
 * 「목표를 포기하세요」를 기본값으로 내보내게 된다. 두 실패 사이를 가르는 것이 이 규칙이다.
 */
describe('primary 선정', () => {
  const engine = new RecommendationEngine();

  // **목표를 지킨 카드가 «균형형 카드가 아니어야» 이 테스트가 뜻을 갖는다.**
  //
  // 예전 규칙은 `find(persona === 'BALANCED')` 고정이었다. 목표를 지킨 카드가 균형형 자리에
  // 앉으면 옛 규칙도 같은 답을 내므로 두 가설이 갈리지 않는다. 그래서 균형형 자리에
  // «가장 높은 목표확률 + 목표 미달» 카드를 앉히고, 목표를 지킨 카드는 여유형 자리에 둔다.
  //
  // 여유형 자리에 앉히려면 «자격»과 «비교자»를 둘 다 맞춰야 한다: 여유형은 GROWTH +
  // FRONT_LOADED 후보만 받고(qualifies), 그중 spendingSuccessProbability로 고른다.
  // 하나라도 빠뜨리면 그 카드가 추천 목록에 아예 오르지 못해, 균형형 하나만 남은 목록에서
  // 「목표를 지킨 카드를 골랐다」를 검증할 수 없다.
  test('확률이 가장 높아도 상위 목표를 놓친 카드는 추천하지 않는다', () => {
    const goals = goalsOf('EARLY_RETIREMENT', 'ASSET_SURVIVAL');
    const candidates = [
      candidate({
        id: 'misses-goal', allocation: 'BALANCED', spending: 'FIXED',
        goalProbability: 0.7, spendingProbability: 0.2, survivalProbability: 0.99, p10: 90,
        goals, missed: ['EARLY_RETIREMENT'],
      }),
      candidate({
        id: 'keeps-goal', allocation: 'GROWTH', spending: 'FRONT_LOADED',
        goalProbability: 0.47, spendingProbability: 0.99,
        goals, missed: [],
      }),
    ];

    const result = engine.recommend(candidates, goals);

    expect(result.primary?.candidate.candidate.id).toBe('keeps-goal');
    // 전제 확인: 탈락한 쪽이 실제로 «균형형 자리»를 차지했고 목표확률도 더 높다.
    // 이 둘이 무너지면 위 단언은 옛 규칙과 구별되지 않는 채로 통과한다.
    expect(result.recommendations.find((item) => item.persona === 'BALANCED')?.candidate.candidate.id)
      .toBe('misses-goal');
  });

  test('모든 카드가 목표를 지키면 확률이 가장 높은 카드를 추천한다', () => {
    const goals = goalsOf('EARLY_RETIREMENT', 'ASSET_SURVIVAL');
    const candidates = [
      candidate({
        id: 'stable', allocation: 'CONSERVATIVE', spending: 'FIXED',
        goalProbability: 0.7, survivalProbability: 0.99, p10: 90, goals, missed: [],
      }),
      candidate({
        id: 'balanced', allocation: 'BALANCED', spending: 'FIXED',
        goalProbability: 0.47, goals, missed: [],
      }),
    ];

    const result = engine.recommend(candidates, goals);

    expect(result.primary?.candidate.candidate.id).toBe('stable');
    expect(result.primary?.persona).toBe('STABLE');
  });

  // 놓친 개수가 아니라 가중치 합으로 센다. 1순위 하나를 놓치는 것이 5순위 둘을 놓치는 것보다
  // 나쁘다는 판단은 weightedScore와 같은 가중치(N - priority + 1)에서 나온다.
  test('놓친 목표는 개수가 아니라 우선순위 가중치로 비교한다', () => {
    const goals = goalsOf('EARLY_RETIREMENT', 'ASSET_SURVIVAL', 'INHERITANCE');
    const candidates = [
      candidate({
        id: 'stable', allocation: 'CONSERVATIVE', spending: 'FIXED',
        goalProbability: 0.9, survivalProbability: 0.99, p10: 90,
        goals, missed: ['EARLY_RETIREMENT'], // 가중치 3
      }),
      candidate({
        id: 'balanced', allocation: 'BALANCED', spending: 'FIXED',
        goalProbability: 0.5, goals, missed: ['ASSET_SURVIVAL', 'INHERITANCE'], // 가중치 2+1=3
      }),
    ];

    const result = engine.recommend(candidates, goals);

    // 손실 가중치가 3으로 동률이므로 확률이 가른다.
    expect(result.primary?.candidate.candidate.id).toBe('stable');
  });

  // 위와 같은 이유로 «확률이 가장 높은 카드»를 균형형이 아닌 쪽에 둔다. 균형형에 최고
  // 확률을 주면 옛 「균형형 고정」 규칙도 같은 답을 내 이 단언이 아무것도 구별하지 못한다.
  test('선택한 목표가 없으면 확률이 가장 높은 카드를 추천한다', () => {
    const candidates = [
      candidate({
        id: 'stable', allocation: 'CONSERVATIVE', spending: 'FIXED',
        goalProbability: 0.8, survivalProbability: 0.99, p10: 90,
      }),
      candidate({
        id: 'balanced', allocation: 'BALANCED', spending: 'FIXED', goalProbability: 0.3,
      }),
    ];

    const result = engine.recommend(candidates, goalsOf());

    expect(result.primary?.candidate.candidate.id).toBe('stable');
  });

  // 모든 키가 동률일 때 승자를 후보 id 알파벳 순으로 정하지 않는다는 회귀 테스트.
  test('완전 동률이면 균형형을 기본값으로 유지한다', () => {
    const candidates = [
      candidate({ id: 'aaa-stable', allocation: 'CONSERVATIVE', spending: 'FIXED', goalProbability: 0.6 }),
      candidate({ id: 'zzz-balanced', allocation: 'BALANCED', spending: 'FIXED', goalProbability: 0.6 }),
    ];

    const result = engine.recommend(candidates, goalsOf());

    expect(result.primary?.persona).toBe('BALANCED');
  });

  // goals를 넘기지 않는 경로는 「선택한 목표가 없다」와 같게 다룬다. 목표를 모르는데
  // 「목표를 지킨 카드」를 가려낼 수는 없으므로, 남는 기준은 확률뿐이다.
  test('goals 없이 호출하면 목표 미선택과 같게 확률로 고른다', () => {
    const candidates = [
      candidate({ id: 'stable', allocation: 'CONSERVATIVE', spending: 'FIXED', goalProbability: 0.9, survivalProbability: 0.99 }),
      candidate({ id: 'balanced', allocation: 'BALANCED', spending: 'FIXED', goalProbability: 0.4 }),
    ];

    const result = engine.recommend(candidates);

    expect(result.primary?.candidate.candidate.id).toBe('stable');
  });
});

// 국민연금 200만원만 있고 자산이 없는 계획에서 실제로 나온 화면: 균형형·여유형 두 장이
// 나란히 0%로, 생활비와 예상 잔여자산까지 같은 값으로 표시됐다. 그 상태에서 순서를 정한 것은
// 비교자가 아니라 id 알파벳 순이었고, 앞선 카드에는 ☆추천까지 붙었다.
describe('noRecommendationReachesGoal', () => {
  const recommend = (candidates: RankedStrategyCandidate[]) =>
    new RecommendationEngine().recommend(candidates).recommendations;

  test('모든 추천이 0%면 도달하지 못한 것으로 본다', () => {
    const recommendations = recommend([
      candidate({ id: 'balanced', allocation: 'BALANCED', spending: 'FIXED', goalProbability: 0 }),
      candidate({ id: 'comfortable', allocation: 'BALANCED', spending: 'FRONT_LOADED', goalProbability: 0 }),
    ]);

    expect(recommendations).toHaveLength(2);
    expect(noRecommendationReachesGoal(recommendations)).toBe(true);
  });

  test('하나라도 0%를 넘으면 고를 이유가 있으므로 도달 불가가 아니다', () => {
    const recommendations = recommend([
      candidate({ id: 'balanced', allocation: 'BALANCED', spending: 'FIXED', goalProbability: 0 }),
      candidate({ id: 'comfortable', allocation: 'BALANCED', spending: 'FRONT_LOADED', goalProbability: 0.01 }),
    ]);

    expect(noRecommendationReachesGoal(recommendations)).toBe(false);
  });

  // 「도달하지 못했다」와 「추천이 없다」는 사용자가 할 일이 다른 사건이다. 빈 배열을 true로
  // 두면 no_persona_matched·no_candidate_survived가 설명하던 원인이 0% 문구로 덮인다.
  test('추천이 없는 것은 도달 불가와 다른 사건이다', () => {
    expect(noRecommendationReachesGoal([])).toBe(false);
  });
});
