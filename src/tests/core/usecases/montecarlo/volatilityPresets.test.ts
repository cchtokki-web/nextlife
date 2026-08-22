import { describe, test, expect } from 'vitest';
import {
  resolveMonteCarloConfig,
  volatilityForStockReturn,
  VOLATILITY_BY_YIELD_PRESET,
} from '@/core/usecases/montecarlo/volatilityPresets';
import { YIELD_PRESET_RATES } from '@/core/usecases/scenario/applyYieldPreset';
import { InvestmentAsset, SimulationParams } from '@/core/entities/types';

function asset(overrides: Partial<InvestmentAsset> & { id: string }): InvestmentAsset {
  return {
    type: 'etf', ticker: 'X', name: '자산', quantity: 1, averagePrice: 100_000_000,
    totalReturn: 7, dividendYield: 0, monthlyContribution: 0,
    reinvestDividend: false, currency: 'KRW',
    ...overrides,
  };
}

function params(overrides: Partial<SimulationParams> = {}): SimulationParams {
  return {
    userProfile: { currentAge: 55, retirementAge: 60, expectancy: 85, targetMonthlySpending: 2500000 },
    assets: [asset({ id: 'a1' })],
    isaAccounts: [],
    nationalPension: { expectedMonthlyAmount: 0 },
    privatePensions: [],
    otherIncomes: [],
    inflationRate: 2,
    inflationMode: 'real',
    baseExchangeRate: 1350,
    exchangeScenario: 'base',
    displayCurrency: 'KRW',
    ...overrides,
  };
}

describe('volatilityForStockReturn', () => {
  // **가드.** 이 유도는 두 표(YIELD_PRESET_RATES · VOLATILITY_BY_YIELD_PRESET)가 한 직선
  // 위에 있다는 사실에 기댄다. 한쪽만 고치면 중립형 앵커가 선에서 벗어나고, 그때는 유도의
  // 전제가 사라진 것이므로 여기서 실패해야 한다.
  test('양 끝 앵커로 그은 직선이 중립형 앵커를 정확히 지난다', () => {
    expect(volatilityForStockReturn(YIELD_PRESET_RATES.base.stockGrowth))
      .toBeCloseTo(VOLATILITY_BY_YIELD_PRESET.base, 10);
  });

  test('프리셋과 같은 수익률은 그 프리셋의 변동성을 준다', () => {
    expect(volatilityForStockReturn(YIELD_PRESET_RATES.conservative.stockGrowth))
      .toBeCloseTo(VOLATILITY_BY_YIELD_PRESET.conservative, 10);
    expect(volatilityForStockReturn(YIELD_PRESET_RATES.aggressive.stockGrowth))
      .toBeCloseTo(VOLATILITY_BY_YIELD_PRESET.aggressive, 10);
  });

  test('앵커 사이는 선형 보간이다', () => {
    // 6% = 안정형(5%)과 중립형(7%)의 중간 → 10%p와 15%p의 중간
    expect(volatilityForStockReturn(6)).toBeCloseTo(12.5, 10);
  });

  // 저장소가 근거를 표명한 구간은 [안정형, 공격형]뿐이다. 밖으로 나가면 곧 음수 변동성이
  // 나오고(수익률 1%에서 0%p), 그건 이 표들이 말한 적 없는 세계다.
  test('프리셋 구간 밖은 양 끝으로 자른다', () => {
    expect(volatilityForStockReturn(0)).toBe(VOLATILITY_BY_YIELD_PRESET.conservative);
    expect(volatilityForStockReturn(-5)).toBe(VOLATILITY_BY_YIELD_PRESET.conservative);
    expect(volatilityForStockReturn(30)).toBe(VOLATILITY_BY_YIELD_PRESET.aggressive);
  });
});

