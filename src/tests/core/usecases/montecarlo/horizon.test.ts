import { describe, test, expect } from 'vitest';
import { simulationYearCount } from '@/core/usecases/montecarlo/horizon';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { SimulationParams } from '@/core/entities/types';

// 수익률 경로의 길이는 runSingle이 실제로 도는 연수와 정확히 같아야 한다. 두 곳에서 따로
// 계산하면 조용히 어긋난다.
//
// 이 스위트는 그 일치를 실제 엔진 실행과 대조해 고정한다.
const engine = new SimulationEngine();

function params(overrides: Partial<SimulationParams> = {}): SimulationParams {
  return {
    userProfile: { currentAge: 50, retirementAge: 60, expectancy: 85, targetMonthlySpending: 2000000 },
    assets: [],
    isaAccounts: [],
    nationalPension: { expectedMonthlyAmount: 1000000 },
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

describe('simulationYearCount', () => {
  test('연수는 본인 기대수명까지의 햇수다', () => {
    const p = { ...params(), userProfile: { ...params().userProfile, currentAge: 50, expectancy: 85 } };

    expect(simulationYearCount(p)).toBe(36);
  });

  test('실제 엔진이 만드는 연도 수와 일치한다', () => {
    expect(simulationYearCount(params()))
      .toBe(engine.runSingle(params()).yearlyResults.length);
  });
});
