import { describe, expect, test } from 'vitest';
import { LegacySimulationAdapter } from '@/core/domain/input/LegacySimulationAdapter';
import { DefaultGoalEvaluationEngine } from '@/core/evaluation/GoalEvaluationEngine';
import {
  confirmedTargetValue,
  hardSpendingFloorTarget,
  isSuggestedTargetValue,
  moveRetirementGoal,
  normalizeRetirementGoals,
  type RetirementGoal,
} from '@/core/entities/retirementGoal';
import type { SimulationParams } from '@/core/entities/types';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { applyRetirementGoals, migrateRetirementGoals } from '@/core/usecases/goals/retirementGoalAdapter';
import { resolveGoalSuccessConditions } from '@/core/usecases/goals/goalSuccessConditions';
import { compileStrategy, resolveStrategy } from '@/core/usecases/strategy/compileStrategy';
import { normalizeSimulationParams } from '@/infrastructure/storage/normalizeSimulationParams';

// 시스템이 깔아 준 씨앗과 사용자가 확정한 목표금액을 가르는 규칙의 시험.
//
// 목표를 고르는 «순간» 화면이 계획의 값에서 목표금액을 깔아 준다(RetirementGoalSelector의
// defaultTarget). 예전에는 그 씨앗이 사용자가 타이핑한 값과 같은 자리에 같은 형태로 저장돼
// 구별할 수 없었고, 그래서 사용자가 한 번도 진술한 적 없는 금액이 HARD 바닥이 되어 추천
// 후보를 전부 떨어뜨렸다(known-issues 2번). 이 파일이 고정하는 것은 네 가지다.
//
//   1. 표시 없는 금액은 부족분·HARD 판정에 참가하지 않는다
//   2. 사용자가 입력한 금액은 «참가한다» — 이 수정은 목표를 약화시키는 것이 아니다
//   3. 표시는 저장·복원 왕복을 견딘다
//   4. 표시가 없는 저장 데이터는 미확정으로 읽히며, 어떤 경로도 표시를 지어내지 않는다

/** 세금이 붙지 않는 계좌 하나. 자산 곡선이 곧 인출 곡선이라 미달의 원인이 분명해진다. */
function taxFreeAssets(valueKRW: number) {
  return [{
    id: 'a', type: 'etf', ticker: 'X', name: 'X', quantity: 1, averagePrice: valueKRW,
    totalReturn: 0, dividendYield: 0, monthlyContribution: 0,
    reinvestDividend: true, currency: 'KRW', assetMarket: 'OTHER',
  }];
}

/**
 * 계획 자신의 목표(월 300만)는 감당하지만 목표 카드의 금액(월 500만)은 감당하지 못하는 계획.
 *
 * 두 금액을 벌려 두는 것이 요점이다. 같으면 「씨앗을 안 봤다」와 「봤지만 계획이 이미 그
 * 금액이다」를 구별할 수 없어, 이 파일이 아무것도 검증하지 못한다.
 */
function plan(goals: RetirementGoal[], over: Record<string, unknown> = {}): SimulationParams {
  return {
    userProfile: { currentAge: 60, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3_000_000 },
    assets: taxFreeAssets(1_200_000_000),
    isaAccounts: [], otherIncomes: [], privatePensions: [],
    nationalPension: { expectedMonthlyAmount: 0 },
    inflationRate: 0, inflationMode: 'nominal', baseExchangeRate: 1400,
    exchangeScenario: 'base', displayCurrency: 'KRW',
    retirementGoals: goals,
    ...over,
  } as unknown as SimulationParams;
}

function evaluatePlan(params: SimulationParams) {
  const result = new SimulationEngine().runSingle(params);
  const input = LegacySimulationAdapter.fromLegacy(params);
  return new DefaultGoalEvaluationEngine().evaluate(
    input.profile, input.goals, input.strategy, result,
  );
}

const spendingGoal = (over: Partial<RetirementGoal> = {}): RetirementGoal => ({
  type: 'LIVING_EXPENSE_STABILITY', priority: 1, constraintType: 'HARD',
  targetValue: 5_000_000, ...over,
});

const bequestGoal = (over: Partial<RetirementGoal> = {}): RetirementGoal => ({
  type: 'INHERITANCE', priority: 1, constraintType: 'HARD',
  targetValue: 900_000_000, ...over,
});

const failureCodes = (params: SimulationParams) =>
  evaluatePlan(params).hardConstraintFailures.map((failure) => failure.code);

