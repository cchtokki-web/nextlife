import { describe, test, expect } from 'vitest';
import { applyYieldPreset, restoreCustomYieldPreset, YIELD_PRESET_RATES } from '@/core/usecases/scenario/applyYieldPreset';
import { priceGrowthRate } from '@/core/usecases/returns/decomposeReturn';
import { SimulationParams } from '@/core/entities/types';
import { compileStrategy } from '@/core/usecases/strategy/compileStrategy';
import { normalizeSimulationParams } from '@/infrastructure/storage/normalizeSimulationParams';

const baseParams: SimulationParams = {
  userProfile: { currentAge: 55, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3000000 },
  assets: [
    {
      id: 'a1',
      type: 'stock',
      ticker: 'AAA',
      name: '자산1',
      quantity: 10,
      averagePrice: 1000,
      totalReturn: 1,
      dividendYield: 2,
      monthlyContribution: 0,
      reinvestDividend: false,
      currency: 'KRW',
    },
  ],
  nationalPension: { expectedMonthlyAmount: 0 },
  privatePensions: [
    { id: 'p1', type: 'irp', balance: 10000000, monthlyContribution: 0, totalReturn: 1, currency: 'KRW' },
  ],
  otherIncomes: [],
  inflationRate: 0,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

describe('applyYieldPreset', () => {
  test('conservative 프리셋은 자산 totalReturn를 5, 연금 totalReturn을 3으로 설정한다', () => {
    const result = applyYieldPreset(baseParams, 'conservative');
    expect(result.assets[0].totalReturn).toBe(5);
    expect(result.privatePensions[0].totalReturn).toBe(3);
    expect(result.yieldPreset).toBe('conservative');
  });

  test('base 프리셋은 자산 totalReturn를 7, 연금 totalReturn을 4로 설정한다', () => {
    const result = applyYieldPreset(baseParams, 'base');
    expect(result.assets[0].totalReturn).toBe(7);
    expect(result.privatePensions[0].totalReturn).toBe(4);
    expect(result.yieldPreset).toBe('base');
  });

  test('aggressive 프리셋은 자산 totalReturn를 9, 연금 totalReturn을 6으로 설정한다', () => {
    const result = applyYieldPreset(baseParams, 'aggressive');
    expect(result.assets[0].totalReturn).toBe(9);
    expect(result.privatePensions[0].totalReturn).toBe(6);
    expect(result.yieldPreset).toBe('aggressive');
  });

  test('자산/연금이 여러 개면 모두 동일한 값으로 매핑한다', () => {
    const params: SimulationParams = {
      ...baseParams,
      assets: [
        { ...baseParams.assets[0], id: 'a1' },
        { ...baseParams.assets[0], id: 'a2' },
      ],
      privatePensions: [
        { ...baseParams.privatePensions[0], id: 'p1' },
        { ...baseParams.privatePensions[0], id: 'p2' },
      ],
    };
    const result = applyYieldPreset(params, 'aggressive');
    expect(result.assets.map((a) => a.totalReturn)).toEqual([9, 9]);
    expect(result.privatePensions.map((p) => p.totalReturn)).toEqual([6, 6]);
  });

  // B1: ISA도 totalReturn을 가진 투자 계좌다. 리스크 성향 프리셋에서만 빼두면
  // "보수적"을 골라도 ISA만 홀로 높은 수익률을 유지해 계좌 간 서열이 뒤집힌다.
  test('ISA 계좌 totalReturn도 주식과 같은 값으로 설정한다', () => {
    const withIsa: SimulationParams = {
      ...baseParams,
      isaAccounts: [{
        id: 'i1', type: 'general', balance: 1000, monthlyContribution: 0,
        totalReturn: 12, dividendYield: 1.5, currency: 'KRW', maturityYears: 3,
      }],
    };

    expect(applyYieldPreset(withIsa, 'conservative').isaAccounts![0].totalReturn).toBe(5);
    expect(applyYieldPreset(withIsa, 'aggressive').isaAccounts![0].totalReturn).toBe(9);
  });

  test('yieldPreset이 custom이면 ISA 직접입력 값도 스냅샷에 보관하고 복원한다', () => {
    const customParams: SimulationParams = {
      ...baseParams,
      yieldPreset: 'custom',
      isaAccounts: [{
        id: 'i1', type: 'general', balance: 1000, monthlyContribution: 0,
        totalReturn: 12.5, dividendYield: 1.5, currency: 'KRW', maturityYears: 3,
      }],
    };

    const applied = applyYieldPreset(customParams, 'aggressive');
    expect(applied.customYieldSnapshot?.isaAccounts).toEqual({ i1: 12.5 });

    expect(restoreCustomYieldPreset(applied).isaAccounts![0].totalReturn).toBe(12.5);
  });

  // 과거에 저장된 스냅샷에는 isaAccounts 키가 없다. 복원이 그 위에서 터지면 안 된다.
  test('isaAccounts가 없는 옛 스냅샷으로도 복원할 수 있다', () => {
    const params: SimulationParams = {
      ...baseParams,
      yieldPreset: 'aggressive',
      isaAccounts: [{
        id: 'i1', type: 'general', balance: 1000, monthlyContribution: 0,
        totalReturn: 9, dividendYield: 1.5, currency: 'KRW', maturityYears: 3,
      }],
      customYieldSnapshot: { assets: { a1: 12.5 }, privatePensions: { p1: 2.5 } },
    };

    const result = restoreCustomYieldPreset(params);

    expect(result.isaAccounts![0].totalReturn).toBe(9);
    expect(result.assets[0].totalReturn).toBe(12.5);
  });

  test('assets/privatePensions가 undefined여도 크래시 없이 빈 배열로 처리한다', () => {
    const params = { ...baseParams, assets: undefined, privatePensions: undefined } as unknown as SimulationParams;
    const result = applyYieldPreset(params, 'base');
    expect(result.assets).toEqual([]);
    expect(result.privatePensions).toEqual([]);
  });

  test('userProfile 등 자산/연금/yieldPreset 이외의 필드는 변경하지 않는다', () => {
    const result = applyYieldPreset(baseParams, 'conservative');
    expect(result.userProfile).toEqual(baseParams.userProfile);
    expect(result.displayCurrency).toBe(baseParams.displayCurrency);
    expect(result.inflationRate).toBe(baseParams.inflationRate);
  });

  test('yieldPreset이 custom일 때 다른 프리셋을 적용하면 직전 직접입력 값을 customYieldSnapshot에 저장한다', () => {
    const customParams: SimulationParams = {
      ...baseParams,
      yieldPreset: 'custom',
      assets: [{ ...baseParams.assets[0], id: 'a1', totalReturn: 12.5 }],
      privatePensions: [{ ...baseParams.privatePensions[0], id: 'p1', totalReturn: 2.5 }],
    };
    const result = applyYieldPreset(customParams, 'aggressive');
    // ISA가 없는 시나리오도 assets/privatePensions와 같은 관례로 빈 맵을 남긴다.
    expect(result.customYieldSnapshot).toEqual({ assets: { a1: 12.5 }, privatePensions: { p1: 2.5 }, isaAccounts: {} });
    expect(result.assets[0].totalReturn).toBe(9);
  });

  test('이미 프리셋 상태에서 다른 프리셋으로 바꾸면 기존 customYieldSnapshot을 유지한다', () => {
    const snapshot = { assets: { a1: 12.5 }, privatePensions: { p1: 2.5 } };
    const params: SimulationParams = { ...baseParams, yieldPreset: 'conservative', customYieldSnapshot: snapshot };
    const result = applyYieldPreset(params, 'aggressive');
    expect(result.customYieldSnapshot).toEqual(snapshot);
  });
});

describe('restoreCustomYieldPreset', () => {
  test('customYieldSnapshot이 있으면 id 기준으로 자산/연금 값을 복원하고 yieldPreset을 custom으로 되돌린다', () => {
    const params: SimulationParams = {
      ...baseParams,
      yieldPreset: 'aggressive',
      assets: [{ ...baseParams.assets[0], id: 'a1', totalReturn: 9 }],
      privatePensions: [{ ...baseParams.privatePensions[0], id: 'p1', totalReturn: 6 }],
      customYieldSnapshot: { assets: { a1: 12.5 }, privatePensions: { p1: 2.5 } },
    };
    const result = restoreCustomYieldPreset(params);
    expect(result.assets[0].totalReturn).toBe(12.5);
    expect(result.privatePensions[0].totalReturn).toBe(2.5);
    expect(result.yieldPreset).toBe('custom');
  });

  test('스냅샷에 없는 자산 id는 현재 값을 그대로 유지한다', () => {
    const params: SimulationParams = {
      ...baseParams,
      yieldPreset: 'aggressive',
      assets: [{ ...baseParams.assets[0], id: 'a2', totalReturn: 9 }],
      customYieldSnapshot: { assets: { a1: 12.5 }, privatePensions: {} },
    };
    const result = restoreCustomYieldPreset(params);
    expect(result.assets[0].totalReturn).toBe(9);
  });

  test('customYieldSnapshot이 없으면 값은 그대로 두고 yieldPreset만 custom으로 바꾼다', () => {
    const params: SimulationParams = { ...baseParams, yieldPreset: 'base' };
    const result = restoreCustomYieldPreset(params);
    expect(result.assets[0].totalReturn).toBe(baseParams.assets[0].totalReturn);
    expect(result.yieldPreset).toBe('custom');
  });
});

describe('저장된 프리셋이 계획을 지배하지 않는다', () => {
  // 2026-08-22 실측: 저장된 riskProfile 'conservative' 하나가 8개 계좌의 총수익률을
  // 5%/3%로 갈아치우고 있었다. QQQ 9.5%도 SCHD 7%도 무시되어, 종목을 무엇으로 담아도
  // 결과가 같았다. 이 테스트가 그 상태로 되돌아가는 것을 막는다.
  test('conservative가 저장돼 있어도 자산별 입력값으로 계산한다', () => {
    const raw = {
      userProfile: { currentAge: 51, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3_000_000 },
      assets: [
        { id: 'q', type: 'etf', ticker: 'QQQ', name: 'QQQ', quantity: 1, averagePrice: 10_000_000,
          totalReturn: 9.5, dividendYield: 0.4, monthlyContribution: 0,
          reinvestDividend: true, currency: 'KRW', assetMarket: 'US_ETF' },
      ],
      privatePensions: [
        { id: 'p', type: 'irp', investmentType: 'etf', name: 'IRP', balance: 30_000_000,
          monthlyContribution: 0, totalReturn: 6.4, dividendYield: 2.9, currency: 'KRW' },
      ],
      isaAccounts: [
        { id: 'i', type: 'general', investmentType: 'etf', name: 'ISA', balance: 5_000_000,
          monthlyContribution: 0, totalReturn: 7, dividendYield: 3, currency: 'KRW', maturityYears: 3 },
      ],
      otherIncomes: [],
      nationalPension: { expectedMonthlyAmount: 2_000_000 },
      inflationRate: 2.5, inflationMode: 'real', baseExchangeRate: 1400,
      exchangeScenario: 'base', displayCurrency: 'KRW',
      strategy: { riskProfile: 'conservative', economicScenario: 'ai_recommended' },
    };

    const compiled = compileStrategy(normalizeSimulationParams(raw));

    expect(compiled.params.assets[0].totalReturn).toBe(9.5);
    expect(compiled.params.privatePensions[0].totalReturn).toBe(6.4);
    expect(compiled.params.isaAccounts![0].totalReturn).toBe(7);
  });
});

// **총수익률 / 배당률 / 가격상승률의 관계를 고정한다.**
//
// 케이스 하나가 아니라 세 값의 «관계»를 고정하는 것이 이 스위트의 요점이다. 앞으로 이 축을
// 상대 shock으로 바꾸든 프리셋 값을 갈든, 아래 불변식은 유지돼야 한다.
//
// 계기: 프리셋이 totalReturn만 덮고 dividendYield는 그대로 두어, 총수익률 13% / 배당률 10%인
// 커버드콜에 중립형(7%)을 얹으면 가격상승률이 −3%가 됐다. 「시장이 7% 수익률이라면」이 아니라
// 「이 상품이 평생 버는 것보다 많이 분배한다면」을 재는 상태였고, 민감도 분석에서 기준
// 기말자산 14.58억이 851만원으로 무너지는 비선형 절벽으로 나타났다.
describe('applyYieldPreset - 총수익률/배당률/가격상승률 불변식', () => {
  const PRESETS = ['conservative', 'base', 'aggressive'] as const;

  // 프리셋별 자산 기대 총수익률. YIELD_PRESET_RATES를 그대로 읽어 표를 두 벌로 두지 않는다.
  const stockGrowthOf = (preset: typeof PRESETS[number]) => YIELD_PRESET_RATES[preset].stockGrowth;

  function paramsWith(asset: { totalReturn: number; dividendYield: number }): SimulationParams {
    return {
      ...baseParams,
      assets: [{ ...baseParams.assets[0], ...asset }],
      isaAccounts: [{
        id: 'i1', type: 'general', balance: 1_000_000, monthlyContribution: 0,
        totalReturn: asset.totalReturn, dividendYield: asset.dividendYield,
        currency: 'KRW', maturityYears: 3,
      }],
    };
  }

  // 가격상승률이 «양수»인 평범한 ETF와, 분배금이 총수익을 넘어 NAV가 줄어드는 커버드콜.
  // 두 방향을 모두 넣는다 — 한쪽만 보면 「음수를 0으로 자르는」 수정과 구별되지 않는다.
  const GROWTH_POSITIVE = { totalReturn: 13, dividendYield: 10 };
  const GROWTH_NEGATIVE = { totalReturn: 10, dividendYield: 12 };

  // 불변식 1. 분해 항등식이 성립하고, 총수익률은 정확히 프리셋 값이다.
  test.each(PRESETS)('%s: totalReturn은 프리셋 값이고 가격상승률은 총수익률 − 배당률이다', (preset) => {
    for (const asset of [GROWTH_POSITIVE, GROWTH_NEGATIVE]) {
      const result = applyYieldPreset(paramsWith(asset), preset);

      for (const account of [result.assets[0], result.isaAccounts![0]]) {
        expect(account.totalReturn).toBe(stockGrowthOf(preset));
        expect(priceGrowthRate(account.totalReturn, account.dividendYield))
          .toBeCloseTo(account.totalReturn - account.dividendYield, 10);
      }
    }
  });

  // 불변식 2. 배당 비중이 보존되고, 따라서 가격상승률의 «부호»도 보존된다.
  // 프리셋은 시장 수익률 가정을 바꾸는 것이지 사용자가 담은 상품의 성격을 바꾸는 것이 아니다.
  test.each(PRESETS)('%s: 배당 비중과 가격상승률 부호가 보존된다', (preset) => {
    for (const asset of [GROWTH_POSITIVE, GROWTH_NEGATIVE]) {
      const before = paramsWith(asset).assets[0];
      const after = applyYieldPreset(paramsWith(asset), preset).assets[0];

      expect(after.dividendYield / after.totalReturn)
        .toBeCloseTo(before.dividendYield / before.totalReturn, 10);
      expect(Math.sign(priceGrowthRate(after.totalReturn, after.dividendYield)))
        .toBe(Math.sign(priceGrowthRate(before.totalReturn, before.dividendYield)));
    }
  });

  // 회귀 고정: 고쳐야 했던 그 조합에서 가격상승률이 실제로 양수로 남는가.
  test('배당률이 높은 자산도 프리셋 적용 후 원금이 녹지 않는다', () => {
    const after = applyYieldPreset(paramsWith(GROWTH_POSITIVE), 'base').assets[0];

    // 13% / 10% → 7%로 낮추면 배당은 7 × (10/13) ≈ 5.38%, 가격상승률 ≈ +1.62%.
    expect(after.dividendYield).toBeCloseTo(7 * (10 / 13), 10);
    expect(priceGrowthRate(after.totalReturn, after.dividendYield)).toBeGreaterThan(0);
  });

  // 불변식 3. 경계.
  test('배당률 0은 0으로 남는다', () => {
    const after = applyYieldPreset(paramsWith({ totalReturn: 8, dividendYield: 0 }), 'aggressive').assets[0];

    expect(after.dividendYield).toBe(0);
    expect(priceGrowthRate(after.totalReturn, after.dividendYield)).toBe(9);
  });

  test('총수익률이 0 이하이면 비율을 낼 수 없으므로 배당률을 새 총수익률로 자른다', () => {
    for (const totalReturn of [0, -3]) {
      const after = applyYieldPreset(paramsWith({ totalReturn, dividendYield: 4 }), 'conservative').assets[0];

      expect(after.totalReturn).toBe(5);
      expect(after.dividendYield).toBe(4);
      expect(priceGrowthRate(after.totalReturn, after.dividendYield)).toBeGreaterThanOrEqual(0);
    }
  });

  test('총수익률이 0 이하이고 배당률이 프리셋보다 높으면 프리셋 값으로 잘린다', () => {
    const after = applyYieldPreset(paramsWith({ totalReturn: 0, dividendYield: 8 }), 'conservative').assets[0];

    expect(after.dividendYield).toBe(5);
    expect(priceGrowthRate(after.totalReturn, after.dividendYield)).toBe(0);
  });

  // 불변식 4. 사적연금은 분해하지 않는다 — 연금 계좌 안에는 배당세도 재투자 선택지도 없어
  // 총수익률만이 결과를 결정한다(decomposeReturn.ts의 명시적 규약).
  test.each(PRESETS)('%s: 사적연금은 totalReturn만 바뀐다', (preset) => {
    const before = baseParams.privatePensions[0];
    const after = applyYieldPreset(baseParams, preset).privatePensions[0];

    expect(after.totalReturn).toBe(YIELD_PRESET_RATES[preset].pensionReturn);
    expect({ ...after, totalReturn: before.totalReturn }).toEqual(before);
  });

  // 불변식 5. 세 프리셋은 순서를 가진다 — 총수익률과 배당률이 «함께» 단조 증가한다.
  // 배당률이 따라 움직이지 않으면 이 단조성이 깨지고 그 자리가 곧 예전의 절벽이었다.
  test('conservative → base → aggressive 순으로 총수익률과 배당률이 함께 커진다', () => {
    const applied = PRESETS.map((preset) => applyYieldPreset(paramsWith(GROWTH_POSITIVE), preset).assets[0]);

    for (let i = 1; i < applied.length; i++) {
      expect(applied[i].totalReturn).toBeGreaterThan(applied[i - 1].totalReturn);
      expect(applied[i].dividendYield).toBeGreaterThan(applied[i - 1].dividendYield);
    }
  });
});
