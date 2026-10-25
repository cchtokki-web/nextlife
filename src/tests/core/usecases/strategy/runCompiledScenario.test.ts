import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { runCompiledScenario } from '@/core/usecases/strategy/runCompiledScenario';
import { compileStrategy, DEFAULT_RETIREMENT_STRATEGY } from '@/core/usecases/strategy/compileStrategy';
import { SimulationParams } from '@/core/entities/types';

const baseParams: SimulationParams = {
  userProfile: { currentAge: 50, retirementAge: 60, expectancy: 85, targetMonthlySpending: 3000000 },
  assets: [
    {
      id: 'a1', type: 'etf', ticker: 'X', name: 'X', quantity: 1000, averagePrice: 100000,
      totalReturn: 7, dividendYield: 2, monthlyContribution: 0,
      reinvestDividend: false, currency: 'KRW',
    },
  ],
  nationalPension: { expectedMonthlyAmount: 1500000 },
  privatePensions: [],
  otherIncomes: [],
  inflationRate: 2.5,
  inflationMode: 'real',
  baseExchangeRate: 1350,
  exchangeScenario: 'base',
  displayCurrency: 'KRW',
};

describe('runCompiledScenario', () => {
  test('전략을 컴파일한 뒤 실행한다(원본 params를 그대로 넘기지 않는다)', () => {
    const engine = new SimulationEngine();
    // 확정 전략이라 컴파일이 실제로 값을 바꾼다(국민연금 개시 나이 70세).
    const params: SimulationParams = {
      ...baseParams,
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, nationalPensionStrategy: 'defer_max' },
    };

    const compiled = compileStrategy(params);
    expect(compiled.params.withdrawalPlan?.nationalPensionStartAge).toBe(70);

    const compared = runCompiledScenario(engine, params);
    const expected = engine.run(compiled.params, compiled.utilityConfig);
    const raw = engine.run(params);

    // 이 픽스처에서 두 경로가 실제로 갈려야 단언에 검증력이 있다.
    expect(JSON.stringify(expected.yearlyResults)).not.toBe(JSON.stringify(raw.yearlyResults));
    expect(JSON.stringify(compared.yearlyResults)).toBe(JSON.stringify(expected.yearlyResults));
  });

  test('목표 우선순위가 효용 점수에 반영된다(utilityConfig를 함께 넘긴다)', () => {
    const engine = new SimulationEngine();
    const bequestFirst: SimulationParams = {
      ...baseParams,
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, objective: 'bequest_maximization' },
    };
    const spendingFirst: SimulationParams = {
      ...baseParams,
      strategy: { ...DEFAULT_RETIREMENT_STRATEGY, objective: 'lifetime_spending' },
    };

    const a = runCompiledScenario(engine, bequestFirst);
    const b = runCompiledScenario(engine, spendingFirst);

    // utilityConfig를 넘기지 않으면 둘 다 기본 가중치로 채점되어 점수가 같아진다.
    expect(typeof a.utility?.score).toBe('number');
    expect(a.utility?.score).not.toBe(b.utility?.score);
  });

  test('strategy가 없는 레거시 시나리오는 입력이 그대로 보존된다', () => {
    const engine = new SimulationEngine();

    const compared = runCompiledScenario(engine, baseParams);
    const raw = engine.run(baseParams);

    expect(JSON.stringify(compared.yearlyResults)).toBe(JSON.stringify(raw.yearlyResults));
  });
});
