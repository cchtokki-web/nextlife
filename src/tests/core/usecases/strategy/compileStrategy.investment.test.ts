import { describe, test, expect } from 'vitest';
import { compileStrategy, DEFAULT_RETIREMENT_STRATEGY } from '@/core/usecases/strategy/compileStrategy';
import { ECONOMIC_SCENARIO_PROFILES } from '@/core/usecases/scenario/economicScenarios';
import { RetirementStrategy, SimulationParams } from '@/core/entities/types';

const baseParams: SimulationParams = {
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

const withStrategy = (patch: Partial<RetirementStrategy>): SimulationParams => ({
  ...baseParams,
  strategy: { ...DEFAULT_RETIREMENT_STRATEGY, ...patch },
});

describe('compileStrategy 투자/경제 축', () => {
  test('경제 시나리오가 물가와 환율 시나리오를 지배한다', () => {
    const r = compileStrategy(withStrategy({ economicScenario: 'high_inflation' }));

    expect(r.params.inflationRate).toBe(ECONOMIC_SCENARIO_PROFILES.high_inflation.inflationRate);
    expect(r.params.exchangeScenario).toBe(ECONOMIC_SCENARIO_PROFILES.high_inflation.exchangeScenario);
  });

  test('리스크 성향이 시나리오보다 나중에 적용되어 수익률의 최종 승자가 된다', () => {
    const r = compileStrategy(withStrategy({
      economicScenario: 'recession', // 주식 3%
      riskProfile: 'aggressive', // 주식 9%
    }));

    expect(r.params.assets[0].annualGrowthRate).toBe(9);
    // 물가는 여전히 시나리오가 지배한다.
    expect(r.params.inflationRate).toBe(ECONOMIC_SCENARIO_PROFILES.recession.inflationRate);
  });

  test('리스크 성향이 ai_recommended면 시나리오 수익률을 덮어쓰지 않는다', () => {
    const r = compileStrategy(withStrategy({
      economicScenario: 'recession',
      riskProfile: 'ai_recommended',
    }));

    expect(r.params.assets[0].annualGrowthRate)
      .toBe(ECONOMIC_SCENARIO_PROFILES.recession.stockGrowthRate);
  });

  test('안정형/중립형/공격형이 각각 yieldPreset으로 번역된다', () => {
    expect(compileStrategy(withStrategy({ riskProfile: 'conservative' })).params.yieldPreset)
      .toBe('conservative');
    expect(compileStrategy(withStrategy({ riskProfile: 'neutral' })).params.yieldPreset)
      .toBe('base');
    expect(compileStrategy(withStrategy({ riskProfile: 'aggressive' })).params.yieldPreset)
      .toBe('aggressive');
  });

  test('리스크 성향 프리셋을 적용해도 자산별 reinvestDividend가 보존된다', () => {
    // applyYieldPreset이 자산 배열을 새로 만들지만 reinvestDividend는 스프레드로 유지된다.
    const params = withStrategy({ riskProfile: 'aggressive' });
    params.assets = [{ ...params.assets[0], reinvestDividend: false }];

    const r = compileStrategy(params);

    expect(r.params.assets[0].reinvestDividend).toBe(false);
    expect(r.params.assets[0].annualGrowthRate).toBe(9);
  });
});
