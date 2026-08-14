import { describe, expect, test } from 'vitest';
import {
  MAX_RETIREMENT_GOALS,
  moveRetirementGoal,
  normalizeRetirementGoals,
  type RetirementGoal,
} from '@/core/entities/retirementGoal';

const goal = (type: RetirementGoal['type'], priority: number): RetirementGoal => ({
  type, priority, constraintType: 'SOFT',
});

describe('RetirementGoal domain', () => {
  test('우선순위를 연속된 1부터 다시 매기고 최대 5개로 제한한다', () => {
    const normalized = normalizeRetirementGoals([
      goal('ASSET_GROWTH', 80),
      goal('EARLY_RETIREMENT', 10),
      goal('ASSET_SURVIVAL', 20),
      goal('TAX_OPTIMIZATION', 30),
      goal('RISK_REDUCTION', 40),
      goal('INHERITANCE', 50),
    ]);

    expect(normalized).toHaveLength(MAX_RETIREMENT_GOALS);
    expect(normalized.map((item) => item.priority)).toEqual([1, 2, 3, 4, 5]);
    expect(normalized.map((item) => item.type)).toEqual([
      'EARLY_RETIREMENT', 'ASSET_SURVIVAL', 'TAX_OPTIMIZATION', 'RISK_REDUCTION', 'INHERITANCE',
    ]);
  });

  test('같은 목표의 중복을 제거한다', () => {
    expect(normalizeRetirementGoals([
      goal('ASSET_SURVIVAL', 1), goal('ASSET_SURVIVAL', 2),
    ])).toHaveLength(1);
  });

  test('목표를 위아래로 이동하면 priority도 함께 갱신한다', () => {
    const moved = moveRetirementGoal([
      goal('EARLY_RETIREMENT', 1), goal('ASSET_SURVIVAL', 2), goal('ASSET_GROWTH', 3),
    ], 'ASSET_GROWTH', -1);

    expect(moved.map((item) => [item.type, item.priority])).toEqual([
      ['EARLY_RETIREMENT', 1], ['ASSET_GROWTH', 2], ['ASSET_SURVIVAL', 3],
    ]);
  });

  test('은퇴 나이 target은 도메인 유효 범위로 제한한다', () => {
    const [tooHigh] = normalizeRetirementGoals([
      { ...goal('EARLY_RETIREMENT', 1), targetValue: 999 },
    ]);
    const [tooLow] = normalizeRetirementGoals([
      { ...goal('EARLY_RETIREMENT', 1), targetValue: 0 },
    ]);

    expect(tooHigh.targetValue).toBe(120);
    expect(tooLow.targetValue).toBe(1);
  });
});
