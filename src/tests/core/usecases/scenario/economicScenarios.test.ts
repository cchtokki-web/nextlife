import { describe, test, expect } from 'vitest';
import {
  ECONOMIC_SCENARIO_PROFILES, applyEconomicScenario,
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
  test('모든 시나리오에 프로필이 정의되어 있다', () => {
    for (const s of ALL) {
      expect(ECONOMIC_SCENARIO_PROFILES[s], s).toBeDefined();
    }
  });

  test('고물가는 장기 평균보다 물가상승률이 높다', () => {
    expect(ECONOMIC_SCENARIO_PROFILES.high_inflation.inflationRate)
      .toBeGreaterThan(ECONOMIC_SCENARIO_PROFILES.long_term_average.inflationRate);
  });

  test('장기 침체는 장기 평균보다 주식 수익률이 낮다', () => {
    expect(ECONOMIC_SCENARIO_PROFILES.recession.stockGrowthRate)
      .toBeLessThan(ECONOMIC_SCENARIO_PROFILES.long_term_average.stockGrowthRate);
  });

  test('AI 추천은 장기 평균과 동일하다', () => {
    expect(ECONOMIC_SCENARIO_PROFILES.ai_recommended)
      .toEqual(ECONOMIC_SCENARIO_PROFILES.long_term_average);
  });
});

describe('applyEconomicScenario', () => {
  test('물가·환율 시나리오·수익률을 한꺼번에 교체한다', () => {
    const r = applyEconomicScenario(params, 'high_inflation');
    const profile = ECONOMIC_SCENARIO_PROFILES.high_inflation;

    expect(r.inflationRate).toBe(profile.inflationRate);
    expect(r.exchangeScenario).toBe(profile.exchangeScenario);
    expect(r.assets[0].annualGrowthRate).toBe(profile.stockGrowthRate);
    expect(r.privatePensions[0].annualReturn).toBe(profile.pensionReturnRate);
  });

  test('입력 객체를 변형하지 않는다', () => {
    const snapshot = JSON.parse(JSON.stringify(params));

    applyEconomicScenario(params, 'recession');

    expect(params).toEqual(snapshot);
  });

  test('알 수 없는 시나리오는 입력을 그대로 반환한다', () => {
    expect(applyEconomicScenario(params, 'nope' as never)).toEqual(params);
  });
});
