import { describe, test, expect } from 'vitest';
import {
  ECONOMIC_SCENARIO_PROFILES, GoverningEconomicScenario, applyEconomicScenario,
  isEconomicScenarioGoverning, resolveEconomicScenarioProfile,
} from '@/core/usecases/scenario/economicScenarios';
import { SimulationParams } from '@/core/entities/types';

const GOVERNING: GoverningEconomicScenario[] = [
  'long_term_average', 'recession', 'high_inflation', 'low_growth',
];

const params: SimulationParams = {
  userProfile: { currentAge: 50, retirementAge: 60, expectancy: 85, targetMonthlySpending: 3000000 },
  assets: [
    {
      id: 'a1', type: 'etf', ticker: 'X', name: 'X', quantity: 1, averagePrice: 1,
      totalReturn: 7, dividendYield: 2, monthlyContribution: 0,
      reinvestDividend: true, currency: 'KRW',
    },
  ],
  nationalPension: { expectedMonthlyAmount: 0 },
  privatePensions: [
    { id: 'p1', type: 'irp', balance: 1000, monthlyContribution: 0, totalReturn: 4, currency: 'KRW' },
  ],
  otherIncomes: [],
  inflationRate: 2.5,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

describe('ECONOMIC_SCENARIO_PROFILES', () => {
  test('AI 추천을 제외한 모든 시나리오에 프로필이 정의되어 있다', () => {
    for (const s of GOVERNING) {
      expect(ECONOMIC_SCENARIO_PROFILES[s], s).toBeDefined();
    }
  });

  // 네 프로필의 물가상승률·환율 시나리오 값을 통째로 고정해 회귀를 잡는다.
  // taxLawProfiles.test.ts가 이미 같은 방식으로 세율표를 고정하고 있다.
  test('네 프로필의 값이 정확히 고정되어 있다', () => {
    expect(ECONOMIC_SCENARIO_PROFILES).toEqual({
      long_term_average: { inflationRate: 2.5, exchangeScenario: 'base' },
      recession: { inflationRate: 1.5, exchangeScenario: 'usd_up' },
      high_inflation: { inflationRate: 5, exchangeScenario: 'usd_up' },
      low_growth: { inflationRate: 2, exchangeScenario: 'base' },
    });
  });

  test('고물가는 장기 평균보다 물가상승률이 높다', () => {
    expect(ECONOMIC_SCENARIO_PROFILES.high_inflation.inflationRate)
      .toBeGreaterThan(ECONOMIC_SCENARIO_PROFILES.long_term_average.inflationRate);
  });

  test('AI 추천(미정)에는 프로필이 없다', () => {
    // 프로필을 주면 사용자가 직접 입력한 물가상승률이 조용히 덮어써진다.
    // 이제 'ai_recommended'는 키 도메인에서 Exclude로 제거되어 있어, 이 테이블에 항목을
    // 채워 넣으려는 시도 자체가 컴파일 에러가 된다(런타임 단언은 그 보강이다).
    expect(resolveEconomicScenarioProfile('ai_recommended')).toBeNull();
    expect(Object.keys(ECONOMIC_SCENARIO_PROFILES)).not.toContain('ai_recommended');
    expect(isEconomicScenarioGoverning('ai_recommended')).toBe(false);
    expect(isEconomicScenarioGoverning('recession')).toBe(true);
  });

  test('알 수 없는 시나리오 값도 프로필 없음으로 떨어진다', () => {
    // 타입 가드는 통과하지만 테이블에 없는 값. 런타임 폴백(?? null)이 사라지면 여기가 깨진다.
    expect(resolveEconomicScenarioProfile('nope' as never)).toBeNull();
    expect(isEconomicScenarioGoverning('nope' as never)).toBe(false);
  });
});

describe('applyEconomicScenario', () => {
  test('물가와 환율만 교체한다', () => {
    const r = applyEconomicScenario(params, 'high_inflation');
    const profile = ECONOMIC_SCENARIO_PROFILES.high_inflation!;

    expect(r.inflationRate).toBe(profile.inflationRate);
    expect(r.exchangeScenario).toBe(profile.exchangeScenario);
    expect(r.assets[0].totalReturn).toBe(params.assets[0].totalReturn);
    expect(r.privatePensions[0].totalReturn).toBe(params.privatePensions[0].totalReturn);
  });

  // B1: ISA는 assets와 같은 시장 연동 계좌다(totalReturn + dividendYield로 성장하고
  // 엔진이 자기 totalReturn으로 굴린다). 수익률은 「내 포트폴리오의 가정」이라 경제
  // 시나리오가 아니라 사용자 입력이 유일한 출처여야 하므로, assets·privatePensions와
  // 마찬가지로 ISA도 시나리오가 건드리지 않아야 한다.
  test('ISA 계좌 수익률도 건드리지 않는다', () => {
    const withIsa: SimulationParams = {
      ...params,
      isaAccounts: [{
        id: 'i1', type: 'general', balance: 1000, monthlyContribution: 0,
        totalReturn: 9, dividendYield: 1.5, currency: 'KRW', maturityYears: 3,
      }],
    };

    const r = applyEconomicScenario(withIsa, 'recession');

    expect(r.isaAccounts![0].totalReturn).toBe(9);
  });

  test('ISA 계좌가 없어도 크래시하지 않는다', () => {
    expect(() => applyEconomicScenario(params, 'recession')).not.toThrow();
    expect(applyEconomicScenario(params, 'recession').isaAccounts).toBeUndefined();
  });

  test('입력 객체를 변형하지 않는다', () => {
    const snapshot = JSON.parse(JSON.stringify(params));

    applyEconomicScenario(params, 'recession');

    expect(params).toEqual(snapshot);
  });

  test('알 수 없는 시나리오는 입력을 그대로 반환한다', () => {
    expect(applyEconomicScenario(params, 'nope' as never)).toEqual(params);
  });

  test('AI 추천(미정)은 사용자가 입력한 물가상승률을 보존한다', () => {
    const custom = { ...params, inflationRate: 3.7 };

    const r = applyEconomicScenario(custom, 'ai_recommended');

    expect(r.inflationRate).toBe(3.7);
    expect(r).toEqual(custom);
  });
});

describe('경제 시나리오는 수익률을 지배하지 않는다', () => {
  // 물가·환율은 거시 환경이라 서비스가 제시하지만, 수익률은 「내 포트폴리오의 가정」이라
  // 사용자 입력이 유일한 출처다. 예전에는 국면을 고르면 주식·연금·ISA 수익률이 함께
  // 갈렸고, 리스크 성향과 겹쳐 실제로는 아무 효과도 없는 필드였다.
  const params = {
    userProfile: { currentAge: 50, retirementAge: 60, expectancy: 90, targetMonthlySpending: 3_000_000 },
    assets: [{
      id: 'a', type: 'etf', ticker: 'X', name: 'X', quantity: 1, averagePrice: 100_000_000,
      totalReturn: 9.5, dividendYield: 0.4, monthlyContribution: 0,
      reinvestDividend: true, currency: 'KRW', assetMarket: 'US_ETF',
    }],
    privatePensions: [{
      id: 'p', type: 'irp', investmentType: 'etf', name: 'IRP', balance: 50_000_000,
      monthlyContribution: 0, totalReturn: 6.4, dividendYield: 2.9, currency: 'KRW',
    }],
    isaAccounts: [{
      id: 'i', type: 'general', investmentType: 'etf', name: 'ISA', balance: 10_000_000,
      monthlyContribution: 0, totalReturn: 7, dividendYield: 3, currency: 'KRW', maturityYears: 3,
    }],
    otherIncomes: [],
    nationalPension: { expectedMonthlyAmount: 0 },
    inflationRate: 2.5, inflationMode: 'nominal', baseExchangeRate: 1400,
    exchangeScenario: 'base', displayCurrency: 'KRW',
  } as unknown as SimulationParams;

  for (const scenario of ['long_term_average', 'recession', 'high_inflation', 'low_growth'] as const) {
    test(`${scenario}: 총수익률이 입력값 그대로다`, () => {
      const applied = applyEconomicScenario(params, scenario);

      expect(applied.assets.map((a) => a.totalReturn)).toEqual([9.5]);
      expect(applied.privatePensions.map((p) => p.totalReturn)).toEqual([6.4]);
      expect(applied.isaAccounts!.map((i) => i.totalReturn)).toEqual([7]);
    });
  }

  test('물가와 환율은 여전히 지배한다', () => {
    const applied = applyEconomicScenario(params, 'high_inflation');

    expect(applied.inflationRate).toBe(5);
    expect(applied.exchangeScenario).toBe('usd_up');
  });
});
