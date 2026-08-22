import { describe, expect, test } from 'vitest';
import { LegacySimulationAdapter } from '@/core/domain/input/LegacySimulationAdapter';
import { DefaultGoalEvaluationEngine } from '@/core/evaluation/GoalEvaluationEngine';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { compileStrategy } from '@/core/usecases/strategy/compileStrategy';
import type { RetirementGoal } from '@/core/entities/retirementGoal';
import type { SimulationParams } from '@/core/entities/types';

// 엔진이 남긴 사실을 «목표 언어»로 옮기는 계층의 시험.
//
// 엔진은 목표를 모른다. 원장에는 「assetFloor를 깼다」·「납세로 하한선이 침범당했다」까지만
// 적히고, 그것을 「HARD 생활비 목표가 HARD 상속 목표를 이겼다」로 옮기는 것은 여기다.
// 그래서 이 파일은 엔진을 고치지 않고 «판정»만 고정한다.

/** 세금이 한 푼도 붙지 않는 단순 계좌 하나. 자산 곡선이 곧 인출 곡선이 되어 읽기 쉽다. */
function taxFreeAssets(valueKRW: number) {
  return [{
    id: 'a', type: 'etf', ticker: 'X', name: 'X', quantity: 1, averagePrice: valueKRW,
    totalReturn: 0, dividendYield: 0, monthlyContribution: 0,
    reinvestDividend: true, currency: 'KRW', assetMarket: 'OTHER',
  }];
}

function plan(over: Record<string, unknown>): SimulationParams {
  return {
    userProfile: { currentAge: 60, retirementAge: 60, expectancy: 63, targetMonthlySpending: 5_000_000 },
    assets: taxFreeAssets(300_000_000),
    isaAccounts: [], otherIncomes: [], privatePensions: [],
    nationalPension: { expectedMonthlyAmount: 0 },
    inflationRate: 0, inflationMode: 'nominal', baseExchangeRate: 1400,
    exchangeScenario: 'base', displayCurrency: 'KRW',
    ...over,
  } as unknown as SimulationParams;
}

/** 시뮬레이션 결과와 그 계획의 도메인 입력을 함께 만든다. 평가는 둘을 모두 본다. */
function evaluatePlan(params: SimulationParams) {
  const result = new SimulationEngine().runSingle(params);
  const input = LegacySimulationAdapter.fromLegacy(params);
  const evaluated = new DefaultGoalEvaluationEngine().evaluate(
    input.profile, input.goals, input.strategy, result,
  );
  return { result, evaluated };
}

const hardSpendingGoal = (targetValue: number, priority = 1): RetirementGoal =>
  ({ type: 'LIVING_EXPENSE_STABILITY', priority, constraintType: 'HARD', targetValue });

describe('교차 계층 충돌 — HARD 생활비 바닥이 HARD 상속 하한선을 이긴다', () => {
  const conflicted = plan({
    assetFloor: 280_000_000,
    hardSpendingFloor: 5_000_000,
    retirementGoals: [
      hardSpendingGoal(5_000_000),
      { type: 'INHERITANCE', priority: 2, constraintType: 'HARD', targetValue: 280_000_000 },
    ],
  });

  test('진 쪽이 어느 목표인지와 얼마를 잃었는지가 남는다', () => {
    const { result, evaluated } = evaluatePlan(conflicted);

    // 전제 — 엔진은 목표 이름 없이 「하한선을 깼다」까지만 적어 두었다.
    expect(result.yearlyResults.some((year) =>
      year.ledger!.diagnostics.brokenPreferences.includes('assetFloor')
      && year.ledger!.diagnostics.overrideReason === 'hardSpendingFloor')).toBe(true);

    expect(evaluated.goalConflict).toBe(true);
    expect(evaluated.yieldedGoal).toBe('INHERITANCE');
    expect(evaluated.conflictingGoals).toEqual([
      // 이긴 쪽. 바닥이 실제로 채워졌으므로 미달은 0이다 — 깨기만 하고 못 채웠으면 0이 아니다.
      {
        goalType: 'LIVING_EXPENSE_STABILITY',
        constraintLayer: 1,
        shortfall: { unit: 'MONTHLY_MONEY', amount: 0 },
      },
      {
        goalType: 'INHERITANCE',
        constraintLayer: 2,
        shortfall: { unit: 'MONEY', amount: 280_000_000 - result.endingAssets },
      },
    ]);
  });

  test('기존 hardConstraintFailures는 그대로 남는다', () => {
    const { evaluated } = evaluatePlan(conflicted);

    // 충돌 보고는 「왜 미달했는가」를 더할 뿐, 「어느 목표가 미달했는가」를 대체하지 않는다.
    expect(evaluated.hardConstraintFailures.map((failure) => failure.code))
      .toEqual(['HARD_MINIMUM_ENDING_ASSETS']);
    expect(evaluated.hardConstraintsSatisfied).toBe(false);
  });

  test('하한선을 깼어도 상속 목표가 끝내 충족되면 아무도 양보하지 않은 것이다', () => {
    // 같은 계획에서 상속 목표만 낮춘다. 하한선(2.8억)은 여전히 깨지지만 기말 자산이 목표를
    // 넘으므로 잃은 것이 없다. 'assetFloor' 플래그는 「기말 자산이 하한선 아래로 내려갔다」가
    // 아니라 「계층 2 클램프가 물렸을 것이다」를 뜻하므로, 플래그만으로 충돌을 세면 안 된다.
    const { result, evaluated } = evaluatePlan(plan({
      assetFloor: 280_000_000,
      hardSpendingFloor: 5_000_000,
      retirementGoals: [
        hardSpendingGoal(5_000_000),
        { type: 'INHERITANCE', priority: 2, constraintType: 'HARD', targetValue: 10_000_000 },
      ],
    }));

    expect(result.endingAssets).toBeGreaterThan(10_000_000);
    expect(evaluated.goalConflict).toBe(false);
    expect(evaluated.conflictingGoals).toEqual([]);
    expect(evaluated.yieldedGoal).toBeUndefined();
  });
});

