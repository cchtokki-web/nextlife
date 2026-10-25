import { describe, test, expect } from 'vitest';
import { SimulationEngine } from '@/core/usecases/SimulationEngine';
import { SimulationParams } from '@/core/entities/types';

// **은퇴점수의 「안정소득」에도 사적연금 인출은 들어가지 않는다.**
//
// pensionScore(20점)의 분자는 avgStableIncome이고 코드 주석은 "stable passive income source"라고
// 말한다. 그런데 사적연금 인출은 수동소득이 아니다 — 연금계좌라는 자산을 헐어 쓰는 것이라
// 잔액이 비면 멈춘다.
//
// 증상이 실측으로 드러난다. 같은 6억을 사적연금으로 들고 있으면 69세에 고갈되는데 47점,
// 일반주식으로 들고 있으면 71세까지 버티는데 30점이었다. **더 빨리 고갈되는 계획이 17점
// 높게** 나온 것이다. 원금 인출이 안정소득비 94%로 잡혀 20점을 거의 만점으로 채웠기 때문이다.
//
// cashFlowScore(goalAchievementRate)와 fireAge는 이미 같은 기준으로 정리했다. 두 항목이 같은
// 개념을 서로 다르게 세면 점수를 설명할 수 없다.

const engine = new SimulationEngine();

function params(overrides: Partial<SimulationParams> = {}): SimulationParams {
  return {
    userProfile: { currentAge: 60, retirementAge: 60, expectancy: 90, targetMonthlySpending: 5_000_000 },
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

// 수익률·배당을 맞춘 6억. 담는 «그릇»만 다르다.
const asPrivatePension = params({
  privatePensions: [
    { id: 'irp', type: 'irp', balance: 600_000_000, monthlyContribution: 0, totalReturn: 2, currency: 'KRW' },
  ],
});
const asGeneralStock = params({
  assets: [{
    id: 's', type: 'stock', ticker: 'S', name: '주식',
    quantity: 60_000, averagePrice: 10_000, totalReturn: 2, dividendYield: 0,
    monthlyContribution: 0, reinvestDividend: true, currency: 'KRW',
  }],
});

describe('은퇴점수 - 안정소득 비율', () => {
  // 자산이 실제로 줄어드는 계획을 쓴다. 고갈이 없고 자산이 은퇴 시점보다 줄지 않으면
  // 95점 하한 오버라이드가 먼저 걸려 어떤 하위 점수를 바꿔도 총점이 눌린다.
  test('더 빨리 고갈되는 계획이 자산의 그릇 때문에 더 높은 점수를 받지 않는다', () => {
    const pensionPlan = engine.run(asPrivatePension);
    const stockPlan = engine.run(asGeneralStock);

    // 픽스처의 전제: 사적연금 쪽이 먼저 고갈된다(세금 때문).
    expect(pensionPlan.depletionAge).not.toBeNull();
    expect(stockPlan.depletionAge).not.toBeNull();
    expect(pensionPlan.depletionAge!).toBeLessThan(stockPlan.depletionAge!);

    expect(pensionPlan.retirementScore).toBeLessThanOrEqual(stockPlan.retirementScore);
  });

  // 국민연금은 종신 지급이라 안정소득이 맞다. 이 축까지 빼면 반대 방향으로 틀린다.
  test('국민연금은 안정소득으로 센다', () => {
    const withNational = engine.run({
      ...asGeneralStock,
      nationalPension: { expectedMonthlyAmount: 1_500_000 },
      withdrawalPlan: { nationalPensionStartAge: 60 },
    });

    expect(withNational.retirementScore).toBeGreaterThan(engine.run(asGeneralStock).retirementScore);
  });

  // 배당은 원금을 유지한 채 나오는 흐름이라 안정소득이 맞다.
  test('배당은 안정소득으로 센다', () => {
    const withDividend = engine.run({
      ...asGeneralStock,
      assets: asGeneralStock.assets.map((a) => ({ ...a, dividendYield: 3, reinvestDividend: false })),
    });

    expect(withDividend.retirementScore).toBeGreaterThan(engine.run(asGeneralStock).retirementScore);
  });
});
