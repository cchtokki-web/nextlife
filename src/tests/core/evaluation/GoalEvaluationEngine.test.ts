import { describe, expect, test } from 'vitest';
import { LegacySimulationAdapter } from '@/core/domain/input/LegacySimulationAdapter';
import { DefaultGoalEvaluationEngine } from '@/core/evaluation/GoalEvaluationEngine';
import { LegacySimulationEngine } from '@/core/simulation/LegacySimulationEngine';
import { initialParams } from '@/infrastructure/storage/localStore';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { compileStrategy, DEFAULT_RETIREMENT_STRATEGY } from '@/core/usecases/strategy/compileStrategy';
import { allAxesLiveParams } from '@/tests/fixtures/allAxesLiveParams';

describe('DefaultGoalEvaluationEngine', () => {
  test('목표별 달성도를 반환하고 정량 HARD 목표 위반을 점수와 분리한다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    input.goals.selectedGoals = [
      { type: 'ASSET_SURVIVAL', priority: 1, constraintType: 'HARD' },
      { type: 'INHERITANCE', priority: 2, constraintType: 'HARD', targetValue: 1_000_000_000, targetValueSource: 'user' },
      { type: 'LIVING_EXPENSE_STABILITY', priority: 3, constraintType: 'HARD' },
    ];
    const simulated = new LegacySimulationEngine().simulate(input.profile, input.strategy);
    const firstRetirementYear = simulated.yearlyResults.findIndex(
      (year) => year.age >= input.strategy.retirementAge,
    );
    const result = {
      ...simulated,
      depletionAge: input.strategy.planHorizonAge - 1,
      endingAssets: 0,
      yearlyResults: simulated.yearlyResults.map((year, index) =>
        index === firstRetirementYear ? { ...year, shortfall: 1, unmetSpending: 1 } : year
      ),
    };

    const evaluated = new DefaultGoalEvaluationEngine().evaluate(
      input.profile,
      input.goals,
      input.strategy,
      result,
    );

    expect(evaluated.hardConstraintsSatisfied).toBe(false);
    expect(evaluated.goalEvaluations.map((goal) => goal.goalType)).toEqual([
      'ASSET_SURVIVAL',
      'INHERITANCE',
      'LIVING_EXPENSE_STABILITY',
    ]);
    expect(evaluated.goalEvaluations.every((goal) =>
      goal.score >= 0 && goal.score <= 100 && typeof goal.reason === 'string'
    )).toBe(true);
    expect(evaluated.score).toBe(evaluated.utility.score);
    expect(evaluated.weightedScore).toBeGreaterThanOrEqual(0);
    expect(evaluated.hardConstraintFailures.map((failure) => failure.code)).toEqual([
      'HARD_ASSET_SURVIVAL',
      'HARD_MINIMUM_ENDING_ASSETS',
      'HARD_SPENDING_SHORTFALL',
    ]);
  });

  test('현재 모델로 정량 판정할 수 없는 HARD 목표는 통과로 꾸미지 않고 노출한다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    input.goals.selectedGoals = [
      { type: 'HOUSING_STABILITY', priority: 1, constraintType: 'HARD' },
    ];
    const result = new LegacySimulationEngine().simulate(input.profile, input.strategy);

    const evaluated = new DefaultGoalEvaluationEngine().evaluate(
      input.profile,
      input.goals,
      input.strategy,
      result,
    );

    expect(evaluated.hardConstraintFailures).toEqual([]);
    expect(evaluated.unsupportedHardGoals).toEqual(['HOUSING_STABILITY']);
    expect(evaluated.hardConstraintsSatisfied).toBe(true);
    expect(evaluated.goalEvaluations).toEqual([{
      goalType: 'HOUSING_STABILITY',
      score: 0,
      achieved: false,
      // 정량화할 수 없는 목표는 단위 없는 측정치를 갖는다.
      measurement: { unit: 'NONE' },
      reason: '현재 프로필과 시뮬레이션 결과에 주거 안정을 정량화할 정보가 없습니다.',
    }]);
  });

  test('HARD 은퇴 나이는 점수 감점이 아니라 전략 탈락으로 표시한다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    input.goals.selectedGoals = [{
      type: 'EARLY_RETIREMENT', priority: 1, constraintType: 'HARD', targetValue: 60,
    }];
    input.strategy.retirementAge = 61;
    const result = new LegacySimulationEngine().simulate(input.profile, input.strategy);

    const evaluated = new DefaultGoalEvaluationEngine().evaluate(
      input.profile,
      input.goals,
      input.strategy,
      result,
    );

    expect(evaluated.goalEvaluations[0]).toMatchObject({
      goalType: 'EARLY_RETIREMENT',
      score: 98,
      achieved: false,
      // 61과 60은 나이다. 단위가 타입에 드러나므로 표시 계층이 goalType으로 추측하지 않는다.
      measurement: { unit: 'AGE', actual: 61, target: 60 },
    });
    expect(evaluated.hardConstraintsSatisfied).toBe(false);
    expect(evaluated.hardConstraintFailures).toEqual([expect.objectContaining({
      code: 'HARD_RETIREMENT_AGE',
      goalType: 'EARLY_RETIREMENT',
    })]);
  });

  test('우선순위가 높은 목표에 더 큰 가중치를 주어 종합 적합도를 계산한다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    input.goals.selectedGoals = [
      { type: 'EARLY_RETIREMENT', priority: 1, constraintType: 'SOFT', targetValue: 60 },
      { type: 'TAX_OPTIMIZATION', priority: 2, constraintType: 'SOFT' },
    ];
    input.strategy.retirementAge = 60;
    const result = new LegacySimulationEngine().simulate(input.profile, input.strategy);

    const evaluated = new DefaultGoalEvaluationEngine().evaluate(
      input.profile,
      input.goals,
      input.strategy,
      result,
    );
    const [retirement, tax] = evaluated.goalEvaluations;

    expect(retirement.score).toBe(100);
    expect(evaluated.weightedScore).toBe(Math.round((retirement.score * 2 + tax.score) / 3));
  });

  test('서로 다른 소비 목표를 각 목표 금액으로 평가하고 HARD 미달을 탈락 처리한다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    input.strategy.targetMonthlySpending = 3_000_000;
    input.goals.selectedGoals = [
      {
        type: 'LIVING_EXPENSE_STABILITY',
        priority: 1,
        constraintType: 'SOFT',
        targetValue: 3_000_000,
        targetValueSource: 'user',
      },
      {
        type: 'COMFORTABLE_SPENDING',
        priority: 2,
        constraintType: 'HARD',
        targetValue: 5_000_000,
        targetValueSource: 'user',
      },
    ];
    const result = new LegacySimulationEngine().simulate(input.profile, input.strategy);

    const evaluated = new DefaultGoalEvaluationEngine().evaluate(
      input.profile,
      input.goals,
      input.strategy,
      result,
    );
    const [stability, comfortable] = evaluated.goalEvaluations;

    // 생활비 목표치는 월 금액이다(나이나 총액이 아니다).
    expect(stability).toMatchObject({
      achieved: true, score: 100,
      measurement: { unit: 'MONTHLY_MONEY', target: 3_000_000 },
    });
    expect(comfortable).toMatchObject({
      achieved: false,
      measurement: { unit: 'MONTHLY_MONEY', target: 5_000_000 },
    });
    expect(comfortable.score).toBeLessThan(100);
    expect(evaluated.hardConstraintsSatisfied).toBe(false);
    expect(evaluated.hardConstraintFailures).toEqual([expect.objectContaining({
      code: 'HARD_SPENDING_SHORTFALL',
      goalType: 'COMFORTABLE_SPENDING',
    })]);
  });

  test('전략 소비보다 낮은 개별 HARD 목표는 전략 부족 원장과 분리해 판정한다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    input.strategy.targetMonthlySpending = 5_000_000;
    input.goals.selectedGoals = [{
      type: 'LIVING_EXPENSE_STABILITY',
      priority: 1,
      constraintType: 'HARD',
      targetValue: 3_000_000,
      targetValueSource: 'user',
    }];
    const simulated = new LegacySimulationEngine().simulate(input.profile, input.strategy);
    const firstRetirementYear = simulated.yearlyResults.findIndex(
      (year) => year.age >= input.strategy.retirementAge,
    );
    const result = {
      ...simulated,
      yearlyResults: simulated.yearlyResults.map((year, index) =>
        year.age >= input.strategy.retirementAge
          ? {
              ...year,
              spending: 4_000_000 * 12 + year.healthcareSpending,
              actualSpending: 4_000_000 * 12 + year.healthcareSpending,
              unmetSpending: index === firstRetirementYear ? 1 : 0,
              shortfall: index === firstRetirementYear ? 1 : 0,
            }
          : year),
    };

    const evaluated = new DefaultGoalEvaluationEngine().evaluate(
      input.profile,
      input.goals,
      input.strategy,
      result,
    );

    expect(evaluated.goalEvaluations[0]).toMatchObject({
      achieved: true,
      score: 100,
      measurement: { unit: 'MONTHLY_MONEY', target: 3_000_000 },
    });
    expect(evaluated.hardConstraintsSatisfied).toBe(true);
    expect(evaluated.hardConstraintFailures).toEqual([]);
  });
});

