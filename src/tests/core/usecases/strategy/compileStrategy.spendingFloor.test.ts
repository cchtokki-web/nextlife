import { describe, test, expect } from 'vitest';
import { compileStrategy } from '@/core/usecases/strategy/compileStrategy';
import { migrateRetirementGoals } from '@/core/usecases/goals/retirementGoalAdapter';
import { SimulationParams } from '@/core/entities/types';
import type { RetirementGoal } from '@/core/entities/retirementGoal';

function paramsWithGoals(goals: RetirementGoal[]): SimulationParams {
  const raw = {
    userProfile: { currentAge: 50, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3_000_000 },
    assets: [], privatePensions: [], isaAccounts: [], otherIncomes: [],
    nationalPension: { expectedMonthlyAmount: 0 },
    inflationRate: 2.5, inflationMode: 'real', baseExchangeRate: 1400,
    exchangeScenario: 'base', displayCurrency: 'KRW',
    retirementGoals: goals,
  } as unknown as SimulationParams;
  // 실제 파이프라인에서는 저장된 모든 params가 compileStrategy보다 먼저
  // migrateRetirementGoals를 지난다(useScenarios의 로드 경로, retirementGoalAdapter.ts 주석
  // 참조) — 그 함수가 목표에서 targetMonthlySpending(Step 5의 max 규칙)을 먼저 반영해 두므로,
  // compileStrategy는 그 위에서 hardSpendingFloor만 얹으면 된다. 여기서 생략하면
  // targetMonthlySpending이 입력 그대로 남아 "바닥은 언제나 목표 이하다" 불변식을 이 테스트
  // 스스로 검증할 수 없다.
  return migrateRetirementGoals(raw);
}

// 사용자가 «입력창에 직접 써넣은» 목표금액이다(targetValueSource: 'user'). 표시가 없으면
// 화면이 깔아 준 제안으로 취급되어 바닥을 세우지 않는다 — 그 규칙은 이 파일이 아니라
// retirementGoal.provenance 테스트가 고정한다.
const stability = (v: number, c: 'HARD' | 'SOFT'): RetirementGoal =>
  ({ type: 'LIVING_EXPENSE_STABILITY', priority: 1, targetValue: v, targetValueSource: 'user', constraintType: c });
const comfortable = (v: number, c: 'HARD' | 'SOFT'): RetirementGoal =>
  ({ type: 'COMFORTABLE_SPENDING', priority: 2, targetValue: v, targetValueSource: 'user', constraintType: c });

describe('hardSpendingFloor는 강도에서 나온다', () => {
  // 유형으로 강도를 추론하지 않는다. constraintType은 사용자가 모든 목표에 대해 자유롭게
  // 고르는 실제 도메인 값이고(RetirementGoalSelector의 select), defaultConstraintType은
  // 처음 고를 때의 씨앗일 뿐이다.
  test('생활비 안정만 SOFT — 바닥 없음 (기본 상태)', () => {
    const compiled = compileStrategy(paramsWithGoals([stability(2_500_000, 'SOFT')]));

    expect(compiled.params.hardSpendingFloor).toBeUndefined();
    expect('hardSpendingFloor' in compiled.params).toBe(false);
    expect(compiled.params.userProfile.targetMonthlySpending).toBe(2_500_000);
  });

  test('생활비 안정만 HARD — 바닥 = 목표', () => {
    const compiled = compileStrategy(paramsWithGoals([stability(2_500_000, 'HARD')]));

    expect(compiled.params.hardSpendingFloor).toBe(2_500_000);
    expect(compiled.params.userProfile.targetMonthlySpending).toBe(2_500_000);
  });

  test('안정 HARD + 여유 SOFT — 바닥과 목표가 갈린다', () => {
    const compiled = compileStrategy(
      paramsWithGoals([stability(2_500_000, 'HARD'), comfortable(3_500_000, 'SOFT')])
    );

    expect(compiled.params.hardSpendingFloor).toBe(2_500_000);
    expect(compiled.params.userProfile.targetMonthlySpending).toBe(3_500_000);
  });

  test('안정 SOFT + 여유 HARD — 바닥이 목표까지 올라간다', () => {
    const compiled = compileStrategy(
      paramsWithGoals([stability(2_500_000, 'SOFT'), comfortable(3_500_000, 'HARD')])
    );

    expect(compiled.params.hardSpendingFloor).toBe(3_500_000);
    expect(compiled.params.userProfile.targetMonthlySpending).toBe(3_500_000);
  });

  test('바닥은 언제나 목표 이하다', () => {
    for (const goals of [
      [stability(2_500_000, 'HARD')],
      [stability(2_500_000, 'HARD'), comfortable(3_500_000, 'SOFT')],
      [stability(2_500_000, 'SOFT'), comfortable(3_500_000, 'HARD')],
      [stability(3_500_000, 'HARD'), comfortable(2_500_000, 'HARD')],
    ]) {
      const compiled = compileStrategy(paramsWithGoals(goals));
      const floor = compiled.params.hardSpendingFloor;
      if (floor !== undefined) {
        expect(floor).toBeLessThanOrEqual(compiled.params.userProfile.targetMonthlySpending);
      }
    }
  });

  test('0은 목표값으로 인정하지 않는다 (기존 가드 유지)', () => {
    const compiled = compileStrategy(paramsWithGoals([stability(0, 'HARD')]));

    expect(compiled.params.hardSpendingFloor).toBeUndefined();
  });

  test('목표를 고르지 않은 시나리오는 바닥이 없다', () => {
    const bare = paramsWithGoals([]);
    delete (bare as unknown as Record<string, unknown>).retirementGoals;

    expect(compileStrategy(bare).params.hardSpendingFloor).toBeUndefined();
  });

  test('멱등 — 두 번 컴파일해도 같다', () => {
    const once = compileStrategy(paramsWithGoals([stability(2_500_000, 'HARD')])).params;
    const twice = compileStrategy(once).params;

    expect(twice.hardSpendingFloor).toBe(once.hardSpendingFloor);
  });
});
