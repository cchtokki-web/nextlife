import { describe, expect, test } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { runMonteCarlo } from '@/core/usecases/montecarlo/MonteCarloEngine';
import { retirementParams } from './fixtures';

describe('retirement-domain-invariants / Monte Carlo', () => {
  test('같은 입력과 같은 seed는 직렬화까지 동일한 결과를 만든다', () => {
    const params = retirementParams({
      assets: [{
        ...retirementParams().assets[0],
        quantity: 5_000,
        annualGrowthRate: 6,
        dividendYield: 2,
      }],
    });
    const config = { trials: 40, seed: 12_345, annualStdDev: 15 };
    const engine = new SimulationEngine();

    const first = runMonteCarlo(params, engine, config);
    const second = runMonteCarlo(params, engine, config);

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});