describe('DefaultGoalEvaluationEngine 회귀', () => {
  test('은퇴 시점 이후 결과가 없으면 ASSET_GROWTH를 만점으로 처리하지 않는다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    input.goals.selectedGoals = [{ type: 'ASSET_GROWTH', priority: 1, constraintType: 'SOFT' }];
    const simulated = new LegacySimulationEngine().simulate(input.profile, input.strategy);
    // 은퇴 나이 이후 연도가 하나도 없는 결과. 예전에는 비교 기준이 0으로 무너져
    // "기말 자산이 은퇴 시점 자산 이상으로 유지됩니다"와 100점이 함께 나왔다.
    const result = {
      ...simulated,
      yearlyResults: simulated.yearlyResults.filter(
        (year) => year.age < input.strategy.retirementAge,
      ),
    };

    const evaluated = new DefaultGoalEvaluationEngine().evaluate(
      input.profile,
      input.goals,
      input.strategy,
      result,
    );

    const growth = evaluated.goalEvaluations.find((item) => item.goalType === 'ASSET_GROWTH');
    expect(growth?.score).toBe(0);
    expect(growth?.achieved).toBe(false);
    expect(growth?.reason).toContain('평가할 수 없습니다');
  });

  test('사전/사후 HARD 은퇴나이 판정이 같은 규칙을 쓴다', async () => {
    const { retirementAgeHardFailure } = await import('@/core/evaluation/GoalEvaluationEngine');
    const { HardConstraintFilter } = await import('@/core/strategy/HardConstraintFilter');
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    const goal = {
      type: 'EARLY_RETIREMENT' as const, priority: 1, constraintType: 'HARD' as const, targetValue: 55,
    };
    input.goals.selectedGoals = [goal];

    const candidate = {
      id: 'late',
      strategy: { ...input.strategy, retirementAge: 62 },
      dimensions: {
        retirementAge: 62,
        nationalPensionTiming: 'NORMAL' as const,
        nationalPensionStartAge: 65,
        withdrawalPolicy: 'GENERAL_FIRST' as const,
        spendingPattern: 'FIXED' as const,
      },
    };

    const preSimulation = new HardConstraintFilter().beforeSimulation(candidate, input.goals);
    expect(preSimulation).toEqual([retirementAgeHardFailure(62, goal)]);
    // 경계값도 양쪽이 같아야 한다. 한쪽만 > 를 >= 로 바꾸면 후보가 사전에는 잘리고
    // 사후에는 통과하는(또는 그 반대) 상태가 조용히 생긴다.
    expect(new HardConstraintFilter().beforeSimulation(
      { ...candidate, strategy: { ...input.strategy, retirementAge: 55 } },
      input.goals,
    )).toEqual([]);
    expect(retirementAgeHardFailure(55, goal)).toBeNull();
  });
});

