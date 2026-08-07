import { describe, test, expect, vi } from 'vitest';
import { runMonteCarlo } from '@/core/usecases/montecarlo/MonteCarloEngine';
import { resolveMonteCarloConfig, VOLATILITY_BY_YIELD_PRESET } from '@/core/usecases/montecarlo/volatilityPresets';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { SimulationParams } from '@/core/entities/types';
import { MonteCarloConfig } from '@/core/entities/montecarlo';

const engine = new SimulationEngine();

function params(overrides: Partial<SimulationParams> = {}): SimulationParams {
  return {
    userProfile: { currentAge: 55, retirementAge: 60, expectancy: 85, targetMonthlySpending: 2500000 },
    assets: [
      { id: 'a1', type: 'etf', ticker: 'SPY', name: 'S&P500', quantity: 400, averagePrice: 500000,
        annualGrowthRate: 7, dividendYield: 2, monthlyContribution: 500000, reinvestDividend: true, currency: 'KRW' },
    ],
    isaAccounts: [],
    nationalPension: { expectedMonthlyAmount: 1000000 },
    privatePensions: [
      { id: 'p1', type: 'irp', balance: 50000000, monthlyContribution: 300000, annualReturn: 4, currency: 'KRW' },
    ],
    otherIncomes: [],
    inflationRate: 2,
    inflationMode: 'real',
    baseExchangeRate: 1350,
    exchangeScenario: 'base',
    displayCurrency: 'KRW',
    ...overrides,
  };
}

function config(overrides: Partial<MonteCarloConfig> = {}): MonteCarloConfig {
  return { trials: 200, seed: 2026, annualStdDev: 15, ...overrides };
}

