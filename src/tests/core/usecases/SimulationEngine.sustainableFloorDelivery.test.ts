import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { LegacySimulationAdapter } from '@/core/domain/input/LegacySimulationAdapter';
import { DefaultGoalEvaluationEngine } from '@/core/evaluation/GoalEvaluationEngine';
import { ledgerTolerance } from '@/core/usecases/ledger/YearLedger';
import { SimulationParams, SimulationResult, YearlyLedger } from '@/core/entities/types';

// 「max_sustainable + HARD 생활비 바닥」 계획이 «전달되는 계획»에서 바닥을 존중한다
// (스펙 「HARD 바닥이 있는 계획의 지속가능 생활비」, known-issues 3번).
//
// 종전에는 탐색이 바닥을 뗀 시행의 원장을 그대로 반환해서, 바닥은 「반드시 지키기」인데
// 엔진은 월 118만원을 지급하고 3.35억을 남긴 채 「이것이 한계입니다」라고 답했다. 평가
// 계층은 같은 계획을 HARD 미달로 적었다. 돈이 있고, 바닥이 상위 계층이고, 쓰지 않았다.
//
// 픽스처는 스펙이 실측에 쓴 것과 같다 — 사적연금 5억, 저율과세 한도 ON, 60→70세.
// 이 계획의 «용량»은 두 개다:
//   선호(세제 한도)를 지키면   월 1,181,250
//   바닥을 존중하면(한도를 깨면) 월 3,446,596
const engine = new SimulationEngine();

function pensionCapped(over: Partial<SimulationParams> = {}): SimulationParams {
  return {
    userProfile: { currentAge: 60, retirementAge: 60, expectancy: 70, targetMonthlySpending: 3_000_000 },
    assets: [], isaAccounts: [], otherIncomes: [],
    privatePensions: [{
      id: 'p', type: 'irp', investmentType: 'etf', name: 'IRP',
      balance: 500_000_000, monthlyContribution: 0,
      totalReturn: 0, dividendYield: 0, currency: 'KRW',
    }],
    nationalPension: { expectedMonthlyAmount: 0 },
    inflationRate: 0, inflationMode: 'nominal', baseExchangeRate: 1400,
    exchangeScenario: 'base', displayCurrency: 'KRW',
    taxSettings: { limitPrivatePensionToTaxLimit: true },
    spendingStrategy: 'max_sustainable',
    ...over,
  } as unknown as SimulationParams;
}

function withFloor(floor: number | undefined): SimulationResult {
  return engine.run(pensionCapped(
    (floor === undefined ? {} : { hardSpendingFloor: floor }) as Partial<SimulationParams>
  ));
}

// 종전 값(HEAD 8e6f9d3에서 실측). 바닥이 구속하지 않는 계획은 여기서 한 발도 움직이면 안 된다.
const PREFERENCE_RESPECTING_MONTHLY = 1181250.0655651093;
const PREFERENCE_RESPECTING_ENDING = 335172593;
const PREFERENCE_RESPECTING_TAX = 8902406;
// 바닥을 존중한 실행에서의 용량. 바닥을 얼마로 넣든 같은 값이 나온다.
const FLOOR_HONORING_MONTHLY = 3446596.534922719;

function totalTax(result: SimulationResult): number {
  return result.yearlyResults.reduce((sum, year) => sum + year.taxes, 0);
}

// 돈을 더 쓴다고 회계가 깨지면 안 된다. 항등식은 엔진이 매년 스스로 검사하지만
// (assertLedgerConsistent), 이 경로를 실제로 밟는지는 여기서 확인한다.
function expectLedgerConsistent(result: SimulationResult): void {
  const ledgers = result.yearlyResults.map((y) => y.ledger);
  expect(ledgers.every((l): l is YearlyLedger => l !== undefined)).toBe(true);
  const violations = (ledgers as YearlyLedger[])
    .filter((l) => Math.abs(l.residual) > ledgerTolerance(l))
    .map((l) => `${l.age}세: ${Math.round(l.residual).toLocaleString()}원`);
  expect(violations).toEqual([]);
}