describe('동일 계층은 충돌하지 않는다 — 계층 2의 두 제약은 하나의 바닥으로 합쳐진다', () => {
  const withGoals = (goals: RetirementGoal[]) => plan({
    userProfile: {
      currentAge: 60, retirementAge: 60, expectancy: 63,
      targetMonthlySpending: 5_000_000, targetBequest: 200_000_000,
    },
    bequestStrategy: 'leave_some',
    retirementGoals: goals,
  });

  test('상속 하한선과 자산 고갈 방지는 Math.max로 «합쳐져» 하나의 스칼라가 된다', () => {
    const inheritanceOnly = compileStrategy(withGoals([
      { type: 'INHERITANCE', priority: 1, constraintType: 'HARD', targetValue: 200_000_000 },
    ])).params.assetFloor;
    const both = compileStrategy(withGoals([
      { type: 'INHERITANCE', priority: 1, constraintType: 'HARD', targetValue: 200_000_000 },
      { type: 'ASSET_SURVIVAL', priority: 2, constraintType: 'HARD' },
    ])).params.assetFloor;

    expect(inheritanceOnly).toBeGreaterThan(0);
    // 자산 고갈 방지는 없던 바닥을 1로 «올릴» 뿐 상속 하한선을 낮추지 못한다. 둘이 다툴
    // 자리가 없다는 사실이 여기 있다 — 엔진이 받는 것은 언제나 바닥 하나다.
    expect(both).toBe(Math.max(1, inheritanceOnly as number));
  });

  test('계층 2의 두 HARD 목표가 함께 미달해도 충돌로 보고하지 않는다', () => {
    const { evaluated } = evaluatePlan(withGoals([
      { type: 'INHERITANCE', priority: 1, constraintType: 'HARD', targetValue: 200_000_000 },
      { type: 'ASSET_SURVIVAL', priority: 2, constraintType: 'HARD' },
    ]));

    // 계층 1이 없으니 하한선을 깰 것도 없다. 미달은 미달대로 보고되지만 충돌은 아니다.
    expect(evaluated.goalConflict).toBe(false);
    expect(evaluated.conflictingGoals).toEqual([]);
    expect(evaluated.yieldedGoal).toBeUndefined();
  });
});

describe('계획이 바닥보다 낮게 겨냥하면 자산이 남아도 HARD 미달이다', () => {
  // 연령대 배수 0.76이 목표를 월 228만원으로 내린다. 엔진의 1단계는 계획이 겨냥한 금액까지만
  // 채우므로(계획 실패는 런타임에 더 인출해 고칠 수 있는 문제가 아니다) 엔진 기준 미달은 0이다.
  // 목표와 결과를 둘 다 보는 평가 계층만 이것을 잡을 수 있다.
  const underAimed = plan({
    userProfile: { currentAge: 70, retirementAge: 70, expectancy: 73, targetMonthlySpending: 3_000_000 },
    assets: taxFreeAssets(1_000_000_000),
    spendingCurve: { breakpointAges: [70], multipliers: [1, 0.76] },
    hardSpendingFloor: 3_000_000,
    retirementGoals: [hardSpendingGoal(3_000_000)],
  });

  test('「돈이 없어서」가 아니다 — 자산도 남고 엔진도 미달을 적지 않는다', () => {
    const { result } = evaluatePlan(underAimed);

    expect(result.endingAssets).toBeGreaterThan(0);
    for (const year of result.yearlyResults) {
      expect(year.unmetSpending, `${year.age}세`).toBe(0);
      expect(year.ledger!.diagnostics.unmetHardSpending, `${year.age}세`).toBe(0);
      expect(year.ledger!.diagnostics.blockedWithdrawalReason, `${year.age}세`).toBeUndefined();
    }
  });

  test('그래도 HARD 생활비 미달로 보고한다', () => {
    const { evaluated } = evaluatePlan(underAimed);

    expect(evaluated.hardConstraintFailures.map((failure) => failure.code))
      .toEqual(['HARD_SPENDING_SHORTFALL']);
    expect(evaluated.hardConstraintFailures[0].goalType).toBe('LIVING_EXPENSE_STABILITY');
    // 월 300만원 목표에 실제 228만원 — 72만원이 영구적으로 모자란다.
    // 사유는 사람이 읽는 문장이므로 금액에 천 단위 구분자와 단위가 붙는다.
    expect(evaluated.hardConstraintFailures[0].reason).toContain('월 720,000원');
    expect(evaluated.hardConstraintFailures[0].reason).toContain('월 3,000,000원');
  });
});