describe('runMonteCarlo', () => {
  // **σ=0이면 몬테카를로는 결정론이어야 한다.**
  //
  // 이 테스트가 MC 전체의 회귀 장치다: 확률 계층이 엔진 결과를 어떤 식으로든 왜곡하면
  // 여기서 잡힌다. 분위수도 전부 같은 값이어야 한다(모든 시행이 동일하므로).
  test('변동성이 0이면 모든 시행이 결정론 결과와 정확히 일치한다', () => {
    const deterministic = engine.runSingle(params());
    const mc = runMonteCarlo(params(), engine, config({ annualStdDev: 0, trials: 10 }));

    expect(mc.endingAssets.p10).toBeCloseTo(deterministic.endingAssets, 6);
    expect(mc.endingAssets.p50).toBeCloseTo(deterministic.endingAssets, 6);
    expect(mc.endingAssets.p90).toBeCloseTo(deterministic.endingAssets, 6);
    expect(mc.deterministicEndingAssets).toBeCloseTo(deterministic.endingAssets, 6);
  });

  test('같은 시드는 완전히 같은 결과를 준다', () => {
    const a = runMonteCarlo(params(), engine, config());
    const b = runMonteCarlo(params(), engine, config());

    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test('다른 시드는 다른 결과를 준다', () => {
    const a = runMonteCarlo(params(), engine, config({ seed: 1 }));
    const b = runMonteCarlo(params(), engine, config({ seed: 2 }));

    expect(a.endingAssets.p50).not.toBe(b.endingAssets.p50);
  });

  test('성공률은 0과 1 사이다', () => {
    const mc = runMonteCarlo(params(), engine, config());

    expect(mc.successRate).toBeGreaterThanOrEqual(0);
    expect(mc.successRate).toBeLessThanOrEqual(1);
  });

  test('모든 해에서 p10 ≤ p50 ≤ p90이다', () => {
    const mc = runMonteCarlo(params(), engine, config());

    expect(mc.assetBand.length).toBeGreaterThan(0);
    for (const year of mc.assetBand) {
      expect(year.p10).toBeLessThanOrEqual(year.p50);
      expect(year.p50).toBeLessThanOrEqual(year.p90);
    }
  });

  test('변동성이 커지면 결과 분포가 넓어진다', () => {
    const narrow = runMonteCarlo(params(), engine, config({ annualStdDev: 5 }));
    const wide = runMonteCarlo(params(), engine, config({ annualStdDev: 25 }));

    const spread = (mc: typeof narrow) => mc.endingAssets.p90 - mc.endingAssets.p10;
    expect(spread(wide)).toBeGreaterThan(spread(narrow));
  });

  // **변동성 손실(volatility drag).**
  //
  // 충격의 기대값이 0이어도 복리로 굴리면 기하평균 < 산술평균이라 중앙값이 결정론보다
  // 낮게 나온다. 이건 버그가 아니라 "연 7%가 30년 내리 유지되는 경우는 거의 없다"는
  // 지적의 정량적 실체다. 숨기지 않고 이 방향을 테스트로 고정한다.
  test('변동성이 있으면 중앙값이 결정론 결과보다 낮다', () => {
    const mc = runMonteCarlo(params(), engine, config({ annualStdDev: 20, trials: 300 }));

    expect(mc.endingAssets.p50).toBeLessThan(mc.deterministicEndingAssets);
  });

  test('연도별 밴드는 시뮬레이션 연수와 같은 길이다', () => {
    const mc = runMonteCarlo(params(), engine, config({ trials: 20 }));

    expect(mc.assetBand).toHaveLength(85 - 55 + 1);
    expect(mc.assetBand[0].age).toBe(55);
    expect(mc.assetBand[mc.assetBand.length - 1].age).toBe(85);
  });

  test('시행 수와 시드를 결과에 남긴다', () => {
    const mc = runMonteCarlo(params(), engine, config({ trials: 37, seed: 99 }));

    expect(mc.trials).toBe(37);
    expect(mc.seed).toBe(99);
  });

  test('시행이 1회여도 동작한다', () => {
    const mc = runMonteCarlo(params(), engine, config({ trials: 1 }));

    expect(mc.trials).toBe(1);
    expect(Number.isFinite(mc.endingAssets.p50)).toBe(true);
  });

  // 성공 기준 나이는 본인 기대수명이 아니라 가구 종료 나이다. 배우자가 더 오래 사는
  // 계획에서 본인 기대수명을 쓰면 배우자 단독 생존 구간의 파산이 통째로 숨는다.
  test('성공 기준 나이는 가구 종료 나이다', () => {
    const withSpouse = params({
      spouse: { enabled: true, currentAge: 50, expectancy: 95, nationalPensionMonthlyAmount: 0, nationalPensionStartAge: 65 },
    });

    const mc = runMonteCarlo(withSpouse, engine, config({ trials: 10 }));

    expect(mc.successAge).toBe(engine.runSingle(withSpouse).householdEndAge);
  });

  test('고갈된 시행이 없으면 고갈 통계는 비어 있다', () => {
    // 충격 없이 넉넉한 계획이면 아무도 고갈되지 않는다.
    const mc = runMonteCarlo(params(), engine, config({ annualStdDev: 0, trials: 10 }));

    expect(mc.depletion.count).toBe(0);
    expect(mc.depletion.earliestAge).toBeNull();
    expect(mc.depletion.medianAge).toBeNull();
  });

  test('고갈된 시행이 있으면 가장 이른 나이를 보고한다', () => {
    // 자산이 거의 없는 계획이면 대부분 고갈된다.
    const poor = params({ assets: [], privatePensions: [], nationalPension: { expectedMonthlyAmount: 0 } });
    const mc = runMonteCarlo(poor, engine, config({ trials: 10 }));

    expect(mc.depletion.count).toBeGreaterThan(0);
    expect(mc.depletion.earliestAge).not.toBeNull();
    expect(mc.successRate).toBeLessThan(1);
  });

  // **max_sustainable은 시행 전에 한 번만 해소한다.**
  //
  // 시행마다 이진탐색을 다시 돌리면 그 시행이 겪을 미래를 미리 알고 생활비를 정하는 셈이라
  // (완벽한 예지력) 성공률이 구조적으로 100%에 붙는다. MC가 묻는 것은 "이 계획이 여러
  // 미래에서 얼마나 견디는가"지 "미래를 알았다면 얼마나 썼을까"가 아니다.
  test('max_sustainable 전략은 시행마다 생활비를 다시 탐색하지 않는다', () => {
    const spy = vi.spyOn(engine, 'runSingle');
    const maxSus = params({ spendingStrategy: 'max_sustainable' });

    runMonteCarlo(maxSus, engine, config({ trials: 5 }));

    // 시행마다 30회 이진탐색을 돌면 150회를 훌쩍 넘는다. 한 번만 해소하면
    // (해소 1회 = run() 31회) + 결정론 1회 + 시행 5회 수준에 머문다.
    expect(spy.mock.calls.length).toBeLessThan(60);
    spy.mockRestore();
  });

  test('max_sustainable 전략에서도 성공률이 100%에 고정되지 않는다', () => {
    const maxSus = params({ spendingStrategy: 'max_sustainable' });

    const mc = runMonteCarlo(maxSus, engine, config({ annualStdDev: 20, trials: 100 }));

    // 지속가능 최대치로 쓰면서 변동성을 겪으면 상당수 시행이 실패해야 정상이다.
    expect(mc.successRate).toBeLessThan(1);
  });

  test('목표 생활비를 온전히 쓴 시행의 비율을 함께 보고한다', () => {
    const mc = runMonteCarlo(params(), engine, config({ trials: 50 }));

    expect(mc.fullSpendingRate).toBeGreaterThanOrEqual(0);
    expect(mc.fullSpendingRate).toBeLessThanOrEqual(1);
    // 자산이 남아도 생활비를 못 쓴 시행이 있을 수 있으므로 성공률보다 클 수 없다.
    expect(mc.fullSpendingRate).toBeLessThanOrEqual(mc.successRate);
  });
});

describe('resolveMonteCarloConfig', () => {
  // 변동성을 새 입력 UI로 받지 않고 기존 리스크 성향(yieldPreset) 축에 얹는다.
  // 사용자는 이미 「투자 전략」에서 성향을 고르는데, 그 선택이 기대수익률만 바꾸고
  // 변동성은 안 바꾸는 것이 오히려 비일관이었다.
  test('수익률 프리셋에 따라 변동성이 정해진다', () => {
    expect(resolveMonteCarloConfig(params({ yieldPreset: 'conservative' })).annualStdDev)
      .toBe(VOLATILITY_BY_YIELD_PRESET.conservative);
    expect(resolveMonteCarloConfig(params({ yieldPreset: 'aggressive' })).annualStdDev)
      .toBe(VOLATILITY_BY_YIELD_PRESET.aggressive);
  });

  test('프리셋이 없거나 custom이면 base 변동성을 쓴다', () => {
    expect(resolveMonteCarloConfig(params()).annualStdDev).toBe(VOLATILITY_BY_YIELD_PRESET.base);
    expect(resolveMonteCarloConfig(params({ yieldPreset: 'custom' })).annualStdDev)
      .toBe(VOLATILITY_BY_YIELD_PRESET.base);
  });

  test('시드는 고정 상수다', () => {
    // 시각 기반이면 아무것도 바꾸지 않았는데 새로고침마다 성공률이 흔들린다.
    expect(resolveMonteCarloConfig(params()).seed).toBe(resolveMonteCarloConfig(params()).seed);
  });

  test('보수적일수록 변동성이 낮다', () => {
    expect(VOLATILITY_BY_YIELD_PRESET.conservative).toBeLessThan(VOLATILITY_BY_YIELD_PRESET.base);
    expect(VOLATILITY_BY_YIELD_PRESET.base).toBeLessThan(VOLATILITY_BY_YIELD_PRESET.aggressive);
  });
});