describe('목표금액의 출처 — 씨앗은 실패를 만들지 않는다', () => {
  test('표시 없는 HARD 생활비 금액은 바닥을 세우지 않는다', () => {
    expect(hardSpendingFloorTarget(spendingGoal())).toBeUndefined();
    expect(compileStrategy(plan([spendingGoal()])).params.hardSpendingFloor).toBeUndefined();
    expect('hardSpendingFloor' in compileStrategy(plan([spendingGoal()])).params).toBe(false);
  });

  test('표시 없는 HARD 생활비 금액은 미달을 만들지 않는다', () => {
    const evaluated = evaluatePlan(plan([spendingGoal()]));

    expect(evaluated.hardConstraintFailures).toEqual([]);
    expect(evaluated.hardConstraintsSatisfied).toBe(true);
    // 목표가 «평가에서 빠지는» 것은 아니다. 계획 자신의 목표 생활비를 자로 삼아 그대로
    // 채점된다 — 사라지는 것은 사용자가 말한 적 없는 금액을 근거로 한 미달 선언뿐이다.
    expect(evaluated.goalEvaluations[0]).toMatchObject({
      goalType: 'LIVING_EXPENSE_STABILITY',
      achieved: true,
      measurement: { unit: 'MONTHLY_MONEY' },
    });
    expect(evaluated.goalEvaluations[0].measurement).not.toHaveProperty('target');
  });

  test('사용자가 입력한 같은 금액은 바닥을 세우고 미달을 만든다', () => {
    const confirmed = spendingGoal({ targetValueSource: 'user' });

    expect(hardSpendingFloorTarget(confirmed)).toBe(5_000_000);
    expect(compileStrategy(plan([confirmed])).params.hardSpendingFloor).toBe(5_000_000);
    expect(failureCodes(plan([confirmed]))).toContain('HARD_SPENDING_SHORTFALL');
  });

  // 없애는 것은 「사용자가 말한 적 없는 숫자를 근거로 실패를 선언하는 일」뿐이다.
  // 계획 자신의 목표 생활비를 못 채우는 것은 여전히 HARD 미달이다.
  test('계획 자신의 목표를 못 채우면 표시가 없어도 HARD 미달이다', () => {
    const poor = plan([spendingGoal()], { assets: taxFreeAssets(100_000_000) });

    expect(failureCodes(poor)).toContain('HARD_SPENDING_SHORTFALL');
  });

  test('표시 없는 HARD 상속 금액은 기말자산 하한도 미달도 만들지 않는다', () => {
    const seeded = compileStrategy(migrateRetirementGoals(plan([bequestGoal()])));

    expect(seeded.params.assetFloor).toBeUndefined();
    expect(failureCodes(plan([bequestGoal()]))).not.toContain('HARD_MINIMUM_ENDING_ASSETS');
  });

  // 목표 달성 확률의 기말자산 조건도 같은 자를 쓴다. 여기만 씨앗을 읽으면 「HARD 미달은
  // 아니지만 확률은 깎인다」는 어긋난 상태가 된다.
  test('표시 없는 상속 금액은 목표 달성 확률의 기말자산 조건이 되지 않는다', () => {
    const conditions = resolveGoalSuccessConditions(migrateRetirementGoals(plan([bequestGoal()])));

    expect(conditions.terminalAssetGoal).toBe(0);
  });

  test('사용자가 입력한 상속 금액은 목표 달성 확률의 기말자산 조건이 된다', () => {
    const confirmed = bequestGoal({ targetValueSource: 'user' });
    const conditions = resolveGoalSuccessConditions(migrateRetirementGoals(plan([confirmed])));

    expect(conditions.terminalAssetGoal).toBe(900_000_000);
    expect(conditions.basis).toBe('selected_goals');
  });

  test('사용자가 입력한 상속 금액은 하한선이 되고 미달도 만든다', () => {
    const confirmed = bequestGoal({ targetValueSource: 'user' });
    const compiled = compileStrategy(migrateRetirementGoals(plan([confirmed])));

    expect(compiled.params.assetFloor).toBe(900_000_000);
    expect(failureCodes(plan([confirmed]))).toContain('HARD_MINIMUM_ENDING_ASSETS');
  });
});