describe('납세로 하한선이 침범당한 것은 충돌이 아니다', () => {
  // 사적연금 5억뿐. 1단계가 저율과세 한도를 깨고 인출하면 연말 초과세가 붙고, 그 세금은
  // 인출 엔진 밖에서 연금을 직접 판다 — 하한선을 지키지 않은 채로.
  const taxPressure = plan({
    // 한 해만 산다 — 하한선이 무너지는 «유일한» 사유를 납세로 고정하기 위해서다. 이듬해까지
    // 살면 이미 하한선 아래로 내려간 잔액에서 인출이 다시 일어나 그해는 진짜 충돌이 된다.
    userProfile: { currentAge: 60, retirementAge: 60, expectancy: 60, targetMonthlySpending: 4_000_000 },
    assets: [],
    privatePensions: [{
      id: 'p', type: 'irp', investmentType: 'etf', name: 'IRP',
      balance: 500_000_000, monthlyContribution: 0,
      totalReturn: 0, dividendYield: 0, currency: 'KRW',
    }],
    taxSettings: { limitPrivatePensionToTaxLimit: true },
    assetFloor: 448_000_000,
    hardSpendingFloor: 4_000_000,
    retirementGoals: [
      hardSpendingGoal(4_000_000),
      { type: 'INHERITANCE', priority: 2, constraintType: 'HARD', targetValue: 448_000_000 },
    ],
  });

  test('세금이 이긴 해는 목표끼리 다툰 것이 아니다', () => {
    const { result, evaluated } = evaluatePlan(taxPressure);

    const first = result.yearlyResults[0];
    // 전제 — 하한선은 «인출»이 아니라 납세로 무너졌다. 엔진이 두 사실을 다른 자리에 적는다.
    expect(first.ledger!.diagnostics.assetFloorBreachedBy).toBe('taxObligation');
    expect(first.ledger!.diagnostics.brokenPreferences).not.toContain('assetFloor');

    // 상속 목표는 미달이다. 그러나 그것을 이긴 것은 목표가 아니라 계층 «밖»의 법적 의무다.
    expect(evaluated.hardConstraintFailures.map((failure) => failure.code))
      .toContain('HARD_MINIMUM_ENDING_ASSETS');
    expect(evaluated.goalConflict).toBe(false);
    expect(evaluated.conflictingGoals).toEqual([]);
    expect(evaluated.yieldedGoal).toBeUndefined();
  });
});

describe('충돌이 없으면 조용하다', () => {
  test('목표가 서로 다투지 않는 계획은 기존 거동 그대로다', () => {
    const { evaluated } = evaluatePlan(plan({
      assets: taxFreeAssets(1_000_000_000),
      hardSpendingFloor: 5_000_000,
      retirementGoals: [
        hardSpendingGoal(5_000_000),
        { type: 'INHERITANCE', priority: 2, constraintType: 'HARD', targetValue: 100_000_000 },
      ],
    }));

    expect(evaluated.hardConstraintFailures).toEqual([]);
    expect(evaluated.goalConflict).toBe(false);
    expect(evaluated.conflictingGoals).toEqual([]);
    expect(evaluated.yieldedGoal).toBeUndefined();
  });

  test('바닥이 없는 계획에서는 판정 자체가 서지 않는다', () => {
    // hardSpendingFloor가 없으면 1단계가 돌지 않으므로 하한선이 종전대로 인출을 막는다.
    // 막힌 것은 «깬» 것이 아니다 — 계층이 설계대로 동작한 것이라 충돌이 아니다.
    const { result, evaluated } = evaluatePlan(plan({
      assetFloor: 280_000_000,
      retirementGoals: [
        { type: 'LIVING_EXPENSE_STABILITY', priority: 1, constraintType: 'SOFT', targetValue: 5_000_000 },
        { type: 'INHERITANCE', priority: 2, constraintType: 'HARD', targetValue: 280_000_000 },
      ],
    }));

    expect(result.yearlyResults[0].ledger!.diagnostics.blockedWithdrawalReason).toBe('assetFloor');
    expect(evaluated.goalConflict).toBe(false);
    expect(evaluated.conflictingGoals).toEqual([]);
  });
});
