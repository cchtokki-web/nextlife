import { describe, expect, test } from 'vitest';
import { runMonteCarlo } from '@/core/usecases/montecarlo/MonteCarloEngine';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { resolveTaxSettings } from '@/core/usecases/tax/taxRates';
import type { SimulationParams } from '@/core/entities/types';
import type { MonteCarloConfig } from '@/core/entities/montecarlo';

const engine = new SimulationEngine();

const config = (over: Partial<MonteCarloConfig> = {}): MonteCarloConfig =>
  ({ trials: 200, seed: 2026, annualStdDev: 15, ...over });

// 자산 고갈 방지만 HARD, 생활비 안정은 SOFT인 계획. 사적연금을 저율과세 한도
// (연 1,500만원 → 월 125만원) 내로 강제(limitPrivatePensionToTaxLimit: true)하면 그 상한이
// 목표 생활비(월 500만원)에 훨씬 못 미쳐 «자산은 남아 있는데 인출이 막혀» 생활비 목표를
// 못 채우는 시행이 나온다(MonteCarloResult.goalFailure 주석의 「사적연금 최소 인출」과 같은
// 사례). 그 결과 전체 성공률(두 조건 모두 요구)은 0에 가깝게 붕괴하지만, 자산 고갈 방지만
// 보는 HARD 성공률은 그 상한 인출로도 잔액이 충분히 버텨 훨씬 높게 남는다 — 두 값이
// 표본오차 수준이 아니라 자릿수 단위로 갈라진다.
function params(overrides: Partial<SimulationParams> = {}): SimulationParams {
  return {
    userProfile: { currentAge: 55, retirementAge: 60, expectancy: 85, targetMonthlySpending: 5_000_000 },
    assets: [],
    isaAccounts: [],
    nationalPension: { expectedMonthlyAmount: 1_000_000 },
    privatePensions: [
      { id: 'p1', type: 'irp', balance: 400_000_000, monthlyContribution: 0, totalReturn: 4, currency: 'KRW' },
    ],
    otherIncomes: [],
    inflationRate: 2,
    inflationMode: 'real',
    baseExchangeRate: 1350,
    exchangeScenario: 'base',
    displayCurrency: 'KRW',
    taxSettings: resolveTaxSettings({ limitPrivatePensionToTaxLimit: true }),
    retirementGoals: [
      { type: 'ASSET_SURVIVAL', constraintType: 'HARD', priority: 1 },
      { type: 'LIVING_EXPENSE_STABILITY', constraintType: 'SOFT', priority: 2 },
    ],
    ...overrides,
  };
}

describe('runMonteCarlo — HARD 목표 성공률', () => {
  test('HARD 조건만 요구하므로 전체 성공률보다 높다', () => {
    const result = runMonteCarlo(params(), engine, config());

    expect(result.hardGoalSuccessProbability).toBeDefined();
    // 두 값이 같으면 픽스처가 판별력을 잃은 것이다 — 그 자체가 실패다.
    expect(result.hardGoalSuccessProbability!).toBeGreaterThan(result.goalSuccessProbability);
  });

  test('확정 HARD 목표가 없으면 모든 시행이 통과해 1이다', () => {
    const result = runMonteCarlo(
      params({ retirementGoals: [
        { type: 'ASSET_SURVIVAL', constraintType: 'SOFT', priority: 1 },
      ] }),
      engine, config({ trials: 100 }),
    );

    // 엔진은 언제나 숫자를 낸다. 「HARD가 없다」는 판단은 셀렉터가
    // conditions.hardRequirements를 보고 내린다 — 엔진이 undefined를 내면
    // 「계산 안 함」과 「HARD 없음」이 구분되지 않는다.
    expect(result.hardGoalSuccessProbability).toBe(1);
  });
});
