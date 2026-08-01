import { describe, test, expect } from 'vitest';
import {
  ECONOMIC_SCENARIO_PROFILES, applyEconomicScenario, isEconomicScenarioGoverning,
} from '@/core/usecases/scenario/economicScenarios';
import { EconomicScenario, SimulationParams } from '@/core/entities/types';

const ALL: EconomicScenario[] = [
  'long_term_average', 'recession', 'high_inflation', 'low_growth', 'ai_recommended',
];

const params: SimulationParams = {
  userProfile: { currentAge: 50, retirementAge: 60, expectancy: 85, targetMonthlySpending: 3000000 },
  assets: [
    {
      id: 'a1', type: 'etf', ticker: 'X', name: 'X', quantity: 1, averagePrice: 1,
      annualGrowthRate: 7, dividendYield: 2, monthlyContribution: 0,
      reinvestDividend: true, currency: 'KRW',
    },
  ],
  nationalPension: { expectedMonthlyAmount: 0 },
  privatePensions: [
    { id: 'p1', type: 'irp', balance: 1000, monthlyContribution: 0, annualReturn: 4, currency: 'KRW' },
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
    for (const s of ALL.filter((x) => x !== 'ai_recommended')) {
      expect(ECONOMIC_SCENARIO_PROFILES[s], s).toBeDefined();
    }
  });

  test('고물가는 장기 평균보다 물가상승률이 높다', () => {
    expect(ECONOMIC_SCENARIO_PROFILES.high_inflation!.inflationRate)
      .toBeGreaterThan(ECONOMIC_SCENARIO_PROFILES.long_term_average!.inflationRate);
  });

  test('장기 침체는 장기 평균보다 주식 수익률이 낮다', () => {
    expect(ECONOMIC_SCENARIO_PROFILES.recession!.stockGrowthRate)
      .toBeLessThan(ECONOMIC_SCENARIO_PROFILES.long_term_average!.stockGrowthRate);
  });

  test('AI 추천(미정)에는 프로필이 없다', () => {
    // 프로필을 주면 사용자가 직접 입력한 물가상승률이 조용히 덮어써진다.
    expect(ECONOMIC_SCENARIO_PROFILES.ai_recommended).toBeUndefined();
    expect(isEconomicScenarioGoverning('ai_recommended')).toBe(false);
    expect(isEconomicScenarioGoverning('recession')).toBe(true);
  });
});

describe('applyEconomicScenario', () => {
  test('물가·환율 시나리오·수익률을 한꺼번에 교체한다', () => {
    const r = applyEconomicScenario(params, 'high_inflation');
    const profile = ECONOMIC_SCENARIO_PROFILES.high_inflation!;

    expect(r.inflationRate).toBe(profile.inflationRate);
    expect(r.exchangeScenario).toBe(profile.exchangeScenario);
    expect(r.assets[0].annualGrowthRate).toBe(profile.stockGrowthRate);
    expect(r.privatePensions[0].annualReturn).toBe(profile.pensionReturnRate);
  });

  // B1: ISA는 assets와 같은 시장 연동 계좌인데(annualReturn + dividendYield로 성장하고
  // 엔진이 자기 annualReturn으로 굴린다) 시나리오에서만 빠져 있었다. "장기 침체"를 골라
  // 주식이 7% → 3%로 떨어지는 동안 ISA만 사용자 입력값을 유지하면, 구성상 ISA가 항상
  // 최고 수익 버킷이 되어 isaMaturityDestination 추천과 연금→ISA 채널링 판정이
  // 그 인공물 쪽으로 편향된다.
  test('ISA 계좌 수익률도 주식 수익률로 함께 교체한다', () => {
    const withIsa: SimulationParams = {
      ...params,
      isaAccounts: [{
        id: 'i1', type: 'general', balance: 1000, monthlyContribution: 0,
        annualReturn: 9, dividendYield: 1.5, currency: 'KRW', maturityYears: 3,
      }],
    };

    const r = applyEconomicScenario(withIsa, 'recession');

    expect(r.isaAccounts![0].annualReturn).toBe(ECONOMIC_SCENARIO_PROFILES.recession!.stockGrowthRate);
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