describe('1. HARD 바닥 없음 + max_sustainable — 종전과 완전히 동일', () => {
  test('바닥이 없는 계획은 이 변경이 건드리지 않는다', () => {
    const result = withFloor(undefined);

    expect(result.calculatedTargetSpending).toBe(PREFERENCE_RESPECTING_MONTHLY);
    expect(Math.round(result.endingAssets)).toBe(PREFERENCE_RESPECTING_ENDING);
    expect(result.depletionAge).toBeNull();
    expect(Math.round(totalTax(result))).toBe(PREFERENCE_RESPECTING_TAX);
    // 갈라진 적이 없으므로 기록도 없다.
    expect(result.sustainableSpendingOverride).toBeUndefined();
  });
});

describe('2. HARD 바닥 < 지속가능액 — 바닥이 구속하지 않는다', () => {
  test('탐색값이 그대로 전달되고 원장도 바닥 없는 계획과 같다', () => {
    const result = withFloor(500_000);
    const noFloor = withFloor(undefined);

    expect(result.calculatedTargetSpending).toBe(PREFERENCE_RESPECTING_MONTHLY);
    expect(result.endingAssets).toBe(noFloor.endingAssets);
    expect(totalTax(result)).toBe(totalTax(noFloor));
    expect(result.sustainableSpendingOverride).toBeUndefined();
  });
});

describe('3. HARD 바닥 ≈ 지속가능액 — 경계', () => {
  // 부등호는 «바닥이 탐색값을 넘을 때만» 구속한다(hardSpendingFloor > bestTarget).
  // 같으면 이미 바닥을 지급하고 있으므로 아무것도 깨지 않는다 — 계층은 필요할 때만 깬다.
  test('바닥이 탐색값과 같거나 낮으면 종전 그대로다', () => {
    const justBelow = withFloor(Math.floor(PREFERENCE_RESPECTING_MONTHLY));
    const exactly = withFloor(PREFERENCE_RESPECTING_MONTHLY);

    for (const result of [justBelow, exactly]) {
      expect(result.calculatedTargetSpending).toBe(PREFERENCE_RESPECTING_MONTHLY);
      expect(Math.round(result.endingAssets)).toBe(PREFERENCE_RESPECTING_ENDING);
      expect(result.sustainableSpendingOverride).toBeUndefined();
    }
  });

  test('탐색값보다 1원이라도 높으면 바닥을 존중한 실행으로 넘어간다', () => {
    const justAbove = withFloor(Math.ceil(PREFERENCE_RESPECTING_MONTHLY) + 1);

    expect(justAbove.calculatedTargetSpending).toBe(FLOOR_HONORING_MONTHLY);
    expect(justAbove.sustainableSpendingOverride).toEqual({
      preferenceRespectingMonthly: PREFERENCE_RESPECTING_MONTHLY,
      floorHonoringMonthly: FLOOR_HONORING_MONTHLY,
      deliveredMonthly: FLOOR_HONORING_MONTHLY,
      hardSpendingFloor: Math.ceil(PREFERENCE_RESPECTING_MONTHLY) + 1,
    });
    // 경계 바로 위와 아래가 크게 갈라진다는 사실 자체를 고정한다. 한 발 차이로 계획이
    // 달라지는 것이 이 설계의 «의도»이고(바닥은 계층 1, 세제는 계층 5), 화면은 그 사실을
    // 밝혀야 한다.
    expect(justAbove.calculatedTargetSpending!)
      .toBeGreaterThan(PREFERENCE_RESPECTING_MONTHLY * 2.9);
  });
});

