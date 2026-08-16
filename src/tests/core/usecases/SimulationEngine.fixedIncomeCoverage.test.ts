import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { computeMonthlySpendingComposition } from '@/core/usecases/MonthlySpendingComposition';
import { SimulationParams } from '@/core/entities/types';

// **고정소득 커버율은 자산을 헐어 쓰는 몫을 세지 않는다.**
//
// 이 지표의 목적은 SimulationEngine의 주석이 직접 말한다 — "배당·연금 등 고정소득만 반영하고
// 자산 매도·인출분은 제외한 지표". 그런데 사적연금 인출은 연금계좌라는 «자산»을 헐어 쓰는
// 것이라, 일반자산 매도와 경제적 실질이 같고 세제만 다르다. 일반자산 매도는 빼면서 연금계좌
// 인출은 넣는 것은 이 지표가 스스로 선언한 목적과 어긋난다.
//
// 국민연금·배당·기타소득은 남는다. 종신 지급이거나 원금을 유지한 채 나오는 흐름이라
// 계좌가 비어 멈추지 않는다. 같은 기준을 fireAge도 쓴다.

const engine = new SimulationEngine();

function params(overrides: Partial<SimulationParams> = {}): SimulationParams {
  return {
    userProfile: { currentAge: 60, retirementAge: 60, expectancy: 90, targetMonthlySpending: 2_000_000 },
    assets: [],
    isaAccounts: [],
    nationalPension: { expectedMonthlyAmount: 0 },
    privatePensions: [],
    otherIncomes: [],
    inflationRate: 0,
    inflationMode: 'real',
    baseExchangeRate: 1350,
    exchangeScenario: 'base',
    displayCurrency: 'KRW',
    ...overrides,
  };
}

const bigPension: SimulationParams['privatePensions'] = [
  { id: 'irp', type: 'irp', balance: 1_000_000_000, monthlyContribution: 0, annualReturn: 4, currency: 'KRW' },
];

describe('goalAchievementRate (고정소득 커버율)', () => {
  test('사적연금 인출만으로 사는 계획의 커버율은 0이다', () => {
    const result = engine.run(params({ privatePensions: bigPension }));

    expect(result.goalAchievementRate).toBe(0);
  });

  test('사적연금 잔액이 커도 커버율을 올리지 못한다', () => {
    const base = params({ nationalPension: { expectedMonthlyAmount: 1_000_000 } });

    const withPension = engine.run({ ...base, privatePensions: bigPension });

    expect(withPension.goalAchievementRate).toBe(engine.run(base).goalAchievementRate);
  });

  test('국민연금·배당은 커버율에 들어간다', () => {
    const result = engine.run(params({
      nationalPension: { expectedMonthlyAmount: 2_000_000 },
      withdrawalPlan: { nationalPensionStartAge: 60 },
    }));

    // 분모(targetMonthly)에는 의료비까지 들어가므로 100%에 닿지는 않는다.
    // 여기서 볼 것은 「국민연금이 실제로 분자에 들어간다」는 사실이다.
    expect(result.goalAchievementRate).toBeGreaterThan(50);
  });
});

describe('MonthlySpendingComposition - fixedIncomeCoverageRate', () => {
  test('연도별 커버율도 사적연금 인출을 세지 않는다', () => {
    const p = params({ privatePensions: bigPension });
    const result = engine.run(p);

    const composition = computeMonthlySpendingComposition(result.yearlyResults, p, result);

    expect(composition.length).toBeGreaterThan(0);
    for (const row of composition) {
      expect(row.fixedIncomeCoverageRate).toBe(0);
    }
  });

  // 커버율에서 빠지는 것과 «구성 항목»에서 빠지는 것은 다르다. 차트는 사적연금이 생활비를
  // 얼마나 채웠는지 계속 보여줘야 한다.
  test('사적연금은 생활비 구성 항목에는 그대로 남는다', () => {
    const p = params({ privatePensions: bigPension });
    const result = engine.run(p);

    const composition = computeMonthlySpendingComposition(result.yearlyResults, p, result);

    expect(composition.some((row) => row.privatePenUsed > 0)).toBe(true);
  });
});