describe('목표금액의 출처 — 체감 커브의 기준', () => {
  // 체감 커브는 계획의 목표 생활비에 곱해진다(SimulationEngine의 baseMonthly). 그 축이
  // 씨앗에서 파생되면, 사용자가 진술한 적 없는 금액에서 커브가 나오고 그 파생값이 다시
  // HARD 바닥과 비교되어 구조적 미달이 된다.
  test('표시 없는 금액은 계획의 목표 생활비를 밀어내지 못한다', () => {
    const migrated = migrateRetirementGoals(plan([spendingGoal({ constraintType: 'SOFT' })]));

    expect(migrated.userProfile.targetMonthlySpending).toBe(3_000_000);
  });

  test('사용자가 확정한 금액은 계획의 목표 생활비가 된다', () => {
    const migrated = migrateRetirementGoals(
      plan([spendingGoal({ constraintType: 'SOFT', targetValueSource: 'user' })]),
    );

    expect(migrated.userProfile.targetMonthlySpending).toBe(5_000_000);
  });

  test('표시 없는 상속 금액은 계획의 목표 상속자산이 되지 않는다', () => {
    const migrated = migrateRetirementGoals(plan([bequestGoal()]));

    expect(migrated.userProfile.targetBequest).toBeUndefined();
    // 「일부 남기기」 — 하한선을 걸지 않고 적정선으로 채점만 하는, 목표를 고르기 «전»의 상태다.
    expect(resolveStrategy(migrated).bequestStrategy).toBe('leave_some');
  });
});

describe('목표금액의 출처 — 저장과 복원', () => {
  test('표시는 저장·복원 왕복을 견딘다', () => {
    const saved = JSON.parse(JSON.stringify(plan([spendingGoal({ targetValueSource: 'user' })])));
    const loaded = normalizeSimulationParams(saved);

    expect(loaded.retirementGoals?.[0]).toMatchObject({
      targetValue: 5_000_000, targetValueSource: 'user',
    });
    expect(confirmedTargetValue(loaded.retirementGoals![0])).toBe(5_000_000);
  });

  // 정확히 'user'만 통과한다. 넓게 받아 주면 저장 데이터를 손대는 것만으로 씨앗이 확정으로
  // 승격된다.
  test('알 수 없는 출처 값은 미확정으로 되돌린다', () => {
    for (const source of ['system', 'USER', true, 1, null]) {
      const raw = JSON.parse(JSON.stringify(plan([spendingGoal()])));
      raw.retirementGoals[0].targetValueSource = source;
      const loaded = normalizeSimulationParams(raw);

      expect(loaded.retirementGoals?.[0].targetValueSource).toBeUndefined();
      expect(confirmedTargetValue(loaded.retirementGoals![0])).toBeUndefined();
    }
  });

  test('표시가 없는 저장 데이터는 미확정으로 읽힌다', () => {
    const loaded = normalizeSimulationParams(JSON.parse(JSON.stringify(plan([spendingGoal()]))));
    const goal = loaded.retirementGoals![0];

    expect(goal.targetValue).toBe(5_000_000);
    expect(goal.targetValueSource).toBeUndefined();
    expect(confirmedTargetValue(goal)).toBeUndefined();
    expect(isSuggestedTargetValue(goal)).toBe(true);
  });
});

describe('목표금액의 출처 — 어떤 경로도 표시를 지어내지 않는다', () => {
  const seeded = spendingGoal();

  test('목표 객체를 다시 만드는 경로들이 표시를 붙이지 않는다', () => {
    expect(normalizeRetirementGoals([seeded])[0].targetValueSource).toBeUndefined();
    expect(moveRetirementGoal([seeded, bequestGoal({ priority: 2 })], 'INHERITANCE', -1)
      .every((goal) => goal.targetValueSource === undefined)).toBe(true);
    expect(migrateRetirementGoals(plan([seeded])).retirementGoals?.[0].targetValueSource)
      .toBeUndefined();
    expect(applyRetirementGoals(plan([]), [seeded]).retirementGoals?.[0].targetValueSource)
      .toBeUndefined();
  });

  test('확정된 표시는 같은 경로에서 사라지지 않는다', () => {
    const confirmed = spendingGoal({ targetValueSource: 'user' });

    expect(normalizeRetirementGoals([confirmed])[0].targetValueSource).toBe('user');
    expect(migrateRetirementGoals(plan([confirmed])).retirementGoals?.[0].targetValueSource)
      .toBe('user');
  });

  // 가리킬 금액이 없는 출처는 다음 씨앗에 들러붙는다 — 입력창을 비우면 표시도 함께 지운다.
  test('금액을 지우면 표시도 사라진다', () => {
    const emptied = normalizeRetirementGoals([
      spendingGoal({ targetValue: undefined, targetValueSource: 'user' }),
    ]);

    expect(emptied[0].targetValueSource).toBeUndefined();
    expect('targetValueSource' in emptied[0]).toBe(false);
  });
});
