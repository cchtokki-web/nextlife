import { describe, expect, test } from 'vitest';
import { RecommendationEngine, improvesOnCurrentPlan, noRecommendationReachesGoal } from '@/core/recommendation/RecommendationEngine';
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
  spending: 'FIXED' | 'FRONT_LOADED' | 'CARE_HEAVY';
  goalProbability: number;
  retirementAge?: number;
  nationalPensionStartAge?: number;
  bridgeShortfallByAge?: readonly { age: number; unmetSpending: number }[];
  spendingProbability?: number;
  survivalProbability?: number;
  averageFulfillment?: number;
  terminalMedian?: number;
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
        retirementAge: input.retirementAge ?? domain.strategy.retirementAge,
        nationalPensionTiming: (input.nationalPensionStartAge ?? 65) < 65 ? 'EARLY' : 'NORMAL',
        nationalPensionStartAge: input.nationalPensionStartAge ?? 65,
        withdrawalPolicy: 'GENERAL_FIRST',
        spendingPattern: input.spending,
      },
    },
    simulation: {
      yearlyResults: (input.bridgeShortfallByAge ?? []) as RankedStrategyCandidate['simulation']['yearlyResults'],
      depletionAge: null,
      endingAssets: 100,
    },
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
      ...(input.averageFulfillment === undefined
        ? {}
        : { averageSpendingFulfillmentRate: input.averageFulfillment }),
      terminalAssetMedian: input.terminalMedian ?? 100,
      terminalAssetP10: input.p10 ?? 50,
      terminalAssetP90: 150,
      shortfallProbability: 1 - (input.spendingProbability ?? input.goalProbability),
    },
  };
}

