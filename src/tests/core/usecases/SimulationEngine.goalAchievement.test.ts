import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { SimulationParams } from '@/core/entities/types';

// **"은퇴 소득 달성률 62%"가 오해를 산 이유.**
//
// 이 지표의 분자에는 자산을 팔아 쓴 인출분이 들어가지 않는다. 그래서 리포트에서 9페이지의
// 재원 구성(국민연금 135만 + 배당 17만 + 자산인출 128만 = 280만, 목표 350만 대비 80%)과
// 1페이지의 62%가 이어지지 않았고, 사용자는 두 값 중 어느 쪽이 맞는지 알 수 없었다.
// 비율만으로는 설명할 수 없으므로 분자·분모를 결과에 함께 싣는다.
function makeParams(overrides: Partial<SimulationParams> = {}): SimulationParams {
  return {
    userProfile: { currentAge: 59, retirementAge: 60, expectancy: 63, targetMonthlySpending: 3000000 },
    assets: [
      { id: 'a1', type: 'etf', ticker: 'SPY', name: 'S&P500', quantity: 100, averagePrice: 1000000,
        totalReturn: 5, dividendYield: 2, monthlyContribution: 0, reinvestDividend: false, currency: 'KRW' },
    ],
    nationalPension: { expectedMonthlyAmount: 1000000 },
    privatePensions: [],
    otherIncomes: [],
    inflationRate: 0,
    inflationMode: 'real',
    baseExchangeRate: 1350,
    exchangeScenario: 'base',
    displayCurrency: 'KRW',
    withdrawalPlan: { nationalPensionStartAge: 60 },
    ...overrides,
  };
}

describe('goalAchievementRate 분자·분모', () => {
  test('분자와 분모를 결과에 함께 싣는다', () => {
    const result = new SimulationEngine().run(makeParams());

    expect(result.avgRetirementMonthlyIncome).toBeGreaterThan(0);
    expect(result.avgTargetMonthlySpending).toBeGreaterThan(0);
  });

  // 셋이 어긋나면 리포트가 "215만 ÷ 348만 = 62%"라고 써 놓고 실제로는 다른 계산을 한 셈이 된다.
  test('보고된 비율이 분자÷분모와 일치한다', () => {
    const result = new SimulationEngine().run(makeParams());

    const derived = Math.round(
      (result.avgRetirementMonthlyIncome! / result.avgTargetMonthlySpending!) * 100
    );
    expect(result.goalAchievementRate).toBe(derived);
  });

  // 이것이 이 지표의 정의다. 자산을 아무리 많이 팔아 써도 분자는 움직이지 않는다.
  test('분자는 연금·배당 등 소득만이며 자산 인출분은 포함하지 않는다', () => {
    const engine = new SimulationEngine();
    const result = engine.run(makeParams());

    const retirementYears = result.yearlyResults.filter((y) => y.age >= 60);
    const avgIncome =
      retirementYears.reduce((s, y) => s + y.totalIncome, 0) / retirementYears.length / 12;
    const avgSpending =
      retirementYears.reduce((s, y) => s + y.spending, 0) / retirementYears.length / 12;

    expect(result.avgRetirementMonthlyIncome).toBeCloseTo(avgIncome, 6);
    // 실제 지출은 자산 인출로 메워지므로 소득보다 크다 — 그 차이가 분자에서 빠진 몫이다.
    expect(avgSpending).toBeGreaterThan(result.avgRetirementMonthlyIncome!);
  });

  test('분모는 목표 생활비이며 의료비를 포함한다', () => {
    const engine = new SimulationEngine();

    const plain = engine.run(makeParams());
    const withHealthcare = engine.run(
      makeParams({
        healthcare: {
          enabled: true, costGrowthRate: 0, baseMonthlyCost: 300000,
          longTermCareEnabled: false, longTermCareStartAge: 85, longTermCareMonthlyCost: 0,
          shockEnabled: false, shockAge: 80, shockAmount: 0,
        },
      })
    );

    expect(withHealthcare.avgTargetMonthlySpending!).toBeGreaterThan(plain.avgTargetMonthlySpending!);
  });

  test('연령대별 생활비 곡선이 분모에 반영된다', () => {
    const engine = new SimulationEngine();

    const flat = engine.run(makeParams());
    const frontLoaded = engine.run(
      makeParams({ spendingCurve: { breakpointAges: [70, 80], multipliers: [1.2, 1.0, 0.8] } })
    );

    // 은퇴 구간(60~63세)이 전부 첫 구간이므로 목표가 1.2배가 된다.
    expect(frontLoaded.avgTargetMonthlySpending!).toBeCloseTo(flat.avgTargetMonthlySpending! * 1.2, 6);
  });
});
