import { describe, expect, test } from 'vitest';
import { describeGoalConflict } from '@/core/usecases/goals/describeGoalConflict';
import type { ConflictingGoal } from '@/core/evaluation/GoalEvaluationEngine';

// 문구를 «문장 전문»으로 고정한다. enum이나 배열 길이만 검사하면 문구가 틀려도 통과한다 —
// 「1,000회 중 0회」가 그렇게 지나간 적이 있다.

const spendingShortfall = (amount: number): ConflictingGoal => ({
  goalType: 'LIVING_EXPENSE_STABILITY',
  constraintLayer: 1,
  shortfall: { unit: 'MONTHLY_MONEY', amount },
});

const inheritanceShortfall: ConflictingGoal = {
  goalType: 'INHERITANCE',
  constraintLayer: 2,
  shortfall: { unit: 'MONEY', amount: 84_000_000 },
};

const assetSurvivalShortfall: ConflictingGoal = {
  goalType: 'ASSET_SURVIVAL',
  constraintLayer: 2,
  shortfall: { unit: 'YEARS', amount: 3 },
};

describe('양보한 목표가 있는 경우', () => {
  const described = describeGoalConflict({
    goalConflict: true,
    conflictingGoals: [spendingShortfall(120_000), inheritanceShortfall],
    yieldedGoal: 'INHERITANCE',
  });

  test('「우선했다」로 말한다 — 「지켰다」가 아니다', () => {
    expect(described?.title).toBe('동시에 달성하기 어려운 목표가 있습니다');
    expect(described?.lead).toBe(
      '「반드시 지키기」로 설정한 생활비를 상속 자산 확보 목표보다 우선했습니다.'
      + ' 그래도 두 목표를 모두 충족하기에는 자산이 부족합니다.',
    );
  });

  test('이긴 쪽 미달도 함께 적는다 — 숨기면 「양보해서 지켜냈다」로 읽힌다', () => {
    expect(described?.shortfalls).toEqual([
      '생활비 안정 월 12만원 부족',
      '상속 자산 확보 8,400만원 부족',
    ]);
  });
});

describe('양보한 목표가 없는 경우', () => {
  const described = describeGoalConflict({
    goalConflict: true,
    conflictingGoals: [spendingShortfall(120_000), inheritanceShortfall, assetSurvivalShortfall],
  });

  test('하나를 임의로 패자로 만들지 않는다', () => {
    expect(described?.lead).toBe(
      '현재 조건에서는 아래 목표를 모두 충족할 수 없어 어느 하나를 임의로 우선하지 않았습니다.',
    );
  });

  test('미달을 «전부» 보여 준다 — 자산 고갈은 금액이 아니라 기간이다', () => {
    expect(described?.shortfalls).toEqual([
      '생활비 안정 월 12만원 부족',
      '상속 자산 확보 8,400만원 부족',
      '자산 고갈 방지 목표보다 3년 짧음',
    ]);
  });
});

describe('이긴 쪽 미달이 0인 경우', () => {
  // 바닥을 깨고 «끝내 채운» 계획. 여기서 「생활비를 지켰다」로 쓰면 다음 계획에서 거짓이 되고,
  // 0원을 「월 0만원 부족」으로 적으면 부족하지 않은 것을 부족하다고 말한다.
  const described = describeGoalConflict({
    goalConflict: true,
    conflictingGoals: [spendingShortfall(0), inheritanceShortfall],
    yieldedGoal: 'INHERITANCE',
  });

  test('그 항목만 목록에서 빠진다', () => {
    expect(described?.shortfalls).toEqual(['상속 자산 확보 8,400만원 부족']);
  });

  test('문장은 그대로다 — 「우선했다」는 이긴 쪽이 미달인지와 무관한 사실이다', () => {
    expect(described?.lead).toBe(
      '「반드시 지키기」로 설정한 생활비를 상속 자산 확보 목표보다 우선했습니다.'
      + ' 그래도 두 목표를 모두 충족하기에는 자산이 부족합니다.',
    );
    expect(described?.lead).not.toContain('지켰');
    expect(described?.lead).not.toContain('달성했');
  });
});

describe('충돌이 없으면 undefined다', () => {
  test('판정이 「충돌 없음」이면 그릴 것이 없다', () => {
    // 빈 문자열이나 빈 배열이 아니라 undefined다. 소비자마다 「비었다」의 기준을 새로
    // 정하게 두지 않는다.
    expect(describeGoalConflict({ goalConflict: false, conflictingGoals: [] })).toBeUndefined();
  });

  test('판정을 «하지 않은» 엔진의 결과도 그릴 것이 없다', () => {
    expect(describeGoalConflict({})).toBeUndefined();
  });
});
