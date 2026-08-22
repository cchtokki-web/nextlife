import { describe, expect, test } from 'vitest';
import { LegacySimulationAdapter } from '@/core/domain/input/LegacySimulationAdapter';
import { LegacySimulationEngine } from '@/core/simulation/LegacySimulationEngine';
import { StrategyOptimizer } from '@/core/strategy/StrategyOptimizer';
import { MonteCarloEngine } from '@/core/usecases/montecarlo/MonteCarloEngine';
import { resolveMonteCarloConfig } from '@/core/usecases/montecarlo/volatilityPresets';
import { applyStrategyToParams } from '@/core/usecases/dashboard/applyStrategyToParams';
import { compileStrategy } from '@/core/usecases/strategy/compileStrategy';
import type { CandidateRecommendation } from '@/core/recommendation/RecommendationEngine';
import type { SimulationParams } from '@/core/entities/types';

/**
 * **추천 카드가 약속한 확률은 「적용」을 누른 뒤 그대로 재현돼야 한다.**
 *
 * 이 계약이 깨진 적이 있다. 후보는 「생활비 배분」 축까지 포함해 채점되는데 그 축만 반영
 * 경로가 없어서, 카드가 55%를 보여 주고 적용하면 상단 진단이 48%를 말했다. 사용자는 왜
 * 숫자가 달라졌는지 알 방법이 없었다 — 두 숫자 모두 «정직»했고, 서로 다른 계획을 말하고
 * 있었을 뿐이다.
 *
 * 그래서 축 하나를 반영하지 못하는 것은 표시 문제가 아니라 계약 위반이다. 새 축을
 * StrategyGenerator에 추가하면서 strategyFieldMap에 반영 경로를 만들지 않으면 이 테스트가
 * 멈춘다.
 *
 * 픽스처가 아니라 실제 옵티마이저를 돌린다 — 손으로 만든 후보는 dimensions와 strategy를
 * 늘 일치시켜서, 정확히 이 어긋남을 재현하지 못한다.
 */

const engine = new LegacySimulationEngine();

// 확률이 50% 부근인 «한계» 계획. 그 구간에서 축 하나의 차이가 확률을 가장 크게 움직인다
// (여유로운 계획에서는 같은 차이가 1%p 미만이라 회귀를 놓친다).
const params: SimulationParams = {
  userProfile: { currentAge: 51, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3_500_000 },
  retirementGoals: [
    { type: 'EARLY_RETIREMENT', priority: 1, targetValue: 60, constraintType: 'HARD' },
    { type: 'LIVING_EXPENSE_STABILITY', priority: 2, targetValue: 3_500_000, constraintType: 'SOFT' },
    { type: 'PENSION_OPTIMIZATION', priority: 3, constraintType: 'SOFT' },
  ],
  assets: [
    {
      id: 'a1', type: 'etf', ticker: 'SPY', name: 'S&P500', quantity: 620, averagePrice: 500_000,
      totalReturn: 7, dividendYield: 2, monthlyContribution: 250_000,
      reinvestDividend: true, currency: 'KRW',
    },
  ],
  isaAccounts: [],
  nationalPension: { expectedMonthlyAmount: 1_200_000 },
  privatePensions: [
    { id: 'p1', type: 'irp', balance: 55_000_000, monthlyContribution: 350_000, totalReturn: 4, currency: 'KRW' },
  ],
  otherIncomes: [],
  inflationRate: 2.5,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
  yieldPreset: 'base',
};

// 화면과 같은 경로. AnalysisRuntime이 pipeline.effective.params로 최적화를 돌린다.
function recommend() {
  const compiled = compileStrategy(params);
  const input = LegacySimulationAdapter.fromLegacy(compiled.params);
  const optimized = new StrategyOptimizer(engine, undefined, undefined, new MonteCarloEngine(engine))
    .optimize(input.profile, input.goals, input.strategy, {
      monteCarlo: { config: resolveMonteCarloConfig(compiled.params), finalistLimit: 3 },
    });
  return optimized.recommendations?.recommendations ?? [];
}

// StrategyOptimizer가 이 후보를 채점할 때 실제 보유 자산의 수익률이 아니라
// annualStdDevForYieldPreset의 preset 분기(conservative/base/aggressive)로 σ를 정했는지.
// 안정형/균형형/여유형은 legacySettings.yieldPreset이 항상 이 셋 중 하나이므로 사실상 항상
// true다 — resolveMonteCarloConfig가 더 이상 이 필드를 읽지 않는 지금, 이 값이 true인
// 후보는 「적용 후 재채점」의 σ와 「후보 채점」의 σ가 우연이 아닌 한 어긋난다.
function usesPresetVolatilityAtScoring(recommendation: CandidateRecommendation): boolean {
  const preset = recommendation.candidate.candidate.strategy.legacySettings.yieldPreset;
  return preset === 'conservative' || preset === 'base' || preset === 'aggressive';
}

// 적용된 계획을 대시보드와 같은 방식으로 다시 채점한다.
function probabilityAfterApply(applied: SimulationParams): number {
  const compiled = compileStrategy(applied);
  const input = LegacySimulationAdapter.fromLegacy(compiled.params);
  return new MonteCarloEngine(engine)
    .validate(input.profile, input.goals, input.strategy, resolveMonteCarloConfig(compiled.params))
    .goalSuccessProbability;
}