// 목표 유형별 측정 단위 계약. 이 표가 깨지면 표시 계층이 나이를 금액으로(또는 그 반대로)
// 렌더링하게 되므로, 개별 테스트가 아니라 전 유형을 한 번에 고정한다.
describe('GoalMeasurement 단위 계약', () => {
  const EXPECTED_UNIT: Record<string, string> = {
    EARLY_RETIREMENT: 'AGE',
    ASSET_SURVIVAL: 'AGE',
    LIVING_EXPENSE_STABILITY: 'MONTHLY_MONEY',
    COMFORTABLE_SPENDING: 'MONTHLY_MONEY',
    INHERITANCE: 'MONEY',
    ASSET_GROWTH: 'MONEY',
    PENSION_OPTIMIZATION: 'NONE',
    TAX_OPTIMIZATION: 'NONE',
    RISK_REDUCTION: 'NONE',
    HOUSING_STABILITY: 'NONE',
  };

  test.each(Object.entries(EXPECTED_UNIT))('%s 목표는 %s 단위로 측정된다', (goalType, unit) => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    input.goals.selectedGoals = [{
      type: goalType as never,
      priority: 1,
      constraintType: 'SOFT',
      // 나이 목표와 금액 목표가 같은 필드를 쓰던 것이 바로 이 변경의 이유다.
      ...(goalType === 'EARLY_RETIREMENT' ? { targetValue: 62 } : {}),
      ...(goalType === 'INHERITANCE' || goalType === 'ASSET_GROWTH'
        ? { targetValue: 100_000_000 } : {}),
      ...(goalType === 'LIVING_EXPENSE_STABILITY' || goalType === 'COMFORTABLE_SPENDING'
        ? { targetValue: 3_000_000 } : {}),
    }];
    const result = new LegacySimulationEngine().simulate(input.profile, input.strategy);

    const evaluated = new DefaultGoalEvaluationEngine()
      .evaluate(input.profile, input.goals, input.strategy, result);

    expect(evaluated.goalEvaluations[0].measurement.unit).toBe(unit);
  });

  test('NONE 단위에는 수치가 실리지 않는다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    input.goals.selectedGoals = [{ type: 'TAX_OPTIMIZATION', priority: 1, constraintType: 'SOFT' }];
    const result = new LegacySimulationEngine().simulate(input.profile, input.strategy);

    const evaluated = new DefaultGoalEvaluationEngine()
      .evaluate(input.profile, input.goals, input.strategy, result);

    expect(evaluated.goalEvaluations[0].measurement).toEqual({ unit: 'NONE' });
  });
});

