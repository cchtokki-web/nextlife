import { describe, expect, test } from 'vitest';
import type { SimulationParams } from '@/core/entities/types';
import type { StrategyDimensions } from '@/core/strategy/StrategyGenerator';
import { applyStrategyToParams } from '@/core/usecases/dashboard/applyStrategyToParams';
import { describeStrategyChanges } from '@/core/usecases/dashboard/describeStrategyChanges';
import { STRATEGY_FIELD_MAP } from '@/core/usecases/dashboard/strategyFieldMap';
import { compileStrategy, resolveStrategy } from '@/core/usecases/strategy/compileStrategy';
import { migrateRetirementGoals } from '@/core/usecases/goals/retirementGoalAdapter';
import { makeParams, makeRanked, type RankedOverrides } from './strategyFieldFixtures';

// describeStrategyChanges(카드가 말하는 것)와 applyStrategyToParams(실제로 일어나는 것)의
// 정합을 강제하는 계약 테스트.
//
// 축을 하나 더 추가하면서 한쪽만 고치는 순간 여기가 빨간불이 된다. 그 실수는 조용히
// 넘어가면 "카드가 약속한 변경이 적용되지 않는다" 또는 "말하지 않은 변경이 적용된다"로
// 나타나는데, 둘 다 사용자가 화면만 보고는 알아챌 수 없는 종류의 결함이다.

const formatValue = (value: number) => `${Math.round(value / 10_000)}만원`;

// 카드가 실제로 받는 것은 «컴파일된» params다(page.tsx가 analysis.effective.params를 넘긴다).
// 그래서 국민연금 개시 나이는 언제나 수령 전략과 짝이 맞는다 — 저수준 나이만 60인데 전략은
// 미정('ai_optimized' = 65세)인 params는 화면에 존재하지 않는 상태이고, 그런 픽스처를 쓰면
// 「적용했는데 국민연금이 다시 달라 보인다」는 실패가 계약이 아니라 픽스처에서 나온다.
// 카드가 실제로 받는 것은 «로드 정규화를 거친» params다(useScenarios의 migrateParams →
// AnalysisRuntime의 effective). 원본 그대로 넣으면 describe/apply는 정규화 전 값을 보고
// 비교 대상은 정규화 후 값이 되어, 계약이 아니라 픽스처가 실패를 만든다.
const CURRENT_PLANS: SimulationParams[] = ([
  makeParams({
    userProfile: { currentAge: 50, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3_000_000 },
    yieldPreset: 'conservative',
    withdrawalPlan: { nationalPensionStartAge: 60, accountWithdrawalPolicy: 'GENERAL_FIRST' },
    strategy: { ...resolveStrategy(makeParams()), nationalPensionStrategy: 'early', riskProfile: 'conservative' },
  }),
  makeParams({
    userProfile: { currentAge: 45, retirementAge: 65, expectancy: 95, targetMonthlySpending: 5_000_000 },
    yieldPreset: 'aggressive',
    withdrawalPlan: { nationalPensionStartAge: 70, accountWithdrawalPolicy: 'TAX_OPTIMIZED' },
    strategy: { ...resolveStrategy(makeParams()), nationalPensionStrategy: 'defer_max', riskProfile: 'aggressive' },
  }),
  // 저수준 필드를 하나도 정하지 않은 시나리오.
  makeParams({ yieldPreset: undefined, withdrawalPlan: undefined }),
  // 목표를 하나도 고르지 않은 계획. 은퇴 시점·월 생활비 축이 반영 «불가»가 되는 경로이며,
  // 픽스처가 전부 목표를 갖고 있으면 그 분기를 계약 테스트가 한 번도 밟지 않는다.
  makeParams({ retirementGoals: [] }),
  // 정규화를 거치지 않은 저장 시나리오. 적용이 말하지 않은 축(생활비 전략·목표 우선순위)을
  // 함께 바꾸면 「적용한 뒤에는 반영하지 못한 축만 남는다」가 즉시 깨진다.
  makeParams({
    strategy: {
      ...resolveStrategy(makeParams()),
      spendingChoice: 'dividend_only',
      objective: 'tax_minimization',
    },
    userProfile: { currentAge: 50, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3_000_000 },
    retirementGoals: [{ type: 'ASSET_SURVIVAL', priority: 1, constraintType: 'HARD' }],
  }),
] as SimulationParams[]).map(migrateRetirementGoals);

