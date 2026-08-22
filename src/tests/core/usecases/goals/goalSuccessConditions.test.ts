import { describe, test, expect } from 'vitest';
import { resolveGoalSuccessConditions } from '@/core/usecases/goals/goalSuccessConditions';
import type { RetirementGoal } from '@/core/entities/retirementGoal';
import type { SimulationParams } from '@/core/entities/types';

const baseParams: SimulationParams = {
  userProfile: { currentAge: 50, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3_500_000 },
  assets: [],
  nationalPension: { expectedMonthlyAmount: 1_000_000 },
  privatePensions: [],
  otherIncomes: [],
  inflationRate: 2.5,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

const withGoals = (goals: RetirementGoal[], overrides: Partial<SimulationParams> = {}): SimulationParams => ({
  ...baseParams,
  ...overrides,
  retirementGoals: goals,
});

describe('resolveGoalSuccessConditions', () => {
  describe('레거시 시나리오 (목표 화면을 거친 적 없음)', () => {
    test('목표 도입 이전과 같은 세 조건을 그대로 쓴다', () => {
      const conditions = resolveGoalSuccessConditions({
        ...baseParams,
        userProfile: { ...baseParams.userProfile, targetBequest: 84_000_000 },
      });

      expect(conditions.basis).toBe('legacy_plan');
      expect(conditions.requireSpendingTarget).toBe(true);
      expect(conditions.requireAssetSurvival).toBe(true);
      expect(conditions.terminalAssetGoal).toBe(84_000_000);
    });

    test('targetBequest가 없으면 assetFloor를 기말자산 조건으로 쓴다', () => {
      const conditions = resolveGoalSuccessConditions({ ...baseParams, assetFloor: 50_000_000 });

      expect(conditions.terminalAssetGoal).toBe(50_000_000);
    });
  });

  describe('목표 기반 시나리오', () => {
    test('고르지 않은 상속 목표액은 조건이 되지 않는다', () => {
      // 구 UI에서 넣어 둔 상속 목표액(또는 기본 전략이 실체화한 24개월치)이 남아 있어도,
      // 목표 화면에서 상속을 고르지 않았으면 확률을 깎아서는 안 된다.
      const conditions = resolveGoalSuccessConditions(withGoals(
        [{ type: 'LIVING_EXPENSE_STABILITY', priority: 1, constraintType: 'SOFT', targetValue: 3_500_000 }],
        { userProfile: { ...baseParams.userProfile, targetBequest: 3_000_000_000 } },
      ));

      expect(conditions.basis).toBe('selected_goals');
      expect(conditions.terminalAssetGoal).toBe(0);
      expect(conditions.requireSpendingTarget).toBe(true);
    });

    test('고르지 않은 조건은 판정하지 않는다', () => {
      // 생활비만 골랐으면 고갈 조건은 이 확률이 묻는 것이 아니다.
      const conditions = resolveGoalSuccessConditions(withGoals(
        [{ type: 'LIVING_EXPENSE_STABILITY', priority: 1, constraintType: 'SOFT' }],
      ));

      expect(conditions.requireAssetSurvival).toBe(false);
    });

    test('자산 고갈 방지를 고르면 고갈 조건이 켜진다', () => {
      const conditions = resolveGoalSuccessConditions(withGoals(
        [{ type: 'ASSET_SURVIVAL', priority: 1, constraintType: 'HARD' }],
      ));

      expect(conditions.requireAssetSurvival).toBe(true);
      expect(conditions.requireSpendingTarget).toBe(false);
    });

    test('상속 목표를 고르면 그 목표액이 기말자산 조건이 된다', () => {
      const conditions = resolveGoalSuccessConditions(withGoals(
        [{ type: 'INHERITANCE', priority: 1, constraintType: 'SOFT', targetValue: 500_000_000 }],
      ));

      expect(conditions.terminalAssetGoal).toBe(500_000_000);
    });

    test('상속 목표에 금액이 없으면 계획이 실체화한 targetBequest를 쓴다', () => {
      const conditions = resolveGoalSuccessConditions(withGoals(
        [{ type: 'INHERITANCE', priority: 1, constraintType: 'SOFT' }],
        { userProfile: { ...baseParams.userProfile, targetBequest: 84_000_000 } },
      ));

      expect(conditions.terminalAssetGoal).toBe(84_000_000);
    });

    test('판정할 수 없는 목표는 조건이 아니라 미반영 목록으로 남는다', () => {
      const conditions = resolveGoalSuccessConditions(withGoals([
        { type: 'LIVING_EXPENSE_STABILITY', priority: 1, constraintType: 'SOFT' },
        { type: 'TAX_OPTIMIZATION', priority: 2, constraintType: 'SOFT' },
        { type: 'PENSION_OPTIMIZATION', priority: 3, constraintType: 'HARD' },
      ]));

      expect(conditions.unmeasuredGoals).toEqual(['TAX_OPTIMIZATION', 'PENSION_OPTIMIZATION']);
    });

    test('판정 가능한 목표가 하나도 없으면 계획의 기본 조건으로 되돌아간다', () => {
      // 판정할 목표가 없다고 100%를 주면, 세금 목표만 고른 사용자에게 "완벽한 계획"이라고
      // 말하게 된다. 기말자산 조건은 넣지 않는다 — 요구한 적 없는 금액이기 때문이다.
      const conditions = resolveGoalSuccessConditions(withGoals(
        [{ type: 'TAX_OPTIMIZATION', priority: 1, constraintType: 'SOFT' }],
        { userProfile: { ...baseParams.userProfile, targetBequest: 3_000_000_000 } },
      ));

      expect(conditions.basis).toBe('plan_defaults');
      expect(conditions.requireSpendingTarget).toBe(true);
      expect(conditions.requireAssetSurvival).toBe(true);
      expect(conditions.terminalAssetGoal).toBe(0);
      expect(conditions.unmeasuredGoals).toEqual(['TAX_OPTIMIZATION']);
    });

    test('판정 가능한 목표를 골라도 활성 조건이 없으면 계획의 기본 조건으로 되돌아간다', () => {
      // 「자산 성장」은 판정 가능한 유형이지만 목표액을 묻는 UI가 없어(goalCatalog에 target이
      // 없다) 단독으로 고르면 세 조건이 «모두» 빈다. 유형만 보는 가드는 이것을 통과시켜,
      // 62세에 자산이 바닥나는 계획에도 언제나 100%를 준다.
      const conditions = resolveGoalSuccessConditions(withGoals(
        [{ type: 'ASSET_GROWTH', priority: 1, constraintType: 'SOFT' }],
      ));

      expect(conditions.basis).toBe('plan_defaults');
      expect(conditions.requireSpendingTarget).toBe(true);
      expect(conditions.requireAssetSurvival).toBe(true);
      expect(conditions.terminalAssetGoal).toBe(0);
      // 「자산 성장」은 조건이 비었을 뿐 판정 대상 «유형»이다. 미반영 목록은 유형 기준
      // 그대로라 여기 들어가지 않는다 — 두 필드가 답하는 질문이 다르다.
      expect(conditions.unmeasuredGoals).toEqual([]);
    });

    test('자산 성장이라도 목표액이 살아 있으면 고른 목표 기준을 유지한다', () => {
      // 구멍만 막는다. 조건이 «하나라도» 나오는 정상 경로는 건드리지 않는다.
      const conditions = resolveGoalSuccessConditions(withGoals(
        [{ type: 'ASSET_GROWTH', priority: 1, constraintType: 'SOFT', targetValue: 500_000_000 }],
      ));

      expect(conditions.basis).toBe('selected_goals');
      expect(conditions.terminalAssetGoal).toBe(500_000_000);
      expect(conditions.requireAssetSurvival).toBe(false);
    });

    test('빠른 은퇴는 계획에 이미 반영되므로 미반영 목록에 넣지 않는다', () => {
      // 목표 은퇴 나이는 applyRetirementGoals가 userProfile.retirementAge로 옮겨 모든 시행이
      // 그 나이에 은퇴한다. 미반영이라고 말하면 반영된 목표를 반영되지 않았다고 하는 셈이다.
      const conditions = resolveGoalSuccessConditions(withGoals([
        { type: 'EARLY_RETIREMENT', priority: 1, constraintType: 'HARD', targetValue: 60 },
        { type: 'ASSET_SURVIVAL', priority: 2, constraintType: 'HARD' },
      ]));

      expect(conditions.unmeasuredGoals).toEqual([]);
    });

    test('목표를 모두 해제하면 기본 조건으로 판정한다', () => {
      const conditions = resolveGoalSuccessConditions(withGoals([]));

      expect(conditions.basis).toBe('plan_defaults');
      expect(conditions.terminalAssetGoal).toBe(0);
    });
  });
});
