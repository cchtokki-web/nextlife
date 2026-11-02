import { describe, expect, test } from 'vitest';
import { initialParams } from '@/infrastructure/storage/localStore';
import { generateGoalChangeProposals } from '@/core/usecases/goals/goalChangeProposals';
import { migrateRetirementGoals } from '@/core/usecases/goals/retirementGoalAdapter';

const params = {
  ...initialParams,
  userProfile: { ...initialParams.userProfile, currentAge: 51, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3_000_000 },
  retirementGoals: [
    { type: 'EARLY_RETIREMENT' as const, priority: 1, constraintType: 'HARD' as const, targetValue: 60 },
    { type: 'LIVING_EXPENSE_STABILITY' as const, priority: 2, constraintType: 'HARD' as const, targetValue: 3_000_000, targetValueSource: 'user' as const },
  ],
};

describe('은퇴 목표 변경안', () => {
  test('명시한 목표만 변경하고 저장 정규화 후에도 유지한다', () => {
    const proposals = generateGoalChangeProposals(params);
    expect(proposals.map((item) => item.after)).toEqual([61, 62, 2_700_000, 2_400_000]);
    expect(params.userProfile.retirementAge).toBe(60);
    for (const proposal of proposals) {
      const restored = migrateRetirementGoals(JSON.parse(JSON.stringify(proposal.params)));
      expect(restored.userProfile[proposal.kind === 'retirement' ? 'retirementAge' : 'targetMonthlySpending']).toBe(proposal.after);
      expect(restored.retirementGoals?.every((goal) => goal.constraintType === 'HARD')).toBe(true);
    }
  });
  test('미확정 생활비를 확정하거나 선택하지 않은 목표를 만들지 않는다', () => {
    const unconfirmed = { ...params, retirementGoals: [{ type: 'LIVING_EXPENSE_STABILITY' as const, priority: 1, constraintType: 'HARD' as const, targetValue: 3_000_000 }] };
    expect(generateGoalChangeProposals(unconfirmed)).toEqual([]);
  });
  test('이미 지난 은퇴 목표와 계획에 반영되지 않은 금액은 오해할 변경안으로 내지 않는다', () => {
    const mismatched = { ...params, userProfile: { ...params.userProfile, currentAge: 70, retirementAge: 70, targetMonthlySpending: 4_000_000 } };
    expect(generateGoalChangeProposals(mismatched)).toEqual([]);
  });
  test('달러 표시 계획은 달러 단위로 생활비를 조정한다', () => {
    const dollar = { ...params, displayCurrency: 'USD' as const, userProfile: { ...params.userProfile, targetMonthlySpending: 3_000 },
      retirementGoals: [params.retirementGoals[0], { ...params.retirementGoals[1], targetValue: 3_000 }] };
    expect(generateGoalChangeProposals(dollar).filter((item) => item.kind === 'spending').map((item) => item.after)).toEqual([2700, 2400]);
  });
  test('두 생활비 목표가 있으면 한 목표만 바꾸는 오해를 피한다', () => {
    const both = { ...params, retirementGoals: [...params.retirementGoals, { type: 'COMFORTABLE_SPENDING' as const, priority: 3, constraintType: 'SOFT' as const, targetValue: 3_500_000, targetValueSource: 'user' as const }] };
    expect(generateGoalChangeProposals(both).every((item) => item.kind === 'retirement')).toBe(true);
  });
});

test('실제 엔진으로 같은 시드의 변경안만 검증하고 입력을 보존한다', async () => {
  const { evaluateGoalChanges } = await import('@/core/usecases/goals/evaluateGoalChanges');
  const input = { ...params, userProfile: { ...params.userProfile, currentAge: 59, expectancy: 64 } };
  const snapshot = structuredClone(input);
  const result = evaluateGoalChanges(input, { trials: 8, seed: 20260101, annualStdDev: 12 });
  expect(result.trials).toBe(8);
  expect(result.baselineProbability).toBeGreaterThanOrEqual(0);
  expect(result.baselineProbability).toBeLessThanOrEqual(1);
  expect(input).toEqual(snapshot);
  for (const proposal of result.proposals) {
    expect(Math.round(proposal.probability * 100)).toBeGreaterThan(Math.round(result.baselineProbability * 100));
    expect(proposal.conditions).toBeDefined();
  }
});