describe('RecommendationEngine', () => {
  test('Monte Carlo 검증 후보를 서로 다른 안정형·균형형·여유형으로 선택한다', () => {
    const candidates = [
      candidate({ id: 'defensive', spending: 'FIXED', goalProbability: 0.8, survivalProbability: 0.99, p10: 90 }),
      candidate({ id: 'middling', spending: 'FIXED', goalProbability: 0.95 }),
      candidate({ id: 'front-loaded', spending: 'FRONT_LOADED', goalProbability: 0.9, spendingProbability: 0.97 }),
      candidate({ id: 'highest-probability', spending: 'FIXED', goalProbability: 0.99 }),
    ];

    const result = new RecommendationEngine().recommend(candidates);

    expect(result.recommendations.map((item) => item.label)).toEqual(['안정형', '균형형', '여유형']);
    // 안정형은 자산 존속확률·하위 10% 잔여자산이 가장 높은 안, 균형형은 남은 것 중 목표
    // 달성확률이 가장 높은 안, 여유형은 다시 남은 것 중 은퇴초기 집중형이다.
    expect(result.recommendations.map((item) => item.candidate.candidate.id)).toEqual([
      'defensive', 'highest-probability', 'front-loaded',
    ]);
    expect(new Set(result.recommendations.map((item) => item.candidate.candidate.id)).size).toBe(3);
    expect(result.primary?.persona).toBe('BALANCED');
  });

  test('검증되지 않은 후보를 추천하거나 후보 수를 부풀리지 않는다', () => {
    const validated = candidate({
      id: 'validated', spending: 'FIXED', goalProbability: 0.9,
    });
    const unvalidated = { ...validated, candidate: { ...validated.candidate, id: 'unvalidated' } };
    delete unvalidated.monteCarlo;

    const result = new RecommendationEngine().recommend([validated, unvalidated]);

    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0].candidate.candidate.id).toBe('validated');
  });

  test('정상 개시 대안이 60~64세 생활비 공백을 충당하면 조기수령안을 추천하지 않는다', () => {
    const bridgeYears = Array.from({ length: 5 }, (_, index) => ({
      age: 60 + index,
      unmetSpending: 0,
    }));
    const early = candidate({
      id: 'early-60',
      spending: 'FIXED',
      goalProbability: 0.99,
      retirementAge: 60,
      nationalPensionStartAge: 60,
      bridgeShortfallByAge: bridgeYears,
    });
    const normal = candidate({
      id: 'normal-65',
      spending: 'FIXED',
      goalProbability: 0.9,
      retirementAge: 60,
      nationalPensionStartAge: 65,
      bridgeShortfallByAge: bridgeYears,
    });

    const result = new RecommendationEngine().recommend([early, normal]);

    expect(result.recommendations.map((item) => item.candidate.candidate.id)).not.toContain('early-60');
  });

  test('정상 개시안에 은퇴 전 연금 공백 부족액이 있고 조기안이 줄일 때만 조기수령을 추천한다', () => {
    const noShortfall = Array.from({ length: 5 }, (_, index) => ({
      age: 60 + index,
      unmetSpending: 0,
    }));
    const normalShortfall = noShortfall.map((year) => ({
      ...year,
      unmetSpending: 1_000_000,
    }));
    const early = candidate({
      id: 'early-60',
      spending: 'FIXED',
      goalProbability: 0.98,
      retirementAge: 60,
      nationalPensionStartAge: 60,
      bridgeShortfallByAge: noShortfall,
    });
    const normal = candidate({
      id: 'normal-65',
      spending: 'FIXED',
      goalProbability: 0.8,
      retirementAge: 60,
      nationalPensionStartAge: 65,
      bridgeShortfallByAge: normalShortfall,
    });

    const result = new RecommendationEngine().recommend([early, normal]);

    expect(result.recommendations.map((item) => item.candidate.candidate.id)).toContain('early-60');
  });

  test('정상 개시 비교안이나 완전한 공백 원장이 없으면 조기수령 필요성을 추정하지 않는다', () => {
    const earlyWithoutPeer = candidate({
      id: 'early-without-peer',
      spending: 'FIXED',
      goalProbability: 0.99,
      retirementAge: 60,
      nationalPensionStartAge: 60,
      bridgeShortfallByAge: Array.from({ length: 5 }, (_, index) => ({
        age: 60 + index,
        unmetSpending: 1_000_000,
      })),
    });
    const earlyWithoutLedger = candidate({
      id: 'early-without-ledger',
      spending: 'FRONT_LOADED',
      goalProbability: 0.99,
      retirementAge: 60,
      nationalPensionStartAge: 60,
    });
    const normalWithoutLedger = candidate({
      id: 'normal-without-ledger',
      spending: 'FRONT_LOADED',
      goalProbability: 0.8,
      retirementAge: 60,
      nationalPensionStartAge: 65,
    });

    const result = new RecommendationEngine().recommend([
      earlyWithoutPeer,
      earlyWithoutLedger,
      normalWithoutLedger,
    ]);

    expect(result.recommendations.map((item) => item.candidate.candidate.id))
      .not.toContain('early-without-peer');
    expect(result.recommendations.map((item) => item.candidate.candidate.id))
      .not.toContain('early-without-ledger');
  });

  // C7: 안정형·균형형은 자격 조건 없이 비교자만으로 정의되므로, 어떤 후보든 세 페르소나
  // 중 둘 이상의 조건을 동시에 만족한다. 그래서 `used` Set이 실제로 중재를 한다.
  test('두 페르소나 조건을 동시에 만족하는 후보를 중복 배정하지 않는다', () => {
    const dual = candidate({
      id: 'dual', spending: 'FRONT_LOADED', goalProbability: 0.9,
    });

    const result = new RecommendationEngine().recommend([dual]);

    const ids = result.recommendations.map((item) => item.candidate.candidate.id);
    expect(ids).toEqual(['dual']);
    // 배열 순서상 안정형이 먼저 선점한다. 여유형은 남은 후보가 없으므로 비어야 한다.
    expect(result.recommendations.map((item) => item.persona)).toEqual(['STABLE']);
  });

  test('겹치는 후보가 있어도 각 페르소나에는 서로 다른 후보가 간다', () => {
    const dual = candidate({
      id: 'dual', spending: 'FRONT_LOADED', goalProbability: 0.9,
    });
    const frontLoaded = candidate({
      id: 'front-loaded', spending: 'FRONT_LOADED', goalProbability: 0.8,
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
  // «가장 높은 목표확률 + 목표 미달» 카드를 앉히고, 목표를 지킨 카드는 안정형 자리에 둔다.
  //
  // 안정형 자리에 앉히려면 그 비교자의 첫 키를 이겨야 한다 — 자산 존속확률이다. 균형형은
  // 남은 후보 중 목표 달성확률이 가장 높은 것을 가져가므로, 목표를 놓친 쪽이 그 자리에 온다.
  test('확률이 가장 높아도 상위 목표를 놓친 카드는 추천하지 않는다', () => {
    const goals = goalsOf('EARLY_RETIREMENT', 'ASSET_SURVIVAL');
    const candidates = [
      candidate({
        id: 'misses-goal', spending: 'FIXED',
        goalProbability: 0.7, spendingProbability: 0.2, survivalProbability: 0.5, p10: 50,
        goals, missed: ['EARLY_RETIREMENT'],
      }),
      candidate({
        id: 'keeps-goal', spending: 'FIXED',
        goalProbability: 0.47, spendingProbability: 0.99, survivalProbability: 0.99, p10: 90,
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
        id: 'stable', spending: 'FIXED',
        goalProbability: 0.7, survivalProbability: 0.99, p10: 90, goals, missed: [],
      }),
      candidate({
        id: 'balanced', spending: 'FIXED',
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
        id: 'stable', spending: 'FIXED',
        goalProbability: 0.9, survivalProbability: 0.99, p10: 90,
        goals, missed: ['EARLY_RETIREMENT'], // 가중치 3
      }),
      candidate({
        id: 'balanced', spending: 'FIXED',
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
        id: 'stable', spending: 'FIXED',
        goalProbability: 0.8, survivalProbability: 0.99, p10: 90,
      }),
      candidate({
        id: 'balanced', spending: 'FIXED', goalProbability: 0.3,
      }),
    ];

    const result = engine.recommend(candidates, goalsOf());

    expect(result.primary?.candidate.candidate.id).toBe('stable');
  });

  // 모든 키가 동률일 때 승자를 후보 id 알파벳 순으로 정하지 않는다는 회귀 테스트.
  test('완전 동률이면 균형형을 기본값으로 유지한다', () => {
    const candidates = [
      candidate({ id: 'aaa-stable', spending: 'FIXED', goalProbability: 0.6 }),
      candidate({ id: 'zzz-balanced', spending: 'FIXED', goalProbability: 0.6 }),
    ];

    const result = engine.recommend(candidates, goalsOf());

    expect(result.primary?.persona).toBe('BALANCED');
  });

  // P2-4. 「단순히 성공률 최고」를 그만두었다는 것을 «구별 가능하게» 고정한다.
  //
  // 목표 달성 확률만 보면 sharp-drop(0.62)이 이기지만, 그 계획은 실패할 때 크게 무너지고
  // (평균 충족도 0.55) 자산도 자주 바닥나며(0.40) 잔여자산도 적다. steady는 확률이 4%p 낮은
  // 대신 세 축 모두에서 앞선다. 종합 점수(PRIMARY_SELECTION_WEIGHTS)는 steady를 고른다.
  //
  // 두 카드 모두 목표를 하나도 놓치지 않아 첫 키(missed)는 동률이다 — 그래야 이 단언이
  // 종합 점수만을 재는 것이 된다.
  test('확률이 조금 낮아도 충족도·자산 유지·잔여자산이 앞서면 그쪽을 추천한다', () => {
    const goals = goalsOf('EARLY_RETIREMENT', 'ASSET_SURVIVAL');
    const candidates = [
      candidate({
        id: 'sharp-drop', spending: 'FIXED',
        goalProbability: 0.62, spendingProbability: 0.62, survivalProbability: 0.40,
        averageFulfillment: 0.55, terminalMedian: 20, p10: 0,
        goals, missed: [],
      }),
      candidate({
        id: 'steady', spending: 'FIXED',
        goalProbability: 0.58, spendingProbability: 0.58, survivalProbability: 0.95,
        averageFulfillment: 0.97, terminalMedian: 100, p10: 60,
        goals, missed: [],
      }),
    ];

    const result = engine.recommend(candidates, goals);

    expect(result.primary?.candidate.candidate.id).toBe('steady');
    // 전제 확인: 확률«만» 보면 반대 답이 나온다. 이것이 무너지면 위 단언은 옛 규칙과
    // 구별되지 않은 채 통과한다.
    const byProbability = [...candidates]
      .sort((a, b) => b.monteCarlo!.goalSuccessProbability - a.monteCarlo!.goalSuccessProbability)[0];
    expect(byProbability.candidate.id).toBe('sharp-drop');
  });

  // 반대 방향. 확률 격차가 충분히 크면 나머지 축이 조금 앞서도 뒤집히지 않는다 —
  // 목표 달성 확률은 사용자가 «고른 목표 전체»를 판정한 유일한 값이라 가장 무겁다.
  test('확률 격차가 크면 나머지 지표가 조금 앞서도 뒤집지 않는다', () => {
    const goals = goalsOf('EARLY_RETIREMENT');
    const candidates = [
      candidate({
        id: 'high-probability', spending: 'FIXED',
        goalProbability: 0.90, spendingProbability: 0.90, survivalProbability: 0.90,
        averageFulfillment: 0.98, terminalMedian: 90, p10: 60,
        goals, missed: [],
      }),
      candidate({
        id: 'slightly-safer', spending: 'FIXED',
        goalProbability: 0.40, spendingProbability: 0.40, survivalProbability: 0.95,
        averageFulfillment: 0.99, terminalMedian: 100, p10: 70,
        goals, missed: [],
      }),
    ];

    expect(engine.recommend(candidates, goals).primary?.candidate.candidate.id)
      .toBe('high-probability');
  });

  // goals를 넘기지 않는 경로는 「선택한 목표가 없다」와 같게 다룬다. 목표를 모르는데
  // 「목표를 지킨 카드」를 가려낼 수는 없으므로, 남는 기준은 확률뿐이다.
  test('goals 없이 호출하면 목표 미선택과 같게 확률로 고른다', () => {
    const candidates = [
      candidate({ id: 'stable', spending: 'FIXED', goalProbability: 0.9, survivalProbability: 0.99 }),
      candidate({ id: 'balanced', spending: 'FIXED', goalProbability: 0.4 }),
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
      candidate({ id: 'balanced', spending: 'FIXED', goalProbability: 0 }),
      candidate({ id: 'comfortable', spending: 'FRONT_LOADED', goalProbability: 0 }),
    ]);

    expect(recommendations).toHaveLength(2);
    expect(noRecommendationReachesGoal(recommendations)).toBe(true);
  });

  test('하나라도 0%를 넘으면 고를 이유가 있으므로 도달 불가가 아니다', () => {
    const recommendations = recommend([
      candidate({ id: 'balanced', spending: 'FIXED', goalProbability: 0 }),
      candidate({ id: 'comfortable', spending: 'FRONT_LOADED', goalProbability: 0.01 }),
    ]);

    expect(noRecommendationReachesGoal(recommendations)).toBe(false);
  });

  // 「도달하지 못했다」와 「추천이 없다」는 사용자가 할 일이 다른 사건이다. 빈 배열을 true로
  // 두면 no_persona_matched·no_candidate_survived가 설명하던 원인이 0% 문구로 덮인다.
  test('추천이 없는 것은 도달 불가와 다른 사건이다', () => {
    expect(noRecommendationReachesGoal([])).toBe(false);
  });
});

// **추천이 현재 계획보다 나쁠 수 있다.** 세 카드는 「더 나은가」가 아니라 「무엇을 가장 잘
// 하는가」로 뽑히기 때문이다(RECOMMENDATION_PERSONAS의 qualifies·compare). 여유형에는 은퇴초기
// 집중형만 오를 수 있고 안정형·균형형은 각자의 비교자 1등을 가져가므로, 평탄한 계획을 쓰는
// 사용자에게도 카드는 정의상 «변경»을 제안한다 — 그 변경이 이득인지는 선정 기준이 아니다.
//
// 그래서 개선 여부는 별도로 판정한다. 규칙을 한 곳에 두어야 ☆배지·경고 배너·카드의 증감
// 표시가 같은 답을 말한다.
describe('improvesOnCurrentPlan', () => {
  const withProbability = (goalProbability: number) =>
    candidate({ id: `c-${goalProbability}`, spending: 'FIXED', goalProbability });

  test('현재 계획보다 확률이 높아야 개선이다', () => {
    expect(improvesOnCurrentPlan(withProbability(0.7), 0.67)).toBe(true);
    expect(improvesOnCurrentPlan(withProbability(0.55), 0.67)).toBe(false);
  });

  // 같으면 바꿀 이유가 없다. 「변경 없음」과 「같은 결과를 위한 변경」 중 후자를 권하면
  // 사용자는 이득 없는 조작을 하게 된다.
  test('같은 확률은 개선이 아니다', () => {
    expect(improvesOnCurrentPlan(withProbability(0.67), 0.67)).toBe(false);
  });

  // 현재 확률을 모르는 상태(몬테카를로 미완료)에서 「개선이 아니다」라고 하면, 측정되지 않은
  // 것이 나쁜 것으로 둔갑한다. 판정하지 않고 종전 동작을 유지한다.
  test('현재 확률을 모르면 판정하지 않는다', () => {
    expect(improvesOnCurrentPlan(withProbability(0.1), undefined)).toBe(true);
  });
});
