import { describe, expect, test } from 'vitest';
import { LegacySimulationAdapter } from '@/core/domain/input/LegacySimulationAdapter';
import { DefaultGoalEvaluationEngine } from '@/core/evaluation/GoalEvaluationEngine';
import { LegacySimulationEngine } from '@/core/simulation/LegacySimulationEngine';
import { RETIREMENT_GOAL_TYPES, type RetirementGoalType } from '@/core/entities/retirementGoal';
import {
  describeUnscoredGoals,
  hasGoalScoreFormula,
  unscoredGoalTypes,
} from '@/core/usecases/goals/goalScoreSupport';
import { isQuantitativelyJudgedGoal } from '@/core/usecases/goals/goalSuccessConditions';
import type { SimulationParams } from '@/core/entities/types';

const 억 = 100_000_000;

/** 세금이 붙지 않는 계좌 하나. 점수 차이가 계좌 종류가 아니라 «규모»에서만 오게 한다. */
function assets(valueKRW: number) {
  return [{
    id: 'a', type: 'etf', ticker: 'X', name: 'X', quantity: 1, averagePrice: valueKRW,
    totalReturn: 4, dividendYield: 1, monthlyContribution: 0,
    reinvestDividend: true, currency: 'KRW', assetMarket: 'OTHER',
  }];
}

/**
 * 목표가 «자기 목표값»을 갖도록 채운다. 화면이 카드를 고르는 순간 깔아 주는 씨앗과 같은
 * 규칙이다(RetirementGoalSelector의 defaultTarget). 값을 비워 두면 나이·금액 목표가 잴
 * 대상을 잃어 0점이 되는데, 그것은 「산식이 없다」가 아니라 「목표가 비었다」이므로 이
 * 테스트가 재려는 것과 다른 이유로 0이 된다.
 */
function seedTarget(goalType: RetirementGoalType): Partial<{ targetValue: number; targetValueSource: 'user' }> {
  switch (goalType) {
    case 'EARLY_RETIREMENT':
      return { targetValue: 65 };
    case 'LIVING_EXPENSE_STABILITY':
    case 'COMFORTABLE_SPENDING':
      return { targetValue: 3_000_000, targetValueSource: 'user' };
    case 'INHERITANCE':
    case 'ASSET_GROWTH':
      return { targetValue: 100_000_000, targetValueSource: 'user' };
    default:
      return {};
  }
}

function plan(goalType: RetirementGoalType, assetValue: number, npMonthly: number): SimulationParams {
  return {
    userProfile: { currentAge: 60, retirementAge: 65, expectancy: 90, targetMonthlySpending: 3_000_000 },
    assets: assets(assetValue),
    isaAccounts: [],
    otherIncomes: [],
    privatePensions: [{
      id: 'p', type: 'irp', investmentType: 'etf', name: 'IRP',
      balance: assetValue * 0.3, monthlyContribution: 0, totalReturn: 4, currency: 'KRW',
    }],
    nationalPension: { expectedMonthlyAmount: npMonthly },
    inflationRate: 0, inflationMode: 'nominal', baseExchangeRate: 1400,
    exchangeScenario: 'base', displayCurrency: 'KRW',
    retirementGoals: [{ type: goalType, priority: 1, constraintType: 'SOFT', ...seedTarget(goalType) }],
  } as unknown as SimulationParams;
}

function scoreOf(goalType: RetirementGoalType, params: SimulationParams): number {
  const input = LegacySimulationAdapter.fromLegacy(params);
  const result = new LegacySimulationEngine().simulate(input.profile, input.strategy);
  const evaluated = new DefaultGoalEvaluationEngine().evaluate(
    input.profile, input.goals, input.strategy, result,
  );
  const found = evaluated.goalEvaluations.find((item) => item.goalType === goalType);
  if (!found) throw new Error(`평가 항목이 없다: ${goalType}`);
  return found.score;
}