describe('resolveMonteCarloConfig - 직접 입력 수익률에서 변동성 유도', () => {
  // **이 작업의 핵심.** 예전에는 자산에 3%를 넣든 12%를 넣든 변동성이 15%p로 같았다.
  // 수익률만 사용자 값을 쓰고 변동성은 남의 프리셋을 쓰는 비대칭이었다.
  test('custom 프리셋이면 보유 자산의 수익률에서 변동성을 유도한다', () => {
    const conservativeInput = params({ assets: [asset({ id: 'a', totalReturn: 5 })], yieldPreset: 'custom' });
    const aggressiveInput = params({ assets: [asset({ id: 'a', totalReturn: 9 })], yieldPreset: 'custom' });

    expect(resolveMonteCarloConfig(conservativeInput).annualStdDev)
      .toBeCloseTo(VOLATILITY_BY_YIELD_PRESET.conservative, 10);
    expect(resolveMonteCarloConfig(aggressiveInput).annualStdDev)
      .toBeCloseTo(VOLATILITY_BY_YIELD_PRESET.aggressive, 10);
  });

  test('프리셋이 미지정이어도 같은 유도를 쓴다', () => {
    const low = params({ assets: [asset({ id: 'a', totalReturn: 5 })] });

    expect(resolveMonteCarloConfig(low).annualStdDev)
      .toBeCloseTo(VOLATILITY_BY_YIELD_PRESET.conservative, 10);
  });

  // 잔액이 큰 자산이 포트폴리오의 성격을 결정한다. 단순평균이면 100만원짜리 고위험 자산
  // 하나가 10억짜리 안전 자산과 같은 무게를 갖는다.
  test('잔액으로 가중평균한다', () => {
    const weighted = params({
      yieldPreset: 'custom',
      assets: [
        asset({ id: 'big', totalReturn: 5, quantity: 1, averagePrice: 900_000_000 }),
        asset({ id: 'small', totalReturn: 9, quantity: 1, averagePrice: 100_000_000 }),
      ],
    });

    // 가중평균 = 5*0.9 + 9*0.1 = 5.4% → 안정형(10%p)에 가깝다
    expect(resolveMonteCarloConfig(weighted).annualStdDev)
      .toBeCloseTo(volatilityForStockReturn(5.4), 10);
  });

  // 통화를 무시하면 원화 자산이 환율만큼(약 1350배) 과대 가중된다.
  test('USD 자산은 환율로 환산해 가중한다', () => {
    const mixed = params({
      yieldPreset: 'custom',
      baseExchangeRate: 1000,
      assets: [
        asset({ id: 'krw', totalReturn: 5, quantity: 1, averagePrice: 100_000_000, currency: 'KRW' }),
        asset({ id: 'usd', totalReturn: 9, quantity: 1, averagePrice: 100_000, currency: 'USD' }),
      ],
    });

    // USD 10만 × 1000 = 1억 → 두 자산이 같은 무게 → 평균 7%
    expect(resolveMonteCarloConfig(mixed).annualStdDev)
      .toBeCloseTo(volatilityForStockReturn(7), 10);
  });

  test('ISA도 시장 연동 계좌이므로 함께 가중한다', () => {
    const withIsa = params({
      yieldPreset: 'custom',
      assets: [asset({ id: 'a', totalReturn: 5, quantity: 1, averagePrice: 100_000_000 })],
      isaAccounts: [{ id: 'i', type: 'general', balance: 100_000_000, monthlyContribution: 0,
        totalReturn: 9, dividendYield: 0, currency: 'KRW', maturityYears: 3 }],
    });

    expect(resolveMonteCarloConfig(withIsa).annualStdDev).toBeCloseTo(volatilityForStockReturn(7), 10);
  });

  // **예전에는 여기서 base로 되돌렸다.** 연금이 가중평균에서 통째로 빠져 있었기 때문이다.
  // 그 근거("연금은 어차피 상수 배율로 따로 줄어든다")는 배율이 계좌별로 유도되면서
  // 사라졌다 — 연금도 사용자가 넣은 수익률을 갖는 시장 연동 계좌다.
  test('연금만 보유해도 그 수익률에서 유도한다', () => {
    const pensionOnly = params({
      yieldPreset: 'custom',
      assets: [],
      isaAccounts: [],
      privatePensions: [{ id: 'p', type: 'irp', balance: 500_000_000, monthlyContribution: 0,
        totalReturn: 4, currency: 'KRW' }],
    });

    expect(resolveMonteCarloConfig(pensionOnly).annualStdDev)
      .toBeCloseTo(volatilityForStockReturn(4), 10);
    // 4%는 안정형 앵커(5%)보다 낮아 구간 하한에 걸린다 — base(15%p)가 아니다.
    expect(resolveMonteCarloConfig(pensionOnly).annualStdDev)
      .toBeLessThan(VOLATILITY_BY_YIELD_PRESET.base);
  });

  test('연금이 섞이면 가중평균이 그만큼 내려간다', () => {
    const mixed = params({
      yieldPreset: 'custom',
      assets: [asset({ id: 'a', totalReturn: 9, quantity: 1, averagePrice: 100_000_000 })],
      isaAccounts: [],
      privatePensions: [{ id: 'p', type: 'irp', balance: 100_000_000, monthlyContribution: 0,
        totalReturn: 3, currency: 'KRW' }],
    });

    // (100M×9 + 100M×3) / 200M = 6
    expect(resolveMonteCarloConfig(mixed).annualStdDev)
      .toBeCloseTo(volatilityForStockReturn(6), 10);
  });

  test('잔액이 전부 0이면 base로 되돌린다', () => {
    const empty = params({
      yieldPreset: 'custom',
      assets: [asset({ id: 'a', totalReturn: 9, quantity: 0, averagePrice: 0 })],
    });

    expect(resolveMonteCarloConfig(empty).annualStdDev).toBe(VOLATILITY_BY_YIELD_PRESET.base);
  });

  // **더 이상 프리셋을 읽지 않는다.** 화면은 strategy.riskProfile만 바꾸고
  // params.yieldPreset은 그대로 두므로, 프리셋이 자산 수익률과 어긋나 있어도(사용자가
  // 「입력 수익률 유지」를 고른 뒤 프리셋 라벨만 남은 상태) 실제 수익률에서 유도해야
  // 한다. 아래의 '변동성은 옛 프리셋이 아니라 실제 수익률에서 나온다' 스위트가 이
  // 회귀를 구체적인 수치로 고정한다.
  test('yieldPreset이 남아 있어도 자산 수익률에서 유도한다', () => {
    const conflicting = params({
      yieldPreset: 'conservative',
      assets: [asset({ id: 'a', totalReturn: 9 })],
    });

    expect(resolveMonteCarloConfig(conflicting).annualStdDev).toBe(VOLATILITY_BY_YIELD_PRESET.aggressive);
  });
});

