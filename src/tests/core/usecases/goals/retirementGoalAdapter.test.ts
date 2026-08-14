import { describe, expect, test } from 'vitest';
import { initialParams } from '@/infrastructure/storage/localStore';
import {
  applyRetirementGoals,
  migrateRetirementGoals,
  resolveRetirementGoals,
} from '@/core/usecases/goals/retirementGoalAdapter';
import { compileStrategy } from '@/core/usecases/strategy/compileStrategy';

describe('retirementGoalAdapter', () => {
  test('기존 시나리오는 목표를 임의 선택하지 않고 기존 입력을 그대로 보존한다', () => {
    const { retirementGoals: _goals, ...legacy } = initialParams;
    const migrated = migrateRetirementGoals(legacy);

    expect(migrated).toBe(legacy);
    expect(resolveRetirementGoals(migrated)).toEqual([]);
  });

  test('목표 target 값을 기존 엔진 입력의 단일 값에 동기화한다', () => {
    const applied = applyRetirementGoals(initialParams, [
      { type: 'EARLY_RETIREMENT', priority: 1, targetValue: 58, constraintType: 'HARD' },
      { type: 'LIVING_EXPENSE_STABILITY', priority: 2, targetValue: 4200000, constraintType: 'SOFT' },
      { type: 'INHERITANCE', priority: 3, targetValue: 200000000, constraintType: 'HARD' },
    ]);

    expect(applied.userProfile).toMatchObject({
      retirementAge: 58,
      targetMonthlySpending: 4200000,
      targetBequest: 200000000,
    });
    expect(applied.strategy?.bequestStrategy).toBe('target_amount');
  });

  test('이미 저장된 목표가 있으면 레거시 값으로 덮어쓰지 않는다', () => {
    const params = {
      ...initialParams,
      retirementGoals: [
        { type: 'TAX_OPTIMIZATION' as const, priority: 1, constraintType: 'SOFT' as const },
      ],
    };

    expect(resolveRetirementGoals(params)).toEqual(params.retirementGoals);
  });

  test('상속 목표를 해제하면 목표 카드가 만든 레거시 상속 제약도 제거한다', () => {
    const withInheritance = applyRetirementGoals(initialParams, [
      { type: 'INHERITANCE', priority: 1, targetValue: 100000000, constraintType: 'HARD' },
    ]);

    const removed = applyRetirementGoals(withInheritance, [
      { type: 'ASSET_SURVIVAL', priority: 1, constraintType: 'HARD' },
    ]);

    expect(removed.userProfile.targetBequest).toBeUndefined();
    expect(removed.strategy?.bequestStrategy).toBe('leave_some');
  });

  test('HARD 상속 목표만 엔진의 자산 하한선으로 컴파일한다', () => {
    const hard = applyRetirementGoals(initialParams, [
      { type: 'INHERITANCE', priority: 1, targetValue: 100000000, constraintType: 'HARD' },
    ]);
    const soft = applyRetirementGoals(initialParams, [
      { type: 'INHERITANCE', priority: 1, targetValue: 100000000, constraintType: 'SOFT' },
    ]);

    expect(compileStrategy(hard).params.assetFloor).toBe(100000000);
    expect(compileStrategy(soft).params.assetFloor).toBeUndefined();
  });

  test('선택 목표는 compileStrategy가 추천과 평가에 전달하는 utilityConfig를 바꾼다', () => {
    const tax = applyRetirementGoals(initialParams, [
      { type: 'TAX_OPTIMIZATION', priority: 1, constraintType: 'SOFT' },
    ]);
    const risk = applyRetirementGoals(initialParams, [
      { type: 'RISK_REDUCTION', priority: 1, constraintType: 'SOFT' },
    ]);

    expect(compileStrategy(tax).utilityConfig.weights)
      .not.toEqual(compileStrategy(risk).utilityConfig.weights);
  });

  test('HARD 자산 고갈 방지는 엔진의 최소 자산 하한선을 활성화한다', () => {
    const params = applyRetirementGoals(initialParams, [
      { type: 'ASSET_SURVIVAL', priority: 1, constraintType: 'HARD' },
    ]);

    expect(compileStrategy(params).params.assetFloor).toBe(1);
  });
});
