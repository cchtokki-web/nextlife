import { describe, expect, test } from 'vitest';
import { LegacySimulationAdapter } from '@/core/domain/input/LegacySimulationAdapter';
import { LegacySimulationEngine } from '@/core/simulation/LegacySimulationEngine';
import { StrategyOptimizer } from '@/core/strategy/StrategyOptimizer';
import { MonteCarloEngine } from '@/core/usecases/montecarlo/MonteCarloEngine';
import { resolveMonteCarloConfig } from '@/core/usecases/montecarlo/volatilityPresets';
import { describeStrategyChanges } from '@/core/usecases/dashboard/describeStrategyChanges';
import { compileStrategy } from '@/core/usecases/strategy/compileStrategy';
import type { SimulationParams } from '@/core/entities/types';
import type { RetirementStrategy } from '@/core/domain/input/retirement';

/**
 * **카드는 아무 일도 하지 않는 변경을 광고하지 않는다.**
 *
 * 판정은 카드가 내건 축을 사용자의 «현재 값»으로 되돌려 다시 시뮬레이션하는 것이다.
 * 원장이 비트 단위로 같으면 그 변경점은 유령이고, 「적용」을 누른 사용자는 이득 없는
 * 조작을 하고 계획에는 시뮬레이션한 적 없는 값이 기록된다.
 *
 * 이 계획은 사적연금도 ISA도 없다 — 실측에서 유령 카드가 나온 정확히 그 모양이다
 * (54 페르소나 중 5·13·21·39, 카드 11장). 그 사용자에게는 「인출 정책 미지정」과
 * GENERAL_FIRST가 같은 계획이므로, 격자가 GENERAL_FIRST를 박아 넣으면 카드가
 * 「현재 설정 → 일반계좌 우선 인출」이라는 없는 변경점을 내걸었다.
 *
 * 판정을 `strategyFieldMap.differs`에 넣지 않는 이유는 값이 아니라 «비용»이다 — 카드마다
 * 시뮬레이션이 한 번씩 더 든다. 그래서 여기서만(테스트에서만) 결과로 묻는다.
 *
 * 픽스처가 아니라 실제 옵티마이저를 돌린다. 손으로 만든 후보는 dimensions와 strategy를
 * 늘 일치시켜서, 정확히 이 어긋남을 재현하지 못한다.
 */

const engine = new LegacySimulationEngine();

// 사적연금 없음 · ISA 없음 · 인출 정책 미지정.
const params: SimulationParams = {
  userProfile: { currentAge: 52, retirementAge: 60, expectancy: 88, targetMonthlySpending: 3_000_000 },
  retirementGoals: [
    { type: 'LIVING_EXPENSE_STABILITY', priority: 1, targetValue: 3_000_000, constraintType: 'SOFT' },
    { type: 'PENSION_OPTIMIZATION', priority: 2, constraintType: 'SOFT' },
  ],
  assets: [
    {
      id: 'a1', type: 'etf', ticker: 'KODEX200', name: 'KODEX 200',
      quantity: 1, averagePrice: 450_000_000,
      totalReturn: 5, dividendYield: 2, monthlyContribution: 500_000,
      reinvestDividend: true, currency: 'KRW',
    },
  ],
  isaAccounts: [],
  nationalPension: { expectedMonthlyAmount: 1_100_000 },
  privatePensions: [],
  otherIncomes: [],
  inflationRate: 2.5,
  inflationMode: 'real',
  baseExchangeRate: 1400,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
  yieldPreset: 'base',
};

const compiled = compileStrategy(params);
const effective = compiled.params;
const input = LegacySimulationAdapter.fromLegacy(effective);

const recommendations = new StrategyOptimizer(engine, undefined, undefined, new MonteCarloEngine(engine))
  .optimize(input.profile, input.goals, input.strategy, {
    monteCarlo: { config: resolveMonteCarloConfig(effective), finalistLimit: 3 },
  })
  .recommendations?.recommendations ?? [];

/** 인출 축만 사용자의 현재 값으로 되돌린 전략. */
function withCurrentWithdrawalPolicy(strategy: RetirementStrategy): RetirementStrategy {
  const withdrawalPolicy = { ...strategy.withdrawalPolicy };
  const current = effective.withdrawalPlan?.accountWithdrawalPolicy;
  if (current === undefined) delete withdrawalPolicy.accountWithdrawalPolicy;
  else withdrawalPolicy.accountWithdrawalPolicy = current;
  return { ...strategy, withdrawalPolicy };
}

describe('사적연금도 ISA도 없는 계획의 추천 카드', () => {
  test('추천이 실제로 만들어졌다', () => {
    // 아래 테스트가 빈 배열 위에서 조용히 통과하는 것을 막는다.
    expect(recommendations.length).toBeGreaterThan(0);
  });

  test('인출 변경점을 내걸었다면 그 변경이 원장을 움직인다', () => {
    for (const recommendation of recommendations) {
      const { strategy } = recommendation.candidate.candidate;
      const changes = describeStrategyChanges(effective, recommendation.candidate, String);
      if (!changes.some((change) => change.label === '자산 인출')) continue;

      const advertised = engine.simulate(input.profile, strategy);
      const reverted = engine.simulate(input.profile, withCurrentWithdrawalPolicy(strategy));

      expect(JSON.stringify(advertised), recommendation.label)
        .not.toBe(JSON.stringify(reverted));
    }
  });

  test('현재 값과 같은 정책을 새 값으로 적어 두지 않는다', () => {
    // 위 테스트를 「인출 변경점이 하나도 없다」로 통과시키는 길이 남아 있으므로, 그 길이
    // 실제로 옳은 이유(후보가 사용자의 미지정을 그대로 물려받았다)를 함께 못 박는다.
    for (const recommendation of recommendations) {
      const changes = describeStrategyChanges(effective, recommendation.candidate, String);
      if (changes.some((change) => change.label === '자산 인출')) continue;

      expect(
        recommendation.candidate.candidate.strategy.withdrawalPolicy.accountWithdrawalPolicy,
        recommendation.label,
      ).toBe(effective.withdrawalPlan?.accountWithdrawalPolicy);
    }
  });
});