describe('goalScoreSupport — 점수 산식이 있는 목표와 없는 목표', () => {
  // **이 테스트가 분류의 표류를 막는다.**
  //
  // hasGoalScoreFormula는 «선언»이고 evaluateGoal은 «실제»다. 둘이 갈라지면 화면이 조용히
  // 거짓말을 시작한다 — 점수가 생긴 목표를 「산정 대상 아님」이라 적거나, 상수 0을 돌려주는
  // 목표를 「반영됩니다」라고 적는다. 그래서 선언을 믿지 않고 엔진을 실제로 돌려 확인한다.
  //
  // 자를 둘 두는 이유: 계획 하나로는 「이 계획에서 우연히 0」과 「언제나 0」을 구별할 수 없다.
  test('선언한 분류가 엔진이 실제로 내는 점수와 일치한다', () => {
    const rich = (type: RetirementGoalType) => plan(type, 30 * 억, 1_500_000);
    const poor = (type: RetirementGoalType) => plan(type, 0.2 * 억, 300_000);

    const alwaysZero: RetirementGoalType[] = [];
    for (const type of RETIREMENT_GOAL_TYPES) {
      const scores = [scoreOf(type, rich(type)), scoreOf(type, poor(type))];
      expect(scores.every((s) => Number.isFinite(s) && s >= 0 && s <= 100), type).toBe(true);
      if (scores.every((s) => s === 0)) alwaysZero.push(type);
    }

    // 두 계획 모두에서 0인 유형의 «집합»이 선언과 정확히 같아야 한다. 한쪽만 검사하면
    // 새로 상수화된 목표가 조용히 통과한다.
    expect(alwaysZero).toEqual(RETIREMENT_GOAL_TYPES.filter((type) => !hasGoalScoreFormula(type)));
  });

  test('점수 산식이 없는 목표는 오늘 「주거 안정」 하나다', () => {
    expect(RETIREMENT_GOAL_TYPES.filter((type) => !hasGoalScoreFormula(type)))
      .toEqual(['HOUSING_STABILITY']);
  });

  // 두 분류는 답하는 질문이 다르다. 같아지면 어느 한쪽이 다른 쪽으로 접힌 것이므로,
  // 연금·세금·위험 목표가 «확률로는 판정 못 하지만 점수는 있는» 자리에 남아 있는지 고정한다.
  test('확률 판정 분류와 점수 산정 분류를 혼동하지 않는다', () => {
    for (const type of ['PENSION_OPTIMIZATION', 'TAX_OPTIMIZATION', 'RISK_REDUCTION'] as const) {
      expect(isQuantitativelyJudgedGoal(type), type).toBe(false);
      expect(hasGoalScoreFormula(type), type).toBe(true);
    }
    expect(isQuantitativelyJudgedGoal('HOUSING_STABILITY')).toBe(false);
    expect(hasGoalScoreFormula('HOUSING_STABILITY')).toBe(false);
  });

  test('unscoredGoalTypes는 입력 순서를 지키고 대상만 남긴다', () => {
    expect(unscoredGoalTypes(['TAX_OPTIMIZATION', 'HOUSING_STABILITY', 'ASSET_SURVIVAL']))
      .toEqual(['HOUSING_STABILITY']);
    expect(unscoredGoalTypes(['ASSET_SURVIVAL', 'TAX_OPTIMIZATION'])).toEqual([]);
  });

  describe('describeUnscoredGoals', () => {
    test('대상이 없으면 빈 문자열이라 화면이 빈 자리를 그리지 않는다', () => {
      expect(describeUnscoredGoals([])).toBe('');
      expect(describeUnscoredGoals(['TAX_OPTIMIZATION', 'PENSION_OPTIMIZATION'])).toBe('');
    });

    // 문장이 반드시 말해야 하는 것은 «0점의 뜻»이다. 그 말을 빼면 남는 것은
    // 「점수가 없다」뿐이고, 사용자는 그것을 여전히 실패로 읽을 수 있다.
    test('0점이 실패가 아니라는 사실을 문장이 직접 말한다', () => {
      const sentence = describeUnscoredGoals(['HOUSING_STABILITY']);

      expect(sentence).toContain('주거 안정');
      expect(sentence).toContain('점수 산정 대상이 아닙니다');
      expect(sentence).toContain('목표 실패가 아니');
    });
  });
});
