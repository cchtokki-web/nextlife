import { describe, test, expect } from 'vitest';
import { simulationYearCount } from '@/core/usecases/montecarlo/horizon';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { SimulationParams } from '@/core/entities/types';

// 수익률 경로의 길이는 runSingle이 실제로 도는 연수와 정확히 같아야 한다. 두 곳에서 따로
// 계산하면 배우자 규칙이 바뀔 때 조용히 어긋난다 — 같은 spouseRules를 재사용한다.
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
  test('배우자가 없으면 현재 나이부터 기대수명까지의 연수다', () => {
    expect(simulationYearCount(params())).toBe(85 - 50 + 1);
  });

  test('실제 엔진이 만드는 연도 수와 일치한다 (배우자 없음)', () => {
    expect(simulationYearCount(params()))
      .toBe(engine.runSingle(params()).yearlyResults.length);
  });

  // 배우자가 더 오래 살면 시뮬레이션은 그 시점까지 돈다(householdEndAge).
  // 경로가 짧으면 뒷부분이 조용히 충격 0이 되어 그 구간만 결정론이 된다.
  test('실제 엔진이 만드는 연도 수와 일치한다 (장수 배우자)', () => {
    const withSpouse = params({
      spouse: { enabled: true, currentAge: 45, expectancy: 95 },
    });

    expect(simulationYearCount(withSpouse))
      .toBe(engine.runSingle(withSpouse).yearlyResults.length);
  });

  test('실제 엔진이 만드는 연도 수와 일치한다 (본인이 더 오래 사는 배우자)', () => {
    const withSpouse = params({
      spouse: { enabled: true, currentAge: 60, expectancy: 70 },
    });

    expect(simulationYearCount(withSpouse))
      .toBe(engine.runSingle(withSpouse).yearlyResults.length);
  });

  test('배우자를 껐으면 없는 것과 같다', () => {
    const disabled = params({
      spouse: { enabled: false, currentAge: 45, expectancy: 95 },
    });

    expect(simulationYearCount(disabled)).toBe(simulationYearCount(params()));
  });
});