describe('4. HARD 바닥 > 지속가능액 — 이 변경의 본체', () => {
  const result = withFloor(2_500_000);

  test('최종 원장이 바닥을 넘겨 지급한다 — 월 118만 → 344만', () => {
    expect(result.calculatedTargetSpending).toBe(FLOOR_HONORING_MONTHLY);
    for (const year of result.yearlyResults) {
      // 해마다 실제로 지급된다. 바닥(연 3,000만원)을 넘긴다.
      expect(year.spending, `${year.age}세`).toBeGreaterThan(30_000_000);
      expect(year.spending, `${year.age}세`)
        .toBeCloseTo(FLOOR_HONORING_MONTHLY * 12, -1);
      expect(year.unmetSpending, `${year.age}세`).toBeLessThan(1);
    }
  });

  test('세제 최적화(계층 5)를 눌렀다는 사실이 원장에 남는다', () => {
    const diagnostics = result.yearlyResults.map((y) => y.ledger?.diagnostics);
    expect(diagnostics.every((d) => d?.overrideReason === 'hardSpendingFloor')).toBe(true);
    expect(diagnostics.every((d) => d?.brokenPreferences.includes('pensionTaxLimit'))).toBe(true);
    // HARD 바닥 미달은 없다 — 지급이 바닥을 넘겼다.
    expect(diagnostics.every((d) => (d?.unmetHardSpending ?? 0) < 1)).toBe(true);
  });

  test('탐색값과 전달값의 차이가 기록으로 남는다', () => {
    // 「남기지 않으면 다음에 이 숫자를 의심하는 사람이 처음부터 다시 재야 한다」.
    expect(result.sustainableSpendingOverride).toEqual({
      preferenceRespectingMonthly: PREFERENCE_RESPECTING_MONTHLY,
      floorHonoringMonthly: FLOOR_HONORING_MONTHLY,
      deliveredMonthly: FLOOR_HONORING_MONTHLY,
      hardSpendingFloor: 2_500_000,
    });
  });

  test('세금은 890만 → 4,505만으로 오른다 — 한도를 깬 대가가 실제로 계산된다', () => {
    expect(Math.round(totalTax(result))).toBe(45049252);
    expect(totalTax(result)).toBeGreaterThan(PREFERENCE_RESPECTING_TAX * 5);
  });

  test('더 쓴다고 회계 항등식이 깨지지 않는다', () => {
    expectLedgerConsistent(result);
  });

  // 결함의 나머지 절반. 종전에는 「쓸 수 있는데 안 썼다」와 「못 지켰다고 적었다」가 «함께»
  // 일어났다. 원장이 바닥을 넘겨 지급하면 평가 계층의 자(year.spending)도 함께 움직인다.
  test('평가 계층이 더 이상 HARD 미달로 적지 않는다', () => {
    const params = pensionCapped({
      hardSpendingFloor: 2_500_000,
      retirementGoals: [{
        type: 'LIVING_EXPENSE_STABILITY', priority: 1,
        constraintType: 'HARD', targetValue: 2_500_000,
      }],
    } as Partial<SimulationParams>);
    const evaluatedResult = engine.run(params);
    const input = LegacySimulationAdapter.fromLegacy(params);
    const evaluated = new DefaultGoalEvaluationEngine().evaluate(
      input.profile, input.goals, input.strategy, evaluatedResult,
    );

    expect(evaluated.hardConstraintFailures.map((failure) => failure.code))
      .not.toContain('HARD_SPENDING_SHORTFALL');
  });
});

describe('5. 바닥 적용 후 기말자산 = 0 — 화면이 경고해야 할 상태', () => {
  test('3.35억이 남던 계획이 0원으로 끝난다', () => {
    const result = withFloor(2_500_000);

    expect(result.endingAssets).toBeLessThan(1_000);
    expect(result.endingAssets).toBeGreaterThanOrEqual(0);
    // 종전 계획과 «같은 얼굴»로 보이면 안 되는 근거. 같은 입력, 같은 전략, 3.35억 차이다.
    expect(withFloor(undefined).endingAssets).toBeGreaterThan(300_000_000);
    // 기말이 0인데도 고갈은 아니다 — 기대수명까지 바닥을 «지급하며» 버텼다.
    expect(result.depletionAge).toBeNull();
  });
});

describe('6. 바닥 적용 후 조기 고갈 — 기대수명보다 앞선다', () => {
  test('바닥이 바닥 존중 용량마저 넘으면 그래도 지급하고 고갈한다', () => {
    const result = withFloor(5_000_000);
    const override = result.sustainableSpendingOverride!;

    // 「반드시 지키기」이므로 지급한다. 지속 가능해서가 아니다.
    expect(result.calculatedTargetSpending).toBe(5_000_000);
    expect(override.floorHonoringMonthly).toBe(FLOOR_HONORING_MONTHLY);
    expect(override.deliveredMonthly).toBeGreaterThan(override.floorHonoringMonthly);

    // 그 대가가 고갈이다. 기대수명(70세)보다 앞선다.
    expect(result.depletionAge).toBe(67);
    expect(result.depletionAge!).toBeLessThan(70);
    expectLedgerConsistent(result);
  });

  test('바닥이 높을수록 더 일찍 고갈한다', () => {
    expect(withFloor(4_000_000).depletionAge).toBe(69);
    expect(withFloor(10_000_000).depletionAge).toBe(63);
  });
});