// C4: clampScore가 비유한 값에서 예외를 던지는지. 이 가드가 `return 0`으로 바뀌어도
// 1892개 테스트가 전부 통과했다. NaN 점수는 랭킹 비교자에 들어가 정렬을 임의로 만들고,
// 그래도 소비자는 0번 후보를 "당신에게 최적"으로 표시한다 — 조용한 오염이다.
describe('점수 가드', () => {
  test('시뮬레이션 결과가 비유한 값이면 점수를 만들지 않고 예외를 던진다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    input.goals.selectedGoals = [{
      type: 'INHERITANCE', priority: 1, constraintType: 'SOFT', targetValue: 100_000_000, targetValueSource: 'user',
    }];
    const simulated = new LegacySimulationEngine().simulate(input.profile, input.strategy);

    for (const broken of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => new DefaultGoalEvaluationEngine().evaluate(
        input.profile,
        input.goals,
        input.strategy,
        { ...simulated, endingAssets: broken },
      )).toThrow(/finite/);
    }
  });
});

// 빈 projection은 실제 평가기에 한 번도 들어간 적이 없었다. 각 평가 함수가 빈 배열에서
// 무엇을 하는지가 명세되어 있지 않으면, 조용히 만점을 주거나 예외를 던지거나 둘 중 하나다.
describe('빈 시뮬레이션 결과', () => {
  test('연도 결과가 비어도 목표를 달성으로 꾸미지 않는다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    input.goals.selectedGoals = [
      { type: 'LIVING_EXPENSE_STABILITY', priority: 1, constraintType: 'SOFT' },
      { type: 'ASSET_SURVIVAL', priority: 2, constraintType: 'SOFT' },
      { type: 'ASSET_GROWTH', priority: 3, constraintType: 'SOFT' },
    ];

    const evaluated = new DefaultGoalEvaluationEngine().evaluate(
      input.profile,
      input.goals,
      input.strategy,
      { yearlyResults: [], depletionAge: null, endingAssets: 0 },
    );

    const byType = new Map(evaluated.goalEvaluations.map((item) => [item.goalType, item]));
    // 생활비: 은퇴 기간 결과가 없으므로 달성으로 볼 수 없다.
    expect(byType.get('LIVING_EXPENSE_STABILITY')?.achieved).toBe(false);
    // 자산 성장: 비교 기준(은퇴 시점 자산)이 없으므로 평가 불가여야 한다.
    expect(byType.get('ASSET_GROWTH')?.achieved).toBe(false);
    expect(byType.get('ASSET_GROWTH')?.score).toBe(0);
    // 모든 점수는 유한하고 0~100 범위여야 한다.
    for (const item of evaluated.goalEvaluations) {
      expect(Number.isFinite(item.score)).toBe(true);
      expect(item.score).toBeGreaterThanOrEqual(0);
      expect(item.score).toBeLessThanOrEqual(100);
    }
  });
});