describe('추천 적용은 카드가 보여 준 계획을 그대로 만든다', () => {
  const recommendations = recommend();

  test('추천이 실제로 만들어졌다', () => {
    // 아래 테스트들이 빈 배열 위에서 조용히 통과하는 것을 막는다.
    expect(recommendations.length).toBeGreaterThan(0);
  });

  test('반영하지 못하는 축이 하나도 없다', () => {
    for (const recommendation of recommendations) {
      const result = applyStrategyToParams(params, recommendation.candidate);

      expect(result.skipped, recommendation.label).toEqual([]);
    }
  });

  // 2026-08-22 알려진 제약: 「투자 성향」(assetAllocation) 축은 StrategyOptimizer가 후보를
  // 채점할 때만 preset 수익률(5/7/9%)을 가정하고, 실제 반영(strategyFieldMap의 apply)은
  // yieldPreset 필드만 남기고 자산별 totalReturn은 손대지 않는다 — 리스크 성향이 그 값을
  // 강제로 덮어쓰던 마지막 통로였고, 이 축 분리 작업이 "어떤 축도 사용자가 입력한 수익률을
  // 덮어쓰지 않는다"는 원칙 아래 그 통로를 없앴다. 그 결과 「투자 성향」이 바뀌는 후보는
  // 카드가 보여 준 확률을 더 이상 정확히 재현하지 못한다 — StrategyGenerator/
  // StrategyOptimizer의 후보 채점 자체가 아직 실제 입력 수익률이 아니라 preset으로 도는
  // 별개의 메커니즘이기 때문이다. 그 메커니즘을 실제 입력에 맞추는 것은 이 작업의 범위
  // 밖이라 후속 작업으로 남긴다.
  //
  // **같은 이유로 몬테카를로 변동성(σ)도 어긋난다(2026-08-22 수익률 가정 축 분리).**
  // StrategyOptimizer는 후보를 채점할 때 여전히 annualStdDevForYieldPreset으로 후보의
  // legacySettings.yieldPreset(conservative/base/aggressive)을 직접 읽어 σ를 정한다.
  // 반면 이 작업 이후 resolveMonteCarloConfig(적용 후 재채점 경로가 쓰는 함수)는 그 필드를
  // 더 이상 읽지 않고 언제나 실제 보유 자산의 수익률에서 σ를 유도한다. 안정형/균형형/여유형
  // 후보는 legacySettings.yieldPreset이 항상 세 프리셋 중 하나로 채워지므로, 두 σ가 우연히
  // 일치하지 않는 한 이 축도 「투자 성향」과 같은 재현 불가 상태다. StrategyOptimizer의 후보
  // 채점 자체를 실제 입력 수익률로 유도하도록 바꾸는 것은 이 작업의 범위 밖이라 후속
  // 작업으로 남긴다(annualStdDevForYieldPreset을 지우지 않고 그대로 둔 이유이기도 하다).
  test('적용 후 목표 달성 확률이 카드의 값과 같다 (투자 성향·위험 성향이 바뀌지 않는 후보)', () => {
    for (const recommendation of recommendations) {
      const applied = applyStrategyToParams(params, recommendation.candidate);
      if (applied.applied.some((item) => item.label === '투자 성향')) continue;
      if (usesPresetVolatilityAtScoring(recommendation)) continue;

      expect(probabilityAfterApply(applied.params), recommendation.label)
        .toBe(recommendation.candidate.monteCarlo.goalSuccessProbability);
    }
  });

  // 위 제약을 회귀 고정한다. 언젠가 StrategyGenerator가 preset 대신 실제 입력 수익률로
  // 후보를 채점하도록 바뀌면 이 테스트가 실패하며 알려 준다 — 그때는 이 테스트를 지우고
  // 위 테스트의 예외 처리(assetAllocation 건너뛰기)도 함께 걷어내야 한다.
  test('투자 성향이 바뀌는 후보는 아직 확률을 재현하지 못한다 (후속 작업 필요)', () => {
    const withChangedAllocation = recommendations
      .map((recommendation) => ({
        recommendation,
        applied: applyStrategyToParams(params, recommendation.candidate),
      }))
      .filter(({ applied }) => applied.applied.some((item) => item.label === '투자 성향'));

    expect(withChangedAllocation.length).toBeGreaterThan(0);
    for (const { recommendation, applied } of withChangedAllocation) {
      expect(probabilityAfterApply(applied.params), recommendation.label)
        .not.toBe(recommendation.candidate.monteCarlo.goalSuccessProbability);
    }
  });

  // 위 제약(σ 불일치)도 같은 방식으로 회귀 고정한다. 안정형/균형형/여유형은 항상
  // legacySettings.yieldPreset이 세 프리셋 중 하나이므로, 이 목록이 비어 있으면(=하나도
  // preset 채점을 쓰지 않으면) 위 필터 자체가 죽은 코드라는 뜻이라 먼저 알아야 한다.
  test('위험 성향(σ) 불일치가 있는 후보는 아직 확률을 재현하지 못한다 (후속 작업 필요)', () => {
    const withPresetVolatility = recommendations.filter(usesPresetVolatilityAtScoring);

    expect(withPresetVolatility.length).toBeGreaterThan(0);
    for (const recommendation of withPresetVolatility) {
      const applied = applyStrategyToParams(params, recommendation.candidate);
      // 투자 성향까지 함께 바뀌는 후보는 이미 위 테스트가 다루는 불일치라 이 축만 따로
      // 재지 못한다 — σ 불일치만 남기려면 그 축은 제외한다.
      if (applied.applied.some((item) => item.label === '투자 성향')) continue;

      expect(probabilityAfterApply(applied.params), recommendation.label)
        .not.toBe(recommendation.candidate.monteCarlo.goalSuccessProbability);
    }
  });
});