const CANDIDATE_AXES: RankedOverrides[] = [];
for (const retirementAge of [60, 62]) {
  for (const nationalPensionStartAge of [60, 65, 70]) {
    for (const withdrawalPolicy of ['GENERAL_FIRST', 'ISA_FIRST'] as StrategyDimensions['withdrawalPolicy'][]) {
      for (const assetAllocation of ['CONSERVATIVE', 'BALANCED', 'GROWTH'] as const) {
        for (const spendingPattern of ['FIXED', 'FRONT_LOADED'] as const) {
          CANDIDATE_AXES.push({
            retirementAge,
            nationalPensionStartAge,
            withdrawalPolicy,
            assetAllocation,
            spendingPattern,
            targetMonthlySpending: 3_500_000,
          });
        }
      }
    }
  }
}

const COMBINATIONS = CURRENT_PLANS.flatMap((params) =>
  CANDIDATE_AXES.map((axes) => ({ params, ranked: makeRanked(axes) }))
);

describe('strategyFieldMap 계약', () => {
  test('테이블의 모든 축이 서로 다른 키와 라벨을 갖는다', () => {
    expect(new Set(STRATEGY_FIELD_MAP.map((f) => f.key)).size).toBe(STRATEGY_FIELD_MAP.length);
    expect(new Set(STRATEGY_FIELD_MAP.map((f) => f.label)).size).toBe(STRATEGY_FIELD_MAP.length);
  });

  test('카드가 말한 축과 apply가 처리한 축이 정확히 같다', () => {
    for (const { params, ranked } of COMBINATIONS) {
      const described = describeStrategyChanges(params, ranked, formatValue).map((c) => c.label);
      const handled = applyStrategyToParams(params, ranked);

      expect([...handled.applied, ...handled.skipped].map((item) => item.label).sort())
        .toEqual([...described].sort());
    }
  });

  test('적용한 뒤에는 반영하지 못한 축만 「달라지는 점」으로 남는다', () => {
    for (const { params, ranked } of COMBINATIONS) {
      const result = applyStrategyToParams(params, ranked);
      const remaining = describeStrategyChanges(result.params, ranked, formatValue);

      expect(remaining.map((change) => change.label).sort())
        .toEqual(result.skipped.map((skip) => skip.label).sort());
    }
  });

  // 사용자의 params는 언제나 compileStrategy를 통과한 뒤 엔진에 들어간다. 그 번역이
  // 방금 적용한 값을 되돌리면 재분석 결과가 그대로여서 버튼이 무동작으로 보인다.
  test('compileStrategy를 통과한 뒤에도 반영 결과가 유지된다', () => {
    for (const { params, ranked } of COMBINATIONS) {
      const result = applyStrategyToParams(params, ranked);
      // 실제 경로는 「저장 → 로드 정규화 → 컴파일」이다. compileStrategy만 통과시키면
      // migrateRetirementGoals가 되돌리는 축을 이 계약이 놓친다.
      const compiled = compileStrategy(migrateRetirementGoals(result.params)).params;
      const remaining = describeStrategyChanges(compiled, ranked, formatValue);

      expect(remaining.map((change) => change.label).sort())
        .toEqual(result.skipped.map((skip) => skip.label).sort());
    }
  });

  test('두 번 적용해도 결과가 달라지지 않는다', () => {
    for (const { params, ranked } of COMBINATIONS) {
      const once = applyStrategyToParams(params, ranked);
      const twice = applyStrategyToParams(once.params, ranked);

      expect(twice.applied).toEqual([]);
      expect(twice.params).toBe(once.params);
    }
  });
});