// 자산 성장 목표는 "기말 자산 >= 은퇴 시점 자산"이다. 등호가 포함되므로 정확히 같은 경우도
// 달성이다. `>`로 바뀌면 딱 본전인 계획이 미달로 뒤집힌다.
describe('자산 성장 경계', () => {
  test('기말 자산이 은퇴 시점 자산과 정확히 같으면 달성으로 본다', () => {
    const input = LegacySimulationAdapter.fromLegacy(structuredClone(initialParams));
    input.goals.selectedGoals = [{ type: 'ASSET_GROWTH', priority: 1, constraintType: 'SOFT' }];
    const simulated = new LegacySimulationEngine().simulate(input.profile, input.strategy);
    const retirementYear = simulated.yearlyResults.find(
      (year) => year.age >= input.strategy.retirementAge,
    )!;

    const evaluated = new DefaultGoalEvaluationEngine().evaluate(
      input.profile,
      input.goals,
      input.strategy,
      { ...simulated, endingAssets: retirementYear.openingAssets },
    );

    const growth = evaluated.goalEvaluations[0];
    expect(growth.achieved).toBe(true);
    expect(growth.score).toBe(100);
  });
});

// 회귀: known-issues 4번. 인출 경로가 남긴 10억분의 1원짜리 잔돈이 HARD 생활비 목표를
// 「위반」으로 만들어 후보가 통째로 탈락했다. 판정을 느슨하게 해서 고칠 문제가 아니었다 —
// 미달액을 «발생원에서 원 단위로» 닫는 것이 답이다(CashFlowPipeline.completeCashFlow).
// 이 시험은 그 증상 쪽 끝을 고정한다: 미달이 원 단위로 0인 계획은 HARD 위반이 아니다.
describe('부동소수점 잔여와 HARD 생활비 목표', () => {
  test('평생 미충족이 0원인 계획은 HARD 생활비 목표를 위반하지 않는다', () => {
    const target = 6_000_000;
    const compiled = compileStrategy({
      ...allAxesLiveParams,
      userProfile: { ...allAxesLiveParams.userProfile, expectancy: 68, targetMonthlySpending: target },
      retirementGoals: [
        { type: 'LIVING_EXPENSE_STABILITY', priority: 1, targetValue: target, targetValueSource: 'user', constraintType: 'HARD' },
      ],
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, privatePensionStrategy: 'tax_first' },
    });
    const input = LegacySimulationAdapter.fromLegacy(compiled.params, compiled.utilityConfig);
    const simulated = new SimulationEngine().simulate(input.profile, input.strategy);

    expect(simulated.yearlyResults.reduce((sum, y) => sum + y.unmetSpending, 0)).toBe(0);

    const evaluated = new DefaultGoalEvaluationEngine().evaluate(
      input.profile,
      input.goals,
      input.strategy,
      simulated,
    );

    expect(evaluated.hardConstraintFailures.map((failure) => failure.code)).toEqual([]);
    expect(evaluated.hardConstraintsSatisfied).toBe(true);
  });
});