describe('변동성은 옛 프리셋이 아니라 실제 수익률에서 나온다', () => {
  // 화면이 리스크 성향만 바꾸고 params.yieldPreset은 그대로 두므로, 프리셋 분기를
  // 남겨 두면 수익률은 사용자 값인데 변동성만 안정형 10%p로 굳는다. 실측 시나리오가
  // 정확히 그 상태였다 — 가중평균 총수익률 7.6%에 σ 10%p.
  test('yieldPreset이 남아 있어도 가중평균 총수익률에서 유도한다', () => {
    const params = {
      userProfile: { currentAge: 50, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3_000_000 },
      assets: [{
        id: 'a', type: 'etf', ticker: 'X', name: 'X', quantity: 1, averagePrice: 100_000_000,
        totalReturn: 9, dividendYield: 0, monthlyContribution: 0,
        reinvestDividend: true, currency: 'KRW', assetMarket: 'US_ETF',
      }],
      privatePensions: [], isaAccounts: [], otherIncomes: [],
      nationalPension: { expectedMonthlyAmount: 0 },
      inflationRate: 2.5, inflationMode: 'real', baseExchangeRate: 1400,
      exchangeScenario: 'base', displayCurrency: 'KRW',
      yieldPreset: 'conservative',
    } as unknown as SimulationParams;

    // 총수익률 9%는 volatilityForStockReturn의 상단 앵커라 20%p가 나와야 한다.
    // 프리셋을 읽으면 10%p가 된다.
    expect(resolveMonteCarloConfig(params).annualStdDev).toBe(20);
  });
});
